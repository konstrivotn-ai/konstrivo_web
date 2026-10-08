/**
 * Phase 2 — Price Repository
 *
 * Pricing is SEPARATE from Material identity.
 * Seeded from DEFAULT_MARKET_RATES on first access.
 */
import { memoryStore } from './store';
import { config } from '../config';
import { Material, MaterialPrice, PaginatedResult, PriceSource } from '../types';
import { generateId } from '../utils/crypto';
import { buildMaterialsFromRates, PRICE_SOURCES } from './seed';
import { isDatabaseAvailable } from '../db/client';
import * as drizzleRepo from './drizzlePriceRepository';
import { materialRepository } from './materialRepository';

const COLLECTION = 'material_prices';

/**
 * Unit fidelity — the in-memory equivalent of the `materials.base_unit` JOIN
 * that the Drizzle/production path performs in `listPrices()`.
 *
 * THE BUG THIS FIXES: the in-memory repository returned the raw price row,
 * which carries no unit (the unit lives on the MATERIAL, not the price). Every
 * `/api/v1/prices` payload produced in local development therefore arrived with
 * `unit === undefined`, `buildPriceMapWithTrade` stored `undefined` for it and
 * `mergeRates` fell back to the neutral default `'unit'` — so an imported CSV
 * material quoted in `m`, `Kg`, `Litre`, `Set`, `m²`, … was priced as
 * "1 unit". The Drizzle path was correct only because it already selected
 * `materials.base_unit` and mapped it to `unit` (`normalizePriceRow`).
 *
 * The resolution below is GENERIC: it reads whatever the linked material row
 * stores in `baseUnit` (seed, CSV import, admin edit, any trade, any market).
 * No unit is invented, and no trade/CSV name is special-cased.
 */

/** Same collection/path the in-memory MaterialRepository persists. */
const MATERIALS_COLLECTION = 'materials';

/**
 * The REAL base unit of the material a price belongs to, read from the shared
 * in-memory materials collection (`server/data/materials.json`).
 *
 * Uses the material repository's own lazy seeding so a price row can always see
 * the material it belongs to (both are seeded from the SAME source), then reads
 * the collection directly because this repository is synchronous by contract
 * (the hybrid only delegates here when PostgreSQL is unavailable).
 */
function materialBaseUnit(materialId: string | null | undefined): string | undefined {
  if (!materialId) return undefined;
  materialRepository.ensureSeeded();
  const materials = memoryStore.getCollection(MATERIALS_COLLECTION, `server/data/${MATERIALS_COLLECTION}.json`);
  const material = materials.get(materialId) as Material | undefined;
  if (!material || material.isDeleted) return undefined;
  const baseUnit = typeof material.baseUnit === 'string' ? material.baseUnit.trim() : '';
  return baseUnit === '' ? undefined : baseUnit;
}

/**
 * Priority IDENTICAL to the Drizzle path (`normalizePriceRow`):
 * `unit: row.baseUnit ?? row.unit ?? undefined`.
 * The material's base unit is authoritative; a unit carried by the price row
 * itself is only used when the material defines none.
 */
function resolvePriceUnit(price: Pick<MaterialPrice, 'materialId' | 'unit'>): string | undefined {
  return materialBaseUnit(price.materialId) ?? price.unit ?? undefined;
}

/**
 * In-memory parity with `listPrices()`'s `materials.is_deleted = false`
 * condition: a price whose MATERIAL was archived by the Admin
 * (`DELETE /api/v1/materials/:id`) is no longer served by /prices, so local
 * development behaves exactly like production. Read-only: no row is modified.
 */
function materialArchived(materialId: string | null | undefined): boolean {
  if (!materialId) return false;
  materialRepository.ensureSeeded();
  const materials = memoryStore.getCollection(MATERIALS_COLLECTION, `server/data/${MATERIALS_COLLECTION}.json`);
  const material = materials.get(materialId) as Material | undefined;
  return !!material?.isDeleted;
}

export interface PriceFilters {
  materialId?: string;
  currency?: string;
  source?: PriceSource;
  market?: string;
  effectiveDate?: string;
  page?: number;
  limit?: number;
}

