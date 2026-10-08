/**
 * Regression — preamble/title rows before the REAL header.
 *
 * Run: npx tsx tests/preambleCatalogRegression.test.ts
 *
 * Reproduces the reported Admin failure on a Hong Kong Census bulletin export
 * (`B10600052026MM05B0100.csv`): 4 title/date rows + the real header
 * `,材料,單位,Materials,Unit,HK$` + data. Before the fix the parser took the
 * FIRST title row as the header, so every real column collapsed into one `''`
 * key, every canonical field showed « — Non mappé — » and all rows were
 * rejected with "Missing Reference (stable material code).".
 *
 * This file locks BOTH sides of the contract:
 *   1. the NEW preamble shape is parsed (Materials / Unit / HK$ detected, no
 *      column collapse),
 *   2. the EXISTING shapes are untouched (headered CSV + the headerless
 *      `sep=;` HOTFIX + a plain headerless file + the all-single-cell guard),
 *   3. Notes / footer rows are NOT silently dropped (they stay data rows and
 *      are reported as rejected) and HK$ is NOT interpreted as a currency
 *      value (one file-level currency only — never an implicit HK$ = TND).
 */
import assert from 'node:assert/strict';
import { parseCatalogCsv } from '../server/utils/csv';
import { normalizeAndValidateRows, resolveMapping } from '../server/services/catalogImport';

// ── 1) HK Census-style bulletin: 4 preamble rows + real header + data ───────
const HK_PREAMBLE = [
  '特選建築材料平均批發價格@,,,,,',
  'Average Wholesale Prices of Selected Building Materials@,,,,,',
  '2026 年 5 月,,,,,',
  'May-26,,,,,',
];
const HK_HEADER = ',材料,單位,Materials,Unit,HK$';
const HK_MATERIALS = [
  '1,碎石 *,公噸,Aggregates *,tonne,90',
  '2,瀝青,公噸,Bitumen,tonne,10276',
  '3,混凝土磚，100毫米厚,平方米,"Concrete blocks, 100mm thick",square metre,107',
];
// Footer/Notes block — deliberately KEPT in the file: the parser must not
// drop it, and the normalizer must report it as rejected (never import it).
const HK_NOTES = [
  'Notes:,,,,,',
  ' ^ Figure includes low volatile organic compound paint.,,,,,',
  'Tel. No. : (852) 3903 7384,,,,,',
];
const hkCsv = [...HK_PREAMBLE, HK_HEADER, ...HK_MATERIALS, ...HK_NOTES].join('\n');

const hk = parseCatalogCsv(hkCsv);
assert.equal(hk.headerless, false, 'preamble rows must never be mistaken for headerless data');
assert.deepEqual(
  hk.headers,
  ['', '材料', '單位', 'Materials', 'Unit', 'HK$'],
  'the REAL header (row 5) must be used, with all 6 columns kept'
);
assert.equal(
  hk.rows.length,
  HK_MATERIALS.length + HK_NOTES.length,
  'only the preamble rows are skipped — no data row and no Notes row is lost'
);

// No column collapse: the single leading empty header keeps the index column
// only; name / unit / price stay in their OWN columns and keep their values.
const hkFirst = hk.rows[0];
assert.equal(hkFirst[''], '1', 'the blank header keeps ONLY the leading index column');
assert.equal(hkFirst['Materials'], 'Aggregates *', 'material name column is not collapsed');
assert.equal(hkFirst['Unit'], 'tonne', 'unit column is not collapsed');
assert.equal(hkFirst['HK$'], '90', 'price column is not collapsed');
assert.equal(hkFirst['材料'], '碎石 *', 'UTF-8 (non-latin) header column preserved');

// Detection: Materials → material_name, Unit → unit, HK$ → price_ht.
const hkMapping = resolveMapping(hk.headers, hk.rows[0]);
assert.equal(hkMapping.appliedMapping.material_name, 'Materials');
assert.equal(hkMapping.appliedMapping.unit, 'Unit');
assert.equal(hkMapping.appliedMapping.price_ht, 'HK$', 'HK$ must be detected as the price column');
assert.deepEqual(
  hkMapping.unmappedRequired,
  ['material_code', 'trade_code'],
  'only material_code (empty header) and trade_code (no column) remain unmapped'
);

// Normalization: 3 materials valid (stable generated codes), 3 Notes rows
// REJECTED — never dropped, never imported.
const hkRun = normalizeAndValidateRows(
  hk.rows,
  hkMapping.appliedMapping,
  { countryCode: 'TN', currencyCode: 'TND' },
  'materiaux'
);
assert.equal(hkRun.valid.length, HK_MATERIALS.length, 'every real material row is importable');
assert.equal(hkRun.failed.length, HK_NOTES.length, 'Notes/footer rows are reported, not silently ignored');
assert.ok(
  hkRun.failed.every((f) => f.reason.includes('Missing Reference')),
  'Notes rows reject with the explicit reason (file must be curated by the Admin)'
);
assert.equal(hkRun.valid[0].price, 90, 'the price is the raw cell value (no rescaling)');
assert.ok(
  hkRun.valid[0].reference.startsWith('aggregates'),
  'material_code is generated from the material name (Phase C behaviour)'
);
assert.ok(
  hkRun.valid[0].review?.includes('Generated material_code from material name'),
  'generated code is flagged for review'
);

