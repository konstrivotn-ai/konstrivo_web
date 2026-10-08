/**
 * Focused runner for Phase C feature parity + plan enforcement tests.
 * Runs only the Phase C feature tests to verify matrix parity and PDF export scope.
 *
 * This runner is separate from tests/runPhaseC.ts (catalog import) on purpose.
 */
import { test, ctx, testResults } from './run';
import { startTestServer, apiRequest, TestServer } from './setup';
import { memoryStore } from '../server/repositories/store';
import { runPhaseCFeatureParityTests } from './feature_parity.test';

async function main() {
  memoryStore.resetAll();
  const server = await startTestServer();
  ctx.server = server;

  console.log('\n═══════════════════════════════════════════');
  console.log(' KONSTRIVO PHASE C — FEATURE PARITY TESTS');
  console.log(` Server on ${server.baseUrl}`);
  console.log('═══════════════════════════════════════════\n');

  // Auth is required so ctx.freeToken / ctx.proToken / ctx.adminToken exist.
  const { runAuthTests } = await import('./auth.test');
  await runAuthTests();

  await runPhaseCFeatureParityTests();

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
  console.error('[KONSTRIVO] Phase C feature runner crashed:', err);
  process.exit(1);
});
