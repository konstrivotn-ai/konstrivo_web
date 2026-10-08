/**
 * UNIVERSAL CATALOG IMPORT — REALISTIC 40-ROW FILE (DB-free).
 *
 * Runs the EXACT reported failing file
 * `tests/fixtures/catalog/KONSTRIVO_Universal_Realistic_Test.csv`
 * (12 columns × 40 data rows) through the SAME shared pipeline the
 * /preview and /import endpoints run:
 *   parser → value profiles → smart mapping → per-row normalization.
 *
 * What is locked here:
 *   1. Semantic mapping of the file's headers: item_ref → material_code,
 *      nom_fr → material_name, current_cost → price_ht, selling_unit → unit,
 *      department → trade_code (Trade-Registry VALUE gate), currency_code →
 *      currency, market → market, data_source → source, product_page →
 *      source_url. `product_group` is NEVER mapped: its values are product
 *      groupings, not Trade Registry identities.
 *   2. Per-row name usage: nom_fr is the primary designation; rows without it
 *      use name_en, and the row without both latin names uses name_ar — each
 *      disclosed in the row review, nothing invented.
 *   3. Price honesty: `14.50`, `1250,00`, `1 250,50` are prices; blank, prose
 *      and negative cells reject THEIR ROW ONLY — the valid rows import.
 *   4. Currency/market honesty: each row's OWN valid currency/market is
 *      PRESERVED (a USD row keeps USD, a FR row keeps FR) whatever market /
 *      currency the Admin selected — never coerced, never rejected, never
 *      silently converted. The selection is a fallback for absent cells only.
 *   5. preview == import determinism (same bytes → same mapping → same rows).
 *   6. UI parity: the local Smart-Mapping flow shows the ACTUAL detected
 *      columns — never « Non mappé » for a detected required field.
 *   7. The engine stays data-driven: no filename / per-file / per-trade
 *      branching was added for this file.
 *
 * Run: npx tsx tests/catalogImportUniversalRealistic.test.ts
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

const TN = { countryCode: 'TN', currencyCode: 'TND' };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(HERE, 'fixtures', 'catalog', 'KONSTRIVO_Universal_Realistic_Test.csv');
const CSV_TEXT = fs.readFileSync(CSV_PATH, 'utf8');

/** Runs a CSV through the SHARED pipeline — the exact /preview + /import calls. */
function runShared(csv: string, params = TN, defaultTrade?: string) {
  const parsed = parseCatalogCsv(csv);
  const mapping = catalog.resolveMapping(parsed.headers, parsed.rows[0], null, parsed.rows);
  const run = catalog.normalizeAndValidateRows(
    parsed.rows,
    mapping.appliedMapping,
    params,
    defaultTrade,
    mapping.nameFallbackHeaders
  );
  return { parsed, mapping, run };
}

console.log('\n═══════════════════════════════════════════');
console.log(' UNIVERSAL IMPORT — REALISTIC 40-ROW FILE');
console.log('═══════════════════════════════════════════\n');

