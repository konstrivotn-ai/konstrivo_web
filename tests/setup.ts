/**
 * Phase 2 — Test Infrastructure
 *
 * Starts the Express app on an ephemeral port and exposes
 * helpers for making authenticated API requests.
 */
// ── TEST/PRODUCTION ISOLATION ────────────────────────────────────────────────
// MUST stay the FIRST import (see tests/envGuard.ts): it marks the process as a
// test harness before server/config.ts caches `config`.
import './envGuard';
import http from 'http';
import express from 'express';
import { applyCors } from '../server/middleware/cors';
import { applySecurityHeaders } from '../server/middleware/securityHeaders';
import { setupV1Router } from '../server/routes/v1';
import { authenticate } from '../server/middleware/auth';
import { createAiEstimatorHandler } from '../server';
import { createLimiter } from '../server/middleware/rateLimit';
import { getDatabase } from '../server/db/client';
import { isSafeDevelopmentDatabase, isTestRunnerEntry } from '../server/config';
import { createHash } from 'node:crypto';

// Exported test hook to capture what would be sent to the AI provider.
export let lastAiRequest: any = null;

export function resetLastAiRequest() {
  lastAiRequest = null;
}

export function getLastAiRequest() {
  return lastAiRequest;
}

export interface TestServer {
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
}

/**
 * Clean PostgreSQL tables before running tests to ensure test isolation.
 * Only identity/transactional tables are truncated — the catalog
 * (materials/prices) is served from MemoryStore in tests and seeded
 * independently, so it must NOT be wiped here.
 */
async function cleanupDatabase() {
  // Production-simulation tests (CORS / security headers) set NODE_ENV='production'
  // and must NOT call the destructive TRUNCATE path. For those tests, skip cleanup
  // entirely — they do not depend on a clean DB because they only assert HTTP
  // middleware behavior. Normal integration tests still go through the full path.
  //
  // SAFETY (Phase B): use the order-independent test-runner detection from
  // server/config.ts so plain `npm test` (NODE_ENV not yet set at import time
  // due to ESM hoisting) is still recognised as a test run — and so the TRUNCATE
  // below can only ever execute against TEST_DATABASE_URL, never DATABASE_URL.
  const isTestRun =
    process.env.NODE_ENV === 'test' ||
    (!process.env.NODE_ENV && isTestRunnerEntry());
  if (!isTestRun) return;

  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  const productionDatabaseUrl = process.env.DATABASE_URL;
  if (!testDatabaseUrl) {
    throw new Error('[KONSTRIVO-TEST] TEST_DATABASE_URL is required for PostgreSQL integration tests.');
  }
  if (productionDatabaseUrl && testDatabaseUrl === productionDatabaseUrl) {
    throw new Error('[KONSTRIVO-TEST] TEST_DATABASE_URL must be different from DATABASE_URL.');
  }

  // SAFETY (2026-09-27 — fail CLOSED, root cause of the documented production
  // incident): every write below (the TRUNCATE and ALL seeds) goes through
  // getDatabase(), which connects to `config.databaseUrl` — resolved ONCE at
  // module import time. `NODE_ENV === 'test'` at CALL time does NOT prove that
  // the connection is the test database: a process that started as a non-test
  // entry (scratch script, ad-hoc runner) and only later declared NODE_ENV=test
  // still holds the PRODUCTION connection, which is exactly how the production
  // database was truncated/re-seeded on 2026-09-25/26. Refuse to run unless the
  // resolved connection IS the declared test database.
  const { config: runtimeConfig } = await import('../server/config');
  if (runtimeConfig.databaseUrl && runtimeConfig.databaseUrl !== testDatabaseUrl) {
    throw new Error(
      '[KONSTRIVO-TEST] ABORTING: this process resolved DATABASE_URL (a NON-test database) ' +
      'while NODE_ENV=test. Test data must never reach production — start the run through ' +
      'tests/run*.ts (or any tests/*.test.ts entry) so TEST_DATABASE_URL is selected at import time.'
    );
  }

  // Ensure we do NOT run destructive cleanup against non-test/production DBs.
  const db = await getDatabase();
  if (!db) return;

  const explicitConfirm = process.env.TEST_DB_CONFIRM === '1' || process.env.TEST_DB_CONFIRM === 'true';
  if (!explicitConfirm) {
    // Require an explicit confirmation environment variable before allowing
    // any destructive cleanup, regardless of whether the DB appears local.
    throw new Error('[KONSTRIVO-TEST] Aborting destructive cleanup: TEST_DB_CONFIRM must be set to 1 to allow TRUNCATE/cleanup (DANGEROUS).');
  }

  try {
    const { sql } = await import('drizzle-orm');
    // All table names verified against server/db/schema/*.
    await db.execute(sql.raw(
      'TRUNCATE TABLE idempotency_keys, sync_operations, supplier_catalog_items, ' +
      'supplier_catalog_imports, artisan_profiles, devis_items, devis, ' +
      'subscriptions, company_members, companies, users CASCADE'
    ));
  } catch (err) {
    console.warn('[KONSTRIVO-TEST] Database cleanup failed/skipped:', err instanceof Error ? err.message : err);
  }
}

