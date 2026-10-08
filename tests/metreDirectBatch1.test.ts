/**
 * B7-BATCH1 — global data-driven expansion proof (DB-free).
 * Run: npx tsx tests/metreDirectBatch1.test.ts
 * DATA ONLY: 9 new work types, no engine/UI/calculator/DB change.
 */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMetreElement, elementsForTrade } from '../src/data/metreElements';
import type { MetreElementDef } from '../src/data/metreElements';
import { getWorkTypeSpec } from '../src/data/metreTradeSpecs';
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

console.log('\nB7-BATCH1 - data-driven expansion proof\n');

type Case = {
  trade: string; code: string; method: string; unit: string;
  dims: Record<string, number>; expected: number;
};
const CASES: Case[] = [
  { trade: 'carrelage', code: 'sol_carrelage', method: 'surface', unit: 'm²', dims: { longueur: 4, largeur: 3, nb: 1 }, expected: 12 },
  { trade: 'etancheite', code: 'terrasse_membrane', method: 'surface', unit: 'm²', dims: { longueur: 5, largeur: 4, nb: 1 }, expected: 20 },
  { trade: 'isolation', code: 'mur_laine', method: 'surface', unit: 'm²', dims: { largeur: 4, hauteur: 2.8, nb: 1 }, expected: 11.2 },
  { trade: 'sols', code: 'parquet_piece', method: 'surface', unit: 'm²', dims: { longueur: 4, largeur: 3.5, nb: 1 }, expected: 14 },
  { trade: 'demolition', code: 'demolition_cloison', method: 'surface', unit: 'm²', dims: { largeur: 3, hauteur: 2.8, nb: 1 }, expected: 8.4 },
  { trade: 'plomberie', code: 'evacuation_pvc', method: 'longueur', unit: 'ml', dims: { longueur: 6 }, expected: 6 },
  { trade: 'plomberie', code: 'point_eau', method: 'unite', unit: 'unit', dims: { nombre: 3 }, expected: 3 },
  { trade: 'electricite', code: 'prise_16a', method: 'unite', unit: 'unit', dims: { nombre: 5 }, expected: 5 },
  { trade: 'maconnerie', code: 'mur_brique', method: 'surface', unit: 'm²', dims: { largeur: 4, hauteur: 2.8, nb: 1 }, expected: 11.2 },
];

test('1. all 9 new work types discoverable', () => {
  assert.strictEqual(CASES.length, 9);
  for (const c of CASES) {
    const el = getMetreElement(c.trade, c.code);
    assert.ok(el, `${c.trade}/${c.code} must exist`);
    assert.ok(elementsForTrade(c.trade).some((e) => e.code === c.code));
  }
});

test('2. methods, units and whitelist ops match', () => {
  for (const c of CASES) {
    const el = getMetreElement(c.trade, c.code)!;
    assert.strictEqual(el.method, c.method, `${c.code} method`);
    assert.strictEqual(el.unit, c.unit, `${c.code} unit`);
    assert.ok(['single', 'product'].includes(el.calc.op), `${c.code} op whitelisted`);
    assert.ok(el.dims.length > 0, `${c.code} has dims`);
  }
});

test('3. engine quantities exact for all 9', () => {
  for (const c of CASES) {
    const el = getMetreElement(c.trade, c.code)!;
    const engine = evaluateElement(el, c.dims);
    const direct = buildDirectQuantity(el, c.dims);
    assert.ok(engine.ok && direct.ok, `${c.code} evaluates`);
    assert.strictEqual((engine as { qty: number }).qty, c.expected, `${c.code} engine qty`);
    assert.strictEqual(direct.ok && direct.qty, c.expected, `${c.code} adapter qty`);
  }
});

test('4. defaults evaluate, no bindings (REVIEW)', () => {
  for (const c of CASES) {
    const el = getMetreElement(c.trade, c.code)!;
    const r = buildDirectQuantity(el, buildDirectDefaults(el));
    assert.ok(r.ok && Number.isFinite(r.ok && r.qty), `${c.code} defaults finite`);
    assert.strictEqual('materialBindings' in el, false, `${c.code} no materials`);
    assert.strictEqual('serviceBindings' in el, false, `${c.code} no services`);
    const out = buildDirectBoundOutput({
      element: el, dims: c.dims,
      lines: [{ qty: c.expected, unit: c.unit }], rates: [],
    });
    assert.ok(out.issues.some((i) => i.type === 'missing_binding'), `${c.code} REVIEW`);
  }
});

test('5. descriptors valid, presentation-only, no norms', () => {
  for (const c of CASES) {
    const spec = getWorkTypeSpec(c.trade, c.code);
    assert.ok(spec && spec.code === c.code, `${c.code} descriptor`);
    assert.ok(!(spec as { norms?: unknown }).norms, `${c.code} no invented norms`);
  }
});

test('6. frozen references unchanged (placo/peinture/alu)', () => {
  const placo = getMetreElement('placo', 'panneau_ba13')!;
  const pr = buildDirectQuantity(placo, buildDirectDefaults(placo));
  assert.ok(pr.ok && pr.qty === 3 && pr.unit === 'm²');
  const peint = getMetreElement('peinture', 'mur_interieur')!;
  const per = buildDirectQuantity(peint, { largeur: 4, hauteur: 2.8, nb: 1 });
  assert.ok(per.ok && per.qty === 11.2 && per.unit === 'm²');
  const porte = getMetreElement('aluminium', 'porte')!;
  const por = buildDirectQuantity(porte, buildDirectDefaults(porte));
  assert.ok(por.ok && por.qty === 1.89 && por.unit === 'm²');
});

test('7. unknown trade fails closed; future element needs no branch', () => {
  assert.deepStrictEqual(elementsForTrade('metier_futur_xyz'), []);
  const future = {
    code: 'futur', trade: 'futur', labelFr: 'Futur', labelAr: '',
    method: 'surface',
    dims: [{ key: 'a', labelFr: 'A', labelAr: '', unit: 'm' }],
    calc: { op: 'single', dim: 'a' },
    qtyFormula: 'A', unit: 'm²',
  } as unknown as MetreElementDef;
  const r = evaluateElement(future, { a: 7 });
  assert.ok(r.ok && (r as { qty: number }).qty === 7);
  const d = buildDirectQuantity(future, { a: 7 });
  assert.ok(d.ok && d.qty === 7 && d.unit === 'm²');
});

test('8. no trade branch, no price in batch data', () => {
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const el = strip(read('src/data/metreElements.ts'));
  const sp = strip(read('src/data/metreTradeSpecs.ts'));
  assert.ok(!/trade\s*===/.test(el) && !/trade\s*===/.test(sp), 'no trade branch');
  assert.ok(!/switch\s*\(\s*trade/.test(el), 'no switch(trade)');
});

console.log('\n==============================================');
console.log(` B7-BATCH1 expansion: ${passed} passed, ${failed} failed`);
console.log('==============================================\n');
if (failures.length > 0) {
  console.log('FAILED TESTS:');
  failures.forEach((f) => console.log(f));
  console.log('');
}
process.exit(failed > 0 ? 1 : 0);

