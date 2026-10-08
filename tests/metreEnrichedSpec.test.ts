/**
 * PHASE 1 — ENRICHED UNIVERSAL MÃ‰TRÃ‰ SPECIFICATION (DB-free, UI-free).
 *   npx tsx tests/metreEnrichedSpec.test.ts
 *
 * Covers the OPTIONAL enriched specification added on top of the existing
 * engine, without changing any existing behaviour:
 *   openings Â· deductions Â· layers Â· waste Â· yield
 *
 * CONTRACT UNDER TEST (one fixed chain, applied after the whitelisted `calc`):
 *   gross -> - openings -> - deductions -> x layers -> / yield -> x (1 + waste)
 *
 * RULES PROVEN HERE:
 *   - an ABSENT optional block contributes exactly nothing (backward compat);
 *   - nothing is ever invented (no default coverage, no implicit layers);
 *   - the result is clamped at 0 (openings/deductions can't go negative);
 *   - invalid values are REFUSED with a machine-readable reason, never coerced;
 *   - no eval / new Function / dynamic dispatch is ever introduced.
 *
 * These specs are ISOLATED test data (never production fixtures, never
 * persisted): they demonstrate the capability, they do not define business data.
 */
import { strict as assert } from 'node:assert';
import type { MetreElementDef } from '../src/data/metreElements';
import {
  isValidMetreElementShape,
  mapMetreElementRow,
  METRE_QTY_UNIT_VALUES,
  METRE_ELEMENTS,
  elementsForTrade,
} from '../src/data/metreElements';
import { evaluateElement, aggregateQuantities } from '../src/utils/metreEngine';

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

console.log('\nPHASE 1 - Enriched Metre specification (openings/layers/waste/yield/deductions)\n');

/** Base element: a plain 10 m2 wall. The enriched block is added per test. */
function wall(spec: Partial<MetreElementDef> = {}): MetreElementDef {
  return {
    code: 'mur_test',
    trade: 'peinture',
    labelFr: 'Mur',
    labelAr: '',
    method: 'surface',
    dims: [
      { key: 'largeur', labelFr: 'Largeur', labelAr: '', unit: 'm' },
      { key: 'hauteur', labelFr: 'Hauteur', labelAr: '', unit: 'm' },
    ],
    calc: { op: 'product', dims: ['largeur', 'hauteur'] },
    qtyFormula: 'Largeur x Hauteur',
    unit: 'm²',
    ...spec,
  } as MetreElementDef;
}
const DIMS_5x2 = { largeur: 5, hauteur: 2 }; // 10 m2

/** A plain linear element (12 ml), used for non-surface rules. */
function linear(spec: Record<string, unknown> = {}): MetreElementDef {
  return {
    code: 'lin_test',
    trade: 'plomberie',
    labelFr: 'Lineaire',
    labelAr: '',
    method: 'longueur',
    dims: [{ key: 'longueur', labelFr: 'L', labelAr: '', unit: 'm' }],
    calc: { op: 'single', dim: 'longueur' },
    qtyFormula: 'L',
    unit: 'ml',
    ...spec,
  } as unknown as MetreElementDef;
}
// ──────────────────────────────────────────────────────────────────────────
// 1. BACKWARD COMPATIBILITY - the single most important gate
// ──────────────────────────────────────────────────────────────────────────

test('compat: an element with NO enriched block is unchanged (10 m2)', () => {
  const r = evaluateElement(wall(), DIMS_5x2);
  assert.ok(r.ok);
  assert.strictEqual((r as any).qty, 10);
  assert.strictEqual((r as any).unit, 'm²');
});

