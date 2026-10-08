/**
 * Phase 1 / Foundation — International base tests (ADDITIVE).
 *
 * Validates, WITHOUT a live database:
 *   1. upsertMaterialByCode persists tradeId when provided (SQL shape check on
 *      the Drizzle schema — the column exists and is wired into insert/update).
 *   2. commitValidRows forwards the resolved trade UUID (source-level check).
 *   3. Migration 0008 exists, is additive (no DROP/ALTER-destructive) and
 *      contains the safe trade_id backfill + Tunisia country-profile seed.
 *   4. The read-only /reference router exposes the 6 new endpoints.
 *
 * Run: npx tsx tests/phase1_international.test.ts
 */
import { ok as assertOk } from 'assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// NOTE: intentionally does NOT import './run' — that harness imports
// '../server' which boots a real dev server (port 3000). This file is a
// standalone, DB-free source/SQL-shape check.
function ok(value: any, message?: string) { assertOk(value, message); }

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; console.log(`  PASS ${name}`); }
  catch (err: any) { failed++; console.log(`  FAIL ${name}\n       ${err?.message || err}`); }
}

async function main() {
  console.log('\n── Phase 1 Foundation — International base ──');

  await test('schema/international.ts exports all 8 foundation tables', async () => {
    const src = readFileSync(join(process.cwd(), 'server/db/schema/international.ts'), 'utf8');
    for (const t of ['unitsOfMeasure', 'unitConversions', 'countries', 'currencies', 'fxRates',
                     'taxRules', 'materialIdentifiers', 'materialAttributes', 'importProvenance']) {
      ok(src.includes(`export const ${t} = pgTable`), `missing table export: ${t}`);
    }
  });

  await test('schema barrel re-exports international (additive)', async () => {
    const src = readFileSync(join(process.cwd(), 'server/db/schema/index.ts'), 'utf8');
    ok(src.includes("export * from './international'"), 'barrel missing international export');
  });

  await test('upsertMaterialByCode persists tradeId (insert + update paths)', async () => {
    const src = readFileSync(join(process.cwd(), 'server/repositories/drizzleMaterialRepository.ts'), 'utf8');
    ok(src.includes('tradeId?: string | null;'), 'upsert signature lacks tradeId');
    ok(src.includes('tradeId: data.tradeId ?? null'), 'insert path does not persist tradeId');
    ok(src.includes('data.tradeId !== undefined ? { tradeId: data.tradeId } : {}'), 'update path does not persist tradeId');
  });

  await test('commitValidRows forwards resolved trade UUID to the upsert', async () => {
    const src = readFileSync(join(process.cwd(), 'server/services/catalogImport.ts'), 'utf8');
    ok(src.includes('tradeId: tradeIdByCode.get(item.trade)'), 'import pipeline drops the resolved tradeId');
  });

  await test('migration 0008 is additive (no destructive statements)', async () => {
    const sql = readFileSync(join(process.cwd(), 'server/db/migrations/0008_international_foundation.sql'), 'utf8');
    ok(!/\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT)/i.test(sql), 'migration contains DROP statements');
    ok(!/ALTER\s+COLUMN[\s\S]*TYPE/i.test(sql.replace(/--[^\n]*/g, '')), 'migration alters a column type');
    ok(/ADD COLUMN IF NOT EXISTS "source_type"/.test(sql), 'materials.source_type missing');
    ok(/ADD COLUMN IF NOT EXISTS "source_import_id"/.test(sql), 'materials.source_import_id missing');
 ok(/INSERT INTO "trades"[\s\S]*ON CONFLICT \("code"\) DO NOTHING[\s\S]*UPDATE "materials" m[\s\S]*SET "trade_id" = t\."id"/.test(sql), 'safe trade_id backfill missing');
  });

  await test('migration 0008 seeds Tunisia as first country profile (data row)', async () => {
    const sql = readFileSync(join(process.cwd(), 'server/db/migrations/0008_international_foundation.sql'), 'utf8');
    ok(/INSERT INTO "countries"[\s\S]*'TN'/.test(sql), 'Tunisia country profile seed missing');
    ok(/ON CONFLICT \("code"\) DO NOTHING/.test(sql), 'country seed not idempotent');
  });

  await test('/reference router exposes the 6 read-only endpoints', async () => {
    const src = readFileSync(join(process.cwd(), 'server/routes/v1/reference.ts'), 'utf8');
    for (const p of ['/countries', '/currencies', '/fx-rates', '/tax-rules', '/units', '/unit-conversions']) {
      ok(src.includes(`'${p}'`), `reference endpoint missing: ${p}`);
    }
    const idx = readFileSync(join(process.cwd(), 'server/routes/v1/index.ts'), 'utf8');
    ok(idx.includes("router.use('/reference', referenceRouter)"), '/reference not mounted');
  });

  console.log(`\n RESULTS: ${passed} passed | ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('crashed:', e); process.exit(1); });
