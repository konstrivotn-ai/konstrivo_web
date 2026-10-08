// Apply 0009_calc_rules_additive.sql to the TEST database ONLY.
// Project-current mechanism — mirrors server/scripts/apply_0010_to_test_db.cjs:
//   dotenv/config → postgres.js driver (the project's actual driver) →
//   TEST_DATABASE_URL exclusively → single transaction (sql.begin + tx.unsafe)
//   → machine-readable pre/post checks. Idempotent (CREATE TABLE IF NOT EXISTS
//   / ON CONFLICT DO NOTHING in the migration SQL itself).
// NEVER touches DATABASE_URL / production: refuses to run when
// TEST_DATABASE_URL equals DATABASE_URL (if both are set).
require('dotenv/config');

(async () => {
  const postgres = require('postgres');
  const fs = require('fs');
  const path = require('path');
  try {
    if (!process.env.TEST_DATABASE_URL) {
      console.log('ERROR:TEST_DB_ENV_MISSING');
      process.exit(0);
    }
    // Safety guard — TEST DB only. Refuse an ambiguous configuration where the
    // test URL IS the production URL (the 0010 script rewrites
    // process.env.DATABASE_URL for app-config consistency; here we never touch
    // DATABASE_URL at all and simply refuse the dangerous case).
    if (process.env.DATABASE_URL && process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
      console.log('ERROR:TEST_DB_URL_SAME_AS_DATABASE_URL');
      process.exit(0);
    }
    const sql = postgres(process.env.TEST_DATABASE_URL, { max: 1, timeout: 10000 });

    const listTables = async () => {
      const rows = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('calc_rules', 'calc_slots', 'material_calc_links') ORDER BY table_name`;
      return rows.map((r) => r.table_name);
    };

    // Pre-check — which of the three calc tables already exist
    const before = await listTables();
    console.log('TABLES_BEFORE:' + JSON.stringify(before));

    // Migration file presence
    const mf = path.join(process.cwd(), 'server', 'db', 'migrations', '0009_calc_rules_additive.sql');
    if (!fs.existsSync(mf)) {
      console.log('ERROR:MIGRATION_FILE_MISSING');
      await sql.end();
      process.exit(0);
    }
    console.log('MIGRATION_FILE_PRESENT');

    if (before.length === 3) {
      console.log('NO_APPLY_NEEDED');
      await sql.end();
      process.exit(0);
    }

    // Apply inside ONE transaction (same mechanism as the 0010 script)
    const migrationSql = fs.readFileSync(mf, 'utf8');
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(migrationSql);
      });
      console.log('APPLIED_0009:SUCCESS');
    } catch (e) {
      console.log('APPLIED_0009:FAILED');
      console.log('ERROR_MSG:' + (e && e.message ? String(e.message).split('\n')[0] : 'unknown'));
      await sql.end();
      process.exit(0);
    }

    // Post-check — the three tables must now exist
    const after = await listTables();
    console.log('TABLES_AFTER:' + JSON.stringify(after));
    console.log(after.length === 3 ? 'VERIFY_OK' : 'VERIFY_INCOMPLETE');

    await sql.end();
  } catch (err) {
    console.log('ERROR:UNEXPECTED:' + (err && err.message ? String(err.message).split('\n')[0] : 'unknown'));
  }
})();
