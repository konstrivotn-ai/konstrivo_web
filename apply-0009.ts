import fs from "node:fs";
import postgres from "postgres";

// This manual migration helper is TEST-DB-only. It never falls back to DATABASE_URL.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required; refusing to run migration helper.");
}

const sql = postgres(testDatabaseUrl, { max: 1, prepare: false });
try {
  const migration = fs.readFileSync("server/db/migrations/0009_calc_rules_additive.sql", "utf8");
  await sql.begin(async (tx) => {
    await tx.unsafe(migration);
  });
  console.log("0009 applied to TEST DB");
} finally {
  await sql.end({ timeout: 5 });
}
