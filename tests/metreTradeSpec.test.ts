/**
 * PHASE 2.1 — MÉTRÉ EXTENSIBLE DATA CONTRACT (DB-free, UI-free).
 *   npx tsx tests/metreTradeSpec.test.ts
 *
 * PROOFS (10):
 *  1. MetreTradeSpec shape is valid (fail-closed validator).
 *  2. Existing legacy elements remain valid & byte-identical (side-car design).
 *  3. PLACO descriptor is inert (same quantity with/without).
 *  4. PLOMBERIE descriptor is inert.
 *  5. ALUMINIUM descriptor is inert.
 *  6. Different métiers expose different dimension keys with NO engine branch.
 *  7. Invalid descriptors are rejected fail-closed.
 *  8. Bindings mapping is preserved when present, absent when not.
 *  9. No trade-specific branch exists in metreEngine (source-level).
 * 10. Phase 1 regression suites are present and untouched (markers + data).
 *
 * FORBIDDEN HERE: new work types, new calc ops, UI, DB rows, PLACO changes.
 */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  METRE_TRADE_SPECS,
  METRE_WORK_TYPE_SPECS,
  isValidMetreTradeSpec,
  getMetreTradeSpec,
  getWorkTypeSpec,
  resolveWorkTypeSpec,
} from '../src/data/metreTradeSpecs';
import {
  getMetreElement,
  elementsForTrade,
  mapMetreElementRow,
} from '../src/data/metreElements';
import { evaluateElement } from '../src/utils/metreEngine';

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

console.log('\nPHASE 2.1 - Metre extensible data contract (trade spec + descriptors + bindings)\n');

// ── 1) MetreTradeSpec shape is valid ────────────────────────────────────────

test('1. MetreTradeSpec: validator accepts full + minimal specs, rejects malformed', () => {
  assert.strictEqual(isValidMetreTradeSpec(undefined), true); // absent = valid
  assert.strictEqual(isValidMetreTradeSpec({
    code: 'x', labelFr: 'X', labelAr: '',
    workTypeOrder: ['a', 'b'], defaultWastePercent: 10, defaultMethod: 'surface',
  }), true);
  assert.strictEqual(isValidMetreTradeSpec({ code: ' ', labelFr: 'X', labelAr: '' }), false);
  assert.strictEqual(isValidMetreTradeSpec({ code: 'x', labelAr: '' }), false);
  assert.strictEqual(isValidMetreTradeSpec({ code: 'x', labelFr: 'X', labelAr: 42 }), false);
  assert.strictEqual(isValidMetreTradeSpec({ code: 'x', labelFr: 'X', labelAr: '', workTypeOrder: 'porte' }), false);
  assert.strictEqual(isValidMetreTradeSpec({ code: 'x', labelFr: 'X', labelAr: '', workTypeOrder: [''] }), false);
  assert.strictEqual(isValidMetreTradeSpec({ code: 'x', labelFr: 'X', labelAr: '', defaultWastePercent: -1 }), false);
  assert.strictEqual(isValidMetreTradeSpec({ code: 'x', labelFr: 'X', labelAr: '', defaultMethod: 'invented' }), false);
});

test('1b. MetreTradeSpec: the 3 registered trades are valid and order resolves', () => {
  for (const code of ['placo', 'plomberie', 'aluminium']) {
    const spec = getMetreTradeSpec(code);
    assert.ok(spec, `${code} trade spec missing`);
    assert.strictEqual(isValidMetreTradeSpec(spec), true);
    assert.strictEqual(spec!.code, code);
    for (const elCode of spec!.workTypeOrder ?? []) {
      assert.ok(getMetreElement(code, elCode), `${code}/${elCode} in workTypeOrder must exist`);
    }
  }
  assert.strictEqual(getMetreTradeSpec('trade_inconnu'), null);
  assert.strictEqual(getMetreTradeSpec(null), null);
});

// ── 2) Existing legacy elements remain valid (untouched by side-car design) ─

