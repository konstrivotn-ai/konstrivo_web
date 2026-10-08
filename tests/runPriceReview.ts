/**
 * Phase 3B — FOCUSED test runner for the Admin price review/publish API
 * (GET /admin/prices/review queue + review / reject / publish / approve).
 *
 * Usage (from the repo root):
 *
 *   set NODE_ENV=test && set TEST_DATABASE_URL=... && set TEST_DB_CONFIRM=1 && npx tsx tests/runPriceReview.ts
 *
 * Mirrors the safe setup of tests/runPhaseC.ts: fail-closed preflight, shared
 * test server, auth suite FIRST (to populate ctx.adminToken), then the suite.
 *
 * SAFETY — why every app/test module below is imported DYNAMICALLY:
 * ESM hoists static imports, so a static `import { startTestServer } from
 * './setup'` would evaluate server/config.ts BEFORE this module body runs.
 * Since 2026-09-27 `isTestRunnerEntry()` (server/config.ts) recognises ANY
 * entry under a `tests/` directory (and any root `*.test.ts` / `*.spec.ts`), so
 * config would resolve `TEST_DATABASE_URL` regardless; and tests/setup.ts would
 * additionally FAIL CLOSED if the resolved URL were not the test database. The
 * dynamic imports are kept as defence in depth so BOTH gates are in force when
 * the modules load:
 * server/config.ts (TEST_DATABASE_URL required, must differ from DATABASE_URL)
 * and tests/setup.ts (TEST_DB_CONFIRM=1 required for the cleanup).
 *
 * The full suite (npm test → tests/run.ts) is unaffected by this file.
 */
import 'dotenv/config'; // .env must be loaded BEFORE the preflight below

// ── Fail-closed preflight: no DB connection is opened here; the runner refuses
// to continue unless it is provably pointed at an approved TEST database ─────
process.env.NODE_ENV = 'test';

function abort(message: string): never {
  console.error('\n[KONSTRIVO] Price review runner aborted (safety preflight).');
  console.error(`  ${message}\n`);
  process.exit(1);
}

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const productionDatabaseUrl = process.env.DATABASE_URL;

if (!testDatabaseUrl) {
  abort('TEST_DATABASE_URL is required — refusing to run without an explicit test database.');
}
if (productionDatabaseUrl && productionDatabaseUrl === testDatabaseUrl) {
  abort('TEST_DATABASE_URL must be different from DATABASE_URL.');
}
if (process.env.TEST_DB_CONFIRM !== '1' && process.env.TEST_DB_CONFIRM !== 'true') {
  abort('TEST_DB_CONFIRM=1 is required — tests/setup.ts truncates test tables before the suite.');
}

/** Number of tests exported by tests/priceReview.test.ts — ALL of them must run. */
const EXPECTED_PRICE_REVIEW_TESTS = 10;

async function main() {
  // Loaded only AFTER the environment above is final (see SAFETY note).
  const { startTestServer } = await import('./setup');
  const { ctx, testResults } = await import('./run');
  const { memoryStore } = await import('../server/repositories/store');

  memoryStore.resetAll();
  const server = await startTestServer();
  ctx.server = server;
  console.log('\n═══════════════════════════════════════════');
  console.log(' KONSTRIVO PHASE 3 — PRICE REVIEW API FOCUSED TESTS');
  console.log(` Server on ${server.baseUrl}`);
  console.log('═══════════════════════════════════════════\n');

  // Auth FIRST — populates ctx.freeToken / ctx.proToken / ctx.adminToken.
  // Every /admin/prices endpoint requires authenticate + CATALOG_OFFICIAL_MANAGE.
  const { runAuthTests } = await import('./auth.test');
  await runAuthTests();

  // ── Price-review suite: ALL tests exported by tests/priceReview.test.ts ──────
  // The module is loaded once, its export is asserted, and the number of tests the
  // suite actually EXECUTED is measured (delta of the shared counters). A suite
  // that is skipped or only partially executed can therefore never be reported as
  // "all green" — the runner fails loudly instead.
  const priceReviewSuite = await import('./priceReview.test');
  if (typeof priceReviewSuite.runPriceReviewTests !== 'function') {
    throw new Error('tests/priceReview.test.ts does not export runPriceReviewTests()');
  }
  const beforeSuite = testResults();
  await priceReviewSuite.runPriceReviewTests();
  const afterSuite = testResults();
  const executedBySuite =
    (afterSuite.passed + afterSuite.failed) - (beforeSuite.passed + beforeSuite.failed);
  console.log(` Price review suite: ${executedBySuite}/${EXPECTED_PRICE_REVIEW_TESTS} test(s) executed`);
  if (executedBySuite !== EXPECTED_PRICE_REVIEW_TESTS) {
    throw new Error(
      `Price review suite executed ${executedBySuite} of ${EXPECTED_PRICE_REVIEW_TESTS} test(s) — ` +
      'refusing to report success.'
    );
  }

  const results = testResults();
  console.log('\n═══════════════════════════════════════════');
  console.log(` RESULTS: ✅ ${results.passed} passed | ❌ ${results.failed} failed`);
  console.log('═══════════════════════════════════════════\n');

  if (results.failures.length > 0) {
    console.log('FAILED TESTS:');
    results.failures.forEach(f => console.log(f));
    console.log('');
  }

  await server.close();
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('[KONSTRIVO] Price review test runner crashed:', err); process.exit(1); });
