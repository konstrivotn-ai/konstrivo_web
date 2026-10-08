// @ts-nocheck
/**
 * Phase 4 — Global Catalog Import (Preview + Commit)
 *
 * SAFETY:
 * - preview does NOT write to DB.
 * - commit is admin-only at the route layer.
 * - matching is strong-identifier ONLY (exact identifier match).
 * - no changes to materials/material_prices.
 */
import crypto from 'node:crypto';
import { parseCatalogCsv } from '../utils/csv';
import { parseXlsxToRows } from '../utils/xlsx';
import { getDatabase } from '../db/client';
import { catalogImports } from '../db/schema';
import {
  createGlobalProduct,
  upsertGlobalIdentifier,
  findGlobalProductByIdentifier,
  setGlobalProductAvailability,
  ensureCatalogSource,
  createImportRun,
  insertImportItems,
  linkMaterialToGlobalProduct,
  safePatchGlobalProduct,
} from '../repositories/globalCatalogRepository';
import {
  normalizeCountryCode,
  normalizeIdentifierType,
  normalizeIdentifierValue,
  clampConfidence,
  STRONG_IDENTIFIER_TYPES,
} from './globalCatalogValidation';

export type GlobalImportFileType = 'csv' | 'xlsx';

export type GlobalImportRow = {
  name?: string;
  brand?: string;
  manufacturer?: string;
  category?: string;
  subcategory?: string;
  description?: string;
  specification?: string;
  unit?: string;
  model?: string;
  sku?: string;
  // identifiers
  identifier_type?: string;
  identifier_value?: string;
  supplier_id?: string;
  // optional mapping to existing materials
  material_id?: string;
  // country availability
  country?: string;
  available?: string;
  local_name?: string;
  local_reference?: string;
  local_specification?: string;
  local_unit?: string;
};

export type GlobalImportPreviewItem = {
  sourceRow: number;
  raw: Record<string, string>;
  normalized: any;
  errors: string[];
  matchStatus: 'new' | 'matched' | 'possible_match' | 'review_required';
  matchedGlobalProductId?: string | null;
  confidence: number;
};

export type GlobalImportPreview = {
  fileType: GlobalImportFileType;
  headers: string[];
  items: GlobalImportPreviewItem[];
  summary: {
    total: number;
    valid: number;
    invalid: number;
    matched: number;
    reviewRequired: number;
    new: number;
  };
  fileSha256: string;
};

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function normalizeBool(v: any): boolean | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().toLowerCase();
  if (s === '') return null;
  if (['1', 'true', 'yes', 'y', 'oui', 'o', 'نعم'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'non', 'لا'].includes(s)) return false;
  return null;
}

function normalizeRow(raw: Record<string, string>): GlobalImportRow {
  const get = (k: string) => (raw[k] ?? raw[k.toLowerCase()] ?? '').trim();
  return {
    // ── Canonical adapter (Website material import schema → Global Catalog) ──
    // Added LAST in every chain: all pre-existing spellings keep their exact
    // current priority, so no legacy file changes behaviour.
    //   material_name → name      (canonical designation)
    //   material_code → sku       (canonical stable code → the existing plain
    //                               code column; NOT the identifier pair, which
    //                               would demand an identifier_type the file
    //                               does not carry)
    //   market        → country   (canonical country/market column)
    name: get('name') || get('product_name') || get('global_name') || get('material_name'),
    brand: get('brand'),
    manufacturer: get('manufacturer'),
    category: get('category'),
    subcategory: get('subcategory'),
    description: get('description'),
    specification: get('specification'),
    unit: get('unit'),
    model: get('model'),
    sku: get('sku') || get('material_code'),
    identifier_type: get('identifier_type') || get('id_type'),
    identifier_value: get('identifier_value') || get('id_value') || get('gtin') || get('ean') || get('upc'),
    supplier_id: get('supplier_id') || get('supplierId') || get('supplier'),
    material_id: get('material_id'),
    country: (get('country') || get('country_code') || get('market')).toUpperCase(),
    available: get('available'),
    local_name: get('local_name'),
    local_reference: get('local_reference'),
    local_specification: get('local_specification'),
    local_unit: get('local_unit'),
  };
}

