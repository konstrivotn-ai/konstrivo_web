// @ts-nocheck
/**
 * Global Catalog - API to Import Preview Adapter (PREVIEW ONLY).
 * Converts resolveApiResponse rows into import preview rows.
 * No DB writes. No commit. No sync. No fetch.
 */
import type { ApiResolverResult } from './catalogApiResolver';
import type { GlobalImportPreviewItem, GlobalImportPreview, GlobalImportRow } from './globalCatalogImport';
import { normalizeCountryCode, normalizeIdentifierType, normalizeIdentifierValue, STRONG_IDENTIFIER_TYPES } from './globalCatalogValidation';
export type ApiImportPreviewItem = GlobalImportPreviewItem & { notes: string[] };
export type ApiImportPreview = { items: ApiImportPreviewItem[]; summary: GlobalImportPreview['summary']; source: 'api' };

function pick(row: any, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return '';
}
function toImportRow(input: any): GlobalImportRow {
  const row = input && typeof input === 'object' ? input : {};
  const rawT = String(row.identifier_type ?? '').trim();
  const rawV = String(row.identifier_value ?? '').trim();
  const t = rawT ? normalizeIdentifierType(rawT) : null;
  const v = rawV ? normalizeIdentifierValue(rawV) : null;
  const keepBadIdentifier = rawV.length > 0 && rawV.length <= 1000;
  return {
    name: pick(row, ['name', 'product_name', 'global_name']),
    brand: pick(row, ['brand']),
    manufacturer: pick(row, ['manufacturer']),
    category: pick(row, ['category']),
    subcategory: pick(row, ['subcategory']),
    description: pick(row, ['description']),
    specification: pick(row, ['specification']),
    unit: pick(row, ['unit']),
    model: pick(row, ['model']),
    sku: pick(row, ['sku']),
    identifier_type: t || (rawT ? rawT.slice(0, 1000) : ''),
    identifier_value: v || (keepBadIdentifier ? rawV : ''),
    supplier_id: pick(row, ['supplier_id']),
    material_id: pick(row, ['material_id']),
    country: normalizeCountryCode(pick(row, ['country'])) || '',
    available: pick(row, ['available']),
    local_name: pick(row, ['local_name']),
    local_reference: pick(row, ['local_reference']),
    local_specification: pick(row, ['local_specification']),
    local_unit: pick(row, ['local_unit']),
  };
}
function validateRow(n: GlobalImportRow): string[] {
  const errors: string[] = [];
  if (!n.name) errors.push('Missing name');
  const hasType = !!n.identifier_type;
  const hasValue = !!n.identifier_value;
  if (hasType !== hasValue) errors.push('Identifier requires identifier_type + identifier_value');
  if (hasType && hasValue) {
    const t = normalizeIdentifierType(n.identifier_type);
    const v = normalizeIdentifierValue(n.identifier_value);
    if (!t || !v) errors.push('Invalid identifier type/value');
    if (t && !STRONG_IDENTIFIER_TYPES.has(t) && !n.supplier_id) {
      errors.push('Weak identifiers require supplier_id for safe matching');
    }
  }
  if (n.country) {
    if (!normalizeCountryCode(n.country)) errors.push('Invalid country code');
  }
  return errors;
}
export type ApiPreviewMatcher = (t: string | null, v: string | null, supplierId: string | null) => Promise<string | null>;
export async function previewApiImportRows(resolved: ApiResolverResult, opts?: { matcher?: ApiPreviewMatcher }): Promise<ApiImportPreview> {
  const matcher: ApiPreviewMatcher = opts && opts.matcher ? opts.matcher : async () => null;
  const items: ApiImportPreviewItem[] = [];
  let seq = 0;
  const push = (raw: any, normalized: any, errors: string[], notes: string[], matchedId: string | null, confidence: number) => {
    seq += 1;
    const hasId = !!(normalized.identifier_type && normalized.identifier_value);
    let status: GlobalImportPreviewItem['matchStatus'] = 'new';
    if (errors.length) status = 'possible_match';
    else if (matchedId) status = 'matched';
    else if (!hasId) status = 'possible_match';
    items.push({ sourceRow: seq, raw: raw || {}, normalized, errors, notes, matchStatus: status, matchedGlobalProductId: matchedId, confidence });
  };
  for (const r of resolved.rows || []) {
    const n = toImportRow(r.row);
    const errors = validateRow(n);
    const notes: string[] = [];
    for (const u of r.unsupported || []) notes.push('Unsupported ' + u.field + ' kept as note: ' + u.reason);
    if (errors.length) { push(r.raw, n, errors, notes, null, 0); continue; }
    const t = n.identifier_type ? normalizeIdentifierType(n.identifier_type) : null;
    const v = n.identifier_value ? normalizeIdentifierValue(n.identifier_value) : null;
    const supplierId = n.supplier_id || null;
    let matchedId: string | null = null;
    if (t && v) { try { matchedId = await matcher(t, v, supplierId); } catch { matchedId = null; } }
    push(r.raw, n, [], notes, matchedId, matchedId ? 100 : 0);
  }
  for (const e of resolved.errors || []) {
    seq += 1;
    const reasons = (e.reasons && e.reasons.length ? e.reasons : ['Invalid row']).map(String);
    items.push({ sourceRow: seq, raw: {}, normalized: {}, errors: reasons, notes: [], matchStatus: 'possible_match', matchedGlobalProductId: null, confidence: 0 });
  }
  let valid = 0;
  let invalid = 0;
  let matched = 0;
  let reviewRequired = 0;
  let createdNew = 0;
  for (const it of items) {
    if (it.errors.length) invalid += 1;
    else valid += 1;
    if (it.matchStatus === 'matched') matched += 1;
    else if (it.matchStatus === 'possible_match') reviewRequired += 1;
    else createdNew += 1;
  }
  return { items, summary: { total: items.length, valid, invalid, matched, reviewRequired, new: createdNew }, source: 'api' };
}