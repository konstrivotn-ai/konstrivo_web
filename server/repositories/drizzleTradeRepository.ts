/**
 * Phase 2A — Trade Repository (Drizzle/PostgreSQL)
 *
 * Read-only access to the `trades` registry, mirroring the
 * `drizzleMaterialRepository` conventions. The `trades` table and the
 * `materials.trade_id` foreign key already exist (Phase 1 migration 0003);
 * this module provides the lookup layer on top of that relationship.
 */
import { getDatabase } from '../db/client';
import { materials, trades } from '../db/schema';
import { and, eq, inArray } from 'drizzle-orm';

/**
 * Phase B — Create a trade by code if it does not already exist.
 *
 * Used by the CSV import flow so that a newly imported trade (e.g. `gypsum`)
 * is persisted in the `trades` table and becomes immediately available through
 * the existing trade repository/API. Official trades are never modified.
 *
 * Returns the existing row if the code is already present (idempotent).
 */
export async function upsertTradeByCode(code: string, label?: string) {
  const db = await getDatabase();
  if (!db) return undefined;
  const existing = await findTradeByCode(code);
  if (existing) return existing;
  const inserted = await db.insert(trades).values({
    code,
    labelFr: label || code,
    labelAr: null,
    labelDerja: null,
    icon: null,
    sortOrder: 999,
    isActive: true,
    isOfficial: false,
  }).returning();
  return inserted?.[0];
}

/**
 * A canonical lowercase/uppercase hyphenated UUID (matching PostgreSQL's
 * `uuid` type). Guarding the column value here avoids passing an arbitrary
 * non-UUID string into `WHERE id = ...`, which would otherwise raise a
 * PostgreSQL `22P02` (invalid text representation for uuid) instead of
 * returning an empty result set.
 */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function findTradeById(id: string) {
  const db = await getDatabase();
  if (!db) return undefined;
  if (!isUuid(id)) return undefined;
  const res = await db.select().from(trades).where(eq(trades.id, id)).limit(1);
  return res[0];
}

export async function findTradeByCode(code: string) {
  const db = await getDatabase();
  if (!db) return undefined;
  const res = await db.select().from(trades).where(eq(trades.code, code)).limit(1);
  return res[0];
}

export async function listTrades(opts: { officialOnly?: boolean; includeInactive?: boolean } = {}) {
  const { officialOnly = false, includeInactive = false } = opts;
  const db = await getDatabase();
  if (!db) return [];
  const conditions: any[] = [];
  if (officialOnly) conditions.push(eq(trades.isOfficial, true));
  if (!includeInactive) conditions.push(eq(trades.isActive, true));
  const q = conditions.length > 0
    ? db.select().from(trades).where(and(...conditions)).orderBy(trades.sortOrder, trades.code)
    : db.select().from(trades).orderBy(trades.sortOrder, trades.code);
  return await q;
}

/**
 * Admin → Métiers — editable fields of a trade row.
 *
 * `code` and `isOfficial` are DELIBERATELY not patchable: the code is the
 * identity used by materials/prices/CSV imports, and `is_official` protects the
 * 12 canonical trades from deletion/demotion (see schema comment).
 */
export interface TradePatch {
  labelFr?: string;
  labelAr?: string | null;
  labelDerja?: string | null;
  icon?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

/** Update one trade by id. Returns the updated row (undefined when not found). */
export async function updateTrade(id: string, patch: TradePatch) {
  const db = await getDatabase();
  if (!db) return undefined;
  if (!isUuid(id)) return undefined;
  const values: Record<string, any> = { updatedAt: new Date() };
  if (patch.labelFr !== undefined) values.labelFr = patch.labelFr;
  if (patch.labelAr !== undefined) values.labelAr = patch.labelAr;
  if (patch.labelDerja !== undefined) values.labelDerja = patch.labelDerja;
  if (patch.icon !== undefined) values.icon = patch.icon;
  if (patch.sortOrder !== undefined) values.sortOrder = patch.sortOrder;
  if (patch.isActive !== undefined) values.isActive = patch.isActive;
  const [updated] = await db.update(trades).set(values).where(eq(trades.id, id)).returning();
  return updated;
}

/** Number of materials still attached to a trade (blocks deletion). */
export async function countMaterialsForTrade(tradeId: string): Promise<number> {
  const db = await getDatabase();
  if (!db) return 0;
  if (!isUuid(tradeId)) return 0;
  const rows = await db.select({ id: materials.id }).from(materials).where(eq(materials.tradeId, tradeId));
  return rows.length;
}

/** Live material codes per trade id — used by the delete guard. */
export async function countMaterialsForTrades(tradeIds: string[]): Promise<Record<string, number>> {
  const db = await getDatabase();
  const out: Record<string, number> = {};
  if (!db || tradeIds.length === 0) return out;
  const ids = tradeIds.filter(isUuid);
  if (ids.length === 0) return out;
  const rows = await db.select({ id: materials.id, tradeId: materials.tradeId }).from(materials)
    .where(inArray(materials.tradeId, ids));
  for (const r of rows) {
    const key = String(r.tradeId);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

/**
 * Hard-delete a trade row. ONLY non-official trades may be deleted; the
 * caller enforces that, and this function re-checks the flag in SQL so an
 * official trade can never be removed even by a direct call.
 * `trade_services` rows cascade (FK ON DELETE CASCADE).
 */
export async function deleteTrade(id: string) {
  const db = await getDatabase();
  if (!db) return undefined;
  if (!isUuid(id)) return undefined;
  const [deleted] = await db.delete(trades)
    .where(and(eq(trades.id, id), eq(trades.isOfficial, false)))
    .returning();
  return deleted;
}