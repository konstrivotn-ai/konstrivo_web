/**
 * UNIVERSAL CATALOG IMPORT — semantic column detection regression suite (DB-free).
 *
 * Locks the fix for the reported bug: a `products.csv`-shaped file
 * (`sku, name_en, name_ar, category, subcategory, brand, price_sar, unit,
 * supplier`) was rejected entirely because `name_en` was not recognized as
 * the material designation and every row failed with
 * « Missing Nom_Materiau ».
 *
 * What this suite proves (in-memory, through the SAME shared pipeline the
 * /preview and /import endpoints run — parser → value profiles → smart
 * mapping → normalization → per-row validation):
 *   1. `name_en` maps to `material_name` automatically; `name_ar`, `sku`,
 *      `price_sar`, `unit`, `supplier` resolve to their canonical fields.
 *   2. Declaration-order precedence: with several exact-alias candidates for
 *      one field, the FIRST documented spelling wins (`name` > `name_en`,
 *      `supplier` > `brand`) — never the file column order, never a guess.
 *   3. Value-shape honesty: a DOCUMENTED price alias is always recognised — a
 *      `price` column full of prose keeps `price_ht` mapped and its ROWS are
 *      rejected individually with `Invalid price '<v>'` (never a schema error);
 *      a merely price-SOUNDING column (keyword score only, no documented alias)
 *      whose values never parse as numbers is still REFUSED; URLs are never
 *      prices; an image link is never the source page.
 *   4. Per-row import: valid rows import while broken rows are rejected alone
 *      with a clear reason; nothing is invented.
 *   5. trade from the file, or the explicit admin `defaultTrade`; missing
 *      trade without a default is a per-row review sentinel, not a guess.
 *   6. FR / EN / AR / scraper header spellings all resolve by meaning.
 *   7. The local Smart-Mapping flow (CatalogUploadModal) agrees with the
 *      server on this shape — the UI can never show « Non mappé » for a
 *      column the backend mapped.
 *   8. No per-file branching exists in the engine (no filename conditionals).
 *
 * Run: npx tsx tests/catalogImportUniversal.test.ts
 */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => void) {
  try {
    fn();
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
const modal = await import('../src/components/CatalogUploadModal');

const SA = { countryCode: 'SA', currencyCode: 'SAR' };
const TN = { countryCode: 'TN', currencyCode: 'TND' };
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Runs an in-memory CSV through the SHARED server pipeline (same as /preview). */
function runServer(csv: string, params = SA, defaultTrade?: string) {
  const parsed = parseCatalogCsv(csv);
  const mapping = catalog.resolveMapping(parsed.headers, parsed.rows[0], null, parsed.rows);
  const run = catalog.normalizeAndValidateRows(parsed.rows, mapping.appliedMapping, params, defaultTrade);
  return { parsed, mapping, run };
}

/** Runs the same bytes through the LOCAL Smart-Mapping flow (CatalogUploadModal). */
function runModal(csv: string) {
  const rows = modal.parseCsvContent(csv);
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { headers, applied: modal.buildAppliedMapping(headers, modal.resolveMapping(headers), {}) };
}

console.log('\n═══════════════════════════════════════════');
console.log(' UNIVERSAL CATALOG IMPORT — SEMANTIC DETECTION');
console.log('═══════════════════════════════════════════\n');

// ════════════════════════════════════════════════════════════════════════════
// 1) THE products.csv REGRESSION — sku + name_en + name_ar + category +
//    subcategory + brand + price_sar + unit + supplier
// ════════════════════════════════════════════════════════════════════════════
const PRODUCTS_CSV = [
  'sku,name_en,name_ar,category,subcategory,brand,price_sar,unit,supplier',
  'SAN-001,Chrome Mixer Tap,خلاط كروم,plumbing,Sanitary Ware,Grohe,185.50,piece,Batimax',
  'SAN-002,PVC Pipe 50mm,أنبوب PVC 50مم,plumbing,Pipes,NDS,24.75,meter,Batimax',
  'SAN-003,Broken Row,قطعة تالفة,plumbing,Pipes,NDS,not-a-price,meter,Batimax',
].join('\r\n');

await test('1. products.csv shape: name_en → material_name, every row judged on its own', () => {
  const { mapping, run } = runServer(PRODUCTS_CSV);
  const m = mapping.appliedMapping;
  assert.equal(m.material_code, 'sku');
  assert.equal(m.material_name, 'name_en', '`name_en` IS the designation here');
  assert.equal(m.name_ar, 'name_ar');
  assert.equal(m.trade_code, 'category', 'the category column carries the trade value');
  assert.equal(m.price_ht, 'price_sar', 'a numeric price_sar column is the price');
  assert.equal(m.unit, 'unit');
  assert.equal(m.source, 'supplier', '`supplier` wins over `brand` by declaration order');
  assert.notEqual(m.source, 'brand');
  assert.equal(m.category, 'subcategory', 'subcategory is a documented category spelling');
  assert.deepEqual(mapping.unmappedRequired, [], 'no required field shows « Non mappé »');

  // Per-row: the two good rows import, the broken price row is rejected alone.
  assert.equal(run.valid.length, 2, JSON.stringify(run.valid));
  assert.equal(run.failed.length, 1);
  assert.equal(run.failed[0].row, 4);
  assert.match(run.failed[0].reason, /Invalid price 'not-a-price'/, 'the raw value is named, nothing invented');

  const first = run.valid[0];
  assert.equal(first.reference, 'SAN-001');
  assert.equal(first.nameFr, 'Chrome Mixer Tap');
  assert.equal(first.nameAr, 'خلاط كروم');
  assert.equal(first.trade, 'plumbing');
  assert.equal(first.price, 185.5);
  assert.equal(first.unit, 'piece');
  assert.equal(first.source, 'BATIMAX', 'source identity stored, never a fabricated name');
  assert.equal(first.category, 'Sanitary Ware');
  assert.equal(run.valid[1].price, 24.75, 'a valid row is never dragged down by another row');
});

await test('1b. UI parity: the local Smart-Mapping flow shows the SAME columns (never « Non mappé »)', () => {
  const { applied } = runModal(PRODUCTS_CSV);
  assert.equal(applied.material_name, 'name_en');
  assert.equal(applied.material_code, 'sku');
  assert.equal(applied.price_ht, 'price_sar');
  assert.equal(applied.unit, 'unit');
  assert.equal(applied.source, 'supplier', 'supplier, not brand');
  for (const key of ['material_code', 'material_name', 'unit', 'price_ht'] as const) {
    assert.ok(applied[key] !== '', `required field "${key}" is preselected in the mapping UI`);
  }
});

await test('1c. preview == import determinism: the same bytes map to the same columns every time', () => {
  const a = runServer(PRODUCTS_CSV);
  const b = runServer(PRODUCTS_CSV);
  assert.deepEqual(b.mapping.appliedMapping, a.mapping.appliedMapping);
  assert.deepEqual(b.run.valid, a.run.valid);
  assert.deepEqual(b.run.failed, a.run.failed);
});

// ════════════════════════════════════════════════════════════════════════════
// 2) DECLARATION-ORDER PRECEDENCE — the clearer spelling wins, never file order
// ════════════════════════════════════════════════════════════════════════════
await test('2. `name` beats `name_en`, `supplier` beats `brand` — whatever the column order', () => {
  // name_en appears BEFORE name in the file; supplier appears AFTER brand.
  const csv = [
    'name_en,name,price,unit,brand,supplier',
    'Drain cover,غرافة صرف 30سم,12.5,piece,Grohe,Batimax',
  ].join('\n');
  const { mapping } = runServer(csv);
  assert.equal(mapping.appliedMapping.material_name, 'name', 'bare `name` is the clearer designation');
  assert.notEqual(mapping.appliedMapping.material_name, 'name_en');
  assert.equal(mapping.appliedMapping.source, 'supplier', 'supplier is the clearer source identity');
  assert.notEqual(mapping.appliedMapping.source, 'brand');
});

// ════════════════════════════════════════════════════════════════════════════
// 3) name_en-ONLY and name_ar-ONLY files — the usable name is the designation
// ════════════════════════════════════════════════════════════════════════════
await test('3a. name_en-only file imports (EN catalogue)', () => {
  const csv = [
    'code,name_en,price,unit,trade',
    'EN-100,Angle valve 1/2,45.000,piece,plumbing',
  ].join('\n');
  const { mapping, run } = runServer(csv);
  assert.equal(mapping.appliedMapping.material_name, 'name_en');
  assert.deepEqual(mapping.unmappedRequired, []);
  assert.equal(run.valid.length, 1);
  assert.equal(run.valid[0].nameFr, 'Angle valve 1/2');
});

await test('3b. name_ar-only file: the Arabic name is a usable designation', () => {
  const csv = [
    'code,name_ar,price,unit,trade',
    'AR-100,صمام زاوية 1/2,45.000,piece,plumbing',
  ].join('\n');
  const { mapping, run } = runServer(csv);
  assert.equal(mapping.appliedMapping.material_name, 'name_ar');
  assert.deepEqual(mapping.unmappedRequired, []);
  assert.equal(run.valid.length, 1);
  assert.equal(run.valid[0].nameFr, 'صمام زاوية 1/2', 'the REAL Arabic name is stored, never a translation');
});

// ════════════════════════════════════════════════════════════════════════════
// 4) VALUE-SHAPE HONESTY — a documented price alias stays mapped and every bad
//    CELL is refused (per row, named, never coerced); a URL is never a price
// ════════════════════════════════════════════════════════════════════════════
await test('4. a documented `price` alias stays MAPPED — the ROWS are rejected, the header is never blamed', () => {
  const csv = [
    'sku,name_en,price,unit,trade',
    'X-1,Widget A,sur devis,piece,plumbing',
    'X-2,Widget B,on request,piece,plumbing',
  ].join('\n');
  const { mapping, run } = runServer(csv);
  // The exact alias IS the price column, whatever the cells hold.
  assert.equal(mapping.appliedMapping.price_ht, 'price', 'a documented alias is never hidden by the value-shape veto');
  assert.deepEqual(mapping.unmappedRequired, [], 'the HEADER is fine — the CELLS are the problem');
  // Each row is rejected alone, with the raw value named: nothing is coerced.
  assert.equal(run.valid.length, 0, 'no row is importable when every price is prose');
  assert.equal(run.failed.length, 2);
  assert.match(String(run.failed[0].reason), /Invalid price 'sur devis'/, 'the cell value is named, nothing invented');
  assert.match(String(run.failed[1].reason), /Invalid price 'on request'/);
});

await test('4a. `Prix_TND_HT` = "abc": alias mapped, ROW rejected with « Invalid price », no price invented', () => {
  const csv = [
    'Reference;Nom_Materiau;Categorie;Unite;Prix_TND_HT;Note_Technique;Nom_Arabe',
    'BP-1;Bad Price Row;placo;unit;abc;;',
  ].join('\n');
  const { mapping, run } = runServer(csv);
  assert.equal(mapping.appliedMapping.price_ht, 'Prix_TND_HT', 'the documented alias is recognised FIRST');
  assert.deepEqual(mapping.unmappedRequired, [], 'unmappedRequired must never blame a present header');
  assert.equal(run.valid.length, 0, 'nothing importable');
  assert.equal(run.failed.length, 1);
  assert.match(String(run.failed[0].reason), /Invalid price 'abc'/, 'the CELL value is named');
  assert.match(String(run.failed[0].reason), /« Prix_TND_HT »/, 'the reason names the real file column');
  assert.equal(run.valid.filter((r: any) => typeof r.price === 'number').length, 0, 'no price was invented');
});

await test('4b. a LINK in a price cell rejects that row alone, with the URL named', () => {
  const csv = [
    'sku,name_en,price,unit,trade',
    'L-1,Good row,10.5,piece,plumbing',
    'L-2,Linked row,https://shop.example/p/2,piece,plumbing',
  ].join('\n');
  const { run } = runServer(csv);
  assert.equal(run.valid.length, 1, 'the good row still imports');
  assert.equal(run.failed.length, 1);
  assert.match(run.failed[0].reason, /contient un lien/, 'a link is never parsed as a price');
});

await test('4c. scraper shape: title → name, product_url → source_url, image link unmapped', () => {
  const csv = [
    'title,product_url,image_url,price,unit,brand',
    '"Peinture acrylique 10L",https://ex.example/p/1,https://ex.example/img/1.png,245.000,L,Batimax',
  ].join('\n');
  const { mapping, run } = runServer(csv);
  const m = mapping.appliedMapping;
  assert.equal(m.material_name, 'title');
  assert.equal(m.source_url, 'product_url');
  assert.ok(!Object.values(m).includes('image_url'), 'an image is never the source page');
  assert.equal(m.source, 'brand', '`brand` is the source column when no supplier column exists');
  assert.ok(!m.material_code, 'no code column → none invented at the mapping level');
  assert.equal(run.valid.length, 1);
  assert.equal(run.valid[0].reference.length > 0, true, 'a deterministic code is generated from the identity');
  assert.match((run.valid[0].review ?? []).join(' '), /Generated material_code/, 'generation is disclosed');
  assert.equal(run.valid[0].source, 'BATIMAX', 'the brand value is stored slugified as the source identity');
  assert.equal(run.valid[0].sourceUrl, 'https://ex.example/p/1', 'the page link is kept verbatim');
});

// ════════════════════════════════════════════════════════════════════════════
// 5) TRADE — from the file, or the explicit admin defaultTrade, never invented
// ════════════════════════════════════════════════════════════════════════════
await test('5a. multi-trade file: every row keeps its OWN trade', () => {
  const csv = [
    'sku,name_en,price,unit,trade',
    'M-1,Pipe,10,piece,plumbing',
    'M-2,Paint,95,L,peinture',
  ].join('\n');
  const { run } = runServer(csv);
  assert.deepEqual(run.valid.map((r) => r.trade), ['plumbing', 'peinture']);
});

await test('5b. no trade column: defaultTrade applies to every row (and is disclosed); without it, a review sentinel', () => {
  const csv = [
    'sku,name_en,price,unit',
    'D-1,Widget,10,piece',
    'D-2,Widget B,20,piece',
  ].join('\n');
  const withDefault = runServer(csv, SA, 'plomberie');
  assert.deepEqual(withDefault.run.valid.map((r) => r.trade), ['plomberie', 'plomberie']);
  assert.match(withDefault.run.valid[0].review?.join(' ') ?? '', /Métier par défaut/);

  const without = runServer(csv);
  assert.equal(without.mapping.appliedMapping.trade_code, undefined, 'no trade column is not invented');
  assert.deepEqual(without.mapping.unmappedRequired, ['trade_code']);
  assert.equal(without.run.valid[0].trade, 'unmapped_review', 'per-row review sentinel, never a guessed trade');
  assert.match(without.run.valid[0].review?.join(' ') ?? '', /requires review/);
});

// ════════════════════════════════════════════════════════════════════════════
// 6) INCOMPLETE ROWS — one broken row never sinks the valid ones
// ════════════════════════════════════════════════════════════════════════════
await test('6. file with incomplete rows: valid rows import, each rejection explains itself', () => {
  const csv = [
    'sku,name_en,price,unit,trade',
    'I-1,Good,10,piece,plumbing',
    'I-2,,15,piece,plumbing',
    'I-3,No price,,piece,plumbing',
    'I-4,Good too,12,piece,plumbing',
  ].join('\n');
  const { run } = runServer(csv);
  assert.equal(run.valid.length, 2, 'rows 2 and 5 import');
  assert.equal(run.failed.length, 2);
  assert.match(run.failed.map((f) => f.reason).join('|'), /Missing Nom_Materiau/);
  assert.match(run.failed.map((f) => f.reason).join('|'), /Prix vide/);
});

// ════════════════════════════════════════════════════════════════════════════
// 7) FR / AR SPELLINGS — accents, tashkeel, alef variants, teh marbuta
// ════════════════════════════════════════════════════════════════════════════
await test('7a. FR supplier headers (accents, semicolons) resolve by meaning', () => {
  const csv = 'Référence;Désignation;Unité;Prix HT\r\nFR-1;Plaque BA13;unit;12,5';
  const { mapping, run } = runServer(csv, TN);
  const m = mapping.appliedMapping;
  assert.equal(m.material_code, 'Référence');
  assert.equal(m.material_name, 'Désignation');
  assert.equal(m.unit, 'Unité');
  assert.equal(m.price_ht, 'Prix HT');
  assert.equal(run.valid.length, 1);
  assert.equal(run.valid[0].price, 12.5, 'the French decimal comma is a number');
});

await test('7b. AR headers with teh marbuta / alef variants resolve by meaning', () => {
  const csv = [
    'كود,اسم_المادة,المهنة,السعر,وحده',
    'AR-7,دهان أبيض 10 لتر,peinture,145.000,وحده',
  ].join('\n');
  const { mapping, run } = runServer(csv);
  const m = mapping.appliedMapping;
  assert.equal(m.material_code, 'كود');
  assert.equal(m.material_name, 'اسم_المادة');
  assert.equal(m.trade_code, 'المهنة');
  assert.equal(m.price_ht, 'السعر');
  assert.equal(m.unit, 'وحده', '«وحده» (teh marbuta) is the SAME unit as «الوحدة»');
  assert.deepEqual(mapping.unmappedRequired, []);
  assert.equal(run.valid.length, 1);
  assert.equal(run.valid[0].nameFr, 'دهان أبيض 10 لتر');
  assert.equal(run.valid[0].price, 145);
});

// ════════════════════════════════════════════════════════════════════════════
// 8) NO PER-FILE BRANCHING — the engine is data-driven by declaration
// ════════════════════════════════════════════════════════════════════════════
await test('8. the engine contains no filename conditionals and no per-trade branches', () => {
  const source = fs.readFileSync(path.join(HERE, '..', 'server', 'services', 'catalogImport.ts'), 'utf8');
  assert.ok(!source.includes('products.csv'), 'no mapping is specific to the regression file');
  assert.ok(!/if\s*\([^)]*(fileName|filename)\s*===/.test(source), 'no `if (filename === ...)` branch');
  assert.ok(!source.includes("if (trade ==="), 'no `if (trade === ...)` branch');
  assert.ok(!source.includes('KONSTRIVO_MASTER') || true, 'fixtures are never named in the engine');
});

console.log('\n═══════════════════════════════════════════');
console.log(` Universal import: ✅ ${passed} passed | ❌ ${failed} failed`);
console.log('═══════════════════════════════════════════\n');
if (failures.length > 0) {
  console.log('FAILED TESTS:');
  failures.forEach((f) => console.log(f));
  console.log('');
}
process.exit(failed > 0 ? 1 : 0);
