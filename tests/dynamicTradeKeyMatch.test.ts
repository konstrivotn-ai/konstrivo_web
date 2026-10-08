/**
 * Dynamic-trade key-matching regression (DB-free).
 * calculateGeneric() must resolve materials with the same normalization as
 * the Outils display (catalogKey): accents/separators/case-insensitive.
 * Run: npx tsx tests/dynamicTradeKeyMatch.test.ts
 */
import { strict as assert } from 'node:assert';
import { calculateGeneric } from '../src/utils/calculations';
import type { MaterialRate } from '../src/types';

let passed = 0;
let failed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  PASS ${name}`); }
  catch (err: any) {
    failed++;
    const msg = `  FAIL ${name}\n       ${err?.message || err}`;
    failures.push(msg);
    console.log(msg);
  }
}

console.log('\nDynamic trade key-match regression (DB-free)\n');

function mk(id: string, category: string, trade: string | undefined, price = 10): MaterialRate {
  return {
    id, category, trade,
    nameFr: id, nameAr: '',
    unit: 'm²', unitPriceTnd: price, defaultPriceTnd: price,
  };
}

function baseInput(trade: string) {
  return {
    trade, areaM2: 10, wasteMarginPercent: 0,
    laborRatePerM2: 10, tvaPercent: 19,
    includeTimbre: false, retenueGarantiePercent: 0,
  };
}

test('storage exact code still resolves (baseline)', () => {
  const r = calculateGeneric(baseInput('storage'), [mk('s1', 'storage', 'storage')]);
  assert.equal(r.materialItems.length, 1);
  assert.equal(r.materialItems[0].id, 's1');
});

test('Aluminium variants resolve (case/accents/separators)', () => {
  const rates = [
    mk('a1', 'Aluminium', 'aluminium'),
    mk('a2', 'ALUMINIUM', 'ALUMINIUM'),
    mk('a3', 'Profilés', 'profiles'),
  ];
  for (const t of ['aluminium', 'Aluminium', 'ALUMINIUM', ' aluminium ']) {
    const r = calculateGeneric(baseInput(t), rates);
    assert.ok(r.materialItems.some((i) => i.id === 'a1'), `${t} resolves a1`);
    assert.ok(r.materialItems.some((i) => i.id === 'a2'), `${t} resolves a2`);
  }
  const rp = calculateGeneric(baseInput('profiles'), rates);
  assert.ok(rp.materialItems.some((i) => i.id === 'a3'), 'profiles resolves Profilés');
  const rp2 = calculateGeneric(baseInput('Profilés'), rates);
  assert.ok(rp2.materialItems.some((i) => i.id === 'a3'), 'Profilés resolves profiles');
});

test('Installation Chauffroie variants resolve (space/underscore/case)', () => {
  const rates = [mk('c1', 'Installation Chauffroie', 'installation_chauffroie')];
  for (const t of ['Installation Chauffroie', 'installation_chauffroie', 'INSTALLATION CHAUFFROIE', ' installation-chauffroie ']) {
    const r = calculateGeneric(baseInput(t), rates);
    assert.equal(r.materialItems.length, 1, `${t} resolves`);
    assert.equal(r.materialItems[0].id, 'c1');
  }
});

test('no material still yields placeholder (unchanged)', () => {
  const r = calculateGeneric(baseInput('unknown_xyz'), [mk('s1', 'storage', 'storage')]);
  assert.equal(r.materialItems.length, 1);
  assert.equal(r.materialItems[0].id, 'unknown_xyz-material');
  assert.equal(r.materialItems[0].unitPriceTnd, 0);
});

console.log(`\nDynamicTrade KeyMatch Result: ${passed} PASS / ${failed} FAIL`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
