/**
 * DYNAMIC MÉTRÉ — PHASE 1: quantity engine (ADDITIVE ONLY, PURE).
 *
 * Safe evaluation of element quantities from their structured, whitelisted
 * `calc` spec (see metreElements.ts). This is the first half of the generic
 * Métier → Méthode → Éléments → Dimensions → Quantité pipeline.
 *
 * Contracts:
 *   - WHITELIST ONLY: `single`, `product`, `perimeter_h` ops are the ONLY
 *     arithmetic performed. No `eval`, no `Function`, no dynamic dispatch
 *     beyond this fixed table — unknown ops return an error result.
 *   - Pure & testable: no I/O, no globals, no mutation of inputs.
 *   - NEVER touches `genericQty` / `calculateGeneric` (calculations.ts),
 *     prices, rules bridge, fiscal or Devis — those are later phases.
 *   - Never throws: invalid/missing dimensions are reported as results so UI
 *     can render a field note (same philosophy as the calculator).
 */

import type {
  MetreElementDef,
  QtyCalcSpec,
} from '../data/metreElements';

/** Dimensions supplied by the caller (raw — validated at runtime). */
export type MetreDims = Readonly<Record<string, unknown>>;

/** Successful evaluation: a quantity in the element's declared unit. */
export interface MetreQtyOk {
  ok: true;
  qty: number;
  unit: MetreElementDef['unit'];
}

/** Failed evaluation: machine-readable reason + human message. */
export interface MetreQtyError {
  ok: false;
  error:
    | 'missing_dim'
    | 'invalid_dim'
    | 'unsupported_op'
    | 'empty_calc'
    // PHASE 1 — enriched-specification failures (never silent, never invented).
    | 'invalid_openings'
    | 'invalid_deductions'
    | 'invalid_layers'
    | 'invalid_waste'
    | 'invalid_yield';
  message: string;
  /** Dimension keys that were missing or invalid (for field highlighting). */
  badDims: string[];
}

export type MetreQtyResult = MetreQtyOk | MetreQtyError;

/** One aggregated quantity line (used by aggregateQuantities). */
export interface MetreQtyLine {
  qty: number;
  unit: string;
}

/** Max decimals kept on computed quantities (float noise guard). */
const QTY_EPSILON_DECIMALS = 6;

/** Round to a stable precision without introducing display rounding policy. */
export function roundQty(value: number): number {
  const factor = 10 ** QTY_EPSILON_DECIMALS;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Read + validate one dimension. Numbers and numeric strings are accepted
 * (common for text inputs); negative / NaN / Infinity / non-numeric are not.
 */
function readDim(dims: MetreDims, key: string): { value: number } | { bad: true } {
  const raw = dims[key];
  if (raw === undefined || raw === null || raw === '') return { bad: true };
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(value) || value < 0) return { bad: true };
  return { value };
}

/** Keys referenced by the whitelisted spec (used for validation messages). */
function specKeys(calc: QtyCalcSpec): string[] {
  switch (calc.op) {
    case 'single':
      return [calc.dim];
    case 'product':
      return [...calc.dims];
    case 'perimeter_h':
      return [calc.planeA, calc.planeB, calc.height];
    default:
      return [];
  }
}

/** The ONLY arithmetic the engine performs — pure whitelist table. */
function applyCalc(calc: QtyCalcSpec, dims: MetreDims, bad: string[]): number | null {
  switch (calc.op) {
    case 'single': {
      const d = readDim(dims, calc.dim);
      if ('bad' in d) { bad.push(calc.dim); return null; }
      return d.value;
    }
    case 'product': {
      let acc = 1;
      for (const key of calc.dims) {
        const d = readDim(dims, key);
        if ('bad' in d) { bad.push(key); return null; }
        acc *= d.value;
      }
      return acc;
    }
    case 'perimeter_h': {
      const a = readDim(dims, calc.planeA);
      const b = readDim(dims, calc.planeB);
      const h = readDim(dims, calc.height);
      if ('bad' in a) bad.push(calc.planeA);
      if ('bad' in b) bad.push(calc.planeB);
      if ('bad' in h) bad.push(calc.height);
      if ('bad' in a || 'bad' in b || 'bad' in h) return null;
      return (a.value + b.value) * 2 * h.value;
    }
    default:
      return null; // unreachable for typed specs; guarded below at runtime
  }
}