// ════════════════════════════════════════════════════════════════════════════
// 1) SEMANTIC MAPPING — every header of the failing file lands on its field
// ════════════════════════════════════════════════════════════════════════════
await test('1. the 40-row file maps semantically: every header lands on its canonical field', () => {
  const { parsed, mapping } = runShared(CSV_TEXT);
  assert.equal(parsed.headerless, false, 'the file IS a headered catalogue');
  assert.equal(parsed.rows.length, 40, 'the EXACT 40 data rows are parsed');
  assert.equal(parsed.headers.length, 12, 'the 12 reported columns are read');

  const m = mapping.appliedMapping;
  assert.equal(m.material_code, 'item_ref');
  assert.equal(m.material_name, 'nom_fr', 'the FRENCH designation is the primary name column');
  assert.equal(m.name_ar, 'name_ar');
  assert.equal(m.price_ht, 'current_cost', '`current_cost` IS the price column');
  assert.equal(m.unit, 'selling_unit');
  assert.equal(m.trade_code, 'department', 'EVERY department value matches the Trade Registry → the column is the métier');
  assert.equal(m.currency, 'currency_code');
  assert.equal(m.market, 'market');
  assert.equal(m.source, 'data_source');
  assert.equal(m.source_url, 'product_page');
  assert.ok(!Object.values(m).includes('product_group'), 'a grouping column is NEVER a trade/category without registry proof');
  assert.ok(!Object.values(m).includes('name_en'), '`name_en` stays available as the per-row fallback');
  assert.deepEqual(mapping.unmappedRequired, [], 'no required field shows « Non mappé »');
  assert.deepEqual(mapping.nameFallbackHeaders, ['name_en', 'name_ar'], 'name_en then name_ar serve rows without nom_fr');

  // ── DISPLAY HONESTY — every SOURCE column is accounted for ───────────────
  // The Admin panel renders `columnAssignments` as
  // « colonne du fichier → champ »; a column the engine deliberately uses as a
  // designation FALLBACK (or refuses as a grouping) must never be left looking
  // like an unexplained « — Non mappé — ».
  assert.equal(mapping.columnAssignments.length, 12, 'one explicit line per detected column');
  const assign = new Map(mapping.columnAssignments.map((a) => [a.source, a]));
  assert.equal(assign.get('item_ref')!.key, 'material_code');
  assert.equal(assign.get('nom_fr')!.key, 'material_name');
  assert.equal(assign.get('name_en')!.role, 'name_fallback', 'name_en is visibly the designation fallback');
  assert.equal(assign.get('name_en')!.key, null);
  assert.equal(assign.get('name_ar')!.key, 'name_ar');
  assert.equal(assign.get('current_cost')!.key, 'price_ht');
  assert.equal(assign.get('selling_unit')!.key, 'unit');
  assert.equal(assign.get('department')!.key, 'trade_code');
  assert.equal(assign.get('product_group')!.role, 'unmapped', 'the grouping column is read but never used');
  assert.equal(assign.get('currency_code')!.key, 'currency');
  assert.equal(assign.get('market')!.key, 'market');
  assert.equal(assign.get('data_source')!.key, 'source');
  assert.equal(assign.get('product_page')!.key, 'source_url');
});

