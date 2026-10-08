/**
 * Phase 2A — Trade Repository
 *
 * Independent, dynamic trade (métier) registry. The 12 canonical official
 * trades are seeded on first access (memory mode) so the lookup is usable
 * without a database; when PostgreSQL is available the hybrid repository
 * reads from the `trades` table.
 *
 * Read-only by design: only the operations the current architecture needs
 * (official trades, lookup by code/id, and Material↔Trade resolution).
 *
 * Material↔Trade integration:
 *   `findForMaterial({ tradeId, trade })` resolves a material's trade using
 *   the existing `materials.trade_id` Drizzle relationship, falling back to
 *   the legacy `material.trade` code when no tradeId is present. This keeps
 *   all existing material list/search/filter queries unchanged and never
 *   adds new fields to the Material API contract.
 */
import { memoryStore } from './store';
import { Trade } from '../types';
import * as drizzleRepo from './drizzleTradeRepository';
import { isDatabaseAvailable } from '../db/client';

const COLLECTION = 'trades';

/** Deterministic identity so in-memory trades are addressable across repos. */
export function officialTradeId(code: string): string {
  return `trade_${code}`;
}

/**
 * The 12 canonical official trades. `code` values match the existing
 * `TradeCategory` union in src/types.ts (kept in sync with the catalog seed).
 */
export const OFFICIAL_TRADES: Array<{
  code: string;
  labelFr: string;
  labelAr?: string;
  labelDerja?: string;
  icon?: string;
  sortOrder: number;
}> = [
  { code: 'placo', labelFr: 'PLACO / PLÂTRE', labelAr: 'جبس وبلاطور', labelDerja: 'جبس وبلاطور', icon: 'Layers', sortOrder: 1 },
  { code: 'peinture', labelFr: 'PEINTURE', labelAr: 'دهان وطلاء', labelDerja: 'دهان', icon: 'Paintbrush', sortOrder: 2 },
  { code: 'carrelage', labelFr: 'CARRELAGE', labelAr: 'تبليط وسيراميك', labelDerja: 'زربيعة', icon: 'Grid3x3', sortOrder: 3 },
  { code: 'maconnerie', labelFr: 'MAÇONNERIE', labelAr: 'بناء بالأجر', labelDerja: 'بناء', icon: 'BrickWall', sortOrder: 4 },
  { code: 'plomberie', labelFr: 'PLOMBERIE', labelAr: 'سباكية', labelDerja: 'سباكية', icon: 'Droplets', sortOrder: 5 },
  { code: 'electricite', labelFr: 'ÉLECTRICITÉ', labelAr: 'كهرباء', labelDerja: 'كهرباء', icon: 'Zap', sortOrder: 6 },
  { code: 'etancheite', labelFr: 'ÉTANCHÉITÉ', labelAr: 'عزل مائي', labelDerja: 'عزل ماء', icon: 'ShieldCheck', sortOrder: 7 },
  { code: 'isolation', labelFr: 'ISOLATION', labelAr: 'عزل حراري', labelDerja: 'عزل حرارة', icon: 'Thermometer', sortOrder: 8 },
  { code: 'menuiserie', labelFr: 'MENUISERIE', labelAr: 'نجارة', labelDerja: 'نجارة', icon: 'Hammer', sortOrder: 9 },
  { code: 'sols', labelFr: 'REVÊTEMENTS DE SOL', labelAr: 'أرضيات', labelDerja: 'أرضيات', icon: 'LayoutGrid', sortOrder: 10 },
  { code: 'facade', labelFr: 'FAÇADE & EXTÉRIEUR', labelAr: 'واجهات خارجية', labelDerja: 'واجهات', icon: 'Building2', sortOrder: 11 },
  { code: 'demolition', labelFr: 'DÉMOLITION', labelAr: 'هدم وإزالة', labelDerja: 'هدم', icon: 'Trash2', sortOrder: 12 },
];
const now = () => new Date().toISOString();

