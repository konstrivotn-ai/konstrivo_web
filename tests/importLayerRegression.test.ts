/**
 * IMPORT LAYER REGRESSION — DB-free (no server, no database).
 *
 * Locks the LIMITED 2026-10-02 import-layer fix, in both pipelines:
 *   - Normal       = Global Catalog import (server/services/globalCatalogImport.ts)
 *   - Intelligent  = canonical material import (server/services/catalogImport.ts)
 *
 * Scenarios (11):
 *   1. Global Catalog v2 file → Intelligent Import (v2 columns resolve)
 *   2. `identifier_value` → `material_code` (exact alias, auto-suggested)
 *   3. empty `identifier_value` → existing generateMaterialCode contract only
 *   4. Normal: country='' + available='' → NO availability validation error
 *   5. Normal: country='TN' + available='' → NO error, available NOT invented;
 *      a PROVIDED-but-invalid value with a country is still rejected
 *   6. empty price → row rejected with the exact reason (no 0, no average)
 *   7. TTC price kept VERBATIM (NO conversion); `price_tax_status` never maps to `status`
 *   8. unmapped trade → `unmapped_review` sentinel, rows stay importable
 *   9. canonical schema → all 13 canonical columns map in Intelligent
 *  10. Normal import accepts canonical columns (material_name/material_code/market)
 *  11. Intelligent import still enforces its required fields
 *
 * NOTHING here writes to any database, converts a price, or invents a value.
 *
 * Run: npx tsx tests/importLayerRegression.test.ts
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
const normal = await import('../server/services/globalCatalogImport');
const { visibleUnmappedRequired, buildImportBlockReason } = await import('../src/lib/importPreview');

const TN = { countryCode: 'TN', currencyCode: 'TND' };
const buf = (s: string): Buffer => Buffer.from(s, 'utf8');

/** Resolve + normalize an Intelligent-Import CSV (same pipeline as /preview). */
function runIntelligent(csv: string, defaultTrade?: string) {
  const parsed = parseCatalogCsv(csv);
  const mapping = catalog.resolveMapping(parsed.headers, parsed.rows[0], null, parsed.rows);
  const run = catalog.normalizeAndValidateRows(parsed.rows, mapping.appliedMapping, TN, defaultTrade, mapping.nameFallbackHeaders);
  return { parsed, mapping, run };
}

/** Roles by source column for `columnAssignments` assertions. */
function roles(mapping: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of mapping.columnAssignments) out[a.source] = a.role;
  return out;
}

console.log('\n═════════════════════════════════════════════');
console.log(' IMPORT LAYER REGRESSION (Normal + Intelligent)');
console.log('═════════════════════════════════════════════\n');

// ════════════════════════════════════════════════════════════════════════════
// Global Catalog v2 file shape (as produced by KONSTRIVO Catalog Collector)
// ════════════════════════════════════════════════════════════════════════════
const V2_HEADER = [
  'name', 'identifier_type', 'identifier_value', 'category', 'subcategory', 'unit',
  'brand', 'manufacturer', 'description', 'available', 'country', 'price',
  'currency', 'price_tax_status', 'vat_rate', 'source', 'source_url', 'observed_at',
];
const v2Row = (o: Record<string, string>): string => V2_HEADER.map((h) => o[h] ?? '').join(',');
const v2Csv = [
  V2_HEADER.join(','),
  v2Row({ name: 'Mitigeur de bain SFAX SOPAL', unit: 'M2', price: '434.371', currency: 'TND', price_tax_status: 'TTC', source: 'https://comaf.tn/', source_url: 'https://comaf.tn/robinetterie/347.html', observed_at: '2026-10-02T23:44:56.851Z' }),
  v2Row({ name: 'Scie circulaire Bosch GKS 190', unit: 'unit', price: '616.985', currency: 'TND', price_tax_status: 'TTC', source: 'https://comaf.tn/', source_url: 'https://comaf.tn/scies/798.html', observed_at: '2026-10-02T23:44:56.851Z' }),
  v2Row({ name: 'Lavabo Strada II 60x43', unit: 'unit', price: '', currency: 'TND', price_tax_status: 'TTC', source: 'https://comaf.tn/', source_url: 'https://comaf.tn/lavabos/1719.html', observed_at: '2026-10-02T23:44:56.851Z' }),
].join('\n');

