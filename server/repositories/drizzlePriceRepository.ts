import { getDatabase } from '../db/client';
import { materialPrices, materials, priceSources } from '../db/schema';
import { PRICE_SOURCES } from './seed';
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';

/**
 * Step 1 — Price Read-Path Normalization.
 *
 * Maps a raw Drizzle `material_prices` row onto the MemoryRepo contract
 * (server/types.ts `MaterialPrice`) that `src/App.tsx` consumes:
 *   - `unitPrice` (NUMERIC string) → `price` as a number
 *   - `sourceCode` → `source`
 *   - `currencyCode` → `currency`
 *   - `market` = countryCode.toLowerCase()
 *   - createdAt/updatedAt (Date) → ISO strings
 *
 * Pure output mapping — no query, filter or business-logic change.
 * Exported so tests/price_normalization.test.ts can verify the contract
 * without a database.
 */
export function normalizePriceRow(row: any): any {
  if (!row) return row;
  const countryCode: string = row.countryCode || 'TN';
  const toIso = (v: any): string | undefined => {
    if (v === undefined || v === null) return undefined;
    const d = v instanceof Date ? v : new Date(v);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  };
  const toNumber = (v: any): number | undefined => {
    if (v === undefined || v === null) return undefined;
    const n = Number(v);
    return isNaN(n) ? undefined : n;
  };
  return {
    id: row.id,
    materialId: row.materialId,
    code: row.code,
    // Real material data from the `materials` JOIN (listPrices). Additive and
    // backward compatible: rows produced by the other repository functions
    // (findPriceById, getCurrentPrice, createPrice, ...) simply carry undefined
    // here and every consumer keeps its existing fallback behavior.
    trade: row.trade ?? undefined,
    tradeId: row.tradeId ?? undefined,
    nameFr: row.nameFr ?? undefined,
    nameAr: row.nameAr ?? undefined,
    nameEn: row.nameEn ?? undefined,
    unit: row.baseUnit ?? row.unit ?? undefined,
    category: row.category ?? undefined,
    price: row.unitPrice === undefined || row.unitPrice === null ? 0 : Number(row.unitPrice),
    currency: row.currencyCode,
    source: row.sourceCode,
    market: countryCode.toLowerCase(),
    countryCode,
    supplierId: row.supplierId ?? undefined,
    companyId: row.companyId ?? undefined,
    reviewStatus: row.reviewStatus ?? 'published',
    reviewedBy: row.reviewedBy ?? undefined,
    reviewedAt: toIso(row.reviewedAt),
    publishedBy: row.publishedBy ?? undefined,
    publishedAt: toIso(row.publishedAt),
    rejectedBy: row.rejectedBy ?? undefined,
    rejectedAt: toIso(row.rejectedAt),
    rejectionReason: row.rejectionReason ?? undefined,
    isCurrent: row.isCurrent,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo ?? undefined,
    packageDefinitionId: row.packageDefinitionId ?? undefined,
    packagePrice: toNumber(row.packagePrice),
    supplierCatalogItemId: row.supplierCatalogItemId ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    version: row.version,
    isDeleted: row.isDeleted,
  };
}

export async function findPriceById(id: string) {
  const db = await getDatabase();
  if (!db) return undefined;
  const res = await db.select().from(materialPrices).where(eq(materialPrices.id, id)).limit(1);
  return res[0] ? normalizePriceRow(res[0]) : undefined;
}