function validateNormalizedRow(n: GlobalImportRow): string[] {
  const errors: string[] = [];
  if (!n.name) errors.push('Missing name');
  // Identifier fields are optional but if one is present require the pair.
  const hasType = !!n.identifier_type;
  const hasValue = !!n.identifier_value;
  if (hasType !== hasValue) errors.push('Identifier requires identifier_type + identifier_value');
  if (hasType && hasValue) {
    const t = normalizeIdentifierType(n.identifier_type);
    const v = normalizeIdentifierValue(n.identifier_value);
    if (!t || !v) errors.push('Invalid identifier type/value');
    // Weak identifiers require supplier scope for safe matching.
    if (t && !STRONG_IDENTIFIER_TYPES.has(t)) {
      if (!n.supplier_id) errors.push('Weak identifiers require supplier_id for safe matching');
    }
  }
  // ── country / available are INDEPENDENT (2026-10-02) ──────────────────────
  // - `country` present → only its FORMAT is validated.
  // - `available` EMPTY → never an error and never invented: the commit path
  //   already skips the availability write when normalizeBool() returns null,
  //   so no availability value is ever created from nothing.
  // - `available` NON-EMPTY but unparseable WHILE a country is present → still
  //   rejected: a value the source DID provide must be valid (no silent drop).
  // The legacy pairing rule (country ⇒ available required) is intentionally
  // dropped here and is NOT propagated to the canonical material import.
  if (n.country) {
    const cc = normalizeCountryCode(n.country);
    if (!cc) errors.push('Invalid country code');
    if (n.available !== '' && normalizeBool(n.available) === null) {
      errors.push(`Invalid available value « ${n.available} » (expected yes/no)`);
    }
  }
  return errors;
}

export async function previewGlobalCatalogImport(args: {
  fileType: GlobalImportFileType;
  buffer: Buffer;
  countryFallback?: string;
}): Promise<GlobalImportPreview> {
  const fileSha256 = sha256(args.buffer);
  let parsed: { headers: string[]; rows: Array<Record<string, string>> };

  if (args.fileType === 'csv') {
    const csv = parseCatalogCsv(args.buffer.toString('utf-8'));
    parsed = { headers: csv.headers, rows: csv.rows };
  } else {
    const x = await parseXlsxToRows(args.buffer);
    parsed = { headers: x.headers, rows: x.rows };
  }

  const items: GlobalImportPreviewItem[] = [];
  let matched = 0;
  let reviewRequired = 0;
  let createdNew = 0;
  let invalid = 0;

  for (let i = 0; i < parsed.rows.length; i++) {
    const raw = parsed.rows[i];
    const normalized = normalizeRow(raw);
    if (!normalized.country && args.countryFallback) normalized.country = String(args.countryFallback).toUpperCase();

    const errors = validateNormalizedRow(normalized);
    let matchStatus: 'new' | 'matched' | 'possible_match' | 'review_required' = 'new';
    let matchedGlobalProductId: string | null = null;
    let confidence = 0;

    if (errors.length === 0 && normalized.identifier_type && normalized.identifier_value) {
      const t = normalizeIdentifierType(normalized.identifier_type);
      const v = normalizeIdentifierValue(normalized.identifier_value);
      const supplierId = normalized.supplier_id || null;
      const id = (t && v)
        ? await findGlobalProductByIdentifier(t as any, v, { supplierId })
        : null;
      if (id) {
        matchStatus = 'matched';
        matchedGlobalProductId = id;
        confidence = 100;
        matched++;
      } else {
        // No identifier match. We DO NOT auto-merge by name, but we can still create.
        matchStatus = 'new';
        createdNew++;
      }
    } else if (errors.length === 0) {
      // No identifier provided — this may be a possible match, but MUST be reviewed.
      matchStatus = 'possible_match';
      reviewRequired++;
      confidence = 0;
    } else {
      invalid++;
    }

    items.push({
      sourceRow: i + 1,
      raw,
      normalized,
      errors,
      matchStatus,
      matchedGlobalProductId,
      confidence,
    });
  }

  const total = parsed.rows.length;
  const valid = total - invalid;
  const summary = {
    total,
    valid,
    invalid,
    matched,
    reviewRequired,
    new: createdNew,
  };

  return { fileType: args.fileType, headers: parsed.headers, items, summary, fileSha256 };
}

