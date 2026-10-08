/**
 * PHASE 1 — Country Catalog + CSV Import tests (ADDITIVE, DB-free).
 *
 * Validates, WITHOUT touching any database:
 *   1. catalogContentHash — Country + content identity (NOT filename):
 *      deterministic, order-insensitive, sensitive to price/unit/trade/
 *      category/currency/country changes.
 *   2. Migrations 0011/0012/0013 exist, are additive (no DROP / no
 *      ALTER COLUMN TYPE) and fully idempotent (IF NOT EXISTS everywhere,
 *      seeds ON CONFLICT DO NOTHING).
 *   3. Schema modules export the 3 new tables; barrel re-exports them.
 *   4. commitValidRows versioning (source-level): Country+hash identity,
 *      filename stored as metadata ONLY, idempotent replay short-circuits
 *      ALL writes, snapshot keeps trade and category SEPARATE, item insert
 *      is conflict-safe (no duplicates), history kept (no DELETE).
 *   5. Read-only endpoints /reference/catalog-active + /reference/calc-rules
 *      exist; sourceRef is plumbed through both import routes.
 *
 * Run: npx tsx tests/phase1_country_catalog.test.ts
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function ok(value: any, message?: string) { assert.ok(value, message); }
let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; console.log(`  PASS ${name}`); }
  catch (err: any) { failed++; console.log(`  FAIL ${name}\n       ${err?.message || err}`); }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

async function main() {
  console.log('\n── PHASE 1 — Country Catalog + CSV Import ──');

  await test('catalogContentHash: content change → different hash (price/unit/trade/category)', async () => {
    const { catalogContentHash } = await import('../server/services/countryCatalogService');
    const base = [{ reference: 'AL001', price: 90.5, unit: 'unit', trade: 'aluminium', category: 'Menuiserie Aluminium' }];
    const h0 = catalogContentHash(base, 'TND', 'TN');
    ok(catalogContentHash([{ ...base[0], price: 91 }], 'TND', 'TN') !== h0, 'price change must change identity');
    ok(catalogContentHash([{ ...base[0], unit: 'ml' }], 'TND', 'TN') !== h0, 'unit change must change identity');
    ok(catalogContentHash([{ ...base[0], trade: 'menuiserie' }], 'TND', 'TN') !== h0, 'trade change must change identity');
    ok(catalogContentHash([{ ...base[0], category: 'Fenêtres' }], 'TND', 'TN') !== h0, 'category change must change identity');
  });

  await test('catalogContentHash: Country/Currency are part of the identity (isolation)', async () => {
    const { catalogContentHash } = await import('../server/services/countryCatalogService');
    const rows = [{ reference: 'HV001', price: 2450, unit: 'unit', trade: 'hvac', category: 'Chauffage' }];
    const tn = catalogContentHash(rows, 'TND', 'TN');
    ok(catalogContentHash(rows, 'TND', 'FR') !== tn, 'same rows in another country = different catalog identity');
    ok(catalogContentHash(rows, 'EUR', 'TN') !== tn, 'same rows in another currency = different catalog identity');
  });

  await test('migrations 0011/0012/0013 are additive and idempotent', async () => {
    for (const f of ['server/db/migrations/0011_country_catalog.sql', 'server/db/migrations/0012_country_catalog_items.sql', 'server/db/migrations/0013_country_rules_seed.sql']) {
      const sql = read(f);
      ok(!/\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT)/i.test(sql), `${f} contains DROP`);
      ok(!/ALTER\s+COLUMN[\s\S]*TYPE/i.test(sql.replace(/--[^\n]*/g, '')), `${f} alters a column type`);
      ok(!/TRUNCATE|DELETE\s+FROM/i.test(sql.replace(/--[^\n]*/g, '')), `${f} contains destructive DML`);
    }
    ok(/CREATE TABLE IF NOT EXISTS "country_catalogs"/.test(read('server/db/migrations/0011_country_catalog.sql')), '0011 missing catalogs table');
    const m12 = read('server/db/migrations/0012_country_catalog_items.sql');
    ok(/CREATE TABLE IF NOT EXISTS "country_catalog_items"/.test(m12), '0012 missing items table');
    ok(/CREATE TABLE IF NOT EXISTS "country_calculation_rules"/.test(m12), '0012 missing rules table');
    ok(/ON CONFLICT DO NOTHING/i.test(read('server/db/migrations/0013_country_rules_seed.sql')), '0013 seed not idempotent');
    ok(/EXCEPTION WHEN duplicate_object/.test(m12), '0012 FK constraint not guarded for re-run');
  });


  await test('catalogContentHash: deterministic + order-insensitive (idempotent re-upload)', async () => {
    const { catalogContentHash } = await import('../server/services/countryCatalogService');
    const a = [
      { reference: 'AL002', price: 120, unit: 'ml', trade: 'aluminium', category: 'Menuiserie Aluminium' },
      { reference: 'AL001', price: 90.5, unit: 'unit', trade: 'aluminium', category: 'Menuiserie Aluminium' },
    ];
    const b = [...a].reverse();
    assert.equal(catalogContentHash(a, 'TND', 'TN'), catalogContentHash(b, 'TND', 'TN'));
    assert.equal(catalogContentHash(a, 'TND', 'TN'), catalogContentHash(JSON.parse(JSON.stringify(a)), 'TND', 'TN'));
  });

  await test('schema modules export the 3 new tables; barrel re-exports them', async () => {
    const c1 = read('server/db/schema/countryCatalog.ts');
    const c2 = read('server/db/schema/countryCatalogItems.ts');
    ok(/export const countryCatalogs = pgTable\('country_catalogs'/.test(c1), 'countryCatalogs missing');
    ok(/export const countryCatalogItems = pgTable\('country_catalog_items'/.test(c2), 'countryCatalogItems missing');
    ok(/export const countryCalculationRules = pgTable\('country_calculation_rules'/.test(c2), 'countryCalculationRules missing');
    ok(/uq_country_catalog_item/.test(c2), 'unique (catalog_id, material_code) missing — duplicate protection');
    const barrel = read('server/db/schema/index.ts');
    ok(barrel.includes("export * from './countryCatalog'") && barrel.includes("export * from './countryCatalogItems'"), 'barrel missing re-export');
  });

  await test('commitValidRows: Country+hash identity, filename metadata only (source-level)', async () => {
    const src = read('server/services/catalogImport.ts');
    ok(src.includes("import { catalogContentHash, normalizeCountryCode } from './countryCatalogService'"), 'commit does not use content-hash identity');
    ok(/catalogContentHash\(/.test(src), 'content hash never computed');
    ok(/opts\?\.fileName \|\| null/.test(src), 'fileName must be stored as metadata only');
    ok(!/fileSha256\s*=\s*fileName/i.test(src), 'filename must never be the identity');
  });

  await test('commitValidRows: idempotent replay short-circuits ALL writes', async () => {
    const src = read('server/services/catalogImport.ts');
    ok(/active\.contentSha256 === contentHash/.test(src), 'replay gate missing');
    ok(/idempotentReplay: true/.test(src), 'replay flag missing');
    ok(/if \(catalogInfo\.idempotentReplay\) break;/.test(src), 'replay must skip material/price upserts');
    ok(/onConflictDoNothing\(\{ target: \[ci\.countryCatalogItems\.catalogId, ci\.countryCatalogItems\.materialCode\] \}\)/.test(src), 'item insert not conflict-safe');
  });

  await test('commitValidRows: trade and category stored SEPARATELY in the snapshot', async () => {
    const src = read('server/services/catalogImport.ts');
    ok(/trade: item\.trade, tradeLabel: item\.tradeLabel \|\| null,/.test(src), 'trade column not stored verbatim');
    ok(/category: item\.category \|\| item\.trade,/.test(src), 'category column missing');
    ok(/materialCode: item\.reference, materialName: item\.nameFr,/.test(src), 'material identity columns missing');
  });

  await test('history preserved: version deactivation is an UPDATE, never a DELETE', async () => {
    const src = read('server/services/catalogImport.ts');
    ok(/set\(\{ isActive: false, updatedAt: new Date\(\) \}\)/.test(src), 'previous versions not deactivated');
    ok(!/delete\(cc\.countryCatalogs\)/.test(src), 'catalog versions must never be hard-deleted');
    ok(!/delete\(ci\.countryCatalogItems\)/.test(src), 'catalog items must never be hard-deleted');
    ok(/ne2\(cc\.countryCatalogs\.id, catalogRow\.id\)/.test(src), 'new version must stay active (self-exclusion missing)');
  });

  await test('read-only country endpoints + sourceRef plumb-through exist', async () => {
    const ref = read('server/routes/v1/reference.ts');
    ok(ref.includes("referenceRouter.get('/catalog-active'"), '/reference/catalog-active missing');
    ok(ref.includes("referenceRouter.get('/calc-rules'"), '/reference/calc-rules missing');
    const cat = read('server/routes/v1/catalog.ts');
    ok(cat.includes('run.upload.sourceRef'), 'sourceRef not passed to commit (import route)');
    ok(/sourceRef\?: string;/.test(cat), 'ExtractedUpload.sourceRef missing');
  });

  await test('calculator rule resolver: DB rows first, static TN fallback (no if-country code branches)', async () => {
    const svc = read('server/services/countryCatalogService.ts');
    ok(/export async function getCountryCalcRules/.test(svc), 'getCountryCalcRules missing');
    ok(/default_tva/.test(svc), 'static fallback missing');
    const calc = read('src/utils/calculations.ts');
    ok(!/countryCode\s*===\s*'(FR|DZ|SA|AE|US)'/.test(calc), 'calculations.ts must not hardcode per-country branches');
  });

  await test('migration 0014: scoped repair — dedup seed rows only, NULLS NOT DISTINCT index', async () => {
    const sql = read('server/db/migrations/0014_country_rules_idempotent.sql');
    // The ONLY permitted DROP is the self-created rules index, recreated below.
    const drops = sql.match(/\bDROP\s+INDEX\s+(IF\s+EXISTS\s+)?"[^"]+"/gi) || [];
    ok(drops.length === 1 && /"uq_country_calc_rule"/i.test(drops[0]), '0014 must drop ONLY uq_country_calc_rule');
    ok(!/\bDROP\s+(TABLE|COLUMN|CONSTRAINT)/i.test(sql), '0014 must not drop tables/columns/constraints');
    ok(/DELETE FROM "country_calculation_rules" a\s+USING "country_calculation_rules" b/i.test(sql), '0014 dedup must be scoped to the rules table only');
    ok(/NULLS NOT DISTINCT/.test(sql), '0014 must recreate the index NULLS NOT DISTINCT');
    ok(!/DELETE FROM "(?!country_calculation_rules)/i.test(sql), '0014 must not delete from any other table');
    // 0012 (fresh installs) must create the index NULLS NOT DISTINCT directly.
    ok(/uq_country_calc_rule[^;]*NULLS NOT DISTINCT/i.test(read('server/db/migrations/0012_country_catalog_items.sql')), '0012 index must be NULLS NOT DISTINCT for fresh installs');
  });

  console.log(`\n RESULTS: ${passed} passed | ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('crashed:', e); process.exit(1); });