test('compat: every PRE-EXISTING registry element declares NO enriched block', () => {
  // B6.1 approved exception: aluminium/porte is the FIRST enriched proof case
  // (zero-effect: empty openings + layers 1, quantity byte-identical). Every
  // OTHER registry element must stay legacy (fail-closed for any unexpected
  // enriched element).
  const B61_EXCEPTION = new Set(['aluminium/porte']);
  let checked = 0;
  for (const [trade, els] of Object.entries(METRE_ELEMENTS)) {
    for (const el of els) {
      if (B61_EXCEPTION.has(`${trade}/${el.code}`)) {
        assert.deepStrictEqual((el as any).openings, { enabled: false, items: [] }, `${trade}/${el.code} approved B6.1 openings`);
        assert.strictEqual((el as any).layers, 1, `${trade}/${el.code} approved B6.1 layers`);
        assert.equal((el as any).yieldPerUnit, undefined, `${trade}/${el.code} yield`);
        assert.equal((el as any).coveragePerProductUnit, undefined, `${trade}/${el.code} coverage`);
        assert.equal((el as any).deductions, undefined, `${trade}/${el.code} deductions`);
        assert.equal((el as any).wastePercent, undefined, `${trade}/${el.code} waste`);
        checked++;
        continue;
      }
      assert.equal((el as any).openings, undefined, `${trade}/${el.code} openings`);
      assert.equal((el as any).layers, undefined, `${trade}/${el.code} layers`);
      assert.equal((el as any).yieldPerUnit, undefined, `${trade}/${el.code} yield`);
      assert.equal((el as any).coveragePerProductUnit, undefined, `${trade}/${el.code} coverage`);
      assert.equal((el as any).deductions, undefined, `${trade}/${el.code} deductions`);
      assert.equal((el as any).wastePercent, undefined, `${trade}/${el.code} waste`);
      checked++;
    }
  }
  assert.ok(checked >= 15, `expected the full registry checked, got ${checked}`);
});

test('compat: registry lookups unchanged; unknown metier returns []', () => {
  assert.ok(elementsForTrade('aluminium').length > 0);
  assert.ok(elementsForTrade('placo').length > 0);
  assert.deepStrictEqual(elementsForTrade('unknown_trade_xyz'), []);
});

test('compat: the whitelisted op set is UNCHANGED (3 ops, no new ones)', () => {
  const ops = new Set<string>();
  for (const els of Object.values(METRE_ELEMENTS)) for (const el of els) ops.add(el.calc.op);
  assert.deepStrictEqual([...ops].sort(), ['perimeter_h', 'product', 'single']);
});

test('compat: legacy units still whitelisted; legacy elements keep legacy units', () => {
  for (const u of ['m²', 'ml', 'm³', 'unit']) {
    assert.ok((METRE_QTY_UNIT_VALUES as readonly string[]).includes(u), `${u} must stay supported`);
  }
  for (const el of elementsForTrade('aluminium')) {
    assert.ok(['m²', 'ml', 'm³', 'unit'].includes(el.unit), `${el.code} changed unit`);
  }
});

test('compat: mapMetreElementRow on a LEGACY row yields an element with no spec keys', () => {
  const mapped = mapMetreElementRow({
    elementCode: 'x', method: 'surface',
    dims: [{ key: 'a', labelFr: 'A', labelAr: '', unit: 'm' }],
    calc: { op: 'single', dim: 'a' }, qtyUnit: 'm²',
  }, 'peinture');
  assert.ok(mapped);
  assert.equal(mapped!.openings, undefined);
  assert.equal(mapped!.layers, undefined);
  assert.equal(mapped!.wastePercent, undefined);
  assert.equal(mapped!.yieldPerUnit, undefined);
  assert.equal(mapped!.deductions, undefined);
  const r = evaluateElement(mapped!, { a: 4 });
  assert.ok(r.ok && (r as any).qty === 4);
});
// ──────────────────────────────────────────────────────────────────────────
// 2. OPENINGS
// ──────────────────────────────────────────────────────────────────────────

test('openings: none declared -> gross unchanged', () => {
  const r = evaluateElement(wall(), DIMS_5x2);
  assert.ok(r.ok && (r as any).qty === 10);
});

test('openings: empty item list -> gross unchanged', () => {
  const r = evaluateElement(wall({ openings: { enabled: true, items: [] } }), DIMS_5x2);
  assert.ok(r.ok && (r as any).qty === 10);
});

test('openings: one opening from dimensions (1.2 x 2.1 = 2.52) -> 7.48', () => {
  const r = evaluateElement(wall({
    openings: { enabled: true, mode: 'dimensions', items: [{ type: 'porte', width: 1.2, height: 2.1 }] },
  }), DIMS_5x2);
  assert.ok(r.ok);
  assert.strictEqual((r as any).qty, 7.48);
});

test('openings: dimensions x count (2 openings of 1 m2) -> 8', () => {
  const r = evaluateElement(wall({
    openings: { enabled: true, mode: 'dimensions', items: [{ type: 'fenetre', width: 1, height: 1, count: 2 }] },
  }), DIMS_5x2);
  assert.ok(r.ok);
  assert.strictEqual((r as any).qty, 8);
});

