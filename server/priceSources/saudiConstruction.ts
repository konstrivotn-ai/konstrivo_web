/**
 * Step 13 — First VERIFIED external price connector: Saudi Arabia (GASTAT).
 *
 * SOURCE (verified real & official):
 *   General Authority for Statistics (GASTAT) — stats.gov.sa
 *   "Time Series of Monthly Average Prices for Selected Construction Materials
 *    in the Kingdom" — INDIVIDUAL material prices in SAR (monthly averages),
 *   published via the official GASTAT open-data portal (Excel/table download).
 *   This is NOT an index: each row is a price for ONE named material.
 *
 * ACCESS REALITY (verified during this step):
 *   GASTAT programmatic endpoints are WAF-protected and the open-data portal
 *   is an SPA. Per the step rules (no scraping, no cron, no fragile page
 *   parsing) this connector therefore ingests OFFICIALLY DOWNLOADED rows —
 *   the pure functions below consume records transcribed from the official
 *   GASTAT file. Live fetching is intentionally NOT implemented:
 *   fetchCandidates() throws with an explicit explanation instead of guessing.
 *
 * TRUSTED MATERIAL MAPPING (materials.code bridge — exact, never guessed):
 *   Only catalog materials whose GASTAT counterpart matches product AND unit
 *   1:1 are mapped today:
 *     - 'sac_ciment_50kg'      ← أسمنت بورتلاندي عادي، كيس 50 كجم (same unit: 50kg bag)
 *     - 'bloc_beton_20x20x40'  ← بلوك خرساني 20x20x40 سم          (same unit: the piece)
 *   Any other GASTAT row (rebar, sand, bricks, ready-mix…) is REJECTED and
 *   reported — a price for an unmapped material is NEVER invented. The label
 *   strings are documented exact-match keys: if the official file spells a
 *   label differently, integration = adding that exact string here (pure data
 *   addition) — runtime matching NEVER fuzzy-guesses.
 *
 * Pipeline (mandatory, unchanged):
 *   GASTAT → this connector → normalizeConnectorCandidate
 *     → submitPendingPriceUpdate → SUPPLIER_SUBMITTED → Admin Review
 *     → Approve → SUPPLIER_APPROVED → GET /prices?market=sa → Calculator
 *   The connector NEVER writes material_prices and NEVER makes a price official.
 *   Submission rows use sourceCode 'SUPPLIER_SUBMITTED' (the Step 8 pending
 *   convention + the only pending code seeded in price_sources) — the Saudi
 *   identity is preserved via sourceSpec/notes (same pattern as Step 11).
 */
import {
  PriceCandidate,
  PriceSourceConnector,
  PriceSourceSpec,
  getPriceSourceSpec,
  normalizeConnectorCandidate,
} from './connector';

/** The registered Saudi source (declared in connector.ts PRICE_SOURCE_SPECS). */
export const SA_GASTAT_SPEC_CODE = 'SOURCE_SA_GASTAT';

/** The registered Saudi source spec (identity: SA / SAR / official_public). */
export function getSaudiGastatSpec(): PriceSourceSpec {
  const spec = getPriceSourceSpec(SA_GASTAT_SPEC_CODE);
  if (!spec) throw new Error('SOURCE_SA_GASTAT spec is not registered in connector.ts');
  return spec;
}

/** One row transcribed from the official GASTAT monthly construction-materials table. */
export interface GastatRow {
  /** Official label as printed in the GASTAT table (Arabic and/or English). */
  label: string;
  /** Unit as printed (e.g. 'كيس 50 كجم', 'قطعة') — part of the trusted match. */
  unit?: string;
  /** Monthly average price in SAR as printed in the official file. */
  price: unknown;
  /** Reference month of the official figure, 'YYYY-MM' → effectiveFrom 'YYYY-MM-01'. */
  month?: string;
  /** Isolation guards: if present they MUST be SA / SAR. */
  market?: string;
  currency?: string;
  effectiveFrom?: string;
}

/** Normalize a label for EXACT matching only (no fuzzy/guess matching). */
function normLabel(s: string): string {
  return s.trim().replace(/\s+/g, ' ').replace(/×/g, 'x').replace(/ـ/g, '').toLowerCase();
}

/**
 * Deterministic numeric parse of an official GASTAT cell — no invention:
 * accepts a real number or a plain dot-decimal string only; anything else
 * becomes NaN and is rejected by normalizeConnectorCandidate (never guessed).
 */
function parseOfficialPrice(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return NaN;
}

