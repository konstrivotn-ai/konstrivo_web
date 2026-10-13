/**
 * Focused, DB-free runner for the Google auth suite.
 *
 * Runs the same `runGoogleAuthTests()` cases that the full suite executes,
 * against an in-memory Express app (no TEST_DATABASE_URL, no network, no
 * `startTestServer` DB-cleanup path). Used for fast local verification;
 * CI still runs the full suite via tests/run.ts.
 *
 * Usage: npx tsx tests/runGoogleAuthSuite.ts
 */
import './envGuard';
import express from 'express';
import http from 'http';
import { applyCors } from '../server/middleware/cors';
import { applySecurityHeaders } from '../server/middleware/securityHeaders';
import { setupV1Router } from '../server/routes/v1';
import { ctx, testResults, TestCtx } from './run';

async function main() {
  const app = express();
  applySecurityHeaders(app);
  applyCors(app);
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/v1', setupV1Router());

  const server: http.Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address() as { port: number };
  ctx.server = {
    port: address.port,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  } as TestCtx['server'];

  const { runGoogleAuthTests } = await import('./google_auth.test');
  await runGoogleAuthTests();

  const results = testResults();
  console.log(`\nGOOGLE AUTH RESULTS: ${results.passed} passed | ${results.failed} failed\n`);
  await ctx.server!.close();
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[KONSTRIVO] Google auth runner crashed:', err);
  process.exit(1);
});