export async function listPrices(filters: any) {
  const db = await getDatabase();
  if (!db) return { data: [], page: filters.page || 1, limit: filters.limit || 20, total: 0 };
  // Step 2 — Price filtering & ordering fixes:
  //  1) CASE-INSENSITIVE market filter: `tn` must match `country_code='TN'`
  //     (the website sends GET /api/v1/prices?market=tn).
  //  2) All filters are AND-ed in ONE .where() call — drizzle's chained
  //     .where() OVERWRITES previous conditions (verified in the installed
  //     drizzle-orm), which silently dropped `is_deleted = false` whenever
  //     another filter was present. Memory-repo semantics = AND of all filters.
  //  3) Deterministic ordering so current/effective prices are preferred:
  //     effective_from DESC, then updated_at DESC. No schema change,
  //     no business-logic change.
  const conditions: any[] = [
    eq(materialPrices.isDeleted, false),
    // Phase 3B — only published prices are eligible for the public market
    // reference and calculator path. Pending/reviewed/rejected rows are
    // intentionally excluded until an admin publishes them.
    eq(materialPrices.reviewStatus, 'published'),
    eq(materialPrices.isCurrent, true),
    ne(materialPrices.sourceCode, 'SUPPLIER_SUBMITTED'),
    // DB IS THE SOURCE OF TRUTH FOR CATALOG STATE — an ADMIN-ARCHIVED material
    // (`materials.is_deleted = true`, set by DELETE /api/v1/materials/:id) must
    // not be served any more, exactly like an archived price row. Without this
    // condition the archived material kept coming back through /prices and the
    // client's merge re-created the barème line the Admin had just removed.
    eq(materials.isDeleted, false),
  ];
  if (filters.materialId) conditions.push(eq(materialPrices.materialId, filters.materialId));
  if (filters.currency) conditions.push(eq(materialPrices.currencyCode, filters.currency));
  if (filters.source) conditions.push(eq(materialPrices.sourceCode, filters.source));
  if (filters.market) conditions.push(sql`upper(${materialPrices.countryCode}) = upper(${filters.market})`);
  // Step 5 — carry `materials.code` (legacy slug) with every price so the
  // website can match server prices to the legacy IDs the Calculator uses.
  // Phase D — also carry the authoritative trade relationship (tradeId + trade
  // code) so the frontend can resolve dynamic-trade materials without a
  // hardcoded category. The materials table is already joined here.
  // Dynamic-trades fix — carry the FULL material identity (nameFr/nameAr/
  // nameEn/base_unit/category) so the Outils UI can render the REAL data a
  // CSV import stored in the DB instead of synthesised "Server price (...)"
  // placeholders. Additive only: existing consumers ignore the new fields.
  const all = await db.select({
    id: materialPrices.id,
    materialId: materialPrices.materialId,
    sourceCode: materialPrices.sourceCode,
    countryCode: materialPrices.countryCode,
    currencyCode: materialPrices.currencyCode,
    unitPrice: materialPrices.unitPrice,
    companyId: materialPrices.companyId,
    supplierId: materialPrices.supplierId,
    isCurrent: materialPrices.isCurrent,
    effectiveFrom: materialPrices.effectiveFrom,
    effectiveTo: materialPrices.effectiveTo,
    packageDefinitionId: materialPrices.packageDefinitionId,
    packagePrice: materialPrices.packagePrice,
    supplierCatalogItemId: materialPrices.supplierCatalogItemId,
    notes: materialPrices.notes,
    createdAt: materialPrices.createdAt,
    updatedAt: materialPrices.updatedAt,
    version: materialPrices.version,
    isDeleted: materialPrices.isDeleted,
    code: materials.code,
    trade: materials.trade,
    tradeId: materials.tradeId,
    nameFr: materials.nameFr,
    nameAr: materials.nameAr,
    nameEn: materials.nameEn,
    baseUnit: materials.baseUnit,
    category: materials.category,
  }).from(materialPrices)
    .innerJoin(materials, eq(materials.id, materialPrices.materialId))
    .where(and(...conditions))
    .orderBy(desc(materialPrices.effectiveFrom), desc(materialPrices.updatedAt));
  const total = all.length;
  const page = filters.page || 1;
  const limit = filters.limit || 20;
  const start = (page - 1) * limit;
  const data = all.slice(start, start + limit).map(normalizePriceRow);
  return { data, page, limit, total };
}

export async function getPriceSources() {
  const db = await getDatabase();
  if (!db) return [];
  const res = await db.select().from(priceSources);
  return res;
}

