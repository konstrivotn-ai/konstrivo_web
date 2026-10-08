/**
 * PHASE B2-B5 — DIRECT MÉTRÉ CORE (DB-free, UI-free).
 *   npx tsx tests/metreDirectCore.test.ts
 *
 * PROOFS (10):
 *  1. dimension defaults → valid calculation.
 *  2. changing a dimension → quantity changes.
 *  3. quantity + unit come from the engine (never hardcoded).
 *  4. formula/breakdown are not invented by the UI.
 *  5. bindings → materials/services through the adapter.
 *  6. missing binding → explicit REVIEW.
 *  7. fiscal adapter uses `computeFiscalData` (call-only, country defaults).
 *  8. no trade-specific branch anywhere in the Direct path.
 *  9. no Project/Zone/Ouvrage/Relevé dependency (+ B1 source gates hold).
 * 10. existing B1 helpers remain valid.
 */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMetreElement, mapMetreElementRow, elementsForTrade } from '../src/data/metreElements';
import { evaluateElement } from '../src/utils/metreEngine';
import { computeFiscalData } from '../src/utils/calculations';
import { getCountryConfig } from '../src/data/countryConfig';
import {
  buildDirectQuantity,
  buildDirectDefaults,
  buildDirectBoundOutput,
  buildDirectFiscal,
  directQuantityError,
} from '../src/utils/metreDirectResult';
import {
  resolveTradeDisplay,
  orderWorkTypesForDisplay,
} from '../src/components/MetreDirectTab';