test('openings: explicit areaM2 accepted directly (3) -> 7', () => {
  const r = evaluateElement(wall({
    openings: { enabled: true, mode: 'area', items: [{ type: 'baie', areaM2: 3 }] },
  }), DIMS_5x2);
  assert.ok(r.ok);
  assert.strictEqual((r as any).qty, 7);
});

test('openings: multiple items summed (1.68 + 2.52) -> 5.8', () => {
  const r = evaluateElement(wall({
    openings: { enabled: true, items: [
      { type: 'porte', areaM2: 1.68 },
      { type: 'fenetre', width: 1.2, height: 2.1 },
    ] },
  }), DIMS_5x2);
  assert.ok(r.ok);
  assert.strictEqual((r as any).qty, 5.8);
});

test('openings: GREATER than gross -> clamped at 0, never negative', () => {
  const r = evaluateElement(wall({
    openings: { enabled: true, items: [{ type: 'porte', areaM2: 40 }] },
  }), DIMS_5x2);
  assert.ok(r.ok);
  assert.strictEqual((r as any).qty, 0);
});

test('openings: enabled:false disables a declared block (never hidden)', () => {
  const r = evaluateElement(wall({
    openings: { enabled: false, items: [{ type: 'porte', areaM2: 3 }] },
  }), DIMS_5x2);
  assert.ok(r.ok && (r as any).qty === 10);
});

test('openings: negative dimensions -> REFUSED (never a fake number)', () => {
  const r = evaluateElement(wall({
    openings: { enabled: true, items: [{ type: 'porte', width: -1, height: 2 }] },
  }), DIMS_5x2);
  assert.strictEqual(r.ok, false);
  assert.strictEqual((r as any).error, 'invalid_openings');
});

test('openings: neither area nor dimensions -> REFUSED', () => {
  const r = evaluateElement(wall({
    openings: { enabled: true, items: [{ type: 'trou' }] },
  }), DIMS_5x2);
  assert.strictEqual(r.ok, false);
  assert.strictEqual((r as any).error, 'invalid_openings');
});

test('openings: count = 0 -> REFUSED (never a silent no-op count)', () => {
  const r = evaluateElement(wall({
    openings: { enabled: true, items: [{ type: 'porte', areaM2: 2, count: 0 }] },
  }), DIMS_5x2);
  assert.strictEqual(r.ok, false);
  assert.strictEqual((r as any).error, 'invalid_openings');
});

test('openings: on a non-surface element (ml) -> REFUSED, never mixed units', () => {
  const r = evaluateElement(
    linear({ openings: { enabled: true, items: [{ type: 'porte', areaM2: 1 }] } }),
    { longueur: 10 },
  );
  assert.strictEqual(r.ok, false);
  assert.strictEqual((r as any).error, 'invalid_openings');
});
// ──────────────────────────────────────────────────────────────────────────
// 3. LAYERS / COATS
// ──────────────────────────────────────────────────────────────────────────

test('layers: absent -> quantity NOT multiplied (10 stays 10)', () => {
  const r = evaluateElement(wall(), DIMS_5x2);
  assert.ok(r.ok && (r as any).qty === 10);
});

test('layers: explicit 1 -> identical to absent (no invented multiplication)', () => {
  const r = evaluateElement(wall({ layers: 1 }), DIMS_5x2);
  assert.ok(r.ok && (r as any).qty === 10);
});

test('layers: 3 coats -> 30', () => {
  const r = evaluateElement(wall({ layers: 3 }), DIMS_5x2);
  assert.ok(r.ok && (r as any).qty === 30);
});

test('layers: 2 layers on a linear element (12 ml) -> 24 ml', () => {
  const r = evaluateElement(linear({ layers: 2 }), { longueur: 12 });
  assert.ok(r.ok && (r as any).qty === 24 && (r as any).unit === 'ml');
});

test('layers: 0 -> REFUSED (never silently treated as 1)', () => {
  const r = evaluateElement(wall({ layers: 0 }), DIMS_5x2);
  assert.strictEqual(r.ok, false);
  assert.strictEqual((r as any).error, 'invalid_layers');
});

test('layers: negative -> REFUSED', () => {
  const r = evaluateElement(wall({ layers: -2 }), DIMS_5x2);
  assert.strictEqual(r.ok, false);
  assert.strictEqual((r as any).error, 'invalid_layers');
});

test('layers: fractional (1.5) -> REFUSED (layers must be whole)', () => {
  const r = evaluateElement(wall({ layers: 1.5 }), DIMS_5x2);
  assert.strictEqual(r.ok, false);
  assert.strictEqual((r as any).error, 'invalid_layers');
});

