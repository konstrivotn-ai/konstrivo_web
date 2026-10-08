/**
 * Phase 2 + Phase 3 — Environment Configuration
 *
 * Reads configuration from environment variables.
 * Safe defaults are provided so the application never crashes
 * during local frontend development when no database is configured.
 */
import { config as loadEnvFile } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

// ── ENV LOADING FIX (missing root .env broke Admin login: the server silently
// ran in in-memory mode and could not see the Supabase admin user) ───────────
// The project's credential file is server/.env, but `dotenv` only loads
// <cwd>/.env, and the server is always started from the project root
// (npm run dev/test/build, drizzle-kit). Load order below preserves the
// pre-existing precedence EXACTLY (highest wins):
//   real process env (platform-injected)  >  <cwd>/.env  >  <project>/server/.env
// `override: false` (dotenv default) means a key that is already set is NEVER
// replaced, so nothing here can change a value that was previously visible.
// Pure node:path + fs.existsSync — no __dirname / import.meta, so this is safe
// in tsx, vitest-style ESM, and the esbuild CJS bundles (dist/server.cjs,
// api/index.cjs), where __dirname/import.meta are unavailable or unreliable.
loadEnvFile(); // default behaviour, unchanged: <cwd>/.env
try {
  const candidates =
    path.basename(process.cwd()) === 'server'
      // Started from inside server/ (exotic) — cwd .env may already cover it;
      // the explicit path form keeps the intent clear.
      ? [path.join(process.cwd(), '.env')]
      // Project-root start (npm run dev/test/build, drizzle-kit, scripts).
      : [path.join(process.cwd(), 'server', '.env')];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) loadEnvFile({ path: candidate });
  }
} catch {
  // Unreadable path — keep the previous behaviour (cwd .env only).
}