/** Build the canonical official Trade entities (memory seed). */
export function buildTradesFromCatalog(): Trade[] {
  const timestamp = now();
  return OFFICIAL_TRADES.map((t) => ({
    id: officialTradeId(t.code),
    code: t.code,
    labelFr: t.labelFr,
    labelAr: t.labelAr,
    labelDerja: t.labelDerja,
    icon: t.icon,
    sortOrder: t.sortOrder,
    isActive: true,
    isOfficial: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}

export interface ITradeRepository {
  ensureSeeded(): void;
  findById(id: string): Promise<Trade | undefined> | Trade | undefined;
  findByCode(code: string): Promise<Trade | undefined> | Trade | undefined;
  list(officialOnly?: boolean, includeInactive?: boolean): Promise<Trade[]> | Trade[];
  findForMaterial(material: { tradeId?: string | null; trade?: string }): Promise<Trade | undefined> | Trade | undefined;
  count(): number;
  /** Admin → Métiers (additive). Returns undefined when the row does not exist. */
  update(id: string, patch: TradePatchInput): Promise<Trade | undefined> | Trade | undefined;
  /** Admin → Métiers (additive). Non-official rows only; undefined otherwise. */
  remove(id: string): Promise<Trade | undefined> | Trade | undefined;
}

/**
 * Admin → Métiers — fields an admin may change.
 * `code` / `isOfficial` are never patchable (identity + official protection).
 */
export interface TradePatchInput {
  labelFr?: string;
  labelAr?: string | null;
  labelDerja?: string | null;
  icon?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}
class MemoryTradeRepository implements ITradeRepository {
  private get map() {
    return memoryStore.getCollection(COLLECTION, `server/data/${COLLECTION}.json`);
  }

  ensureSeeded(): void {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[KONSTRIVO] Trade repository: in-memory seeding is not allowed in production. Implement Drizzle/Postgres repository.');
    }
    if (this.map.size === 0) {
      for (const t of buildTradesFromCatalog()) this.map.set(t.id, t);
      memoryStore.saveCollection(COLLECTION);
    }
  }

  findById(id: string): Trade | undefined {
    this.ensureSeeded();
    const t = this.map.get(id);
    return t as Trade | undefined;
  }

  findByCode(code: string): Trade | undefined {
    this.ensureSeeded();
    for (const t of this.map.values()) {
      if ((t as Trade).code === code) return t as Trade;
    }
    return undefined;
  }

  list(officialOnly = false, includeInactive = false): Trade[] {
    this.ensureSeeded();
    const all = Array.from(this.map.values()) as Trade[];
    // `includeInactive` is the Admin → Métiers view (additive, default false so
    // every existing caller — Outils, Services, CSV import — keeps its exact
    // behaviour: active trades only).
    const scoped = includeInactive ? all : all.filter((t) => t.isActive !== false);
    const filtered = officialOnly ? scoped.filter((t) => t.isOfficial) : scoped;
    // Deterministic order — mirrors the Drizzle path (ORDER BY sort_order, code)
    // so Outils/Services/Admin all see the same métier sequence.
    return filtered.slice().sort((a, b) => {
      const order = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (order !== 0) return order;
      return a.code.localeCompare(b.code);
    });
  }

  /** Admin → Métiers (additive). Official trades stay editable but never lose isOfficial. */
  update(id: string, patch: TradePatchInput): Trade | undefined {
    this.ensureSeeded();
    const existing = this.map.get(id) as Trade | undefined;
    if (!existing) return undefined;
    const next: Trade = {
      ...existing,
      ...(patch.labelFr !== undefined ? { labelFr: patch.labelFr } : {}),
      ...(patch.labelAr !== undefined ? { labelAr: patch.labelAr ?? undefined } : {}),
      ...(patch.labelDerja !== undefined ? { labelDerja: patch.labelDerja ?? undefined } : {}),
      ...(patch.icon !== undefined ? { icon: patch.icon ?? undefined } : {}),
      ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      updatedAt: now(),
    };
    this.map.set(id, next);
    memoryStore.saveCollection(COLLECTION);
    return next;
  }

  /** Admin → Métiers (additive). Only non-official trades can be removed. */
  remove(id: string): Trade | undefined {
    this.ensureSeeded();
    const existing = this.map.get(id) as Trade | undefined;
    if (!existing || existing.isOfficial) return undefined;
    this.map.delete(id);
    memoryStore.saveCollection(COLLECTION);
    return existing;
  }

  findForMaterial(material: { tradeId?: string | null; trade?: string }): Trade | undefined {
    this.ensureSeeded();
    if (material.tradeId) {
      const byId = this.findById(material.tradeId);
      if (byId) return byId;
    }
    if (material.trade) return this.findByCode(material.trade);
    return undefined;
  }

  count(): number {
    this.ensureSeeded();
    return this.list(false).length;
  }
}

/**
 * Returns true when PostgreSQL is genuinely reachable.
 * NOTE: NODE_ENV (including NODE_ENV=test) NEVER forces memory mode.
 * The ONLY signal is real Drizzle/PostgreSQL availability.
 */
async function isPgAvailable(): Promise<boolean> {
  return await isDatabaseAvailable();
}

/**
 * Mirror a PostgreSQL trade row into the in-memory collection so that
 * synchronous MemoryTradeRepository reads (used directly by some
 * repository-level tests) can also see dynamically created trades.
 * Official trades are never modified; dynamic trades stay non-official.
 */
function mirrorDbTradeToMemory(dbTrade: any): void {
  if (!dbTrade || !dbTrade.code) return;
  try {
    const map = memoryStore.getCollection(COLLECTION, `server/data/${COLLECTION}.json`);
    // De-duplicate: drop stale non-official memory placeholders with the same
    // code but a different id (e.g. `trade_gypsum` vs the real UUID row),
    // so findByCode/list stay consistent and counts don't inflate.
    // Official trades are never touched.
    for (const [key, val] of Array.from(map.entries())) {
      const t = val as Trade;
      if (t && (t as any).code === dbTrade.code && (t as any).id !== dbTrade.id && !(t as any).isOfficial) {
        map.delete(key);
      }
    }
    const toIso = (v: any) => (v instanceof Date ? v.toISOString() : (typeof v === 'string' ? v : now()));
    const mirrored: Trade = {
      id: dbTrade.id,
      code: dbTrade.code,
      labelFr: dbTrade.labelFr ?? dbTrade.code,
      labelAr: dbTrade.labelAr ?? undefined,
      labelDerja: dbTrade.labelDerja ?? undefined,
      icon: dbTrade.icon ?? undefined,
      sortOrder: dbTrade.sortOrder ?? 999,
      isActive: dbTrade.isActive ?? true,
      // Never promote a dynamic trade to official via the mirror.
      isOfficial: dbTrade.isOfficial ?? false,
      createdAt: toIso(dbTrade.createdAt),
      updatedAt: toIso(dbTrade.updatedAt),
    } as Trade;
    map.set(mirrored.id, mirrored);
    memoryStore.saveCollection(COLLECTION);
  } catch {
    // Mirroring is best-effort; the PostgreSQL row remains the source of truth.
  }
}

class HybridTradeRepository implements ITradeRepository {
  private memory = new MemoryTradeRepository();

  async ensureSeeded(): Promise<void> { return this.memory.ensureSeeded(); }

  async findById(id: string) {
    // Use Drizzle/PostgreSQL whenever genuinely available — including
    // NODE_ENV=test. Memory/canonical data is ONLY a fallback when
    // PostgreSQL is genuinely unavailable.
    if (await isPgAvailable()) {
      const row = await drizzleRepo.findTradeById(id);
      if (row) {
        mirrorDbTradeToMemory(row);
        return row;
      }
      return undefined;
    }
    return this.memory.findById(id);
  }

  async findByCode(code: string) {
    // Use Drizzle/PostgreSQL whenever genuinely available — including
    // NODE_ENV=test. Memory/canonical data is ONLY a fallback when
    // PostgreSQL is genuinely unavailable.
    if (await isPgAvailable()) {
      const row = await drizzleRepo.findTradeByCode(code);
      if (row) {
        mirrorDbTradeToMemory(row);
        return row;
      }
      return undefined;
    }
    return this.memory.findByCode(code);
  }

  async list(officialOnly = false, includeInactive = false) {
    // No "12 trades only" restriction: return every matching PostgreSQL row
    // (official + dynamic). officialOnly still filters to official trades.
    // includeInactive=true is the Admin → Métiers view (additive parameter).
    if (await isPgAvailable()) return await drizzleRepo.listTrades({ officialOnly, includeInactive });
    return this.memory.list(officialOnly, includeInactive);
  }

  async update(id: string, patch: TradePatchInput) {
    if (await isPgAvailable()) {
      const row = await drizzleRepo.updateTrade(id, patch);
      if (row) mirrorDbTradeToMemory(row);
      return row;
    }
    return this.memory.update(id, patch);
  }

  async remove(id: string) {
    if (await isPgAvailable()) {
      // Guard BEFORE the DELETE so an FK error (materials still attached) is
      // reported as a clear conflict instead of a raw PostgreSQL 23503.
      const attached = await drizzleRepo.countMaterialsForTrade(id);
      if (attached > 0) {
        const err: any = new Error(
          `Trade '${id}' still has ${attached} material(s). Move or remove them before deleting this métier.`
        );
        err.statusCode = 409;
        throw err;
      }
      return await drizzleRepo.deleteTrade(id);
    }
    return this.memory.remove(id);
  }

  async findForMaterial(material: { tradeId?: string | null; trade?: string }) {
    if (await isPgAvailable()) {
      // Resolve via material.tradeId first, only then fall back to the
      // legacy material.trade code for backward compatibility.
      if (material.tradeId) {
        const byId = await drizzleRepo.findTradeById(material.tradeId);
        if (byId) {
          mirrorDbTradeToMemory(byId);
          return byId;
        }
      }
      if (material.trade) {
        const byCode = await drizzleRepo.findTradeByCode(material.trade);
        if (byCode) mirrorDbTradeToMemory(byCode);
        return byCode;
      }
      return undefined;
    }
    return this.memory.findForMaterial(material);
  }

  count(): number {
    return this.memory.count();
  }
}

export { MemoryTradeRepository };

/**
 * Phase B — Create a trade by code if it does not already exist.
 *
 * Delegates to the Drizzle repository when PostgreSQL is available, otherwise
 * creates the trade in the in-memory store. Official trades are never modified.
 * Idempotent: returns the existing trade if the code is already present.
 */
export async function upsertTradeByCode(code: string, label?: string) {
  // PostgreSQL is used whenever genuinely available — including NODE_ENV=test.
  // NODE_ENV NEVER forces memory mode; memory stays purely as a fallback.
  if (await isPgAvailable()) {
    const row = await drizzleRepo.upsertTradeByCode(code, label);
    if (row) mirrorDbTradeToMemory(row);
    return row;
  }
  // Memory mode (PostgreSQL genuinely unavailable only)
  const existing = await tradeRepository.findByCode(code);
  if (existing) return existing;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[KONSTRIVO] Trade repository: in-memory trade creation is not allowed in production.');
  }
  const timestamp = now();
  const newTrade: Trade = {
    id: `trade_${code}`,
    code,
    labelFr: label || code,
    labelAr: undefined,
    labelDerja: undefined,
    icon: undefined,
    sortOrder: 999,
    isActive: true,
    isOfficial: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const map = memoryStore.getCollection(COLLECTION, `server/data/${COLLECTION}.json`);
  map.set(newTrade.id, newTrade);
  memoryStore.saveCollection(COLLECTION);
  return newTrade;
}

export const tradeRepository: ITradeRepository = new HybridTradeRepository();

/**
 * Admin → Métiers — number of materials attached to a trade.
 *
 * Used by the DELETE guard: `materials.trade_id` has FK ON DELETE NO ACTION, so
 * removing a trade that still owns materials would raise a raw PostgreSQL
 * 23503. Counting first turns that into a clear 409. Works on both backends
 * (PostgreSQL when reachable, the in-memory collections otherwise).
 */
export async function countMaterialsForTrade(tradeId: string): Promise<number> {
  if (await isPgAvailable()) return drizzleRepo.countMaterialsForTrade(tradeId);
  const materials = memoryStore.getCollection('materials', 'server/data/materials.json');
  let count = 0;
  for (const value of materials.values()) {
    const material = value as { tradeId?: string | null };
    if (material && material.tradeId === tradeId) count++;
  }
  return count;
}