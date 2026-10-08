/**
 * PHASE 2.3-B1 — DIRECT MÉTRÉ SKELETON (data-driven, UI-free).
 *   npx tsx tests/metreDirectSkeleton.test.ts
 *
 * PROOFS (8):
 *  1. registered trade resolves (MetreTradeSpec wins for labels/order).
 *  2. fallback works for a trade WITHOUT a MetreTradeSpec.
 *  3. workTypeOrder ordering is respected (remainder keeps registry order).
 *  4. unknown trade produces an empty work-type list.
 *  5. unknown element produces no descriptor.
 *  6. valid descriptor resolves with all displayable fields.
 *  7. descriptor is presentation-only; the engine knows nothing about it.
 *  8. no Project/Zone/Ouvrage/Relevé dependency in MetreDirectTab
 *     (+ App still mounts the untouched Workflow view).
 *
 * FORBIDDEN in B1 (asserted by 7/8): quantity calculation, dimensions form,
 * bindings, prices, fiscal, devis, DB writes, new work types/métiers.
 */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { elementsForTrade, getMetreElement } from '../src/data/metreElements';
import { getMetreTradeSpec, getWorkTypeSpec } from '../src/data/metreTradeSpecs';
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

console.log('\nPHASE 2.3-B1 - Direct Metre skeleton (pickers + descriptor)\n');

// ── 1) Registered trade resolves ────────────────────────────────────────────
test('1. registered trade resolves (spec labels + workTypeOrder elements)', () => {
  const spec = getMetreTradeSpec('placo');
  assert.ok(spec && spec.code === 'placo');
  const display = resolveTradeDisplay({ code: 'placo', labelFr: 'AUTRE', labelAr: 'آخر' });
  assert.strictEqual(display.labelFr, 'PLACO / PLÂTRE'); // spec wins over the trade
  assert.strictEqual(display.labelAr, 'جبس وبلاطور');
  for (const code of spec!.workTypeOrder ?? []) {
    assert.ok(getMetreElement('placo', code), `${code} must exist in the registry`);
  }
});

// ── 2) Fallback without MetreTradeSpec ──────────────────────────────────────
test('2. fallback: trade without MetreTradeSpec uses its own labels', () => {
  assert.strictEqual(getMetreTradeSpec('peinture'), null); // not registered
  const display = resolveTradeDisplay({ code: 'peinture', labelFr: 'PEINTURE', labelAr: 'دهان' });
  assert.deepStrictEqual(display, { labelFr: 'PEINTURE', labelAr: 'دهان' });
  // Unknown code never throws and keeps the passed labels.
  const dyn = resolveTradeDisplay({ code: 'trade_inconnu_xyz', labelFr: 'Dyn', labelAr: '' });
  assert.deepStrictEqual(dyn, { labelFr: 'Dyn', labelAr: '' });
});

// ── 3) workTypeOrder ordering ───────────────────────────────────────────────
test('3. workTypeOrder respected; remainder keeps registry order (no dups)', () => {
  const registry = elementsForTrade('aluminium');
  assert.strictEqual(registry.length, 11);
  const spec = getMetreTradeSpec('aluminium');
  assert.ok(spec?.workTypeOrder?.length);
  // Real spec order → same set, same sequence here (order mirrors registry).
  const viaSpec = orderWorkTypesForDisplay(registry, spec!.workTypeOrder);
  assert.deepStrictEqual(viaSpec.map((e) => e.code), registry.map((e) => e.code));
  // Synthetic order → listed codes first, remainder in original order.
  const order = ['consommable', 'profil'];
  const ordered = orderWorkTypesForDisplay(registry, order);
  assert.strictEqual(ordered.length, 11);
  assert.strictEqual(ordered[0].code, 'consommable');
  assert.strictEqual(ordered[1].code, 'profil');
  const expected = [
    ...order,
    ...registry.map((e) => e.code).filter((c) => !order.includes(c)),
  ];
  assert.deepStrictEqual(ordered.map((e) => e.code), expected);
  assert.strictEqual(new Set(ordered.map((e) => e.code)).size, 11, 'no duplicates');
  // Input never mutated.
  assert.strictEqual(registry[0].code, 'porte');
  // No order → registry order unchanged.
  assert.deepStrictEqual(orderWorkTypesForDisplay(registry).map((e) => e.code), registry.map((e) => e.code));
});

