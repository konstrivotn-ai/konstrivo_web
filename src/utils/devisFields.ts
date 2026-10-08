/**
 * Phase 1 — Devis field mapping & normalization helpers (client side).
 *
 * Small explicit mapping for the Devis flow ONLY:
 *  - date normalization to `YYYY-MM-DD` (required by `<input type="date">`),
 *  - reference fallback (`reference || devisNumber`),
 *  - company field resolution (currentUser → built-in defaults; NO DB fields
 *    are added for company data),
 *  - status enum mapping (client: brouillon/envoye/valide ↔ server: draft/sent/validated),
 *  - numeric coercion (Postgres `numeric` columns arrive as strings).
 *
 * No calculation logic lives here — totals are recomputed by DevisTab exactly
 * as before.
 */
import type { DevisDocument, DevisItem } from '../types';

// ── Built-in company placeholders (used ONLY when no user data exists) ─────
export const DEFAULT_COMPANY_NAME = 'KONSTRIVO BTP PRO';
export const DEFAULT_COMPANY_PHONE = '+216 71 000 000';
export const DEFAULT_COMPANY_MATRICULE = '1849204/A/M/000';
export const DEFAULT_COMPANY_ADDRESS = 'Tunis - Région Tunis Grand';

/** True when the Devis still shows the built-in default company identity. */
export function isDefaultCompanyName(name: unknown): boolean {
  return !name || name === DEFAULT_COMPANY_NAME;
}

// ── Date ────────────────────────────────────────────────────────────────────

/**
 * Normalize any stored date value (Date object, ISO timestamp, `YYYY-MM-DD`,
 * legacy `DD/MM/YYYY` or JS date string) to `YYYY-MM-DD`.
 * Returns `''` when the value is missing or unparsable, so the native date
 * input never falls back to its empty `jj/mm/aaaa` placeholder while a valid
 * date exists.
 */
