/**
 * PHASE B2-B5 — DIRECT MÉTRÉ presentation adapter (pure, DB-free).
 *
 * The ONLY module of the Direct flow that touches the existing machinery:
 *   - quantity:      `evaluateElement` (engine = single source of truth),
 *   - bindings:      `computeMetreBoundOutputs` (never re-implemented),
 *   - fiscal:        `computeFiscalData` — CALL-ONLY (calculations.ts frozen),
 *   - Devis mapping: same shape as `CalculatorTab.handleAddAllToDevis`,
 *   - WhatsApp:      a `CalculationResult` presentation DTO for the
 *                    EXISTING global formatter (formatter never modified).
 *
 * HARD CONTRACTS:
 *   - ZERO trade-specific branches: everything derives from the element
 *     definition supplied by the caller (`if (trade === …)` is forbidden).
 *   - No price, no binding, no fiscal value is ever invented: missing data
 *     surfaces as the existing REVIEW issues / country fiscal defaults.
 *   - `metreEngine.ts` and `calculations.ts` are imported, never modified.
 */
import type {
  CalculationResult,
  CountryCode,
  DevisItem,
  MaterialItemResult,
  MaterialRate,
} from '../types';
import type {
  MetreElementDef,
  QtyCalcSpec,
} from '../data/metreElements';
import {
  isValidMetreElementShape,
} from '../data/metreElements';
import { evaluateElement, type MetreQtyError } from './metreEngine';
import { computeMetreBoundOutputs, type MetreCalculationOutput } from './metreToCalculationResult';
import { computeFiscalData } from './calculations';
import { getCountryConfig } from '../data/countryConfig';

// ── Quantity (engine-driven, live) ──────────────────────────────────────────

export interface DirectQuantityOk {
  ok: true;
  qty: number;
  unit: string;
  /** Human formula from the ELEMENT DEFINITION (never fabricated by the UI). */
  formula: string;
  /** Presentation breakdown derived from the declared calc spec + raw dims. */
  breakdown: string;
  /**
   * B6.2 — data-driven enriched stage list for presentation ONLY.
   * Derived from the element's own OPTIONAL metadata in the engine's fixed
   * order (openings → deductions → layers → coverage/yield → waste). A stage
   * appears ONLY when the definition actually declares an EFFECTIVE value
   * (disabled/empty/neutral blocks are reported as capability, never as an
   * applied deduction). Quantities stay engine-owned; never recomputed here.
   */
  stages: DirectEnrichedStage[];
}

/** One presentation stage of the enriched chain (B6.2, labels + flags only). */
export interface DirectEnrichedStage {
  /** Stable stage key in engine order. */
  key: 'gross' | 'openings' | 'deductions' | 'layers' | 'coverage' | 'waste' | 'final';
  /** French label for the Direct result panel. */
  labelFr: string;
  /** Arabic label for the Direct result panel. */
  labelAr: string;
  /**
   * Whether the stage actually transformed the quantity. `false` means the
   * capability is declared but neutral (e.g. disabled/empty openings,
   * layers 1, no waste) — the UI must never show it as an applied deduction.
   */
  effective: boolean;
  /** Short human detail from the definition (counts, factors — never prices). */
  detail: string;
}

export interface DirectQuantityError {
  ok: false;
  /** Machine reason straight from the engine. */
  error: string;
  message: string;
  badDims: string[];
  formula: string;
}

export type DirectQuantityResult = DirectQuantityOk | DirectQuantityError;

/** Initial form values from the element's declared defaults (missing ⇒ ''). */
export function buildDirectDefaults(element: MetreElementDef): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of element?.dims ?? []) {
    if (!d) continue;
    out[d.key] = d.default != null ? String(d.default) : '';
  }
  return out;
}

function dimLabelOf(element: MetreElementDef, key: string): string {
  const d = (element?.dims ?? []).find((x) => x && x.key === key);
  return (d && d.labelFr) || key;
}

function readable(raw: unknown): string {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  return Number.isFinite(n) ? n.toFixed(2) : String(raw ?? '');
}

/**
 * B6.2 — data-driven enriched stage list (presentation labels + flags only).
 * Derived from the element's own OPTIONAL metadata in the engine's fixed
 * order. `effective=false` marks a declared-but-neutral capability (disabled
 * or empty openings/deductions, layers ≤ 1, no waste/coverage) so the UI can
 * mention the capability WITHOUT showing a fake applied deduction. No
 * arithmetic is duplicated here; quantities stay engine-owned.
 */
