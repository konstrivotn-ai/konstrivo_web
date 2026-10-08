/**
 * PHASE 2.2 — BINDINGS DATA LOOP (DB-free, UI-free, read-path proof).
 *   npx tsx tests/metreBindingsLoop.test.ts
 *
 * PROOFS (the 7 required):
 *  1. materialBindings arrive via mapping when present.
 *  2. serviceBindings arrive via mapping when present.
 *  3. linkedSlotCode does not disappear when present.
 *  4. Legacy elements (config registry + legacy row) stay binding-free.
 *  5. Binding data never changes the engine quantity.
 *  6. No trade-specific branch (nor binding read) inside metreEngine.
 *  7. Phase 1 regression suites remain intact (executed separately by the runner).
 * + E2E: DB-row → mapMetreElementRow → computeMetreBoundOutputs → output items.
 *
 * FORBIDDEN HERE: new bindings data, DB/Supabase writes, engine/calculator
 * changes, UX/workflow changes, new métiers/work types.
 */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  METRE_ELEMENTS,
  mapMetreElementRow,
  getMetreElement,
} from '../src/data/metreElements';
import { evaluateElement } from '../src/utils/metreEngine';
import { computeMetreBoundOutputs } from '../src/utils/metreToCalculationResult';

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

console.log('\nPHASE 2.2 - Bindings data loop (source → mapping → output)\n');

// ── Shared fixtures (in-memory only — never persisted) ──────────────────────
const BASE_ROW = {
  elementCode: 'mur_test_22',
  labelFr: 'Mur test',
  labelAr: '',
  method: 'surface',
  dims: [
    { key: 'largeur', labelFr: 'Largeur', labelAr: '', unit: 'm' },
    { key: 'hauteur', labelFr: 'Hauteur', labelAr: '', unit: 'm' },
  ],
  calc: { op: 'product', dims: ['largeur', 'hauteur'] },
  qtyUnit: 'm²',
};
const MATERIALS = [{ materialCode: 'm_ba13', driver: { type: 'metre_qty' } }];
const SERVICES = [{ serviceNameFr: 'Pose test', driver: { type: 'metre_qty' }, outputUnit: 'm²' }];
const DIMS = { largeur: 5, hauteur: 2 }; // 10 m²

// ── 1) materialBindings travel through the mapping ──────────────────────────

test('1. materialBindings arrive via mapMetreElementRow when present', () => {
  const el = mapMetreElementRow({ ...BASE_ROW, materialBindings: MATERIALS }, 'placo');
  assert.ok(el, 'row with materialBindings must map');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(el!, 'materialBindings'), true);
  assert.deepStrictEqual((el as any).materialBindings, MATERIALS);
});

// ── 2) serviceBindings travel through the mapping ───────────────────────────

test('2. serviceBindings arrive via mapMetreElementRow when present', () => {
  const el = mapMetreElementRow({ ...BASE_ROW, serviceBindings: SERVICES }, 'placo');
  assert.ok(el, 'row with serviceBindings must map');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(el!, 'serviceBindings'), true);
  assert.deepStrictEqual((el as any).serviceBindings, SERVICES);
});

// ── 3) linkedSlotCode does not disappear ────────────────────────────────────

test('3. linkedSlotCode survives mapping; config element keeps its slot', () => {
  const el = mapMetreElementRow({ ...BASE_ROW, linkedSlotCode: 'placo_board' }, 'placo')!;
  assert.ok(el);
  assert.strictEqual((el as any).linkedSlotCode, 'placo_board');
  // Config source: the registry element carries its slot inline (unchanged).
  const placo = getMetreElement('placo', 'panneau_ba13')!;
  assert.strictEqual((placo as any).linkedSlotCode, 'placo_board');
  // Non-string slot is ignored (documented), the row itself stays valid.
  const bad = mapMetreElementRow({ ...BASE_ROW, linkedSlotCode: 42 }, 'placo')!;
  assert.ok(bad);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(bad, 'linkedSlotCode'), false);
});

// ── 4) Legacy elements stay binding-free ────────────────────────────────────

test('4. legacy row + EVERY config element remain binding-free (no invented data)', () => {
  const legacy = mapMetreElementRow(BASE_ROW, 'placo')!;
  assert.ok(legacy);
  for (const k of ['materialBindings', 'serviceBindings']) {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(legacy, k), false, `${k} must be absent on legacy rows`);
  }
  let checked = 0;
  for (const els of Object.values(METRE_ELEMENTS)) {
    for (const el of els) {
      checked++;
      assert.strictEqual('materialBindings' in el, false, `${el.trade}/${el.code}: no config bindings expected`);
      assert.strictEqual('serviceBindings' in el, false, `${el.trade}/${el.code}: no config bindings expected`);
    }
  }
  assert.ok(checked >= 16, `expected the full registry checked, got ${checked}`);
});
// ── 5) Binding data never changes the engine quantity ──────────────────────