// HK$ is a PRICE COLUMN HEADER, not a currency value: nothing maps `currency`
// from this file, so the ONE file-level currency (the import request, TND by
// default) still applies — the fix never turns HK$ into TND.
assert.equal(
  hkMapping.appliedMapping.currency,
  undefined,
  'the HK$ header must not be mapped to `currency` (no implicit HK$ = TND)'
);

// ── 2) Legacy headered CSV (Phase A shape) must stay byte-identical ─────────
const legacyCsv = 'Reference,Designation,Categorie,Unite,Prix_HT_TND\nPLA-BA13-STD,Plaque BA13 Standard 1.2x2.5m,placo,unit,31.500';
const legacy = parseCatalogCsv(legacyCsv);
assert.equal(legacy.headerless, false, 'headered CSV stays on the headered path');
assert.deepEqual(
  legacy.headers,
  ['Reference', 'Designation', 'Categorie', 'Unite', 'Prix_HT_TND'],
  'legacy header is untouched (no preamble stripping on a normal file)'
);
assert.equal(legacy.rows.length, 1, 'legacy data rows are untouched');
assert.equal(legacy.rows[0]['Prix_HT_TND'], '31.500');
const legacyMapping = resolveMapping(legacy.headers, legacy.rows[0]);
assert.equal(legacyMapping.appliedMapping.material_code, 'Reference');
assert.equal(legacyMapping.appliedMapping.material_name, 'Designation');
assert.equal(legacyMapping.appliedMapping.price_ht, 'Prix_HT_TND');
assert.equal(legacyMapping.appliedMapping.unit, 'Unite');
assert.equal(legacyMapping.appliedMapping.trade_code, 'Categorie', 'legacy trade column keeps mapping (Categorie → trade_code)');
assert.deepEqual(legacyMapping.unmappedRequired, [], 'legacy headered file: every required field stays mapped');

// ── 3) Headerless HOTFIX (`sep=;` export) must stay unchanged ───────────────
const headerlessBody = Array.from({ length: 52 }, (_, i) => {
  const n = String(i + 1).padStart(3, '0');
  return `01.01.${n},"ITEM CONSTRUCTION ${n}",${(3.5 + i).toFixed(2)},M2`;
}).join('\n');
const headerlessCsv = `sep=;\n${headerlessBody.replace(/,/g, ';')}`;
const headerless = parseCatalogCsv(headerlessCsv);
assert.equal(headerless.headerless, true, 'sep=; headerless file is still detected');
assert.equal(headerless.rows.length, 52, 'no headerless row is lost');
assert.deepEqual(headerless.headers, ['material_code', 'material_name', 'price_ht', 'unit']);
const headerlessMapping = resolveMapping(headerless.headers, headerless.rows[0]);
assert.equal(headerlessMapping.appliedMapping.material_code, 'material_code');
assert.equal(headerlessMapping.appliedMapping.price_ht, 'price_ht');
assert.deepEqual(headerlessMapping.unmappedRequired, ['trade_code']);
const headerlessRun = normalizeAndValidateRows(
  headerless.rows,
  headerlessMapping.appliedMapping,
  { countryCode: 'TN', currencyCode: 'TND' },
  'terrassement'
);
assert.equal(headerlessRun.failed.length, 0, 'headerless HOTFIX: 0 rejected rows');
assert.equal(headerlessRun.valid.length, 52, 'headerless HOTFIX: 52/52 valid');

// Plain headerless file (no `sep=` directive) — same HOTFIX behaviour.
const plainHeaderless = parseCatalogCsv('01.01.001,ITEM CONSTRUCTION 001,3.50,M2\n01.01.002,ITEM CONSTRUCTION 002,4.50,M2');
assert.equal(plainHeaderless.headerless, true);
assert.equal(plainHeaderless.rows.length, 2);
assert.deepEqual(plainHeaderless.headers, ['material_code', 'material_name', 'price_ht', 'unit']);

// ── 4) Guard: a file made ONLY of single-cell lines is left untouched ───────
const allSingleCell = 'ONLY TITLE\nANOTHER LINE';
const guarded = parseCatalogCsv(allSingleCell);
assert.equal(guarded.headerless, false, 'no data → same path as before the fix (no crash)');
assert.deepEqual(guarded.headers, ['ONLY TITLE'], 'the first line is still used when nothing else exists');
assert.equal(guarded.rows.length, 1);

// A TAB-delimited preamble must be skipped too (same delimiter-aware rule).
const tabPreamble = parseCatalogCsv('TITLE\t\t\t\n\tMaterials\tUnit\tHK$\nAggregates *\ttonne\t90');
assert.deepEqual(tabPreamble.headers, ['', 'Materials', 'Unit', 'HK$'], 'tab-delimited preamble skipped');
assert.equal(tabPreamble.rows.length, 1);

console.log('preambleCatalogRegression: PASS — preamble skipped, Materials/Unit/HK$ detected, legacy + headerless intact');