export function buildDirectStages(element: MetreElementDef): DirectEnrichedStage[] {
  const stages: DirectEnrichedStage[] = [
    { key: 'gross', labelFr: 'Surface brute', labelAr: 'المساحة الإجمالية', effective: true, detail: '' },
  ];
  const openings = (element as { openings?: unknown })?.openings as
    | { enabled?: unknown; items?: unknown }
    | undefined
    | null;
  if (openings !== undefined && openings !== null) {
    const items = Array.isArray(openings.items) ? openings.items : [];
    const effective = openings.enabled !== false && items.length > 0;
    stages.push({
      key: 'openings',
      labelFr: 'Déduction ouvertures',
      labelAr: 'خصم الفتحات',
      effective,
      detail: effective ? `${items.length} ouverture(s) déclarée(s)` : 'déclarées mais neutres (désactivées/vides)',
    });
  }
  const deductions = (element as { deductions?: unknown })?.deductions as
    | { enabled?: unknown; items?: unknown }
    | undefined
    | null;
  if (deductions !== undefined && deductions !== null) {
    const items = Array.isArray(deductions.items) ? deductions.items : [];
    const effective = deductions.enabled !== false && items.length > 0;
    stages.push({
      key: 'deductions',
      labelFr: 'Déductions',
      labelAr: 'الخصومات',
      effective,
      detail: effective ? `${items.length} déduction(s) déclarée(s)` : 'déclarées mais neutres (désactivées/vides)',
    });
  }
  const layersRaw = (element as { layers?: unknown })?.layers;
  if (layersRaw !== undefined && layersRaw !== null) {
    const layers = Number(layersRaw);
    const effective = Number.isFinite(layers) && layers > 1;
    stages.push({
      key: 'layers',
      labelFr: 'Couches',
      labelAr: 'الطبقات',
      effective,
      detail: Number.isFinite(layers) ? `× ${String(layersRaw)} couche(s)` : 'déclarées mais invalides (moteur seul décide)',
    });
  }
  const coverage = (element as { coveragePerProductUnit?: unknown; yieldPerUnit?: unknown })?.coveragePerProductUnit
    ?? (element as { yieldPerUnit?: unknown })?.yieldPerUnit;
  if (coverage !== undefined && coverage !== null) {
    stages.push({
      key: 'coverage',
      labelFr: 'Conversion rendement',
      labelAr: 'تحويل المردود',
      effective: true,
      detail: '÷ rendement déclaré',
    });
  }
  const waste = Number((element as { wastePercent?: unknown })?.wastePercent);
  if (Number.isFinite(waste) && waste > 0) {
    stages.push({
      key: 'waste',
      labelFr: 'Chute',
      labelAr: 'الفاقد',
      effective: true,
      detail: `+ ${String((element as { wastePercent?: unknown }).wastePercent)} %`,
    });
  }
  return stages;
}

/**
 * B6.1 — data-driven enriched tail (presentation labels only).
 * Lists declared stages; neutral ones are marked as such. No arithmetic
 * is duplicated here; quantities stay engine-owned.
 */
function buildEnrichedTail(element: MetreElementDef): string {
  const parts: string[] = [];
  for (const s of buildDirectStages(element)) {
    if (s.key === 'gross') continue;
    if (s.key === 'openings') parts.push(s.effective ? '− ouvertures' : '− ouvertures (neutres)');
    else if (s.key === 'deductions') parts.push(s.effective ? '− déductions' : '− déductions (neutres)');
    else if (s.key === 'layers') parts.push(s.effective ? s.detail : `${s.detail} (neutre)`);
    else if (s.key === 'coverage') parts.push('÷ rendement');
    else if (s.key === 'waste') parts.push(s.detail);
  }
  return parts.join(' ');
}

/** Actual waste % declared by the element (absent/invalid ⇒ 0, never invented). */
function elementWastePercent(element: MetreElementDef): number {
  const w = Number((element as { wastePercent?: unknown })?.wastePercent);
  return Number.isFinite(w) && w > 0 ? w : 0;
}

