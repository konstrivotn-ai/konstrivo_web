// @ts-nocheck
/**
 * Global Catalog — API Import Commit (COMMIT ONLY, no fetch, no sync).
 *
 * Consumes ApiImportPreviewItem[] produced by previewApiImportRows and applies
 * the SAME rules as file commit (commitGlobalCatalogImport):
 * - invalid rows -> rejected (staged only, never created)
 * - rows without identifier -> review_required (never auto-created)
 * - duplicate identifier inside one payload -> review_required (never duplicated)
 * - matched identifier -> safePatch (whitelisted product fields only)
 * - new identifier -> createGlobalProduct + upsertGlobalIdentifier (GTIN stays identifier-only)
 * - price/currency/availability are NEVER written to product columns
 * - review itself stays with the existing approve/reject endpoints
 *
 * Everything runs inside ONE transaction via the injected transact().
 */
import crypto from 'node:crypto';
import { getDatabase } from '../db/client';
import { catalogImports } from '../db/schema';
import { sql } from 'drizzle-orm';
import {
  ensureCatalogSource,
  createImportRun,
  insertImportItems,
  findGlobalProductByIdentifier,
  createGlobalProduct,
  safePatchGlobalProduct,
  upsertGlobalIdentifier,
  normalizeCatalogSourceApiMapping,
} from '../repositories/globalCatalogRepository';
import { normalizeCountryCode } from './globalCatalogValidation';
import { resolveApiResponse } from './catalogApiResolver';
import { previewApiImportRows } from './catalogApiImportPreview';
import type { ApiImportPreviewItem } from './catalogApiImportPreview';

