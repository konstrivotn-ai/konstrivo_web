const postgres = require('postgres');
(async () => {
  const url = process.env.DATABASE_URL;
  if (!process.env.TEST_DATABASE_URL) {
    console.log('TEST_DB_MISSING');
    process.exit(0);
  }
  if (!url) {
    console.log('DATABASE_URL_NOT_SET');
    process.exit(0);
  }
  try {
    const sql = postgres(url, { max: 1, timeout: 10000 });
    const rows = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='material_prices' AND column_name='review_status'`;
    if (rows && rows.length > 0) console.log('MIGRATION_0010_APPLIED');
    else console.log('MIGRATION_0010_NOT_APPLIED');
    await sql.end();
  } catch (err) {
    console.log('DB_UNREACHABLE');
  }
})();
