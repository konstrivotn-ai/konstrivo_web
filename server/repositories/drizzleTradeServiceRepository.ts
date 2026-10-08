/**
 * Phase D — Trade Service Repository (Drizzle/PostgreSQL)
 *
 * Data-driven trade ↔ service association. Services are stored in the
 * `trade_services` table and resolved by tradeId, so a newly imported trade
 * can have meaningful services WITHOUT any source code change.
 */
import { getDatabase } from '../db/client';
import { tradeServices } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';

export interface TradeServiceRow {
  id: string;
  tradeId: string;
  nameFr: string;
  nameAr: string | null;
  defaultUnit: string;
  suggestedRateTnd: number | null;
  isActive: boolean;
  sortOrder: number;
}

/** Map a raw `trade_services` row to the API shape (single place). */
function mapServiceRow(r: any): TradeServiceRow {
  return {
    id: r.id,
    tradeId: r.tradeId,
    nameFr: r.nameFr,
    nameAr: r.nameAr,
    defaultUnit: r.defaultUnit,
    suggestedRateTnd: r.suggestedRateTnd != null ? Number(r.suggestedRateTnd) : null,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
  };
}

/**
 * List active services for a trade, ordered by sortOrder.
 * Returns [] when the database is unavailable.
 */
export async function listServicesByTradeId(tradeId: string): Promise<TradeServiceRow[]> {
  const db = await getDatabase();
  if (!db) return [];
  const rows = await db.select().from(tradeServices)
    .where(and(eq(tradeServices.tradeId, tradeId), eq(tradeServices.isActive, true)))
    .orderBy(tradeServices.sortOrder);
  return rows.map(r => ({
    id: r.id,
    tradeId: r.tradeId,
    nameFr: r.nameFr,
    nameAr: r.nameAr,
    defaultUnit: r.defaultUnit,
    suggestedRateTnd: r.suggestedRateTnd != null ? Number(r.suggestedRateTnd) : null,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
  }));
}

export async function listAllServicesByTradeId(tradeId: string): Promise<TradeServiceRow[]> {
  // Admin → Métiers: inactive rows are included so they can be re-activated.
  const db = await getDatabase();
  if (!db) return [];
  const rows = await db.select().from(tradeServices)
    .where(eq(tradeServices.tradeId, tradeId))
    .orderBy(tradeServices.sortOrder);
  return rows.map(mapServiceRow);
}

/**
 * Admin → Métiers — activate/deactivate ONE service row (never deleted).
 * Returns the updated row, or undefined when the id is unknown / no database.
 */
export async function setTradeServiceActive(serviceId: string, isActive: boolean): Promise<TradeServiceRow | undefined> {
  const db = await getDatabase();
  if (!db) return undefined;
  const [updated] = await db.update(tradeServices)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(tradeServices.id, serviceId))
    .returning();
  return updated ? mapServiceRow(updated) : undefined;
}

/**
 * List active services for multiple trades in one query.
 * Returns a Map<tradeId, TradeServiceRow[]>.
 */
export async function listServicesByTradeIds(tradeIds: string[]): Promise<Map<string, TradeServiceRow[]>> {
  const db = await getDatabase();
  if (!db) return new Map();
  if (tradeIds.length === 0) return new Map();
  const rows = await db.select().from(tradeServices)
    .where(eq(tradeServices.isActive, true))
    .orderBy(tradeServices.sortOrder);
  const result = new Map<string, TradeServiceRow[]>();
  for (const tradeId of tradeIds) result.set(tradeId, []);
  for (const r of rows) {
    if (!result.has(r.tradeId)) continue;
    result.get(r.tradeId)!.push(mapServiceRow(r));
  }
  return result;
}

/**
 * Upsert a service for a trade by (tradeId, nameFr) — idempotent.
 * Used by admin/API to add services to dynamic trades without code changes.
 */
export async function upsertTradeService(tradeId: string, service: {
  nameFr: string;
  nameAr?: string | null;
  defaultUnit?: string;
  suggestedRateTnd?: number | null;
  sortOrder?: number;
}): Promise<TradeServiceRow | undefined> {
  const db = await getDatabase();
  if (!db) return undefined;
  // Check for existing service with same name for this trade
  const existing = await db.select().from(tradeServices)
    .where(and(eq(tradeServices.tradeId, tradeId), eq(tradeServices.nameFr, service.nameFr)))
    .limit(1);
  if (existing.length > 0) {
    const [updated] = await db.update(tradeServices).set({
      nameAr: service.nameAr ?? existing[0].nameAr,
      defaultUnit: service.defaultUnit ?? existing[0].defaultUnit,
      suggestedRateTnd: service.suggestedRateTnd != null ? String(service.suggestedRateTnd) : existing[0].suggestedRateTnd,
      sortOrder: service.sortOrder ?? existing[0].sortOrder,
      isActive: true,
      updatedAt: new Date(),
    }).where(eq(tradeServices.id, existing[0].id)).returning();
    return mapServiceRow(updated);
  }
  const [inserted] = await db.insert(tradeServices).values({
    tradeId,
    nameFr: service.nameFr,
    nameAr: service.nameAr ?? null,
    defaultUnit: service.defaultUnit ?? 'm²',
    suggestedRateTnd: service.suggestedRateTnd != null ? String(service.suggestedRateTnd) : null,
    sortOrder: service.sortOrder ?? 0,
  }).returning();
  return mapServiceRow(inserted);
}
