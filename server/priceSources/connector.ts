/**
 * Step 9 — Multi-Market Price Source Connector Foundation.
 *
 * A thin, schema-free abstraction so the pricing system is not bound to a
 * single source or a single country. It defines WHAT a future price source
 * (Supplier API, CSV/Excel, official public data, website feed, manual admin)
 * must produce, and NORMALIZES that output into canonical Pending Price Update
 * candidates — WITHOUT ever touching `material_prices` or deciding that a
 * price is official.
 *
 * The immutable pipeline remains:
 *
 *   Connector (returns normalized candidates)
 *        ↓
 *   Pending Price Update (submitted via submitPendingPriceUpdate, Step 8)
 *        ↓
 *   Admin Review (Step 8 UI)
 *        ↓
 *   Approve (approvePendingPriceUpdate, Step 8)
 *        ↓
 *   Official Price
 *
 * DESIGN DECISIONS
 *   - NO schema change / NO migration. `price_sources` is kept as-is; the
 *     per-market/source *configuration* (which sources exist, for which
 *     market+currency, enabled or not) lives here as plain data in code so it
 *     can be extended without touching the database.
 *   - Material mapping uses the EXISTING bridge: `materials.code`. A known
 *     `materialCode` maps to the material; we never create a new material just
 *     because a source spells a name differently.
 *   - Market isolation is enforced by the normalized candidate shape: every
 *     candidate carries an explicit market (countryCode) + currencyCode, and a
 *     candidate may only be produced for the market(s)/currency(ies) its source
 *     declares. No TN/TND ⇄ FR/EUR mixing is possible.
 *   - A connector can only ever yield PENDING candidates (observedAt +
 *     sourceCode + pending-flagged). It has NO access to material_prices and
 *     cannot make anything official.
 *
 * This file is intentionally PURE (no network, no DB, no scheduling): real
 * fetching / scraping / cron / background workers are explicitly out of scope
 * for this step and will plug into this interface later.
 */

/** Canonical connector source kinds (extensible, not persisted). */
export type PriceSourceKind = 'supplier_api' | 'csv' | 'official_public' | 'website_feed' | 'manual_admin';

/** A declarative, per-market source registration (code, no DB). */
export interface PriceSourceSpec {
  code: string;           // stable identifier, e.g. 'SOURCE_FR_SUPPLIER_A'
  name: string;           // human label
  market: string;         // countryCode this source belongs to, e.g. 'FR'
  currency: string;       // currency it reports, e.g. 'EUR'
  kind: PriceSourceKind;
  enabled: boolean;
  /** priority hint used later by resolution logic (not yet wired). */
  priorityWeight?: number;
}

/** The normalized output of a connector — a canonical Pending Price candidate. */
export interface PriceCandidate {
  materialCode: string;   // must match an existing materials.code (the Step 5 bridge)
  market: string;         // countryCode, e.g. 'TN' | 'FR'
  currency: string;       // currencyCode, e.g. 'TND' | 'EUR'
  price: number;          // the proposed unit price (numeric)
  sourceCode: string;     // the PriceSourceSpec.code that produced this candidate
  observedAt: string;     // ISO timestamp when the price was observed/fetched
  effectiveFrom?: string; // optional proposed effective date (YYYY-MM-DD)
  notes?: string;
}

/** A PriceSourceConnector produces normalized candidate prices. It NEVER
 *  writes to material_prices and NEVER marks anything official — it only
 *  returns candidates to be routed into the pending/approval pipeline. */
export interface PriceSourceConnector {
  readonly spec: PriceSourceSpec;
  /** Fetch/read candidate prices and return them NORMALIZED as pending
   *  candidates. Implementations are expected to read external data here;
   *  for this foundation step only pure/mocked data is used. */
  fetchCandidates(): Promise<PriceCandidate[]> | PriceCandidate[];
}

/** ---------------------------------------------------------------------------
 * Config registry — the single, extensible place that declares which sources
 * exist for which market+currency. Adding a future market/source is a pure
 * data addition here; no schema change is ever required.
 * NOTE: deliberately NO fabricated placeholder sources — only well-defined,
 * real, enabled source registrations are listed.
 * --------------------------------------------------------------------------- */