// ════════════════════════════════════════════════════════════════════════════
// 2) PER-ROW VERDICT — 37 valid, 3 rejected ALONE with precise reasons
// ════════════════════════════════════════════════════════════════════════════
await test('2. 37 rows import, 3 are rejected ALONE — each with its precise reason', () => {
  const { run } = runShared(CSV_TEXT);
  assert.equal(run.valid.length, 37, JSON.stringify(run.failed));
  assert.equal(run.failed.length, 3);
  assert.deepEqual(run.failed.map((f) => f.row), [7, 14, 37], 'the failing FILE lines are identified');

  const byRow = new Map(run.failed.map((f) => [f.row, f.reason]));
  assert.match(byRow.get(7)!, /Prix vide/, 'the blank price cell rejects its row only');
  assert.match(byRow.get(14)!, /Invalid price 'sur devis'/, 'the raw prose value is named, nothing invented');
  assert.match(byRow.get(37)!, /Price must be >= 0/, 'a negative price is refused, never abs()olved');
  assert.ok(
    ![...byRow.values()].some((r) => /does not match the import (currency|market)/.test(r)),
    'no row is EVER rejected for carrying its own valid currency/market'
  );

  // ── PER-ROW CURRENCY / MARKET — preserved verbatim, never converted ──────
  const usdRow = run.valid.find((r) => r.reference === 'ELC-007')!;
  assert.equal(usdRow.currencyCode, 'USD', 'the row keeps its OWN USD currency (never coerced to TND)');
  assert.equal(usdRow.countryCode, 'TN', 'the row keeps its own market');
  assert.match((usdRow.review ?? []).join(' '), /Devise du fichier 'USD' conserv/, 'the divergence is disclosed, never silent');
  const frRow = run.valid.find((r) => r.reference === 'PLC-007')!;
  assert.equal(frRow.currencyCode, 'TND', 'a row without a currency divergence still gets its file currency');
  assert.equal(frRow.countryCode, 'FR', 'the row keeps its OWN FR market (never coerced to TN)');
  assert.match((frRow.review ?? []).join(' '), /Marché du fichier 'FR' conserv/);
  const plb1Meta = run.valid.find((r) => r.reference === 'PLB-001')!;
  assert.equal(plb1Meta.currencyCode, 'TND');
  assert.equal(plb1Meta.countryCode, 'TN');
  assert.equal(plb1Meta.review, undefined, 'a row in line with the selection carries no currency/market noise');

  const byRef = new Map(run.valid.map((r) => [r.reference, r]));
  const plb1 = byRef.get('PLB-001')!;
  assert.equal(plb1.nameFr, 'Tube PVC 50mm', 'the nom_fr value is the stored designation');
  assert.equal(plb1.nameAr, 'أنبوب PVC 50مم');
  assert.equal(plb1.trade, 'plomberie', 'the department value (registry code) is the row métier');
  assert.equal(plb1.price, 14.5, '`14.50` is 14.5');
  assert.equal(plb1.unit, 'meter', 'the selling_unit value is the row unit');
  assert.equal(plb1.source, 'BATIMAX', 'the data_source value is the source identity');
  assert.equal(plb1.sourceUrl, 'https://www.batimax.tn/p/plb-001', 'the product_page link is kept verbatim');
  assert.equal(plb1.category, 'plomberie', 'an unmapped grouping column never becomes the category');
  assert.equal(byRef.get('PLB-002')!.price, 1250, '`1250,00` is 1250 (decimal comma)');
  assert.equal(byRef.get('PNT-002')!.price, 1250.5, '`1 250,50` is 1250.5 (thousands space + decimal comma)');
  assert.deepEqual(
    [...new Set(run.valid.map((r) => r.trade))].sort(),
    ['carrelage', 'electricite', 'peinture', 'placo', 'plomberie'],
    'every row keeps ITS OWN department — a multi-trade file stays multi-trade'
  );
});

