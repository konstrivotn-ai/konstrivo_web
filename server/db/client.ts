// @ts-nocheck
/**
 * Phase 3 — Database Client (Drizzle + PostgreSQL)
 *
 * Safe bootstrap:
 *   DATABASE_URL exists  →  PostgreSQL via Drizzle
 *   DATABASE_URL missing →  null (caller falls back to in-memory repos)
 *
 * Production: if the database is required but unavailable, fail CLEARLY.
 */
import { config } from '../config';

let dbInstance: any = null;
let dbInitPromise: Promise<any> | null = null;

/**
 * Lazily initialise the Drizzle client.
 * Returns null when DATABASE_URL is not configured (dev fallback mode).
 * Throws clearly in production if configured but connection fails.
 */
export async function getDatabase(): Promise<any | null> {
  if (!config.databaseUrl) {
    return null; // Phase 2 in-memory mode
  }

  // ── TEST / PRODUCTION ISOLATION (fail-closed safety net) ────────────────────
  // `loadConfig()` already selects TEST_DATABASE_URL for any test entry, so a
  // harness can never reach DATABASE_URL through the normal path. This guard
  // exists so that IF that selection ever regressed, the process still refuses
  // to open a connection instead of silently talking to production.
  //
  // It only ever triggers for a harness (KONSTRIVO_TEST_HARNESS), so plain
  // development and production are completely unaffected.
  if (process.env.KONSTRIVO_TEST_HARNESS === '1') {
    const testDatabaseUrl = process.env.TEST_DATABASE_URL;
    if (!testDatabaseUrl || config.databaseUrl !== testDatabaseUrl) {
      throw new Error(
        '[KONSTRIVO-TEST] ABORTING: a test harness may not open a database connection ' +
        'that is not the declared TEST_DATABASE_URL. Test data must never reach production.',
      );
    }
  }

  if (dbInstance) return dbInstance;
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = (async () => {
    try {
      const { drizzle } = await import('drizzle-orm/postgres-js');
      const postgres = (await import('postgres')).default;
      const schema = await import('./schema/index');

      const client = postgres(config.databaseUrl!, {
        max: 6,
        idle_timeout: 20,
        connect_timeout: 10,
      });

      // Verify connectivity
      await client`SELECT 1`;

      dbInstance = drizzle(client, { schema });
      console.log('[KONSTRIVO] ✅ PostgreSQL connected via Drizzle');
      return dbInstance;
    } catch (err) {
      const msg = `[KONSTRIVO] ❌ PostgreSQL connection failed: ${err instanceof Error ? err.message : err}`;
      if (config.isProduction) {
        throw new Error(msg); // Fail clearly in production
      }
      console.warn(msg);
      console.warn('[KONSTRIVO] Falling back to in-memory repositories.');
      return null;
    }
  })();

  return dbInitPromise;
}

/** Check whether the database is currently available. */
export async function isDatabaseAvailable(): Promise<boolean> {
  try {
    return !!(await getDatabase());
  } catch {
    return false;
  }
}
