/**
 * TEST HARNESS ENVIRONMENT GUARD — import this FIRST in every test entry.
 *
 * WHY THIS FILE EXISTS
 * ESM hoists static imports, so `process.env.NODE_ENV = 'test'` written inside
 * `tests/run.ts` executes AFTER `server/config.ts` has already been evaluated
 * and cached `config`. In that window NODE_ENV was undefined and the resolved
 * database URL could fall back to DATABASE_URL (production). Importing THIS
 * module as the FIRST import makes the assignment run before any other module
 * is evaluated, because ESM evaluates imports in the order they appear.
 *
 * WHAT IT SETS
 *  - `KONSTRIVO_TEST_HARNESS=1` — the marker read by server/bootstrap.ts and
 *    server/db/client.ts. It is deliberately NOT NODE_ENV-based, so it cannot
 *    be defeated by an unset or mis-set NODE_ENV.
 *  - `NODE_ENV='test'` — ONLY when a test database is actually declared.
 *    `loadConfig()` throws when NODE_ENV==='test' and TEST_DATABASE_URL is
 *    missing, so forcing it unconditionally would break the many DB-free suites
 *    that intentionally run without any database (they already take the
 *    "test entry ⇒ memory mode" path, which is equally safe).
 *
 * It never reads, prints or modifies any secret or `.env` value.
 */
if (process.env.KONSTRIVO_TEST_HARNESS !== '1') {
  process.env.KONSTRIVO_TEST_HARNESS = '1';
}

if (!process.env.NODE_ENV && process.env.TEST_DATABASE_URL) {
  process.env.NODE_ENV = 'test';
}

export const TEST_HARNESS_MARKER = 'KONSTRIVO_TEST_HARNESS';
export const isTestHarnessEnv = (): boolean => process.env.KONSTRIVO_TEST_HARNESS === '1';