export const PRICE_SOURCE_SPECS: PriceSourceSpec[] = [
  {
    code: 'SOURCE_TN_OFFICIAL',
    name: 'Tunisie — Barème Officiel KONSTRIVO',
    market: 'TN',
    currency: 'TND',
    kind: 'official_public',
    enabled: true,
    priorityWeight: 100,
  },
  {
    code: 'SOURCE_FR_OFFICIAL',
    name: 'France — Barème Officiel KONSTRIVO',
    market: 'FR',
    currency: 'EUR',
    kind: 'official_public',
    enabled: true,
    priorityWeight: 100,
  },
  {
    code: 'SOURCE_SA_GASTAT',
    name: 'Saudi Arabia — GASTAT: Monthly Average Prices for Selected Construction Materials',
    market: 'SA',
    currency: 'SAR',
    kind: 'official_public',
    enabled: true,
    priorityWeight: 100,
  },
  {
    code: 'SOURCE_MY_CIDB',
    name: 'Malaysia — CIDB N3C Building Material Price API',
    market: 'MY',
    currency: 'MYR',
    kind: 'supplier_api',
    enabled: true,
    priorityWeight: 100,
  },
  // Future real connectors (Supplier API / CSV / feed) are added here as new
  // PriceSourceSpec entries + a connector implementation. Example of the
  // intended shape (NOT added now — no fabricated/placeholder sources):
  // { code: 'SOURCE_FR_SUPPLIER_A', name: 'Fournisseur A — FR', market: 'FR',
  //   currency: 'EUR', kind: 'supplier_api', enabled: true }
];

/** Convenience lookup helpers. */
export function getPriceSourceSpec(code: string): PriceSourceSpec | undefined {
  return PRICE_SOURCE_SPECS.find(s => s.code === code);
}
export function getEnabledSourcesForMarket(market: string): PriceSourceSpec[] {
  return PRICE_SOURCE_SPECS.filter(s => s.enabled && s.market.toUpperCase() === market.toUpperCase());
}

/** ---------------------------------------------------------------------------
 * Pure normalization — the ONLY thing a connector is allowed to do with its
 * raw output before it enters the pending pipeline. It:
 *   1. validates market+currency are declared by the source spec
 *   2. rejects candidates whose market/currency mix with the spec's
 *   3. validates materialCode + price + observedAt
 *   4. returns a canonical PriceCandidate (never touches material_prices)
 * --------------------------------------------------------------------------- */
export function normalizeConnectorCandidate(
  spec: PriceSourceSpec,
  raw: Partial<PriceCandidate> & { materialCode?: string; price?: unknown },
): PriceCandidate {
  if (!spec.enabled) {
    throw new Error(`Price source '${spec.code}' is disabled`);
  }
  const materialCode = raw.materialCode || '';
  if (!materialCode.trim()) {
    throw new Error(`[${spec.code}] missing materialCode`);
  }
  const market = (raw.market || spec.market).toUpperCase();
  const currency = (raw.currency || spec.currency).toUpperCase();
  // Market/currency isolation: a source may ONLY produce prices for the market
  // and currency it declares. TN/TND can never be produced by an FR/EUR source.
  if (market !== spec.market.toUpperCase()) {
    throw new Error(`[${spec.code}] market '${market}' does not match source market '${spec.market}'`);
  }
  if (currency !== spec.currency.toUpperCase()) {
    throw new Error(`[${spec.code}] currency '${currency}' does not match source currency '${spec.currency}'`);
  }
  const price = Number(raw.price);
  if (!Number.isFinite(price) || price < 0) {
    throw new Error(`[${spec.code}] invalid price for '${materialCode}': ${raw.price}`);
  }
  const observedAt = raw.observedAt || new Date().toISOString();
  return {
    materialCode,
    market,
    currency,
    price,
    sourceCode: spec.code,
    observedAt,
    effectiveFrom: raw.effectiveFrom,
    notes: raw.notes,
  };
}