await test('1. Global Catalog v2 → Intelligent: every v2 column resolves, nothing blocks', () => {
  const { mapping, run } = runIntelligent(v2Csv);
  assert.equal(mapping.mappingErrors.length, 0, JSON.stringify(mapping.mappingErrors));
  assert.deepEqual(mapping.unmappedRequired, [], 'no required canonical field is left unmapped');
  assert.equal(mapping.appliedMapping.material_name, 'name');
  assert.equal(mapping.appliedMapping.material_code, 'identifier_value');
  assert.equal(mapping.appliedMapping.trade_code, 'category');
  assert.equal(mapping.appliedMapping.category, 'subcategory');
  assert.equal(mapping.appliedMapping.price_ht, 'price');
  assert.equal(mapping.appliedMapping.currency, 'currency');
  assert.equal(mapping.appliedMapping.market, 'country');
  assert.equal(mapping.appliedMapping.source_url, 'source_url');
  assert.equal(mapping.appliedMapping.observed_at, 'observed_at');
  assert.equal(run.valid.length, 2, JSON.stringify(run.failed));
  assert.equal(run.failed.length, 1);
});

await test('2. identifier_value → material_code (exact alias, auto-suggested)', () => {
  const { mapping } = runIntelligent(v2Csv);
  assert.equal(mapping.appliedMapping.material_code, 'identifier_value');
  // A file where identifier_value is the ONLY identifier column still maps.
  const minimal = parseCatalogCsv('identifier_value,material_name,price_ht\nID-1,Nom,3.5');
  const m2 = catalog.resolveMapping(minimal.headers, minimal.rows[0], null, minimal.rows);
  assert.equal(m2.appliedMapping.material_code, 'identifier_value');
  // `trade_code` may stay in the truthful display list — it NEVER blocks;
  // what matters is that material_code is no longer among the unmapped required.
  assert.deepEqual(m2.unmappedRequired, ['trade_code']);
  assert.ok(!m2.unmappedRequired.includes('material_code'));
});

await test('3. empty identifier_value → generateMaterialCode contract only (nothing invented)', () => {
  const { run } = runIntelligent(v2Csv);
  const row: any = run.valid[0];
  // deterministic slug + 8-char hash of the NAME (never the price, never a UUID)
  assert.match(row.reference, /^[a-z0-9]+(?:_[a-z0-9]+)*_[0-9a-f]{8}$/, `unexpected reference: ${row.reference}`);
  assert.ok(row.reference.startsWith('mitigeur_de_bain_sfax_sopal'), 'reference derives from the name');
  assert.ok((row.review || []).some((r: string) => r.includes('Generated material_code from material name')));
  // the identifier pair itself stays EMPTY — nothing is fabricated as an identifier
  assert.equal(row.identifier_type, undefined);
});

await test('4. Normal import: country empty + available empty → NO availability error', async () => {
  const csv = ['name,brand,country,available', 'Cement 42.5R,ACME,,'].join('\n');
  const out = await normal.previewGlobalCatalogImport({ fileType: 'csv', buffer: buf(csv) });
  assert.equal(out.summary.total, 1);
  assert.equal(out.summary.invalid, 0, JSON.stringify(out.items[0].errors));
  assert.deepEqual(out.items[0].errors, []);
});

await test('5. Normal: country=TN + available empty → valid, NOT invented; bad value still rejected', async () => {
  const csv = [
    'name,country,available',
    'Cement 42.5R,TN,',
    'Ciment TLS,TN,maybe',
  ].join('\n');
  const out = await normal.previewGlobalCatalogImport({ fileType: 'csv', buffer: buf(csv) });
  assert.equal(out.summary.total, 2);
  // Row A: country present, available EMPTY → valid, value untouched (no yes, no no)
  const rowA = out.items[0];
  assert.deepEqual(rowA.errors, [], JSON.stringify(rowA.errors));
  assert.equal(rowA.normalized.available, '', 'available must stay empty — never invented');
  // Row B: a PROVIDED but unparseable value is still refused (no silent data drop)
  const rowB = out.items[1];
  assert.ok(rowB.errors.some((e: string) => e.includes('available')), JSON.stringify(rowB.errors));
  assert.ok(!rowB.errors.some((e: string) => e.includes('requires available=yes/no')), 'the legacy presence rule is gone');
});