/**
 * SAFETY/SEEDS (Phase B): PostgreSQL test seeds must satisfy the `uuid` columns
 * (artisan_profiles.id, materials.id, material_prices.id, materials.trade_id).
 * Legacy memory/seed data uses business ids like 'art_1' / 'plaque_ba13_standard'
 * (and materials.tradeId may be '' — also invalid for a uuid column).
 *
 * Deterministic mapping (md5 → 8-4-4-4-12 hex) keeps re-seeding idempotent:
 * the same business id always maps to the same UUID, so "table non-empty → skip"
 * remains correct across runs and across focused runners.
 */
const TEST_SEED_UUID_NAMESPACE = 'konstrivo-test-seed:';

function toSeedUuid(seedId: string): string {
  const hex = createHash('md5').update(TEST_SEED_UUID_NAMESPACE + seedId).digest('hex');
  // Format as RFC-4122 v4 (version nibble '4', variant nibble in [89ab]) so the
  // ids comply with server/utils/validation.isValidUuid — the guard used by the
  // by-id repository paths and routes. Non-compliant ids would 404 on GET /:id.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keeps real UUID references (e.g. a genuine trades.id), maps everything else (null/'') to null. */
function uuidOrNull(ref: string | null | undefined): string | null {
  return typeof ref === 'string' && UUID_RE.test(ref) ? ref : null;
}

/** Idempotently seed artisan_profiles into the PostgreSQL test database when it is
 * available. Run once per test server start so artisan directory tests are repeatable
 * under Neon without changing production seeding behavior. */
async function seedArtisansIfAvailable() {
  try {
    const db = await getDatabase();
    if (!db) return;
    const { artisanProfiles } = await import('../server/db/schema/operations');
    const existing = await db.select({ id: artisanProfiles.id }).from(artisanProfiles).limit(1);
    if (existing.length > 0) return; // already seeded for this DB
    const { buildArtisansFromMock } = await import('../server/repositories/seed');
    const artisans = buildArtisansFromMock();
    if (!artisans || artisans.length === 0) return;
    for (const a of artisans) {
      await db.insert(artisanProfiles).values({
        id: toSeedUuid(a.id),
        userId: uuidOrNull(a.userId ?? null),
        companyName: a.companyName,
        trade: a.trade,
        region: a.region,
        rating: a.rating,
        isVerified: a.isVerified,
        isPro: a.isPro,
        phone: a.phone,
        whatsapp: a.whatsapp,
        hourlyRateTnd: a.hourlyRateTnd,
        squareMeterRateTnd: a.squareMeterRateTnd,
        services: JSON.stringify(a.services),
        badges: JSON.stringify(a.badges),
        bio: a.bio,
        avatarUrl: a.avatarUrl,
        isDeleted: false,
        createdAt: new Date(a.createdAt),
        updatedAt: new Date(a.updatedAt),
      });
    }
  } catch (err) {
    // Seeding is best-effort for tests; never block server start.
    console.warn('[KONSTRIVO-TEST] artisan seed skipped:', err instanceof Error ? err.message : err);
  }
}

/** Idempotently seed materials (+ current official material_prices) into the PostgreSQL
 * test database when it is available. This makes materials/price tests repeatable under
 * Neon without relying on in-memory-only state and without touching production seeding. */
async function seedMaterialsIfAvailable() {
  try {
    const db = await getDatabase();
    if (!db) return;
    const { materials, materialPrices } = await import('../server/db/schema/catalog');
    const { and, eq, isNull, ne } = await import('drizzle-orm');
    const existing = await db.select({ id: materials.id }).from(materials).limit(1);
    if (existing.length > 0) return; // already seeded for this DB
    const { buildMaterialsFromRates } = await import('../server/repositories/seed');
    const { materials: mats, prices } = buildMaterialsFromRates();
    if (!mats || mats.length === 0) return;
    // Business seed id → mapped UUID (needed so price rows reference the inserted material UUIDs).
    const materialUuidById = new Map<string, string>();
    for (const m of mats) {
      const materialUuid = toSeedUuid(m.id);
      materialUuidById.set(m.id, materialUuid);
      await db.insert(materials).values({
        id: materialUuid,
        code: m.code,
        trade: m.trade,
        tradeId: uuidOrNull(m.tradeId ?? null),
        category: m.category,
        nameFr: m.nameFr,
        nameAr: m.nameAr ?? null,
        nameEn: m.nameEn ?? null,
        baseUnit: m.baseUnit,
        isOfficial: m.isOfficial,
        companyId: m.companyId ?? null,
        technicalSpecs: m.technicalSpecs ?? null,
        createdAt: new Date(m.createdAt),
        updatedAt: new Date(m.updatedAt),
        version: m.version,
        isDeleted: false,
      });
    }
    // Seed the corresponding OFFICIAL_DEFAULT current prices where provided.
    if (prices && prices.length > 0) {
      for (const p of prices) {
        const materialUuid = materialUuidById.get(p.materialId);
        if (!materialUuid) continue;
        const existingPrice = await db.select({ id: materialPrices.id }).from(materialPrices)
          .where(and(eq(materialPrices.materialId, materialUuid), eq(materialPrices.sourceCode, 'OFFICIAL_DEFAULT'), isNull(materialPrices.companyId))).limit(1);
        if (existingPrice.length > 0) continue;
        await db.insert(materialPrices).values({
          id: toSeedUuid(p.id),
          materialId: materialUuid,
          sourceCode: 'OFFICIAL_DEFAULT',
          countryCode: p.countryCode ?? 'TN',
          currencyCode: p.currency ?? 'TND',
          unitPrice: String(p.price),
          companyId: null,
          supplierId: null,
          isCurrent: true,
          // material_prices.effective_from is a drizzle `date()` column → string mode.
          effectiveFrom: typeof p.effectiveFrom === 'string'
            ? p.effectiveFrom
            : '2026-01-01',
          notes: p.notes ?? null,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
          version: 1,
          isDeleted: false,
        });
      }
    }
  } catch (err: any) {
    // Seeding is best-effort for tests; never block server start.
    const cause = err?.cause instanceof Error ? ` | cause: ${err.cause.message}` : '';
    console.warn('[KONSTRIVO-TEST] materials seed skipped:', err instanceof Error ? err.message : err, cause);
  }
}

export async function startTestServer(opts?: { enableRateLimits?: boolean, testLimits?: any }): Promise<TestServer> {
  // Clean database before starting tests
  await cleanupDatabase();

  // Idempotent artisan seed so artisan directory tests are repeatable under Neon.
  await seedArtisansIfAvailable();

  // Idempotent materials + official prices seed so materials/price tests are repeatable
  // under Neon (in-memory mode remains unchanged).
  await seedMaterialsIfAvailable();

  // Optionally enable test-mode rate limits and inject test-specific limits
  const prevTestEnable = process.env.TEST_ENABLE_RATE_LIMITS;
  const prevEnv: Record<string, string | undefined> = {};
  if (opts?.enableRateLimits) {
    process.env.TEST_ENABLE_RATE_LIMITS = '1';
  }
  if (opts?.testLimits) {
    const mapping: Record<string, string[]> = {
      login: ['RATE_LIMIT_LOGIN_MAX', 'RATE_LIMIT_LOGIN_WINDOW_MS'],
      register: ['RATE_LIMIT_REGISTER_MAX', 'RATE_LIMIT_REGISTER_WINDOW_MS'],
      refresh: ['RATE_LIMIT_REFRESH_MAX', 'RATE_LIMIT_REFRESH_WINDOW_MS'],
      aiEstimator: ['RATE_LIMIT_AI_MAX', 'RATE_LIMIT_AI_WINDOW_MS'],
    };
    for (const key of Object.keys(opts.testLimits)) {
      const envKeys = mapping[key] || [];
      const val = opts.testLimits[key];
      if (envKeys[0] && val.max !== undefined) { prevEnv[envKeys[0]] = process.env[envKeys[0]]; process.env[envKeys[0]] = String(val.max); }
      if (envKeys[1] && val.windowMs !== undefined) { prevEnv[envKeys[1]] = process.env[envKeys[1]]; process.env[envKeys[1]] = String(val.windowMs); }
    }
  }

  const app = express();
  // Apply security headers (dev/test relaxed for tooling)
  applySecurityHeaders(app);
  // Apply CORS in test apps too (reflect origin in non-production)
  applyCors(app);
  app.use(express.json({ limit: '10mb' }));
  const v1Router = setupV1Router();
  app.use('/api/v1', v1Router);

  // Simple health for testing
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Mount production AI estimator handler but inject a fake AI client to avoid external calls
  const fakeAiClient = {
    models: {
      generateContent: async ({ model, contents, config }: any) => {
        // capture the call for tests (stringifyable)
        lastAiRequest = { model, contents, config };
        return { text: 'stub' };
      }
    }
  };

  // Use the real production handler code but with injected fake client for tests
  const aiLimiter = createLimiter('aiEstimator', opts?.testLimits?.aiEstimator, !!opts?.enableRateLimits);
  app.post('/api/ai-estimator', authenticate, aiLimiter as any, createAiEstimatorHandler(fakeAiClient));

  // Additional test-only route to exercise the production handler without an injected client
  // This allows asserting 503 when GEMINI_API_KEY is missing.
  app.post('/api/ai-estimator-prod-check', createAiEstimatorHandler());

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      // Expose the test server port to the process so rate limiter keying
      // can use a stable per-server identifier instead of per-connection
      // socket ports which may vary across requests.
      const prevServerPort = process.env.TEST_SERVER_PORT;
      process.env.TEST_SERVER_PORT = String(addr.port);
      resolve({
        port: addr.port,
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((res2) => server.close(() => {
          // Restore previous env values
          if (prevServerPort === undefined) delete process.env.TEST_SERVER_PORT; else process.env.TEST_SERVER_PORT = prevServerPort;
          if (opts?.enableRateLimits) {
            if (prevTestEnable === undefined) delete process.env.TEST_ENABLE_RATE_LIMITS; else process.env.TEST_ENABLE_RATE_LIMITS = prevTestEnable;
          }
          if (opts?.testLimits) {
            for (const k of Object.keys(prevEnv)) {
              const v = prevEnv[k];
              if (v === undefined) delete process.env[k]; else process.env[k] = v;
            }
          }
          res2();
        })),
      });
    });
  });
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  headers: Record<string, string>;
}

