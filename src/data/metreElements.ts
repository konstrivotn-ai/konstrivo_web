/**
 * DYNAMIC MÉTRÉ — PHASE 1: general element registry (ADDITIVE ONLY).
 *
 * Generic data layer for the future Métier → Méthode → Éléments → Dimensions →
 * Quantité pipeline. It mirrors the proven `tradeServices.ts` pattern:
 * elements are ASSOCIATED with trades through configuration, never through
 * `if (trade === ...)` branches in engine code.
 *
 * Contracts:
 *   - NO logic here — only types, data and pure lookup helpers.
 *   - NO trade-specific engine special-casing: any métier (official or
 *     dynamic) is just another key in `METRE_ELEMENTS`.
 *   - `qtyFormula` is a HUMAN-READABLE label only; the evaluated quantity
 *     comes from the structured, whitelisted `calc` spec (see metreEngine.ts).
 *   - Nothing here is consumed by CalculatorTab yet (Phase 2+). The 12
 *     official calculators, `genericQty`, `calculateGeneric`, prices, Devis,
 *     rules bridge and DB are untouched.
 */

import { catalogKey } from '../utils/catalogDisplay';

/** Méthode de métré — how quantities are derived for an element. */
export type MetreMethod =
  | 'surface' // L × l (× count)
  | 'longueur' // single linear dimension
  | 'unite' // piece/point count
  | 'volume' // L × l × h
  | 'perimetre_hauteur'; // (a + b) × 2 × h

/** One editable dimension of an element (UI label + unit hint + default). */
export interface ElementDim {
  /** Key referenced by the calc spec and by `dims` in `evaluateElement`. */
  key: string;
  labelFr: string;
  labelAr: string;
  /** Dimension unit for display only — the engine does not convert units. */
  unit: 'm' | 'm²' | 'm³' | 'unit' | 'mm';
  /** Optional default value (never auto-submitted by the engine). */
  default?: number;
}

/**
 * Whitelisted quantity calculation — STRUCTURED spec, never a string that is
 * `eval`ed. Unknown `op` values are rejected at runtime by the engine.
 */
export type QtyCalcSpec =
  /** Quantity = value of a single dimension (longueur / unité). */
  | { op: 'single'; dim: string }
  /** Quantity = product of the listed dimensions (surface / volume / count). */
  | { op: 'product'; dims: string[] }
  /** Quantity = (planeA + planeB) × 2 × height (perimeter × hauteur). */
  | { op: 'perimeter_h'; planeA: string; planeB: string; height: string };

/**
 * Unit of the computed quantity (also the unit of Devis/price matching).
 *
 * PHASE 1 — additive: `kg`, `L` and `point` are added ONLY because the new
 * yield-based specification can legitimately produce them (enduit in kg, paint
 * in litres, electrical points). They are never produced implicitly: a unit
 * only appears in a result when the specification explicitly declares it.
 */
export type MetreQtyUnit = 'm²' | 'ml' | 'm³' | 'unit' | 'kg' | 'L' | 'point';

// ════════════════════════════════════════════════════════════════════════════
// PHASE 1 — ENRICHED SPECIFICATION (ADDITIVE ONLY)
// ────────────────────────────────────────────────────────────────────────────
// Everything below is OPTIONAL. An element that declares none of these fields
// evaluates EXACTLY as before — same code path, same result, byte-identical.
//
// The enriched fields are DECLARATIVE DATA on the element, never new logic
// branches keyed by métier. The engine applies them in ONE fixed order:
//
//   gross → − openings → − deductions → × layers → ÷ yield → × (1 + waste)
//
// Preconditions that keep the data honest:
//   - nothing is ever invented: an absent field means "not configured", and
//     contributes EXACTLY nothing (never an implicit 1, 0% or 1 m²);
//   - the result is clamped at 0 so openings/deductions can never produce a
//     negative quantity;
//   - every value is validated by `isValidMetreElementShape` BEFORE any
//     evaluation, so an invalid specification degrades to "rejected", never to
//     a silently wrong number.
// ════════════════════════════════════════════════════════════════════════════

/** One measurable opening (porte / fenêtre / baie) declared by the element. */
export interface MetreOpening {
  /** Free label, informational only (never used in arithmetic). */
  type?: string;
  width?: number;
  height?: number;
  /** Repetition count. Defaults to 1 ONLY when the opening itself is declared. */
  count?: number;
  /** Explicit area — takes precedence over width × height when provided. */
  areaM2?: number;
}

/** Structured openings block. Absent ⇒ element has no openings (unchanged). */
export interface MetreOpeningsSpec {
  enabled?: boolean;
  /**
   * 'area'        — every item carries its own areaM2 (or width × height).
   * 'dimensions'  — opening areas are computed from width × height.
   * Purely descriptive: both modes accept both forms; it records INTENT so the
   * UI/report can explain the calculation. It never changes the arithmetic.
   */
  mode?: 'area' | 'dimensions';
  items?: MetreOpening[];
}

/** One explicit deduction (existant, réservation, niche…) — never implicit. */
export interface MetreDeduction {
  type?: string;
  /**
   * Phase 1.1 — explicit deduction amount WITH unit.
   * This is the preferred, fail-closed form.
   */
  amount?: number;
  unit?: MetreQtyUnit;
  /** Legacy fields kept for backward compatibility (do not author new data). */
  quantity?: number;
  areaM2?: number;
}

/** Explicit deductions, independent from openings. Absent ⇒ no deduction. */
export interface MetreDeductionsSpec {
  enabled?: boolean;
  items?: MetreDeduction[];
}

/**
 * Specification-driven coverage / yield.
 * `value` is how many `unit` of product are needed per ONE `unit` of measured
 * quantity — e.g. peinture: { value: 10, unit: 'L', basis: 'm²' } reads
 * "1 litre covers 10 m²", so quantity = measured / 10.
 * NEVER a default: without this field no conversion happens at all.
 */
/**
 * Phase 1.1 — explicit coverage semantics.
 * Meaning: 1 product unit covers `value` of the measured `basis`.
 * Example: { value: 10, unit: 'L', basis: 'm²' } ⇒ 1 L covers 10 m².
 */