await test('5b. Normal: identifier pair + country format rules unchanged (regression guard)', async () => {
  const csv = [
    'name,identifier_type,identifier_value,country,available',
    'Half Pair,gtin,,TN,yes',
  ].join('\n');
  const out = await normal.previewGlobalCatalogImport({ fileType: 'csv', buffer: buf(csv) });
  assert.ok(out.items[0].errors.some((e: string) => e.includes('Identifier requires identifier_type + identifier_value')));
  const badCountry = ['name,country', 'X,ZZZZZZ'].join('\n');
  const out2 = await normal.previewGlobalCatalogImport({ fileType: 'csv', buffer: buf(badCountry) });
  assert.ok(out2.items[0].errors.includes('Invalid country code'));
});

await test('6. empty price → rejected with the exact reason (no 0, no average, no block of valid rows)', () => {
  const { run } = runIntelligent(v2Csv);
  assert.equal(run.failed.length, 1);
  assert.ok(run.failed[0].reason.includes('Prix vide'), run.failed[0].reason);
  assert.ok(run.failed[0].reason.includes('aucune valeur inventée'));
  assert.equal(run.valid.length, 2, 'the valid rows are never blocked by the rejected one');
});

await test('7. TTC price kept VERBATIM + price_tax_status never maps to status', () => {
  const { mapping, run } = runIntelligent(v2Csv);
  // no conversion at all: the parsed number is exactly the file number
  assert.equal(run.valid[0].price, 434.371);
  assert.equal(run.valid[1].price, 616.985);
  // `price_tax_status` is NOT the row status (no « ttc » stored as status)
  assert.notEqual(mapping.appliedMapping.status, 'price_tax_status');
  assert.equal(roles(mapping).price_tax_status, 'unmapped');
  assert.equal(run.valid[0].sourceStatus, 'active', 'status stays the default — TTC never leaks into it');
  // a REAL status column still maps (canonical spelling unaffected by the veto)
  const canon = parseCatalogCsv('material_code,material_name,price_ht,status\nM1,Nom,3,active');
  const m = catalog.resolveMapping(canon.headers, canon.rows[0], null, canon.rows);
  assert.equal(m.appliedMapping.status, 'status');
});

await test('8. unmapped trade → unmapped_review sentinel, rows stay importable + review note', () => {
  // (a) no trade column at all
  const noTrade = parseCatalogCsv('material_code,material_name,price_ht\nA1,Nom,3.5');
  const m = catalog.resolveMapping(noTrade.headers, noTrade.rows[0], null, noTrade.rows);
  const r = catalog.normalizeAndValidateRows(noTrade.rows, m.appliedMapping, TN);
  assert.equal(r.failed.length, 0, JSON.stringify(r.failed));
  assert.equal(r.valid[0].trade, 'unmapped_review');
  assert.ok((r.valid[0].review || []).some((x: string) => x.includes('Missing Categorie')));
  assert.ok(m.unmappedRequired.includes('trade_code'), 'truthful display');
  // trade_code is NEVER presented as a blocking field by the confirm gate
  assert.deepEqual(visibleUnmappedRequired({ canImport: true, unmappedRequired: ['trade_code'] }), []);
  assert.equal(buildImportBlockReason({ canImport: true, unmappedRequired: [] }, ''), null);
  // (b) a mapped trade column whose cells are all empty → same sentinel, still valid
  const { run } = runIntelligent(v2Csv);
  assert.equal(run.valid[0].trade, 'unmapped_review');
  assert.equal(run.valid[0].category, 'unmapped_review', 'empty category falls back to the trade sentinel (existing contract)');
});