export type ApiCommitSource = { name: string; sourceType?: string; countryCode?: string | null };
export type ApiCommitResult = {
  importId: string; created: number; matched: number; updated: number;
  reviewRequired: number; skipped: number; invalid: number; rejected: number;
};
export type ApiCommitDeps = {
  transact: (fn: (tx: any) => Promise<any>) => Promise<any>;
  ensureSource: (a: any, tx: any) => Promise<any>;
  createRun: (a: any, tx: any) => Promise<any>;
  findByIdentifier: (t: any, v: string, o: any) => Promise<string | null>;
  createProduct: (d: any, tx: any) => Promise<any>;
  patchProduct: (id: string, p: any, tx: any) => Promise<any>;
  upsertIdentifier: (a: any, tx: any) => Promise<any>;
  stageItems: (importId: string, items: any[], tx: any) => Promise<any>;
  touchRun: (importId: string, patch: any, tx: any) => Promise<any>;
};
export function defaultApiCommitDeps(): ApiCommitDeps {
  return {
    transact: async (fn: any) => {
      const db = await getDatabase();
      if (!db) throw new Error('Database not available');
      return await db.transaction(fn);
    },
    ensureSource: (a: any, tx: any) => ensureCatalogSource(a, tx),
    createRun: (a: any, tx: any) => createImportRun(a, tx),
    findByIdentifier: (t: any, v: string, o: any) => findGlobalProductByIdentifier(t, v, o),
    createProduct: (d: any, tx: any) => createGlobalProduct(d, tx),
    patchProduct: (id: string, p: any, tx: any) => safePatchGlobalProduct(id, p, tx),
    upsertIdentifier: (a: any, tx: any) => upsertGlobalIdentifier(a, tx),
    stageItems: (importId: string, items: any[], tx: any) => insertImportItems(importId, items, tx),
    touchRun: async (importId: string, patch: any, tx: any) => {
      await tx.update(catalogImports).set({
        importStatus: patch.status,
        itemsCount: patch.itemsCount,
        importedCount: patch.imported,
        updatedCount: patch.updated,
        rejectedCount: patch.rejected,
        errorSummary: patch.errorSummary,
        updatedAt: new Date(),
      }).where(sql`${catalogImports.id} = ${importId}`);
    },
  };
}
export function sha256Json(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function commitApiImportRows(
  items: ApiImportPreviewItem[],
  args: { source: ApiCommitSource; createdByUserId?: string | null; documentSha256?: string; deps?: ApiCommitDeps },
): Promise<ApiCommitResult> {
  const deps = args.deps || defaultApiCommitDeps();
  const result = { created: 0, matched: 0, updated: 0, reviewRequired: 0, skipped: 0, invalid: 0, rejected: 0 };
  return await deps.transact(async (tx: any) => {
    const src = await deps.ensureSource({
      name: args.source.name,
      sourceType: args.source.sourceType || 'api',
      countryCode: args.source.countryCode ? normalizeCountryCode(args.source.countryCode) : null,
    }, tx);
    const run = await deps.createRun({
      sourceId: src.id,
      countryCode: args.source.countryCode ? normalizeCountryCode(args.source.countryCode) : null,
      fileName: args.source.name || null,
      fileSha256: args.documentSha256 || null,
      fileMimeType: 'application/json',
      createdByUserId: args.createdByUserId ?? null,
    }, tx);
    const staged: any[] = [];
    const seen = new Set<string>();
    for (const item of items || []) {
      const n: any = item.normalized || {};
      if (item.errors && item.errors.length) {
        result.invalid += 1;
        result.rejected += 1;
        staged.push({ sourceRow: item.sourceRow, countryCode: n.country || null, raw: item.raw || {}, normalized: n, matchStatus: 'rejected', confidence: 0, notes: item.errors.join('; ') });
        continue;
      }
      const hasId = !!(n.identifier_type && n.identifier_value);
      if (!hasId) {
        result.reviewRequired += 1;
        staged.push({ sourceRow: item.sourceRow, countryCode: n.country || null, raw: item.raw || {}, normalized: n, matchStatus: 'review_required', confidence: 0, notes: 'No strong identifier; review required' });
        continue;
      }
      const key = String(n.identifier_type).toLowerCase() + '|' + String(n.identifier_value) + '|' + String(n.supplier_id || '');
      if (seen.has(key)) {
        result.reviewRequired += 1;
        staged.push({ sourceRow: item.sourceRow, countryCode: n.country || null, raw: item.raw || {}, normalized: n, matchStatus: 'review_required', confidence: 0, notes: 'Duplicate identifier in payload; review required' });
        continue;
      }
      seen.add(key);
      const existingId = await deps.findByIdentifier(n.identifier_type, n.identifier_value, { supplierId: n.supplier_id || null });
      if (existingId) {
        result.matched += 1;
        const patched = await deps.patchProduct(existingId, {
          name: n.name,
          brand: n.brand || undefined,
          manufacturer: n.manufacturer || undefined,
          category: n.category || undefined,
          subcategory: n.subcategory || undefined,
          description: n.description || undefined,
          specification: n.specification || undefined,
          unit: n.unit || undefined,
          model: n.model || undefined,
          sku: n.sku || undefined,
        }, tx);
        if (patched) result.updated += 1;
        staged.push({ sourceRow: item.sourceRow, countryCode: n.country || null, raw: item.raw || {}, normalized: n, matchStatus: 'approved', matchedGlobalProductId: existingId, confidence: 100, notes: null });
        continue;
      }
      const gp = await deps.createProduct({
        name: n.name,
        brand: n.brand || null,
        manufacturer: n.manufacturer || null,
        category: n.category || null,
        subcategory: n.subcategory || null,
        description: n.description || null,
        specification: n.specification || null,
        unit: n.unit || null,
        model: n.model || null,
        sku: n.sku || null,
        status: 'active',
      }, tx);
      await deps.upsertIdentifier({
        globalProductId: gp.id,
        identifierType: n.identifier_type,
        identifierValue: n.identifier_value,
        supplierId: n.supplier_id || null,
        source: 'import',
        confidence: 100,
      }, tx);
      result.created += 1;
      staged.push({ sourceRow: item.sourceRow, countryCode: n.country || null, raw: item.raw || {}, normalized: n, matchStatus: 'approved', matchedGlobalProductId: gp.id, confidence: 100, notes: null });
    }
    await deps.stageItems(run.id, staged, tx);
    const status = result.invalid > 0 || result.rejected > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED';
    try {
      await deps.touchRun(run.id, {
        status, itemsCount: staged.length, imported: result.created,
        updated: result.updated, rejected: result.rejected,
        errorSummary: result.invalid > 0 ? 'Some rows rejected/invalid' : null,
      }, tx);
    } catch { /* non-fatal */ }
    return { importId: run.id, ...result };
  });
}

export async function previewApiImportDocument(
  document: unknown,
  rawMapping: unknown,
  opts?: { matcher?: any; countryFallback?: string | null },
): Promise<any> {
  const mapping = normalizeCatalogSourceApiMapping(rawMapping);
  const resolved = resolveApiResponse(document, mapping);
  const preview = await previewApiImportRows(resolved, {
    matcher: opts && opts.matcher
      ? async (t: any, v: string, s: any) => opts.matcher(t, v, s)
      : async () => null,
  });
  if (opts && opts.countryFallback && normalizeCountryCode(opts.countryFallback)) {
    for (const it of preview.items) {
      const n: any = it.normalized || {};
      if (!n.country) n.country = String(opts.countryFallback).toUpperCase();
    }
  }
  return { mapping, resolved: { total: resolved.total, accepted: resolved.accepted, rejected: resolved.rejected }, preview };
}