/** Whitelist of ops the engine accepts at runtime (defence in depth). */
const ALLOWED_OPS = new Set(['single', 'product', 'perimeter_h']);

// ════════════════════════════════════════════════════════════════════════════
// PHASE 1 — ENRICHED SPECIFICATION COMPOSITION
//
// ONE fixed, documented chain applied AFTER the whitelisted `calc` step:
//   gross → − openings → − deductions → × layers → ÷ yield → × (1 + waste)
//
// HARD RULES honoured here:
//   - nothing is invented: an absent optional block contributes EXACTLY 1
//     (layers) / 1.0 (waste factor) / 0 (openings, deductions) — never a guess;
//   - the result is clamped at 0, so openings/deductions never go negative;
//   - no new arithmetic: only + − × ÷ and Math.max. No eval, no Function,
//     no dynamic dispatch — the whitelist above is untouched;
//   - waste is applied at exactly ONE point, at the very end, never twice.
// ════════════════════════════════════════════════════════════════════════════

/** Area of one opening: explicit area wins, else width × height. Never guessed. */
function openingArea(o: any): number {
  if (typeof o?.areaM2 === 'number' && Number.isFinite(o.areaM2) && o.areaM2 > 0) return o.areaM2;
  const w = Number(o?.width);
  const h = Number(o?.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return NaN;
  return w * h;
}

/** Total declared opening area (0 when the block is absent or explicitly off). */
function totalOpenings(spec: any): number {
  if (!spec || typeof spec !== 'object') return 0;
  if (spec.enabled === false) return 0;
  const items = Array.isArray(spec.items) ? spec.items : [];
  let total = 0;
  for (const it of items) {
    const area = openingArea(it);
    if (!Number.isFinite(area)) return NaN; // invalid item → whole spec refused
    const count = it?.count === undefined || it?.count === null ? 1 : Number(it.count);
    if (!Number.isFinite(count) || count <= 0) return NaN;
    total += area * count;
  }
  return total;
}

/** Total declared deduction (0 when absent / off). Never implicit. */
function totalDeductions(spec: any, unit: string): number {
  if (!spec || typeof spec !== 'object') return 0;
  if (spec.enabled === false) return 0;
  const items = Array.isArray(spec.items) ? spec.items : [];
  let total = 0;
  for (const it of items) {
    // Phase 1.1 explicit deduction amount+unit
    if (it?.amount !== undefined && it?.amount !== null) {
      const amount = Number(it.amount);
      const u = String(it.unit || '');
      if (!Number.isFinite(amount) || amount < 0) return NaN;
      if (!u || u !== unit) return NaN;
      if (amount === 0) return NaN;
      total += amount;
      continue;
    }

    // Legacy fallback
    const q = it?.quantity === undefined || it?.quantity === null ? 0 : Number(it.quantity);
    const a = it?.areaM2 === undefined || it?.areaM2 === null ? 0 : Number(it.areaM2);
    if (!Number.isFinite(q) || q < 0) return NaN;
    if (!Number.isFinite(a) || a < 0) return NaN;
    if (q === 0 && a === 0) return NaN;
    // Legacy safety: area deductions require m² elements; quantity deductions require same unit.
    if (a > 0 && unit !== 'm²') return NaN;
    total += q + a;
  }
  return total;
}

/** Composition outcome: the quantity/unit actually returned to the caller. */
interface Composed {
  ok: boolean;
  qty?: number;
  unit?: MetreElementDef['unit'];
  error?: MetreQtyError['error'];
  message?: string;
}

/**
 * Apply the enriched spec to a validated gross quantity.
 * `ok:false` carries a machine-readable reason — an invalid spec is REFUSED,
 * never silently corrected into a plausible number.
 */
function compose(def: MetreElementDef, gross: number): Composed {
  const unit = def.unit;
  let value = gross;

  // 1) Openings — a surface concept; never subtracted from a length/volume/count.
  if (def.openings !== undefined && def.openings !== null) {
    const openings = totalOpenings(def.openings);
    if (!Number.isFinite(openings)) {
      return { ok: false, error: 'invalid_openings', message: 'Ouvertures invalides (dimensions ou surface absente/négative).' };
    }
    if (openings > 0 && unit !== 'm²') {
      return { ok: false, error: 'invalid_openings', message: `Des ouvertures (m²) exigent un élément de surface, unité « ${unit} ».` };
    }
    value -= openings;
  }

  // 2) Deductions — explicit only, never confused with waste.
  if (def.deductions !== undefined && def.deductions !== null) {
    const ded = totalDeductions(def.deductions, unit);
    if (!Number.isFinite(ded)) {
      return { ok: false, error: 'invalid_deductions', message: 'Déductions invalides (valeur négative ou sans quantité).' };
    }
    value -= ded;
  }

  // 3) Layers — absent = 1, i.e. NO multiplication at all.
  let layers = 1;
  if (def.layers !== undefined && def.layers !== null) {
    const l = Number(def.layers);
    if (!Number.isFinite(l) || !Number.isInteger(l) || l < 1) {
      return { ok: false, error: 'invalid_layers', message: `Nombre de couches invalide: ${def.layers} (entier ≥ 1 attendu).` };
    }
    layers = l;
  }
  value *= layers;

  // 4) Coverage — specification-driven conversion. No default, no invented factor.
  let outUnit: MetreElementDef['unit'] = unit;
  const cov: any = (def as any).coveragePerProductUnit ?? (def as any).yieldPerUnit;
  if (cov !== undefined && cov !== null) {
    const y: any = cov;
    const yv = Number(y?.value);
    if (!Number.isFinite(yv) || yv <= 0) {
      return { ok: false, error: 'invalid_yield', message: `Rendement invalide: ${y?.value} (valeur > 0 attendue).` };
    }
    if (typeof y?.unit !== 'string' || !String(y.unit).trim() || typeof y?.basis !== 'string' || !String(y.basis).trim()) {
      return { ok: false, error: 'invalid_yield', message: 'Couverture incomplète (unité et base obligatoires).' };
    }
    // The basis must match what we actually measured, else the conversion would
    // silently invent a factor. Fail closed instead.
    if (y.basis !== unit) {
      return { ok: false, error: 'invalid_yield', message: `Rendement basé sur « ${y.basis} » mais élément mesuré en « ${unit} ».` };
    }
    value = value / yv;
    outUnit = y.unit as MetreElementDef['unit'];
  }

  // 5) Waste — the SINGLE application point, applied last, at most once.
  let wasteFactor = 1;
  if (def.wastePercent !== undefined && def.wastePercent !== null) {
    const w = Number(def.wastePercent);
    if (!Number.isFinite(w) || w < 0) {
      return { ok: false, error: 'invalid_waste', message: `Chute invalide: ${def.wastePercent}% (valeur ≥ 0 attendue).` };
    }
    wasteFactor = 1 + w / 100;
  }
  value *= wasteFactor;

  if (!Number.isFinite(value)) {
    return { ok: false, error: 'invalid_dim', message: 'Quantité non finie calculée' };
  }
  // Clamp: openings/deductions can NEVER produce a negative quantity. This is
  // the documented safety net for an over-declared surface (e.g. openings
  // larger than the gross measured area) — the result floors at 0, it is never
  // reported as a negative quantity.
  return { ok: true, qty: Math.max(0, value), unit: outUnit };
}

/**
 * Evaluate the quantity of one element from its declared dimensions.
 *
 * Rules:
 *   - every dimension declared on the element must be present and valid
 *     (missing keys, '', null, NaN, Infinity and negatives are errors);
 *   - the spec's `op` must be in the whitelist (never evaluated as code);
 *   - the result is float-noise rounded (`roundQty`), never display-rounded.
 */
export function evaluateElement(def: MetreElementDef, dims: MetreDims): MetreQtyResult {
  const calc = def?.calc as QtyCalcSpec | undefined;
  if (!calc || typeof calc !== 'object' || !('op' in calc)) {
    return { ok: false, error: 'empty_calc', message: 'Aucune formule de quantité définie', badDims: [] };
  }
  if (!ALLOWED_OPS.has(String((calc as { op?: unknown }).op))) {
    return {
      ok: false,
      error: 'unsupported_op',
      message: `Opération de calcul non autorisée: ${String((calc as { op?: unknown }).op)}`,
      badDims: [],
    };
  }

  // Validate every declared dimension, then evaluate the whitelisted spec.
  const bad: string[] = [];
  for (const dim of def.dims ?? []) {
    const read = readDim(dims, dim.key);
    if ('bad' in read && !bad.includes(dim.key)) bad.push(dim.key);
  }
  const referenced = specKeys(calc);
  if (referenced.length === 0 || (calc.op === 'product' && calc.dims.length === 0)) {
    return { ok: false, error: 'empty_calc', message: 'Formule de quantité vide', badDims: bad };
  }

  const qty = applyCalc(calc, dims, bad);
  if (qty === null) {
    const unique = [...new Set(bad)];
    const labels = new Map<string, string>();
    for (const d of def.dims ?? []) if (d) labels.set(d.key, d.labelFr || d.key);
    const missing = unique.map((k) => labels.get(k) ?? k);
    return {
      ok: false,
      error: 'missing_dim',
      message: `Dimensions manquantes ou invalides: ${missing.join(', ')}`,
      badDims: unique,
    };
  }
  if (!Number.isFinite(qty)) {
    return { ok: false, error: 'invalid_dim', message: 'Quantité non finie calculée', badDims: bad };
  }

  // ── PHASE 1 — enriched specification (openings/deductions/layers/coverage/yield/waste)
  // FAST PATH: an element that declares NONE of them is untouched — the exact
  // expression below is what ran before Phase 1, byte for byte.
  // NOTE (targeted fix): `coveragePerProductUnit` MUST be listed here — it is
  // the Phase 1.1 preferred coverage field implemented in `compose()` below.
  // Without it, a coverage-only element silently skipped the conversion and
  // returned the raw quantity in the measured unit (bug: 20 m² instead of 2 L).
  // Elements that do NOT declare it are bit-for-bit unaffected.
  const hasEnrichedSpec =
    def.openings !== undefined && def.openings !== null
    || def.deductions !== undefined && def.deductions !== null
    || def.layers !== undefined && def.layers !== null
    || def.coveragePerProductUnit !== undefined && def.coveragePerProductUnit !== null
    || def.yieldPerUnit !== undefined && def.yieldPerUnit !== null
    || def.wastePercent !== undefined && def.wastePercent !== null;
  if (!hasEnrichedSpec) {
    return { ok: true, qty: roundQty(qty), unit: def.unit };
  }

  const composed = compose(def, qty);
  if (!composed.ok) {
    return { ok: false, error: composed.error ?? 'invalid_dim', message: composed.message ?? 'Spécification invalide', badDims: [] };
  }
  return { ok: true, qty: roundQty(composed.qty as number), unit: composed.unit as MetreElementDef['unit'] };
}


/**
 * Aggregate quantity lines by unit: { 'm²': 12.5, 'ml': 8 }.
 * Pure, order-insensitive per unit, float-noise rounded per bucket.
 * Lines with non-finite quantities or empty units are ignored (defensive,
 * matching the calculator's "never crash the UI" philosophy).
 */
export function aggregateQuantities(lines: readonly MetreQtyLine[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const line of lines ?? []) {
    if (!line) continue;
    const unit = String(line.unit ?? '').trim();
    const qty = Number(line.qty);
    if (!unit || !Number.isFinite(qty)) continue;
    totals[unit] = roundQty((totals[unit] ?? 0) + qty);
  }
  return totals;
}