await test('9. canonical import schema: all 13 canonical columns map in Intelligent', () => {
  const csv = [
    'material_code,material_name,trade_code,price_ht,category,unit,tva_rate,currency,market,source,source_url,observed_at,status',
    'MAT-001,Plaque BA13,placo,31.5,planches,unit,19,TND,TN,COMPTOIR,https://x.example/1,2026-10-02,active',
  ].join('\n');
  const { mapping, run } = runIntelligent(csv);
  for (const key of ['material_code', 'material_name', 'trade_code', 'price_ht', 'category', 'unit', 'tva_rate', 'currency', 'market', 'source', 'source_url', 'observed_at', 'status']) {
    assert.equal(mapping.appliedMapping[key], key, `${key} must map to its own canonical column`);
  }
  assert.deepEqual(mapping.unmappedRequired, []);
  assert.equal(run.failed.length, 0, JSON.stringify(run.failed));
  assert.equal(run.valid[0].reference, 'MAT-001');
  assert.equal(run.valid[0].price, 31.5);
  assert.equal(run.valid[0].tvaRate, 19);
  assert.equal(run.valid[0].currencyCode, 'TND');
  assert.equal(run.valid[0].countryCode, 'TN');
  assert.equal(run.valid[0].sourceStatus, 'active');
});

await test('10. Normal import accepts canonical columns (material_name → name, material_code → sku, market → country)', async () => {
  const csv = [
    'material_code,material_name,trade_code,price_ht,category,unit,tva_rate,currency,market,source,source_url,observed_at,status',
    'MAT-001,Plaque BA13,placo,31.5,planches,unit,19,TND,TN,COMPTOIR,https://x.example/1,2026-10-02,active',
  ].join('\n');
  const out = await normal.previewGlobalCatalogImport({ fileType: 'csv', buffer: buf(csv) });
  assert.equal(out.summary.total, 1);
  assert.deepEqual(out.items[0].errors, [], 'a canonical file must not be rejected by the Normal path');
  assert.equal(out.items[0].normalized.name, 'Plaque BA13');
  assert.equal(out.items[0].normalized.sku, 'MAT-001', 'material_code lands in the existing code column (sku)');
  assert.equal(out.items[0].normalized.country, 'TN', 'market is the canonical country column');
  assert.equal(out.items[0].normalized.available, '');
  // price columns are NOT part of the Global Catalog contract → tolerated, never read as price
  assert.equal((out.items[0].normalized as any).price, undefined);
});

await test('10b. Normal import still reads a Global Catalog v2 file (price never rejects here)', async () => {
  const out = await normal.previewGlobalCatalogImport({ fileType: 'csv', buffer: buf(v2Csv) });
  assert.equal(out.summary.total, 3);
  assert.equal(out.summary.invalid, 0, JSON.stringify(out.items.map((i) => i.errors)));
  assert.equal(out.items[0].normalized.name, 'Mitigeur de bain SFAX SOPAL');
  assert.equal(out.items[0].normalized.unit, 'M2');
  // the empty-price rejection belongs to the Intelligent contract only:
  // the Normal (Global Catalog) path has no price concept, so it never rejects on price.
  assert.equal(out.items[2].errors.length, 0);
});

await test('11. Intelligent still enforces required fields (missing name / missing price column)', () => {
  const noName = parseCatalogCsv('material_code,price_ht\nM1,3.5');
  const m1 = catalog.resolveMapping(noName.headers, noName.rows[0], null, noName.rows);
  const r1 = catalog.normalizeAndValidateRows(noName.rows, m1.appliedMapping, TN);
  assert.equal(r1.failed.length, 1);
  assert.ok(r1.failed[0].reason.includes('material name'), r1.failed[0].reason);

  const noPrice = parseCatalogCsv('material_code,material_name\nM1,Nom');
  const m2 = catalog.resolveMapping(noPrice.headers, noPrice.rows[0], null, noPrice.rows);
  const r2 = catalog.normalizeAndValidateRows(noPrice.rows, m2.appliedMapping, TN);
  assert.equal(r2.failed.length, 1);
  assert.ok(/prix|price/i.test(r2.failed[0].reason), r2.failed[0].reason);
  assert.ok(m2.unmappedRequired.includes('price_ht'));
});

// ════════════════════════════════════════════════════════════════════════════
// 12-13. REAL Global Catalog v2 export (KONSTRIVO Catalog Collector).
//        Byte-identical fixture (SHA-256 verified at copy time): the exact
//        348-row contract → 242 importable / 106 rejected (empty price ONLY).
//        DB-free: no write, no conversion, no invented value.
// ════════════════════════════════════════════════════════════════════════════
const V2_FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures', 'catalog', 'global-catalog-v2.csv'
);

