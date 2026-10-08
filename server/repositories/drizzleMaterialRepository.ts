import { getDatabase } from '../db/client';
import { materials } from '../db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { isValidUuid, normalizeMaterialRef } from '../utils/validation';

export async function findMaterialById(id: string) {
  const db = await getDatabase();
  if (!db) return undefined;
  // Guard non-UUID input before it reaches PostgreSQL — the `id` column is a
  // `uuid` and an unguarded `WHERE id = '...'` raises 22P02 (500) instead of
  // returning an empty result (→ 404 through the route layer).
  if (!isValidUuid(id)) return undefined;
  const res = await db.select().from(materials).where(eq(materials.id, id)).limit(1);
  return res[0];
}

export async function findMaterialByCode(code: string) {
  const db = await getDatabase();
  if (!db) return undefined;
  const res = await db.select().from(materials).where(eq(materials.code, code)).limit(1);
  return res[0];
}

/**
 * Step 5 — Idempotent upsert of an OFFICIAL material by its legacy `code`
 * (e.g. `plaque_ba13_standard`). Official materials have company_id IS NULL.
 * Re-running with the same code updates the existing row — never duplicates.
 */
export async function upsertMaterialByCode(data: {
  code: string;
  trade: string;
  /** Optional resolved trades.id — Phase 1 Foundation: when provided it is
   * PERSISTED so materials.trade_id is no longer left NULL after imports. */
  tradeId?: string | null;
  category: string;
  nameFr: string;
  nameAr?: string | null;
  nameEn?: string | null;
  baseUnit: string;
  technicalSpecs?: string | null;
}, tx?: any) {
  // Phase A — optional explicit transaction handle. When provided, ALL reads
  // and writes run on the SAME connection/transaction so a bulk catalog import
  // is atomic (any row failure → full rollback). When omitted the behaviour is
  // byte-identical to the pre-Phase-A single-item upsert.
  const db = tx || (await getDatabase());
  if (!db) throw new Error('Database not available');
  const existing = await db.select().from(materials)
    .where(and(eq(materials.code, data.code), isNull(materials.companyId)))
    .limit(1);
  if (existing[0]) {
    const [updated] = await db.update(materials).set({
      trade: data.trade,
      // Only touch trade_id when a resolved id was provided — keeps the
      // legacy behaviour intact for callers that do not pass it.
      ...(data.tradeId !== undefined ? { tradeId: data.tradeId } : {}),
      category: data.category,
      nameFr: data.nameFr,
      nameAr: data.nameAr ?? null,
      nameEn: data.nameEn ?? null,
      baseUnit: data.baseUnit,
      technicalSpecs: data.technicalSpecs ?? null,
      isOfficial: true,
      // RESURRECT ON DELIBERATE RE-IMPORT — the Admin archive action sets
      // `is_deleted = true` (history/Devis snapshots untouched). Importing that
      // SAME official code again is an explicit decision to publish it again,
      // exactly like `seedCatalog`'s documented "resurrect a soft-deleted row"
      // behaviour (server/db/seedCatalog.ts). No other row is affected and no
      // historical price row is deleted — the price upsert below supersedes the
      // current price in place (isCurrent/effectiveTo), it never erases it.
      isDeleted: false,
      deletedAt: null,
      updatedAt: new Date(),
    }).where(eq(materials.id, existing[0].id)).returning();
    return updated;
  }
  const [inserted] = await db.insert(materials).values({
    code: data.code,
    trade: data.trade,
    tradeId: data.tradeId ?? null,
    category: data.category,
    nameFr: data.nameFr,
    nameAr: data.nameAr ?? null,
    nameEn: data.nameEn ?? null,
    baseUnit: data.baseUnit,
    isOfficial: true,
    companyId: null,
    technicalSpecs: data.technicalSpecs ?? null,
  }).returning();
  return inserted;
}

export async function listMaterials({ trade, category, search, page = 1, limit = 20 }: any) {
  const db = await getDatabase();
  if (!db) return { data: [], page, limit, total: 0 };
  // Single .where(and(...)): chained .where() calls OVERWRITE each other in
  // drizzle-orm (see drizzlePriceRepository), which would silently drop the
  // is_deleted filter. Search restores the memory-repo contract (code +
  // nameFr) so code-based lookups (findMaterialIdByCode) resolve.
  const conditions: any[] = [eq(materials.isDeleted, false)];
  if (trade) conditions.push(eq(materials.trade, trade));
  if (category) conditions.push(eq(materials.category, category));
  if (search) conditions.push(sql`(${materials.nameFr} ILIKE ${`%${search}%`} OR ${materials.code} ILIKE ${`%${search}%`})`);
  const all = await db.select().from(materials).where(and(...conditions));
  const total = all.length;
  const start = (page - 1) * limit;
  const data = all.slice(start, start + limit);
  return { data, page, limit, total };
}