export async function apiRequest(
  baseUrl: string,
  method: string,
  path: string,
  options?: {
    body?: any;
    token?: string;
    idempotencyKey?: string;
    rawBody?: Buffer | string;
    contentType?: string;
    headers?: Record<string, string>;
  }
): Promise<ApiResponse> {
  return new Promise((resolve, reject) => {
    const url = `${baseUrl}${path}`;
    const parsedUrl = new URL(url);
    const isRaw = !!options?.rawBody;

    const req = http.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method,
        headers: {
          ...(isRaw && options?.contentType ? { 'Content-Type': options.contentType } : {}),
          ...(!isRaw && options?.body ? { 'Content-Type': 'application/json' } : {}),
          ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(options?.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
          // Ensure deterministic client identity for rate-limit tests
          'X-Forwarded-For': '127.0.0.1',
          ...(options?.headers || {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          let body: any = data;
          try {
            if (data.length > 0) body = JSON.parse(data);
          } catch { /* keep as string */ }
          resolve({ status: res.statusCode || 0, body, headers: res.headers as Record<string, string> });
        });
      }
    );

    req.on('error', reject);

    if (options?.rawBody) {
      req.end(options.rawBody);
    } else if (options?.body !== undefined) {
      req.end(JSON.stringify(options.body));
    } else {
      req.end();
    }
  });
}
