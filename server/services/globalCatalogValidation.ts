// @ts-nocheck
/**
 * Phase 4 hardening — shared validation helpers (server-side).
 * Must be conservative and fail closed.
 */
import { isValidUuid } from '../utils/validation';

export const STRONG_IDENTIFIER_TYPES = new Set(['gtin', 'ean', 'upc']);
export const WEAK_IDENTIFIER_TYPES = new Set([
  'sku',
  'supplier_ref',
  'model',
  'manufacturer_ref',
  'other',
]);

export function normalizeCountryCode(code: unknown): string | null {
  const c = String(code ?? '').trim().toUpperCase();
  if (!c) return null;
  // conservative: ISO-3166-1 alpha-2 (plus allow 3-5 for existing app use)
  if (!/^[A-Z]{2,5}$/.test(c)) return null;
  return c;
}

export function clampConfidence(value: unknown, fallback = 100): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

export function validateConfidence(value: unknown): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

export function normalizeIdentifierType(value: unknown): string | null {
  const t = String(value ?? '').trim().toLowerCase();
  if (!t) return null;
  if (STRONG_IDENTIFIER_TYPES.has(t)) return t;
  if (WEAK_IDENTIFIER_TYPES.has(t)) return t;
  // allow custom but keep it conservative
  if (!/^[a-z0-9_]{2,40}$/.test(t)) return null;
  return t;
}

export function normalizeIdentifierValue(value: unknown): string | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (v.length > 255) return null;
  return v;
}

export function assertUuid(id: string, label = 'id') {
  if (!isValidUuid(id)) throw new Error(`Invalid ${label}`);
}