// ──────────────────────────────────────────────────────────────────────────
// 4. WASTE
// ──────────────────────────────────────────────────────────────────────────

test('waste: absent -> no multiplication (10 stays 10)', () => {
  const r = evaluateElement(wall(), DIMS_5x2);
  assert.ok(r.ok && (r as any).qty === 10);
});

test('waste: 0% -> identical to absent (never a hidden default)', () => {
  const r = evaluateElement(wall({ wastePercent: 0 }), DIMS_5x2);
  assert.ok(r.ok && (r as any).qty === 10);
});

test('waste: 5% -> 10.5', () => {
  const r = evaluateElement(wall({ wastePercent: 5 }), DIMS_5x2);
  assert.ok(r.ok && (r as any).qty === 10.5);
});

test('waste: 10% -> 11', () => {
  const r = evaluateElement(wall({ wastePercent: 10 }), DIMS_5x2);
  assert.ok(r.ok && (r as any).qty === 11);
});

test('waste: applied EXACTLY once (100% -> 20, not 40)', () => {
  const r = evaluateElement(wall({ wastePercent: 100 }), DIMS_5x2);
  assert.ok(r.ok && (r as any).qty === 20);
});

test('waste: negative -> REFUSED (never silently clamped to 0)', () => {
  const r = evaluateElement(wall({ wastePercent: -5 }), DIMS_5x2);
  assert.strictEqual(r.ok, false);
  assert.strictEqual((r as any).error, 'invalid_waste');
});

test('waste: applied AFTER openings ((10-2) x 1.10 = 8.8)', () => {
  const r = evaluateElement(wall({
    openings: { enabled: true, items: [{ type: 'porte', areaM2: 2 }] },
    wastePercent: 10,
  }), DIMS_5x2);
  assert.ok(r.ok && (r as any).qty === 8.8);
});

// ──────────────────────────────────────────────────────────────────────────
// 5. YIELD / COVERAGE (specification-driven, never invented)
// ──────────────────────────────────────────────────────────────────────────

test('yield: absent -> NO conversion at all (m2 stays m2, qty stays 10)', () => {
  const r = evaluateElement(wall(), DIMS_5x2);
  assert.ok(r.ok && (r as any).qty === 10 && (r as any).unit === 'm²');
});

test('yield: explicit 10 m2/L -> 1 L (10 / 10), unit switches to L', () => {
  const r = evaluateElement(wall({
    yieldPerUnit: { value: 10, unit: 'L', basis: 'm²' },
  }), DIMS_5x2);
  assert.ok(r.ok);
  assert.strictEqual((r as any).qty, 1);
  assert.strictEqual((r as any).unit, 'L');
});

test('yield: 5 m2/kg on 20 m2 -> 4 kg', () => {
  const r = evaluateElement(wall({
    yieldPerUnit: { value: 5, unit: 'kg', basis: 'm²' },
  }), { largeur: 5, hauteur: 4 });
  assert.ok(r.ok && (r as any).qty === 4 && (r as any).unit === 'kg');
});

test('yield: 0 -> REFUSED (never a divide-by-zero)', () => {
  const r = evaluateElement(wall({
    yieldPerUnit: { value: 0, unit: 'L', basis: 'm²' },
  }), DIMS_5x2);
  assert.strictEqual(r.ok, false);
  assert.strictEqual((r as any).error, 'invalid_yield');
});

test('yield: negative -> REFUSED', () => {
  const r = evaluateElement(wall({
    yieldPerUnit: { value: -5, unit: 'L', basis: 'm²' },
  }), DIMS_5x2);
  assert.strictEqual(r.ok, false);
  assert.strictEqual((r as any).error, 'invalid_yield');
});

test('yield: missing unit -> REFUSED (never a guessed conversion)', () => {
  const r = evaluateElement(wall({
    yieldPerUnit: { value: 10, basis: 'm²' } as any,
  }), DIMS_5x2);
  assert.strictEqual(r.ok, false);
  assert.strictEqual((r as any).error, 'invalid_yield');
});

test('yield: basis mismatching the measured unit -> REFUSED (fail closed)', () => {
  const r = evaluateElement(wall({
    yieldPerUnit: { value: 10, unit: 'L', basis: 'ml' },
  }), DIMS_5x2);
  assert.strictEqual(r.ok, false);
  assert.strictEqual((r as any).error, 'invalid_yield');
});