test('5. binding data leaves the engine quantity byte-identical', () => {
  const withB = mapMetreElementRow({
    ...BASE_ROW, materialBindings: MATERIALS, serviceBindings: SERVICES, linkedSlotCode: 'placo_board',
  }, 'placo')!;
  const withoutB = mapMetreElementRow(BASE_ROW, 'placo')!;
  const a = evaluateElement(withB, DIMS);
  const b = evaluateElement(withoutB, DIMS);
  assert.deepStrictEqual(a, b);        // same result object, field for field
  assert.ok(a.ok && (a as any).qty === 10 && (a as any).unit === 'm²');
});

// ── 6) No trade-specific branch (nor binding read) inside the engine ────────

test('6. metreEngine: no trade branch and never reads bindings', () => {
  const engine = read('src/utils/metreEngine.ts');
  assert.ok(!/trade\s*===/.test(engine), 'engine must never compare trade ===');
  assert.ok(!/switch\s*\(\s*trade/.test(engine), 'engine must never switch on trade');
  for (const m of ['placo', 'plomberie', 'aluminium', 'peinture', 'facade', 'electricite']) {
    assert.ok(!engine.includes(`'${m}'`), `engine must not name métier '${m}'`);
  }
  for (const field of ['materialBindings', 'serviceBindings', 'linkedSlotCode', 'computeMetreBoundOutputs']) {
    assert.ok(!engine.includes(field), `engine must never read "${field}"`);
  }
});

// ── 7) Phase 1 suites intact (their real execution is the runner's job) ─────

test('7. Phase 1 regression suites present + PLACO golden fixture intact', () => {
  for (const f of [
    'tests/metreEngine.test.ts',
    'tests/metreRegistry.test.ts',
    'tests/metreDataDriven.test.ts',
    'tests/metreWiring.test.ts',
    'tests/metreEnrichedSpec.test.ts',
    'tests/metreWorkTypeSpec.test.ts',
  ]) {
    const src = read(f);
    assert.ok(src.includes('npx tsx'), `${f} must remain the standalone Phase 1 suite`);
    assert.ok(src.length > 1000, `${f} must be intact`);
  }
  assert.ok(read('tests/fixtures/formulas/golden.json').includes('"placo_cloison_fixe"'));
});

// ── E2E: the full data loop, source → mapping → Métré output ────────────────

test('E2E. DB row → mapping → computeMetreBoundOutputs → material + service items', () => {
  const element = mapMetreElementRow({
    ...BASE_ROW,
    materialBindings: MATERIALS,
    serviceBindings: SERVICES,
  }, 'placo')!;
  assert.ok(element, 'bound row must map');
  const rates: any[] = [
    { id: 'm_ba13', nameFr: 'Matériau test', nameAr: 'مادة', unit: 'm²', unitPriceTnd: 5, defaultPriceTnd: 5, category: 'Test' },
  ];
  const out = computeMetreBoundOutputs({
    metreElement: element,
    metreDims: DIMS,
    metreLines: [{ qty: 10, unit: 'm²' }],
    rates: rates as any,
  });
  // No REVIEW issues: driver, coefficient, coverage, price all resolve.
  assert.deepStrictEqual(out.issues, []);
  // Material leg: 10 m² × 5 TND = 50.
  assert.strictEqual(out.materialItems.length, 1);
  const m = out.materialItems[0];
  assert.strictEqual(m.id, 'm_ba13');
  assert.strictEqual(m.qty, 10);
  assert.strictEqual(m.unit, 'm²');
  assert.strictEqual(m.unitPriceTnd, 5);
  assert.strictEqual(m.totalTnd, 50);
  // Service leg: same driver → 10 m².
  assert.strictEqual(out.serviceItems.length, 1);
  assert.strictEqual(out.serviceItems[0].nameFr, 'Pose test');
  assert.strictEqual(out.serviceItems[0].qty, 10);
  assert.strictEqual(out.serviceItems[0].unit, 'm²');
  // Totals unaffected by bindings (engine aggregation only).
  assert.deepStrictEqual(out.totals, { 'm²': 10 });

  // Legacy contrast: same row WITHOUT bindings → explicit REVIEW, nothing invented.
  const legacy = computeMetreBoundOutputs({
    metreElement: mapMetreElementRow(BASE_ROW, 'placo')!,
    metreDims: DIMS,
    metreLines: [{ qty: 10, unit: 'm²' }],
    rates: rates as any,
  });
  assert.strictEqual(legacy.materialItems.length, 0);
  assert.strictEqual(legacy.serviceItems.length, 0);
  assert.ok(legacy.issues.some((i: any) => i.type === 'missing_binding'));
});

// ── Summary ─────────────────────────────────────────────────────────────────
console.log('\n==============================================');
console.log(` Phase 2.2 bindings loop: ${passed} passed, ${failed} failed`);
console.log('==============================================\n');
if (failures.length > 0) {
  console.log('FAILED TESTS:');
  failures.forEach((f) => console.log(f));
  console.log('');
}
process.exit(failed > 0 ? 1 : 0);

