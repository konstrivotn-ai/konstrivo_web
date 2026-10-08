/**
 * Phase 2 - Devis Repository
 */
import { memoryStore } from './store';
import { config } from '../config';
import { Devis, DevisItem, PaginatedResult, DevisStatus } from '../types';
import { generateId } from '../utils/crypto';
import { isDatabaseAvailable } from '../db/client';
import * as drizzleRepo from './drizzleDevisRepository';

const COLLECTION = 'devis';
const COLLECTION_IDEM = 'devis_idempotency';

export interface DevisFilters {
  companyId: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface CreateDevisInput {
  companyId: string;
  createdByUserId: string;
  reference?: string;
  date?: string;
  clientName: string;
  clientPhone?: string;
  clientAddress?: string;
  projectTitle?: string;
  country?: string;
  currency?: string;
  region?: string;
  items?: Partial<DevisItem>[];
  tvaPercent?: number;
  timbreFiscal?: number;
  retenueGarantiePercent?: number;
  discount?: number;
  status?: DevisStatus;
}

export interface IDevisRepository {
  findById(id: string): Promise<Devis | undefined> | Devis | undefined;
  list(filters: DevisFilters): Promise<PaginatedResult<Devis>> | PaginatedResult<Devis>;
  create(input: CreateDevisInput): Promise<Devis> | Devis;
  update(id: string, patch: Partial<Devis>, expectedVersion?: number): Promise<Devis> | Devis;
  softDelete(id: string): Promise<void> | void;
  findByIdempotencyKey(key: string): Promise<Devis | undefined> | Devis | undefined;
  storeIdempotencyKey(key: string, devisId: string): Promise<void> | void;
}

class MemoryDevisRepository implements IDevisRepository {
  private get map() {
    return memoryStore.getCollection(COLLECTION, `server/data/${COLLECTION}.json`);
  }

  private get idemMap() {
    return memoryStore.getCollection(COLLECTION_IDEM, `server/data/${COLLECTION_IDEM}.json`);
  }

  findById(id: string): Devis | undefined {
    if (config.isProduction) {
      throw new Error('[KONSTRIVO] Devis repository: in-memory repository is not allowed in production. Implement Drizzle/Postgres repository.');
    }
    const d = this.map.get(id);
    if (!d || (d as Devis).isDeleted) return undefined;
    return d as Devis;
  }

  list(filters: DevisFilters): PaginatedResult<Devis> {
    if (config.isProduction) {
      throw new Error('[KONSTRIVO] Devis repository: in-memory repository is not allowed in production. Implement Drizzle/Postgres repository.');
    }
    const all = Array.from(this.map.values()) as Devis[];
    let filtered = all.filter(d => !d.isDeleted && d.companyId === filters.companyId);
    if (filters.status) filtered = filtered.filter(d => d.status === filters.status);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      filtered = filtered.filter(d =>
        d.clientName?.toLowerCase().includes(q) ||
        d.projectTitle?.toLowerCase().includes(q) ||
        d.reference?.toLowerCase().includes(q) ||
        d.devisNumber?.toLowerCase().includes(q));
    }
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const limit = filters.limit && filters.limit > 0 ? Math.min(filters.limit, 200) : 20;
    const total = filtered.length;
    const start = (page - 1) * limit;
    return { data: filtered.slice(start, start + limit), page, limit, total };
  }

  private generateDevisNumber(): string {
    const year = new Date().getFullYear();
    let maxNum = 0;
    for (const d of this.map.values()) {
      const devis = d as Devis;
      const match = devis.devisNumber?.match(/DEV-(\d{4})-(\d+)/);
      if (match && parseInt(match[1], 10) === year) {
        maxNum = Math.max(maxNum, parseInt(match[2], 10));
      }
    }
    return `DEV-${year}-${String(maxNum + 1).padStart(5, '0')}`;
  }

