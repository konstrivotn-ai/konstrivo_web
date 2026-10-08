/**
 * Focused runner for Phase B Dynamic Trades tests.
 * Runs only the trades_phaseB.test.ts suite to verify the fix.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.TEST_DB_CONFIRM = process.env.TEST_DB_CONFIRM || '1';

import { test, assertEq, ok, ctx, testResults } from './run';
import { startTestServer, apiRequest, TestServer } from './setup';
import { memoryStore } from '../server/repositories/store';

async function main() {
  memoryStore.resetAll();
  const server = await startTestServer();
  ctx.server = server;

  console.log('\n═══════════════════════════════════════════');
  console.log(' KONSTRIVO PHASE B — DYNAMIC TRADES TESTS');
  console.log(` Server on ${server.baseUrl}`);
  console.log('═══════════════════════════════════════════\n');

  const { runTradePhaseBTests } = await import('./trades_phaseB.test');
  await runTradePhaseBTests();

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
  console.error('[KONSTRIVO] Test runner crashed:', err);
  process.exit(1);
});