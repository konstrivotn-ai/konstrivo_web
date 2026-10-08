/**
 * Phase 1 — Dynamic Métré engine (DB-free, UI-free).
 *
 * Covers the generic quantity engine created in Phase 1 of the Dynamic
 * Métré architecture:
 *
 *  1. Métier → Méthode registry: `elementsForTrade` / `getMetreElement` /
 *     `methodsForTrade` are pure lookups (data-driven — no trade branches).
 *  2. `evaluateElement` (src/utils/metreEngine.ts):
 *       - surface (product of dimensions, incl. multiplicity),
 *       - longueur (single dimension),
 *       - unité (count),
 *       - volume (3 dimensions),
 *       - périmètre × hauteur (composite whitelist op),
 *       - quantity = raw computed qty (float-noise rounded, not display-rounded),
 *       - invalid / missing dimensions → structured error (never throws),
 *       - unknown `op` → rejected (whitelist only, no eval).
 *  3. `aggregateQuantities`: per-unit sums, defensive against bad lines.
 *
 * NOT covered here (frozen contracts, untouched by Phase 1): `genericQty`,
 * `calculateGeneric`, CalculatorTab, prices, rules bridge, fiscal, Devis.
 *
 * Run: npx tsx tests/metreEngine.test.ts
 */
import { strict as assert } from 'node:assert';
import {
  METRE_ELEMENTS,
  elementsForTrade,
  getMetreElement,
  methodsForTrade,
} from '../src/data/metreElements';
import type { MetreElementDef } from '../src/data/metreElements';
import {
  aggregateQuantities,
  evaluateElement,
  roundQty,
} from '../src/utils/metreEngine';