test('2. legacy elements: identity unchanged, NO workType key on elements', () => {
  const placo = getMetreElement('placo', 'panneau_ba13')!;
  assert.ok(placo && placo.trade === 'placo' && placo.method === 'surface');
  assert.deepStrictEqual(placo.calc, { op: 'product', dims: ['largeur', 'hauteur', 'nb'] });
  assert.strictEqual(placo.qtyFormula, 'Largeur × Hauteur × Nb');
  assert.strictEqual(placo.unit, 'm²');
  assert.strictEqual((placo as any).linkedSlotCode, 'placo_board');

  const plom = getMetreElement('plomberie', 'reseau_ppr')!;
  assert.ok(plom && plom.method === 'longueur' && plom.unit === 'ml');
  assert.deepStrictEqual(plom.calc, { op: 'single', dim: 'longueur' });

  const porte = getMetreElement('aluminium', 'porte')!;
  assert.ok(porte && porte.method === 'surface' && porte.unit === 'm²');
  assert.deepStrictEqual(porte.calc, { op: 'product', dims: ['largeur', 'hauteur', 'nb'] });

  // Side-car design: descriptors NEVER live on the registry elements.
  for (const [trade, code] of [['placo', 'panneau_ba13'], ['plomberie', 'reseau_ppr'], ['aluminium', 'porte']] as const) {
    const el = getMetreElement(trade, code)!;
    assert.ok(!('workType' in el), `${trade}/${code} element must stay byte-identical (no workType key)`);
  }
  // Registry lookups unchanged.
  assert.ok(elementsForTrade('aluminium').length >= 11);
  // B7-BATCH1: plomberie grew data-only (reseau_ppr frozen + evacuation_pvc +
  // point_eau); legacy element assertions above still pin reseau_ppr identity.
  assert.ok(elementsForTrade('plomberie').length >= 1);
  assert.ok(getMetreElement('plomberie', 'reseau_ppr'), 'reseau_ppr still present');
});
// ── 3-5) Descriptors are INERT (same inputs ⇒ same result) ─────────────────

test('3. PLACO descriptor present + inert (1.2 x 2.5 x 1 = 3 m2 unchanged)', () => {
  const el = getMetreElement('placo', 'panneau_ba13')!;
  const spec = getWorkTypeSpec('placo', 'panneau_ba13');
  assert.ok(spec, 'PLACO descriptor missing');
  assert.strictEqual(spec!.code, 'panneau_ba13');
  assert.strictEqual(spec!.measurementMethod, 'surface');
  assert.ok(Array.isArray(spec!.norms) && spec!.norms!.length === 2);
  assert.ok(spec!.methodology && spec!.validationHints?.length);
  assert.ok(spec!.durationHint && spec!.durationHint.value > 0);
  const dims = { largeur: 1.2, hauteur: 2.5, nb: 1 };
  const base = evaluateElement(el, dims);
  const withDesc = evaluateElement({ ...el, workType: spec! } as any, dims);
  assert.deepStrictEqual(withDesc, base);
  assert.strictEqual((base as any).qty, 3);
  assert.strictEqual((base as any).unit, 'm²');
});

test('4. PLOMBERIE descriptor present + inert (12 ml unchanged)', () => {
  const el = getMetreElement('plomberie', 'reseau_ppr')!;
  const spec = getWorkTypeSpec('plomberie', 'reseau_ppr');
  assert.ok(spec && spec.code === 'reseau_ppr' && spec.measurementMethod === 'longueur');
  const dims = { longueur: 12 };
  const base = evaluateElement(el, dims);
  const withDesc = evaluateElement({ ...el, workType: spec! } as any, dims);
  assert.deepStrictEqual(withDesc, base);
  assert.ok((base as any).ok && (base as any).qty === 12 && (base as any).unit === 'ml');
});

test('5. ALUMINIUM descriptor present + inert (0.9 x 2.1 x 1 = 1.89 m2 unchanged)', () => {
  const el = getMetreElement('aluminium', 'porte')!;
  const spec = getWorkTypeSpec('aluminium', 'porte');
  assert.ok(spec && spec.code === 'porte' && spec.measurementMethod === 'surface');
  assert.ok(spec.norms?.length && spec.durationHint);
  const dims = { largeur: 0.9, hauteur: 2.1, nb: 1 };
  const base = evaluateElement(el, dims);
  const withDesc = evaluateElement({ ...el, workType: spec! } as any, dims);
  assert.deepStrictEqual(withDesc, base);
  assert.ok((base as any).ok && (base as any).qty === 1.89);
  // A trade WITHOUT a descriptor still resolves normally (aluminium/fenetre).
  assert.strictEqual(getWorkTypeSpec('aluminium', 'fenetre'), null);
});

// ── 6) Different métier fields, zero engine branching ───────────────────────

