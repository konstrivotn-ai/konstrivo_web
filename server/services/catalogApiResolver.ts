// @ts-nocheck
/**
 * Global Catalog - API Resolver (PURE, READ-ONLY).
 * JSON + saved mapping -> GlobalImportRow candidates + row errors.
 * No fetch, no import, no sync, no DB, no network.
 */
import type { CatalogSourceApiMapping } from '../repositories/globalCatalogRepository';
import type { GlobalImportRow } from './globalCatalogImport';
import { normalizeIdentifierType, normalizeIdentifierValue } from './globalCatalogValidation';

export const API_RESOLVER_MAX_PRODUCTS = 500;
export const API_RESOLVER_MAX_VALUE_LENGTH = 1000;

const DIRECT_ROW_FIELDS = new Set([
  'name',
  'brand',
  'manufacturer',
  'category',
  'subcategory',
  'description',
  'unit',
  'sku',
]);

const UNSUPPORTED_PRODUCT_FIELDS = new Set(['price', 'currency', 'availability']);
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

export type ApiResolverUnsupportedInfo = { field: string; path: string; reason: string; value?: string };
export type ApiResolverRow = { index: number; row: GlobalImportRow; unsupported: ApiResolverUnsupportedInfo[]; raw: Record<string, string> };
export type ApiResolverRowError = { index: number; reasons: string[] };
export type ApiResolverResult = { total: number; accepted: number; rejected: number; rows: ApiResolverRow[]; errors: ApiResolverRowError[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function getApiPathValue(document: unknown, path: string): unknown {
  const raw = String(path ?? '').trim();
  if (!raw) return undefined;
  let current: unknown = document;
  const segments = raw.split('.');
  for (const segment of segments) {
    if (!segment) return undefined;
    const bracketAt = segment.indexOf('[');
    const base = bracketAt === -1 ? segment : segment.slice(0, bracketAt);
    const rest = bracketAt === -1 ? '' : segment.slice(bracketAt);
    if (!base) return undefined;
    if (rest) {
      let i = 0;
      let ok = true;
      while (i < rest.length) {
        if (rest[i] !== '[') { ok = false; break; }
        const close = rest.indexOf(']', i + 1);
        if (close === -1) { ok = false; break; }
        const num = rest.slice(i + 1, close);
        if (!num || !/^[0-9]+$/.test(num)) { ok = false; break; }
        i = close + 1;
      }
      if (!ok || i !== rest.length) return undefined;
    }
    if (FORBIDDEN_SEGMENTS.has(base)) throw new Error('Resolver: forbidden path segment "' + base + '"');
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    if (Array.isArray(current)) return undefined;
    const holder = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(holder, base)) return undefined;
    current = holder[base];
    if (rest) {
      let i = 0;
      while (i < rest.length) {
        const close = rest.indexOf(']', i + 1);
        const at = Number(rest.slice(i + 1, close));
        if (!Array.isArray(current)) return undefined;
        if (!Number.isInteger(at) || at < 0 || at >= current.length) return undefined;
        current = (current as unknown[])[at];
        i = close + 1;
      }
    }
  }
  return current;
}

function hasBadChars(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function unsupportedReason(field: string): string {
  if (field === 'price') return 'price is not stored on global_products/GlobalImportRow; kept as unsupported info only (never read as a price)';
  if (field === 'currency') return 'currency is not stored on global_products/GlobalImportRow; kept as unsupported info only';
  return 'availability needs a country scope (GlobalImportRow.country + available); a single mapped value cannot set it, so it is kept as unsupported info for review';
}
export function resolveApiResponse(document: unknown, mapping: CatalogSourceApiMapping): ApiResolverResult {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new Error('Resolver: mapping must be an object');
  const root = String((mapping as any).root ?? '').trim();
  const collection = String((mapping as any).collection ?? '').trim();
  const fields = (mapping as any).fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('Resolver: mapping.fields must be an object');
  const entries = Object.entries(fields as Record<string, unknown>);
  if (entries.length === 0) throw new Error('Resolver: mapping.fields is empty');
  if (!Object.prototype.hasOwnProperty.call(fields, 'name')) throw new Error('Resolver: mapping must contain the "name" field');
  for (const p of Object.values(fields as Record<string, unknown>)) {
    for (const seg of String(p ?? '').split('.')) {
      const base = seg.split('[')[0];
      if (FORBIDDEN_SEGMENTS.has(base)) throw new Error('Resolver: forbidden path segment "' + base + '"');
    }
  }
  const rootNode: unknown = root ? getApiPathValue(document, root) : document;
  if (rootNode === undefined || rootNode === null) throw new Error('Resolver: root path "' + root + '" not found');
  const list: unknown = collection ? getApiPathValue(rootNode, collection) : rootNode;
  if (!Array.isArray(list)) throw new Error('Resolver: collection did not resolve to an array');
  if (list.length > API_RESOLVER_MAX_PRODUCTS) throw new Error('Resolver: collection holds ' + list.length + ' products, above cap ' + API_RESOLVER_MAX_PRODUCTS);
  const rows: ApiResolverRow[] = [];
  const errors: ApiResolverRowError[] = [];
  for (let index = 0; index < list.length; index++) {
    const product = list[index];
    const reasons: string[] = [];
    if (!isPlainObject(product)) { errors.push({ index, reasons: ['product entry is not a JSON object'] }); continue; }
    const row: GlobalImportRow = {};
    const unsupported: ApiResolverUnsupportedInfo[] = [];
    const raw: Record<string, string> = {};
    for (const entry of entries) {
      const fieldKey = String(entry[0]);
      const fieldPath = String(entry[1] ?? '').trim();
      if (!fieldPath) { reasons.push('empty response path for "' + fieldKey + '"'); continue; }
      let value: unknown;
      try { value = getApiPathValue(product, fieldPath); }
      catch (err: any) { reasons.push(String(err && err.message ? err.message : err)); continue; }
      if (value === undefined || value === null) continue;
      if (typeof value === 'object') { reasons.push('field "' + fieldKey + '" resolved to a non-scalar value (objects/arrays rejected)'); continue; }
      const text = String(value).trim();
      if (!text) continue;
      if (text.length > API_RESOLVER_MAX_VALUE_LENGTH) { reasons.push('field rejected: exceeds limit'); continue; }
      if (hasBadChars(text)) { reasons.push('field rejected: control characters'); continue; }
      raw[fieldKey] = text;
      if (UNSUPPORTED_PRODUCT_FIELDS.has(fieldKey)) { unsupported.push({ field: fieldKey, path: fieldPath, reason: unsupportedReason(fieldKey), value: text }); continue; }
      if (fieldKey === 'gtin') {
        const t = normalizeIdentifierType('gtin');
        const v = normalizeIdentifierValue(text);
        if (!t || !v) { reasons.push('invalid gtin value'); continue; }
        row.identifier_type = t;
        row.identifier_value = v;
        continue;
      }
      if (DIRECT_ROW_FIELDS.has(fieldKey)) { (row as any)[fieldKey] = text; continue; }
      unsupported.push({ field: fieldKey, path: fieldPath, reason: 'field "' + fieldKey + '" has no GlobalImportRow column; kept as unsupported info only', value: text });
    }
    const nameVal = (row as any).name;
    const name = (nameVal === undefined || nameVal === null) ? '' : String(nameVal).trim();
    if (!name) { reasons.push('Missing name'); }
    else { (row as any).name = name; }
    if (reasons.length) { errors.push({ index, reasons }); continue; }
    rows.push({ index, row, unsupported, raw });
  }
  return { total: list.length, accepted: rows.length, rejected: errors.length, rows, errors };
}
