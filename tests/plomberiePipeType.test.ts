/**
 * Plomberie — targeted fix test (pipeType + wasteFactor):
 *   npx tsx tests/plomberiePipeType.test.ts
 *
 * Proves:
 *   1. `pipeType` actually changes materials/quantities (PPR / Multicouche / PVC).
 *   2. PVC évacuation lines receive wasteFactor (consistent with PPR lines).
 *   3. Current behavior of the other types is unbroken (PPR = legacy output at
 *      default inputs; Multicouche follows the same documented equations).
 */
import { strict as assert } from 'node:assert';
import { calculatePlomberie, PlomberieInput } from '../src/utils/calculations';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS ${name}`);
  } catch (err: any) {
    console.log(`  FAIL ${name}\n       ${err?.message || err}`);
    process.exit(1);
  }
}

const input = (over: Partial<PlomberieInput> = {}): PlomberieInput => ({
  pointsCount: 4,
  networkLengthM: 18,
  pipeType: 'ppr',
  wasteMarginPercent: 10,
  laborRatePerPoint: 65.0,
  ...over,
});

const ids = (r: ReturnType<typeof calculatePlomberie>) => r.materialItems.map(i => i.id);
const qtys = (r: ReturnType<typeof calculatePlomberie>) => r.materialItems.map(i => i.qty);
const line = (r: ReturnType<typeof calculatePlomberie>, id: string) => {
  const l = r.materialItems.find(i => i.id === id);
  assert.ok(l, `expected material line ${id}`);
  return l!;
};

// ════ 1) pipeType changes materials/quantities ════

test('pipeType=ppr returns PPR + fittings + évacuation + consumables', () => {
  const r = calculatePlomberie(input({ pipeType: 'ppr' }), []);
  assert.deepEqual(ids(r), [
    'ppr_tube_20_4m', 'ppr_tube_25_4m',
    'pvc_tube_40_4m', 'pvc_tube_110_4m',
    'raccord_ppr_coude_te', 'colle_pvc_pot', 'teflon_ptfe',
  ]);
  assert.equal(r.subType, 'ppr');
});

test('pipeType=multicouche swaps to Multicouche tubes + sertir fittings (no PPR ids)', () => {
  const r = calculatePlomberie(input({ pipeType: 'multicouche' }), []);
  assert.deepEqual(ids(r), [
    'multicouche_tube_20_4m', 'multicouche_tube_25_4m',
    'pvc_tube_40_4m', 'pvc_tube_110_4m',
    'raccord_multicouche_sertir', 'colle_pvc_pot', 'teflon_ptfe',
  ]);
  assert.ok(!ids(r).some(id => id.startsWith('ppr_')), 'no PPR material under multicouche');
  assert.ok(!ids(r).includes('raccord_ppr_coude_te'));
  assert.equal(r.subType, 'multicouche');
});

test('pipeType=pvc_evac returns only the évacuation family (no alimentation)', () => {
  const r = calculatePlomberie(input({ pipeType: 'pvc_evac' }), []);
  assert.deepEqual(ids(r), ['pvc_tube_40_4m', 'pvc_tube_110_4m', 'colle_pvc_pot']);
  assert.equal(r.subType, 'pvc_evac');
});

test('the three pipeType selections produce pairwise different materials and quantities', () => {
  const ppr = calculatePlomberie(input({ pipeType: 'ppr' }), []);
  const mc = calculatePlomberie(input({ pipeType: 'multicouche' }), []);
  const pvc = calculatePlomberie(input({ pipeType: 'pvc_evac' }), []);
  assert.notDeepEqual(ids(ppr), ids(mc), 'ppr ≠ multicouche materials');
  assert.notDeepEqual(ids(ppr), ids(pvc), 'ppr ≠ pvc_evac materials');
  assert.notDeepEqual(ids(mc), ids(pvc), 'multicouche ≠ pvc_evac materials');
  assert.notDeepEqual(qtys(ppr), qtys(pvc), 'ppr ≠ pvc_evac quantities');
  assert.notDeepEqual(qtys(mc), qtys(pvc), 'multicouche ≠ pvc_evac quantities');
});

// ════ 2) PVC receives wasteFactor ════

test('PVC évacuation quantities include wasteFactor (L=40, waste 10% → 6 and 4)', () => {
  const r = calculatePlomberie(input({ pipeType: 'pvc_evac', networkLengthM: 40, wasteMarginPercent: 10 }), []);
  assert.equal(line(r, 'pvc_tube_40_4m').qty, 6);  // ceil(40×0.5/4 × 1.10) = ceil(5.5)
  assert.equal(line(r, 'pvc_tube_110_4m').qty, 4); // ceil(40×0.3/4 × 1.10) = ceil(3.3)
});

test('PVC évacuation without waste stays at the base equation (L=40, waste 0 → 5 and 3)', () => {
  const r = calculatePlomberie(input({ pipeType: 'pvc_evac', networkLengthM: 40, wasteMarginPercent: 0 }), []);
  assert.equal(line(r, 'pvc_tube_40_4m').qty, 5);
  assert.equal(line(r, 'pvc_tube_110_4m').qty, 3);
});

test('wasteFactor applies to PVC lines inside pipeType=ppr too (consistent)', () => {
  const r = calculatePlomberie(input({ pipeType: 'ppr', networkLengthM: 40, wasteMarginPercent: 10 }), []);
  assert.equal(line(r, 'pvc_tube_40_4m').qty, 6);
  assert.equal(line(r, 'pvc_tube_110_4m').qty, 4);
  assert.equal(line(r, 'ppr_tube_20_4m').qty, 8); // ceil(40×0.7/4 × 1.10) = ceil(7.7)
  assert.equal(line(r, 'ppr_tube_25_4m').qty, 4); // ceil(40×0.3/4 × 1.10) = ceil(3.3)
});

// ════ 3) current behavior of the other types not broken ════

test('PPR at default UI inputs = legacy output exactly (ids, qtys, prices, formulas)', () => {
  const r = calculatePlomberie(input(), []); // points 4, L 18, waste 10%
  assert.deepEqual(qtys(r), [4, 2, 3, 2, 38, 1, 3]);
  assert.deepEqual(r.materialItems.map(i => i.unitPriceTnd), [9.5, 14.0, 9.0, 24.0, 1.8, 11.0, 1.5]);
  assert.equal(line(r, 'ppr_tube_20_4m').formulaUsed, '(18m × 0.7 × 1.10) / 4');
  assert.equal(line(r, 'ppr_tube_25_4m').formulaUsed, '(18m × 0.3) / 4');
  assert.equal(line(r, 'pvc_tube_40_4m').formulaUsed, 'Évacuation lavabos/douches');
  assert.equal(line(r, 'pvc_tube_110_4m').formulaUsed, 'Collecteurs principaux WC');
  assert.equal(line(r, 'raccord_ppr_coude_te').qty, 38); // ceil(4×4 + 18×1.2)
  assert.equal(r.estimatedLaborTnd, 4 * 65);
  assert.equal(r.totalMaterialTnd, r.materialItems.reduce((a, i) => a + i.totalTnd, 0));
});

test('Multicouche reuses the same documented equations as PPR (splits, raccords)', () => {
  const r = calculatePlomberie(input({ pipeType: 'multicouche' }), []);
  assert.equal(line(r, 'multicouche_tube_20_4m').qty, 4); // same 0.7 split as PPR20
  assert.equal(line(r, 'multicouche_tube_25_4m').qty, 2); // same 0.3 split as PPR25
  assert.equal(line(r, 'raccord_multicouche_sertir').qty, 38); // same points×4 + réseau
  assert.equal(line(r, 'multicouche_tube_20_4m').formulaUsed, '(18m × 0.7 × 1.10) / 4');
  assert.equal(line(r, 'colle_pvc_pot').qty, 1, 'évacuation glue present for sanitaire job');
  assert.equal(r.estimatedLaborTnd, 4 * 65, 'labor untouched');
  assert.equal(r.totalMaterialTnd, r.materialItems.reduce((a, i) => a + i.totalTnd, 0));
});

test('PPR lines still resolve server rates when provided (price lookup untouched)', () => {
  const r = calculatePlomberie(input(), [{
    id: 'ppr_tube_20_4m', category: 'plomberie', nameFr: 'PPR20', nameAr: '',
    unit: 'unit', unitPriceTnd: 12.3, defaultPriceTnd: 12.3,
  }]);
  assert.equal(line(r, 'ppr_tube_20_4m').unitPriceTnd, 12.3);
  assert.equal(line(r, 'ppr_tube_20_4m').qty, 4, 'quantity independent from price');
});

console.log('  — plomberie pipeType tests done —');