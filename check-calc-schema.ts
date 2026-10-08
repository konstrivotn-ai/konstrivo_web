import { getDatabase } from "./server/db/client";
import { sql } from "drizzle-orm";

const db = await getDatabase();
if (!db) throw new Error("DB unavailable");

const result = await db.execute(sql`
  SELECT column_name
  FROM information_schema.columns
  WHERE table_name = 'calc_rules'
  ORDER BY ordinal_position
`);

console.log(result);
process.exit(0);
