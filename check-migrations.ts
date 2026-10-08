import { getDatabase } from "./server/db/client";
import { sql } from "drizzle-orm";

const db = await getDatabase();
if (!db) throw new Error("DB unavailable");

const result = await db.execute(sql`
  SELECT *
  FROM drizzle.__drizzle_migrations
  ORDER BY created_at
`);

console.log(result);
process.exit(0);