export async function createMaterial(data: any) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');
  const [inserted] = await db.insert(materials).values(data).returning();
  return inserted;
}

export async function updateMaterial(id: string, patch: any) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');
  if (!isValidUuid(id)) return undefined;
  const [updated] = await db.update(materials).set(patch).where(eq(materials.id, id)).returning();
  return updated;
}

/**
 * Admin archive lookup — resolve ONE official material from a reference that
 * may be
 *   • its UUID `id` (the API/DB identity), or
 *   • its `code` verbatim, or
 *   • the calculator's id spelling of that code (`plaque-ba13-standard` ↔
 *     `plaque_ba13_standard`), normalized with the ONE shared rule
 *     (`normalizeMaterialRef`).
 *
 * Returns an explicit outcome instead of guessing: when a reference matches
 * SEVERAL official materials the caller must refuse the operation (nothing is
 * archived) rather than pick one arbitrarily.
 */
export type ArchiveMaterialLookup =
  | { status: 'found'; material: any }
  | { status: 'ambiguous'; count: number; codes: string[] }
  | { status: 'missing' };

export async function findOfficialMaterialForArchive(ref: string): Promise<ArchiveMaterialLookup> {
  const db = await getDatabase();
  if (!db) return { status: 'missing' };
  const raw = String(ref ?? '').trim();
  if (!raw) return { status: 'missing' };

  if (isValidUuid(raw)) {
    const byId = await db.select().from(materials).where(eq(materials.id, raw)).limit(1);
    if (byId[0]) return { status: 'found', material: byId[0] };
  }

  const exact = await db.select().from(materials)
    .where(and(eq(materials.code, raw), isNull(materials.companyId)))
    .limit(2);
  if (exact.length === 1) return { status: 'found', material: exact[0] };
  if (exact.length > 1) return { status: 'ambiguous', count: exact.length, codes: exact.map((m: any) => String(m.code)) };

  const normalized = normalizeMaterialRef(raw);
  if (!normalized) return { status: 'missing' };
  // Same normalization in SQL: lower-case + non-alphanumeric runs → `_` +
  // leading/trailing `_` trimmed. No data is modified by this lookup.
  const rows = await db.select().from(materials)
    .where(and(
      isNull(materials.companyId),
      sql`trim(both '_' from regexp_replace(lower(${materials.code}), '[^a-z0-9]+', '_', 'g')) = ${normalized}`,
    ))
    .limit(3);
  if (rows.length === 1) return { status: 'found', material: rows[0] };
  if (rows.length > 1) return { status: 'ambiguous', count: rows.length, codes: rows.map((m: any) => String(m.code)) };
  return { status: 'missing' };
}

/**
 * Every ARCHIVED (soft-deleted) OFFICIAL material code (`is_deleted = true`,
 * `company_id IS NULL`). Read-only: it backs the additive
 * `GET /api/v1/catalog/inactive-refs` endpoint so every client can suppress a
 * material the database no longer serves. Company (tenant) materials are never
 * exposed here.
 */
export async function listArchivedOfficialMaterialCodes(): Promise<string[]> {
  const db = await getDatabase();
  if (!db) return [];
  const rows = await db.select({ code: materials.code }).from(materials)
    .where(and(eq(materials.isDeleted, true), isNull(materials.companyId)))
    .limit(5000);
  return rows.map((r: any) => String(r.code ?? '')).filter((c: string) => c !== '');
}

export async function softDeleteMaterial(id: string) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');
  if (!isValidUuid(id)) return;
  await db.update(materials).set({ isDeleted: true }).where(eq(materials.id, id));
}

/**
 * Phase A — read-only lookup of an OFFICIAL material by its legacy `code`
 * (company_id IS NULL), optionally INSIDE an open transaction. Used by the
 * bulk CSV import to report created vs updated per row without changing the
 * Step 5 upsert contract.
 */
export async function findOfficialMaterialByCode(code: string, tx?: any) {
  const db = tx || (await getDatabase());
  if (!db) return undefined;
  const res = await db.select().from(materials)
    .where(and(eq(materials.code, code), isNull(materials.companyId)))
    .limit(1);
  return res[0];
}
