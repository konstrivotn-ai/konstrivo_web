/**
 * PHASE 1 — CALCULATORS ⇄ RULES BRIDGE (ADDITIVE ONLY)
 *
 * Single integration seam between the existing calculation path and the two
 * EXISTING rules layers. It does not create a third rules system — it only
 * resolves through the code that already owns those layers:
 *
 *   1. `calc_rules` / `calc_slots` (migration 0009)
 *        → resolved via `src/utils/calculatorRules.ts` (client mirror of the
 *          same seed data) with `resolveCalculatorRuleForMaterial`.
 *   2. `country_calculation_rules` (migrations 0012/0013)
 *        → raw rows from `GET /api/v1/reference/calc-rules?country=`, fetched
 *          by CalculatorTab, parsed by `resolveCountryWasteMarginDefault`.
 *
 * STRICT FALLBACK CONTRACT (enforced by tests/calculatorRulesBridge.test.ts):
 *   • No rule / invalid rule / no rows / ANY thrown error → the input is
 *     returned UNCHANGED (same object reference) → the 12 hardcoded branches
 *     keep producing exactly today's behaviour.
 *   • A valid `calc_rules` match may only (a) annotate the material line with
 *     its resolved slot/rule code, and (b) fill a price the normal lookup
 *     LEFT AT 0 through the rule's legacy key. An existing (>0) price is
 *     NEVER overwritten — `priceLookup` stays authoritative.
 *   • `country_calculation_rules` may only supply whitelisted CALCULATION
 *     defaults (`waste_margin_percent`). Fiscal keys (default_tva,
 *     timbre_fiscal, retenue_garantie) are deliberately IGNORED here: fiscal
 *     keeps flowing from COUNTRIES_CONFIG + user state, unchanged.
 *   • `calculateGeneric` / `genericQty` are never invoked or wrapped; the
 *     bridge is applied to the 12 official branches only (see CalculatorTab).
 *
 * Money consistency: when a price fill changes `totalMaterialTnd`, the raw
 * TND fiscal chain is rebuilt with the SAME `computeFiscalData` helper the
 * calculators use (reused, not reimplemented) so the audit engine's
 * millime-precision checks stay green.
 */
import type { CalculationResult, MaterialItemResult, MaterialRate } from '../types';
import { calcRules, calcSlots, resolveCalculatorRuleForMaterial } from './calculatorRules';
import { computeFiscalData } from './calculations';

/** Material line after the bridge — additive metadata, nothing removed. */
export interface RuleBridgedMaterialItem extends MaterialItemResult {
  calcSlotCode?: string;
  calcRuleCode?: string;
}

export interface CalcRuleBridgeMatch {
  slotCode: string;
  ruleCode: string;
  legacyKey?: string;
}

/**
 * Resolve ONE material line against the `calc_rules` layer.
 * Returns null (→ fallback: line untouched) when no rule is configured, when
 * the rule fails validity checks (slot missing, slot/rule mismatch, wrong
 * métier), or on any error — this function must never throw.
 */
