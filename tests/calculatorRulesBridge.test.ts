/**
 * PHASE 1 — Rules Bridge (targeted, DB-free):
 *   npx tsx tests/calculatorRulesBridge.test.ts
 *
 * Scope (as requested): ONLY the Rules-affected path + a basic regression of
 * the existing calculators — no full audit, no refactor.
 */
import { strict as assert } from 'node:assert';
import {
  applyCalcRulesToResult,
  resolveCalcRuleForMaterialLine,
  resolveCountryWasteMarginDefault,
  RuleBridgedMaterialItem,
} from '../src/utils/calculatorRulesBridge';
import { calculatePlaco, calculateGeneric, PlacoInput, GenericInput } from '../src/utils/calculations';
import { DEFAULT_MARKET_RATES } from '../src/data/marketRates';
import { CalculationResult, MaterialItemResult, MaterialRate } from '../src/types';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS ${name}`);
  } catch (err: any) {
    console.log(`  FAIL ${name}\n       ${err?.message || err}`);
    process.exit(1);
  }
}

const rate = (id: string, unitPriceTnd: number): MaterialRate => ({
  id, category: 'placo', nameFr: id, nameAr: '', unit: 'unit', unitPriceTnd, defaultPriceTnd: unitPriceTnd,
});

const item = (over: Partial<MaterialItemResult> & { id: string }): MaterialItemResult => ({
  nameFr: over.id, nameAr: '', qty: 1, unit: 'u', unitPriceTnd: 0, totalTnd: 0, category: 'placo', ...over,
});

const baseResult = (items: MaterialItemResult[], totalMaterialTnd: number): CalculationResult => ({
  trade: 'placo', subType: 'faux_plafond_ba13', subTypeTitle: 'Faux plafond BA13',
  areaM2: 20, netAreaM2: 20, perimeterM: 18,
  materialItems: items, totalMaterialTnd,
  estimatedLaborTnd: 100, grandTotalTnd: totalMaterialTnd + 100,
  wasteMarginPercent: 10, fieldNotes: [],
  tvaPercent: 19, tvaAmountTnd: 0, timbreFiscalTnd: 1,
  retenueGarantiePercent: 5, retenueGarantieTnd: 0,
  totalTtcTnd: 0, netAPayerTnd: 0,
});

// ════ 1) calc_rules — rule-present path: resolve + annotate + price fill ════
test('rule present: line resolved, annotated, 0-price line filled via rule legacy key', () => {
  const base = baseResult([
    item({ id: 'plaque-ba13-standard-3m', qty: 10 }),                    // canonical id, price left at 0
    item({ id: 'fourrure', qty: 5, unitPriceTnd: 8, totalTnd: 40 }),      // already priced
  ], 40);
  const out = applyCalcRulesToResult(base, [rate('plaque_ba13_standard', 32.5)], 'placo');

  const filled = out.materialItems[0]! as RuleBridgedMaterialItem;
  assert.equal(filled.unitPriceTnd, 32.5);
  assert.equal(filled.totalTnd, 325);                          // 10 × 32.5
  assert.equal(filled.calcSlotCode, 'placo_board');
  assert.equal(filled.calcRuleCode, 'placo_ba13_standard');
  assert.equal(filled.qty, 10);                                // quantity untouched

  const sibling = out.materialItems[1]! as RuleBridgedMaterialItem;
  assert.equal(sibling.unitPriceTnd, 8);                       // existing price untouched
  assert.equal(sibling.totalTnd, 40);
  assert.equal(sibling.calcRuleCode, 'placo_furrings');        // still annotated

  // Totals + TND fiscal chain rebuilt with the calculators' own helper
  assert.equal(out.totalMaterialTnd, 365);                     // 40 + 325
  assert.equal(out.grandTotalTnd, 465);                        // + 100 labor
  assert.equal(out.tvaAmountTnd, 88.35);                       // 465 × 19%
  assert.equal(out.timbreFiscalTnd, 1);
  assert.equal(out.retenueGarantieTnd, 23.25);                 // 465 × 5%
  assert.equal(out.totalTtcTnd, 554.35);                       // 465 + 88.35 + 1
  assert.equal(out.netAPayerTnd, 531.1);                       // 554.35 − 23.25
});

// ════ 2) fallback: no rule / wrong métier → ORIGINAL reference ════
test('rule absent: returns the identical object reference (hard fallback proof)', () => {
  const base = baseResult([item({ id: 'isolant_inconnu_xyz', qty: 3 })], 0);
  const out = applyCalcRulesToResult(base, [rate('plaque_ba13_standard', 32.5)], 'placo');
  assert.strictEqual(out, base);
});

test('valid rule of another métier never applies (trade gate)', () => {
  const base = baseResult([item({ id: 'plaque-ba13-standard-3m', qty: 10 })], 0);
  const out = applyCalcRulesToResult(base, [rate('plaque_ba13_standard', 32.5)], 'peinture');
  assert.strictEqual(out, base);
});

// ════ 3) existing price is NEVER overwritten ════
test('rule present but price already resolved: only annotation, totals unchanged', () => {
  const base = baseResult([
    item({ id: 'plaque-ba13-standard-3m', qty: 10, unitPriceTnd: 99, totalTnd: 990 }),
  ], 990);
  const out = applyCalcRulesToResult(base, [rate('plaque_ba13_standard', 32.5)], 'placo');
  assert.equal(out.materialItems[0]!.unitPriceTnd, 99); // 99 wins over the rule's 32.5
  assert.equal(out.materialItems[0]!.totalTnd, 990);
  assert.equal(out.totalMaterialTnd, 990);              // no fiscal rebuild
  assert.equal((out.materialItems[0]! as RuleBridgedMaterialItem).calcRuleCode, 'placo_ba13_standard');
});

// ════ 4) line resolver unit-level ════
test('line resolver: configured → match, unknown/wrong trade/empty → null, never throws', () => {
  assert.deepEqual(resolveCalcRuleForMaterialLine('plaque_ba13_standard', 'placo'),
    { slotCode: 'placo_board', ruleCode: 'placo_ba13_standard', legacyKey: 'plaque_ba13_standard' });
  assert.equal(resolveCalcRuleForMaterialLine('material_unknown_xyz', 'placo'), null);
  assert.equal(resolveCalcRuleForMaterialLine('', 'placo'), null);
  assert.equal(resolveCalcRuleForMaterialLine('plaque_ba13_standard', 'peinture'), null);
});

// ════ 5) bridge never throws ════
test('malformed inputs return numeric-identical output instead of throwing', () => {
  assert.equal(applyCalcRulesToResult(undefined as any, [] as any, 'placo'), undefined);
  const base = baseResult([item({ id: 'plaque-ba13-standard-3m', qty: 2 })], 0);
  const out = applyCalcRulesToResult(base, null as any, 'placo'); // broken rates mid-fill
  assert.equal(out.totalMaterialTnd, base.totalMaterialTnd);
  assert.equal(out.grandTotalTnd, base.grandTotalTnd);
  assert.equal(out.materialItems[0]!.unitPriceTnd, 0);
});

// ════ 6) country_calculation_rules — parsing + strict fallback ════
test('country rules: valid global waste_margin_percent applies to every métier', () => {
  const rows = [{ ruleKey: 'waste_margin_percent', ruleValue: { percent: 15 }, trade: null, isActive: true }];
  assert.equal(resolveCountryWasteMarginDefault(rows, 'placo'), 15);
  assert.equal(resolveCountryWasteMarginDefault(rows, 'demolition'), 15);
});

test('country rules: fiscal + localization keys are IGNORED (fiscal logic untouched)', () => {
  const rows = [
    { ruleKey: 'default_tva', ruleValue: { rate: 19 }, trade: null, isActive: true },
    { ruleKey: 'timbre_fiscal', ruleValue: { amount: 1.0 }, trade: null, isActive: true },
    { ruleKey: 'retenue_garantie', ruleValue: { rate: 5 }, trade: null, isActive: true },
    { ruleKey: 'default_currency', ruleValue: 'TND', trade: null, isActive: true },
  ];
  assert.equal(resolveCountryWasteMarginDefault(rows, 'placo'), null); // → settings default
});

test('country rules: métier-scoped row beats the global row', () => {
  const rows = [
    { ruleKey: 'waste_margin_percent', ruleValue: { percent: 10 }, trade: null, isActive: true },
    { ruleKey: 'waste_margin_percent', ruleValue: { percent: 20 }, trade: 'peinture', isActive: true },
  ];
  assert.equal(resolveCountryWasteMarginDefault(rows, 'peinture'), 20);
  assert.equal(resolveCountryWasteMarginDefault(rows, 'placo'), 10);
  assert.equal(resolveCountryWasteMarginDefault(rows, undefined), 10); // global only
});

test('country rules: inactive / out-of-range / malformed values treated as absent', () => {
  assert.equal(resolveCountryWasteMarginDefault(
    [{ ruleKey: 'waste_margin_percent', ruleValue: { percent: 15 }, isActive: false }], 'placo'), null);
  assert.equal(resolveCountryWasteMarginDefault(
    [{ ruleKey: 'waste_margin_percent', ruleValue: { percent: 150 }, isActive: true }], 'placo'), null);
  assert.equal(resolveCountryWasteMarginDefault(
    [{ ruleKey: 'waste_margin_percent', ruleValue: { percent: 'abc' }, isActive: true }], 'placo'), null);
  assert.equal(resolveCountryWasteMarginDefault('not-an-array', 'placo'), null);
  assert.equal(resolveCountryWasteMarginDefault(null, 'placo'), null);
  assert.equal(resolveCountryWasteMarginDefault(undefined, 'placo'), null);
});

test('country rules: bare-number and {value: n} jsonb shapes accepted', () => {
  assert.equal(resolveCountryWasteMarginDefault(
    [{ ruleKey: 'waste_margin_percent', ruleValue: 12, isActive: true }], 'placo'), 12);
  assert.equal(resolveCountryWasteMarginDefault(
    [{ ruleKey: 'waste_margin_percent', ruleValue: { value: 7 }, isActive: true }], 'placo'), 7);
});

// ════ 7) regression: existing calculators stay numerically identical ════
const PLACO_INPUT: PlacoInput = {
  subType: 'faux_plafond_ba13', length: 6, heightOrWidth: 4,
  openingsCount: 1, openingArea: 1.68,
  boardType: 'plaque_ba13_standard',
  skinType: 'two_sides_single_skin', montantsSpacingCm: 60,
  withInsulation: false, wasteMarginPercent: 10, laborRatePerM2: 18,
  tvaPercent: 19, includeTimbre: true, retenueGarantiePercent: 5,
};

test('regression: calculatePlaco → bridge numerically identical when no price can fill', () => {
  const plain = calculatePlaco(PLACO_INPUT, DEFAULT_MARKET_RATES);
  // empty rates ⇒ a fill is impossible ⇒ every number must survive untouched
  const bridged = applyCalcRulesToResult(plain, [], 'placo');
  assert.equal(bridged.totalMaterialTnd, plain.totalMaterialTnd);
  assert.equal(bridged.grandTotalTnd, plain.grandTotalTnd);
  assert.equal(bridged.tvaAmountTnd, plain.tvaAmountTnd);
  assert.equal(bridged.totalTtcTnd, plain.totalTtcTnd);
  assert.equal(bridged.netAPayerTnd, plain.netAPayerTnd);
  assert.equal(bridged.estimatedLaborTnd, plain.estimatedLaborTnd);
  assert.equal(bridged.wasteMarginPercent, plain.wasteMarginPercent);
  assert.equal(bridged.netAreaM2, plain.netAreaM2);
  assert.deepEqual(
    bridged.materialItems.map(i => ({ id: i.id, qty: i.qty, unit: i.unit, p: i.unitPriceTnd, t: i.totalTnd })),
    plain.materialItems.map(i => ({ id: i.id, qty: i.qty, unit: i.unit, p: i.unitPriceTnd, t: i.totalTnd })),
  );
});

test('regression: with real rates the bridge never reduces prices/quantities (monotone + audit identity)', () => {
  const plain = calculatePlaco(PLACO_INPUT, DEFAULT_MARKET_RATES);
  const bridged = applyCalcRulesToResult(
    calculatePlaco(PLACO_INPUT, DEFAULT_MARKET_RATES), DEFAULT_MARKET_RATES, 'placo');
  assert.deepEqual(bridged.materialItems.map(i => i.qty), plain.materialItems.map(i => i.qty));
  assert.equal(bridged.estimatedLaborTnd, plain.estimatedLaborTnd);
  assert.equal(bridged.totalMaterialTnd >= plain.totalMaterialTnd, true); // fill may only ADD
  for (let i = 0; i < plain.materialItems.length; i++) {
    assert.equal(bridged.materialItems[i]!.unitPriceTnd >= plain.materialItems[i]!.unitPriceTnd, true);
  }
  // audit mathPrecision identity (auditEngine tolerance 0.01) still holds
  const ht = bridged.grandTotalTnd;
  assert.ok(Math.abs(bridged.tvaAmountTnd - (ht * bridged.tvaPercent) / 100) < 0.01);
  assert.ok(Math.abs(bridged.totalTtcTnd - (ht + bridged.tvaAmountTnd + bridged.timbreFiscalTnd)) < 0.01);
});

const GENERIC_INPUT: GenericInput = {
  trade: 'brand_new_trade', areaM2: 20, lengthM: 5,
  wasteMarginPercent: 10, laborRatePerM2: 15,
  tvaPercent: 19, includeTimbre: false, retenueGarantiePercent: 0,
};

test('regression: calculateGeneric is never rule-bridged (strict no-op for other métiers)', () => {
  const plain = calculateGeneric(GENERIC_INPUT, DEFAULT_MARKET_RATES);
  // Production excludes the generic branch entirely; even a direct call must
  // be a strict no-op (identical reference) for a métier without rules.
  const bridged = applyCalcRulesToResult(plain, DEFAULT_MARKET_RATES, 'brand_new_trade');
  assert.strictEqual(bridged, plain);
});

console.log('\ncalculatorRulesBridge tests completed');