/**
 * Breakdown built ONLY from the whitelisted `calc` spec of the element
 * (single / product / perimeter_h) — the UI never invents arithmetic.
 *
 * B6.1 (presentation only): when the element declares enriched metadata
 * already supported by the engine (openings / deductions / layers /
 * coverage / waste), the data-driven tail lists which stages are present so
 * the user sees the actual chain that `evaluateElement` applied. The numeric
 * result itself always comes from `evaluateElement` — never recomputed here.
 */
function buildBreakdown(
  element: MetreElementDef,
  dims: Record<string, unknown>,
  qty: number,
  unit: string,
): string {
  const calc = element?.calc as QtyCalcSpec | undefined;
  const tail = `${qty.toFixed(2)} ${unit}`;
  const base = buildBaseBreakdown(element, dims, calc, tail);
  const enrichedTail = buildEnrichedTail(element);
  return enrichedTail ? `${base} • ${enrichedTail} = ${tail}` : base;
}

/** Base breakdown from the declared calc spec (pre-B6.1 behaviour). */
function buildBaseBreakdown(
  element: MetreElementDef,
  dims: Record<string, unknown>,
  calc: QtyCalcSpec | undefined,
  tail: string,
): string {
  if (!calc || typeof calc !== 'object' || !('op' in calc)) return tail;
  const pair = (key: string): string => `${dimLabelOf(element, key)} ${readable(dims[key])}`;
  switch (calc.op) {
    case 'single':
      return `${pair(calc.dim)} = ${tail}`;
    case 'perimeter_h':
      return `(${pair(calc.planeA)} + ${pair(calc.planeB)}) × 2 × ${pair(calc.height)} = ${tail}`;
    case 'product':
      return `${calc.dims.map(pair).join(' × ')} = ${tail}`;
    default:
      return tail;
  }
}

/**
 * Live quantity: delegates to the engine and only decorates the result with
 * the element's own formula + a spec-derived breakdown.
 */
export function buildDirectQuantity(
  element: MetreElementDef,
  dims: Record<string, unknown>,
): DirectQuantityResult {
  const formula = String(element?.qtyFormula ?? '');
  const r = evaluateElement(element, dims);
  if (!r.ok) {
    // Runtime correctness is guaranteed by `!r.ok`; the assertion is needed
    // because this project compiles WITHOUT strictNullChecks, where negated
    // union narrowing (`!r.ok` → error member) is not applied.
    const err = r as MetreQtyError;
    return { ok: false, error: err.error, message: err.message, badDims: err.badDims, formula };
  }
  const unit = String(r.unit);
  return {
    ok: true,
    qty: r.qty,
    unit,
    formula,
    breakdown: buildBreakdown(element, dims, r.qty, unit),
    // B6.2: stage list derived from the definition only; final qty/unit above
    // stay byte-identical to evaluateElement.
    stages: [...buildDirectStages(element), { key: 'final', labelFr: 'Quantité finale', labelAr: 'الكمية النهائية', effective: true, detail: `${r.qty.toFixed(2)} ${String(r.unit)}` }],
  };
}

/**
 * Error view of a quantity result (never null for an invalid measurement).
 *
 * The narrowing lives HERE, expressed as an explicit discriminant comparison
 * (`r.ok === true`), because this project compiles WITHOUT `strictNullChecks`
 * where `!r.ok` truthiness narrowing of a union member is not applied
 * consistently — the component consumes a pre-narrowed value instead.
 */
export function directQuantityError(
  r: DirectQuantityResult | null,
): DirectQuantityError | null {
  if (r === null) return null;
  if (r.ok === true) return null;
  // Runtime correctness is guaranteed by the check above; the assertion keeps
  // this compiling even where the compiler skips negated-union narrowing.
  return r as DirectQuantityError;
}

// ── M1-1 — Direct overrides (pure, data-driven, engine-frozen) ──────────────

/**
 * Optional enriched overrides for ONE Direct evaluation.
 *
 * Data-driven contract: an override is applied ONLY when the element itself
 * declares the matching capability block (openings / deductions / layers /
 * waste / coverage). A block the element does NOT declare can never be
 * switched on from here — the override is silently ignored so legacy
 * elements behave byte-identically with or without this argument.
 *
 * Validation uses the SAME `isValidMetreElementShape` contract as the
 * registry/import path: an invalid override value surfaces the engine's own
 * error (never a fallback, never a guess). No defaults are invented, the
 * calc operation is never changed, and no trade/code is ever read.
 */
