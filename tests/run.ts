/**
 * Phase 2 — Test Runner
 *
 * Executes the full test suite: Auth, Authorization, Materials, Prices,
 * Devis, Supplier imports, and Sync.
 *
 * Usage: npm test   (or)   tsx tests/run.ts
 */
// ── TEST/PRODUCTION ISOLATION ────────────────────────────────────────────────
// MUST stay the FIRST import: ESM evaluates imports in order, so this marks
// the process as a test harness (and sets NODE_ENV=test when a test database
// exists) BEFORE server/config.ts is evaluated and caches `config`.
import './envGuard';
// Ensure test environment flag is set before any module imports that may
// construct rate limiters at import time.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
import { strictEqual, ok as assertOk } from 'assert';
import { startTestServer, apiRequest, TestServer } from './setup';
// Ensure test environment flag is set early so modules can adjust behavior.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
import { memoryStore } from '../server/repositories/store';

let passed = 0;
let failed = 0;
const failures: string[] = [];

export async function test(name: string, fn: () => Promise<void>) {
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

export function assertEq(actual: any, expected: any, message?: string) {
  strictEqual(actual, expected, message);
}

export function ok(value: any, message?: string) {
  assertOk(value, message);
}

/** Returns the cumulative test counters (used by focused runners like runPhaseC). */
export function testResults(): { passed: number; failed: number; failures: string[] } {
  return { passed, failed, failures: [...failures] };
}

// Shared test context
export interface TestCtx {
  server: TestServer;
  freeToken: string;
  proToken: string;
  adminToken: string;
  freeCompanyId: string;
  proCompanyId: string;
  adminCompanyId: string;
}

export const ctx: Partial<TestCtx> = {};

async function main() {
  memoryStore.resetAll();
  const server = await startTestServer();
  ctx.server = server;

  console.log('\n═══════════════════════════════════════════');
  console.log(' KONSTRIVO PHASE 2 — API TEST SUITE');
  console.log(` Server on ${server.baseUrl}`);
  console.log('═══════════════════════════════════════════\n');

  const { runAuthTests } = await import('./auth.test');
  const { runPhase2Tests } = await import('./phase2.test');
  const { runTestDatabaseConfigTests } = await import('./test_database_config.test');
  const { runPasswordResetRepositoryTests } = await import('./password_reset_repository.test');
  const { runPasswordResetServiceTests } = await import('./password_reset_service.test');
  const { runDrizzleUserUpdateTests } = await import('./drizzle_user_update.test');
  const { runBootstrapTests } = await import('./bootstrap.test');
  const { runApiAuthForgotResetTests } = await import('./api_auth_forgot_reset.test');
  const { runResetPasswordPageTests } = await import('./reset_password_page.test');
  const { runMaterialPriceTests } = await import('./materials.test');
  const { runTradePhase2aTests } = await import('./trades_phase2a.test');
  const { runTradePhase2bTests } = await import('./trades_phase2b.test');
  const { runTradePhaseBTests } = await import('./trades_phaseB.test');
  const { runTradeAdminTests } = await import('./trades_admin.test');
  const { runTradeAdminApiTests } = await import('./trades_admin_api.test');
  const { runDevisTests } = await import('./devis.test');
  const { runSupplierTests } = await import('./suppliers.test');
  const { runCatalogImportCsvTests } = await import('./catalogImportCsv.test');
  const { runCatalogImportPhaseCTests } = await import('./catalogImportPhaseC.test');
  const { runSyncTests } = await import('./sync.test');
  const { runDirectoryTests } = await import('./directory.test');
  const { runAiTests } = await import('./ai.test');
  const { runRateLimitTests } = await import('./rate_limit.test');
  const { runCorsTests } = await import('./cors.test');
  const { runSecurityHeadersTests } = await import('./security_headers.test');

  await runBootstrapTests();
  await runTestDatabaseConfigTests();
  await runPasswordResetRepositoryTests();
  await runPasswordResetServiceTests();
  await runDrizzleUserUpdateTests();
  await runApiAuthForgotResetTests();
  await runResetPasswordPageTests();
  await runAuthTests();
  await runPhase2Tests();
  await runMaterialPriceTests();
  await runTradePhase2aTests();
  await runTradePhase2bTests();
  await runTradePhaseBTests();
  await runTradeAdminTests();
  await runTradeAdminApiTests();
  await runDevisTests();
  await runSupplierTests();
  await runCatalogImportCsvTests();
  await runCatalogImportPhaseCTests();
  await runSyncTests();
  await runDirectoryTests();
  await runRateLimitTests();
  await runCorsTests();
  await runSecurityHeadersTests();
  await runAiTests();

  console.log('\n═══════════════════════════════════════════');
  console.log(` RESULTS: ✅ ${passed} passed | ❌ ${failed} failed`);
  console.log('═══════════════════════════════════════════\n');

  if (failures.length > 0) {
    console.log('FAILED TESTS:');
    failures.forEach(f => console.log(f));
    console.log('');
  }

  await server.close();
  process.exit(failed > 0 ? 1 : 0);
}

// ── Auto-run ONLY when executed directly ─────────────────────────────────────
// `tsx tests/run.ts` (argv[1] ends with tests/run.ts) runs the full suite.
// Importing this module from a focused runner (e.g. tests/runPhaseC.ts) must
// NOT auto-start a second full suite — it only reuses the shared harness
// (test/assertEq/ok/ctx/testResults).
const __mainEntry = (process.argv[1] || '').replace(/\\/g, '/').toLowerCase();
const __isDirectRun =
  __mainEntry.endsWith('tests/run.ts') || __mainEntry.endsWith('/run.ts') || __mainEntry === 'run.ts';

if (__isDirectRun) {
  main().catch(err => {
    console.error('[KONSTRIVO] Test runner crashed:', err);
    process.exit(1);
  });
}
