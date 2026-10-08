// @ts-nocheck
/**
 * Independent, ADDITIVE migration out-folder for the TEST-DB-only
 * "subscriptions provider columns" migration.
 *
 * Deliberately separate from the canonical drizzle state
 * (server/db/migrations*): this config never reads or writes the canonical
 * _journal.json / snapshots. It manages its own journal at
 * server/db/migrations_subscriptions/meta/_journal.json.
 *
 * Same safety rules as drizzle.config.ts: DATABASE_URL only, no hardcoded
 * fallback. Target must be the TEST database when applying.
 */
import 'dotenv/config';
import type { Config } from 'drizzle-kit';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    '[KONSTRIVO] SAFETY ABORT: DATABASE_URL is not set. ' +
      'Refusing to guess a database target.'
  );
}

export default {
  dialect: 'postgresql',
  schema: './server/db/schema/index.ts',
  out: './server/db/migrations_subscriptions',
  dbCredentials: {
    url: DATABASE_URL,
  },
  verbose: true,
  strict: false,
} satisfies Config;