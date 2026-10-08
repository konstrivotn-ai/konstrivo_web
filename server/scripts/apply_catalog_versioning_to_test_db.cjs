// Apply the CATALOG VERSIONING migrations to the TEST database ONLY:
//   0011_country_catalog.sql      → country_catalogs
//   0012_country_catalog_items.sql→ country_catalog_items (+ country_calculation_rules)
//   0015_trade_metre_elements.sql → trade_metre_elements
//
// Project-current mechanism — mirrors server/scripts/apply_0009_to_test_db.cjs:
//   dotenv → postgres.js driver (the project's actual driver) →
//   TEST_DATABASE_URL exclusively → one transaction per migration file →
//   machine-readable pre/post checks. Every migration is ADDITIVE ONLY
//   (CREATE TABLE IF NOT EXISTS / guarded FK / CREATE INDEX IF NOT EXISTS),
//   so re-running this script is a no-op.
//
// NEVER touches DATABASE_URL / production: it opens a connection ONLY to
// TEST_DATABASE_URL, and refuses to run when that URL is identical to
// DATABASE_URL (exact match or same host + same database path).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
// The project keeps DATABASE_URL / TEST_DATABASE_URL in server/.env; load it too
// WITHOUT overwriting anything already present in the environment.
const serverEnv = path.join(__dirname, '..', '.env');
if (fs.existsSync(serverEnv)) require('dotenv').config({ path: serverEnv });

const MIGRATIONS = [
  { file: '0011_country_catalog.sql', table: 'country_catalogs' },
  { file: '0012_country_catalog_items.sql', table: 'country_catalog_items' },
  { file: '0015_trade_metre_elements.sql', table: 'trade_metre_elements' },
];

function normalizeUrl(u) {
  // Compare host + database path only (credentials / query params ignored).
  try {
    const x = new URL(u);
    return `${x.hostname}:${x.port || '5432'}${x.pathname}`.toLowerCase();
  } catch {
    return String(u || '').toLowerCase();
  }
}

(async () => {
  try {
    const testUrl = process.env.TEST_DATABASE_URL;
    const prodUrl = process.env.DATABASE_URL;

    if (!testUrl) {
      console.log('ERROR:TEST_DB_ENV_MISSING');
      process.exit(0);
    }
    // Safety guard — TEST DB only.
    if (prodUrl && testUrl === prodUrl) {
      console.log('ERROR:TEST_DB_URL_SAME_AS_DATABASE_URL');
      process.exit(0);
    }
    if (prodUrl && normalizeUrl(testUrl) === normalizeUrl(prodUrl)) {
      console.log('ERROR:TEST_DB_HOST_DB_SAME_AS_DATABASE_URL');
      process.exit(0);
    }

    const postgres = require('postgres');
    const sql = postgres(testUrl, { max: 1, timeout: 15000 });

    const wanted = MIGRATIONS.map((m) => m.table);
    const listTables = async () => {
      const rows = await sql`SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ${sql(wanted)} ORDER BY table_name`;
      return rows.map((r) => r.table_name);
    };

    const before = await listTables();
    console.log('TARGET_DB_HOST:' + new URL(testUrl).hostname);
    console.log('TABLES_BEFORE:' + JSON.stringify(before));

    for (const m of MIGRATIONS) {
      const mf = path.join(process.cwd(), 'server', 'db', 'migrations', m.file);
      if (!fs.existsSync(mf)) {
        console.log(`ERROR:MIGRATION_FILE_MISSING:${m.file}`);
        continue;
      }
      if (before.includes(m.table)) {
        console.log(`SKIP_ALREADY_PRESENT:${m.table}`);
        continue;
      }
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(fs.readFileSync(mf, 'utf8'));
        });
        console.log(`APPLIED:${m.file}:SUCCESS`);
      } catch (e) {
        console.log(`APPLIED:${m.file}:FAILED`);
        console.log(`ERROR_MSG:${m.table}:` + (e && e.message ? String(e.message).split('\n')[0] : 'unknown'));
      }
    }

    const after = await listTables();
    console.log('TABLES_AFTER:' + JSON.stringify(after));
    console.log(after.length === wanted.length ? 'VERIFY_OK' : 'VERIFY_INCOMPLETE');

    // Column contract check — the importer writes these columns.
    try {
      const ccCols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'country_catalogs' ORDER BY column_name`;
      const ciCols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'country_catalog_items' ORDER BY column_name`;
      console.log('COUNTRY_CATALOG_COLUMNS:' + JSON.stringify(ccCols.map((r) => r.column_name)));
      console.log('COUNTRY_CATALOG_ITEM_COLUMNS:' + JSON.stringify(ciCols.map((r) => r.column_name)));
    } catch (e) {
      console.log('ERROR_MSG:columns:' + (e && e.message ? String(e.message).split('\n')[0] : 'unknown'));
    }

    await sql.end();
  } catch (err) {
    console.log('ERROR:UNEXPECTED:' + (err && err.message ? String(err.message).split('\n')[0] : 'unknown'));
  }
})();