/**
 * Idempotent price_sources bootstrap for a single source code.
 * Uses the canonical PRICE_SOURCES definition (same source of truth as the
 * production `db:seed` script); unknown codes fall back to a minimal row so
 * the FK is never violated by a legitimate company-specific source.
 */
export async function ensurePriceSourceExists(db: any, code: string) {
  if (!code) return;
  const existing = await db.select().from(priceSources)
    .where(eq(priceSources.code, code)).limit(1);
  if (existing[0]) return;
  const canonical = PRICE_SOURCES.find((s) => s.code === code);
  await db.insert(priceSources).values({
    code,
    name: canonical?.name || code,
    isVerified: canonical?.isVerified ?? false,
    priorityWeight: canonical?.priorityWeight ?? 10,
  }).onConflictDoNothing({ target: priceSources.code });
}

export async function createPrice(data: any) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');
  // Self-heal the price_sources dimension: company-specific CUSTOM prices
  // require a matching price_sources row for the FK. The canonical seed
  // (PRICE_SOURCES) is the source of truth; ensure the requested source
  // exists idempotently instead of failing with an FK violation. FK stays intact.
  await ensurePriceSourceExists(db, data.source || 'CUSTOM');
  const [inserted] = await db.insert(materialPrices).values({
    materialId: data.materialId,
    sourceCode: data.source,
    countryCode: data.countryCode || 'TN',
    currencyCode: data.currency || 'TND',
    unitPrice: data.price,
    companyId: data.companyId,
    supplierId: data.supplierId,
    isCurrent: data.isCurrent ?? true,
    effectiveFrom: data.effectiveFrom,
    notes: data.notes,
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1,
    isDeleted: false,
  }).returning();
  return inserted ? normalizePriceRow(inserted) : inserted;
}

export async function updatePrice(id: string, patch: any) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');
  const [updated] = await db.update(materialPrices).set(patch).where(eq(materialPrices.id, id)).returning();
  return updated ? normalizePriceRow(updated) : updated;
}

/**
 * Step 5 — Idempotent upsert of the OFFICIAL_CURRENT price for a material.
 *
 * Lookup key: (material_id + source_code='OFFICIAL_DEFAULT' + is_current=true +
 * company_id IS NULL) — existing columns only, no new constraints.
 * Re-running updates the price in place — never duplicates.
 *
 * Official prices are public (company_id = NULL) and do NOT touch
 * company-specific CUSTOM or supplier prices.
 */
export async function upsertOfficialPrice(data: {
  materialCode: string;
  price: number;
  currencyCode?: string;
  countryCode?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  sourceCode?: string;
  observedAt?: string;
  sourceStatus?: string;
  tvaRate?: number;
  /**
   * Link the imported row was read from (scraper / supplier catalogue). Stored
   * inside the existing `notes` JSON metadata — ADDITIVE key only, no schema
   * change, and nothing reads it back yet, so old prices are unaffected.
   */
  sourceUrl?: string;
}, tx?: any) {
  // Phase A — optional explicit transaction handle (see upsertMaterialByCode).
  // With a transaction the bulk import is atomic; without one the behaviour
  // is identical to the pre-Phase-A single-item upsert.
  const db = tx || (await getDatabase());
  if (!db) throw new Error('Database not available');

  // Resolve material by legacy code (official = company_id IS NULL)
  const [mat] = await db.select().from(materials)
    .where(and(eq(materials.code, data.materialCode), isNull(materials.companyId)))
    .limit(1);
  if (!mat) throw new Error(`Official material '${data.materialCode}' not found`);

  const sourceCode = data.sourceCode || 'OFFICIAL_DEFAULT';
  await ensurePriceSourceExists(db, sourceCode);
  const status = String(data.sourceStatus || 'active').toLowerCase();
  const reviewStatus = status === 'pending' ? 'pending'
    : status === 'reviewed' ? 'reviewed'
    : status === 'rejected' || status === 'inactive' ? 'rejected'
    : 'published';
  const isCurrent = reviewStatus === 'published';
  const importMetadata = JSON.stringify({
    sourceStatus: data.sourceStatus || 'active',
    observedAt: data.observedAt || null,
    tvaRate: data.tvaRate ?? null,
    sourceUrl: data.sourceUrl || null,
  });

  const existing = await db.select().from(materialPrices).where(and(
    eq(materialPrices.materialId, mat.id),
    eq(materialPrices.sourceCode, sourceCode),
    eq(materialPrices.countryCode, data.countryCode || 'TN'),
    isNull(materialPrices.companyId),
  )).limit(1);

  const values = {
    unitPrice: String(data.price),
    currencyCode: data.currencyCode || 'TND',
    countryCode: data.countryCode || 'TN',
    effectiveFrom: data.effectiveFrom || new Date().toISOString().slice(0, 10),
    effectiveTo: data.effectiveTo || null,
    reviewStatus,
    isCurrent,
    notes: importMetadata,
    updatedAt: new Date(),
  };

  if (existing[0]) {
    const [updated] = await db.update(materialPrices).set(values)
      .where(eq(materialPrices.id, existing[0].id)).returning();
    return normalizePriceRow(updated);
  }

  const [inserted] = await db.insert(materialPrices).values({
    materialId: mat.id,
    sourceCode,
    companyId: null,
    ...values,
  }).returning();
  return normalizePriceRow(inserted);
}