export interface ServerConfig {
  port: number;
  nodeEnv: string;
  isProduction: boolean;
  // JWT
  jwtSecret: string;
  jwtExpiresInSeconds: number;
  jwtRefreshExpiresInSeconds: number;
  // Password hashing
  scryptSaltLen: number;
  scryptKeyLen: number;
  scryptN: number;
  // File upload
  maxUploadBytes: number;
  allowedUploadMime: Set<string>;
  // Database (Phase 3)
  databaseUrl: string | undefined;
  testDatabaseUrl: string | undefined;
  // Public app URL used to build password-reset links.
  publicAppUrl: string | undefined;
  // Flouci payments (Phase E) — optional; the adapter fails CLOSED when unset.
  flouciPublicKey: string;
  flouciSecretKey: string;
  flouciBaseUrl: string;
  // Rate limiting (basic)
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

const ONE_DAY_SECONDS = 86400;

/**
 * SAFETY (Phase B): Test-runner detection that does NOT depend on NODE_ENV
 * being assigned before ESM imports are evaluated.
 *
 * WHY THIS EXISTS: ESM hoists static imports, so `process.env.NODE_ENV = 'test'`
 * in tests/run.ts / tests/runPhaseB.ts executes only AFTER server/config.ts has
 * already been imported and `export const config = loadConfig()` has run. In that
 * window NODE_ENV is undefined and the effective database URL resolved to
 * DATABASE_URL (production/Supabase) instead of TEST_DATABASE_URL (Neon).
 *
 * This check reads the process entry point instead, which is valid from the very
 * first module evaluation. It can never match a real server/production start:
 *   - npm run dev  → server.ts
 *   - npm start    → dist/server.cjs
 *   - production   → api/index.cjs / server entry (never tests/*.ts)
 *
 * WIDENED 2026-09-27 (root-cause fix for the documented production incident):
 * the previous allow-list only recognised `tests/run.ts`, `tests/runPhaseB.ts`
 * and `tests/runPhaseC.ts`, so ANY other entry that booted the harness — a
 * scratch script, a single suite run directly (`npx tsx tests/foo.test.ts`), a
 * focused runner added later — resolved DATABASE_URL (production) instead of
 * TEST_DATABASE_URL and wrote real test data into production. Detection is now
 * FAIL-CLOSED by *location*: any entry under a `tests/` directory (or a
 * root-level `*.test.ts` / `*.spec.ts`) is a test entry. Real server entries
 * (`server.ts`, `dist/server.cjs`, `api/index.cjs`) can never match.
 *
 * Production is explicitly excluded: prod-simulation tests set NODE_ENV='production'
 * and must keep production DB-selection semantics.
 */
export function isTestRunnerEntry(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  const entry = (process.argv[1] || '').replace(/\\/g, '/').toLowerCase();
  if (!entry) return false;
  // 1) Anything under a tests/ directory — the whole test tree, whatever the
  //    file is called (focused runners, single suites, temporary scripts).
  if (/(^|\/)tests\//.test(entry)) return true;
  // 2) Root-level suites executed directly (`npx tsx my_suite.test.ts`).
  //    A real server entry never ends with .test.ts / .spec.ts.
  const file = entry.split('/').pop() || '';
  return file.endsWith('.test.ts') || file.endsWith('.spec.ts');
}

export function loadConfig(): ServerConfig {
  const jwtSecret = process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.JWT_SECRET || jwtSecret === 'dev-only-insecure-secret-change-me') {
      // Fail CLOSED in production: an unconfigured or known JWT secret would
      // allow anyone to forge tokens. Auth-foundation safety guard (Phase 0).
      throw new Error(
        '[KONSTRIVO] FATAL: JWT_SECRET is not configured in production. ' +
        'Refusing to start with an insecure token secret.'
      );
    }
    // Additional strength check: require a reasonably long secret in production.
    // Recommend a 32-byte random secret (e.g. `openssl rand -hex 32`).
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
      throw new Error(
        '[KONSTRIVO] FATAL: JWT_SECRET appears too short or weak for production. ' +
        'Provide a strong secret (recommend: 32+ characters or 32 random bytes hex).' 
      );
    }
  } else if (!process.env.JWT_SECRET) {
    console.warn('[KONSTRIVO] WARNING: JWT_SECRET not set — using insecure dev default. NEVER use in production.');
  }

  const databaseUrl = process.env.DATABASE_URL || undefined;
  const testDatabaseUrl = process.env.TEST_DATABASE_URL || undefined;

  // Order-independent test-mode detection (see isTestRunnerEntry above).
  // True when NODE_ENV is explicitly 'test', OR when the process entry lives
  // under tests/ (the ESM hoisting window, where NODE_ENV is still undefined).
  // `isTestEntry` is tracked separately so a test process that did NOT declare
  // NODE_ENV=test (e.g. a DB-free suite) keeps working WITHOUT a test database —
  // while still being unable to reach DATABASE_URL (see effectiveDatabaseUrl).
  const isTestEntry = isTestRunnerEntry();
  const isTestRun = process.env.NODE_ENV === 'test' || isTestEntry;

  if (process.env.NODE_ENV === 'production') {
    // In production we require a configured DATABASE_URL; refuse to run in
    // memory/mock mode to avoid accidentally exposing seeded demo data.
    if (!databaseUrl) {
      throw new Error('[KONSTRIVO] FATAL: DATABASE_URL must be configured in production. Refusing to start in memory mode.');
    }
  }

  if (process.env.NODE_ENV === 'test') {
    // Explicit test mode: the test database is mandatory (unchanged contract).
    if (!testDatabaseUrl) {
      throw new Error('[KONSTRIVO-TEST] TEST_DATABASE_URL is required for PostgreSQL integration tests.');
    }
    if (databaseUrl && testDatabaseUrl === databaseUrl) {
      throw new Error('[KONSTRIVO-TEST] TEST_DATABASE_URL must be different from DATABASE_URL.');
    }
  } else if (isTestEntry) {
    // Undeclared test entry (NODE_ENV not assigned yet — ESM hoisting).
    // TEST_DATABASE_URL is NOT mandatory here (DB-free suites must keep running),
    // but a test entry must never be CONFIGURED with DATABASE_URL: identical
    // values would mean the test silently targets production.
    if (testDatabaseUrl && databaseUrl && testDatabaseUrl === databaseUrl) {
      throw new Error('[KONSTRIVO-TEST] TEST_DATABASE_URL must be different from DATABASE_URL.');
    }
  }

  if (databaseUrl && process.env.NODE_ENV === 'development') {
    console.log('[KONSTRIVO] DATABASE_URL detected — PostgreSQL mode enabled.');
  }

  // SAFETY: a test run NEVER uses DATABASE_URL, regardless of import order or
  // NODE_ENV timing. When TEST_DATABASE_URL is configured it is the ONLY
  // database a test process can reach; when it is NOT configured the process
  // runs WITHOUT a database (memory mode) instead of silently falling back to
  // DATABASE_URL (production). This closes the hole that let a test/scratch
  // entry write permanent dynamic trades into production (incident 2026-09-25).
  const effectiveDatabaseUrl = isTestRun ? testDatabaseUrl : databaseUrl;
  if (isTestRun && !testDatabaseUrl && databaseUrl) {
    console.warn(
      '[KONSTRIVO-TEST] TEST_DATABASE_URL is not set — refusing DATABASE_URL for a test entry: ' +
      'running WITHOUT a database (memory mode). Set TEST_DATABASE_URL to run DB-backed tests.'
    );
  }

  // Flouci (Phase E): plain wiring only — no fail-closed throw here so the
  // server boots without payment credentials. The Flouci adapter itself
  // refuses to operate when keys are missing.
  const flouciPublicKey = process.env.FLOUCI_PUBLIC_KEY || '';
  const flouciSecretKey = process.env.FLOUCI_SECRET_KEY || '';
  const flouciBaseUrl =
    process.env.FLOUCI_BASE_URL || 'https://developers.flouci.com/api/v2';

  return {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: isTestRun ? 'test' : (process.env.NODE_ENV || 'development'),
    isProduction: process.env.NODE_ENV === 'production',
    jwtSecret,
    jwtExpiresInSeconds: parseInt(process.env.JWT_EXPIRES_IN || '3600', 10), // 1 hour
    jwtRefreshExpiresInSeconds: parseInt(process.env.JWT_REFRESH_EXPIRES_IN || String(ONE_DAY_SECONDS * 7), 10), // 7 days
    scryptSaltLen: 16,
    scryptKeyLen: 32,
    scryptN: 16384,
    maxUploadBytes: parseInt(process.env.MAX_UPLOAD_BYTES || String(5 * 1024 * 1024), 10), // 5 MB
    allowedUploadMime: new Set(['text/csv', 'application/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
    databaseUrl: effectiveDatabaseUrl,
    testDatabaseUrl,
    publicAppUrl: getPublicAppUrl(),
    flouciPublicKey,
    flouciSecretKey,
    flouciBaseUrl,
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  };
}

export const config: ServerConfig = loadConfig();

/**
 * Returns true only when NODE_ENV === 'production'. Read at call time (not
 * cached) so behaviour always reflects the *current* environment, including
 * during tests that simulate production.
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Returns the validated public application URL (trailing slashes stripped)
 * used to build password-reset links, or `undefined` when it is unset or
 * invalid.
 *
 * SECURITY:
 * - The value is read from the server environment ONLY; it is never taken from
 *   any HTTP input (body/query/header/cookie) or from the frontend.
 * - Only absolute http(s) URLs with a host are accepted; anything else (e.g.
 *   `not-a-url`, `ftp://...`) returns `undefined`.
 * - This helper NEVER falls back to localhost. Callers decide how to react to
 *   `undefined`; in production the forgot-password route simply skips the
 *   email so no localhost/accent reset link is ever sent.
 */
export function getPublicAppUrl(): string | undefined {
  const raw = process.env.PUBLIC_APP_URL;
  if (!raw) return undefined;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return undefined;
  }
  if (!['http:', 'https:'].includes(u.protocol)) return undefined;
  if (!u.hostname) return undefined;
  return raw.replace(/\/+$/, '');
}

export function hasDatabase(): boolean {
  return !!config.databaseUrl;
}

/**
 * Returns true only when we are in an environment we can confidently
 * identify as a development database.
 * This guards against accidentally connecting to production.
 */
export function isSafeDevelopmentDatabase(): boolean {
  if (!config.databaseUrl) return false;
  const url = config.databaseUrl.toLowerCase();
  // Allow common local dev hosts
  const localHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1', 'host.docker.internal'];
  return localHosts.some(h => url.includes(h)) && config.nodeEnv !== 'production';
}