await test('12. real global-catalog v2 export → 348 rows = 242 importable / 106 rejected (empty price only)', () => {
  const csv = fs.readFileSync(V2_FIXTURE, 'utf8');
  const parsed = parseCatalogCsv(csv);
  const mapping = catalog.resolveMapping(parsed.headers, parsed.rows[0], null, parsed.rows);
  const run = catalog.normalizeAndValidateRows(parsed.rows, mapping.appliedMapping, TN, undefined, mapping.nameFallbackHeaders);

  assert.equal(parsed.rows.length, 348, 'the file holds 348 data rows');
  assert.equal(run.valid.length, 242, 'importable rows');
  assert.equal(run.failed.length, 106, 'rejected rows');
  assert.ok(
    run.failed.every((f: any) => f.reason.includes('Prix vide')),
    'the ONLY rejection reason is the empty price — nothing else is rejected'
  );
  assert.deepEqual(mapping.unmappedRequired, [], 'no required canonical field is left unmapped');
  assert.equal(mapping.appliedMapping.material_code, 'identifier_value');
  assert.equal(mapping.appliedMapping.material_name, 'name');
  assert.equal(mapping.appliedMapping.trade_code, 'category');
  assert.notEqual(mapping.appliedMapping.status, 'price_tax_status', 'price_tax_status is never the row status');

  // NO price conversion and NO invented price: the first two file prices are
  // present VERBATIM (the file declares price_tax_status=TTC on 229 rows).
  const byRow = new Map(run.valid.map((r: any) => [r.row, r]));
  assert.equal((byRow.get(2) as any).price, 434.371);
  assert.equal((byRow.get(3) as any).price, 616.985);
  assert.ok(run.valid.every((r: any) => Number.isFinite(r.price) && r.price >= 0));

  // TTC never leaks into the row status.
  assert.ok(run.valid.every((r: any) => r.sourceStatus !== 'ttc'), 'no « ttc » stored as status');

  // Every importable row is WRITE-PATH shaped (verified against the schema):
  // code <= 100 chars, unit <= 20, sentinel trade (no invented métier).
  assert.ok(run.valid.every((r: any) => r.reference.length > 0 && r.reference.length <= 100), 'material code fits varchar(100)');
  assert.ok(run.valid.every((r: any) => r.unit.length <= 20), 'unit fits varchar(20)');
  assert.ok(run.valid.every((r: any) => r.trade === 'unmapped_review'), 'no invented trade');
});

await test('13. empty identifier_value → the EXISTING deterministic code (same input ⇒ same code, never random)', () => {
  const csv = fs.readFileSync(V2_FIXTURE, 'utf8');
  const a = runIntelligent(csv);
  const b = runIntelligent(csv);
  const refsA = a.run.valid.map((r: any) => r.reference);
  const refsB = b.run.valid.map((r: any) => r.reference);

  assert.equal(refsA.length, 242);
  assert.deepEqual(refsA, refsB, 're-running the same file yields the SAME references (stable/idempotent)');
  assert.ok(
    refsA.every((r: string) => /^[a-z0-9]+(?:_[a-z0-9]+)*_[0-9a-f]{8}$/.test(r)),
    'every generated code is the deterministic slug + sha1-8 of the name'
  );
  assert.equal(refsA.filter((r: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(r)).length, 0, 'no UUID / random identifier');
  assert.equal(new Set(refsA).size, refsA.length, 'the 348 unique names produce unique codes (no collisions)');
  // the identifier pair itself is never fabricated on a row
  assert.ok(a.run.valid.every((r: any) => r.identifier_value === undefined && r.identifier_type === undefined));
});

console.log('\n═════════════════════════════════════════════');
console.log(` Import layer regression: ${passed} passed, ${failed} failed`);
console.log('═════════════════════════════════════════════\n');
if (failures.length > 0) {
  console.log('FAILED TESTS:');
  failures.forEach((f) => console.log(f));
  console.log('');
}
process.exit(failed > 0 ? 1 : 0);




