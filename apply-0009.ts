import fs from "fs";
import { Client } from "pg";

const c = new Client({ connectionString: process.env.TEST_DATABASE_URL });
await c.connect();
try {
  await c.query("BEGIN");
  await c.query(fs.readFileSync("server/db/migrations/0009_calc_rules_additive.sql", "utf8"));
  await c.query("COMMIT");
  console.log("0009 applied to TEST DB");
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  await c.end();
}