export interface IPriceRepository {
  ensureSeeded(): void | Promise<void>;
  findById(id: string): Promise<MaterialPrice | undefined> | MaterialPrice | undefined;
  list(filters: PriceFilters): Promise<PaginatedResult<MaterialPrice>> | PaginatedResult<MaterialPrice>;
  getCurrentPrice(materialId: string, currency?: string, market?: string): Promise<MaterialPrice | undefined> | MaterialPrice | undefined;
  create(data: Partial<MaterialPrice>): Promise<MaterialPrice> | MaterialPrice;
  update(id: string, patch: Partial<MaterialPrice>): Promise<MaterialPrice> | MaterialPrice;
  softDelete(id: string): Promise<void> | void;
  getPriceSources(): Promise<typeof PRICE_SOURCES> | typeof PRICE_SOURCES;
}

class MemoryPriceRepository implements IPriceRepository {
  private get map() {
    return memoryStore.getCollection(COLLECTION, `server/data/${COLLECTION}.json`);
  }

  /**
   * Return the price row WITH the real unit of its material (DB/JOIN parity).
   *
   * This is also the SELF-HEALING step for rows persisted before the unit was
   * carried: `server/data/material_prices.json` may contain unit-less rows, and
   * they are repaired on read — nothing is deleted, no cache is rewritten by
   * hand and no stored price changes. A new object is returned only when the
   * resolved unit actually differs from the stored one.
   */
  private withUnit(price: MaterialPrice): MaterialPrice {
    const unit = resolvePriceUnit(price);
    if (unit === undefined || unit === price.unit) return price;
    return { ...price, unit };
  }

  ensureSeeded(): void {
    if (config.isProduction) {
      throw new Error('[KONSTRIVO] Price repository: in-memory seeding is not allowed in production. Implement Drizzle/Postgres repository.');
    }
    if (this.map.size === 0) {
      const { prices } = buildMaterialsFromRates();
      for (const p of prices) {
        this.map.set(p.id, p);
      }
      memoryStore.saveCollection(COLLECTION);
    }
  }

  findById(id: string): MaterialPrice | undefined {
    this.ensureSeeded();
    const p = this.map.get(id);
    if (!p || (p as MaterialPrice).isDeleted) return undefined;
    return this.withUnit(p as MaterialPrice);
  }

  list(filters: PriceFilters): PaginatedResult<MaterialPrice> {
    this.ensureSeeded();
    const all = Array.from(this.map.values()) as MaterialPrice[];
    // Archived price rows AND prices of ADMIN-ARCHIVED materials are excluded
    // (same two conditions as the Drizzle `listPrices`).
    let filtered = all.filter(p => !p.isDeleted && !materialArchived(p.materialId));

    if (filters.materialId) {
      filtered = filtered.filter(p => p.materialId === filters.materialId);
    }
    if (filters.currency) {
      filtered = filtered.filter(p => p.currency === filters.currency);
    }
    if (filters.source) {
      filtered = filtered.filter(p => p.source === filters.source);
    }
    if (filters.market) {
      filtered = filtered.filter(p => p.market === filters.market);
    }
    if (filters.effectiveDate) {
      const d = filters.effectiveDate;
      filtered = filtered.filter(p => {
        const from = p.effectiveFrom;
        const to = p.effectiveTo;
        return from <= d && (!to || to >= d);
      });
    }

    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const limit = filters.limit && filters.limit > 0 ? Math.min(filters.limit, 200) : 20;
    const total = filtered.length;
    const start = (page - 1) * limit;
    // Unit fidelity — same payload shape as `listPrices()` (Drizzle path): every
    // row carries the REAL unit of its material, so `/api/v1/prices` is
    // identical in local development and in production.
    const data = filtered.slice(start, start + limit).map(p => this.withUnit(p));

    return { data, page, limit, total };
  }

  getCurrentPrice(materialId: string, currency = 'TND', market = 'tn'): MaterialPrice | undefined {
    this.ensureSeeded();
    for (const p of this.map.values()) {
      const price = p as MaterialPrice;
      if (
        price.materialId === materialId &&
        !price.isDeleted &&
        price.isCurrent &&
        price.currency === currency &&
        price.market === market
      ) {
        return this.withUnit(price);
      }
    }
    return undefined;
  }

