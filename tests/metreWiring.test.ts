/**
 * Phase 2 — Dynamic Métré wiring (pure helper, UI-free, DB-free).
 *
 * Covers `metreTotalsToGenericInput` (src/utils/metreWiring.ts), the ONLY new
 * bridge between the Phase 1 engine totals and the EXISTING generic
 * calculation input (CalculatorTab GenericInput):
 *
 *   1. valid positive `m²` / `ml` totals → feed areaM2 / lengthM,
 *   2. zero / negative / NaN / non-numeric totals → legacy fallback preserved,
 *   3. null / undefined / empty totals → legacy fallback preserved,
 *   4. other units (m³, unit, ...) ignored — no GenericInput field yet,
 *   5. partial totals: only one of the two units present → that field updates
 *      while the other keeps its fallback (independent mapping),
 *   6. no trade knowledge: the helper never sees a métier code (data-driven).
 *
 * NOT covered here (frozen contracts, untouched by Phase 2): genericQty,
 * calculateGeneric, the 12 official calculators, prices, rules bridge, fiscal,
 * Devis, CalculatorTab JSX rendering.
 *
 * Run: npx tsx tests/metreWiring.test.ts
 */
import { strict as assert } from 'node:assert';
import { metreTotalsToGenericInput } from '../src/utils/metreWiring';

let passed = 0;
let failed = 0;
const failures: string[] = [];
/** Synchronous runner (mirrors tests/metreEngine.test.ts): every assertion
 *  below is synchronous, so summary counts and the exit code are always
 *  accurate (no microtask race). */
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  PASS ${name}`); }
  catch (err: any) {
    failed++;
    const msg = `  FAIL ${name}\n       ${err?.message || err}`;
    failures.push(msg);
    console.log(msg);
  }
}

console.log('\n🔌 Phase 2 — Dynamic Métré wiring (metre totals → generic input)\n');

// ══════════════════════════════════════════════════════════════════════════
// 1) Valid totals feed the two EXISTING GenericInput fields
// ══════════════════════════════════════════════════════════════════════════

test('wiring: positive m² + ml totals feed areaM2 / lengthM', () => {
  const out = metreTotalsToGenericInput({ 'm²': 46.5, ml: 8 }, 20, 5);
  assert.deepEqual(out, { areaM2: 46.5, lengthM: 8 });
});

test('wiring: other units (m³ / unit) ignored — only m² and ml map', () => {
  const out = metreTotalsToGenericInput({ 'm³': 12, unit: 7 }, 20, 5);
  assert.deepEqual(out, { areaM2: 20, lengthM: 5 });
});

test('wiring: m² present + ml absent → area updates, length keeps fallback', () => {
  const out = metreTotalsToGenericInput({ 'm²': 96 }, 20, 5);
  assert.deepEqual(out, { areaM2: 96, lengthM: 5 });
});

test('wiring: ml present + m² absent → length updates, area keeps fallback', () => {
  const out = metreTotalsToGenericInput({ ml: 12 }, 20, 5);
  assert.deepEqual(out, { areaM2: 20, lengthM: 12 });
});

// ══════════════════════════════════════════════════════════════════════════
// 2) Invalid / empty totals → legacy fallback preserved (byte-identical
//    behaviour to before Phase 2 when no métré line was added)
// ══════════════════════════════════════════════════════════════════════════

test('wiring: empty totals {} → both fallbacks preserved', () => {
  assert.deepEqual(metreTotalsToGenericInput({}, 20, 5), { areaM2: 20, lengthM: 5 });
});

test('wiring: null / undefined totals → both fallbacks preserved', () => {
  assert.deepEqual(metreTotalsToGenericInput(null, 20, 5), { areaM2: 20, lengthM: 5 });
  assert.deepEqual(metreTotalsToGenericInput(undefined, 20, 5), { areaM2: 20, lengthM: 5 });
});

test('wiring: zero and negative totals → both fallbacks preserved', () => {
  assert.deepEqual(metreTotalsToGenericInput({ 'm²': 0, ml: -3 }, 20, 5), { areaM2: 20, lengthM: 5 });
});

test('wiring: NaN / non-numeric totals → both fallbacks preserved', () => {
  assert.deepEqual(
    metreTotalsToGenericInput({ 'm²': NaN, ml: 'garbage' as any }, 20, 5),
    { areaM2: 20, lengthM: 5 },
  );
});

// ══════════════════════════════════════════════════════════════════════════
// 3) Contract guarantees: independent mapping + caller fallback passthrough
// ══════════════════════════════════════════════════════════════════════════

test('wiring: custom fallbacks flow through untouched when totals empty', () => {
  assert.deepEqual(metreTotalsToGenericInput(null, 33.3, 7.7), { areaM2: 33.3, lengthM: 7.7 });
});

test('wiring: mapping is per-unit independent (zero m² + valid ml)', () => {
  const out = metreTotalsToGenericInput({ 'm²': 0, ml: 12 }, 20, 5);
  assert.deepEqual(out, { areaM2: 20, lengthM: 12 });
});

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n═════════════════════════════════════════════');
console.log(` Phase 2 — ${passed} passed / ${failed} failed`);
console.log('═════════════════════════════════════════════\n');
if (failures.length > 0) {
  failures.forEach(f => console.log(f));
  process.exit(1);
}