// ── 4) Unknown trade → empty list ───────────────────────────────────────────
test('4. unknown trade produces an empty work-type list', () => {
  assert.strictEqual(getMetreTradeSpec('trade_inconnu_xyz'), null);
  const list = orderWorkTypesForDisplay(
    elementsForTrade('trade_inconnu_xyz'),
    getMetreTradeSpec('trade_inconnu_xyz')?.workTypeOrder,
  );
  assert.deepStrictEqual(list, []);
});

// ── 5) Unknown element → no descriptor ──────────────────────────────────────
test('5. unknown element produces no descriptor (fail-closed null)', () => {
  assert.strictEqual(getWorkTypeSpec('placo', 'element_inconnu'), null);
  assert.strictEqual(getWorkTypeSpec('metier_inconnu', 'panneau_ba13'), null);
  assert.strictEqual(getWorkTypeSpec('', ''), null);
  assert.strictEqual(getWorkTypeSpec(null, null), null);
});

// ── 6) Valid descriptor resolves ────────────────────────────────────────────
test('6. valid descriptor resolves with all displayable fields', () => {
  const d = getWorkTypeSpec('placo', 'panneau_ba13');
  assert.ok(d);
  assert.strictEqual(d!.code, 'panneau_ba13');
  assert.ok(d!.labelFr && d!.labelAr);
  assert.strictEqual(d!.measurementMethod, 'surface');
  assert.ok(typeof d!.methodology === 'string' && d!.methodology.length > 0);
  assert.ok(Array.isArray(d!.norms) && d!.norms!.length >= 1);
  assert.ok(Array.isArray(d!.validationHints) && d!.validationHints!.length >= 1);
  assert.ok(d!.durationHint && d!.durationHint.value > 0 && !!d!.durationHint.unit);
});
// ── 7) Presentation-only: engine isolation ──────────────────────────────────
test('7. descriptor is presentation-only; engine knows nothing about it', () => {
  const comp = read('src/components/MetreDirectTab.tsx');
  // The direct view never imports nor calls any calculation.
  for (const token of ['metreEngine', 'evaluateElement', 'computeMetreBoundOutputs', 'aggregateQuantities', 'metreBindings']) {
    assert.ok(!comp.includes(token), `MetreDirectTab must not reference "${token}"`);
  }
  // The engine never learns about the direct view or descriptors.
  const engine = read('src/utils/metreEngine.ts');
  assert.ok(!engine.includes('MetreDirectTab'), 'engine must not know the direct view');
  assert.ok(!engine.includes('getWorkTypeSpec'), 'engine must not resolve descriptors');
  assert.ok(!engine.includes('workType'), 'engine must never read workType');
});

// ── 8) No workflow dependency; workflow still mounted ───────────────────────
test('8. no Project/Zone/Ouvrage/Relevé dependency; Workflow still mounted', () => {
  const comp = read('src/components/MetreDirectTab.tsx');
  for (const token of [
    'metreApi', 'listZones', 'listOuvrages', 'listReleves', 'addLine',
    'createZone', 'createOuvrage', 'createReleve',
    'selectedProjectId', 'selectedZoneId', 'selectedOuvrageId', 'selectedReleveId',
    'MetreWorkflowTab',
  ]) {
    assert.ok(!comp.includes(token), `MetreDirectTab must not depend on "${token}"`);
  }
  // No DB persistence in the direct skeleton.
  assert.ok(!comp.includes('POST') && !comp.includes('fetch('), 'no network writes in B1');
  // App: mode selector present, Direct default, Workflow view still mounted unchanged.
  const app = read('src/App.tsx');
  assert.ok(app.includes("<MetreDirectTab"), 'Direct view must be mounted');
  assert.ok(app.includes('<MetreWorkflowTab'), 'Workflow view must stay mounted');
  assert.ok(app.includes("useState<'direct' | 'workflow'>('direct')"), 'default mode must be Direct');
  assert.ok(app.includes("activeTab === 'metre_workflow'"), 'no new tab — same Métré Pro tab');
  // BottomNavBar untouched by B1 (still 7 tabs, no direct id).
  const nav = read('src/components/BottomNavBar.tsx');
  assert.ok(!nav.includes('metre_direct'), 'B1 must not add a navigation tab');
  assert.ok(nav.includes("id: 'metre_workflow'"), 'Métré Pro tab unchanged');
});

// ── Summary ─────────────────────────────────────────────────────────────────
console.log('\n==============================================');
console.log(` Phase 2.3-B1 direct skeleton: ${passed} passed, ${failed} failed`);
console.log('==============================================\n');
if (failures.length > 0) {
  console.log('FAILED TESTS:');
  failures.forEach((f) => console.log(f));
  console.log('');
}
process.exit(failed > 0 ? 1 : 0);