export async function getCurrentPrice(materialId: string, currency = 'TND', market = 'tn') {
  const db = await getDatabase();
  if (!db) return undefined;
  // Step 2 — market comparison is CASE-INSENSITIVE (`tn` matches 'TN') and the
  // single current row is selected deterministically: newest effective_from
  // first, then newest updated_at (previously limit(1) was unordered/arbitrary
  // when several is_current rows exist for the same material).
  // Existing business logic preserved unchanged: is_current = true filter.
  const res = await db.select().from(materialPrices)
    .where(and(
      eq(materialPrices.materialId, materialId),
      eq(materialPrices.isCurrent, true),
      eq(materialPrices.currencyCode, currency),
      sql`upper(${materialPrices.countryCode}) = upper(${market})`,
    ))
    .orderBy(desc(materialPrices.effectiveFrom), desc(materialPrices.updatedAt))
    .limit(1);
  return res[0] ? normalizePriceRow(res[0]) : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 8 — Multi-Market Price Update Foundation (Pending → Admin Review → Official).
// NO schema change: `material_prices` already carries everything needed.
//   - source_code  = semantic status (SUPPLIER_SUBMITTED = pending;
//                    SUPPLIER_APPROVED / OFFICIAL_DEFAULT = approved / official)
//   - is_current   = whether a row is the LIVE official price
//   - country_code / currency_code / supplier_id / effective_from / effective_to
//     / notes / created_at (Observed At = when the update arrived) / company_id
// A pending row is inserted with source='SUPPLIER_SUBMITTED' AND is_current=FALSE
// AND company_id IS NULL, so it is invisible to the public prices endpoint
// (also filtered above) and never displaces the official price. Approving
// updates THE SAME row in place and — within that material + market + currency
// only — de-currents any other official row. Company-specific prices are never
// read or touched. FR can never change TN; EUR never mixes with TND.
// ─────────────────────────────────────────────────────────────────────────────

export async function submitPendingPriceUpdate(data: {
  materialCode: string;
  price: number;
  currencyCode?: string;
  countryCode?: string;
  supplierId?: string;
  effectiveFrom?: string;
  notes?: string;
}) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');

  const [mat] = await db.select().from(materials)
    .where(and(eq(materials.code, data.materialCode), isNull(materials.companyId)))
    .limit(1);
  if (!mat) throw new Error(`Official material '${data.materialCode}' not found`);

  const countryCode = data.countryCode || 'TN';
  const currencyCode = data.currencyCode || 'TND';
  const effectiveFrom = data.effectiveFrom || new Date().toISOString().slice(0, 10);

  // Hardening for external scheduler retry / partial-success replays:
  // pending dedupe must be scoped to the exact business identity of the update,
  // not just material+market+currency. Replays with the same source/material/
  // market/currency/effective date must update the same pending row in place,
  // while a different effective date is treated as a distinct update.
  const existing = await db.select().from(materialPrices).where(and(
    eq(materialPrices.materialId, mat.id),
    eq(materialPrices.sourceCode, 'SUPPLIER_SUBMITTED'),
    eq(materialPrices.countryCode, countryCode),
    eq(materialPrices.currencyCode, currencyCode),
    eq(materialPrices.effectiveFrom, effectiveFrom),
    eq(materialPrices.isCurrent, false),
    isNull(materialPrices.companyId),
    eq(materialPrices.isDeleted, false),
  )).limit(1);

  const values = {
    unitPrice: String(data.price),
    currencyCode,
    countryCode,
    effectiveFrom,
    supplierId: data.supplierId || null,
    notes: data.notes || null,
    reviewStatus: 'pending',
    reviewedBy: null,
    reviewedAt: null,
    publishedBy: null,
    publishedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    updatedAt: new Date(),
  };

  if (existing[0]) {
    const [updated] = await db.update(materialPrices).set(values)
      .where(eq(materialPrices.id, existing[0].id)).returning();
    return normalizePriceRow(updated);
  }

  const [inserted] = await db.insert(materialPrices).values({
    materialId: mat.id,
    sourceCode: 'SUPPLIER_SUBMITTED',
    companyId: null,
    reviewStatus: 'pending',
    isCurrent: false,
    isDeleted: false,
    version: 1,
    ...values,
  }).returning();
  return normalizePriceRow(inserted);
}