export function toIsoDate(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const legacy = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (legacy) {
    return `${legacy[3]}-${legacy[2].padStart(2, '0')}-${legacy[1].padStart(2, '0')}`;
  }
  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

// ── Reference ───────────────────────────────────────────────────────────────

/**
 * References already issued in this session. `makeDevisReference` retries
 * against this set so two consecutive NEW Devis can never share a reference
 * (a bare Math.random() draw can collide with an older one). The optional
 * `used` argument additionally excludes references already saved (e.g. the
 * localStorage history) so a fresh session cannot re-issue an older one.
 */
const issuedReferences = new Set<string>();

/** Client-side reference for a NEW Devis: `DEV-<year>-XXXX`. */
export function makeDevisReference(used?: Iterable<string>): string {
  const year = new Date().getFullYear();
  const taken = used ? new Set(used) : undefined;
  let ref = '';
  // Cap the retry loop for absolute safety — with 9000 combinations the guard
  // set would have to be nearly full before this ever matters.
  for (let i = 0; i < 10000; i++) {
    ref = `DEV-${year}-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!issuedReferences.has(ref) && !(taken && taken.has(ref))) break;
  }
  issuedReferences.add(ref);
  return ref;
}

/** Reference fallback chain: reference → devisNumber → empty string. */
export function resolveDevisReference(devis: Partial<DevisDocument> & { devisNumber?: string }): string {
  return devis.reference || devis.devisNumber || '';
}

// ── Status enum mapping ─────────────────────────────────────────────────────

const CLIENT_TO_SERVER_STATUS: Record<string, string> = {
  brouillon: 'draft',
  envoye: 'sent',
  valide: 'validated',
};
const SERVER_TO_CLIENT_STATUS: Record<string, string> = {
  draft: 'brouillon',
  sent: 'envoye',
  validated: 'valide',
};

/** Client status → server enum (server validates against draft/sent/validated/cancelled). */
export function mapDevisStatusToServer(status: unknown): string | undefined {
  if (status === null || status === undefined || status === '') return undefined;
  const s = String(status);
  return CLIENT_TO_SERVER_STATUS[s] || s;
}

/** Server status → client enum. */
export function mapDevisStatusToClient(status: unknown): string {
  const s = status === null || status === undefined ? '' : String(status);
  return SERVER_TO_CLIENT_STATUS[s] || 'brouillon';
}

// ── Numeric coercion ────────────────────────────────────────────────────────

/** Coerce Postgres numeric strings / numbers to a finite number (null otherwise). */
export function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ── Company fields (currentUser → defaults; no DB fields added) ────────────

/**
 * Resolve the company identity of a Devis: keep existing custom values, fill
 * gaps from the authenticated user profile, then fall back to the built-in
 * KONSTRIVO defaults. Mirrors the precedence of the `currentUser` effect in
 * App.tsx.
 */
export function resolveCompanyFields<T extends Record<string, any>>(devis: T, currentUser?: any): T {
  const d = { ...(devis as any) };
  if (!d.companyName) {
    d.companyName = currentUser?.companyName || currentUser?.company || DEFAULT_COMPANY_NAME;
  }
  if (!d.companyPhone) {
    d.companyPhone = currentUser?.phone || DEFAULT_COMPANY_PHONE;
  }
  if (!d.companyMatricule) {
    d.companyMatricule = currentUser?.matriculeFiscale || currentUser?.taxNumber || DEFAULT_COMPANY_MATRICULE;
  }
  if (!d.companyAddress) {
    d.companyAddress = currentUser?.company || currentUser?.region || DEFAULT_COMPANY_ADDRESS;
  }
  return d;
}

// ── Server → Client normalization ───────────────────────────────────────────

function normalizeItemFromServer(it: any): DevisItem & { materialId?: string; isCustomAdded?: boolean } {
  const quantity =
    toFiniteNumber(it?.billableQuantity) ??
    toFiniteNumber(it?.quantity) ??
    toFiniteNumber(it?.wasteIncludedQuantity) ??
    toFiniteNumber(it?.exactCalculatedQuantity) ??
    0;
  const unitPrice = toFiniteNumber(it?.unitPriceTnd ?? it?.unitPriceAppliedTnd ?? it?.unitPrice) ?? 0;
  const total = toFiniteNumber(it?.totalTnd ?? it?.totalPriceTnd ?? it?.total) ?? quantity * unitPrice;
  return {
    id: it?.id || `srv-${Math.random().toString(36).slice(2, 10)}`,
    materialId: it?.materialId || undefined,
    trade: (it?.trade as DevisItem['trade']) || 'placo',
    title: it?.title || '',
    quantity,
    unit: it?.unit || 'u',
    unitPrice,
    total,
    unitPriceTnd: unitPrice,
    totalTnd: total,
    unitPriceConverted: unitPrice,
    totalConverted: total,
    details: it?.details ?? it?.descriptionSnapshot ?? undefined,
    isCustomAdded: !!it?.isCustomAdded,
  };
}

/**
 * Normalize a Devis coming from the API (or localStorage) into the client
 * `DevisDocument` shape so no user-visible field is lost on load:
 * reference fallback, YYYY-MM-DD date, numeric coercion of totals/tax,
 * client status enum, mapped items and resolved company fields.
 */
export function normalizeDevisFromServer(raw: any, currentUser?: any): DevisDocument {
  const d: any = { ...(raw || {}) };
  const items: DevisItem[] = Array.isArray(d.items) ? d.items.map(normalizeItemFromServer) : [];
  const itemsSum = items.reduce((acc, it) => acc + (it.totalTnd ?? it.total ?? 0), 0);

  // Reference — fall back to the server numbering (devisNumber) when null.
  d.reference = resolveDevisReference(d);

  // Date — always YYYY-MM-DD for <input type="date">.
  d.date = toIsoDate(d.date) || new Date().toISOString().slice(0, 10);

  // Totals & tax — Postgres numeric columns arrive as strings.
  d.tvaPercent = toFiniteNumber(d.tvaPercent ?? d.taxRatePercent) ?? undefined;
  const grand = toFiniteNumber(d.grandTotalTnd ?? d.totalTnd ?? d.total);
  d.totalTnd = grand ?? 0;
  d.total = d.totalTnd;
  // Discount is not a DB column; it is recovered from the stored net-HT
  // snapshot (subtotal_before_tax_tnd = raw items total − discount).
  const netHt = toFiniteNumber(d.subtotalBeforeTaxTnd);
  d.discount = toFiniteNumber(d.discount) ?? (netHt !== null ? Math.max(0, itemsSum - netHt) : 0);
  d.subtotalMaterials = toFiniteNumber(d.subtotalMaterials ?? d.totalMaterialsCostTnd) ?? 0;
  d.subtotalLabor = toFiniteNumber(d.subtotalLabor ?? d.totalLaborCostTnd) ?? 0;
  d.timbreFiscal = toFiniteNumber(d.timbreFiscal ?? d.timbreFiscalTnd) ?? 0;
  d.timbreFiscalTnd = d.timbreFiscal;
  d.retenueGarantiePercent = toFiniteNumber(d.retenueGarantiePercent) ?? 0;

  d.status = mapDevisStatusToClient(d.status);
  d.items = items;

  // Company identity is NOT persisted server-side (no DB fields added) —
  // resolve from the current user, then fall back to the built-in defaults.
  return resolveCompanyFields(d, currentUser) as DevisDocument;
}

// ── Client → Server payload ─────────────────────────────────────────────────

/**
 * Build the payload sent to POST/PUT /api/v1/devis: explicit client→server
 * field mapping (status enum, YYYY-MM-DD date, guaranteed reference, numeric
 * totals). Keeps the API contract unchanged.
 */
export function toServerDevisPayload(devis: DevisDocument): Record<string, unknown> {
  const d: any = devis || {};
  return {
    reference: resolveDevisReference(d) || undefined,
    date: toIsoDate(d.date) || new Date().toISOString().slice(0, 10),
    clientName: d.clientName || undefined,
    clientPhone: d.clientPhone || undefined,
    clientAddress: d.clientAddress || undefined,
    projectTitle: d.projectTitle || undefined,
    country: d.country || 'TN',
    currency: d.currency || 'TND',
    region: d.region || undefined,
    items: Array.isArray(d.items) ? d.items : [],
    discount: toFiniteNumber(d.discount ?? d.discountTnd) ?? 0,
    tvaPercent: toFiniteNumber(d.tvaPercent) ?? 0,
    timbreFiscal: toFiniteNumber(d.timbreFiscalTnd ?? d.timbreFiscal) ?? 0,
    retenueGarantiePercent: toFiniteNumber(d.retenueGarantiePercent) ?? 0,
    totalTnd: toFiniteNumber(d.totalTnd) ?? toFiniteNumber(d.total) ?? 0,
    total: toFiniteNumber(d.total) ?? 0,
    subtotalMaterialsTnd: toFiniteNumber(d.subtotalMaterialsTnd) ?? undefined,
    subtotalLaborTnd: toFiniteNumber(d.subtotalLaborTnd) ?? undefined,
    status: mapDevisStatusToServer(d.status),
  };
}