export interface DirectOverrides {
  openings?: unknown;
  deductions?: unknown;
  layers?: unknown;
  wastePercent?: unknown;
  coveragePerProductUnit?: unknown;
  yieldPerUnit?: unknown;
}

/** Which override keys are declared as capability by the element. */
function declaredOverrideKeys(element: MetreElementDef): Set<string> {
  const keys = new Set<string>();
  if (element?.openings !== undefined && element.openings !== null) keys.add('openings');
  if (element?.deductions !== undefined && element.deductions !== null) keys.add('deductions');
  if (element?.layers !== undefined && element.layers !== null) keys.add('layers');
  if (element?.wastePercent !== undefined && element.wastePercent !== null) keys.add('wastePercent');
  if ((element as { coveragePerProductUnit?: unknown })?.coveragePerProductUnit !== undefined
    && (element as { coveragePerProductUnit?: unknown })?.coveragePerProductUnit !== null) keys.add('coveragePerProductUnit');
  if ((element as { yieldPerUnit?: unknown })?.yieldPerUnit !== undefined
    && (element as { yieldPerUnit?: unknown })?.yieldPerUnit !== null) keys.add('yieldPerUnit');
  return keys;
}

/**
 * Resolve the EFFECTIVE element for one Direct evaluation (M1-3).
 *
 * Pure, data-driven, engine-frozen: overrides apply ONLY to blocks the
 * element itself declares; undeclared blocks are ignored (never invented).
 * Returns the ORIGINAL element reference when nothing applies (legacy path),
 * the merged element when at least one declared override applies, or `null`
 * when the merged shape fails the shared validator (caller surfaces the
 * engine error — never a fallback).
 */