let passed = 0;
let failed = 0;
const failures: string[] = [];
/** Synchronous runner: every assertion below is synchronous, so the summary
 *  counts and the exit code are always accurate (no microtask race). */
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  PASS ${name}`); }
  catch (err: any) {
    failed++;
    const msg = `  FAIL ${name}\n       ${err?.message || err}`;
    failures.push(msg);
    console.log(msg);
  }
}

console.log('\n🧱 Phase 1 — Dynamic Métré engine (registry + quantity whitelist)\n');

// ══════════════════════════════════════════════════════════════════════════
// 1) Registry — data-driven lookups, no trade special-casing
// ══════════════════════════════════════════════════════════════════════════

test('registry: seed covers every Méthode de métré', () => {
  const methods = new Set(Object.values(METRE_ELEMENTS).flat().map((el) => el.method));
  for (const m of ['surface', 'longueur', 'unite', 'volume', 'perimetre_hauteur']) {
    assert.ok(methods.has(m as any), `missing méthode: ${m}`);
  }
});

test('registry: every element declares dims, a whitelisted op and a unit', () => {
  for (const [trade, elements] of Object.entries(METRE_ELEMENTS)) {
    assert.ok(elements.length > 0, `${trade} has no elements`);
    for (const el of elements) {
      assert.equal(el.trade, trade, `${el.code} trade key mismatch`);
      assert.ok(el.dims.length > 0, `${el.code} has no dims`);
      assert.ok(['single', 'product', 'perimeter_h'].includes(el.calc.op), `${el.code} op not whitelisted`);
      assert.ok(['m²', 'ml', 'm³', 'unit'].includes(el.unit), `${el.code} bad unit`);
    }
  }
});

test('registry: elementsForTrade is case/whitespace normalized, unknown → []', () => {
  assert.ok(elementsForTrade(' PLACO ').length >= 1);
  assert.deepEqual(elementsForTrade('unknown-trade'), []);
  assert.deepEqual(elementsForTrade(''), []);
  assert.deepEqual(elementsForTrade(null), []);
});

test('registry: getMetreElement finds by code, missing → null', () => {
  assert.equal(getMetreElement('placo', 'panneau_ba13')?.method, 'surface');
  assert.equal(getMetreElement('placo', 'nope'), null);
  assert.equal(getMetreElement('', 'panneau_ba13'), null);
});

test('registry: methodsForTrade lists distinct methods in registry order', () => {
  // B7-BATCH1: plomberie grew data-only (longueur reseau/evacuation + unite
  // point_eau); order follows registry declaration, deduped, no unlisted method.
  assert.deepEqual(methodsForTrade('plomberie'), ['longueur', 'unite']);
  assert.deepEqual(methodsForTrade('unknown'), []);
});

// ══════════════════════════════════════════════════════════════════════════
// 2) evaluateElement — whitelisted quantity maths
// ══════════════════════════════════════════════════════════════════════════

test('surface: product of dimensions (× count)', () => {
  const def = getMetreElement('placo', 'panneau_ba13')!;
  const r = evaluateElement(def, { largeur: 1.2, hauteur: 2.5, nb: 10 });
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.qty, 30); assert.equal(r.unit, 'm²'); }
});

test('longueur: single dimension', () => {
  const def = getMetreElement('plomberie', 'reseau_ppr')!;
  const r = evaluateElement(def, { longueur: 12.5 });
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.qty, 12.5); assert.equal(r.unit, 'ml'); }
});

test('unité: count dimension', () => {
  const def = getMetreElement('electricite', 'point_lumiere')!;
  const r = evaluateElement(def, { nombre: 8 });
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.qty, 8); assert.equal(r.unit, 'unit'); }
});

test('volume: three dimensions', () => {
  const def = getMetreElement('maconnerie', 'beton_coulee')!;
  const r = evaluateElement(def, { longueur: 4, largeur: 3, epaisseur: 0.2 });
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.qty, 2.4); assert.equal(r.unit, 'm³'); }
});

test('multi-dim composite: (a + b) × 2 × h', () => {
  const def = getMetreElement('facade', 'enduit_facade')!;
  const r = evaluateElement(def, { cote_a: 10, cote_b: 6, hauteur: 3 });
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.qty, 96); assert.equal(r.unit, 'm²'); }
});

test('quantity: numeric strings from text inputs are accepted', () => {
  const def = getMetreElement('plomberie', 'reseau_ppr')!;
  const r = evaluateElement(def, { longueur: ' 7.5 ' } as any);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.qty, 7.5);
});

test('quantity: float noise is rounded, not display-rounded', () => {
  const def = getMetreElement('maconnerie', 'beton_coulee')!;
  const r = evaluateElement(def, { longueur: 0.1, largeur: 0.2, epaisseur: 3 });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.qty, 0.06); // 0.1*0.2*3 = 0.06000000000000001 → rounded
  assert.equal(roundQty(0.1 + 0.2), 0.3);
});


test('invalid dimension: negative / NaN / Infinity / junk → structured error', () => {
  const def = getMetreElement('plomberie', 'reseau_ppr')!;
  for (const bad of [-1, NaN, Infinity, 'abc', true]) {
    const r = evaluateElement(def, { longueur: bad } as any);
    assert.equal(r.ok, false, `should reject ${String(bad)}`);
    if (!r.ok) assert.ok(r.badDims.includes('longueur'));
  }
});

test('missing dimension: error names the field, engine never throws', () => {
  const def = getMetreElement('placo', 'panneau_ba13')!;
  const r = evaluateElement(def, { largeur: 1.2 });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(['missing_dim', 'invalid_dim'].includes(r.error));
    assert.ok(r.badDims.includes('hauteur'));
    assert.ok(r.badDims.includes('nb'));
    assert.ok(!r.badDims.includes('largeur'));
    assert.ok(r.message.includes('Hauteur'));
  }
});

test('empty dims object → error (not zero)', () => {
  const def = getMetreElement('electricite', 'point_lumiere')!;
  const r = evaluateElement(def, {});
  assert.equal(r.ok, false);
});

test('whitelist: unknown op is rejected at runtime (never evaluated)', () => {
  const rogue = {
    ...getMetreElement('plomberie', 'reseau_ppr')!,
    calc: { op: 'eval', code: 'process.exit(1)' } as any,
  } as MetreElementDef;
  const r = evaluateElement(rogue, { longueur: 3 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error, 'unsupported_op');
});

// ══════════════════════════════════════════════════════════════════════════
// 3) aggregateQuantities — per-unit sums, defensive
// ══════════════════════════════════════════════════════════════════════════

test('aggregation: sums per unit, mixed units stay separate', () => {
  const totals = aggregateQuantities([
    { qty: 30, unit: 'm²' },
    { qty: 12.5, unit: 'm²' },
    { qty: 8, unit: 'ml' },
    { qty: 4, unit: 'm²' },
  ]);
  assert.deepEqual(totals, { 'm²': 46.5, ml: 8 });
});

test('aggregation: empty input → empty object', () => {
  assert.deepEqual(aggregateQuantities([]), {});
});

test('aggregation: float noise in sums is rounded', () => {
  const totals = aggregateQuantities([
    { qty: 0.1, unit: 'm³' },
    { qty: 0.2, unit: 'm³' },
  ]);
  assert.equal(totals['m³'], 0.3);
});

test('aggregation: invalid lines (NaN qty, empty unit) are skipped defensively', () => {
  const totals = aggregateQuantities([
    { qty: 10, unit: 'm²' },
    { qty: NaN, unit: 'm²' },
    { qty: 5, unit: '' },
    null as any,
  ]);
  assert.deepEqual(totals, { 'm²': 10 });
});

test('aggregation: end-to-end with evaluateElement output', () => {
  const panel = evaluateElement(getMetreElement('placo', 'panneau_ba13')!, { largeur: 1.2, hauteur: 2.5, nb: 4 });
  const facade = evaluateElement(getMetreElement('facade', 'enduit_facade')!, { cote_a: 10, cote_b: 6, hauteur: 3 });
  const tube = evaluateElement(getMetreElement('plomberie', 'reseau_ppr')!, { longueur: 20 });
  const lines = [panel, facade, tube].flatMap((r) => (r.ok ? [{ qty: r.qty, unit: r.unit }] : []));
  const totals = aggregateQuantities(lines);
  assert.equal(totals['m²'], 12 + 96); // 12 panel + 96 façade
  assert.equal(totals['ml'], 20);
});

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n═════════════════════════════════════════════');
console.log(` Phase 1 — ${passed} passed / ${failed} failed`);
console.log('═════════════════════════════════════════════\n');
if (failures.length > 0) {
  failures.forEach(f => console.log(f));
  process.exit(1);
}