  create(data: Partial<MaterialPrice>): MaterialPrice {
    this.ensureSeeded();
    const now = new Date().toISOString();
    // If marked as current, deactivate other current prices for the same material
    if (data.isCurrent && data.materialId) {
      for (const p of this.map.values()) {
        const price = p as MaterialPrice;
        if (price.materialId === data.materialId && price.isCurrent && !price.isDeleted) {
          price.isCurrent = false;
          price.effectiveTo = new Date().toISOString().slice(0, 10);
          price.updatedAt = now;
          this.map.set(price.id, price);
        }
      }
    }
    const price: MaterialPrice = {
      id: generateId(),
      materialId: data.materialId || '',
      // Unit fidelity — a price row created in memory (e.g. a custom price or an
      // imported supplier price) carries the SAME unit the read path resolves:
      // the material's `baseUnit` first, then an explicitly provided unit, then
      // nothing (never a hardcoded 'unit').
      unit: resolvePriceUnit({ materialId: data.materialId || '', unit: data.unit }),
      price: data.price ?? 0,
      currency: data.currency || 'TND',
      source: data.source || 'CUSTOM',
      market: data.market || 'tn',
      countryCode: data.countryCode || 'TN',
      supplierId: data.supplierId,
      companyId: data.companyId,
      isCurrent: data.isCurrent ?? true,
      effectiveFrom: data.effectiveFrom || new Date().toISOString().slice(0, 10),
      effectiveTo: data.effectiveTo,
      notes: data.notes,
      createdAt: now,
      updatedAt: now,
      version: 1,
      isDeleted: false,
    };
    this.map.set(price.id, price);
    memoryStore.saveCollection(COLLECTION);
    return price;
  }

  update(id: string, patch: Partial<MaterialPrice>): MaterialPrice {
    this.ensureSeeded();
    const existing = this.map.get(id) as MaterialPrice;
    if (!existing) throw new Error('Price not found');
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString(), version: existing.version + 1 };
    this.map.set(id, updated);
    memoryStore.saveCollection(COLLECTION);
    // Return the resolved payload (the material's unit wins, DB parity); the
    // stored row is never rewritten by hand.
    return this.withUnit(updated);
  }

  softDelete(id: string): void {
    this.ensureSeeded();
    const existing = this.map.get(id) as MaterialPrice;
    if (!existing) return;
    existing.isDeleted = true;
    existing.updatedAt = new Date().toISOString();
    this.map.set(id, existing);
    memoryStore.saveCollection(COLLECTION);
  }

  getPriceSources() {
    return [...PRICE_SOURCES];
  }
}

class HybridPriceRepository implements IPriceRepository {
  private memory = new MemoryPriceRepository();
  async ensureSeeded() { return this.memory.ensureSeeded(); }
  async findById(id: string) { if (await isDatabaseAvailable()) return await drizzleRepo.findPriceById(id); return this.memory.findById(id); }
  async list(filters: PriceFilters) { if (await isDatabaseAvailable()) return await drizzleRepo.listPrices(filters); return this.memory.list(filters); }
  async getCurrentPrice(materialId: string, currency?: string, market?: string) { if (await isDatabaseAvailable()) return await drizzleRepo.getCurrentPrice(materialId, currency, market); return this.memory.getCurrentPrice(materialId, currency, market); }
  async create(data: Partial<MaterialPrice>) { if (await isDatabaseAvailable()) return await drizzleRepo.createPrice(data); return this.memory.create(data); }
  async update(id: string, patch: Partial<MaterialPrice>) { if (await isDatabaseAvailable()) return await drizzleRepo.updatePrice(id, patch); return this.memory.update(id, patch); }
  async softDelete(id: string) { if (await isDatabaseAvailable()) return await drizzleRepo.updatePrice(id, { isDeleted: true }); return this.memory.softDelete(id); }
  async getPriceSources() { if (await isDatabaseAvailable()) return await drizzleRepo.getPriceSources(); return this.memory.getPriceSources(); }
}

export const priceRepository: IPriceRepository = new HybridPriceRepository();