test('6. métier-specific dimension keys coexist without engine branching', () => {
  const keysOf = (trade: string, code: string) =>
    new Set((getMetreElement(trade, code)?.dims ?? []).map((d) => d.key));
  const placo = keysOf('placo', 'panneau_ba13');      // largeur, hauteur, nb
  const plom = keysOf('plomberie', 'reseau_ppr');      // longueur
  const facade = keysOf('facade', 'enduit_facade');    // cote_a, cote_b, hauteur
  const elec = keysOf('electricite', 'point_lumiere'); // nombre
  assert.deepStrictEqual([...placo].sort(), ['hauteur', 'largeur', 'nb']);
  assert.deepStrictEqual([...plom], ['longueur']);
  assert.deepStrictEqual([...facade].sort(), ['cote_a', 'cote_b', 'hauteur']);
  assert.deepStrictEqual([...elec], ['nombre']);
  // All four key sets are pairwise different ⇒ one generic form renderer suffices.
  assert.notDeepStrictEqual([...placo].sort(), [...plom]);
  assert.notDeepStrictEqual([...plom], [...facade].sort());
  // Each métier evaluates with ITS OWN inputs (same engine, no branch).
  const r1 = evaluateElement(getMetreElement('placo', 'panneau_ba13')!, { largeur: 2, hauteur: 2.5, nb: 2 });
  const r2 = evaluateElement(getMetreElement('plomberie', 'reseau_ppr')!, { longueur: 30 });
  const r3 = evaluateElement(getMetreElement('facade', 'enduit_facade')!, { cote_a: 6, cote_b: 4, hauteur: 3 });
  const r4 = evaluateElement(getMetreElement('electricite', 'point_lumiere')!, { nombre: 7 });
  assert.ok(r1.ok && (r1 as any).qty === 10 && (r1 as any).unit === 'm²');
  assert.ok(r2.ok && (r2 as any).qty === 30 && (r2 as any).unit === 'ml');
  assert.ok(r3.ok && (r3 as any).qty === 60 && (r3 as any).unit === 'm²');
  assert.ok(r4.ok && (r4 as any).qty === 7);
});
// ── 7) Invalid descriptor rejected fail-closed ──────────────────────────────

test('7. invalid descriptors resolve to null (fail-closed, never silent)', () => {
  assert.strictEqual(resolveWorkTypeSpec(undefined), null);
  assert.strictEqual(resolveWorkTypeSpec(null), null);
  assert.strictEqual(resolveWorkTypeSpec('porte'), null);
  assert.strictEqual(resolveWorkTypeSpec({}), null);                                   // no identity
  assert.strictEqual(resolveWorkTypeSpec({ code: 'x', labelFr: '', labelAr: '' }), null);
  assert.strictEqual(resolveWorkTypeSpec({ code: 'x', labelFr: 'X', labelAr: '', measurementMethod: 'levage' }), null);
  assert.strictEqual(resolveWorkTypeSpec({ code: 'x', labelFr: 'X', labelAr: '', durationHint: { value: 0, unit: 'h' } }), null);
  assert.strictEqual(getWorkTypeSpec('placo', 'element_inconnu'), null);
  assert.strictEqual(getWorkTypeSpec('metier_inconnu', 'panneau_ba13'), null);
  assert.strictEqual(getWorkTypeSpec(null, null), null);
  // No invented work types: EVERY descriptor maps to an EXISTING registry element.
  for (const [trade, byElement] of Object.entries(METRE_WORK_TYPE_SPECS)) {
    for (const code of Object.keys(byElement)) {
      assert.ok(getMetreElement(trade, code), `${trade}/${code} descriptor must reference an existing element`);
    }
  }
});

// ── 8) Bindings mapping preserved (present ⇒ carried, absent ⇒ same shape) ──