// ──────────────────────────────────────────────────────────────────────────
// 6. DEDUCTIONS (explicit, independent from openings)
// ──────────────────────────────────────────────────────────────────────────

test('deductions: absent -> nothing subtracted', () => {
  const r = evaluateElement(wall(), DIMS_5x2);
  assert.ok(r.ok && (r as any).qty === 10);
});

test('deductions: one explicit areaM2 (2) -> 8', () => {
  const r = evaluateElement(wall({
    deductions: { enabled: true, items: [{ type: 'existant', areaM2: 2 }] },
  }), DIMS_5x2);
  assert.ok(r.ok && (r as any).qty === 8);
});

test('deductions: multiple items summed (1 + 0.5) -> 8.5', () => {
  const r = evaluateElement(wall({
    deductions: { enabled: true, items: [
      { type: 'existant', areaM2: 1 },
      { type: 'reservation', areaM2: 0.5 },
    ] },
  }), DIMS_5x2);
  assert.ok(r.ok && (r as any).qty === 8.5);
});

test('deductions: quantity form on a linear element (12 ml - 2) -> 10 ml', () => {
  const r = evaluateElement(
    linear({ deductions: { enabled: true, items: [{ type: 'reserve', quantity: 2 }] } }),
    { longueur: 12 },
  );
  assert.ok(r.ok && (r as any).qty === 10 && (r as any).unit === 'ml');
});

test('deductions: GREATER than gross -> clamped at 0, never negative', () => {
  const r = evaluateElement(wall({
    deductions: { enabled: true, items: [{ type: 'existant', areaM2: 50 }] },
  }), DIMS_5x2);
  assert.ok(r.ok && (r as any).qty === 0);
});

test('deductions: negative -> REFUSED', () => {
  const r = evaluateElement(wall({
    deductions: { enabled: true, items: [{ type: 'existant', areaM2: -3 }] },
  }), DIMS_5x2);
  assert.strictEqual(r.ok, false);
  assert.strictEqual((r as any).error, 'invalid_deductions');
});

test('deductions: declared item with neither quantity nor area -> REFUSED', () => {
  const r = evaluateElement(wall({
    deductions: { enabled: true, items: [{ type: 'vide' }] },
  }), DIMS_5x2);
  assert.strictEqual(r.ok, false);
  assert.strictEqual((r as any).error, 'invalid_deductions');
});

test('deductions are NOT waste: 2 m2 deducted is not 2 % waste', () => {
  const ded = evaluateElement(wall({ deductions: { enabled: true, items: [{ type: 'e', areaM2: 2 }] } }), DIMS_5x2);
  const wst = evaluateElement(wall({ wastePercent: 2 }), DIMS_5x2);
  assert.ok(ded.ok && wst.ok);
  assert.strictEqual((ded as any).qty, 8);
  assert.strictEqual((wst as any).qty, 10.2);
});
// ──────────────────────────────────────────────────────────────────────────
// 7. COMBINED - the professional chain
// ──────────────────────────────────────────────────────────────────────────

test('combined: gross 10 - openings 2 - layers 2 + waste 10% = 17.6', () => {
  const r = evaluateElement(wall({
    openings: { enabled: true, items: [{ type: 'porte', areaM2: 2 }] },
    layers: 2, wastePercent: 10,
  }), DIMS_5x2);
  assert.ok(r.ok);
  assert.strictEqual((r as any).qty, 17.6);
});

test('combined: openings + deduction + layers + waste = 16.5', () => {
  const r = evaluateElement(wall({
    openings: { enabled: true, items: [{ type: 'porte', areaM2: 2 }] },
    deductions: { enabled: true, items: [{ type: 'existant', areaM2: 0.5 }] },
    layers: 2, wastePercent: 10,
  }), DIMS_5x2);
  assert.ok(r.ok);
  assert.strictEqual((r as any).qty, 16.5);
});

test('combined: paint spec (10-2) x2 / 10 m2/L + 5% waste = 1.68 L', () => {
  const r = evaluateElement(wall({
    openings: { enabled: true, items: [{ type: 'porte', areaM2: 2 }] },
    layers: 2,
    yieldPerUnit: { value: 10, unit: 'L', basis: 'm²' },
    wastePercent: 5,
  }), DIMS_5x2);
  assert.ok(r.ok);
  assert.strictEqual((r as any).qty, 1.68);
  assert.strictEqual((r as any).unit, 'L');
});

