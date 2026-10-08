/**
 * Step 14 — Saudi GASTAT Pipeline Activation tests (NO database).
 *
 * Verifies the orchestration that connects buildSaudiGastatPendingPlan()
 * to submitPendingPriceUpdate() — without ever touching a real DB or
 * calling approve.
 *
 * CRITICAL: tests run SEQUENTIALLY (awaited) because they share a mock DB.
 * The old fire-and-forget runner caused race conditions where resetMock()
 * in one test wiped another test's data mid-assertion.
 */
import { strict as assert } from 'node:assert';
import { buildSaudiGastatPendingPlan, GastatRow } from '../server/priceSources/saudiConstruction';
import { applySaudiGastatPlan } from '../server/priceSources/saudiPipeline';

let passed = 0, failed = 0;
const failures: string[] = [];

/** Sequential test runner — awaits each test before starting the next. */
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  PASS ${name}`);
  } catch (err: any) {
    failed++;
    const msg = `  FAIL ${name}\n       ${err?.message || err}`;
    failures.push(msg);
    console.log(msg);
  }
}

const SUBMITTED = 'SUPPLIER_SUBMITTED';
const OFFICIAL = 'OFFICIAL_DEFAULT';
const APPROVED = 'SUPPLIER_APPROVED';

interface MockRow {
  id: string; materialCode: string; sourceCode: string; unitPrice: number;
  countryCode: string; currencyCode: string; isCurrent: boolean;
  companyId: string | null; effectiveFrom?: string; notes?: string;
}

let mockDb: MockRow[] = [];
let mockSeq = 0;

function mockSubmit(args: {
  materialCode: string; price: number; countryCode: string; currencyCode: string;
  effectiveFrom?: string; notes?: string; supplierId?: string;
}): Promise<MockRow> {
  const existing = mockDb.find(r =>
    r.materialCode === args.materialCode && r.sourceCode === SUBMITTED &&
    r.countryCode === args.countryCode && r.currencyCode === args.currencyCode &&
    r.isCurrent === false && r.companyId === null
  );
  if (existing) { existing.unitPrice = args.price; existing.effectiveFrom = args.effectiveFrom || existing.effectiveFrom; return Promise.resolve(existing); }
  const row: MockRow = { id: `mock-${++mockSeq}`, materialCode: args.materialCode, sourceCode: SUBMITTED,
    unitPrice: args.price, countryCode: args.countryCode, currencyCode: args.currencyCode,
    isCurrent: false, companyId: null, effectiveFrom: args.effectiveFrom, notes: args.notes };
  mockDb.push(row);
  return Promise.resolve(row);
}

function resetMock() { mockDb = []; mockSeq = 0; }

const GASTAT_CIMENT: GastatRow = { label: 'أسمنت بورتلاندي عادي، كيس 50 كجم', unit: 'كيس 50 كجم', price: 18.5, month: '2026-08' };
const GASTAT_BLOC: GastatRow = { label: 'بلوك خرساني 20×20×40 سم', unit: 'قطعة', price: 3.25, month: '2026-08' };
const GASTAT_UNKNOWN: GastatRow = { label: 'حديد تسليح 12مم', unit: 'طن', price: 4500, month: '2026-08' };
// __PART2__

// ══════════════════════════════════════════════════════════════════════════════
// All tests are defined inside run() and awaited SEQUENTIALLY.
// Top-level duplicate tests were removed because they ran concurrently
// (fire-and-forget) with run(), racing on the shared mockDb array via resetMock().
// ══════════════════════════════════════════════════════════════════════════════

async function run() {
  console.log('\n🇸🇦 Step 14 — Saudi GASTAT Pipeline Activation Tests\n');

  // Step 14 Fix: await each test SEQUENTIALLY so shared mockDb state is not
  // cleared by a later test's resetMock() while an earlier test is still running.
  // (Async tests that fire concurrently were racing on the shared mockDb array,
  // causing E2E 1/3/4/5/7 to see stale or cleared state.)
  await test('E2E 1 — GASTAT cement row → pending SA/SAR via submitPendingPriceUpdate', async () => {
    resetMock();
    const plan = buildSaudiGastatPendingPlan([GASTAT_CIMENT], { observedAt: '2026-09-01T00:00:00Z' });
    const summary = await applySaudiGastatPlan(plan, mockSubmit);
    assert.equal(summary.submitted, 1, 'one submission');
    assert.equal(summary.rejected, 0, 'no rejections');
    const row = mockDb[0];
    assert.equal(row.materialCode, 'sac_ciment_50kg', 'mapped via materials.code bridge');
    assert.equal(row.sourceCode, SUBMITTED, 'SUPPLIER_SUBMITTED — pending');
    assert.equal(row.isCurrent, false, 'isCurrent=false — NEVER official without approve');
    assert.equal(row.countryCode, 'SA', 'SA market preserved');
    assert.equal(row.currencyCode, 'SAR', 'SAR currency preserved');
    assert.equal(row.unitPrice, 18.5, 'price preserved');
    assert.equal(row.companyId, null, 'company isolation');
    assert.equal(row.effectiveFrom, '2026-08-01', 'effectiveFrom from GASTAT month');
  });

  await test('E2E 2 — GASTAT bloc row → pending SA/SAR', async () => {
    resetMock();
    const plan = buildSaudiGastatPendingPlan([GASTAT_BLOC]);
    const summary = await applySaudiGastatPlan(plan, mockSubmit);
    assert.equal(summary.submitted, 1);
    const row = mockDb[0];
    assert.equal(row.materialCode, 'bloc_beton_20x20x40');
    assert.equal(row.sourceCode, SUBMITTED);
    assert.equal(row.isCurrent, false);
  });

  await test('E2E 3 — unknown GASTAT material rejected, NEVER enters pending', async () => {
    resetMock();
    const plan = buildSaudiGastatPendingPlan([GASTAT_UNKNOWN]);
    const summary = await applySaudiGastatPlan(plan, mockSubmit);
    assert.equal(summary.submitted, 0, 'nothing submitted for unknown material');
    assert.equal(plan.rejected.length, 1, 'one rejection');
    assert.ok(plan.rejected[0].reason.includes('unmapped'), 'rejection reason mentions unmapped');
    assert.equal(mockDb.length, 0, 'mock DB is empty');
  });

  await test('E2E 4 — RE-RUN same batch = idempotent (no duplicate pending rows)', async () => {
    resetMock();
    const rows = [GASTAT_CIMENT, GASTAT_BLOC];
    const plan1 = buildSaudiGastatPendingPlan(rows);
    const s1 = await applySaudiGastatPlan(plan1, mockSubmit);
    const plan2 = buildSaudiGastatPendingPlan(rows);
    const s2 = await applySaudiGastatPlan(plan2, mockSubmit);
    assert.equal(s1.submitted, 2, 'first run: 2 submissions');
    assert.equal(s2.submitted, 2, 'second run: 2 submissions reported');
    assert.equal(mockDb.length, 2, 'DB has only 2 rows — no duplicates created');
  });

  await test('E2E 5 — TN/FR not affected (no cross-market leakage)', async () => {
    resetMock();
    mockDb.push(
      { id: 'tn-existing', materialCode: 'sac_ciment_50kg', sourceCode: OFFICIAL, unitPrice: 30,
        countryCode: 'TN', currencyCode: 'TND', isCurrent: true, companyId: null },
      { id: 'fr-existing', materialCode: 'sac_ciment_50kg', sourceCode: APPROVED, unitPrice: 52,
        countryCode: 'FR', currencyCode: 'EUR', isCurrent: true, companyId: null },
    );
    const plan = buildSaudiGastatPendingPlan([GASTAT_CIMENT]);
    await applySaudiGastatPlan(plan, mockSubmit);
    const tnRow = mockDb.find(r => r.countryCode === 'TN');
    const frRow = mockDb.find(r => r.countryCode === 'FR');
    const saRow = mockDb.find(r => r.countryCode === 'SA');
    assert.ok(tnRow && frRow && saRow, 'all three market rows exist');
    assert.equal(tnRow!.unitPrice, 30, 'TN price UNCHANGED');
    assert.equal(tnRow!.isCurrent, true, 'TN isCurrent UNCHANGED');
    assert.equal(frRow!.unitPrice, 52, 'FR price UNCHANGED');
    assert.equal(frRow!.isCurrent, true, 'FR isCurrent UNCHANGED');
  });

  await test('E2E 6 — orchestrator NEVER calls approve (no direct official path)', async () => {
    resetMock();
    const plan = buildSaudiGastatPendingPlan([GASTAT_CIMENT]);
    await applySaudiGastatPlan(plan, mockSubmit);
    const officialRows = mockDb.filter(r => r.isCurrent === true);
    assert.equal(officialRows.length, 0, 'ZERO official rows — orchestrator only submits pending');
    const pendingRows = mockDb.filter(r => r.isCurrent === false);
    assert.equal(pendingRows.length, 1, 'all rows are pending (isCurrent=false)');
  });

  await test('E2E 7 — mixed batch: mapped + unknown handled correctly', async () => {
    resetMock();
    const plan = buildSaudiGastatPendingPlan([GASTAT_CIMENT, GASTAT_UNKNOWN, GASTAT_BLOC]);
    const summary = await applySaudiGastatPlan(plan, mockSubmit);
    assert.equal(summary.submitted, 2, '2 mapped materials submitted');
    assert.equal(summary.rejected, 1, '1 unknown material rejected');
    assert.equal(mockDb.length, 2, 'only mapped materials in DB');
  });

  console.log(`\n📊 RESULTS: ${passed} passed | ${failed} failed`);
  if (failed > 0) { console.log('\n❌ FAILURES:'); failures.forEach(f => console.log(f)); process.exit(1); }
  console.log('\n✅ All Step 14 tests passed.\n');
}

run();

