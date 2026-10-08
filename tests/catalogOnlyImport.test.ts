/**
 * CATALOG-ONLY IMPORT vs PRICED IMPORT — DB-free regression (no server, no DB).
 *
 * Two states of the Intelligent Import price contract:
 *   A) KONSTRIVO_MASTER_CATALOG_FINAL.csv (170 rows, NO price column)
 *      → catalogOnly=true: material_code/material_name/trade_code stay
 *        mandatory, price_ht optional FOR THIS FILE, price stays `undefined`
 *        (NEVER 0), legacy direct callers (no flag) unchanged.
 *   B) CSV WITH price_ht → the EXACT previous behaviour (parse / reject /
 *      ambiguity blocking / REQUIRED_FIELD_KEYS untouched).
 *
 * REAL-HTTP mirror (preview/import + material_prices on the TEST DB):
 * tests/catalogOnlyImportHttp.test.ts, wired into tests/runPhaseC.ts.
 *
 * Run: npx tsx tests/catalogOnlyImport.test.ts
 */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  PASS ${name}`);
  } catch (err: any) {
    failed++;
    const message = `  FAIL ${name}\n       ${err?.message || err}`;
    failures.push(message);
    console.log(message);
  }
}

const catalog = await import('../server/services/catalogImport');
const { parseCatalogCsv } = await import('../server/utils/csv');

const TN = { countryCode: 'TN', currencyCode: 'TND' };
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'catalog');

console.log('\n═══════════════════════════════════════════');
console.log(' CATALOG-ONLY IMPORT (no price_ht) vs PRICED');
console.log('═══════════════════════════════════════════\n');

// ════════════════════════════════════════════════════════════════════════════
// A) MASTER CATALOG WITHOUT price_ht — material-only import
// ════════════════════════════════════════════════════════════════════════════
const MASTER_FILE = 'KONSTRIVO_MASTER_CATALOG_FINAL.csv';
const masterRaw = fs.readFileSync(path.join(FIXTURES, MASTER_FILE), 'utf8');
const masterParsed = parseCatalogCsv(masterRaw);
const masterMapping = catalog.resolveMapping(masterParsed.headers, masterParsed.rows[0], null, masterParsed.rows);
// Mirrors EXACTLY what runImportPipeline feeds the normalizer for Phase C.
const masterRun = catalog.normalizeAndValidateRows(
  masterParsed.rows,
  masterMapping.appliedMapping,
  TN,
  undefined,
  masterMapping.nameFallbackHeaders,
  { catalogOnly: masterMapping.catalogOnly }
);

await test('A1. fixture: 170 data rows, mandatory columns present, NO price column', () => {
  assert.equal(masterParsed.rows.length, 170, `expected 170 data rows, got ${masterParsed.rows.length}`);
  const headers = masterParsed.headers.map((h: string) => h.toLowerCase());
  for (const must of ['material_code', 'material_name', 'trade_code', 'unit']) {
    assert.ok(headers.includes(must), `fixture must carry ${must}`);
  }
  assert.ok(!headers.some((h: string) => ['price_ht', 'price', 'prix', 'prix_ht'].includes(h)),
    'the Master Catalog fixture must NOT carry any price column');
});

await test('A2. resolveMapping flags the file catalogOnly (price optional for THIS file)', () => {
  assert.equal(masterMapping.catalogOnly, true, 'a file with no price-candidate column is catalog-only');
  assert.equal(masterMapping.appliedMapping.price_ht, undefined, 'no price column can be mapped');
  assert.equal(masterMapping.appliedMapping.material_code, 'material_code');
  assert.equal(masterMapping.appliedMapping.material_name, 'material_name');
  assert.equal(masterMapping.appliedMapping.trade_code, 'trade_code');
  // The service still PUBLISHES price_ht as an unmapped required field (truth);
  // only the ROUTES stop treating it as blocking for this file (HTTP suite).
  assert.ok(masterMapping.unmappedRequired.includes('price_ht'));
});

await test('A3. preview contract: 170 importables / 0 rejetées', () => {
  assert.equal(masterRun.failed.length, 0, JSON.stringify(masterRun.failed.slice(0, 3)));
  assert.equal(masterRun.valid.length, 170, `expected 170 valid rows, got ${masterRun.valid.length}`);
});

await test('A4. material-only: every row has NO price — 0 is never invented', () => {
  for (const row of masterRun.valid) {
    assert.equal(row.price, undefined, `row ${row.row} (${row.reference}) must carry no price, got ${row.price}`);
  }
  assert.ok(!masterRun.valid.some((r: any) => r.price === 0), 'no row may fall back to a 0 price');
});

await test('A5. legacy direct callers unchanged: without the flag the same file is still rejected per row', () => {
  const legacy = catalog.normalizeAndValidateRows(masterParsed.rows, masterMapping.appliedMapping, TN);
  assert.equal(legacy.valid.length, 0, 'the opt-in flag is required — old callers keep the old contract');
  assert.equal(legacy.failed.length, 170);
  assert.ok(/Prix HT non mappé/.test(legacy.failed[0].reason), legacy.failed[0].reason);
});

await test('A6. write path guards (source-level: no price write, no price snapshot for catalog-only)', () => {
  const svc = fs.readFileSync(path.join(process.cwd(), 'server', 'services', 'catalogImport.ts'), 'utf8');
  assert.ok(/if \(item\.price !== undefined\) await upsertOfficialPrice\(/.test(svc),
    'upsertOfficialPrice must be guarded by a real price');
  assert.ok(/countryCatalogReady && pricedRows\.length > 0/.test(svc),
    'country-catalog versioning must be gated on priced rows');
  assert.ok(/for \(const item of pricedRows\)/.test(svc), 'the snapshot must iterate priced rows only');
  const routes = fs.readFileSync(path.join(process.cwd(), 'server', 'routes', 'v1', 'catalog.ts'), 'utf8');
  const gates = routes.match(/k === 'price_ht' && run\.mapping\.catalogOnly/g) || [];
  assert.equal(gates.length, 3, `Phase A + preview + import must all gate on catalogOnly (found ${gates.length})`);
});

// ════════════════════════════════════════════════════════════════════════════
// B) CSV WITH price_ht — the EXACT previous behaviour
// ════════════════════════════════════════════════════════════════════════════
function runCsv(csv: string) {
  const parsed = parseCatalogCsv(csv);
  const mapping = catalog.resolveMapping(parsed.headers, parsed.rows[0], null, parsed.rows);
  const run = catalog.normalizeAndValidateRows(
    parsed.rows,
    mapping.appliedMapping,
    TN,
    undefined,
    mapping.nameFallbackHeaders,
    { catalogOnly: mapping.catalogOnly }
  );
  return { parsed, mapping, run };
}

const PRICED_CSV = [
  'material_code,material_name,trade_code,price_ht,category,unit',
  'BTEST-001,Plaque BA13,placo,31.5,planches,unit',
  'BTEST-002,Mortier colle,carrelage,12.5,colles,kg',
].join('\r\n');

await test('B1. file WITH price_ht → catalogOnly=false, price mapped and parsed (old behaviour)', () => {
  const { mapping, run } = runCsv(PRICED_CSV);
  assert.equal(mapping.catalogOnly, false, 'a file with a price column is NOT catalog-only');
  assert.equal(mapping.appliedMapping.price_ht, 'price_ht');
  assert.deepEqual(mapping.unmappedRequired, []);
  assert.equal(run.failed.length, 0, JSON.stringify(run.failed));
  assert.equal(run.valid.length, 2);
  assert.equal(run.valid[0].price, 31.5, 'the price is read, never skipped');
  assert.equal(run.valid[1].price, 12.5);
});

await test('B2. mapped price column + EMPTY cell → row rejected (never 0, never invented)', () => {
  const csv = [
    'material_code,material_name,trade_code,price_ht,category,unit',
    'BTEST-003,Mortier colle,carrelage,,colles,kg',
  ].join('\r\n');
  const { run } = runCsv(csv);
  assert.equal(run.valid.length, 0);
  assert.equal(run.failed.length, 1);
  assert.ok(/Prix vide/.test(run.failed[0].reason), run.failed[0].reason);
});

await test('B3. mapped price column + non-numeric cell → row rejected with Invalid price (old message)', () => {
  const csv = [
    'material_code,material_name,trade_code,price_ht,category,unit',
    'BTEST-004,Mortier colle,carrelage,abc,colles,kg',
  ].join('\r\n');
  const { run } = runCsv(csv);
  assert.equal(run.valid.length, 0);
  assert.equal(run.failed.length, 1);
  assert.ok(/Invalid price 'abc'/.test(run.failed[0].reason), run.failed[0].reason);
});


await test('B4. a file that HAS price columns but none resolvable → still blocks (catalogOnly=false)', () => {
  // Two equal price candidates → the engine refuses to choose (documented
  // ambiguity refusal): price_ht stays unmapped AND blocking, exactly as
  // before — catalog-only mode must never mask a price column that exists.
  const csv = [
    'material_code,material_name,trade_code,valeur_prix,prix_fournisseur,unit',
    'BTEST-005,Mortier colle,carrelage,12,13,kg',
  ].join('\r\n');
  const { mapping, run } = runCsv(csv);
  assert.equal(mapping.catalogOnly, false, 'price candidates exist → not catalog-only');
  assert.equal(mapping.appliedMapping.price_ht, undefined, 'ambiguity refusal unchanged');
  assert.ok(mapping.unmappedRequired.includes('price_ht'), 'price_ht still reported as unmapped');
  assert.equal(run.valid.length, 0, 'every row still rejected for the unmapped price');
  assert.ok(/Prix HT non mappé/.test(run.failed[0].reason), run.failed[0].reason);
});

await test('B5. the registry is untouched: price_ht is still declared required', () => {
  assert.deepEqual(
    catalog.REQUIRED_FIELD_KEYS,
    ['material_code', 'material_name', 'trade_code', 'price_ht'],
    'REQUIRED_FIELD_KEYS must not change — only the ROUTES relax it for catalog-only files'
  );
});

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(45)}`);
console.log(` RESULTS: ${passed} passed | ${failed} failed`);
console.log(`${'═'.repeat(45)}\n`);
if (failures.length > 0) {
  console.log('FAILED TESTS:');
  failures.forEach((f) => console.log(f));
  console.log('');
}
process.exit(failed > 0 ? 1 : 0);

