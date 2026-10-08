/**
 * Phase C — FOCUSED test runner (catalog import: Phase A CSV regression +
 * Phase B dynamic trades + Phase C XLSX/Smart Mapping).
 *
 * Runs ONLY the catalog-import-related suites instead of the entire legacy
 * suite (npm test), per the Phase C test policy. Usage (from the repo root):
 *
 *   set NODE_ENV=test && set TEST_DATABASE_URL=... && set TEST_DB_CONFIRM=1 && npx tsx tests/runPhaseC.ts
 *
 * The full suite (npm test → tests/run.ts) also runs the same Phase C tests.
 * Importing tests/run.ts here is safe: it auto-runs only when executed
 * directly, and its shared harness (test/assertEq/ok/ctx/testResults) is
 * reused by every test file.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
import { startTestServer } from './setup';
import { ctx, testResults } from './run';
import { memoryStore } from '../server/repositories/store';

async function main() {
  memoryStore.resetAll();
  const server = await startTestServer();
  ctx.server = server;

  console.log('\n═══════════════════════════════════════════');
  console.log(' KONSTRIVO PHASE C — FOCUSED CATALOG IMPORT TESTS');
  console.log(` Server on ${server.baseUrl}`);
  console.log('═══════════════════════════════════════════\n');

  // Auth first (populates ctx.freeToken/proToken/adminToken), then Phase 2A
  // seeding (canonical trades + materials into the TEST catalog), then the
  // Phase A CSV regression, the Phase B dynamic-trade suite and Phase C.
  const { runAuthTests } = await import('./auth.test');
  const { runTradePhase2aTests } = await import('./trades_phase2a.test');
  const { runTradePhaseBTests } = await import('./trades_phaseB.test');
  const { runCatalogImportCsvTests } = await import('./catalogImportCsv.test');
  const { runCatalogImportPhaseCTests } = await import('./catalogImportPhaseC.test');
  // P1 — preview/import determinism gate + explicit "Métier par défaut".
  const { runCatalogPreviewTradeGateTests } = await import('./catalogPreviewTradeGate.test');
  // Universal realistic 40-row file — REAL HTTP (preview + import) regression.
  const { runCatalogImportUniversalRealisticHttpTests } = await import('./catalogImportUniversalRealisticHttp.test');
  // Smart-Mapping DISPLAY regression (static source — server truth reflected).
  const { runUniversalImportMappingDisplayTests } = await import('./universalImportMappingDisplay.test');
  // CATALOG-ONLY (Master Catalog without price_ht) — REAL HTTP regression.
  const { runCatalogOnlyImportTests } = await import('./catalogOnlyImportHttp.test');

  await runAuthTests();
  await runTradePhase2aTests();
  await runTradePhaseBTests();
  await runCatalogImportCsvTests();
  await runCatalogImportPhaseCTests();
  await runCatalogPreviewTradeGateTests();
  await runCatalogImportUniversalRealisticHttpTests();
  await runUniversalImportMappingDisplayTests();
  await runCatalogOnlyImportTests();

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

main().catch(err => {
  console.error('[KONSTRIVO] Phase C test runner crashed:', err);
  process.exit(1);
});