export async function commitGlobalCatalogImport(args: {
  fileType: GlobalImportFileType;
  buffer: Buffer;
  source: { name: string; sourceType: string; countryCode?: string | null };
  createdByUserId?: string | null;
  countryFallback?: string;
  /** When true, rows with no identifier are skipped instead of creating products. */
  skipRowsWithoutIdentifier?: boolean;
}): Promise<{ importId: string; created: number; matched: number; updated: number; reviewRequired: number; skipped: number; invalid: number; rejected: number }>
{
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');

  const preview = await previewGlobalCatalogImport({ fileType: args.fileType, buffer: args.buffer, countryFallback: args.countryFallback });

  const result = { created: 0, matched: 0, updated: 0, reviewRequired: 0, skipped: 0, invalid: 0, rejected: 0 };

  return await db.transaction(async (tx: any) => {
    const src = await ensureCatalogSource({
      name: args.source.name,
      sourceType: args.source.sourceType,
      countryCode: args.source.countryCode ?? null,
    }, tx);

    const importRun = await createImportRun({
      sourceId: src.id,
      countryCode: args.source.countryCode ?? args.countryFallback ?? null,
      fileName: args.source.name || null,
      fileSha256: preview.fileSha256,
      fileMimeType: args.fileType === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      createdByUserId: args.createdByUserId ?? null,
    }, tx);

    const itemsForDb: any[] = [];

    for (const item of preview.items) {
      const n: GlobalImportRow = item.normalized;
      if (item.errors.length) {
        result.invalid++;
        result.rejected++;
        itemsForDb.push({ sourceRow: item.sourceRow, countryCode: n.country || null, raw: item.raw || {}, normalized: n, matchStatus: 'rejected', confidence: 0, notes: item.errors.join('; ') });
        continue;
      }

      const hasId = !!(n.identifier_type && n.identifier_value);
      if (!hasId && args.skipRowsWithoutIdentifier) {
        result.skipped++;
        itemsForDb.push({ sourceRow: item.sourceRow, countryCode: n.country || null, raw: item.raw || {}, normalized: n, matchStatus: 'review_required', confidence: 0, notes: 'Skipped (no identifier)' });
        continue;
      }

      let globalProductId: string | null = null;

      if (hasId) {
        const t = normalizeIdentifierType(n.identifier_type);
        const v = normalizeIdentifierValue(n.identifier_value);
        globalProductId = (t && v)
          ? await findGlobalProductByIdentifier(t as any, v, { supplierId: n.supplier_id || null })
          : null;
      }

      if (globalProductId) {
        result.matched++;
        // Safe update of existing product fields: only non-empty source values.
        const patched = await safePatchGlobalProduct(globalProductId, {
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
        } as any, tx);
        if (patched) result.updated++;
      } else {
        if (!hasId) {
          // No strong ID → do NOT auto-create silently; force review required.
          result.reviewRequired++;
          itemsForDb.push({ sourceRow: item.sourceRow, countryCode: n.country || null, raw: item.raw || {}, normalized: n, matchStatus: 'review_required', confidence: 0, notes: 'No strong identifier; review required' });
          continue;
        }

        const gp = await createGlobalProduct({
          name: n.name!,
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
        globalProductId = gp.id;
        await upsertGlobalIdentifier({
          globalProductId,
          identifierType: n.identifier_type as any,
          identifierValue: n.identifier_value as any,
          supplierId: n.supplier_id || null,
          source: 'import',
          confidence: 100,
        }, tx);
        result.created++;
      }

      // Optional: country availability.
      if (globalProductId && n.country) {
        const b = normalizeBool(n.available);
        if (b !== null) {
          await setGlobalProductAvailability({
            globalProductId,
            countryCode: n.country,
            isAvailable: b,
            localName: n.local_name || null,
            localReference: n.local_reference || null,
            localSpecification: n.local_specification || null,
            localUnit: n.local_unit || null,
            observedAt: new Date().toISOString(),
            catalogSourceId: src.id,
            sourceRef: preview.fileSha256,
          }, tx);
        }
      }

      // Optional: link to existing material.
      if (globalProductId && n.material_id) {
        try {
          await linkMaterialToGlobalProduct({ materialId: n.material_id, globalProductId, linkSource: 'import', status: 'approved', confidence: 100 }, tx);
        } catch {
          // Keep import safe: do not fail entire run for a single link.
        }
      }

      itemsForDb.push({
        sourceRow: item.sourceRow,
        countryCode: n.country || null,
        raw: item.raw || {},
        normalized: n,
        matchStatus: globalProductId ? 'approved' : 'review_required',
        matchedGlobalProductId: globalProductId,
        confidence: globalProductId ? 100 : 0,
        notes: globalProductId ? null : 'Review required',
      });
    }

    await insertImportItems(importRun.id, itemsForDb, tx);

    // Update import run tracking.
    try {
      const itemsCount = itemsForDb.length;
      const status = result.invalid > 0 || result.rejected > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED';
      await tx.update(catalogImports).set({
        importStatus: status,
        itemsCount,
        importedCount: result.created,
        updatedCount: result.updated,
        rejectedCount: result.rejected,
        errorSummary: result.invalid > 0 ? 'Some rows rejected/invalid' : null,
        updatedAt: new Date(),
      }).where(sql`${catalogImports.id} = ${importRun.id}`);
    } catch {
      // Non-fatal; keep commit atomic for main entities.
    }

    return { importId: importRun.id, ...result };
  });
}
