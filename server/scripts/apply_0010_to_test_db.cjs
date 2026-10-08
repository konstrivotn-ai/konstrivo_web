require('dotenv/config');

(async () => {
  // dotenv loaded above so TEST_DATABASE_URL from .env is available
  const postgres = require('postgres');
  const fs = require('fs');
  const path = require('path');
  try {
    if (!process.env.TEST_DATABASE_URL) {
      console.log('ERROR:TEST_DB_ENV_MISSING');
      process.exit(0);
    }
    // Use TEST_DATABASE_URL as DATABASE_URL for project config consistency
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const sql = postgres(process.env.DATABASE_URL, { max: 1, timeout: 10000 });

    // Check if material_prices.review_status exists
    try {
      const col = await sql`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'material_prices' AND column_name = 'review_status'`;
      if (col && col.length > 0) {
        console.log('COLUMN_EXISTS');
      } else {
        console.log('COLUMN_MISSING');
      }
    } catch (e) {
      console.log('ERROR:SCHEMA_CHECK_FAILED');
      await sql.end();
      process.exit(0);
    }

    // Check drizzle migrations table
    let migrationsTableExists = false;
    try {
      const mt = await sql`SELECT to_regclass('drizzle.__drizzle_migrations') as t`;
      if (mt && mt[0] && mt[0].t) migrationsTableExists = true;
    } catch (e) {
      migrationsTableExists = false;
    }
    console.log(migrationsTableExists ? 'MIGRATIONS_TABLE_PRESENT' : 'MIGRATIONS_TABLE_MISSING');

    if (migrationsTableExists) {
      try {
        const rows = await sql`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 50`;
        console.log('MIGRATIONS_COUNT:' + (rows ? rows.length : 0));
      } catch (e) {
        console.log('ERROR:READ_MIGRATIONS_FAILED');
      }
    }

    // Check migration file presence
    const mf = path.join(process.cwd(), 'server', 'db', 'migrations', '0010_review_status_additive.sql');
    if (!fs.existsSync(mf)) {
      console.log('ERROR:MIGRATION_FILE_MISSING');
      await sql.end();
      process.exit(0);
    }
    console.log('MIGRATION_FILE_PRESENT');

    // If column missing, apply migration SQL directly (only to TEST DB)
    const colRes = await sql`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'material_prices' AND column_name = 'review_status'`;
    if (!colRes || colRes.length === 0) {
      const migrationSql = fs.readFileSync(mf, 'utf8');
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(migrationSql);
        });
        console.log('APPLIED_0010:SUCCESS');
      } catch (e) {
        console.log('APPLIED_0010:FAILED');
        console.log('ERROR_MSG');
        await sql.end();
        process.exit(0);
      }
      // Re-check column
      const col2 = await sql`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'material_prices' AND column_name = 'review_status'`;
      if (col2 && col2.length > 0) console.log('COLUMN_EXISTS_AFTER_APPLY');
      else console.log('COLUMN_STILL_MISSING_AFTER_APPLY');
    } else {
      console.log('NO_APPLY_NEEDED');
    }

    await sql.end();
  } catch (err) {
    console.log('ERROR:UNEXPECTED');
  }
})();