export function resolveDirectEffectiveElement(args: {
  element: MetreElementDef;
  dims?: Record<string, unknown>;
  overrides?: DirectOverrides | null;
}): MetreElementDef | null {
  const { element, overrides } = args;
  const declared = declaredOverrideKeys(element);
  const over = (overrides && typeof overrides === 'object' ? overrides : {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...(element as unknown as Record<string, unknown>) };
  let applied = false;
  for (const key of ['openings', 'deductions', 'layers', 'wastePercent', 'coveragePerProductUnit', 'yieldPerUnit'] as const) {
    if (over[key] === undefined) continue;
    if (!declared.has(key)) continue; // undeclared capability ⇒ ignored, never invented
    merged[key] = over[key];
    applied = true;
  }
  if (!applied) return element;
  const candidate = {
    method: (merged as { method?: unknown }).method,
    dims: (merged as { dims?: unknown }).dims,
    calc: (merged as { calc?: unknown }).calc,
    qtyUnit: (merged as { unit?: unknown }).unit,
    openings: (merged as { openings?: unknown }).openings,
    deductions: (merged as { deductions?: unknown }).deductions,
    layers: (merged as { layers?: unknown }).layers,
    wastePercent: (merged as { wastePercent?: unknown }).wastePercent,
    coveragePerProductUnit: (merged as { coveragePerProductUnit?: unknown }).coveragePerProductUnit,
    yieldPerUnit: (merged as { yieldPerUnit?: unknown }).yieldPerUnit,
    workType: (merged as { workType?: unknown }).workType,
  };
  if (!isValidMetreElementShape(candidate)) return null;
  return merged as unknown as MetreElementDef;
}

/**
 * Evaluate with optional enriched overrides.
 *
 * - No overrides (or overrides only for undeclared blocks) ⇒ byte-identical
 *   to `evaluateElement(element, dims)` (the legacy reference).
 * - Override for a declared block ⇒ the SAME shape validator runs on the
 *   merged element, then the SAME `evaluateElement` computes the quantity.
 * - Invalid override value ⇒ the engine's own error is returned
 *   (`invalid_openings/deductions/layers/waste/yield`), never inventé.
 *
 * M1-3: quantity, breakdown AND stages ALL derive from the SAME effective
 * element — never quantity-from-override + stages-from-original.
 */
export function buildDirectOverrides(args: {
  element: MetreElementDef;
  dims: Record<string, unknown>;
  overrides?: DirectOverrides | null;
}): DirectQuantityResult {
  const { element, dims } = args;
  const formula = String(element?.qtyFormula ?? '');
  const effective = resolveDirectEffectiveElement(args);
  if (effective === null) {
    const r = evaluateElement({ ...(element as unknown as Record<string, unknown>), ...(args.overrides as Record<string, unknown>) } as unknown as MetreElementDef, dims);
    if (!r.ok) {
      const err = r as MetreQtyError;
      return { ok: false, error: err.error, message: err.message, badDims: err.badDims, formula };
    }
    return { ok: false, error: 'invalid_dim', message: 'Invalid enriched override', badDims: [], formula };
  }
  if (effective === element) return buildDirectQuantity(element, dims);
  const r = evaluateElement(effective, dims);
  if (!r.ok) {
    const err = r as MetreQtyError;
    return { ok: false, error: err.error, message: err.message, badDims: err.badDims, formula };
  }
  const unit = String(r.unit);
  return {
    ok: true,
    qty: r.qty,
    unit,
    formula,
    breakdown: buildBreakdown(effective, dims, r.qty, unit),
    stages: [...buildDirectStages(effective), { key: 'final', labelFr: 'Quantité finale', labelAr: 'الكمية النهائية', effective: true, detail: `${r.qty.toFixed(2)} ${String(r.unit)}` }],
  };
}

// ── Materials / Services (bindings — never re-implemented) ──────────────────

export type DirectBoundOutput = MetreCalculationOutput;

export interface DirectBoundArgs {
  element: MetreElementDef;
  dims: Record<string, unknown>;
  lines: Array<{ qty: number; unit: string }>;
  rates: MaterialRate[];
}

/** Thin delegation to the existing bindings computation (Phase 2.2 loop). */
export function buildDirectBoundOutput(args: DirectBoundArgs): DirectBoundOutput {
  return computeMetreBoundOutputs({
    metreElement: args.element,
    metreDims: args.dims as Record<string, any>,
    metreLines: args.lines,
    rates: args.rates,
  });
}

/**
 * M1-3 — effective downstream helper.
 *
 * Resolves the SAME effective element used for quantity, so bindings,
 * waste passthrough and the WhatsApp DTO all derive from ONE calculation.
 * Labels (trade/code/labelFr/qtyFormula) are identity — unchanged by
 * overrides — so the DTO shape and Devis titles stay byte-compatible.
 * Pure, data-driven, no trade/code branch.
 */
export function resolveDirectDownstreamElement(args: {
  element: MetreElementDef;
  overrides?: DirectOverrides | null;
}): MetreElementDef {
  const effective = resolveDirectEffectiveElement({ element: args.element, overrides: args.overrides });
  return effective === null ? args.element : effective;
}

/** Material subtotal (TND) from the binding output — nothing invented. */
export function sumMaterialTotals(items: readonly MaterialItemResult[] | undefined): number {
  let sum = 0;
  for (const item of items ?? []) {
    if (item && Number.isFinite(item.totalTnd)) sum += item.totalTnd;
  }
  return Math.round(sum * 1000) / 1000;
}

// ── Fiscalité (computeFiscalData — CALL-ONLY, country defaults) ────────────

export interface DirectFiscal {
  totalMaterialTnd: number;
  estimatedLaborTnd: number;
  /** Sous-total HT (= computeFiscalData grandTotalTnd). */
  sousTotalHtTnd: number;
  tvaPercent: number;
  tvaAmountTnd: number;
  timbreFiscalTnd: number;
  retenueGarantiePercent: number;
  retenueGarantieTnd: number;
  totalTtcTnd: number;
  netAPayerTnd: number;
}

/**
 * Fiscal chain for the Direct flow: material subtotal + (unpriced) labour
 * through the SAME authority the official calculators use. Options come from
 * the existing country fiscal data (`getCountryConfig`) — never hardcoded.
 */
export function buildDirectFiscal(
  totalMaterialTnd: number,
  estimatedLaborTnd: number,
  country: CountryCode,
): DirectFiscal {
  const cfg = getCountryConfig(country);
  const fiscal = computeFiscalData(totalMaterialTnd, estimatedLaborTnd, {
    tvaPercent: Number(cfg.defaultVatRate ?? 0) || 0,
    includeTimbre: Number(cfg.timbreFiscalDefault ?? 0) > 0,
    retenueGarantiePercent: Number(cfg.standardRetenueRate ?? 0) || 0,
  });
  return {
    totalMaterialTnd,
    estimatedLaborTnd,
    sousTotalHtTnd: fiscal.grandTotalTnd,
    tvaPercent: fiscal.tvaPercent,
    tvaAmountTnd: fiscal.tvaAmountTnd,
    timbreFiscalTnd: fiscal.timbreFiscalTnd,
    retenueGarantiePercent: fiscal.retenueGarantiePercent,
    retenueGarantieTnd: fiscal.retenueGarantieTnd,
    totalTtcTnd: fiscal.totalTtcTnd,
    netAPayerTnd: fiscal.netAPayerTnd,
  };
}

// ── Devis mapping (same shape as CalculatorTab.handleAddAllToDevis) ─────────

/**
 * Material lines → `DevisItem[]`. Titles carry the element's own label and
 * formula; prices come straight from the binding output (a zero price stays
 * zero — never invented). No labour line: this stage has no priced labour
 * rate (service bindings carry quantity only).
 */
export function buildDirectDevisItems(args: {
  tradeCode: string;
  element: MetreElementDef;
  materialItems: readonly MaterialItemResult[];
}): DevisItem[] {
  const stamp = Date.now();
  return (args.materialItems ?? []).map((item, index) => ({
    id: `${item.id}-${stamp}-${index}`,
    trade: args.tradeCode as DevisItem['trade'],
    title: `${item.nameFr} (${args.element.labelFr})`,
    quantity: item.qty,
    unit: item.unit,
    unitPrice: item.unitPriceTnd,
    total: item.totalTnd,
    unitPriceTnd: item.unitPriceTnd,
    totalTnd: item.totalTnd,
    details: item.formulaUsed
      ? `Métré: ${args.element.qtyFormula} • ${item.formulaUsed}`
      : `Métré: ${args.element.qtyFormula}`,
  }));
}

// ── WhatsApp presentation DTO (existing global formatter, unchanged) ────────

/**
 * `CalculationResult`-shaped DTO so `formatCalculationForWhatsApp` can render
 * the Direct result WITHOUT any formatter change. Fields are mapped from the
 * direct quantity + fiscal chain; `fieldNotes` carries the descriptor's
 * validation hints (data, not invention). `netAreaM2`/`areaM2` are only set
 * for m² results — the formatter's unit label is its own existing behaviour.
 */
export function buildDirectCalculationResult(args: {
  element: MetreElementDef;
  quantity: { qty: number; unit: string };
  materialItems: readonly MaterialItemResult[];
  fiscal: DirectFiscal;
  currency?: string;
  currencySymbol?: string;
  fieldNotes?: string[];
}): CalculationResult {
  const isArea = args.quantity.unit === 'm²';
  return {
    trade: args.element.trade as CalculationResult['trade'],
    subType: args.element.code,
    subTypeTitle: args.element.labelFr,
    areaM2: isArea ? args.quantity.qty : 0,
    netAreaM2: isArea ? args.quantity.qty : 0,
    perimeterM: 0,
    materialItems: [...args.materialItems],
    totalMaterialTnd: args.fiscal.totalMaterialTnd,
    estimatedLaborTnd: args.fiscal.estimatedLaborTnd,
    grandTotalTnd: args.fiscal.sousTotalHtTnd,
    // B6.1: actual waste % declared by the element definition (absent ⇒ 0).
    // Presentation passthrough only — fiscal math stays in computeFiscalData.
    wasteMarginPercent: elementWastePercent(args.element),
    fieldNotes: args.fieldNotes ?? [],
    tvaPercent: args.fiscal.tvaPercent,
    tvaAmountTnd: args.fiscal.tvaAmountTnd,
    timbreFiscalTnd: args.fiscal.timbreFiscalTnd,
    retenueGarantiePercent: args.fiscal.retenueGarantiePercent,
    retenueGarantieTnd: args.fiscal.retenueGarantieTnd,
    totalTtcTnd: args.fiscal.totalTtcTnd,
    netAPayerTnd: args.fiscal.netAPayerTnd,
    ...(args.currency !== undefined ? { currency: args.currency as CalculationResult['currency'] } : {}),
    ...(args.currencySymbol !== undefined ? { currencySymbol: args.currencySymbol } : {}),
  };
}