test('combined: aggregation still works across the new units', () => {
  const a = evaluateElement(wall({ layers: 2 }), DIMS_5x2);
  const b = evaluateElement(wall({ yieldPerUnit: { value: 10, unit: 'L', basis: 'm²' } }), DIMS_5x2);
  assert.ok(a.ok && b.ok);
  const totals = aggregateQuantities([
    { qty: (a as any).qty, unit: (a as any).unit },
    { qty: (b as any).qty, unit: (b as any).unit },
  ]);
  assert.strictEqual(totals['m²'], 20);
  assert.strictEqual(totals['L'], 1);
});

// ──────────────────────────────────────────────────────────────────────────
// 8. SINGLE VALIDATOR - one contract, no competing validator
// ──────────────────────────────────────────────────────────────────────────

const baseShape = {
  method: 'surface',
  dims: [{ key: 'a', labelFr: 'A', labelAr: '', unit: 'm' }],
  calc: { op: 'single', dim: 'a' },
  qtyUnit: 'm²',
};

test('validator: the LEGACY shape (no spec keys) is still valid', () => {
  assert.strictEqual(isValidMetreElementShape({ ...baseShape }), true);
});

test('validator: accepts each valid enriched block', () => {
  assert.strictEqual(isValidMetreElementShape({ ...baseShape, openings: { enabled: true, items: [{ width: 1, height: 2 }] } }), true);
  assert.strictEqual(isValidMetreElementShape({ ...baseShape, deductions: { enabled: true, items: [{ areaM2: 1 }] } }), true);
  assert.strictEqual(isValidMetreElementShape({ ...baseShape, layers: 3 }), true);
  assert.strictEqual(isValidMetreElementShape({ ...baseShape, wastePercent: 10 }), true);
  assert.strictEqual(isValidMetreElementShape({ ...baseShape, yieldPerUnit: { value: 10, unit: 'L', basis: 'm²' } }), true);
});

test('validator: rejects each invalid enriched block', () => {
  assert.strictEqual(isValidMetreElementShape({ ...baseShape, openings: { items: [{ width: -1, height: 2 }] } }), false);
  assert.strictEqual(isValidMetreElementShape({ ...baseShape, deductions: { items: [{ quantity: -1 }] } }), false);
  assert.strictEqual(isValidMetreElementShape({ ...baseShape, layers: 0 }), false);
  assert.strictEqual(isValidMetreElementShape({ ...baseShape, layers: 1.5 }), false);
  assert.strictEqual(isValidMetreElementShape({ ...baseShape, wastePercent: -1 }), false);
  assert.strictEqual(isValidMetreElementShape({ ...baseShape, yieldPerUnit: { value: 0, unit: 'L', basis: 'm²' } }), false);
  assert.strictEqual(isValidMetreElementShape({ ...baseShape, yieldPerUnit: { value: 10, basis: 'm²' } }), false);
});

test('validator: mapMetreElementRow REFUSES an invalid enriched row (fail closed)', () => {
  assert.strictEqual(mapMetreElementRow({ elementCode: 'x', ...baseShape, wastePercent: -10 }, 'peinture'), null);
});

test('validator: mapMetreElementRow CARRIES a valid enriched row through', () => {
  const ok = mapMetreElementRow({
    elementCode: 'x', ...baseShape,
    openings: { enabled: true, items: [{ areaM2: 1 }] },
    layers: 2, wastePercent: 5,
    yieldPerUnit: { value: 10, unit: 'L', basis: 'm²' },
  }, 'peinture');
  assert.ok(ok);
  assert.deepStrictEqual(ok!.openings, { enabled: true, items: [{ areaM2: 1 }] });
  assert.strictEqual(ok!.layers, 2);
  assert.strictEqual(ok!.wastePercent, 5);
  assert.deepStrictEqual(ok!.yieldPerUnit, { value: 10, unit: 'L', basis: 'm²' });
  const r = evaluateElement(ok!, { a: 10 });
  // (10 - 1) x 2 = 18 -> /10 = 1.8 -> x 1.05 = 1.89 L
  assert.ok(r.ok && (r as any).qty === 1.89 && (r as any).unit === 'L');
});

// -- Summary ---------------------------------------------------------------
console.log('\n==============================================');
console.log(` Phase 1 enriched spec: ${passed} passed, ${failed} failed`);
console.log('==============================================\n');
if (failures.length > 0) {
  console.log('FAILED TESTS:');
  failures.forEach((f) => console.log(f));
  console.log('');
}
process.exit(failed > 0 ? 1 : 0);