interface GastatMappingEntry {
  /** Existing materials.code (the Step 5 bridge) — never invented. */
  materialCode: string;
  /** Why the unit matches 1:1 (no conversion, no invented math). */
  unitNote: string;
  /** Accepted GASTAT unit strings (normalized contains-match). */
  units: string[];
  /** Exact documented GASTAT labels (normalized equal-match). */
  labels: string[];
}

/**
 * The ONLY trusted mappings. Each entry maps a specific, documented GASTAT
 * product+unit to an existing catalog material with the SAME unit. Extending
 * this table later is a pure data addition — verify the exact label/unit in
 * the official GASTAT file first, then add it here. Everything else is rejected.
 */
const GASTAT_MATERIAL_MAPPING: GastatMappingEntry[] = [
  {
    materialCode: 'sac_ciment_50kg',
    unitNote: 'GASTAT quotes cement per 50kg bag — catalog unit is the same 50kg bag',
    units: ['كيس 50 كجم', 'كيس 50kg', 'bag 50kg', '50 كجم'],
    labels: [
      'أسمنت بورتلاندي عادي، كيس 50 كجم',
      'أسمنت عادي، كيس 50 كجم',
      'ordinary portland cement 50kg bag',
    ],
  },
  {
    materialCode: 'bloc_beton_20x20x40',
    unitNote: 'GASTAT quotes the concrete block per piece 20x20x40cm — catalog item is the same block',
    units: ['قطعة', 'piece', 'وحدة'],
    labels: [
      'بلوك خرساني 20x20x40 سم',
      'بلوك خرساني مقاس 20x20x40',
      'concrete block 20x20x40 cm',
    ],
  },
];

export interface GastatMapping {
  materialCode: string;
  unitNote: string;
}

/** STRICT mapping: exact normalized label + unit check. Unknown → undefined (never guessed). */
export function mapGastatRow(row: GastatRow): GastatMapping | undefined {
  const label = normLabel(row.label || '');
  if (!label) return undefined;
  const entry = GASTAT_MATERIAL_MAPPING.find(m => m.labels.some(l => normLabel(l) === label));
  if (!entry) return undefined; // unknown material → reject, never auto-map
  // The unit is part of the trusted 1:1 match and is REQUIRED: a row without a
  // unit is conservatively rejected (never assumed to be the catalog unit), and
  // the same product in a different unit is a different price — also rejected.
  if (!row.unit) return undefined;
  const unit = normLabel(row.unit);
  const unitOk = entry.units.some(u => unit.includes(normLabel(u)));
  if (!unitOk) return undefined; // same name but different unit → reject
  return { materialCode: entry.materialCode, unitNote: entry.unitNote };
}

/**
 * Boundary guard for OFFICIALLY DOWNLOADED GASTAT rows supplied by an authorized
 * caller (operator / cron / machine). Projects raw request input onto the
 * documented GastatRow shape ONLY — it never invents, coerces or repairs data:
 *   - rows without a usable `label` (the trusted-match key) are dropped;
 *   - rows without a `price` are dropped;
 *   - `price` is passed through untouched, so parseOfficialPrice() +
 *     normalizeConnectorCandidate() reject anything non-numeric;
 *   - unknown extra keys are ignored.
 * Whatever survives is still subject to the STRICT label+unit mapping below, so
 * unmapped rows are reported as rejected by buildSaudiGastatPendingPlan().
 */
export function toGastatRows(raw: unknown): GastatRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: GastatRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const label = typeof r.label === 'string' ? r.label.trim() : '';
    if (!label) continue;
    if (r.price === undefined || r.price === null) continue;
    rows.push({
      label,
      unit: typeof r.unit === 'string' ? r.unit : undefined,
      price: r.price,
      month: typeof r.month === 'string' ? r.month : undefined,
      market: typeof r.market === 'string' ? r.market : undefined,
      currency: typeof r.currency === 'string' ? r.currency : undefined,
      effectiveFrom: typeof r.effectiveFrom === 'string' ? r.effectiveFrom : undefined,
    });
  }
  return rows;
}

/**
 * Ingest spec: the REAL registered Saudi spec (SA/SAR) but with the Step 8
 * pending source code — 'SUPPLIER_SUBMITTED' is the only pending code seeded
 * in price_sources (FK) and the only one the Step 8 state machine recognizes
 * (listPrices exclusion + Admin review + approve). Mirrors Step 11.
 */