  create(input: CreateDevisInput): Devis {
    if (config.isProduction) {
      throw new Error('[KONSTRIVO] Devis repository: in-memory repository is not allowed in production. Implement Drizzle/Postgres repository.');
    }
    const now = new Date().toISOString();
    const devisId = generateId();
    const devisNumber = this.generateDevisNumber();

    const items: DevisItem[] = (input.items || []).map((item, idx) => ({
      id: item.id || generateId(),
      devisId,
      lineNumber: idx + 1,
      materialId: item.materialId,
      trade: item.trade || '',
      title: item.title || '',
      quantity: item.quantity ?? 1,
      unit: item.unit || 'unit',
      unitPrice: item.unitPrice ?? 0,
      total: item.total ?? ((item.quantity ?? 1) * (item.unitPrice ?? 0)),
      unitPriceTnd: item.unitPriceTnd,
      totalTnd: item.totalTnd,
      isCustomAdded: item.isCustomAdded ?? false,
      supplierReference: item.supplierReference,
      packageDetailsSnapshot: item.packageDetailsSnapshot,
      createdAt: now,
      updatedAt: now,
      version: 1,
    }));

    // Mirrors the frontend classification (DevisTab.tsx): titles containing
    // "main d'œuvre" (ligature), "main d'oeuvre" (ASCII fallback), "khidma"
    // or "labor" are LABOR lines; everything else is MATERIALS.
    const isLabor = (t: string) => {
      const s = t.toLowerCase();
      return (
        s.includes("main d'\u0153uvre") ||
        s.includes("main d'oeuvre") ||
        s.includes('khidma') ||
        s.includes('labor')
      );
    };
    const subtotalMaterials = items.filter(i => !isLabor(i.title)).reduce((acc, i) => acc + i.total, 0);
    const subtotalLabor = items.filter(i => isLabor(i.title)).reduce((acc, i) => acc + i.total, 0);
    const netHt = Math.max(0, subtotalMaterials + subtotalLabor - (input.discount || 0));
    const tvaAmount = input.tvaPercent ? (netHt * input.tvaPercent) / 100 : 0;
    const timbreFiscal = input.timbreFiscal ?? 1.0;
    const grandTotal = netHt + tvaAmount + timbreFiscal;

    const devis: Devis = {
      id: devisId,
      companyId: input.companyId,
      createdByUserId: input.createdByUserId,
      devisNumber,
      reference: input.reference || devisNumber,
      date: input.date || now.slice(0, 10),
      clientName: input.clientName,
      clientPhone: input.clientPhone || '',
      clientAddress: input.clientAddress || '',
      projectTitle: input.projectTitle || '',
      country: input.country || 'TN',
      currency: input.currency || 'TND',
      region: input.region || 'Tunis Grand',
      items,
      subtotalMaterials,
      subtotalLabor,
      discount: input.discount || 0,
      tvaPercent: input.tvaPercent ?? 19,
      timbreFiscal,
      retenueGarantiePercent: input.retenueGarantiePercent ?? 0,
      total: Math.round(grandTotal * 1000) / 1000,
      status: input.status || 'draft',
      syncState: 'SYNCED',
      createdAt: now,
      updatedAt: now,
      version: 1,
      isDeleted: false,
    };

    this.map.set(devis.id, devis);
    memoryStore.saveCollection(COLLECTION);
    return devis;
  }

  update(id: string, patch: Partial<Devis>, expectedVersion?: number): Devis {
    if (config.isProduction) {
      throw new Error('[KONSTRIVO] Devis repository: in-memory repository is not allowed in production. Implement Drizzle/Postgres repository.');
    }
    const existing = this.map.get(id) as Devis;
    if (!existing) throw new Error('Devis not found');
    if (existing.isDeleted) throw new Error('Devis is deleted');

    if (expectedVersion !== undefined && expectedVersion !== existing.version) {
      const err = new Error(`Version conflict: expected ${expectedVersion}, server has ${existing.version}`);
      (err as any).statusCode = 409;
      (err as any).code = 'CONFLICT';
      throw err;
    }

    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString(), version: existing.version + 1 };
    this.map.set(id, updated);
    memoryStore.saveCollection(COLLECTION);
    return updated;
  }

  /** SOFT DELETE ONLY - never physically removes the record in Phase 2. */
  softDelete(id: string): void {
    if (config.isProduction) {
      throw new Error('[KONSTRIVO] Devis repository: in-memory repository is not allowed in production. Implement Drizzle/Postgres repository.');
    }
    const existing = this.map.get(id) as Devis;
    if (!existing) return;
    existing.isDeleted = true;
    existing.deletedAt = new Date().toISOString();
    existing.updatedAt = new Date().toISOString();
    existing.version = existing.version + 1;
    this.map.set(id, existing);
    memoryStore.saveCollection(COLLECTION);
  }

  findByIdempotencyKey(key: string): Devis | undefined {
    if (config.isProduction) {
      throw new Error('[KONSTRIVO] Devis repository: in-memory repository is not allowed in production. Implement Drizzle/Postgres repository.');
    }
    const devisId = this.idemMap.get(key);
    if (!devisId) return undefined;
    const devis = this.map.get(devisId as string) as Devis | undefined;
    if (!devis || devis.isDeleted) return undefined;
    return devis;
  }

  storeIdempotencyKey(key: string, devisId: string): void {
    this.idemMap.set(key, devisId);
    memoryStore.saveCollection(COLLECTION_IDEM);
  }
}
class HybridDevisRepository implements IDevisRepository {
  private memory = new MemoryDevisRepository();
  async findById(id: string) { if (await isDatabaseAvailable()) return await drizzleRepo.findDevisById(id); return this.memory.findById(id); }
  async list(filters: DevisFilters) { if (await isDatabaseAvailable()) return await drizzleRepo.listDevis(filters); return this.memory.list(filters); }
  async create(input: CreateDevisInput) { if (await isDatabaseAvailable()) return await drizzleRepo.createDevis(input); return this.memory.create(input); }
  async update(id: string, patch: Partial<Devis>, expectedVersion?: number) { if (await isDatabaseAvailable()) return await drizzleRepo.updateDevis(id, patch, expectedVersion); return this.memory.update(id, patch, expectedVersion); }
  async softDelete(id: string) { if (await isDatabaseAvailable()) return await drizzleRepo.softDeleteDevis(id); return this.memory.softDelete(id); }
  async findByIdempotencyKey(key: string) { if (await isDatabaseAvailable()) return await drizzleRepo.findDevisByIdempotencyKey(key); return this.memory.findByIdempotencyKey(key); }
  async storeIdempotencyKey(key: string, devisId: string) { if (await isDatabaseAvailable()) return await drizzleRepo.storeIdempotencyKey(key, devisId); return this.memory.storeIdempotencyKey(key, devisId); }
}

export const devisRepository: IDevisRepository = new HybridDevisRepository();