export type MetreCoverageSpec = {
  value: number;
  unit: MetreQtyUnit;
  basis: MetreQtyUnit;
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 1 — OPTIONAL WORK-TYPE DESCRIPTOR (ADDITIVE ONLY, DESCRIPTIVE ONLY)
// ────────────────────────────────────────────────────────────────────────────
// `MetreWorkTypeSpec` DESCRIBES a métier / type de travail — identity,
// bilingual labels, measurement approach, methodology, references and soft
// hints. It is pure metadata:
//   - it is NEVER read by `metreEngine.ts`; the engine stays generic and
//     data-driven (definition + calculation spec only);
//   - it NEVER participates in the calculation chain
//     (gross → openings → deductions → layers → coverage/yield → waste);
//   - no `if (trade === …)` / `switch (trade)` is ever keyed off this spec;
//   - an element that declares no `workType` at all evaluates byte-identically
//     to today (the field is entirely optional).
// ════════════════════════════════════════════════════════════════════════════

/**
 * Descriptive definition of a work type (type de travail). OPTIONAL on
 * `MetreElementDef`. This interface never executes anything — it only records
 * what the work type IS, so richer métier definitions can be added later
 * without touching the engine or any existing element.
 */
export interface MetreWorkTypeSpec {
  /** Stable work-type code (e.g. 'cloison_ba13') — identity only, never branched on. */
  code: string;
  labelFr: string;
  labelAr: string;
  /** Measurement approach of this work type (descriptive reference only). */
  measurementMethod?: MetreMethod;
  /** Free-text methodology (how the work type is measured / executed). */
  methodology?: string;
  /** Norms, standards or references (NF, DTU, ISO, client spec …). */
  norms?: string[];
  /** Soft validation hints surfaced by UI/reporting — never enforced by the engine. */
  validationHints?: string[];
  /**
   * Optional duration hint. The current system has NO scheduling concept, so
   * this is descriptive data only (`unit` is free text: 'h', 'h/m²', 'j' …)
   * and is never converted, summed or displayed by Phase 1.
   */
  durationHint?: { value: number; unit: string };
}

/** One measurable element of a métier. */
export interface MetreElementDef {
  /** Unique within its trade (e.g. 'panneau_ba13'). */
  code: string;
  /** Trade code ('placo', 'hvac', ...) — identity only, NEVER branched on. */
  trade: string;
  labelFr: string;
  labelAr: string;
  method: MetreMethod;
  /** Declared editable dimensions; all must be provided to evaluate. */
  dims: ElementDim[];
  /** Structured whitelist spec actually evaluated by the engine. */
  calc: QtyCalcSpec;
  /** Readable formula (documentation / UI hint) — NOT evaluated. */
  qtyFormula: string;
  /** Unit of the computed quantity. */
  unit: MetreQtyUnit;
  /**
   * Optional waste % hint — PHASE 1: NOW APPLIED by the engine, at ONE single
   * point (the last step of the composition chain). Declared but previously
   * inert; an element that omits it is unaffected.
   *   0 = no waste · 10 = +10% · negative = rejected by the validator.
   */
  wastePercent?: number;
  /** Optional link to an existing `calc_slots.code` (Phase 3+ material match). */
  linkedSlotCode?: string;

  // ── PHASE 1 — enriched specification (all OPTIONAL, all additive) ────────
  /** Structured openings deducted from the gross quantity. */
  openings?: MetreOpeningsSpec;
  /** Explicit deductions, independent from openings. */
  deductions?: MetreDeductionsSpec;
  /** Repetition count (coats / layers). Absent ⇒ exactly 1 (no multiplication). */
  layers?: number;
  /**
   * Phase 1.1 preferred field: explicit coverage (basis-per-product-unit).
   * measured / coverage.value = product qty.
   */
  coveragePerProductUnit?: MetreCoverageSpec;

  /** BACKWARD-COMPAT ONLY (deprecated): legacy name kept without migration. */
  yieldPerUnit?: MetreCoverageSpec;

  // Phase 2 optional bindings (declarative; server persists on trade_metre_elements)
  materialBindings?: unknown;
  serviceBindings?: unknown;

  // ── PHASE 1 — work-type descriptor (OPTIONAL, ADDITIVE, DESCRIPTIVE ONLY) ──
  // Pure metadata describing the work type. NEVER read by the engine, NEVER
  // part of the calculation chain, NEVER branched on by trade. Absent ⇒ the
  // element behaves exactly as it does today.
  workType?: MetreWorkTypeSpec;
}

/**
 * Registry: métier code → its elements. Adding a métier = adding an entry —
 * no engine change, no UI branch, no Admin dependency required.
 * Seed data below is intentionally minimal and exists ONLY to exercise the
 * engine and its tests.
 */
export const METRE_ELEMENTS: Record<string, readonly MetreElementDef[]> = {
  /**
   * Menuiserie Aluminium — DYNAMIC métier (generic branch only; no trade
   * branch exists anywhere). Elements mirror the production classifications:
   * the 21 trade codes with label_fr "Aluminium" (GET /api/v1/trades — see
   * PROJECT_STATE.md «Trade-identity / aluminium» audit) + the CSV
   * classification `aluminium`. Every spelling reaches this entry through
   * `METRE_ELEMENT_ALIASES` below — barème code → element:
   *   portes → porte · fenêtres → fenetre · baies vitrées → baie_vitree ·
   *   coulissants → coulissant · châssis → chassis ·
   *   profilés (+ dormants/ouvrants/coulissants), rails, montants, traverses
   *     → profil · cornières → corniere · joints → joint · vitrage → vitrage ·
   *   quincaillerie, fermetures, accessoires → quincaillerie ·
   *   consommables, protection, finition → consommable.
   * No `linkedSlotCode` yet: `calc_slots` (migration 0009) seeds no aluminium
   * slot — Phase 3 material matching stays untouched.
   */
  aluminium: [
    {
      code: 'porte',
      trade: 'aluminium',
      labelFr: 'Porte aluminium',
      labelAr: 'باب ألمنيوم',
      method: 'surface',
      dims: [
        { key: 'largeur', labelFr: 'Largeur', labelAr: 'العرض', unit: 'm', default: 0.9 },
        { key: 'hauteur', labelFr: 'Hauteur', labelAr: 'الارتفاع', unit: 'm', default: 2.1 },
        { key: 'nb', labelFr: 'Nombre', labelAr: 'العدد', unit: 'unit', default: 1 },
      ],
      calc: { op: 'product', dims: ['largeur', 'hauteur', 'nb'] },
      qtyFormula: 'Largeur × Hauteur × Nb',
      unit: 'm²',
      // B6.1 — ILLUSTRATIVE / TEST-ONLY enriched metadata (not an official
      // norm, price or specification): an explicitly EMPTY openings block and
      // a neutral layers:1, both contributing EXACTLY nothing per the engine
      // contract (absent/empty = 0 openings, layers 1 = no multiplication).
      // Proves the enriched chain is reachable + displayed on ONE element
      // while keeping its quantity byte-identical (1.89 m²). Base semantics
      // (method/dims/calc/unit) are unchanged.
      openings: { enabled: false, items: [] },
      layers: 1,
    },
    {
      code: 'fenetre',
      trade: 'aluminium',
      labelFr: 'Fenêtre aluminium',
      labelAr: 'نافذة ألمنيوم',
      method: 'surface',
      dims: [
        { key: 'largeur', labelFr: 'Largeur', labelAr: 'العرض', unit: 'm', default: 1.2 },
        { key: 'hauteur', labelFr: 'Hauteur', labelAr: 'الارتفاع', unit: 'm', default: 1.4 },
        { key: 'nb', labelFr: 'Nombre', labelAr: 'العدد', unit: 'unit', default: 1 },
      ],
      calc: { op: 'product', dims: ['largeur', 'hauteur', 'nb'] },
      qtyFormula: 'Largeur × Hauteur × Nb',
      unit: 'm²',
    },
    {
      code: 'baie_vitree',
      trade: 'aluminium',
      labelFr: 'Baie vitrée',
      labelAr: 'فتحة زجاجية منزلقة',
      method: 'surface',
      dims: [
        { key: 'largeur', labelFr: 'Largeur', labelAr: 'العرض', unit: 'm', default: 2.4 },
        { key: 'hauteur', labelFr: 'Hauteur', labelAr: 'الارتفاع', unit: 'm', default: 2.2 },
        { key: 'nb', labelFr: 'Nombre', labelAr: 'العدد', unit: 'unit', default: 1 },
      ],
      calc: { op: 'product', dims: ['largeur', 'hauteur', 'nb'] },
      qtyFormula: 'Largeur × Hauteur × Nb',
      unit: 'm²',
    },
    {
      code: 'coulissant',
      trade: 'aluminium',
      labelFr: 'Coulissant',
      labelAr: 'وحدة منزلقة',
      method: 'surface',
      dims: [
        { key: 'largeur', labelFr: 'Largeur', labelAr: 'العرض', unit: 'm', default: 1.6 },
        { key: 'hauteur', labelFr: 'Hauteur', labelAr: 'الارتفاع', unit: 'm', default: 1.4 },
        { key: 'nb', labelFr: 'Nombre', labelAr: 'العدد', unit: 'unit', default: 1 },
      ],
      calc: { op: 'product', dims: ['largeur', 'hauteur', 'nb'] },
      qtyFormula: 'Largeur × Hauteur × Nb',
      unit: 'm²',
    },
    {
      code: 'chassis',
      trade: 'aluminium',
      labelFr: 'Châssis',
      labelAr: 'إطار ألمنيوم',
      method: 'surface',
      dims: [
        { key: 'largeur', labelFr: 'Largeur', labelAr: 'العرض', unit: 'm', default: 1.2 },
        { key: 'hauteur', labelFr: 'Hauteur', labelAr: 'الارتفاع', unit: 'm', default: 1.4 },
        { key: 'nb', labelFr: 'Nombre', labelAr: 'العدد', unit: 'unit', default: 1 },
      ],
      calc: { op: 'product', dims: ['largeur', 'hauteur', 'nb'] },
      qtyFormula: 'Largeur × Hauteur × Nb',
      unit: 'm²',
    },
    {
      code: 'profil',
      trade: 'aluminium',
      labelFr: 'Profilé aluminium',
      labelAr: 'بروفيل ألمنيوم',
      method: 'longueur',
      dims: [{ key: 'longueur', labelFr: 'Longueur', labelAr: 'الطول', unit: 'm' }],
      calc: { op: 'single', dim: 'longueur' },
      qtyFormula: 'Longueur',
      unit: 'ml',
    },
    {
      code: 'vitrage',
      trade: 'aluminium',
      labelFr: 'Vitrage',
      labelAr: 'زجاج',
      method: 'surface',
      dims: [
        { key: 'largeur', labelFr: 'Largeur', labelAr: 'العرض', unit: 'm' },
        { key: 'hauteur', labelFr: 'Hauteur', labelAr: 'الارتفاع', unit: 'm' },
        { key: 'nb', labelFr: 'Nombre', labelAr: 'العدد', unit: 'unit', default: 1 },
      ],
      calc: { op: 'product', dims: ['largeur', 'hauteur', 'nb'] },
      qtyFormula: 'Largeur × Hauteur × Nb',
      unit: 'm²',
    },
    {
      code: 'corniere',
      trade: 'aluminium',
      labelFr: 'Cornière aluminium',
      labelAr: 'زاوية ألمنيوم',
      method: 'longueur',
      dims: [{ key: 'longueur', labelFr: 'Longueur', labelAr: 'الطول', unit: 'm' }],
      calc: { op: 'single', dim: 'longueur' },
      qtyFormula: 'Longueur',
      unit: 'ml',
    },
    {
      code: 'joint',
      trade: 'aluminium',
      labelFr: 'Joint',
      labelAr: 'حشوة مطاطية',
      method: 'longueur',
      dims: [{ key: 'longueur', labelFr: 'Longueur', labelAr: 'الطول', unit: 'm' }],
      calc: { op: 'single', dim: 'longueur' },
      qtyFormula: 'Longueur',
      unit: 'ml',
    },
    {
      code: 'quincaillerie',
      trade: 'aluminium',
      labelFr: 'Quincaillerie & fermetures',
      labelAr: 'إكسسوارات وقوافل',
      method: 'unite',
      dims: [{ key: 'nombre', labelFr: 'Nombre', labelAr: 'العدد', unit: 'unit', default: 1 }],
      calc: { op: 'single', dim: 'nombre' },
      qtyFormula: 'Nombre',
      unit: 'unit',
    },
    {
      code: 'consommable',
      trade: 'aluminium',
      labelFr: 'Consommables & finition',
      labelAr: 'مستهلكات وتشطيب',
      method: 'unite',
      dims: [{ key: 'nombre', labelFr: 'Nombre', labelAr: 'العدد', unit: 'unit', default: 1 }],
      calc: { op: 'single', dim: 'nombre' },
      qtyFormula: 'Nombre',
      unit: 'unit',
    },
  ],
  placo: [
    {
      code: 'panneau_ba13',
      trade: 'placo',
      labelFr: 'Panneau BA13',
      labelAr: 'لوح جبس 13 مم',
      method: 'surface',
      dims: [
        { key: 'largeur', labelFr: 'Largeur', labelAr: 'العرض', unit: 'm', default: 1.2 },
        { key: 'hauteur', labelFr: 'Hauteur', labelAr: 'الارتفاع', unit: 'm', default: 2.5 },
        { key: 'nb', labelFr: 'Nombre', labelAr: 'العدد', unit: 'unit', default: 1 },
      ],
      calc: { op: 'product', dims: ['largeur', 'hauteur', 'nb'] },
      qtyFormula: 'Largeur × Hauteur × Nb',
      unit: 'm²',
      linkedSlotCode: 'placo_board',
    },
  ],
  plomberie: [
    {
      code: 'reseau_ppr',
      trade: 'plomberie',
      labelFr: 'Réseau PPR',
      labelAr: 'شبكة PPR',
      method: 'longueur',
      dims: [{ key: 'longueur', labelFr: 'Longueur', labelAr: 'الطول', unit: 'm' }],
      calc: { op: 'single', dim: 'longueur' },
      qtyFormula: 'Longueur',
      unit: 'ml',
    },
    // B7-BATCH1 — DATA ONLY (legacy shape, no enriched block, no bindings).
    {
      code: 'evacuation_pvc',
      trade: 'plomberie',
      labelFr: 'Évacuation PVC',
      labelAr: 'صرف PVC',
      method: 'longueur',
      dims: [{ key: 'longueur', labelFr: 'Longueur', labelAr: 'الطول', unit: 'm', default: 6 }],
      calc: { op: 'single', dim: 'longueur' },
      qtyFormula: 'Longueur',
      unit: 'ml',
    },
    {
      code: 'point_eau',
      trade: 'plomberie',
      labelFr: "Point d'eau",
      labelAr: 'نقطة ماء',
      method: 'unite',
      dims: [{ key: 'nombre', labelFr: 'Nombre', labelAr: 'العدد', unit: 'unit', default: 1 }],
      calc: { op: 'single', dim: 'nombre' },
      qtyFormula: 'Nombre',
      unit: 'unit',
    },
  ],
  electricite: [
    {
      code: 'point_lumiere',
      trade: 'electricite',
      labelFr: 'Point lumineux',
      labelAr: 'نقطة إنارة',
      method: 'unite',
      dims: [{ key: 'nombre', labelFr: 'Nombre', labelAr: 'العدد', unit: 'unit', default: 1 }],
      calc: { op: 'single', dim: 'nombre' },
      qtyFormula: 'Nombre',
      unit: 'unit',
    },
    // B7-BATCH1 — DATA ONLY (legacy shape, no enriched block, no bindings).
    {
      code: 'prise_16a',
      trade: 'electricite',
      labelFr: 'Prise 16A',
      labelAr: 'مقبس 16 أمبير',
      method: 'unite',
      dims: [{ key: 'nombre', labelFr: 'Nombre', labelAr: 'العدد', unit: 'unit', default: 1 }],
      calc: { op: 'single', dim: 'nombre' },
      qtyFormula: 'Nombre',
      unit: 'unit',
    },
  ],
  maconnerie: [
    {
      code: 'beton_coulee',
      trade: 'maconnerie',
      labelFr: 'Béton coulé',
      labelAr: 'خرسانة مصبوبة',
      method: 'volume',
      dims: [
        { key: 'longueur', labelFr: 'Longueur', labelAr: 'الطول', unit: 'm' },
        { key: 'largeur', labelFr: 'Largeur', labelAr: 'العرض', unit: 'm' },
        { key: 'epaisseur', labelFr: 'Épaisseur', labelAr: 'السماكة', unit: 'm' },
      ],
      calc: { op: 'product', dims: ['longueur', 'largeur', 'epaisseur'] },
      qtyFormula: 'Longueur × Largeur × Épaisseur',
      unit: 'm³',
    },
    // B7-BATCH1 — DATA ONLY (surface only; no brick ratio, no bindings).
    {
      code: 'mur_brique',
      trade: 'maconnerie',
      labelFr: 'Mur brique',
      labelAr: 'جدار آجر',
      method: 'surface',
      dims: [
        { key: 'largeur', labelFr: 'Largeur', labelAr: 'العرض', unit: 'm', default: 4 },
        { key: 'hauteur', labelFr: 'Hauteur', labelAr: 'الارتفاع', unit: 'm', default: 2.8 },
        { key: 'nb', labelFr: 'Nombre', labelAr: 'العدد', unit: 'unit', default: 1 },
      ],
      calc: { op: 'product', dims: ['largeur', 'hauteur', 'nb'] },
      qtyFormula: 'Largeur × Hauteur × Nb',
      unit: 'm²',
    },
  ],
  facade: [
    {
      code: 'enduit_facade',
      trade: 'facade',
      labelFr: 'Enduit de façade',
      labelAr: 'جص الواجهة',
      method: 'perimetre_hauteur',
      dims: [
        { key: 'cote_a', labelFr: 'Côté A', labelAr: 'الجانب أ', unit: 'm' },
        { key: 'cote_b', labelFr: 'Côté B', labelAr: 'الجانب ب', unit: 'm' },
        { key: 'hauteur', labelFr: 'Hauteur', labelAr: 'الارتفاع', unit: 'm' },
      ],
      calc: { op: 'perimeter_h', planeA: 'cote_a', planeB: 'cote_b', height: 'hauteur' },
      qtyFormula: '(Côté A + Côté B) × 2 × Hauteur',
      unit: 'm²',
    },
  ],
  // B7.1 — PEINTURE first real work type (DATA ONLY, legacy shape, no enriched
  // block, no bindings). Illustrative defaults only, not normative measurements.
  peinture: [
    {
      code: 'mur_interieur',
      trade: 'peinture',
      labelFr: 'Mur intérieur — peinture',
      labelAr: 'جدار داخلي — دهان',
      method: 'surface',
      dims: [
        { key: 'largeur', labelFr: 'Largeur', labelAr: 'العرض', unit: 'm', default: 4 },
        { key: 'hauteur', labelFr: 'Hauteur', labelAr: 'الارتفاع', unit: 'm', default: 2.8 },
        { key: 'nb', labelFr: 'Nombre', labelAr: 'العدد', unit: 'unit', default: 1 },
      ],
      calc: { op: 'product', dims: ['largeur', 'hauteur', 'nb'] },
      qtyFormula: 'Largeur × Hauteur × Nb',
      unit: 'm²',
    },
  ],
  // B7-BATCH1 — DATA ONLY new trades (legacy shape, no enriched block, no
  // bindings). Illustrative defaults only, not normative measurements.
  carrelage: [
    {
      code: 'sol_carrelage',
      trade: 'carrelage',
      labelFr: 'Sol carrelage',
      labelAr: 'أرضية مبلطة',
      method: 'surface',
      dims: [
        { key: 'longueur', labelFr: 'Longueur', labelAr: 'الطول', unit: 'm', default: 4 },
        { key: 'largeur', labelFr: 'Largeur', labelAr: 'العرض', unit: 'm', default: 3 },
        { key: 'nb', labelFr: 'Nombre', labelAr: 'العدد', unit: 'unit', default: 1 },
      ],
      calc: { op: 'product', dims: ['longueur', 'largeur', 'nb'] },
      qtyFormula: 'Longueur × Largeur × Nb',
      unit: 'm²',
    },
  ],
  etancheite: [
    {
      code: 'terrasse_membrane',
      trade: 'etancheite',
      labelFr: 'Terrasse — membrane',
      labelAr: 'شرفة — غشاء عازل',
      method: 'surface',
      dims: [
        { key: 'longueur', labelFr: 'Longueur', labelAr: 'الطول', unit: 'm', default: 5 },
        { key: 'largeur', labelFr: 'Largeur', labelAr: 'العرض', unit: 'm', default: 4 },
        { key: 'nb', labelFr: 'Nombre', labelAr: 'العدد', unit: 'unit', default: 1 },
      ],
      calc: { op: 'product', dims: ['longueur', 'largeur', 'nb'] },
      qtyFormula: 'Longueur × Largeur × Nb',
      unit: 'm²',
    },
  ],
  isolation: [
    {
      code: 'mur_laine',
      trade: 'isolation',
      labelFr: 'Mur — laine de verre',
      labelAr: 'جدار — صوف زجاجي',
      method: 'surface',
      dims: [
        { key: 'largeur', labelFr: 'Largeur', labelAr: 'العرض', unit: 'm', default: 4 },
        { key: 'hauteur', labelFr: 'Hauteur', labelAr: 'الارتفاع', unit: 'm', default: 2.8 },
        { key: 'nb', labelFr: 'Nombre', labelAr: 'العدد', unit: 'unit', default: 1 },
      ],
      calc: { op: 'product', dims: ['largeur', 'hauteur', 'nb'] },
      qtyFormula: 'Largeur × Hauteur × Nb',
      unit: 'm²',
    },
  ],
  sols: [
    {
      code: 'parquet_piece',
      trade: 'sols',
      labelFr: 'Pièce — parquet',
      labelAr: 'غرفة — باركيه',
      method: 'surface',
      dims: [
        { key: 'longueur', labelFr: 'Longueur', labelAr: 'الطول', unit: 'm', default: 4 },
        { key: 'largeur', labelFr: 'Largeur', labelAr: 'العرض', unit: 'm', default: 3.5 },
        { key: 'nb', labelFr: 'Nombre', labelAr: 'العدد', unit: 'unit', default: 1 },
      ],
      calc: { op: 'product', dims: ['longueur', 'largeur', 'nb'] },
      qtyFormula: 'Longueur × Largeur × Nb',
      unit: 'm²',
    },
  ],
  demolition: [
    {
      code: 'demolition_cloison',
      trade: 'demolition',
      labelFr: 'Cloison — démolition',
      labelAr: 'جدار — هدم',
      method: 'surface',
      dims: [
        { key: 'largeur', labelFr: 'Largeur', labelAr: 'العرض', unit: 'm', default: 3 },
        { key: 'hauteur', labelFr: 'Hauteur', labelAr: 'الارتفاع', unit: 'm', default: 2.8 },
        { key: 'nb', labelFr: 'Nombre', labelAr: 'العدد', unit: 'unit', default: 1 },
      ],
      calc: { op: 'product', dims: ['largeur', 'hauteur', 'nb'] },
      qtyFormula: 'Largeur × Hauteur × Nb',
      unit: 'm²',
    },
  ],
};


/**
 * Alias registry — normalized dynamic-métier code → canonical `METRE_ELEMENTS`
 * key. DATA ONLY: no branch exists anywhere; adding a dynamic métier = one
 * registry entry + optional aliases (same data-driven contract as
 * `tradeServices.ts` / `METRE_ELEMENTS` itself).
 *
 * Every observed spelling of the Menuiserie Aluminium family collapses onto
 * the single `aluminium` entry:
 *   - "Menuiserie Aluminium" — the CSV / `rates[].category` family label,
 *   - "Aluminium" / "ALUMINIUM" — trade label_fr (already the direct key),
 *   - the 21 production trade codes with label_fr "Aluminium" (raw:
 *     "fenêtres", "baies vitrées", "profilés dormants", "châssis", …).
 *
 * Keys MUST be stored in `catalogKey()` form (trim + strip accents + lowercase
 * + fold `-`/`_`/`.`/`/`/`\` into single spaces); `elementsForTrade` folds the
 * incoming code with the SAME helper, so case, accents and separators never
 * matter. A direct `METRE_ELEMENTS` key always WINS over an alias, so a future
 * métier registered under one of these codes can never be shadowed.
 */
export const METRE_ELEMENT_ALIASES: Readonly<Record<string, string>> = {
  // Family label (CSV classification / rates[].category)
  'menuiserie aluminium': 'aluminium',
  // Production trade codes (GET /api/v1/trades, label_fr = "Aluminium")
  'profiles': 'aluminium', // code "profilés"
  'profiles dormants': 'aluminium', // code "profilés dormants"
  'profiles ouvrants': 'aluminium', // code "profilés ouvrants"
  'profiles coulissants': 'aluminium', // code "profilés coulissants"
  'fenetres': 'aluminium', // code "fenêtres"
  'portes': 'aluminium', // code "portes"
  'baies vitrees': 'aluminium', // code "baies vitrées"
  'coulissants': 'aluminium', // code "coulissants"
  'chassis': 'aluminium', // code "châssis"
  'rails': 'aluminium', // code "rails"
  'montants': 'aluminium', // code "montants"
  'traverses': 'aluminium', // code "traverses"
  'cornieres': 'aluminium', // code "cornières"
  'quincaillerie': 'aluminium', // code "quincaillerie"
  'joints': 'aluminium', // code "joints"
  'accessoires': 'aluminium', // code "accessoires"
  'consommables': 'aluminium', // code "consommables"
  'vitrage': 'aluminium', // code "vitrage"
  'protection': 'aluminium', // code "protection"
  'fermetures': 'aluminium', // code "fermetures"
  'finition': 'aluminium', // code "finition"
};

/** Normalize a trade code for registry lookups (lower-case, trimmed). */
export function normalizeTradeKey(tradeCode: string | null | undefined): string {
  return String(tradeCode ?? '').trim().toLowerCase();
}

/**
 * Elements of a métier. Returns [] for unknown/empty codes — the caller
 * (Phase 2 UI) decides its fallback; the engine never invents elements.
 *
 * Resolution is DATA-DRIVEN (order-sensitive, no trade branch): a direct
 * `METRE_ELEMENTS` key first (a real entry always wins), then
 * `METRE_ELEMENT_ALIASES` and the `catalogKey`-folded key — how dynamic
 * métiers ("Menuiserie Aluminium", the 21 "Aluminium" barème codes) reach
 * their shared registry entry.
 */
export function elementsForTrade(tradeCode: string | null | undefined): MetreElementDef[] {
  const key = normalizeTradeKey(tradeCode);
  // 1) Direct registry key — historical lookup, always wins (never shadowed).
  if (key && METRE_ELEMENTS[key]) return [...METRE_ELEMENTS[key]];
  // 2) Folded fallback (`catalogKey`: accents/case/separators) — alias table
  //    first, then the folded key itself. This is how DYNAMIC métiers reach
  //    their shared registry entry: the "Menuiserie Aluminium" family label
  //    and the 21 "Aluminium" barème codes ("fenêtres", "baies vitrées", …)
  //    all resolve here — still pure data, NO trade branch.
  const folded = key ? catalogKey(tradeCode) : '';
  if (folded) {
    const canonical = METRE_ELEMENT_ALIASES[folded] ?? (METRE_ELEMENTS[folded] ? folded : undefined);
    if (canonical) return [...(METRE_ELEMENTS[canonical] ?? [])];
  }
  // 3) Unknown métier → [] (fallback contract unchanged).
  return [];
}

/** Single element by métier + code, or null. */
export function getMetreElement(
  tradeCode: string | null | undefined,
  elementCode: string | null | undefined,
): MetreElementDef | null {
  const code = String(elementCode ?? '').trim();
  if (!code) return null;
  return elementsForTrade(tradeCode).find((el) => el.code === code) ?? null;
}

/** Distinct methods available for a métier (registry order preserved). */
export function methodsForTrade(tradeCode: string | null | undefined): MetreMethod[] {
  const seen: MetreMethod[] = [];
  for (const el of elementsForTrade(tradeCode)) {
    if (!seen.includes(el.method)) seen.push(el.method);
  }
  return seen;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 (data-driven) — DB-backed loading with the config fallback.
// Mirrors `tradeServices.loadServicesForTrade`: the SAME element shape the
// engine already consumes, resolved from ALL sources. Strict order:
//   1. Database — `trade_metre_elements` via GET /trades/:id/metre-elements
//   2. Config   — this file's `METRE_ELEMENTS` (direct key → alias → folded)
//   3. []       — the legacy fallback contract (an engine NEVER invents one)
// A NEW catalogue métier therefore needs ZERO edits in this file: its
// elements are rows in `trade_metre_elements` (migration 0015), optionally
// shipped inside the catalogue file itself (see catalogImport.ts).
// ─────────────────────────────────────────────────────────────────────────────

/** Whitelists shared by the loader, the import validator and the tests. */
export const METRE_METHOD_VALUES: readonly MetreMethod[] = [
  'surface', 'longueur', 'unite', 'volume', 'perimetre_hauteur',
];
export const METRE_QTY_UNIT_VALUES: readonly MetreQtyUnit[] = [
  'm²', 'ml', 'm³', 'unit', 'kg', 'L', 'point',
];
export const METRE_DIM_UNIT_VALUES: readonly ElementDim['unit'][] = ['m', 'm²', 'm³', 'unit', 'mm'];

export function isMetreMethod(value: unknown): value is MetreMethod {
  return typeof value === 'string' && (METRE_METHOD_VALUES as readonly string[]).includes(value);
}

export function isMetreQtyUnit(value: unknown): value is MetreQtyUnit {
  return typeof value === 'string' && (METRE_QTY_UNIT_VALUES as readonly string[]).includes(value);
}

function isElementDim(value: unknown): value is ElementDim {
  if (!value || typeof value !== 'object') return false;
  const d = value as Record<string, unknown>;
  if (typeof d.key !== 'string' || !d.key.trim()) return false;
  if (!METRE_DIM_UNIT_VALUES.includes(d.unit as ElementDim['unit'])) return false;
  if (d.labelFr !== undefined && d.labelFr !== null && typeof d.labelFr !== 'string') return false;
  if (d.labelAr !== undefined && d.labelAr !== null && typeof d.labelAr !== 'string') return false;
  if (d.default !== undefined && d.default !== null && !Number.isFinite(Number(d.default))) return false;
  return true;
}

function isQtyCalcSpec(value: unknown): value is QtyCalcSpec {
  if (!value || typeof value !== 'object' || !('op' in value)) return false;
  const c = value as Record<string, unknown>;
  const isKey = (k: unknown): k is string => typeof k === 'string' && !!k;
  if (c.op === 'single') return isKey(c.dim);
  if (c.op === 'product') return Array.isArray(c.dims) && c.dims.length > 0 && c.dims.every(isKey);
  if (c.op === 'perimeter_h') return isKey(c.planeA) && isKey(c.planeB) && isKey(c.height);
  return false;
}

/**
 * PHASE 1 — enriched-specification validators.
 *
 * Every rule here is FAIL-CLOSED and OPTIONAL: an absent field is always
 * valid, so all pre-existing elements (which declare none of them) keep
 * passing `isValidMetreElementShape` unchanged. They exist to stop an invalid
 * DB/CSV specification from ever reaching the evaluator.
 */

/**
 * `workType` — ABSENT = VALID (every pre-existing element declares none, so
 * they all keep passing unchanged). When present it must be a coherent
 * DESCRIPTOR: the identity triple (`code`/`labelFr` non-empty, `labelAr` a
 * string) plus optional, well-typed metadata. Fail-closed like every other
 * Phase 1 rule. This validator NEVER gates arithmetic — the descriptor is not
 * part of the calculation chain; it only stops a malformed descriptor from
 * being carried through the loader / import path.
 */
export function isValidMetreWorkTypeSpec(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v !== 'object') return false;
  const w = v as Record<string, unknown>;
  // Identity — required for a declared descriptor.
  if (typeof w.code !== 'string' || !w.code.trim()) return false;
  if (typeof w.labelFr !== 'string' || !w.labelFr.trim()) return false;
  if (typeof w.labelAr !== 'string') return false;
  // Optional descriptive metadata — each validated only when present.
  if (w.measurementMethod !== undefined && w.measurementMethod !== null && !isMetreMethod(w.measurementMethod)) {
    return false;
  }
  if (w.methodology !== undefined && w.methodology !== null) {
    if (typeof w.methodology !== 'string' || !w.methodology.trim()) return false;
  }
  for (const key of ['norms', 'validationHints'] as const) {
    const arr = w[key];
    if (arr === undefined || arr === null) continue;
    if (!Array.isArray(arr)) return false;
    if (!arr.every((x) => typeof x === 'string' && !!String(x).trim())) return false;
  }
  if (w.durationHint !== undefined && w.durationHint !== null) {
    if (typeof w.durationHint !== 'object') return false;
    const d = w.durationHint as Record<string, unknown>;
    if (!isPositiveNumber(d.value)) return false;
    if (typeof d.unit !== 'string' || !d.unit.trim()) return false;
  }
  return true;
}

/** A finite number that is strictly positive (rejects 0, negative, NaN). */
function isPositiveNumber(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** A finite number that is zero or positive (rejects negative + NaN). */
function isNonNegativeNumber(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/** `layers` — absent = valid; present must be a finite integer ≥ 1. */
function isMetreLayers(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 1;
}

/** `wastePercent` — absent = valid; present must be finite and ≥ 0. */
function isMetreWaste(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  return isNonNegativeNumber(v);
}

/** One opening: explicit area, or BOTH finite positive dimensions. */
function isMetreOpening(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (o.type !== undefined && o.type !== null && typeof o.type !== 'string') return false;
  // count: absent = 1 (documented default, only ever for a DECLARED opening).
  if (o.count !== undefined && o.count !== null) {
    if (typeof o.count !== 'number' || !Number.isFinite(o.count) || o.count <= 0) return false;
  }
  if (o.areaM2 !== undefined && o.areaM2 !== null) {
    if (!isPositiveNumber(o.areaM2)) return false;
    if (o.width !== undefined && o.width !== null && !isPositiveNumber(o.width)) return false;
    if (o.height !== undefined && o.height !== null && !isPositiveNumber(o.height)) return false;
    return true;
  }
  return isPositiveNumber(o.width) && isPositiveNumber(o.height);
}

/** `openings` — absent = valid; a declared block must be coherent. */
function isMetreOpenings(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (o.enabled !== undefined && o.enabled !== null && typeof o.enabled !== 'boolean') return false;
  if (o.mode !== undefined && o.mode !== null && o.mode !== 'area' && o.mode !== 'dimensions') return false;
  if (o.items === undefined || o.items === null) return true;
  if (!Array.isArray(o.items)) return false;
  return o.items.every(isMetreOpening);
}

/** One deduction: needs an explicit quantity OR areaM2 (never a silent no-op). */
function isMetreDeduction(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  if (d.type !== undefined && d.type !== null && typeof d.type !== 'string') return false;

  // Phase 1.1 preferred explicit form
  if (d.amount !== undefined && d.amount !== null) {
    if (!isNonNegativeNumber(d.amount)) return false;
    if (!isMetreQtyUnit(d.unit)) return false;
    return true;
  }

  // Legacy fallback forms (kept for backward compatibility)
  if (d.quantity !== undefined && d.quantity !== null && !isNonNegativeNumber(d.quantity)) return false;
  if (d.areaM2 !== undefined && d.areaM2 !== null && !isNonNegativeNumber(d.areaM2)) return false;
  return (d.quantity !== undefined && d.quantity !== null)
    || (d.areaM2 !== undefined && d.areaM2 !== null);
}

/** `deductions` — absent = valid; a declared block must be coherent. */
function isMetreDeductions(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  if (d.enabled !== undefined && d.enabled !== null && typeof d.enabled !== 'boolean') return false;
  if (d.items === undefined || d.items === null) return true;
  if (!Array.isArray(d.items)) return false;
  return d.items.every(isMetreDeduction);
}

/**
 * `yieldPerUnit` — absent = valid. When present it MUST be fully explicit:
 * a strictly positive `value` plus non-empty `unit` and `basis`. There is no
 * default coverage and no invented conversion factor.
 */
function isMetreCoverage(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v !== 'object') return false;
  const y = v as Record<string, unknown>;
  if (!isPositiveNumber(y.value)) return false;
  if (!isMetreQtyUnit(y.unit)) return false;
  if (!isMetreQtyUnit(y.basis)) return false;
  return true;
}

/**
 * Engine-safety contract for a DB/CSV-sourced element: whitelisted method +
 * unit, ≥1 valid dimension, whitelisted `calc.op`, and every dimension the
 * calc references actually declared. Used by BOTH the client loader
 * (`mapMetreElementRow`) and the server import validator
 * (`catalogImport.normalizeAndValidateRows`) — ONE rule, no drift.
 * `method`/`qtyUnit` are NEVER derived from units or categories here.
 *
 * PHASE 1 — the optional enriched specification (openings / deductions /
 * layers / waste / yield) is validated by the SAME entry point, so a second,
 * competing validator can never exist.
 */
export function isValidMetreElementShape(el: {
  method: unknown;
  dims: unknown;
  calc: unknown;
  qtyUnit: unknown;
  openings?: unknown;
  deductions?: unknown;
  layers?: unknown;
  wastePercent?: unknown;
  coveragePerProductUnit?: unknown;
  yieldPerUnit?: unknown;
  workType?: unknown;
}): boolean {
  if (!isMetreMethod(el?.method)) return false;
  if (!isMetreQtyUnit(el?.qtyUnit)) return false;
  const dims = el.dims;
  if (!Array.isArray(dims) || dims.length === 0) return false;
  const keys = new Set<string>();
  for (const d of dims) {
    if (!isElementDim(d)) return false;
    if (keys.has(d.key)) return false;
    keys.add(d.key);
  }
  const calc = el.calc;
  if (!isQtyCalcSpec(calc)) return false;
  const used = calc.op === 'single' ? [calc.dim]
    : calc.op === 'product' ? calc.dims
    : [calc.planeA, calc.planeB, calc.height];
  if (!used.every((k) => keys.has(k))) return false;
  // PHASE 1 — enriched spec (all optional ⇒ absent always passes).
  if (!isMetreOpenings(el.openings)) return false;
  if (!isMetreDeductions(el.deductions)) return false;
  if (!isMetreLayers(el.layers)) return false;
  if (!isMetreWaste(el.wastePercent)) return false;
  if (!isMetreCoverage(el.coveragePerProductUnit)) return false;
  if (!isMetreCoverage(el.yieldPerUnit)) return false;
  // PHASE 1 — work-type descriptor (absent = valid ⇒ legacy shapes unchanged).
  if (!isValidMetreWorkTypeSpec(el.workType)) return false;
  return true;
}

/** Human-readable formula built from the declared dims (documentation only). */
function buildQtyFormula(calc: QtyCalcSpec, dims: ElementDim[]): string {
  const labelOf = (k: string) => dims.find((d) => d.key === k)?.labelFr || k;
  if (calc.op === 'single') return labelOf(calc.dim);
  if (calc.op === 'product') return calc.dims.map(labelOf).join(' × ');
  return `(${labelOf(calc.planeA)} + ${labelOf(calc.planeB)}) × 2 × ${labelOf(calc.height)}`;
}

/**
 * One `trade_metre_elements` API row → `MetreElementDef`, or null when the
 * row would not be engine-safe (invalid method/unit/dims/calc). Defensive by
 * design: a bad row degrades to the config fallback, never to a runtime error.
 */
export function mapMetreElementRow(row: unknown, tradeCode: string): MetreElementDef | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const elementCode = typeof r.elementCode === 'string' ? r.elementCode.trim() : '';
  if (!elementCode) return null;
  const candidate = {
    method: r.method,
    dims: r.dims,
    calc: r.calc,
    qtyUnit: r.qtyUnit,
    // PHASE 1 — the enriched spec is validated by the SAME contract, so an
    // invalid DB specification degrades to the config fallback exactly like an
    // invalid method/unit does today.
    openings: r.openings,
    deductions: r.deductions,
    layers: r.layers,
    wastePercent: r.wastePercent,
    coveragePerProductUnit: (r as any).coveragePerProductUnit ?? (r as any).coverage_per_product_unit,
    yieldPerUnit: r.yieldPerUnit,
    // PHASE 1 — work-type descriptor (descriptive only; carried through as-is).
    workType: r.workType,
    // PHASE 2.1 — bindings travel from the API row (columns exist since
    // migration 0020; absent columns stay `undefined`, shaping exactly as before).
    materialBindings: r.materialBindings,
    serviceBindings: r.serviceBindings,
    linkedSlotCode: r.linkedSlotCode,
  };
  if (!isValidMetreElementShape(candidate)) return null;
  const dims = candidate.dims as ElementDim[];
  const calc = candidate.calc as QtyCalcSpec;
  const labelFr = typeof r.labelFr === 'string' && r.labelFr.trim() ? r.labelFr.trim() : elementCode;
  const labelAr = typeof r.labelAr === 'string' ? r.labelAr.trim() : '';
  // PHASE 1 — spread the optional spec through only when the row really has it.
  // A row without these columns produces the EXACT same object shape as before.
  const enriched = {
    ...(candidate.openings !== undefined && candidate.openings !== null
      ? { openings: candidate.openings as MetreOpeningsSpec } : {}),
    ...(candidate.deductions !== undefined && candidate.deductions !== null
      ? { deductions: candidate.deductions as MetreDeductionsSpec } : {}),
    ...(candidate.layers !== undefined && candidate.layers !== null
      ? { layers: candidate.layers as number } : {}),
    ...(candidate.wastePercent !== undefined && candidate.wastePercent !== null
      ? { wastePercent: candidate.wastePercent as number } : {}),
    ...(candidate.coveragePerProductUnit !== undefined && candidate.coveragePerProductUnit !== null
      ? { coveragePerProductUnit: candidate.coveragePerProductUnit as MetreCoverageSpec } : {}),
    ...(candidate.yieldPerUnit !== undefined && candidate.yieldPerUnit !== null
      ? { yieldPerUnit: candidate.yieldPerUnit as MetreCoverageSpec } : {}),
    ...(candidate.workType !== undefined && candidate.workType !== null
      ? { workType: candidate.workType as MetreWorkTypeSpec } : {}),
    // PHASE 2.1 — bindings/linked slot travel through ONLY when the row has them.
    ...(candidate.materialBindings !== undefined && candidate.materialBindings !== null
      ? { materialBindings: candidate.materialBindings } : {}),
    ...(candidate.serviceBindings !== undefined && candidate.serviceBindings !== null
      ? { serviceBindings: candidate.serviceBindings } : {}),
    ...(typeof candidate.linkedSlotCode === 'string' && candidate.linkedSlotCode.trim()
      ? { linkedSlotCode: candidate.linkedSlotCode } : {}),
  };
  return {
    code: elementCode,
    trade: normalizeTradeKey(tradeCode),
    labelFr,
    labelAr,
    method: candidate.method as MetreMethod,
    dims,
    calc,
    qtyFormula: buildQtyFormula(calc, dims),
    unit: candidate.qtyUnit as MetreQtyUnit,
    ...enriched,
  };
}

/**
 * Phase 1 — resolve Dynamic Métré elements for a trade from ALL sources.
 *
 * G2 — per-element merge (contract):
 *   1. Config registry (`METRE_ELEMENTS` via `elementsForTrade`) is the base list.
 *   2. Valid DB rows (`trade_metre_elements` via `listTradeMetreElements`,
 *      filtered through `mapMetreElementRow`) override the config element with
 *      the SAME elementCode only — never the whole list.
 *   3. Config elements with no DB counterpart stay as-is; no elementCode repeats.
 *   4. Dynamic métier (no config entry): valid DB rows stay the sole source.
 *   5. No valid DB rows / DB unreachable / unknown métier → config (→ []).
 *
 * Never returns null and never throws (all DB/parse errors fall through).
 */
export async function loadMetreElementsForTrade(
  tradeId: string | null | undefined,
  tradeCode: string,
): Promise<MetreElementDef[]> {
  // G2 — per-element merge: config is the base list; DB rows override by code.
  const config = elementsForTrade(tradeCode);
  // 1. Try database first (per-element override, never whole-list replacement).
  if (tradeId) {
    try {
      const { listTradeMetreElements } = await import('../lib/api');
      const rows = await listTradeMetreElements(tradeId);
      const byCode = new Map<string, MetreElementDef>();
      for (const row of Array.isArray(rows) ? rows : []) {
        const el = mapMetreElementRow(row, tradeCode);
        // Dedupe by elementCode (DB guarantees UNIQUE(trade_id, element_code);
        // last-wins keeps this deterministic if a fixture ever duplicates).
        if (el) byCode.set(el.code, el);
      }
      if (byCode.size === 0) return config;
      // Dynamic métier (no config entry): DB remains the sole source — contract preserved.
      if (config.length === 0) return [...byCode.values()];
      const merged = config.map((cfg) => byCode.get(cfg.code) ?? cfg);
      for (const el of byCode.values()) {
        if (!merged.some((m) => m.code === el.code)) merged.push(el);
      }
      return merged;
    } catch {
      // DB/offline unavailable — fall through to the config registry.
    }
  }
  // 2. Config registry (which itself resolves direct key → alias → []).
  return elementsForTrade(tradeCode);
}

