// @ts-nocheck
/**
 * Phase 3 — Drizzle Kit configuration
 *
 * SAFETY RULE: Drizzle MUST be pointed at an explicit database exclusively
 * through DATABASE_URL (loaded from .env). There is deliberately NO hardcoded
 * fallback connection string: if DATABASE_URL is missing, this configuration
 * fails loudly instead of silently targeting an unintended database
 * (e.g. the old 'konstrivo' one).
 *
 * Usage:
 *   npx drizzle-kit generate   — generate migration from schema
 *   npx drizzle-kit migrate    — apply migration to DATABASE_URL target
 *   npx drizzle-kit introspect — inspect the target database (read-only)
 *
 * NEVER run destructive commands (drop/reset/push) against an existing database.
 */
import 'dotenv/config';
import type { Config } from 'drizzle-kit';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    '[KONSTRIVO] SAFETY ABORT: DATABASE_URL is not set.\n' +
      'Drizzle refuses to guess a database target. Define DATABASE_URL in .env\n' +
      '(pointing at the dedicated Phase 3 database) and re-run the command.'
  );
}

export default {
  dialect: 'postgresql',
  schema: './server/db/schema/index.ts',
  out: './server/db/migrations',
  dbCredentials: {
    url: DATABASE_URL,
  },
  verbose: true,
  strict: false,
} satisfies Config;