let passed = 0;
let failed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  PASS ${name}`); }
  catch (err: any) {
    failed++;
    const msg = `  FAIL ${name}\n       ${err?.message || err}`;
    failures.push(msg); console.log(msg);
  }
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.join(HERE, '..', rel), 'utf8');

console.log('\nPHASE B2-B5 - Direct Metre core (form → quantity → bindings → fiscal)\n');

const BASE_ROW = {
  elementCode: 'mur_test_b2',
  labelFr: 'Mur test',
  labelAr: '',
  method: 'surface',
  dims: [{ key: 'a', labelFr: 'Largeur', labelAr: '', unit: 'm' }],
  calc: { op: 'single', dim: 'a' },
  qtyUnit: 'm²',
};
const RATES: any[] = [
  { id: 'm_ba13', nameFr: 'Matériau test', nameAr: 'مادة', unit: 'm²', unitPriceTnd: 5, defaultPriceTnd: 5, category: 'Test' },
];

// ── 1) dimension defaults → valid calculation ───────────────────────────────
test('1. element defaults seed a valid calculation (1.2 x 2.5 x 1 = 3 m2)', () => {
  const placo = getMetreElement('placo', 'panneau_ba13')!;
  const defaults = buildDirectDefaults(placo);
  assert.deepStrictEqual(defaults, { largeur: '1.2', hauteur: '2.5', nb: '1' });
  const r = buildDirectQuantity(placo, defaults);
  assert.ok(r.ok, 'defaults must evaluate');
  assert.strictEqual(r.ok && r.qty, 3);
  assert.ok(r.ok && r.unit === 'm²');
});

// ── 2) changing a dimension → quantity changes ──────────────────────────────
test('2. changing a dimension changes the live quantity', () => {
  const placo = getMetreElement('placo', 'panneau_ba13')!;
  const base = buildDirectQuantity(placo, buildDirectDefaults(placo));
  const changed = buildDirectQuantity(placo, { largeur: 6, hauteur: 2.5, nb: 1 });
  assert.ok(base.ok && changed.ok);
  assert.strictEqual(changed.ok && changed.qty, 15);
  assert.notStrictEqual(changed.ok && changed.qty, base.ok && base.qty);
});
// ── 3) quantity + unit come from the engine ─────────────────────────────────
test('3. quantity and unit are byte-identical to evaluateElement (m² / ml / m²)', () => {
  const cases: Array<[string, string, Record<string, unknown>]> = [
    ['placo', 'panneau_ba13', { largeur: 1.2, hauteur: 2.5, nb: 1 }],       // m²
    ['plomberie', 'reseau_ppr', { longueur: 12 }],                          // ml (never m²)
    ['facade', 'enduit_facade', { cote_a: 6, cote_b: 4, hauteur: 3 }],      // perimeter → m²
  ];
  for (const [trade, code, dims] of cases) {
    const el = getMetreElement(trade, code)!;
    const engine = evaluateElement(el, dims);
    const direct = buildDirectQuantity(el, dims);
    assert.ok(engine.ok && direct.ok, `${trade}/${code} must evaluate`);
    assert.strictEqual(direct.ok && direct.qty, (engine as any).qty);
    assert.strictEqual(direct.ok && direct.unit, (engine as any).unit);
  }
  const plumb = buildDirectQuantity(getMetreElement('plomberie', 'reseau_ppr')!, { longueur: 12 });
  assert.ok(plumb.ok && plumb.unit === 'ml', 'engine unit respected (ml, not m²)');
});

// ── 4) formula/breakdown not invented by the UI ─────────────────────────────
test('4. formula comes from the definition; breakdown derives from the calc spec', () => {
  const placo = getMetreElement('placo', 'panneau_ba13')!;
  const r = buildDirectQuantity(placo, { largeur: 5, hauteur: 2.5, nb: 1 });
  assert.ok(r.ok);
  assert.strictEqual(r.ok && r.formula, placo.qtyFormula);          // exact definition string
  assert.ok(r.ok && r.breakdown.endsWith('= 12.50 m²'));            // spec-derived tail
  assert.ok(r.ok && r.breakdown.includes('Largeur 5.00'));          // raw dims, no fabrication
  // Invalid dims → engine error surfaced, NO fabricated quantity.
  const bad = buildDirectQuantity(placo, { largeur: '', hauteur: 2.5, nb: 1 });
  assert.ok(!bad.ok);
  // Narrow through the adapter helper (this project compiles without
  // strictNullChecks, where `!x.ok` union narrowing is not applied).
  const badErr = directQuantityError(bad);
  assert.ok(badErr);
  assert.strictEqual(badErr.error, 'missing_dim');
  assert.ok(!('qty' in bad));
  assert.ok(badErr.message.length > 0);
});

// ── 5) bindings → materials/services ────────────────────────────────────────
test('5. bound output yields materials (priced) and services from bindings', () => {
  const el = mapMetreElementRow({
    ...BASE_ROW,
    materialBindings: [{ materialCode: 'm_ba13', driver: { type: 'metre_qty' } }],
    serviceBindings: [{ serviceNameFr: 'Pose test', driver: { type: 'metre_qty' }, outputUnit: 'm²' }],
  }, 'placo')!;
  assert.ok(el);
  const out = buildDirectBoundOutput({
    element: el, dims: { a: 10 }, lines: [{ qty: 10, unit: 'm²' }], rates: RATES,
  });
  assert.deepStrictEqual(out.issues, []);
  assert.strictEqual(out.materialItems.length, 1);
  assert.strictEqual(out.materialItems[0].qty, 10);
  assert.strictEqual(out.materialItems[0].unit, 'm²');
  assert.strictEqual(out.materialItems[0].unitPriceTnd, 5);
  assert.strictEqual(out.materialItems[0].totalTnd, 50);
  assert.strictEqual(out.serviceItems.length, 1);
  assert.strictEqual(out.serviceItems[0].nameFr, 'Pose test');
  assert.strictEqual(out.serviceItems[0].qty, 10);
  assert.deepStrictEqual(out.totals, { 'm²': 10 });
});
// ── 6) missing binding → explicit REVIEW ────────────────────────────────────
test('6. element without bindings → REVIEW missing_binding, nothing invented', () => {
  const plain = mapMetreElementRow({ ...BASE_ROW }, 'placo')!;
  assert.ok(plain);
  const out = buildDirectBoundOutput({
    element: plain, dims: { a: 10 }, lines: [{ qty: 10, unit: 'm²' }], rates: RATES,
  });
  assert.strictEqual(out.materialItems.length, 0);
  assert.strictEqual(out.serviceItems.length, 0);
  assert.ok(out.issues.some((i) => i.type === 'missing_binding'), 'REVIEW must be explicit');
});

// ── 7) fiscal adapter uses computeFiscalData ────────────────────────────────
test('7. buildDirectFiscal === computeFiscalData with country defaults (call-only)', () => {
  const adapter = read('src/utils/metreDirectResult.ts');
  assert.ok(adapter.includes('computeFiscalData('), 'adapter must CALL the shared authority');
  assert.ok(!adapter.includes('function computeFiscalData'), 'adapter must never REDEFINE it');
  const cfg = getCountryConfig('TN');
  const opts = {
    tvaPercent: Number(cfg.defaultVatRate ?? 0) || 0,
    includeTimbre: Number(cfg.timbreFiscalDefault ?? 0) > 0,
    retenueGarantiePercent: Number(cfg.standardRetenueRate ?? 0) || 0,
  };
  const direct = buildDirectFiscal(1000, 500, 'TN');
  const expected = computeFiscalData(1000, 500, opts);
  assert.strictEqual(direct.sousTotalHtTnd, expected.grandTotalTnd);
  assert.strictEqual(direct.tvaPercent, expected.tvaPercent);
  assert.strictEqual(direct.tvaAmountTnd, expected.tvaAmountTnd);
  assert.strictEqual(direct.timbreFiscalTnd, expected.timbreFiscalTnd);
  assert.strictEqual(direct.retenueGarantiePercent, expected.retenueGarantiePercent);
  assert.strictEqual(direct.retenueGarantieTnd, expected.retenueGarantieTnd);
  assert.strictEqual(direct.totalTtcTnd, expected.totalTtcTnd);
  assert.strictEqual(direct.netAPayerTnd, expected.netAPayerTnd);
  // No labour rate invented: labour TND stays exactly what the caller passed.
  assert.strictEqual(buildDirectFiscal(0, 0, 'TN').estimatedLaborTnd, 0);
});

// ── 8) no trade-specific branch anywhere ────────────────────────────────────
test('8. no trade-specific branch in the Direct path (adapter + component)', () => {
  // Comments stripped first — prose ("if (trade === …) is forbidden") must
  // never trip a code check (same convention as tests/metreDataDriven.test.ts).
  const stripComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const adapter = stripComments(read('src/utils/metreDirectResult.ts'));
  const comp = stripComments(read('src/components/MetreDirectTab.tsx'));
  for (const [name, src] of [['adapter', adapter], ['component', comp]] as const) {
    assert.ok(!/trade\s*===/.test(src), `${name}: no trade === branch`);
    assert.ok(!/switch\s*\(\s*trade/.test(src), `${name}: no switch(trade)`);
    for (const m of ["'placo'", "'plomberie'", "'peinture'", "'facade'", "'electricite'", "'maconnerie'"]) {
      assert.ok(!src.includes(m), `${name} must not name métier ${m}`);
    }
  }
  // The engine knows nothing about the Direct path.
  const engine = read('src/utils/metreEngine.ts');
  assert.ok(!engine.includes('metreDirectResult'), 'engine must not know the adapter');
  assert.ok(!engine.includes('workType'), 'engine must never read workType');
});

// ── 9) no workflow dependency + B1 source gates still hold ──────────────────
test('9. no Project/Zone/Ouvrage/Relevé dependency; B1 gates remain green', () => {
  const comp = read('src/components/MetreDirectTab.tsx');
  const adapter = read('src/utils/metreDirectResult.ts');
  for (const [name, src] of [['component', comp], ['adapter', adapter]] as const) {
    for (const token of [
      'metreApi', 'listZones', 'listOuvrages', 'listReleves', 'addLine',
      'createZone', 'createOuvrage', 'createReleve',
      'selectedProjectId', 'selectedZoneId', 'selectedOuvrageId', 'selectedReleveId',
      'MetreWorkflowTab',
    ]) {
      assert.ok(!src.includes(token), `${name} must not depend on "${token}"`);
    }
    assert.ok(!src.includes('fetch('), `${name}: no network call`);
  }
  // B1 test-7 source gates on the component remain literally true.
  for (const token of ['metreEngine', 'evaluateElement', 'computeMetreBoundOutputs', 'aggregateQuantities', 'metreBindings']) {
    assert.ok(!comp.includes(token), `B1 gate must hold: component has no "${token}"`);
  }
});

// ── 10) existing B1 helpers remain valid ────────────────────────────────────
test('10. B1 helpers still exported and behaving (pickers unaffected)', () => {
  assert.strictEqual(
    resolveTradeDisplay({ code: 'placo', labelFr: 'X', labelAr: 'y' }).labelFr,
    'PLACO / PLÂTRE',
  );
  const registry = elementsForTrade('aluminium');
  const ordered = orderWorkTypesForDisplay(registry, ['consommable', 'profil']);
  assert.strictEqual(ordered.length, registry.length);
  assert.strictEqual(ordered[0].code, 'consommable');
  assert.strictEqual(ordered[1].code, 'profil');
  assert.ok(read('tests/metreDirectSkeleton.test.ts').includes('npx tsx'), 'B1 suite intact');
});

// ── Summary ─────────────────────────────────────────────────────────────────
console.log('\n==============================================');
console.log(` Phase B2-B5 direct core: ${passed} passed, ${failed} failed`);
console.log('==============================================\n');
if (failures.length > 0) {
  console.log('FAILED TESTS:');
  failures.forEach((f) => console.log(f));
  console.log('');
}
process.exit(failed > 0 ? 1 : 0);