test('8. bindings travel through mapMetreElementRow when present, absent when not', () => {
  const base = {
    elementCode: 'x', method: 'surface',
    dims: [{ key: 'a', labelFr: 'A', labelAr: '', unit: 'm' }],
    calc: { op: 'single', dim: 'a' }, qtyUnit: 'm²',
  };
  const MATERIALS = [{ materialCode: 'plaque_ba13_standard', driver: { type: 'metre_qty' } }];
  const SERVICES = [{ serviceNameFr: 'Pose', driver: { type: 'metre_qty' }, outputUnit: 'm²' }];

  // Legacy row (no bindings) → EXACT pre-Phase-2.1 shape (keys absent).
  const plain = mapMetreElementRow(base, 'placo')!;
  assert.ok(plain);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(plain, 'materialBindings'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(plain, 'serviceBindings'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(plain, 'linkedSlotCode'), false);

  // Row WITH bindings + linked slot → carried through unchanged.
  const bound = mapMetreElementRow({
    ...base, materialBindings: MATERIALS, serviceBindings: SERVICES, linkedSlotCode: 'placo_board',
  }, 'placo')!;
  assert.ok(bound);
  assert.deepStrictEqual((bound as any).materialBindings, MATERIALS);
  assert.deepStrictEqual((bound as any).serviceBindings, SERVICES);
  assert.strictEqual((bound as any).linkedSlotCode, 'placo_board');
  // Bindings never affect the quantity.
  assert.strictEqual((evaluateElement(bound, { a: 4 }) as any).qty, 4);
  assert.strictEqual((evaluateElement(plain, { a: 4 }) as any).qty, 4);
  // Validation is NOT bypassed: an invalid row stays null even with bindings.
  assert.strictEqual(mapMetreElementRow({ ...base, calc: { op: 'eval' }, materialBindings: MATERIALS }, 'placo'), null);
  assert.strictEqual(mapMetreElementRow({ ...base, linkedSlotCode: 42 }, 'placo') !== null, true); // non-string slot ignored, row still valid
  assert.strictEqual(Object.prototype.hasOwnProperty.call(mapMetreElementRow({ ...base, linkedSlotCode: 42 }, 'placo')!, 'linkedSlotCode'), false);
});

// ── 9) No trade-specific branch in the engine (source-level) ────────────────

test('9. metreEngine has no trade branch; specs never reach the engine', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const engine = read('src/utils/metreEngine.ts');
  assert.ok(!/trade\s*===/.test(engine), 'engine must never compare trade ===');
  assert.ok(!/switch\s*\(\s*trade/.test(engine), 'engine must never switch on trade');
  assert.ok(!engine.includes('workType'), 'engine must never read workType');
  for (const m of ['placo', 'plomberie', 'aluminium', 'peinture', 'facade', 'electricite']) {
    assert.ok(!engine.includes(`'${m}'`), `engine must not name métier '${m}'`);
  }
  // Dependency direction (comments stripped): the metadata module never
  // imports the engine and never evaluates quantities.
  const specsCode = strip(read('src/data/metreTradeSpecs.ts'));
  assert.ok(!/import[^;]*metreEngine/.test(specsCode), 'metreTradeSpecs must not import the engine');
  assert.ok(!specsCode.includes('evaluateElement'), 'metreTradeSpecs must never evaluate quantities');
  assert.ok(!engine.includes('metreTradeSpecs'), 'engine must not know the trade-spec module');
});

// ── 10) Phase 1 suites present/untouched (execution reported by the runner) ─

test('10. Phase 1 regression suites present + PLACO golden fixture intact', () => {
  const phase1Suites = [
    'tests/metreEngine.test.ts',
    'tests/metreRegistry.test.ts',
    'tests/metreDataDriven.test.ts',
    'tests/metreWiring.test.ts',
    'tests/metreEnrichedSpec.test.ts',
    'tests/metreWorkTypeSpec.test.ts',
  ];
  for (const f of phase1Suites) {
    const src = read(f);
    assert.ok(src.includes('npx tsx'), `${f} must still be the standalone Phase 1 suite`);
    assert.ok(src.length > 1000, `${f} must be intact`);
  }
  // PLACO official calculator frozen record still present (never rewritten here).
  const golden = read('tests/fixtures/formulas/golden.json');
  assert.ok(golden.includes('"placo_cloison_fixe"'), 'PLACO golden fixture missing');
  // Forbidden files were not touched by this phase's contract:
  const engine = read('src/utils/metreEngine.ts');
  assert.ok(!engine.includes('METRE_TRADE_SPECS'), 'engine must not reference trade specs');
});

// ── Summary ─────────────────────────────────────────────────────────────────
console.log('\n==============================================');
console.log(` Phase 2.1 data contract: ${passed} passed, ${failed} failed`);
console.log('==============================================\n');
if (failures.length > 0) {
  console.log('FAILED TESTS:');
  failures.forEach((f) => console.log(f));
  console.log('');
}
process.exit(failed > 0 ? 1 : 0);