function ingestSpec(): PriceSourceSpec {
  const src = getSaudiGastatSpec();
  return { ...src, code: 'SUPPLIER_SUBMITTED', name: `GASTAT — ${src.name}` };
}

/** What the ingest layer submits — 1:1 with submitPendingPriceUpdate() input. */
export interface SaudiGastatSubmission {
  materialCode: string;
  price: number;
  countryCode: string;
  currencyCode: string;
  effectiveFrom?: string;
  notes?: string;
  /** The normalized Step 9 candidate this came from (audit trail). */
  candidate: PriceCandidate;
}

export interface SaudiGastatPendingPlan {
  /** Provenance: the REAL registered Saudi source (SOURCE_SA_GASTAT). */
  sourceSpec: PriceSourceSpec;
  /** The ingest spec actually used for normalization (SUPPLIER_SUBMITTED, SA/SAR). */
  spec: PriceSourceSpec;
  submissions: SaudiGastatSubmission[];
  /** Unmapped/invalid GASTAT rows with reasons — reported, NEVER guessed. */
  rejected: Array<{ label: string; reason: string }>;
  /** Compile-time proof: this connector can never produce an official price. */
  readonly official: false;
}

/** Feed OFFICIALLY DOWNLOADED GASTAT rows → normalized pending submissions. */
export function buildSaudiGastatPendingPlan(
  rows: GastatRow[],
  opts: { observedAt?: string } = {},
): SaudiGastatPendingPlan {
  const spec = ingestSpec();
  const plan: SaudiGastatPendingPlan = {
    sourceSpec: getSaudiGastatSpec(),
    spec,
    submissions: [],
    rejected: [],
    official: false,
  };
  for (const row of rows) {
    // Isolation guard FIRST: a row that claims another market/currency can
    // never be silently re-stamped into the SA/SAR spec — it is rejected
    // explicitly (FR never leaks into SA, and SA rows never adopt TN/TND).
    const rowMarket = (row.market || '').trim().toUpperCase();
    if (rowMarket && rowMarket !== spec.market.toUpperCase()) {
      plan.rejected.push({
        label: row.label || '',
        reason: `market mismatch: row declares '${rowMarket}' but this source only produces '${spec.market}'`,
      });
      continue;
    }
    const rowCurrency = (row.currency || '').trim().toUpperCase();
    if (rowCurrency && rowCurrency !== spec.currency.toUpperCase()) {
      plan.rejected.push({
        label: row.label || '',
        reason: `currency mismatch: row declares '${rowCurrency}' but this source only produces '${spec.currency}'`,
      });
      continue;
    }
    const mapping = mapGastatRow(row);
    if (!mapping) {
      plan.rejected.push({
        label: row.label || '',
        reason: 'unmapped GASTAT material — no trusted materials.code match (never guessed)',
      });
      continue;
    }
    // Deterministic parse of the official period — no fabricated dates.
    const effectiveFrom = row.effectiveFrom ||
      (row.month && /^\d{4}-\d{2}$/.test(row.month) ? `${row.month}-01` : undefined);
    try {
      const candidate = normalizeConnectorCandidate(spec, {
        materialCode: mapping.materialCode,
        price: parseOfficialPrice(row.price),
        observedAt: opts.observedAt,
        effectiveFrom,
        notes: `GASTAT monthly average (${mapping.unitNote})`,
      });
      plan.submissions.push({
        materialCode: candidate.materialCode,
        price: candidate.price,
        countryCode: candidate.market,
        currencyCode: candidate.currency,
        effectiveFrom: candidate.effectiveFrom,
        notes: candidate.notes,
        candidate,
      });
    } catch (err) {
      plan.rejected.push({ label: row.label || mapping.materialCode, reason: (err as Error).message });
    }
  }
  return plan;
}

/**
 * The connector object (Step 9 interface). fetchCandidates() intentionally
 * throws: GASTAT's official portal is WAF-protected and live HTTP/cron is out
 * of scope — ingest is done by feeding officially downloaded rows through
 * buildSaudiGastatPendingPlan() (pure, testable, no network). The connector
 * has NO write path: it cannot make anything official by construction.
 */
export function createSaudiGastatConnector(): PriceSourceConnector {
  return {
    spec: getSaudiGastatSpec(),
    fetchCandidates(): PriceCandidate[] {
      throw new Error(
        'SOURCE_SA_GASTAT live fetch is intentionally not implemented: GASTAT endpoints are WAF-protected. ' +
          'Ingest officially downloaded rows via buildSaudiGastatPendingPlan() → submitPendingPriceUpdate().',
      );
    },
  };
}


