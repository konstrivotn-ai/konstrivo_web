/**
 * DYNAMIC MÉTRÉ — PHASE 2: pure wiring between the Phase 1 engine
 * (metreEngine) and the EXISTING generic calculation input (CalculatorTab).
 *
 * Contracts (ADDITIVE ONLY):
 *   - Pure: no I/O, no globals, no mutation — trivially unit-testable.
 *   - Never touches `genericQty` / `calculateGeneric` / prices / rules bridge /
 *     fiscal / Devis: it only maps aggregated métré totals onto the two
 *     EXISTING GenericInput fields (areaM2 / lengthM) the generic branch
 *     already passes today.
 *   - Fallback-first: empty / absent / non-finite / non-positive totals leave
 *     BOTH fields at the caller's legacy values, so behaviour with no métré
 *     line added is byte-identical to before Phase 2.
 *   - No trade knowledge: the helper never sees a métier code (no
 *     `if (trade === ...)` — data-driven by construction).
 */

/** The two existing GenericInput fields the métré totals can feed. */
export interface MetreGenericMapping {
  areaM2: number;
  lengthM: number;
}

/**
 * Map aggregated métré totals ({ 'm²': 96, ml: 12, ... }) onto the existing
 * generic calculation input.
 *
 *   - `totals['m²'] > 0`  → becomes areaM2  (else fallbackAreaM2)
 *   - `totals['ml']  > 0` → becomes lengthM (else fallbackLengthM)
 *   - other units (m³, unit) have no GenericInput field yet (Phase 3+ material
 *     matching); they stay display-only and are ignored here.
 */
export function metreTotalsToGenericInput(
  totals: Readonly<Record<string, number>> | null | undefined,
  fallbackAreaM2: number,
  fallbackLengthM: number,
): MetreGenericMapping {
  const m2 = Number(totals ? totals['m²'] : undefined);
  const ml = Number(totals ? totals['ml'] : undefined);
  return {
    areaM2: Number.isFinite(m2) && m2 > 0 ? m2 : fallbackAreaM2,
    lengthM: Number.isFinite(ml) && ml > 0 ? ml : fallbackLengthM,
  };
}