export function resolveCalcRuleForMaterialLine(
  itemId: string,
  tradeCode?: string,
): CalcRuleBridgeMatch | null {
  try {
    if (!itemId) return null;
    const resolved = resolveCalculatorRuleForMaterial({
      code: itemId,
      legacyKey: itemId,
      trade: tradeCode ?? null,
    });
    if (resolved.status !== 'configured' || !resolved.slotCode || !resolved.ruleCode) return null;
    const slot = calcSlots[resolved.slotCode];
    const rule = calcRules[resolved.ruleCode];
    if (!slot || !rule || rule.slotCode !== slot.code) return null; // integrity gate
    if (tradeCode && rule.trade !== tradeCode) return null; // métier gate
    return { slotCode: slot.code, ruleCode: rule.code, legacyKey: rule.legacyKey };
  } catch {
    return null;
  }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Apply the `calc_rules` layer to a freshly computed CalculationResult
 * (called by CalculatorTab right AFTER the 12 official branches and BEFORE
 * the currency-conversion step — the generic branch never reaches here).
 *
 * Rules may:
 *   (a) annotate each resolvable line with `calcSlotCode` / `calcRuleCode`;
 *   (b) fill a price ONLY when the normal lookup returned ≤ 0 AND the rule
 *       maps the line to a DIFFERENT legacy key that has a price.
 * Everything else — quantities, labor, existing prices, waste, fiscal input
 * state — is untouched. With no resolvable rule the ORIGINAL object is
 * returned unchanged (identical reference = hard proof of fallback).
 */
export function applyCalcRulesToResult(
  result: CalculationResult,
  rates: MaterialRate[],
  tradeCode?: string,
): CalculationResult {
  try {
    if (!result || !Array.isArray(result.materialItems) || result.materialItems.length === 0) return result;

    let anyRuleMatched = false;
    let filledDelta = 0;

    const materialItems: RuleBridgedMaterialItem[] = result.materialItems.map((item) => {
      const match = resolveCalcRuleForMaterialLine(item?.id, tradeCode);
      if (!match) return item;
      anyRuleMatched = true;

      // (b) price fill — only for a 0-priced line whose rule points ELSEWHERE
      //     to a priced legacy key. Existing prices are never replaced.
      //     (`legacyKey` captured first so strict-TS narrowing survives the
      //      `find` callback below.)
      const legacyKey = match.legacyKey;
      if (!(item.unitPriceTnd > 0) && legacyKey && legacyKey !== item.id) {
        const rate = Array.isArray(rates) ? rates.find(r => r?.id === legacyKey) : undefined;
        const rulePrice = Number(rate?.unitPriceTnd ?? 0);
        if (Number.isFinite(rulePrice) && rulePrice > 0) {
          const newTotal = round3(item.qty * rulePrice);
          filledDelta += newTotal - item.totalTnd;
          return { ...item, unitPriceTnd: rulePrice, totalTnd: newTotal, calcSlotCode: match.slotCode, calcRuleCode: match.ruleCode };
        }
      }

      // (a) annotation only — numbers stay exactly as the formula produced them
      return { ...item, calcSlotCode: match.slotCode, calcRuleCode: match.ruleCode };
    });

    // No rule resolved for ANY line → strict fallback: original reference.
    if (!anyRuleMatched) return result;

    // Rules resolved but nothing numeric changed → keep every total as-is.
    if (filledDelta === 0) return { ...result, materialItems };

    // A price was filled → rebuild totals + the TND fiscal chain with the
    // calculators' OWN helper (same rounding, same formulas — zero drift).
    const totalMaterialTnd = result.totalMaterialTnd + filledDelta;
    const fiscal = computeFiscalData(totalMaterialTnd, result.estimatedLaborTnd, {
      tvaPercent: result.tvaPercent,
      includeTimbre: (result.timbreFiscalTnd ?? 0) > 0,
      retenueGarantiePercent: result.retenueGarantiePercent,
    });
    return { ...result, materialItems, totalMaterialTnd, ...fiscal };
  } catch {
    return result; // a bridge failure must never break a calculation
  }
}

// ── country_calculation_rules (rows from GET /api/v1/reference/calc-rules) ──

/**
 * Whitelisted rule keys the bridge may apply to CALCULATION inputs.
 * Everything else in a row — fiscal (`default_tva`, `timbre_fiscal`,
 * `retenue_garantie`), localization (`default_currency`, `unit_system`) and
 * any future unknown key — is deliberately ignored: its existing owner keeps
 * owning it (COUNTRIES_CONFIG / user settings / countryCatalogService).
 */
export const CALC_OVERRIDE_RULE_KEYS = ['waste_margin_percent'] as const;

export interface CountryCalcRuleRowInput {
  trade?: string | null;
  ruleKey?: string | null;
  ruleValue?: unknown;
  isActive?: boolean | null;
}

/** Accepts `{ percent|value|rate|amount: n }` or a bare number (jsonb). */
function coercePercent(ruleValue: unknown): number | null {
  let raw: unknown = ruleValue;
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    raw = obj.percent ?? obj.value ?? obj.rate ?? obj.amount;
  }
  const n = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  if (n < 0 || n > 100) return null;
  return n;
}

/**
 * Effective `waste_margin_percent` from `country_calculation_rules` rows.
 * Returns null (→ caller keeps the CURRENT default unchanged) when rows are
 * not an array, no ACTIVE whitelisted row applies to this métier, or the
 * value is not a finite number in [0, 100].
 * A métier-scoped row (trade set) beats a global row (trade = null).
 * Fiscal keys never reach this resolver (whitelist above) — fiscal logic is
 * untouched by design.
 */
export function resolveCountryWasteMarginDefault(
  rows: unknown,
  tradeCode?: string,
): number | null {
  try {
    if (!Array.isArray(rows)) return null;
    const wanted = (tradeCode || '').trim().toLowerCase();
    let globalValue: number | null = null;
    let tradeValue: number | null = null;
    for (const entry of rows as CountryCalcRuleRowInput[]) {
      if (!entry || typeof entry !== 'object') continue;
      if (entry.isActive === false) continue;
      const key = String(entry.ruleKey ?? '');
      if (!(CALC_OVERRIDE_RULE_KEYS as readonly string[]).includes(key)) continue; // whitelist only
      if (key !== 'waste_margin_percent') continue;
      const value = coercePercent(entry.ruleValue);
      if (value === null) continue; // invalid value ⇒ treated as ABSENT
      const rowTrade = String(entry.trade ?? '').trim().toLowerCase();
      if (!rowTrade) {
        if (globalValue === null) globalValue = value;
      } else if (wanted && rowTrade === wanted) {
        tradeValue = value;
      }
    }
    return tradeValue !== null ? tradeValue : globalValue;
  } catch {
    return null;
  }
}