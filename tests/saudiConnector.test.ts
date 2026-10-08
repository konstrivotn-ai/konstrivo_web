/**
 * Step 13 — Saudi GASTAT connector tests (PURE, no DB, no network).
 * Run: npx tsx tests/saudiConnector.test.ts
 *
 * Proves: (1) source identity SOURCE_SA_GASTAT / SA / SAR, (2) trusted
 * materials.code mapping with 1:1 units, (3) unknown materials REJECTED —
 * never guessed/created, (4) SA/SAR isolation (a TN/TND row can never be
 * produced), (5) candidates stay PENDING with NO official path, (6) the
 * submission shape is exactly submitPendingPriceUpdate() input.
 * NOTE: fixture prices are shape/flow samples — NOT asserted as real GASTAT figures.
 */
import { strict as assert } from 'node:assert';
import {
  SA_GASTAT_SPEC_CODE,
  getSaudiGastatSpec,
  mapGastatRow,
  buildSaudiGastatPendingPlan,
  createSaudiGastatConnector,
} from '../server/priceSources/saudiConstruction';

let passed = 0, failed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  PASS ${name}`); }
  catch (err: any) { failed++; const msg = `  FAIL ${name}\n       ${err?.message || err}`; failures.push(msg); console.log(msg); }
}

const CEMENT = { label: 'أسمنت بورتلاندي عادي، كيس 50 كجم', unit: 'كيس 50 كجم', price: 17.5 };
const BLOCK = { label: 'بلوك خرساني 20x20x40 سم', unit: 'قطعة', price: 4.25 };
const OBS = '2026-09-01T00:00:00Z';

test('S1 — source identity: SOURCE_SA_GASTAT registered, SA/SAR, official_public, enabled', () => {
  const s = getSaudiGastatSpec();
  assert.equal(SA_GASTAT_SPEC_CODE, 'SOURCE_SA_GASTAT');
  assert.equal(s.code, 'SOURCE_SA_GASTAT');
  assert.equal(s.market, 'SA');
  assert.equal(s.currency, 'SAR');
  assert.equal(s.kind, 'official_public');
  assert.equal(s.enabled, true);
});

test('S2 — trusted mapping goes through materials.code with 1:1 units (no conversion)', () => {
  assert.equal(mapGastatRow({ ...CEMENT })!.materialCode, 'sac_ciment_50kg');
  assert.equal(mapGastatRow({ ...BLOCK })!.materialCode, 'bloc_beton_20x20x40');
  // English variant of the same official label+unit maps to the same material
  assert.equal(mapGastatRow({ label: 'Concrete Block 20×20×40 CM', unit: 'piece', price: 4.25 })!.materialCode, 'bloc_beton_20x20x40');
  // same product name but a DIFFERENT unit → rejected (unit is part of the trusted match)
  assert.equal(mapGastatRow({ label: CEMENT.label, unit: 'طن', price: CEMENT.price }), undefined);
  // no unit provided → conservative reject
  assert.equal(mapGastatRow({ label: CEMENT.label, price: CEMENT.price }), undefined);
});

test('S3 — unknown GASTAT material is REJECTED: no candidate, no material creation, no guess', () => {
  assert.equal(mapGastatRow({ label: 'حديد تسليح 12 مم', unit: 'طن', price: 3000 }), undefined);
  assert.equal(mapGastatRow({ label: 'رمل نظيف', unit: 'م3', price: 60 }), undefined);
  const plan = buildSaudiGastatPendingPlan(
    [{ label: 'رمل نظيف', unit: 'م3', price: 120 }, { ...CEMENT, price: 17.5, month: '2026-07' }],
    { observedAt: OBS },
  );
  assert.equal(plan.submissions.length, 1, 'only the mapped material is submitted');
  assert.equal(plan.rejected.length, 1);
  assert.match(plan.rejected[0].reason, /unmapped/);
  assert.equal(plan.official, false, 'the bridge can never produce an official price');
});

test('S4 — market/currency isolation: SA/SAR only — a TN/TND row can never be produced', () => {
  const mixed = buildSaudiGastatPendingPlan([{ ...CEMENT, price: 17.5, market: 'TN', currency: 'TND' }]);
  assert.equal(mixed.submissions.length, 0, 'TN/TND row is rejected by the SA/SAR spec');
  assert.equal(mixed.rejected.length, 1);
  assert.match(mixed.rejected[0].reason, /market/i);
  const ok = buildSaudiGastatPendingPlan([{ ...BLOCK, price: 4.25 }], { observedAt: OBS });
  for (const s of ok.submissions) {
    assert.equal(s.countryCode, 'SA');
    assert.equal(s.currencyCode, 'SAR');
    assert.equal(s.candidate.market, 'SA');
    assert.equal(s.candidate.currency, 'SAR');
  }
});

test('S5 — pending only: SUPPLIER_SUBMITTED source, no isCurrent/approve, NO official write path', () => {
  const plan = buildSaudiGastatPendingPlan([{ ...CEMENT, price: 17.5, month: '2026-07' }], { observedAt: OBS });
  assert.equal(plan.official, false, 'compile-time: the connector can never make a price official');
  const s = plan.submissions[0];
  assert.equal(s.candidate.sourceCode, 'SUPPLIER_SUBMITTED', 'enters the Step 8 pending state machine');
  assert.equal(typeof (s.candidate as any).isCurrent, 'undefined', 'candidates carry no official flags');
  assert.equal(typeof (s.candidate as any).approve, 'undefined');
  // The registered Saudi source object has NO write/approve capability at all.
  const c = createSaudiGastatConnector();
  assert.equal(typeof (c as any).approve, 'undefined');
  assert.equal(typeof (c as any).submit, 'undefined');
  assert.equal(typeof (c as any).writeOfficialPrice, 'undefined');
  // Its only method is fetchCandidates — and it intentionally throws (no live fetching).
  assert.throws(() => c.fetchCandidates(), /intentionally not implemented/);
});

test('S6 — submission shape is exactly submitPendingPriceUpdate() input (month → effectiveFrom)', () => {
  const plan = buildSaudiGastatPendingPlan(
    [{ ...CEMENT, price: 17.5, month: '2026-07' }, { ...BLOCK, price: 4.25, month: '2026-07' }],
    { observedAt: OBS },
  );
  assert.equal(plan.submissions.length, 2);
  const cement = plan.submissions.find(x => x.materialCode === 'sac_ciment_50kg')!;
  assert.equal(cement.price, 17.5);
  assert.equal(cement.countryCode, 'SA');
  assert.equal(cement.currencyCode, 'SAR');
  assert.equal(cement.effectiveFrom, '2026-07-01', 'official period parsed deterministically');
  assert.equal(cement.candidate.observedAt, OBS, 'observedAt respected — no hidden Date.now()');
  assert.match(cement.notes || '', /GASTAT/);
  const block = plan.submissions.find(x => x.materialCode === 'bloc_beton_20x20x40')!;
  assert.equal(block.price, 4.25);
  assert.equal(block.effectiveFrom, '2026-07-01');
  // provenance preserved: the REAL Saudi source spec rides on the plan
  assert.equal(plan.sourceSpec.code, 'SOURCE_SA_GASTAT');
  assert.equal(plan.sourceSpec.market, 'SA');
});

console.log(`\nSaudi GASTAT connector: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error(failures.join('\n')); process.exit(1); }