export async function listPriceReviewQueue(filters?: {
  status?: 'pending' | 'reviewed' | 'published' | 'rejected';
  countryCode?: string;
  currencyCode?: string;
}) {
  const db = await getDatabase();
  if (!db) return { data: [], total: 0 };
  const conditions: any[] = [
    eq(materialPrices.isDeleted, false),
    isNull(materialPrices.companyId),
  ];
  if (filters?.status) conditions.push(eq(materialPrices.reviewStatus, filters.status));
  if (filters?.countryCode) conditions.push(eq(materialPrices.countryCode, filters.countryCode));
  if (filters?.currencyCode) conditions.push(eq(materialPrices.currencyCode, filters.currencyCode));
  const rows = await db.select({
    id: materialPrices.id,
    materialId: materialPrices.materialId,
    code: materials.code,
    price: materialPrices.unitPrice,
    currency: materialPrices.currencyCode,
    market: materialPrices.countryCode,
    countryCode: materialPrices.countryCode,
    source: materialPrices.sourceCode,
    supplierId: materialPrices.supplierId,
    reviewStatus: materialPrices.reviewStatus,
    reviewedBy: materialPrices.reviewedBy,
    reviewedAt: materialPrices.reviewedAt,
    publishedBy: materialPrices.publishedBy,
    publishedAt: materialPrices.publishedAt,
    rejectedBy: materialPrices.rejectedBy,
    rejectedAt: materialPrices.rejectedAt,
    rejectionReason: materialPrices.rejectionReason,
    isCurrent: materialPrices.isCurrent,
    effectiveFrom: materialPrices.effectiveFrom,
    effectiveTo: materialPrices.effectiveTo,
    notes: materialPrices.notes,
    createdAt: materialPrices.createdAt,
    updatedAt: materialPrices.updatedAt,
  }).from(materialPrices)
    .innerJoin(materials, eq(materials.id, materialPrices.materialId))
    .where(and(...conditions))
    .orderBy(desc(materialPrices.updatedAt));
  return { data: rows.map(normalizePriceRow), total: rows.length };
}

export async function listPendingPriceUpdates(filters?: { countryCode?: string; currencyCode?: string }) {
  return listPriceReviewQueue({ status: 'pending', ...filters });
}

