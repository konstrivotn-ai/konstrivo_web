/**
 * PHASE B7.1 — PEINTURE / mur_interieur DATA-ONLY proof (DB-free).
 * Run: npx tsx tests/metreDirectPeinture.test.ts
 * No bindings, no prices, no engine change. Missing bindings = REVIEW.
 */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMetreElement, elementsForTrade } from '../src/data/metreElements';
import { getWorkTypeSpec, isValidMetreTradeSpec } from '../src/data/metreTradeSpecs';
import { evaluateElement } from '../src/utils/metreEngine';
import {
  buildDirectQuantity,
  buildDirectDefaults,
  buildDirectBoundOutput,
} from '../src/utils/metreDirectResult';

let passed = 0;
let failed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  PASS ${name}`); }
  catch (err: unknown) {
    failed++;
    const msg = `  FAIL ${name}\n       ${(err as Error)?.message || err}`;
    failures.push(msg); console.log(msg);
  }
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => fs.readFileSync(path.join(HERE, '..', rel), 'utf8');

console.log('\nPHASE B7.1 - PEINTURE / mur_interieur data-only proof\n');

test('1. peinture trade present in registry', () => {
  const els = elementsForTrade('peinture');
  assert.ok(els.length >= 1, 'peinture must have elements');
});

test('2. mur_interieur discoverable', () => {
  const el = getMetreElement('peinture', 'mur_interieur');
  assert.ok(el, 'peinture/mur_interieur must exist');
  assert.strictEqual(el!.trade, 'peinture');
});

test('3. method is surface (spec contract)', () => {
  const el = getMetreElement('peinture', 'mur_interieur')!;
  assert.strictEqual(el.method, 'surface');
});

test('4. unit is m²', () => {
  const el = getMetreElement('peinture', 'mur_interieur')!;
  assert.strictEqual(el.unit, 'm²');
});

test('5. dims are largeur, hauteur, nb', () => {
  const el = getMetreElement('peinture', 'mur_interieur')!;
  assert.deepStrictEqual(el.dims.map((d) => d.key), ['largeur', 'hauteur', 'nb']);
  assert.deepStrictEqual(el.calc, { op: 'product', dims: ['largeur', 'hauteur', 'nb'] });
});

test('6. engine is the only quantity source: 4 x 2.8 x 1 = 11.2 m²', () => {
  const el = getMetreElement('peinture', 'mur_interieur')!;
  const engine = evaluateElement(el, { largeur: 4, hauteur: 2.8, nb: 1 });
  const direct = buildDirectQuantity(el, { largeur: 4, hauteur: 2.8, nb: 1 });
  assert.ok(engine.ok && direct.ok);
  assert.strictEqual((engine as { qty: number }).qty, 11.2);
  assert.strictEqual(direct.ok && direct.qty, (engine as { qty: number }).qty);
  assert.strictEqual(direct.ok && direct.unit, 'm²');
});

test('7. defaults evaluate without NaN/Infinity', () => {
  const el = getMetreElement('peinture', 'mur_interieur')!;
  const defaults = buildDirectDefaults(el);
  assert.deepStrictEqual(defaults, { largeur: '4', hauteur: '2.8', nb: '1' });
  const r = buildDirectQuantity(el, defaults);
  assert.ok(r.ok);
  assert.ok(Number.isFinite(r.ok && r.qty));
});

test('8. descriptor present and valid (no norms invented)', () => {
  const spec = getWorkTypeSpec('peinture', 'mur_interieur');
  assert.ok(spec && spec.code === 'mur_interieur');
  assert.strictEqual(spec!.measurementMethod, 'surface');
  assert.ok(spec!.methodology && spec!.methodology.length > 0);
  assert.ok(!spec!.methodology.includes('rendement'), 'methodology must not claim rendement');
  assert.ok(!spec!.methodology.includes('couche'), 'methodology must not claim coats');
  assert.ok(!(spec as { norms?: unknown }).norms, 'no norms invented for peinture');
});

test('9. no material bindings declared', () => {
  const el = getMetreElement('peinture', 'mur_interieur')!;
  assert.strictEqual('materialBindings' in el, false);
  const out = buildDirectBoundOutput({
    element: el, dims: { largeur: 4, hauteur: 2.8, nb: 1 },
    lines: [{ qty: 11.2, unit: 'm²' }], rates: [],
  });
  assert.ok(out.issues.some((i) => i.type === 'missing_binding'));
});

test('10. no service bindings declared', () => {
  const el = getMetreElement('peinture', 'mur_interieur')!;
  assert.strictEqual('serviceBindings' in el, false);
});

test('11. no new price literal in data files', () => {
  const elements = read('src/data/metreElements.ts');
  const specs = read('src/data/metreTradeSpecs.ts');
  const paintBlocks = elements.split('peinture: [')[1]?.split('],')[0] ?? '';
  assert.ok(!/\bunitPriceTnd\b/.test(paintBlocks), 'no price field in peinture data');
  assert.ok(!/\b\d+(\.\d+)?\s*TND\b/.test(specs.split('peinture:')[1] ?? ''), 'no TND price in peinture spec');
});

test('12. no trade-specific branch introduced', () => {
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const el = strip(read('src/data/metreElements.ts'));
  const sp = strip(read('src/data/metreTradeSpecs.ts'));
  assert.ok(!/trade\s*===/.test(el) && !/trade\s*===/.test(sp), 'no trade branch');
  assert.ok(!/switch\s*\(\s*trade/.test(el) && !/switch\s*\(\s*trade/.test(sp), 'no switch(trade)');
});

test('13. PLACO behaviour unchanged', () => {
  const placo = getMetreElement('placo', 'panneau_ba13')!;
  const r = buildDirectQuantity(placo, buildDirectDefaults(placo));
  assert.ok(r.ok && r.qty === 3 && r.unit === 'm²');
  void isValidMetreTradeSpec;
});

console.log('\n==============================================');
console.log(` Phase B7.1 peinture/mur_interieur: ${passed} passed, ${failed} failed`);
console.log('==============================================\n');
if (failures.length > 0) {
  console.log('FAILED TESTS:');
  failures.forEach((f) => console.log(f));
  console.log('');
}
process.exit(failed > 0 ? 1 : 0);
