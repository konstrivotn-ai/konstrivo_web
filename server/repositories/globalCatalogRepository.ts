// @ts-nocheck
import { getDatabase } from '../db/client';
import {
  globalProducts,
  globalProductIdentifiers,
  materialGlobalProductLinks,
  globalProductCountryAvailability,
  catalogSources,
  catalogImports,
  catalogImportItems,
  materials,
  materialPrices,
  suppliers,
} from '../db/schema';
import { and, desc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { isValidUuid } from '../utils/validation';
import { badRequest, conflict } from '../utils/errors';
import {
  normalizeCountryCode,
  normalizeIdentifierType,
  normalizeIdentifierValue,
  clampConfidence,
  STRONG_IDENTIFIER_TYPES,
} from '../services/globalCatalogValidation';

export type IdentifierType =
  | 'gtin'
  | 'ean'
  | 'upc'
  | 'sku'
  | 'manufacturer_ref'
  | 'model'
  | 'supplier_ref'
  | 'other';

export type ImportMatchStatus =
  | 'new'
  | 'matched'
  | 'possible_match'
  | 'review_required'
  | 'approved'
  | 'rejected';

export type GlobalProductInput = {
  name: string;
  brand?: string | null;
  manufacturer?: string | null;
  category?: string | null;
  subcategory?: string | null;
  description?: string | null;
  specification?: string | null;
  unit?: string | null;
  model?: string | null;
  sku?: string | null;
  status?: string | null;
  media?: any[];
  extra?: any;
};

export type GlobalIdentifierInput = {
  identifierType: IdentifierType;
  identifierValue: string;
  supplierId?: string | null;
  confidence?: number | null;
  source?: string | null;
};

export type AvailabilityInput = {
  countryCode: string;
  isAvailable: boolean;
  localName?: string | null;
  localReference?: string | null;
  localSpecification?: string | null;
  localUnit?: string | null;
  observedAt?: string | null;
  catalogSourceId?: string | null;
  sourceRef?: string | null;
};

function pickNonEmptyPatch<T extends Record<string, any>>(incoming: T): Partial<T> {
  const out: any = {};
  for (const [k, v] of Object.entries(incoming || {})) {
    if (v === undefined) continue;
    if (v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = v;
  }
  return out;
}

export async function createGlobalProduct(data: GlobalProductInput, tx?: any) {
  const db = tx || (await getDatabase());
  if (!db) throw new Error('Database not available');
  const [row] = await db
    .insert(globalProducts)
    .values({
      name: String(data.name).trim(),
      brand: data.brand ?? null,
      manufacturer: data.manufacturer ?? null,
      category: data.category ?? null,
      subcategory: data.subcategory ?? null,
      description: data.description ?? null,
      specification: data.specification ?? null,
      unit: data.unit ?? null,
      model: data.model ?? null,
      sku: data.sku ?? null,
      status: data.status ?? 'active',
      media: (data.media ?? []),
      extra: (data.extra ?? {}),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return row;
}

export async function updateGlobalProduct(id: string, patch: Partial<GlobalProductInput>) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');
  if (!isValidUuid(id)) return undefined;
  const [row] = await db
    .update(globalProducts)
    .set({
      ...(patch.name !== undefined ? { name: String(patch.name).trim() } : {}),
      ...(patch.brand !== undefined ? { brand: patch.brand ?? null } : {}),
      ...(patch.manufacturer !== undefined ? { manufacturer: patch.manufacturer ?? null } : {}),
      ...(patch.category !== undefined ? { category: patch.category ?? null } : {}),
      ...(patch.subcategory !== undefined ? { subcategory: patch.subcategory ?? null } : {}),
      ...(patch.description !== undefined ? { description: patch.description ?? null } : {}),
      ...(patch.specification !== undefined ? { specification: patch.specification ?? null } : {}),
      ...(patch.unit !== undefined ? { unit: patch.unit ?? null } : {}),
      ...(patch.model !== undefined ? { model: patch.model ?? null } : {}),
      ...(patch.sku !== undefined ? { sku: patch.sku ?? null } : {}),
      ...(patch.status !== undefined ? { status: patch.status ?? 'active' } : {}),
      ...(patch.media !== undefined ? { media: (patch.media ?? []) } : {}),
      ...(patch.extra !== undefined ? { extra: (patch.extra ?? {}) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(globalProducts.id, id))
    .returning();
  return row;
}

export async function getGlobalProductById(id: string) {
  const db = await getDatabase();
  if (!db) return undefined;
  if (!isValidUuid(id)) return undefined;
  const rows = await db.select().from(globalProducts).where(eq(globalProducts.id, id)).limit(1);
  return rows[0];
}

export async function listGlobalProducts(opts: { search?: string; page?: number; limit?: number } = {}) {
  const db = await getDatabase();
  if (!db) return { data: [], page: 1, limit: 20, total: 0 };
  const page = Math.max(1, Number(opts.page || 1));
  const limit = Math.max(1, Math.min(100, Number(opts.limit || 20)));
  const search = (opts.search || '').trim();

  const where = search
    ? sql`(${globalProducts.name} ILIKE ${`%${search}%`} OR ${globalProducts.brand} ILIKE ${`%${search}%`} OR ${globalProducts.manufacturer} ILIKE ${`%${search}%`})`
    : undefined;

  const offset = (page - 1) * limit;
  const totalRows = where
    ? await db.select({ count: sql`count(*)` }).from(globalProducts).where(where)
    : await db.select({ count: sql`count(*)` }).from(globalProducts);
  const total = Number(totalRows?.[0]?.count || 0);

  const data = where
    ? await db.select().from(globalProducts).where(where).orderBy(globalProducts.createdAt).limit(limit).offset(offset)
    : await db.select().from(globalProducts).orderBy(globalProducts.createdAt).limit(limit).offset(offset);

  return { data, page, limit, total };
}

/**
 * SAFE matching: strong identifier exact-match only.
 * - If the identifier is already bound to a global product, returns it.
 * - If not bound, returns null.
 * - Never merges by name similarity.
 */
export async function findGlobalProductByStrongIdentifier(identifierType: IdentifierType, identifierValue: string) {
  // Backwards-compatible wrapper: strong types match globally.
  return findGlobalProductByIdentifier(identifierType, identifierValue, { supplierId: null });
}

/**
 * Hardening: identifier matching respects scoping rules.
 * - strong types (gtin/ean/upc): global match.
 * - weak types (sku/supplier_ref/model/...): require supplierId to match.
 */
export async function findGlobalProductByIdentifier(
  identifierType: IdentifierType,
  identifierValue: string,
  opts: { supplierId?: string | null } = {},
) {
  const db = await getDatabase();
  if (!db) return null;
  const t = normalizeIdentifierType(identifierType);
  const v = normalizeIdentifierValue(identifierValue);
  if (!t || !v) return null;

  if (STRONG_IDENTIFIER_TYPES.has(t)) {
    const rows = await db
      .select({ globalProductId: globalProductIdentifiers.globalProductId })
      .from(globalProductIdentifiers)
      .where(and(eq(globalProductIdentifiers.identifierType, t), eq(globalProductIdentifiers.identifierValue, v)))
      .limit(1);
    return rows?.[0]?.globalProductId || null;
  }

  const supplierId = opts.supplierId && isValidUuid(opts.supplierId) ? opts.supplierId : null;
  if (!supplierId) return null; // unsafe to match weak IDs without scope
  const rows = await db
    .select({ globalProductId: globalProductIdentifiers.globalProductId })
    .from(globalProductIdentifiers)
    .where(and(
      eq(globalProductIdentifiers.identifierType, t),
      eq(globalProductIdentifiers.identifierValue, v),
      eq(globalProductIdentifiers.supplierId, supplierId),
    ))
    .limit(1);
  return rows?.[0]?.globalProductId || null;
}

export async function upsertGlobalIdentifier(args: { globalProductId: string } & GlobalIdentifierInput, tx?: any) {
  const db = tx || (await getDatabase());
  if (!db) throw new Error('Database not available');
  if (!isValidUuid(args.globalProductId)) throw new Error('Invalid globalProductId');
  const identifierType = normalizeIdentifierType(args.identifierType);
  const identifierValue = normalizeIdentifierValue(args.identifierValue);
  if (!identifierType || !identifierValue) throw new Error('Invalid identifier');
  const confidence = clampConfidence(args.confidence, 100);
  const supplierId = args.supplierId && isValidUuid(args.supplierId) ? args.supplierId : null;

  const where = STRONG_IDENTIFIER_TYPES.has(identifierType)
    ? and(eq(globalProductIdentifiers.identifierType, identifierType), eq(globalProductIdentifiers.identifierValue, identifierValue))
    : and(
        eq(globalProductIdentifiers.identifierType, identifierType),
        eq(globalProductIdentifiers.identifierValue, identifierValue),
        supplierId ? eq(globalProductIdentifiers.supplierId, supplierId) : isNull(globalProductIdentifiers.supplierId),
      );

  const existing = await db.select().from(globalProductIdentifiers).where(where).limit(1);

  if (existing[0]) {
    // If already bound to the same product, do nothing; otherwise refuse.
    if (existing[0].globalProductId !== args.globalProductId) {
      throw new Error(`Identifier already linked to another global product`);
    }
    return existing[0];
  }

  const [row] = await db
    .insert(globalProductIdentifiers)
    .values({
      globalProductId: args.globalProductId,
      identifierType,
      identifierValue,
      supplierId,
      confidence,
      source: args.source ?? 'manual',
      createdAt: new Date(),
    })
    .returning();
  return row;
}

export async function linkMaterialToGlobalProduct(args: {
  materialId: string;
  globalProductId: string;
  linkSource?: string;
  status?: 'proposed' | 'approved' | 'rejected';
  confidence?: number;
  notes?: string | null;
  forceReassign?: boolean;
}, tx?: any) {
  const db = tx || (await getDatabase());
  if (!db) throw new Error('Database not available');
  if (!isValidUuid(args.materialId)) throw new Error('Invalid materialId');
  if (!isValidUuid(args.globalProductId)) throw new Error('Invalid globalProductId');

  const existing = await db
    .select()
    .from(materialGlobalProductLinks)
    .where(eq(materialGlobalProductLinks.materialId, args.materialId))
    .limit(1);

  if (existing[0]) {
    const current = existing[0];
    if (
      current.globalProductId &&
      current.globalProductId !== args.globalProductId &&
      String(current.status || 'approved') === 'approved' &&
      !args.forceReassign
    ) {
      throw new Error('Material is already linked to a different global product');
    }
    const [row] = await db
      .update(materialGlobalProductLinks)
      .set({
        globalProductId: args.globalProductId,
        linkSource: args.linkSource ?? existing[0].linkSource ?? 'manual',
        status: args.status ?? existing[0].status ?? 'approved',
        confidence: clampConfidence(args.confidence, existing[0].confidence ?? 100),
        notes: args.notes ?? existing[0].notes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(materialGlobalProductLinks.id, existing[0].id))
      .returning();
    return row;
  }

  const [row] = await db
    .insert(materialGlobalProductLinks)
    .values({
      materialId: args.materialId,
      globalProductId: args.globalProductId,
      linkSource: args.linkSource ?? 'manual',
      status: args.status ?? 'approved',
      confidence: clampConfidence(args.confidence, 100),
      notes: args.notes ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return row;
}

export async function setGlobalProductAvailability(args: { globalProductId: string } & AvailabilityInput, tx?: any) {
  const db = tx || (await getDatabase());
  if (!db) throw new Error('Database not available');
  if (!isValidUuid(args.globalProductId)) throw new Error('Invalid globalProductId');
  const countryCode = normalizeCountryCode(args.countryCode);
  if (!countryCode) throw new Error('Invalid countryCode');

  const existing = await db
    .select()
    .from(globalProductCountryAvailability)
    .where(and(eq(globalProductCountryAvailability.globalProductId, args.globalProductId), eq(globalProductCountryAvailability.countryCode, countryCode)))
    .limit(1);

  if (existing[0]) {
    const [row] = await db
      .update(globalProductCountryAvailability)
      .set({
        isAvailable: !!args.isAvailable,
        localName: args.localName ?? null,
        localReference: args.localReference ?? null,
        localSpecification: args.localSpecification ?? null,
        localUnit: args.localUnit ?? null,
        observedAt: args.observedAt ? new Date(args.observedAt) : existing[0].observedAt,
        catalogSourceId: args.catalogSourceId && isValidUuid(args.catalogSourceId) ? args.catalogSourceId : existing[0].catalogSourceId,
        sourceRef: args.sourceRef ?? null,
        updatedAt: new Date(),
      })
      .where(eq(globalProductCountryAvailability.id, existing[0].id))
      .returning();
    return row;
  }

  const [row] = await db
    .insert(globalProductCountryAvailability)
    .values({
      globalProductId: args.globalProductId,
      countryCode,
      isAvailable: !!args.isAvailable,
      localName: args.localName ?? null,
      localReference: args.localReference ?? null,
      localSpecification: args.localSpecification ?? null,
      localUnit: args.localUnit ?? null,
      observedAt: args.observedAt ? new Date(args.observedAt) : null,
      catalogSourceId: args.catalogSourceId && isValidUuid(args.catalogSourceId) ? args.catalogSourceId : null,
      sourceRef: args.sourceRef ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return row;
}

/** Apply safe non-empty patch updates to an existing global product. */
export async function safePatchGlobalProduct(globalProductId: string, incoming: Partial<GlobalProductInput>, tx?: any) {
  const db = tx || (await getDatabase());
  if (!db) throw new Error('Database not available');
  if (!isValidUuid(globalProductId)) throw new Error('Invalid globalProductId');
  const patch = pickNonEmptyPatch(incoming as any);
  if (Object.keys(patch).length === 0) return null;
  const [row] = await db.update(globalProducts).set({ ...patch, updatedAt: new Date() }).where(eq(globalProducts.id, globalProductId)).returning();
  return row;
}

export async function ensureCatalogSource(args: {
  name: string;
  sourceType: string;
  countryCode?: string | null;
  provider?: string | null;
  url?: string | null;
  configuration?: any;
}, tx?: any) {
  const db = tx || (await getDatabase());
  if (!db) throw new Error('Database not available');
  const name = String(args.name || '').trim();
  const sourceType = String(args.sourceType || '').trim();
  if (!name || !sourceType) throw new Error('Missing source name/type');

  // Conservative: treat (name, sourceType, countryCode) as identity.
  const existing = await db
    .select()
    .from(catalogSources)
    .where(and(
      eq(catalogSources.name, name),
      eq(catalogSources.sourceType, sourceType),
      args.countryCode ? eq(catalogSources.countryCode, String(args.countryCode).toUpperCase()) : sql`${catalogSources.countryCode} IS NULL`
    ))
    .limit(1);

  if (existing[0]) return existing[0];

  const [row] = await db
    .insert(catalogSources)
    .values({
      name,
      sourceType,
      countryCode: args.countryCode ? String(args.countryCode).toUpperCase() : null,
      provider: args.provider ?? null,
      url: args.url ?? null,
      status: 'active',
      configuration: (args.configuration ?? {}),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return row;
}

export async function createImportRun(args: {
  sourceId?: string | null;
  countryCode?: string | null;
  fileName?: string | null;
  fileSha256?: string | null;
  fileMimeType?: string | null;
  createdByUserId?: string | null;
}, tx?: any) {
  const db = tx || (await getDatabase());
  if (!db) throw new Error('Database not available');
  const [row] = await db
    .insert(catalogImports)
    .values({
      sourceId: args.sourceId ?? null,
      countryCode: args.countryCode ? String(args.countryCode).toUpperCase() : null,
      fileName: args.fileName ?? null,
      fileSha256: args.fileSha256 ?? null,
      fileMimeType: args.fileMimeType ?? null,
      importStatus: 'UPLOADED',
      itemsCount: 0,
      importedCount: 0,
      updatedCount: 0,
      rejectedCount: 0,
      errorSummary: null,
      createdByUserId: args.createdByUserId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return row;
}

export async function insertImportItems(importId: string, items: any[], tx?: any) {
  const db = tx || (await getDatabase());
  if (!db) throw new Error('Database not available');
  if (!isValidUuid(importId)) throw new Error('Invalid importId');
  if (!Array.isArray(items) || items.length === 0) return [];
  const values = items.map((it, idx) => ({
    importId,
    sourceRow: Number.isFinite(it.sourceRow) ? it.sourceRow : (idx + 1),
    countryCode: it.countryCode ? String(it.countryCode).toUpperCase() : null,
    raw: (it.raw ?? {}),
    normalized: (it.normalized ?? {}),
    matchStatus: it.matchStatus ?? 'new',
    matchedGlobalProductId: it.matchedGlobalProductId ?? null,
    matchedMaterialId: it.matchedMaterialId ?? null,
    confidence: it.confidence ?? 0,
    notes: it.notes ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  const rows = await db.insert(catalogImportItems).values(values).returning();
  return rows;
}

/** csv | xlsx derived from the stored file name (fallback: mime type). */
function resolveCatalogImportFileType(fileName?: string | null, mimeType?: string | null): string | null {
  const lower = String(fileName || '').trim().toLowerCase();
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.csv')) return 'csv';
  const mime = String(mimeType || '').trim().toLowerCase();
  if (mime.includes('spreadsheet') || mime.includes('sheet')) return 'xlsx';
  if (mime.includes('csv')) return 'csv';
  return null;
}

export type CatalogImportRunSummary = {
  importId: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  fileName: string | null;
  sourceId: string | null;
  sourceName: string | null;
  sourceType: string | null;
  fileType: string | null;
  fileMimeType: string | null;
  fileSha256: string | null;
  countryCode: string | null;
  status: string;
  /** items_count of the run (falls back to the number of staged rows). */
  total: number;
  valid: number;
  invalid: number;
  matched: number;
  review: number;
  new: number;
  approved: number;
  imported: number;
  updated: number;
  rejected: number;
  errorSummary: string | null;
};

/**
 * Admin — Import History (READ-ONLY).
 *
 * Lists the EXISTING `catalog_imports` runs (newest first), joined with their
 * source label, plus a per-matchStatus breakdown of the staged
 * `catalog_import_items`. Nothing is written and no schema/table is added.
 *
 * Count semantics — derived ONLY from the existing rows/columns:
 * - total    : `catalog_imports.items_count` (falls back to the staged row count)
 * - matched  : staged items with matchStatus `matched`
 * - review   : staged items with matchStatus `review_required` | `possible_match`
 * - new      : staged items with matchStatus `new`
 * - approved : staged items with matchStatus `approved`
 * - invalid  : staged items with matchStatus `rejected` (rows commit marked as
 *              invalid, or rows rejected later during review)
 * - valid    : total − invalid (never negative)
 */
export async function listCatalogImports(
  opts: { limit?: number; offset?: number; status?: string | null } = {},
): Promise<{ data: CatalogImportRunSummary[]; limit: number; offset: number; total: number }> {
  const db = await getDatabase();
  const limit = Math.max(1, Math.min(200, Number(opts.limit) || 50));
  const offset = Math.max(0, Number(opts.offset) || 0);
  if (!db) return { data: [], limit, offset, total: 0 };

  const status = String(opts.status || '').trim();
  const where = status ? eq(catalogImports.importStatus, status) : undefined;

  const totalRows = where
    ? await db.select({ count: sql`count(*)` }).from(catalogImports).where(where)
    : await db.select({ count: sql`count(*)` }).from(catalogImports);
  const total = Number(totalRows?.[0]?.count || 0);

  const baseQuery = db
    .select({
      id: catalogImports.id,
      sourceId: catalogImports.sourceId,
      countryCode: catalogImports.countryCode,
      fileName: catalogImports.fileName,
      fileSha256: catalogImports.fileSha256,
      fileMimeType: catalogImports.fileMimeType,
      importStatus: catalogImports.importStatus,
      itemsCount: catalogImports.itemsCount,
      importedCount: catalogImports.importedCount,
      updatedCount: catalogImports.updatedCount,
      rejectedCount: catalogImports.rejectedCount,
      errorSummary: catalogImports.errorSummary,
      createdAt: catalogImports.createdAt,
      updatedAt: catalogImports.updatedAt,
      sourceName: catalogSources.name,
      sourceType: catalogSources.sourceType,
    })
    .from(catalogImports)
    .leftJoin(catalogSources, eq(catalogSources.id, catalogImports.sourceId));

  const rows = where
    ? await baseQuery.where(where).orderBy(desc(catalogImports.createdAt)).limit(limit).offset(offset)
    : await baseQuery.orderBy(desc(catalogImports.createdAt)).limit(limit).offset(offset);

  // Per-run matchStatus breakdown of the already staged items (one grouped query).
  const countsByImport = new Map<string, Map<string, number>>();
  const ids = rows.map((r: any) => String(r?.id || '')).filter((id: string) => !!id);

  if (ids.length) {
    const grouped = await db
      .select({
        importId: catalogImportItems.importId,
        matchStatus: catalogImportItems.matchStatus,
        count: sql`count(*)`,
      })
      .from(catalogImportItems)
      .where(inArray(catalogImportItems.importId, ids))
      .groupBy(catalogImportItems.importId, catalogImportItems.matchStatus);

    for (const g of grouped as any[]) {
      const key = String(g?.importId || '');
      if (!key) continue;
      if (!countsByImport.has(key)) countsByImport.set(key, new Map<string, number>());
      countsByImport.get(key)!.set(String(g?.matchStatus || 'new'), Number(g?.count || 0));
    }
  }

  const data: CatalogImportRunSummary[] = rows.map((row: any) => {
    const counts = countsByImport.get(String(row.id)) || new Map<string, number>();
    const countOf = (key: string) => Number(counts.get(key) || 0);
    const stagedTotal = Array.from(counts.values()).reduce((sum, n) => sum + Number(n || 0), 0);

    const matched = countOf('matched');
    const review = countOf('review_required') + countOf('possible_match');
    const createdNew = countOf('new');
    const approved = countOf('approved');
    const invalid = countOf('rejected');
    const runTotal = Number(row.itemsCount || 0) || stagedTotal;

    return {
      importId: String(row.id),
      createdAt: row.createdAt ?? null,
      updatedAt: row.updatedAt ?? null,
      fileName: row.fileName ?? null,
      sourceId: row.sourceId ?? null,
      sourceName: row.sourceName ?? null,
      sourceType: row.sourceType ?? null,
      fileType: resolveCatalogImportFileType(row.fileName, row.fileMimeType),
      fileMimeType: row.fileMimeType ?? null,
      fileSha256: row.fileSha256 ?? null,
      countryCode: row.countryCode ?? null,
      status: String(row.importStatus || 'UPLOADED'),
      total: runTotal,
      valid: Math.max(0, runTotal - invalid),
      invalid,
      matched,
      review,
      new: createdNew,
      approved,
      imported: Number(row.importedCount || 0),
      updated: Number(row.updatedCount || 0),
      rejected: Number(row.rejectedCount || 0),
      errorSummary: row.errorSummary ?? null,
    };
  });

  return { data, limit, offset, total };
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin — Catalog Sources Management (catalog_sources)
//
// SAFETY: this block ONLY reads/creates/updates `catalog_sources` rows.
// - It never starts an import or a sync (no `catalog_imports` write, no job).
// - `catalog_sources` has NO unique constraint in the database (migration
//   0016/0017 add only indexes + the `country_code` FK → `countries(code)`),
//   so duplicates are prevented HERE with the SAME identity `ensureCatalogSource`
//   uses (name + source_type + country_code) — which also guarantees the import
//   path can never create a second row for an admin-created source.
// - `ensureCatalogSource` (used by import commit) is left byte-identical.
// ─────────────────────────────────────────────────────────────────────────────

/** Types documented on `catalog_sources.source_type` (existing values stay valid). */
export const CATALOG_SOURCE_TYPES = [
  'api',
  'csv',
  'xlsx',
  'pdf',
  'manual',
  'supplier_catalog',
  'manufacturer_catalog',
];

/** Statuses accepted by the admin API (`active` = enabled, `inactive` = disabled). */
export const CATALOG_SOURCE_STATUSES = ['active', 'inactive'];

/** @deprecated UI-only: the subset offered in the selectors (CSV / XLSX / API). */
export const CATALOG_SOURCE_UI_TYPES = ['csv', 'xlsx', 'api'];

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — API Source Configuration (`catalog_sources.configuration.api`)
//
// SCOPE (explicitly limited): store the CONNECTION SETTINGS of an API source.
//   YES: base URL / endpoint, authentication type, HTTP header NAMES,
//        API-key REFERENCE, response format.
//   NO : no request is ever sent to the source, no Test Connection,
//        no mapping engine, no sync/scheduler, no schema change.
//
// SECURITY — read before changing anything here:
//   This codebase has NO secrets abstraction (no vault, no encryption, no
//   secret table — only plain `process.env` read in `server/config.ts`), so a
//   new secrets system is deliberately NOT introduced in this phase.
//   This shape therefore only ever holds NON-SENSITIVE REFERENCES:
//     • `credentialRef` = the NAME of an environment variable / secret-store
//                         entry (`MY_SOURCE_API_KEY`), never the value;
//     • `headerNames`   = HTTP header NAMES only (`X-Api-Version`), never a
//                         value, so a credential cannot be smuggled in.
//   Two hard guards enforce that:
//     1. the KEY ALLOW-LIST rejects any undocumented field, so `apiKey`,
//        `token`, `password`, `secret` can never be persisted;
//     2. every string field must match a strict pattern that a real
//        credential (`Bearer abc.def`, `sk-live-...`, `user:pass`) cannot.
//   NOTE: a `mapping` placeholder is intentionally ABSENT — no mapping key has
//   ever existed under `configuration`, so none is invented in this phase.
// ─────────────────────────────────────────────────────────────────────────────

/** `configuration.api.authType` — the documented values for an API source. */
export const CATALOG_SOURCE_API_AUTH_TYPES = [
  'none',
  'api_key',
  'bearer_token',
  'basic_auth',
];

/** `configuration.api.credentialLocation` — only meaningful for `api_key`. */
export const CATALOG_SOURCE_API_CREDENTIAL_LOCATIONS = ['header', 'query'];

/** `configuration.api.responseFormat` — how the source answers. */
export const CATALOG_SOURCE_API_RESPONSE_FORMATS = ['json', 'xml', 'csv'];

/** Connection settings stored under `catalog_sources.configuration.api`. */
export type CatalogSourceApiConfiguration = {
  /** Absolute http(s) endpoint of the feed (max 2000 chars). */
  baseUrl: string;
  authType: string;
  /** HTTP header NAMES to send — values are NEVER stored. */
  headerNames: string[];
  /** Env-var / secret-store NAME holding the credential — NEVER the value. */
  credentialRef: string | null;
  /** header | query (only for `api_key`). */
  credentialLocation: string;
  /** Header or query-parameter NAME receiving the credential. */
  credentialKey: string;
  /** Account name for `basic_auth` (a user id is not a secret). */
  username: string | null;
  responseFormat: string;
  /**
   * Phase 3 — optional. Absent on every Phase 1 row (backward compatible);
   * `mapping: null` in a payload simply removes it.
   */
  mapping?: CatalogSourceApiMapping;
};

/** The ONLY keys allowed under `configuration.api` (anything else -> 400). */
const CATALOG_SOURCE_API_KEYS = [
  'baseUrl',
  'authType',
  'headerNames',
  'credentialRef',
  'credentialLocation',
  'credentialKey',
  'username',
  'responseFormat',
  'mapping',
];

/**
 * RFC 7230 `token` — matches a header/parameter NAME.
 * Rejects `:`, `=`, spaces and every other separator, so it can never carry a
 * credential value.
 */
const HTTP_TOKEN_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/** Env-var / secret-reference name. */
const CREDENTIAL_REF_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** True when the value contains any ASCII control character (never allowed). */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 — API Response Mapping (`configuration.api.mapping`)
//
// SCOPE: a SAVED description of how an API response would be read. It is
//   - stored ONLY inside the existing `configuration` jsonb (no migration),
//   - validated on save, and
//   - used by NOTHING yet — no request, no import, no sync, no scheduler.
// The Phase 2 Test Connection probe and every Import path are untouched: this
// block is data, not behaviour. No credential and no response sample is ever
// stored alongside it.
//
// SHAPE (all three parts, per the phase spec):
//   root       — dot path from the document root to the object that holds the
//                product list ('' = document root)
//   collection — dot path (relative to `root`) of the product ARRAY
//                ('' = `root` itself is the array)
//   fields     — Global Catalog field key → dot path RELATIVE to ONE product
//
// The absolute address of a value is therefore `<root>.<collection>[].<field>`,
// e.g. root '' + collection 'products' + field 'name' → `products[].name`.
// For convenience an input already written that way is accepted and stored in
// the canonical (de-duplicated) relative form.
// ─────────────────────────────────────────────────────────────────────────────

export type CatalogSourceApiMapping = {
  /** Dot path to the object holding the collection. `''` = document root. */
  root: string;
  /** Dot path (relative to `root`) of the product array. `''` = root is it. */
  collection: string;
  /** Global Catalog field key → dot path relative to a single product. */
  fields: Record<string, string>;
};

export type CatalogSourceApiMappingField = {
  key: string;
  label: string;
  required: boolean;
};

/**
 * The ONLY Global Catalog fields this phase can map — exactly the "basic
 * fields" the phase spec lists, in that order. A second list must never
 * appear anywhere else (UI and server read THIS one).
 */
export const API_MAPPING_FIELDS: CatalogSourceApiMappingField[] = [
  { key: 'name', label: 'Nom du produit', required: true },
  { key: 'sku', label: 'SKU', required: false },
  { key: 'gtin', label: 'GTIN / EAN / UPC', required: false },
  { key: 'brand', label: 'Marque', required: false },
  { key: 'manufacturer', label: 'Fabricant', required: false },
  { key: 'category', label: 'Catégorie', required: false },
  { key: 'subcategory', label: 'Sous-catégorie', required: false },
  { key: 'unit', label: 'Unité', required: false },
  { key: 'description', label: 'Description', required: false },
  { key: 'price', label: 'Prix', required: false },
  { key: 'currency', label: 'Devise', required: false },
  { key: 'availability', label: 'Disponibilité', required: false },
];

/** Derived from `API_MAPPING_FIELDS` — one declaration only. */
export const API_MAPPING_FIELD_KEYS: string[] = API_MAPPING_FIELDS.map((f) => f.key);

/** Derived from `API_MAPPING_FIELDS` — the fields a mapping must contain. */
export const API_MAPPING_REQUIRED_FIELDS: string[] = API_MAPPING_FIELDS
  .filter((f) => f.required)
  .map((f) => f.key);

const API_MAPPING_MAX_LENGTH = 200;

/**
 * Dot-path syntax check. PURE.
 * Accepts `name`, `pricing.current`, `items[0].name`, unicode keys.
 * Refuses empty paths, whitespace, `..`, leading/trailing `.`, quotes,
 * backslashes and anything a dot-path reader could not address.
 */
export function isValidApiMappingPath(path: unknown): boolean {
  const value = String(path ?? '');
  if (!value) return false;
  if (value.length > API_MAPPING_MAX_LENGTH) return false;
  if (hasControlChars(value)) return false;
  if (/\s/.test(value)) return false;
  if (value.indexOf('..') !== -1) return false;
  if (value.charAt(0) === '.' || value.charAt(value.length - 1) === '.') return false;

  const segments = value.split('.');
  for (const segment of segments) {
    if (!segment) return false;
    const match = /^([^[\]]*)((?:\[\d+\])*)$/.exec(segment);
    if (!match) return false;
    const base = match[1];
    if (!base) return false; // `items[0]` needs a base name; `[]` alone is not a path
    if (/['"`\\]/.test(base)) return false;
  }
  return true;
}

/**
 * Absolute address of a mapped value: `<root>.<collection>[].<fieldPath>`.
 * root `''` + collection `products` + `name` → `products[].name`. PURE.
 * Used for the UI hint so the stored relative form is never ambiguous.
 */
export function describeApiMappingPath(
  root: unknown,
  collection: unknown,
  fieldPath: unknown,
): string {
  const segments = [String(root ?? '').trim(), String(collection ?? '').trim()].filter(Boolean);
  const prefix = segments.length ? `${segments.join('.')}[].` : '';
  return prefix + String(fieldPath ?? '').trim();
}

/**
 * Store field paths canonically: if the admin typed the ABSOLUTE address
 * (`products[].name`, `data.products[].name`), strip the collection prefix so
 * `fields` only ever holds the per-product form. PURE.
 */
function toRelativeFieldPath(root: string, collection: string, path: string): string {
  if (!collection) return path;
  const prefixes: string[] = [];
  if (root) prefixes.push(`${root}.${collection}[].`, `${root}[].`);
  prefixes.push(`${collection}[].`);
  for (const prefix of prefixes) {
    if (path.startsWith(prefix)) {
      const rest = path.slice(prefix.length);
      if (rest && isValidApiMappingPath(rest)) return rest;
    }
  }
  return path;
}

const API_MAPPING_OBJECT_MESSAGE = 'Mapping must be a JSON object';
const API_MAPPING_KEYS = ['root', 'collection', 'fields'];

function normalizeOptionalMappingPath(value: unknown, label: string): string {
  const path = String(value === undefined || value === null ? '' : value).trim();
  if (!path) return '';
  if (!isValidApiMappingPath(path)) {
    throw badRequest(`Mapping: invalid ${label} path "${path}"`);
  }
  return path;
}

/**
 * Normalize + validate `configuration.api.mapping`. PURE (no DB, no network).
 *
 * Accepts `fields` as an ARRAY of `{ field, path }` rows (the UI format, where
 * duplicates are possible and are therefore rejected) or as an OBJECT map
 * (already canonical). Always returns `{ root, collection, fields }` with
 * de-duplicated, lower-cased keys and per-product relative paths.
 *
 * Refuses: a non-object payload, unknown keys, unsupported Global Catalog
 * fields, DUPLICATE fields, empty/invalid paths, a mapping without any field,
 * and a mapping without the required product `name`.
 * Throws ApiError(400).
 */
export function normalizeCatalogSourceApiMapping(input: unknown): CatalogSourceApiMapping {
  if (input === null || input === undefined) throw badRequest(API_MAPPING_OBJECT_MESSAGE);
  if (typeof input !== 'object' || Array.isArray(input)) throw badRequest(API_MAPPING_OBJECT_MESSAGE);
  const src = input as Record<string, unknown>;

  for (const key of Object.keys(src)) {
    if (API_MAPPING_KEYS.indexOf(key) === -1) {
      throw badRequest(`Mapping: unknown field "${key}". Allowed: ${API_MAPPING_KEYS.join(', ')}`);
    }
  }

  const root = normalizeOptionalMappingPath(src.root, 'root');
  const collection = normalizeOptionalMappingPath(src.collection, 'collection');

  const rawFields = src.fields;
  if (rawFields === undefined || rawFields === null) {
    throw badRequest('Mapping: "fields" is required');
  }

  const fields: Record<string, string> = {};
  const seen: Record<string, boolean> = {};

  const assign = (rawKey: unknown, rawPath: unknown): void => {
    const key = String(rawKey ?? '').trim().toLowerCase();
    if (!key) throw badRequest('Mapping: a Global Catalog field is required for every row');
    if (API_MAPPING_FIELD_KEYS.indexOf(key) === -1) {
      throw badRequest(
        `Mapping: unsupported field "${key}". Allowed: ${API_MAPPING_FIELD_KEYS.join(', ')}`,
      );
    }
    if (seen[key]) throw badRequest(`Mapping: duplicate Global Catalog field "${key}"`);

    const raw = String(rawPath ?? '').trim();
    if (!raw) throw badRequest(`Mapping: a response path is required for "${key}"`);

    // Normalize BEFORE validating: an absolute address (`products[].name`) uses
    // a bare `[]`, which is intentionally not valid as a per-product path, so
    // the collection prefix has to come off first. Whatever is not stripped is
    // validated unchanged — `toRelativeFieldPath` only returns a stripped
    // prefix when the remainder itself passes the grammar check.
    const relative = toRelativeFieldPath(root, collection, raw);
    if (!relative || !isValidApiMappingPath(relative)) {
      throw badRequest(`Mapping: invalid response path "${raw}" for "${key}"`);
    }

    seen[key] = true;
    fields[key] = relative;
  };

  if (Array.isArray(rawFields)) {
    if (rawFields.length === 0) throw badRequest('Mapping: at least one field must be mapped');
    if (rawFields.length > API_MAPPING_FIELDS.length) {
      throw badRequest(`Mapping: at most ${API_MAPPING_FIELDS.length} fields can be mapped`);
    }
    for (const row of rawFields) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw badRequest('Mapping: each row must be an object { field, path }');
      }
      assign((row as Record<string, unknown>).field, (row as Record<string, unknown>).path);
    }
  } else if (typeof rawFields === 'object') {
    const entries = Object.keys(rawFields as Record<string, unknown>);
    if (entries.length === 0) throw badRequest('Mapping: at least one field must be mapped');
    for (const key of entries) {
      assign(key, (rawFields as Record<string, unknown>)[key]);
    }
  } else {
    throw badRequest('Mapping: "fields" must be an object or an array of { field, path } rows');
  }

  // The product name is what makes a mapping usable at all.
  for (const required of API_MAPPING_REQUIRED_FIELDS) {
    if (!fields[required]) throw badRequest(`Mapping: the "${required}" field is required`);
  }

  return { root, collection, fields };
}

/**
 * Normalize + validate `configuration.api`. PURE (no DB, no network).
 * Returns a FRESH object containing ONLY the documented keys.
 * Throws ApiError(400) on any invalid or unknown field.
 */
export function normalizeCatalogSourceApiConfiguration(
  input: unknown,
): CatalogSourceApiConfiguration {
  if (input === null || input === undefined) {
    throw badRequest('API configuration must be a JSON object');
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('API configuration must be a JSON object');
  }
  const src = input as Record<string, unknown>;

  // ── Guard 1: key allow-list — this is what keeps secrets out of plaintext ──
  for (const key of Object.keys(src)) {
    if (CATALOG_SOURCE_API_KEYS.indexOf(key) === -1) {
      throw badRequest(
        `Unknown API configuration field: ${key}. Allowed: ${CATALOG_SOURCE_API_KEYS.join(', ')}. ` +
          'Secret values (API keys, tokens, passwords) are never stored here — reference an environment variable instead.',
      );
    }
  }

  // ── baseUrl / endpoint ────────────────────────────────────────────────────
  const baseUrl = String(src.baseUrl === undefined || src.baseUrl === null ? '' : src.baseUrl).trim();
  if (!baseUrl) throw badRequest('API configuration: baseUrl (endpoint) is required');
  if (baseUrl.length > 2000) throw badRequest('API configuration: baseUrl must be at most 2000 characters');
  if (hasControlChars(baseUrl)) throw badRequest('API configuration: baseUrl contains control characters');
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw badRequest('API configuration: baseUrl must start with http:// or https://');
  }

  // ── authentication type ───────────────────────────────────────────────────
  const authType = String(src.authType === undefined || src.authType === null ? 'none' : src.authType)
    .trim()
    .toLowerCase() || 'none';
  if (CATALOG_SOURCE_API_AUTH_TYPES.indexOf(authType) === -1) {
    throw badRequest(
      `API configuration: invalid authType "${authType}". Allowed: ${CATALOG_SOURCE_API_AUTH_TYPES.join(', ')}`,
    );
  }

  // ── headers (NAMES only — a value can carry a credential) ─────────────────
  const rawHeaders = src.headerNames === undefined || src.headerNames === null ? [] : src.headerNames;
  if (!Array.isArray(rawHeaders)) {
    throw badRequest('API configuration: headerNames must be an array of header names');
  }
  if (rawHeaders.length > 20) throw badRequest('API configuration: at most 20 header names');
  const headerNames: string[] = [];
  const seenHeaders: Record<string, boolean> = {};
  for (const raw of rawHeaders) {
    const name = String(raw === undefined || raw === null ? '' : raw).trim();
    if (!name) continue;
    if (name.length > 120) throw badRequest('API configuration: a header name exceeds 120 characters');
    if (!HTTP_TOKEN_RE.test(name)) {
      throw badRequest(
        `API configuration: "${name}" is not a valid HTTP header NAME — only names are stored, never header values`,
      );
    }
    const lower = name.toLowerCase();
    if (seenHeaders[lower]) continue;
    seenHeaders[lower] = true;
    headerNames.push(name);
  }

  // ── API key REFERENCE (env-var name — never the secret itself) ────────────
  const rawRef =
    src.credentialRef === undefined || src.credentialRef === null ? '' : String(src.credentialRef).trim();
  let credentialRef: string | null = rawRef || null;

  if (authType === 'none') {
    // An unauthenticated source must not carry a dangling credential name.
    credentialRef = null;
  } else {
    if (!credentialRef) {
      throw badRequest(
        `API configuration: a credential reference (environment variable name) is required for authType "${authType}"`,
      );
    }
    if (!CREDENTIAL_REF_RE.test(credentialRef)) {
      throw badRequest(
        'API configuration: credentialRef must be an environment variable name ' +
          '(letters, digits and underscores) — secret VALUES are never stored',
      );
    }
  }

  // ── where the credential goes (api_key only; bearer/basic use Authorization)
  let credentialLocation = 'header';
  let credentialKey = 'X-API-Key';
  if (authType === 'api_key') {
    const loc = String(src.credentialLocation === undefined || src.credentialLocation === null ? '' : src.credentialLocation)
      .trim()
      .toLowerCase() || 'header';
    if (CATALOG_SOURCE_API_CREDENTIAL_LOCATIONS.indexOf(loc) === -1) {
      throw badRequest(
        `API configuration: invalid credentialLocation "${loc}". Allowed: ${CATALOG_SOURCE_API_CREDENTIAL_LOCATIONS.join(', ')}`,
      );
    }
    credentialLocation = loc;
    const key =
      String(src.credentialKey === undefined || src.credentialKey === null ? '' : src.credentialKey).trim() ||
      (loc === 'query' ? 'api_key' : 'X-API-Key');
    if (key.length > 120 || !HTTP_TOKEN_RE.test(key)) {
      throw badRequest(`API configuration: invalid credentialKey "${key}" — a header/parameter NAME is required`);
    }
    credentialKey = key;
  } else if (authType === 'bearer_token' || authType === 'basic_auth') {
    credentialLocation = 'header';
    credentialKey = 'Authorization';
  }

  // ── username (basic_auth only — the password stays in the env var) ────────
  let username: string | null = null;
  if (authType === 'basic_auth') {
    username = String(src.username === undefined || src.username === null ? '' : src.username).trim() || null;
    if (!username) throw badRequest('API configuration: username is required for authType "basic_auth"');
    if (username.length > 200) throw badRequest('API configuration: username must be at most 200 characters');
    if (hasControlChars(username)) throw badRequest('API configuration: username contains control characters');
  }

  // ── response format ───────────────────────────────────────────────────────
  const responseFormat =
    String(src.responseFormat === undefined || src.responseFormat === null ? '' : src.responseFormat)
      .trim()
      .toLowerCase() || 'json';
  if (CATALOG_SOURCE_API_RESPONSE_FORMATS.indexOf(responseFormat) === -1) {
    throw badRequest(
      `API configuration: invalid responseFormat "${responseFormat}". Allowed: ${CATALOG_SOURCE_API_RESPONSE_FORMATS.join(', ')}`,
    );
  }

  const out: CatalogSourceApiConfiguration = {
    baseUrl,
    authType,
    headerNames,
    credentialRef,
    credentialLocation,
    credentialKey,
    username,
    responseFormat,
  };

  // ── Phase 3: optional `mapping`. `null` / absent ⇒ removed, so a mapping can
  //    be cleared safely and every Phase 1 row (which has none) stays valid.
  if (Object.prototype.hasOwnProperty.call(src, 'mapping')) {
    const rawMapping = src.mapping;
    if (rawMapping === null || rawMapping === undefined) {
      // intentionally omitted from `out`
    } else {
      out.mapping = normalizeCatalogSourceApiMapping(rawMapping);
    }
  }

  return out;
}

export type CatalogSourceInput = {
  name?: string | null;
  sourceType?: string | null;
  countryCode?: string | null;
  provider?: string | null;
  url?: string | null;
  status?: string | null;
  updateFrequency?: string | null;
  configuration?: any;
};

/** Only the fields actually present in the payload (`undefined` = not provided). */
export type NormalizedCatalogSource = {
  name?: string;
  sourceType?: string;
  countryCode?: string | null;
  provider?: string | null;
  url?: string | null;
  status?: string;
  updateFrequency?: string | null;
  configuration?: any;
};

const CATALOG_SOURCE_COUNTRY_RE = /^[A-Z]{2,5}$/;

/**
 * Normalize + validate a source payload. PURE (no DB) → unit-testable.
 * `requireCore` = true for POST (name + sourceType mandatory).
 * Throws ApiError(400) on any invalid field.
 */
export function normalizeCatalogSourceInput(
  input: CatalogSourceInput,
  requireCore = false,
): NormalizedCatalogSource {
  const src = input || {};
  const out: NormalizedCatalogSource = {};

  if (src.name !== undefined && src.name !== null) {
    const name = String(src.name).trim();
    if (!name) throw badRequest('Source name is required');
    if (name.length > 200) throw badRequest('Source name must be at most 200 characters');
    out.name = name;
  } else if (requireCore) {
    throw badRequest('Source name is required');
  }

  if (src.sourceType !== undefined && src.sourceType !== null) {
    const sourceType = String(src.sourceType).trim().toLowerCase();
    if (!sourceType) throw badRequest('Source type is required');
    if (!CATALOG_SOURCE_TYPES.includes(sourceType)) {
      throw badRequest(
        `Unsupported source type: ${sourceType}. Allowed: ${CATALOG_SOURCE_TYPES.join(', ')}`,
      );
    }
    out.sourceType = sourceType;
  } else if (requireCore) {
    throw badRequest('Source type is required');
  }

  if (src.countryCode !== undefined) {
    const raw = src.countryCode === null ? '' : String(src.countryCode).trim().toUpperCase();
    if (!raw) out.countryCode = null;
    else if (!CATALOG_SOURCE_COUNTRY_RE.test(raw)) {
      throw badRequest(`Invalid country code: ${raw} (expected 2-5 letters, e.g. TN)`);
    } else out.countryCode = raw;
  }

  if (src.provider !== undefined) {
    const provider = src.provider === null ? '' : String(src.provider).trim();
    if (provider.length > 200) throw badRequest('Provider must be at most 200 characters');
    out.provider = provider || null;
  }

  if (src.url !== undefined) {
    const url = src.url === null ? '' : String(src.url).trim();
    if (url && !/^https?:\/\//i.test(url)) {
      throw badRequest('URL must start with http:// or https://');
    }
    out.url = url || null;
  }

  if (src.status !== undefined && src.status !== null) {
    const status = String(src.status).trim().toLowerCase();
    if (!CATALOG_SOURCE_STATUSES.includes(status)) {
      throw badRequest(`Invalid source status: ${status}. Allowed: ${CATALOG_SOURCE_STATUSES.join(', ')}`);
    }
    out.status = status;
  }

  if (src.updateFrequency !== undefined) {
    const freq = src.updateFrequency === null ? '' : String(src.updateFrequency).trim();
    if (freq.length > 40) throw badRequest('Update frequency must be at most 40 characters');
    out.updateFrequency = freq || null;
  }

  if (src.configuration !== undefined) {
    if (src.configuration === null) out.configuration = {};
    else if (typeof src.configuration !== 'object' || Array.isArray(src.configuration)) {
      throw badRequest('Configuration must be a JSON object');
    } else {
      // Shallow copy so unknown/legacy keys are preserved verbatim while the
      // NEW `api` block gets validated (Phase 1 — API Source Configuration).
      const cfg: Record<string, any> = { ...(src.configuration as Record<string, any>) };
      if (Object.prototype.hasOwnProperty.call(cfg, 'api')) {
        // `configuration.api` describes an API endpoint, so it is only accepted
        // when the payload itself declares the source as `api`. A PATCH that
        // does not carry `sourceType` keeps the stored type (unchanged rows
        // stay valid; the admin UI only ever sends this block for type `api`).
        const declaredType =
          src.sourceType !== undefined && src.sourceType !== null
            ? String(src.sourceType).trim().toLowerCase()
            : null;
        if (declaredType !== null && declaredType !== 'api') {
          throw badRequest('API configuration (configuration.api) is only allowed when the source type is "api"');
        }
        if (cfg.api === null || cfg.api === undefined) delete cfg.api;
        else cfg.api = normalizeCatalogSourceApiConfiguration(cfg.api);
      }
      out.configuration = cfg;
    }
  }

  return out;
}

/**
 * Duplicate identity — EXACTLY mirrors `ensureCatalogSource` (name + sourceType +
 * countryCode, with "no country" meaning `country_code IS NULL`). PURE.
 */
export function catalogSourceIdentity(src: {
  name?: string | null;
  sourceType?: string | null;
  countryCode?: string | null;
}): string {
  const name = String(src?.name ?? '').trim();
  const sourceType = String(src?.sourceType ?? '').trim();
  const country = String(src?.countryCode ?? '').trim().toUpperCase();
  return `${name}\u0000${sourceType}\u0000${country}`;
}


/** PostgreSQL FK violation on `catalog_sources.country_code` → caller-friendly 400. */
function isCatalogSourceCountryFkViolation(err: any): boolean {
  if (!err) return false;
  if (err.code === '23503') return true;
  return /catalog_sources_country_fk/i.test(String(err.constraint || ''));
}

/**
 * Existing source with the SAME identity as `ensureCatalogSource`
 * (exact name + exact source_type + country_code / IS NULL).
 */
async function findCatalogSourceDuplicate(
  args: { name: string; sourceType: string; countryCode?: string | null; excludeId?: string },
) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');
  const conditions: any[] = [
    eq(catalogSources.name, String(args.name).trim()),
    eq(catalogSources.sourceType, String(args.sourceType).trim()),
    args.countryCode
      ? eq(catalogSources.countryCode, String(args.countryCode).toUpperCase())
      : isNull(catalogSources.countryCode),
  ];
  if (args.excludeId) conditions.push(ne(catalogSources.id, args.excludeId));

  const rows = await db.select().from(catalogSources).where(and(...conditions)).limit(1);
  return rows[0];
}

/**
 * Admin — list/search catalog sources (READ-ONLY).
 * Filters: free-text `search` (name/provider), `countryCode`, `sourceType`, `status`.
 */
export async function listCatalogSources(
  opts: {
    search?: string | null;
    countryCode?: string | null;
    sourceType?: string | null;
    status?: string | null;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ data: any[]; limit: number; offset: number; total: number }> {
  const db = await getDatabase();
  const limit = Math.max(1, Math.min(200, Number(opts.limit) || 50));
  const offset = Math.max(0, Number(opts.offset) || 0);
  if (!db) return { data: [], limit, offset, total: 0 };

  const conditions: any[] = [];

  const search = String(opts.search || '').trim();
  if (search) {
    const like = `%${search}%`;
    conditions.push(or(ilike(catalogSources.name, like), ilike(catalogSources.provider, like)));
  }

  const countryCode = String(opts.countryCode || '').trim().toUpperCase();
  if (countryCode) conditions.push(eq(catalogSources.countryCode, countryCode));

  const sourceType = String(opts.sourceType || '').trim().toLowerCase();
  if (sourceType) conditions.push(eq(catalogSources.sourceType, sourceType));

  const status = String(opts.status || '').trim().toLowerCase();
  if (status) conditions.push(eq(catalogSources.status, status));

  const where = conditions.length ? and(...conditions) : undefined;

  const totalRows = where
    ? await db.select({ count: sql`count(*)` }).from(catalogSources).where(where)
    : await db.select({ count: sql`count(*)` }).from(catalogSources);
  const total = Number(totalRows?.[0]?.count || 0);

  const baseQuery = db.select().from(catalogSources);
  const rows = where
    ? await baseQuery.where(where).orderBy(desc(catalogSources.updatedAt)).limit(limit).offset(offset)
    : await baseQuery.orderBy(desc(catalogSources.updatedAt)).limit(limit).offset(offset);

  return { data: rows, limit, offset, total };
}

/**
 * Admin — create a catalog source (WRITE, `catalog_sources` only).
 *
 * - Validates + normalizes the payload (400 on invalid field).
 * - Rejects a duplicate (name + type + country) with 409 (app-level dedupe: the
 *   table has no unique constraint).
 * - Maps the `country_code → countries(code)` FK violation to a 400.
 * - Does NOT create an import run and does NOT trigger any import/sync.
 */
export async function createCatalogSource(input: CatalogSourceInput) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');

  const values = normalizeCatalogSourceInput(input, true);

  const duplicate = await findCatalogSourceDuplicate({
    name: values.name!,
    sourceType: values.sourceType!,
    countryCode: values.countryCode ?? null,
  });
  if (duplicate) {
    throw conflict(
      `Source already exists: "${duplicate.name}" (${duplicate.sourceType}, ${duplicate.countryCode || 'no country'}) — id ${duplicate.id}`,
    );
  }

  try {
    const [row] = await db
      .insert(catalogSources)
      .values({
        name: values.name!,
        sourceType: values.sourceType!,
        countryCode: values.countryCode ?? null,
        provider: values.provider ?? null,
        url: values.url ?? null,
        status: values.status ?? 'active',
        configuration: values.configuration ?? {},
        updateFrequency: values.updateFrequency ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return row;
  } catch (err) {
    if (isCatalogSourceCountryFkViolation(err)) {
      throw badRequest(`Unknown country code: ${values.countryCode} (it must exist in the countries reference table)`);
    }
    throw err;
  }
}

/**
 * READ-ONLY fetch of one `catalog_sources` row (Phase 2 — Test Connection).
 *
 * - Invalid UUID → `undefined` (route → 404) WITHOUT touching the database.
 * - No database configured → `undefined` (same 404, fail closed).
 * - Writes nothing, creates no import run, starts no sync.
 *
 * Returns `undefined` when the id does not exist (route → 404).
 */
export async function getCatalogSourceById(id: string) {
  if (!isValidUuid(id)) return undefined;
  const db = await getDatabase();
  if (!db) return undefined;
  const rows = await db.select().from(catalogSources).where(eq(catalogSources.id, id)).limit(1);
  return rows[0];
}

/**
 * Admin — update (or disable) an existing catalog source (WRITE, `catalog_sources` only).
 *
 * - Only the provided fields are written; `updated_at` is always refreshed.
 * - A rename that would collide with another source (same name + type + country)
 *   is rejected with 409.
 * - `status: 'inactive'` is the "disable" action.
 * - Never writes `last_successful_sync_at` / `last_error` (no sync in this phase)
 *   and never creates an import run.
 *
 * Returns `undefined` when the id does not exist (route → 404).
 */
export async function updateCatalogSource(id: string, patch: CatalogSourceInput) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');
  if (!isValidUuid(id)) throw badRequest('Invalid source id');

  const existingRows = await db.select().from(catalogSources).where(eq(catalogSources.id, id)).limit(1);
  const existing: any = existingRows[0];
  if (!existing) return undefined;

  const values = normalizeCatalogSourceInput(patch, false);

  const nextName = values.name ?? existing.name;
  const nextType = values.sourceType ?? existing.sourceType;
  const nextCountry = values.countryCode !== undefined ? values.countryCode : existing.countryCode;
  const identityChanged =
    String(nextName) !== String(existing.name) ||
    String(nextType) !== String(existing.sourceType) ||
    (nextCountry ?? null) !== (existing.countryCode ?? null);

  if (identityChanged) {
    const duplicate = await findCatalogSourceDuplicate({
      name: nextName,
      sourceType: nextType,
      countryCode: nextCountry ?? null,
      excludeId: id,
    });
    if (duplicate) {
      throw conflict(
        `Source already exists: "${duplicate.name}" (${duplicate.sourceType}, ${duplicate.countryCode || 'no country'}) — id ${duplicate.id}`,
      );
    }
  }

  const setValues: any = { updatedAt: new Date() };
  if (values.name !== undefined) setValues.name = values.name;
  if (values.sourceType !== undefined) setValues.sourceType = values.sourceType;
  if (values.countryCode !== undefined) setValues.countryCode = values.countryCode;
  if (values.provider !== undefined) setValues.provider = values.provider;
  if (values.url !== undefined) setValues.url = values.url;
  if (values.status !== undefined) setValues.status = values.status;
  if (values.updateFrequency !== undefined) setValues.updateFrequency = values.updateFrequency;
  if (values.configuration !== undefined) setValues.configuration = values.configuration;

  try {
    const [row] = await db
      .update(catalogSources)
      .set(setValues)
      .where(eq(catalogSources.id, id))
      .returning();
    return row;
  } catch (err) {
    if (isCatalogSourceCountryFkViolation(err)) {
      throw badRequest(`Unknown country code: ${values.countryCode} (it must exist in the countries reference table)`);
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// PHASE "COUNTRY + SUPPLIER + PRICES" — READ-ONLY access layer (ADDITIVE)
//
// Design rules (no schema change, no new table, no write):
// - Country availability is read from the EXISTING `global_product_country_availability`.
// - Prices are NEVER stored on `global_products`; they are reached through the
//   EXISTING link chain:
//     global_products → material_global_product_links → materials → material_prices
// - Publication semantics are the EXACT ones already applied by
//   `drizzlePriceRepository.listPrices` (the public barème / calculator path):
//     is_deleted = false AND review_status = 'published' AND is_current = true
//     AND source_code <> 'SUPPLIER_SUBMITTED' AND materials.is_deleted = false.
//   Re-implementing them here (instead of calling listPrices) is deliberate:
//   listPrices has no global-product join, so the caller needs the product scope.
// - No query parameter is ever interpolated into SQL text: every filter is a
//   bound Drizzle value.
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum rows a single read endpoint may return (bounds the response). */
const MAX_READ_ROWS = 200;

export type GlobalProductPriceFilters = {
  country?: string;
  currency?: string;
  supplierId?: string;
  limit?: number;
};

/**
 * Validate + normalize the read filters. PURE (no DB, no network).
 * Throws ApiError(400) on an unusable value — it never silently drops a filter
 * that the caller believes is applied.
 */
export function normalizeGlobalProductPriceFilters(input: any = {}): GlobalProductPriceFilters {
  const src = input && typeof input === 'object' ? input : {};

  const country = normalizeCountryCode(src.country);
  if (src.country !== undefined && src.country !== null && String(src.country).trim() !== '' && !country) {
    throw badRequest(`Invalid country filter: "${src.country}"`);
  }

  const rawCurrency = String(src.currency ?? '').trim();
  if (rawCurrency && !/^[A-Za-z]{3,5}$/.test(rawCurrency)) {
    throw badRequest(`Invalid currency filter: "${src.currency}"`);
  }
  const currency = rawCurrency ? rawCurrency.toUpperCase() : undefined;

  const rawSupplier = String(src.supplierId ?? '').trim();
  if (rawSupplier && !isValidUuid(rawSupplier)) {
    throw badRequest(`Invalid supplierId filter: "${src.supplierId}"`);
  }

  const rawLimit = Number(src.limit);
  const limit = Math.max(1, Math.min(MAX_READ_ROWS, Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 50));

  return {
    country: country || undefined,
    currency,
    supplierId: rawSupplier || undefined,
    limit,
  };
}


/**
 * READ-ONLY — country availability rows for one global product.
 *
 * - Invalid UUID → `undefined` (route → 404) WITHOUT touching the database.
 * - No database configured → `[]` (fail closed, never a fabricated row).
 * - Writes nothing.
 */
export async function getGlobalProductAvailability(globalProductId: string) {
  if (!isValidUuid(globalProductId)) return undefined;
  const db = await getDatabase();
  if (!db) return [];
  const rows = await db
    .select()
    .from(globalProductCountryAvailability)
    .where(eq(globalProductCountryAvailability.globalProductId, globalProductId))
    .orderBy(globalProductCountryAvailability.countryCode);
  return rows.map(toPublicAvailabilityRow);
}

/**
 * Resolve the `material_id` linked to a global product, if any.
 * Returns `null` when the product exists but has no approved link.
 */
async function resolveLinkedMaterialId(db: any, globalProductId: string): Promise<string | null> {
  const rows = await db
    .select({ materialId: materialGlobalProductLinks.materialId })
    .from(materialGlobalProductLinks)
    .where(
      and(
        eq(materialGlobalProductLinks.globalProductId, globalProductId),
        eq(materialGlobalProductLinks.status, 'approved'),
      ),
    )
    .limit(1);
  return rows[0]?.materialId ?? null;
}

/** Public-safe projection of a `material_prices` row reached through a global product. */
function toPublicGlobalPriceRow(row: any) {
  return {
    id: row.id,
    materialId: row.materialId,
    sourceCode: row.sourceCode,
    countryCode: row.countryCode,
    currencyCode: row.currencyCode,
    unitPrice: row.unitPrice === undefined || row.unitPrice === null ? 0 : Number(row.unitPrice),
    supplierId: row.supplierId ?? null,
    isCurrent: !!row.isCurrent,
    reviewStatus: row.reviewStatus ?? null,
    effectiveFrom: row.effectiveFrom ?? null,
    effectiveTo: row.effectiveTo ?? null,
    packageDefinitionId: row.packageDefinitionId ?? null,
    packagePrice: row.packagePrice === undefined || row.packagePrice === null ? null : Number(row.packagePrice),
    updatedAt: row.updatedAt ?? null,
  };
}

/**
 * READ-ONLY — current (published) prices of the material behind a global product.
 *
 * Chain: global_products → material_global_product_links → materials → material_prices.
 * Optional country / currency / supplier filters.
 * Returns `[]` when the product has no approved material link, or when the
 * linked material has no published price — never an invented row.
 */
export async function listGlobalProductPrices(globalProductId: string, filters: any = {}) {
  const f = normalizeGlobalProductPriceFilters(filters);
  if (!isValidUuid(globalProductId)) return { data: [], filters: f, materialId: null };

  const db = await getDatabase();
  if (!db) return { data: [], filters: f, materialId: null };

  const materialId = await resolveLinkedMaterialId(db, globalProductId);
  if (!materialId) return { data: [], filters: f, materialId: null };

  // Publication rules mirrored from drizzlePriceRepository.listPrices.
  const conditions: any[] = [
    eq(materialPrices.materialId, materialId),
    eq(materialPrices.isDeleted, false),
    eq(materialPrices.reviewStatus, 'published'),
    eq(materialPrices.isCurrent, true),
    ne(materialPrices.sourceCode, 'SUPPLIER_SUBMITTED'),
    eq(materials.isDeleted, false),
  ];
  if (f.country) conditions.push(sql`upper(${materialPrices.countryCode}) = upper(${f.country})`);
  if (f.currency) conditions.push(eq(materialPrices.currencyCode, f.currency));
  if (f.supplierId) conditions.push(eq(materialPrices.supplierId, f.supplierId));

  const rows = await db
    .select()
    .from(materialPrices)
    .innerJoin(materials, eq(materials.id, materialPrices.materialId))
    .where(and(...conditions))
    .orderBy(desc(materialPrices.effectiveFrom), desc(materialPrices.updatedAt))
    .limit(f.limit);

  return { data: rows.map(toPublicGlobalPriceRow), filters: f, materialId };
}

/**
 * READ-ONLY — FULL price history of the material behind a global product.
 *
 * History is preserved in place by the existing write paths
 * (`publishPriceUpdate` flips `is_current` on the previous row; nothing is
 * ever deleted), so this endpoint only READS superseded rows: it deliberately
 * drops the `is_current = true` filter and orders newest-first by
 * `effective_from`. It never mutates and never removes an old row.
 */
export async function getGlobalProductPriceHistory(globalProductId: string, filters: any = {}) {
  const f = normalizeGlobalProductPriceFilters(filters);
  if (!isValidUuid(globalProductId)) return { data: [], filters: f, materialId: null };

  const db = await getDatabase();
  if (!db) return { data: [], filters: f, materialId: null };

  const materialId = await resolveLinkedMaterialId(db, globalProductId);
  if (!materialId) return { data: [], filters: f, materialId: null };

  const conditions: any[] = [
    eq(materialPrices.materialId, materialId),
    eq(materialPrices.isDeleted, false),
    eq(materials.isDeleted, false),
  ];
  if (f.country) conditions.push(sql`upper(${materialPrices.countryCode}) = upper(${f.country})`);
  if (f.currency) conditions.push(eq(materialPrices.currencyCode, f.currency));
  if (f.supplierId) conditions.push(eq(materialPrices.supplierId, f.supplierId));

  // NOTE: deliberately NO `is_current` / `review_status` filter here — the whole
  // point of this endpoint is to return the SUPERSEDED rows too, so an old
  // price is never hidden. Ordering is newest `effective_from` first.
  const rows = await db
    .select()
    .from(materialPrices)
    .innerJoin(materials, eq(materials.id, materialPrices.materialId))
    .where(and(...conditions))
    .orderBy(desc(materialPrices.effectiveFrom), desc(materialPrices.updatedAt))
    .limit(f.limit);

  return { data: rows.map(toPublicGlobalPriceRow), filters: f, materialId };
}

/**
 * READ-ONLY — price history of a MATERIAL directly (same rules as
 * `getGlobalProductPriceHistory`, reached without the global-product hop).
 * Kept separate so the material entry point stays explicit and auditable.
 */
export async function getPriceHistory(materialId: string, filters: any = {}) {
  const f = normalizeGlobalProductPriceFilters(filters);
  if (!isValidUuid(materialId)) return { data: [], filters: f };

  const db = await getDatabase();
  if (!db) return { data: [], filters: f };

  const conditions: any[] = [
    eq(materialPrices.materialId, materialId),
    eq(materialPrices.isDeleted, false),
    eq(materials.isDeleted, false),
  ];
  if (f.country) conditions.push(sql`upper(${materialPrices.countryCode}) = upper(${f.country})`);
  if (f.currency) conditions.push(eq(materialPrices.currencyCode, f.currency));
  if (f.supplierId) conditions.push(eq(materialPrices.supplierId, f.supplierId));

  const rows = await db
    .select()
    .from(materialPrices)
    .innerJoin(materials, eq(materials.id, materialPrices.materialId))
    .where(and(...conditions))
    .orderBy(desc(materialPrices.effectiveFrom), desc(materialPrices.updatedAt))
    .limit(f.limit);

  return { data: rows.map(toPublicGlobalPriceRow), filters: f };
}

/**
 * Validate + normalize the `listSuppliers` filters. PURE (no DB, no network).
 */
export function normalizeSupplierListFilters(input: any = {}): {
  country?: string;
  search?: string;
  verified?: boolean;
  limit: number;
  offset: number;
} {
  const src = input && typeof input === 'object' ? input : {};

  const country = normalizeCountryCode(src.country);
  if (src.country !== undefined && src.country !== null && String(src.country).trim() !== '' && !country) {
    throw badRequest(`Invalid country filter: "${src.country}"`);
  }

  const search = String(src.search ?? '').trim();
  if (search.length > 200) throw badRequest('Search filter is limited to 200 characters');

  const rawLimit = Number(src.limit);
  const limit = Math.max(1, Math.min(MAX_READ_ROWS, Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 50));

  const rawOffset = Number(src.offset);
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;

  let verified: boolean | undefined;
  if (src.verified !== undefined && src.verified !== null && String(src.verified).trim() !== '') {
    const v = String(src.verified).trim().toLowerCase();
    if (['true', '1', 'yes'].includes(v)) verified = true;
    else if (['false', '0', 'no'].includes(v)) verified = false;
    else throw badRequest(`Invalid verified filter: "${src.verified}" (expected true or false)`);
  }

  return { country: country || undefined, search: search || undefined, verified, limit, offset };
}

/**
 * Public-safe projection of a `suppliers` row.
 *
 * Deliberately OMITS internal-only fields (`legalRegistrationNumber`,
 * `contactEmail`, `contactPhone`, `address`, `version`, `isDeleted`) so a
 * public read endpoint can never leak registry/PII data.
 */
function toPublicSupplierRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    countryCode: row.countryCode ?? null,
    isVerified: !!row.isVerified,
    verificationStatus: row.verificationStatus ?? null,
    logoUrl: row.logoUrl ?? null,
    websiteUrl: row.websiteUrl ?? null,
    regionGovernorate: row.regionGovernorate ?? null,
  };
}

/**
 * READ-ONLY — list suppliers, optionally scoped to a country / free-text
 * search / verified flag. Soft-deleted suppliers are NEVER returned.
 * Writes nothing.
 */
export async function listSuppliers(filters: any = {}) {
  const f = normalizeSupplierListFilters(filters);

  const db = await getDatabase();
  if (!db) return { data: [], total: 0, filters: f };

  const conditions: any[] = [eq(suppliers.isDeleted, false)];
  if (f.country) conditions.push(sql`upper(${suppliers.countryCode}) = upper(${f.country})`);
  if (f.verified !== undefined) conditions.push(eq(suppliers.isVerified, f.verified));
  if (f.search) {
    const needle = `%${f.search}%`;
    conditions.push(or(ilike(suppliers.name, needle), ilike(suppliers.websiteUrl, needle))!);
  }

  const rows = await db
    .select()
    .from(suppliers)
    .where(and(...conditions))
    .orderBy(suppliers.name)
    .limit(f.limit)
    .offset(f.offset);

  return { data: rows.map(toPublicSupplierRow), total: rows.length, filters: f };
}