// ════════════════════════════════════════════════════════════════════════════
// 2b) THE REPORTED UI REGRESSION — the Admin's market/currency selection must
//     NEVER decide which rows import (the file's own values win)
// ════════════════════════════════════════════════════════════════════════════
await test('2b. any selected market/currency still imports the 37 valid rows (reported 0/40 bug)', () => {
  for (const params of [
    { countryCode: 'FR', currencyCode: 'EUR' }, // ← the real UI selection that produced 0 importable / 40 rejected
    { countryCode: 'TN', currencyCode: 'EUR' },
    { countryCode: 'FR', currencyCode: 'TND' },
    { countryCode: 'US', currencyCode: 'USD' },
    { countryCode: 'SA', currencyCode: 'SAR' },
  ]) {
    const label = `${params.countryCode}/${params.currencyCode}`;
    const { run } = runShared(CSV_TEXT, params);
    assert.equal(run.valid.length, 37, `${label}: the 37 valid rows stay importable`);
    assert.equal(run.failed.length, 3, `${label}: only the 3 genuinely invalid rows are rejected`);
    assert.deepEqual(run.failed.map((f) => f.row), [7, 14, 37], `${label}: the rejected FILE lines`);
    assert.equal(
      run.valid.find((r) => r.reference === 'ELC-007')!.currencyCode,
      'USD',
      `${label}: the file currency is preserved whatever was selected`
    );
    assert.equal(
      run.valid.find((r) => r.reference === 'PLC-007')!.countryCode,
      'FR',
      `${label}: the file market is preserved whatever was selected`
    );
    const divergent = run.valid.filter((r) =>
      (r.currencyCode && r.currencyCode !== params.currencyCode) ||
      (r.countryCode && r.countryCode !== params.countryCode)
    );
    assert.equal(
      run.valid.filter((r) => (r.review ?? []).some((n) => /non appliquée/.test(n))).length,
      divergent.length,
      `${label}: EVERY divergence from the selection is disclosed — and only those`
    );
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 3) PER-ROW NAME USAGE — whichever valid name exists per row
// ════════════════════════════════════════════════════════════════════════════
await test('3. per-row name usage: rows without nom_fr use name_en; the AR-only row uses name_ar', () => {
  const { run } = runShared(CSV_TEXT);
  const byRef = new Map(run.valid.map((r) => [r.reference, r]));

  const plb4 = byRef.get('PLB-004')!;
  assert.equal(plb4.nameFr, 'Angle Valve 1/2', 'name_en serves the row whose nom_fr is empty');
  assert.match((plb4.review ?? []).join(' '), /Nom repris de la colonne « name_en »/, 'the fallback is disclosed');
  assert.equal(plb4.nameAr, 'صمام زاوية 1/2', 'the AR name column is kept independently');
  assert.ok((run.failed.map((f) => f.row)).indexOf(5) === -1, 'the row is NOT rejected for its empty nom_fr');

  const crl4 = byRef.get('CRL-004')!;
  assert.equal(crl4.nameFr, 'روفة التبليط 300غ', 'name_ar serves the row when both latin names are empty');
  assert.match((crl4.review ?? []).join(' '), /Nom repris de la colonne « name_ar »/);
  assert.equal(crl4.nameAr, undefined, 'the AR name IS the designation — never stored twice');

  const plb1 = byRef.get('PLB-001')!;
  assert.equal(plb1.review, undefined, 'a complete row carries no review noise');
});

// ════════════════════════════════════════════════════════════════════════════
// 4) PREVIEW == IMPORT DETERMINISM
// ════════════════════════════════════════════════════════════════════════════
await test('4. preview == import determinism: same bytes → same mapping → same verdict', () => {
  const a = runShared(CSV_TEXT);
  const b = runShared(CSV_TEXT);
  assert.deepEqual(b.mapping.appliedMapping, a.mapping.appliedMapping);
  assert.deepEqual(b.mapping.nameFallbackHeaders, a.mapping.nameFallbackHeaders);
  assert.deepEqual(b.run.valid, a.run.valid);
  assert.deepEqual(b.run.failed, a.run.failed);

  // An EMPTY Admin override behaves exactly like no override (the /preview and
  // /import endpoints send back the mapping the UI displayed).
  const parsed = parseCatalogCsv(CSV_TEXT);
  const withOverride = catalog.resolveMapping(parsed.headers, parsed.rows[0], {}, parsed.rows);
  assert.deepEqual(withOverride.appliedMapping, a.mapping.appliedMapping);
  assert.deepEqual(withOverride.nameFallbackHeaders, a.mapping.nameFallbackHeaders);
});

// ════════════════════════════════════════════════════════════════════════════
// 5) TRADE-REGISTRY GATE — the column values must PROVE the métier
// ════════════════════════════════════════════════════════════════════════════
await test('5. registry gate: department values outside the registry never invent a métier', () => {
  const csv = [
    'item_ref,name_en,current_cost,selling_unit,department,currency_code,market',
    'X-1,Widget A,10,piece,Sales,TND,TN',
    'X-2,Widget B,12,piece,Support,TND,TN',
  ].join('\n');
  const { mapping, run } = runShared(csv);
  assert.equal(mapping.appliedMapping.trade_code, undefined, 'the column is NOT trusted as a métier column');
  assert.ok(!Object.values(mapping.appliedMapping).includes('department'), 'and it maps to nothing else');
  assert.deepEqual(mapping.unmappedRequired, ['trade_code']);
  assert.equal(run.valid.length, 2, 'the rows still read: a missing métier is reported, not fatal');
  assert.ok(run.valid.every((r) => r.trade === 'unmapped_review'), 'per-row review sentinel, never a guessed trade');

  const withDefault = runShared(csv, TN, 'plomberie');
  assert.ok(withDefault.run.valid.every((r) => r.trade === 'plomberie'), 'the explicit admin defaultTrade applies');
  assert.match((withDefault.run.valid[0].review ?? []).join(' '), /Métier par défaut 'plomberie'/);
});

await test('5b. ONE non-registry value makes a department column unreliable (never a guess)', () => {
  const csv = [
    'item_ref,name_en,current_cost,selling_unit,department',
    'Y-1,Widget A,10,piece,PLOMBERIE',
    'Y-2,Widget B,12,piece,Seasonal',
  ].join('\n');
  const { mapping } = runShared(csv);
  assert.equal(mapping.appliedMapping.trade_code, undefined, 'mixed values → the column is refused');
});

await test('5c. a documented `trade` column always wins over a gated `department` column', () => {
  const csv = [
    'item_ref,name_en,current_cost,selling_unit,trade,department',
    'Z-1,Widget A,10,piece,placo,PLOMBERIE',
  ].join('\n');
  const { mapping, run } = runShared(csv);
  assert.equal(mapping.appliedMapping.trade_code, 'trade', 'the documented spelling wins by declaration order');
  assert.ok(!Object.values(mapping.appliedMapping).includes('department'));
  assert.equal(run.valid[0].trade, 'placo', 'the trade column value is kept verbatim');
});

// ════════════════════════════════════════════════════════════════════════════
// 6) DEFAULTTRADE NEVER OVERWRITES THE FILE'S OWN TRADES
// ════════════════════════════════════════════════════════════════════════════
await test('6. defaultTrade NEVER overwrites the trades the file provides', () => {
  const { run } = runShared(CSV_TEXT, TN, 'menuiserie');
  assert.deepEqual(
    [...new Set(run.valid.map((r) => r.trade))].sort(),
    ['carrelage', 'electricite', 'peinture', 'placo', 'plomberie'],
    'the file departments are kept verbatim'
  );
  assert.equal(
    run.valid.filter((r) => (r.review ?? []).some((n) => n.includes('Métier par défaut'))).length,
    0,
    'no default-trade note when the file carries its own trades'
  );
});

// ════════════════════════════════════════════════════════════════════════════
// 7) UI PARITY — the Smart-Mapping panel shows the ACTUAL detected columns
// ════════════════════════════════════════════════════════════════════════════
await test('7. UI parity: the local Smart-Mapping flow shows the ACTUAL detected columns', () => {
  const rows = modal.parseCsvContent(CSV_TEXT);
  assert.equal(rows.length, 40);
  const headers = Object.keys(rows[0]);
  const applied = modal.buildAppliedMapping(headers, modal.resolveMapping(headers), {});
  assert.equal(applied.material_code, 'item_ref');
  assert.equal(applied.material_name, 'nom_fr');
  assert.equal(applied.price_ht, 'current_cost');
  assert.equal(applied.unit, 'selling_unit');
  assert.equal(applied.currency, 'currency_code');
  assert.equal(applied.source, 'data_source');
  for (const key of ['material_code', 'material_name', 'unit', 'price_ht'] as const) {
    assert.ok(applied[key] !== '', `required field "${key}" is preselected — never « Non mappé »`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 8) NO PER-FILE BRANCHING — the engine never learned this file's name
// ════════════════════════════════════════════════════════════════════════════
await test('8. no filename-specific or per-trade branching was added for this file', () => {
  const source = fs.readFileSync(path.join(HERE, '..', 'server', 'services', 'catalogImport.ts'), 'utf8');
  assert.ok(!source.includes('KONSTRIVO_Universal_Realistic'), 'the engine never knows the fixture file');
  assert.ok(!/if\s*\([^)]*(fileName|filename)\s*===/.test(source), 'no `if (filename === ...)` branch');
  assert.ok(!source.includes('if (trade ==='), 'no `if (trade === ...)` branch');
  assert.ok(!source.includes("'department' ==="), 'no per-value branch for the gated header');
  assert.ok(!source.includes("'product_group' ==="), 'no per-value branch for the gated header');
});

console.log('\n═══════════════════════════════════════════');
console.log(` Universal realistic file: ✅ ${passed} passed | ❌ ${failed} failed`);
console.log('═══════════════════════════════════════════\n');
if (failures.length > 0) {
  console.log('FAILED TESTS:');
  failures.forEach((f) => console.log(f));
  console.log('');
}
process.exit(failed > 0 ? 1 : 0);