export async function reviewPendingPriceUpdate(priceId: string, actorUserId?: string) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');

  const [row] = await db.select().from(materialPrices).where(and(
    eq(materialPrices.id, priceId),
    eq(materialPrices.isDeleted, false),
    isNull(materialPrices.companyId),
  )).limit(1);
  if (!row) throw new Error(`Price update '${priceId}' not found`);
  if (row.reviewStatus === 'published') throw new Error('Published prices do not need review');
  if (row.reviewStatus === 'rejected') throw new Error('Rejected prices cannot be reviewed again');

  const [updated] = await db.update(materialPrices).set({
    reviewStatus: 'reviewed',
    reviewedBy: actorUserId ?? row.reviewedBy ?? null,
    reviewedAt: new Date(),
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    updatedAt: new Date(),
  }).where(eq(materialPrices.id, priceId)).returning();
  return normalizePriceRow(updated);
}

export async function rejectPriceUpdate(priceId: string, reason: string, actorUserId?: string) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');

  const [row] = await db.select().from(materialPrices).where(and(
    eq(materialPrices.id, priceId),
    eq(materialPrices.isDeleted, false),
    isNull(materialPrices.companyId),
  )).limit(1);
  if (!row) throw new Error(`Price update '${priceId}' not found`);
  if (row.reviewStatus === 'published') throw new Error('Published prices cannot be rejected');

  const [updated] = await db.update(materialPrices).set({
    reviewStatus: 'rejected',
    rejectedBy: actorUserId ?? null,
    rejectedAt: new Date(),
    rejectionReason: reason || 'No reason provided',
    isCurrent: false,
    publishedBy: null,
    publishedAt: null,
    updatedAt: new Date(),
  }).where(eq(materialPrices.id, priceId)).returning();
  return normalizePriceRow(updated);
}

export async function publishPriceUpdate(priceId: string, actorUserId?: string) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');

  const [pending] = await db.select().from(materialPrices).where(and(
    eq(materialPrices.id, priceId),
    eq(materialPrices.isDeleted, false),
    isNull(materialPrices.companyId),
  )).limit(1);
  if (!pending) throw new Error(`Price update '${priceId}' not found`);
  if (pending.reviewStatus === 'rejected') throw new Error('Rejected prices cannot be published');
  if (pending.reviewStatus === 'pending') throw new Error('Price must be reviewed before publication');

  const today = new Date().toISOString().slice(0, 10);

  await db.update(materialPrices).set({ isCurrent: false, updatedAt: new Date() })
    .where(and(
      eq(materialPrices.materialId, pending.materialId),
      eq(materialPrices.countryCode, pending.countryCode),
      eq(materialPrices.currencyCode, pending.currencyCode),
      eq(materialPrices.isCurrent, true),
      ne(materialPrices.sourceCode, 'SUPPLIER_SUBMITTED'),
      isNull(materialPrices.companyId),
      ne(materialPrices.id, priceId),
    ));

  const [published] = await db.update(materialPrices).set({
    sourceCode: 'SUPPLIER_APPROVED',
    reviewStatus: 'published',
    reviewedBy: pending.reviewedBy ?? actorUserId ?? null,
    reviewedAt: pending.reviewedAt ?? new Date(),
    publishedBy: actorUserId ?? null,
    publishedAt: new Date(),
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    isCurrent: true,
    effectiveFrom: today,
    updatedAt: new Date(),
  }).where(eq(materialPrices.id, priceId)).returning();
  return normalizePriceRow(published);
}

export async function approvePendingPriceUpdate(priceId: string, actorUserId?: string) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');

  const [pending] = await db.select().from(materialPrices).where(and(
    eq(materialPrices.id, priceId),
    eq(materialPrices.sourceCode, 'SUPPLIER_SUBMITTED'),
    eq(materialPrices.isDeleted, false),
    isNull(materialPrices.companyId),
  )).limit(1);
  if (!pending) throw new Error(`Pending price update '${priceId}' not found`);

  if (pending.reviewStatus === 'pending') {
    const reviewed = await reviewPendingPriceUpdate(priceId, actorUserId);
    return publishPriceUpdate(priceId, actorUserId || reviewed.reviewedBy || undefined);
  }
  if (pending.reviewStatus === 'rejected') throw new Error('Rejected prices cannot be published');
  return publishPriceUpdate(priceId, actorUserId);
}
