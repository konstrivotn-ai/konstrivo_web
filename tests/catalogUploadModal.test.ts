/**
 * CatalogUploadModal — Smart Mapping / CSV parsing / validation unit tests.
 *
 * These tests import the pure helpers of src/components/CatalogUploadModal.tsx
 * (parseCsvContent, resolveMapping, buildParsedItems, parseImportPrice) and
 * cover the required scenarios:
 *   1. Plain CSV (supplier-style headers)
 *   2. Master CSV (price_ht NOT in the last column; trailing effective_to /
 *      observed_at / status must never be read as the price)
 *   3. Semicolon-separated CSV
 *   4. CSV with a UTF-8 BOM
 *   5. CSV without a price column → mapping must miss price_ht (the UI then
 *      shows the clear error; here we assert the mapping contract)
 *   6. Row validation reasons (missing name / unit, invalid price…)
 *   7. applyParsedCatalog (handleApply core): existing materials updated,
 *      new articles actually ADDED to updatedRates, no duplicates on
 *      re-import or within one file, valid MaterialRate shape, safe unit
 *      mapping into the allowed union, stable unique ids.
 *  16. Smart Mapping UI contract (regression, 2026-09-10): ONE canonical
 *      value space shared by appliedMapping / <select value> / optionsForField —
 *      auto-detected fields are preselected (never "Non mappé"), optional
 *      absent fields stay "— Non mappé —", raw/BOM headers are canonicalized,
 *      manual choices are never overwritten, and the SAME appliedMapping
 *      drives buildParsedItems() on confirm (40-row ALU CSV, idempotent).
 *
 * Run: npx tsx tests/catalogUploadModal.test.ts
 */
import { strictEqual, ok as assertOk } from 'assert';
import {
  parseCsvContent,
  resolveMapping,
  buildParsedItems,
  parseImportPrice,
  applyParsedCatalog,
  mapImportedUnit,
  slugifyMaterialId,
  MAPPING_FIELDS,
  optionsForField,
  canonicalHeaderKey,
  buildAppliedMapping
} from '../src/components/CatalogUploadModal';
import type { ColumnMapping } from '../src/components/CatalogUploadModal';
import type { MaterialRate } from '../src/types';

const EMPTY_RATES: MaterialRate[] = [];
const HT19 = { taxMode: 'ht' as const, tvaRate: 19, rates: EMPTY_RATES };

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS ${name}`);
  } catch (err: any) {
    failed++;
    const msg = `  FAIL ${name}\n       ${err?.message || err}`;
    failures.push(msg);
    console.log(msg);
  }
}

function mappingOfCsv(content: string) {
  const rows = parseCsvContent(content);
  return resolveMapping(rows.length > 0 ? Object.keys(rows[0]) : []);
}

console.log('\n📥 CatalogUploadModal — Smart Mapping & CSV Validation Tests\n');

// ── 1) Plain simple CSV (supplier classic headers) ──────────────────────────
test('simple CSV with supplier headers parses and maps price_ht', () => {
  const csv = `Reference,Designation,Categorie,Unite,Prix_HT_TND
PLA-BA13-STD,Plaque de plâtre BA13 Standard 1.2x2.5m,placo,unit,31.500`;
  const rows = parseCsvContent(csv);
  strictEqual(rows.length, 1);
  const mapping = resolveMapping(Object.keys(rows[0]));
  strictEqual(mapping.material_code, 'Reference');
  strictEqual(mapping.material_name, 'Designation');
  strictEqual(mapping.category, 'Categorie');
  strictEqual(mapping.unit, 'Unite');
  strictEqual(mapping.price_ht, 'Prix_HT_TND');

  const { items, errors } = buildParsedItems(rows, mapping, HT19);
  strictEqual(errors.length, 0);
  strictEqual(items.length, 1);
  strictEqual(items[0].newPriceTnd, 31.5);
  strictEqual(items[0].tvaRate, 19); // default TVA from UI when file has none
  strictEqual(items[0].currency, 'TND'); // default currency
  strictEqual(items[0].unit, 'unit');
});

// ── 2) Master CSV — price_ht NOT in the last column ──────────────────────────
test('Master CSV: price_ht honored even though it is not the last column', () => {
  const csv = `material_code,material_name,category,trade,unit,price_ht,tva_rate,currency,source,effective_from,effective_to,observed_at,status
PLA-BA13-STD,Plaque de plâtre BA13 Standard 1.2x2.5m,placo,placo,unit,31.500,19,TND,Comptoir BTP,2026-01-01,2027-01-01,2026-09-01,active`;
  const rows = parseCsvContent(csv);
  strictEqual(rows.length, 1);
  const mapping = resolveMapping(Object.keys(rows[0]));
  strictEqual(mapping.price_ht, 'price_ht');

  const { items, errors } = buildParsedItems(rows, mapping, HT19);
  strictEqual(errors.length, 0);
  strictEqual(items[0].nameFr, 'Plaque de plâtre BA13 Standard 1.2x2.5m');
  strictEqual(items[0].newPriceTnd, 31.5, 'price must come from price_ht, not from effective_to/observed_at/status');
  strictEqual(items[0].tvaRate, 19, 'tva_rate read from its own column');
  strictEqual(items[0].unitPriceTtc, 37.485, 'TTC = HT × 1.19');
  strictEqual(items[0].unit, 'unit');
});

// ── 3) Semicolon-separated CSV ───────────────────────────────────────────────
test('semicolon-delimited CSV (French supplier format)', () => {
  const csv = `Référence;Désignation;Unité;Prix HT;TVA
REF-1;Plaque BA13;unit;12,5;19`;
  const rows = parseCsvContent(csv);
  strictEqual(rows.length, 1);
  const mapping = resolveMapping(Object.keys(rows[0]));
  strictEqual(mapping.material_code, 'Référence');
  strictEqual(mapping.material_name, 'Désignation');
  strictEqual(mapping.unit, 'Unité');
  strictEqual(mapping.price_ht, 'Prix HT');
  strictEqual(mapping.tva_rate, 'TVA');

  const { items, errors } = buildParsedItems(rows, mapping, HT19);
  strictEqual(errors.length, 0);
  strictEqual(items[0].newPriceTnd, 12.5, '"12,5" normalized to 12.5');
  strictEqual(items[0].tvaRate, 19, 'file TVA wins over UI default');
});

// ── 4) UTF-8 BOM CSV ─────────────────────────────────────────────────────────
test('CSV with UTF-8 BOM is parsed (BOM stripped from first header)', () => {
  const csv = '\uFEFFmaterial_code,material_name,unit,price_ht\nC1,Tuyau PVC,ml,4.200';
  const rows = parseCsvContent(csv);
  strictEqual(rows.length, 1);
  const mapping = resolveMapping(Object.keys(rows[0]));
  strictEqual(mapping.material_code, 'material_code');
  strictEqual(mapping.price_ht, 'price_ht');
  const { items, errors } = buildParsedItems(rows, mapping, HT19);
  strictEqual(errors.length, 0);
  strictEqual(items[0].newPriceTnd, 4.2);
});

// ── 5) CSV without a price column → mapping must NOT fabricate a price ───────
test('CSV without a price column produces NO price mapping (clear error in UI)', () => {
  const csv = `material_code,material_name,unit
C1,Tuyau PVC,ml`;
  const rows = parseCsvContent(csv);
  const mapping = resolveMapping(Object.keys(rows[0]));
  strictEqual(typeof mapping.price_ht, 'undefined', 'price_ht must remain unmapped');
  strictEqual(mapping.material_name, 'material_name');

  // The UI surfaces this via processRows(): "Aucune colonne de prix reconnue…".
  // Here we assert treat-nothing-as-price: NO item is ever produced, and every
  // row lands in errors with a missing-price reason.
  const { items, errors } = buildParsedItems(rows, mapping, HT19);
  strictEqual(items.length, 0);
  assertOk(errors.length >= 1, 'rows rejected: status/observed_at are never interpreted as price');
  assertOk(errors[0].reason.includes('Prix HT'), 'clear missing-price reason');
});

// ── 6) Row validation reasons ────────────────────────────────────────────────
test('invalid rows are reported with a clear reason, valid ones kept', () => {
  const csv = `material_code,material_name,unit,price_ht
C1,Bonne ligne,unit,10
C2,,unit,10
C3,Sans unité,,10
C4,Prix zéro,unit,0
C5,Prix Négatif,unit,-5
C6,Prix texte,unit,abc
C7,Bonne ligne 2,ml,3`;
  const rows = parseCsvContent(csv);
  strictEqual(rows.length, 7);
  const mapping = resolveMapping(Object.keys(rows[0]));
  const { items, errors } = buildParsedItems(rows, mapping, HT19);
  strictEqual(items.length, 2, 'rows C1 and C7 are valid');
  strictEqual(errors.length, 5);
  assertOk(errors.some((e) => e.row === 3 && e.reason.includes('material_name')), 'missing name reason');
  assertOk(errors.some((e) => e.row === 4 && e.reason.includes('Unité')), 'missing unit reason');
  assertOk(errors.some((e) => e.row === 5 && e.reason.includes('> 0')), 'zero price reason');
  assertOk(errors.some((e) => e.row === 7 && e.reason.includes('> 0')), 'non-numeric price reason');
});

// ── 7) Price / TVA number normalization ──────────────────────────────────────
test('price parser handles French decimal comma, spaces and thousands', () => {
  strictEqual(parseImportPrice('31,50'), 31.5);
  strictEqual(parseImportPrice('1 500,25'), 1500.25);
  strictEqual(parseImportPrice('12.5'), 12.5);
  strictEqual(parseImportPrice('0'), 0);
  strictEqual(parseImportPrice('abc'), null);
  strictEqual(parseImportPrice(''), null);
});

// ── 8) Supplier aliases (liste de la spec) — no fixed column order ───────────
test('supplier alias variants (ref/code, produit, devise, fournisseur…) are mapped', () => {
  const csv = `code;produit;unit;fournisseur;devise;prix_ht;status;observed_at
A1;Tube PVC;ml;Quincaillerie X;TND;5.000;active;2026-09-01`;
  const rows = parseCsvContent(csv);
  const mapping = resolveMapping(Object.keys(rows[0]));
  strictEqual(mapping.material_code, 'code');
  strictEqual(mapping.material_name, 'produit');
  strictEqual(mapping.unit, 'unit');
  strictEqual(mapping.source, 'fournisseur');
  strictEqual(mapping.currency, 'devise');
  strictEqual(mapping.price_ht, 'prix_ht');

  const { items, errors } = buildParsedItems(rows, mapping, HT19);
  strictEqual(errors.length, 0);
  strictEqual(items[0].newPriceTnd, 5, 'prix_ht used even though status/observed_at come after');
});

// ── 9) Tab-separated + quoted comma value ────────────────────────────────────
test('tab-separated CSV and quoted value containing a comma are kept intact', () => {
  const csv = 'material_code\tmaterial_name\tunit\tprice_ht\nT1\t"Vis, clous et chevilles, boîte"\tboite\t9.900';
  const rows = parseCsvContent(csv);
  strictEqual(rows.length, 1);
  strictEqual(rows[0].material_name, 'Vis, clous et chevilles, boîte', 'quoted comma preserved');
  const mapping = resolveMapping(Object.keys(rows[0]));
  const { items, errors } = buildParsedItems(rows, mapping, HT19);
  strictEqual(errors.length, 0);
  strictEqual(items[0].newPriceTnd, 9.9);
});

// ═══════════════ handleApply core — applyParsedCatalog ═══════════════════════

const BASE_RATES: MaterialRate[] = [
];

function itemsFromCsv(csv: string, rates: MaterialRate[]) {
  const rows = parseCsvContent(csv);
  const mapping = resolveMapping(Object.keys(rows[0]));
  return buildParsedItems(rows, mapping, { taxMode: 'ht', tvaRate: 19, rates }).items;
}

test('apply: existing material gets updated (one-to-one), input array not mutated', () => {
  const items = itemsFromCsv(`material_code,material_name,category,unit,price_ht
PLA-BA13-STD,Plaque de plâtre BA13 Standard 1.2x2.5m,placo,unit,33.000`, BASE_RATES);
  const snapshot = JSON.stringify(BASE_RATES);
  const { updatedRates, updatedCount, addedCount } = applyParsedCatalog(BASE_RATES, items, { supplierName: 'Comptoir Test' });
  strictEqual(updatedCount, 1);
  strictEqual(addedCount, 0);
  strictEqual(updatedRates.length, 2, 'nothing added, nothing removed');
  strictEqual(updatedRates[0].id, 'plaque_ba13_standard');
  strictEqual(updatedRates[0].unitPriceTnd, 33);
  strictEqual(updatedRates[1].unitPriceTnd, 7.8, 'other existing rate untouched');
  strictEqual(JSON.stringify(BASE_RATES), snapshot, 'input rates array not mutated');
});

test('apply: new material (ALU-001) is added with a complete valid MaterialRate shape', () => {
  const items = itemsFromCsv(`material_code,material_name,category,unit,price_ht
ALU-001,Profilé aluminium 3m,aluminium,ml,12.500`, EMPTY_RATES);
  const { updatedRates, updatedCount, addedCount } = applyParsedCatalog(EMPTY_RATES, items, { supplierName: 'Quincaillerie X' });
  strictEqual(updatedCount, 0);
  strictEqual(addedCount, 1);
  strictEqual(updatedRates.length, 1);
  const r = updatedRates[0];
  for (const key of ['id', 'category', 'nameFr', 'nameAr', 'nameEn', 'unit', 'unitPriceTnd', 'defaultPriceTnd']) {
    assertOk(key in r, `MaterialRate requires field "${key}"`);
  }
  strictEqual(r.id, 'alu_001');
  strictEqual(r.category, 'aluminium');
  strictEqual(r.nameFr, 'Profilé aluminium 3m');
  strictEqual(r.nameAr, 'Profilé aluminium 3m', 'nameAr falls back to nameFr');
  strictEqual(r.nameEn, null, 'nameEn is null when no EN column exists');
  strictEqual(r.unit, 'ml');
  strictEqual(r.unitPriceTnd, 12.5);
  strictEqual(r.defaultPriceTnd, 12.5, 'defaultPriceTnd = imported HT price');
  assertOk(typeof r.note === 'string' && r.note.includes('Quincaillerie X'), 'note carries supplier/source');
});

test('apply: mixed file = existing updated + new added + old rates preserved', () => {
  const items = itemsFromCsv(`material_code,material_name,category,unit,price_ht
PLA-BA13-STD,Plaque de plâtre BA13 Standard 1.2x2.5m,placo,unit,33.000
ALU-001,Profilé aluminium 3m,aluminium,ml,12.500
ALU-002,Vis aluminium,aluminium,boite_1000,18.000`, BASE_RATES);
  const { updatedRates, updatedCount, addedCount, duplicateSkipped } = applyParsedCatalog(BASE_RATES, items, { supplierName: 'S' });
  strictEqual(updatedCount, 1);
  strictEqual(addedCount, 2);
  strictEqual(duplicateSkipped, 0);
  strictEqual(updatedRates.length, 4, '2 existing + 2 new');
  strictEqual(updatedRates[0].unitPriceTnd, 33);
  strictEqual(updatedRates[1].id, 'rail_r48');
  strictEqual(updatedRates[1].unitPriceTnd, 7.8, 'untouched existing rate');
  strictEqual(updatedRates[2].id, 'alu_001');
  strictEqual(updatedRates[3].id, 'alu_002');
  strictEqual(updatedRates[3].unit, 'boite_1000', 'unit mapped into the allowed union');
});

test('apply: re-importing the same file does NOT create duplicates (idempotent)', () => {
  const items = itemsFromCsv(`material_code,material_name,category,unit,price_ht
ALU-001,Profilé aluminium 3m,aluminium,ml,12.500
ALU-002,Vis aluminium,aluminium,boite_1000,18.000`, EMPTY_RATES);
  const first = applyParsedCatalog(EMPTY_RATES, items, { supplierName: 'S' });
  strictEqual(first.addedCount, 2);
  const second = applyParsedCatalog(first.updatedRates, items, { supplierName: 'S' });
  strictEqual(second.updatedRates.length, first.updatedRates.length, 'no growth on re-import');
  strictEqual(second.addedCount, 0, 'everything matches by material_code → id');
  strictEqual(second.updatedCount, 2);
  strictEqual(second.updatedRates[0].unitPriceTnd, 12.5);
});

test('apply: duplicate rows inside one file are skipped without duplication', () => {
  const items = itemsFromCsv(`material_code,material_name,category,unit,price_ht
ALU-001,Profilé aluminium 3m,aluminium,ml,12.500
ALU-001,Profilé aluminium 3m,aluminium,ml,13.000`, EMPTY_RATES);
  const { updatedRates, addedCount, duplicateSkipped } = applyParsedCatalog(EMPTY_RATES, items, { supplierName: 'S' });
  strictEqual(addedCount, 1, 'only one new rate created');
  strictEqual(duplicateSkipped, 1);
  strictEqual(updatedRates.length, 1);
  strictEqual(updatedRates[0].unitPriceTnd, 12.5, 'first occurrence wins');
});

test('unit mapping stays inside the allowed MaterialRate union; ids are stable', () => {
  strictEqual(mapImportedUnit('m2'), 'm²');
  strictEqual(mapImportedUnit('M²'), 'm²');
  strictEqual(mapImportedUnit('kg'), 'kg');
  strictEqual(mapImportedUnit('ROULEAU'), 'rouleau');
  strictEqual(mapImportedUnit('metre'), 'mètre');
  strictEqual(mapImportedUnit('ml'), 'ml');
  strictEqual(mapImportedUnit('boite de 1000'), 'boite_1000');
  strictEqual(mapImportedUnit('unité inconnue xyz'), 'unit', 'unknown → safe default');
  strictEqual(mapImportedUnit(''), 'unit');
  strictEqual(slugifyMaterialId('ALU-001'), 'alu_001');
  strictEqual(slugifyMaterialId('alu-001'), slugifyMaterialId('ALU-001'), 'stable across casings');
  strictEqual(slugifyMaterialId('Profilé aluminium 3m'), 'profile_aluminium_3m');
});

// ── 16) Smart Mapping UI contract — ONE canonical value space everywhere ─────
// Reproduces the exact value space used by the UI:
//   appliedMapping[field.key] (state) === <select value> === option value
//   === the exact header key used by the parsed row records.
const ALU_HEADERS = ['material_code', 'material_name', 'category', 'trade', 'unit', 'price_ht', 'tva_rate', 'currency'];

function buildAluTestCsv(): string {
  const lines = [ALU_HEADERS.join(',')];
  for (let i = 1; i <= 40; i++) {
    const code = `ALU-${String(i).padStart(3, '0')}`;
    lines.push(`${code},Profilé aluminium test ${code},aluminium,aluminium,ml,${(10 + i / 100).toFixed(3)},19,TND`);
  }
  return lines.join('\r\n');
}

test('smart mapping UI: canonical fields exist with the exact spec labels (Catégorie + Métier, no fake Métier (code))', () => {
  strictEqual(
    MAPPING_FIELDS.map((f) => f.key as string).join(','),
    'material_code,material_name,category,trade,unit,price_ht,tva_rate,currency,source'
  );
  const labels = new Map(MAPPING_FIELDS.map((f) => [f.key as string, f.label]));
  strictEqual(labels.get('material_code'), 'Référence matériau');
  strictEqual(labels.get('material_name'), 'Désignation matériau');
  strictEqual(labels.get('category'), 'Catégorie');
  strictEqual(labels.get('trade'), 'Métier');
  strictEqual(labels.get('unit'), 'Unité');
  strictEqual(labels.get('price_ht'), 'Prix HT');
  strictEqual(labels.get('tva_rate'), 'Taux TVA');
  strictEqual(labels.get('currency'), 'Devise');
  const requiredKeys = MAPPING_FIELDS.filter((f) => f.required).map((f) => f.key as string).sort().join(',');
  strictEqual(requiredKeys, 'material_name,price_ht,unit', 'only the fields buildParsedItems requires are marked required');
});

test('smart mapping UI: option values are the exact row-record header keys (same space as appliedMapping)', () => {
  const headers = ['Référence', 'Désignation', 'Prix_HT_TND'];
  const opts = optionsForField(headers);
  strictEqual(opts.length, 3);
  for (const opt of opts) {
    assertOk(headers.includes(opt.value), `option value "${opt.value}" is an exact header key`);
    strictEqual(opt.label, opt.value);
  }
});

test('smart mapping UI: aluminium CSV auto-selects every detected field — no "Non mappé" shown for them', () => {
  const rows = parseCsvContent(buildAluTestCsv());
  strictEqual(rows.length, 40);
  const headers = Object.keys(rows[0]);
  const auto = resolveMapping(headers);
  const applied = buildAppliedMapping(headers, auto, {});
  // material_code → Référence matériau, material_name → Désignation matériau,
  // category → Catégorie, trade → Métier, unit → Unité, price_ht → Prix HT,
  // tva_rate → Taux TVA, currency → Devise — all preselected in the Selects.
  strictEqual(applied.material_code, 'material_code');
  strictEqual(applied.material_name, 'material_name');
  strictEqual(applied.category, 'category');
  strictEqual(applied.trade, 'trade');
  strictEqual(applied.unit, 'unit');
  strictEqual(applied.price_ht, 'price_ht');
  strictEqual(applied.tva_rate, 'tva_rate');
  strictEqual(applied.currency, 'currency');
  for (const key of ALU_HEADERS) {
    assertOk((applied as Record<string, string | undefined>)[key] !== '', `detected field "${key}" is never shown as Non mappé`);
  }
});

test('smart mapping UI: optional field absent from the CSV stays "— Non mappé —"', () => {
  const rows = parseCsvContent(buildAluTestCsv()); // no "source" column
  const headers = Object.keys(rows[0]);
  const applied = buildAppliedMapping(headers, resolveMapping(headers), {});
  strictEqual(applied.source, '', 'source is optional and absent → Non mappé');
});

test('smart mapping UI: raw/BOM-mismatched auto-detection value is canonicalized to the exact row key', () => {
  const headers = ['material_code', 'material_name', 'unit', 'price_ht'];
  strictEqual(canonicalHeaderKey('material_code', headers), 'material_code', 'exact match passes through');
  strictEqual(canonicalHeaderKey('\uFEFFmaterial_code', headers), 'material_code', 'BOM stripped');
  strictEqual(canonicalHeaderKey('  Material_Code  ', headers), 'material_code', 'case + spaces normalized');
  strictEqual(canonicalHeaderKey('colonne inconnue', headers), '', 'unknown header → empty');
  // Accent-only differences (plus case/spacing/BOM) resolve to the EXACT key
  // present in the parsed rows — a French CSV keeps its accented headers as
  // row-record keys, so the canonical form must map back onto that exact key:
  const frHeaders = ['Référence', 'Désignation', 'Unité', 'Prix_HT'];
  strictEqual(canonicalHeaderKey('reference', frHeaders), 'Référence', 'accents normalized → exact accented row key');
  strictEqual(canonicalHeaderKey('\uFEFFDESIGNATION', frHeaders), 'Désignation', 'BOM + case on accented row key');
  strictEqual(canonicalHeaderKey('prix  ht', frHeaders), 'Prix_HT', 'spacing normalized on accented row key');
  // A genuinely different word ("Matériau" ≠ "material" once accents are
  // stripped) is NOT canonicalized — no vocabulary/fuzzy guessing between
  // distinct column names:
  strictEqual(canonicalHeaderKey('Matériau code', headers), '', 'different word ≠ accent variant');
  // And buildAppliedMapping applies the same conversion to auto-detection:
  const applied = buildAppliedMapping(headers, { material_code: '\uFEFFmaterial_code' } as ColumnMapping, {});
  strictEqual(applied.material_code, 'material_code');
});

test('smart mapping UI: manual choices survive — auto-detection never overwrites them', () => {
  const rows = parseCsvContent(buildAluTestCsv());
  const headers = Object.keys(rows[0]);
  const auto = resolveMapping(headers);
  strictEqual(auto.trade, 'trade', 'sanity: auto-detection maps trade');
  const userMapping: ColumnMapping = { trade: '', category: 'trade' }; // unmap Métier + manual remap
  const applied = buildAppliedMapping(headers, auto, userMapping);
  strictEqual(applied.trade, '', 'explicitly unmapped field stays unmapped');
  strictEqual(applied.category, 'trade', 'manual remap wins over auto-detection');
  strictEqual(applied.material_code, 'material_code', 'untouched field keeps auto-detection');
  // Idempotent: re-running the merge (as every re-render/re-parse does) is stable.
  const again = buildAppliedMapping(headers, auto, userMapping);
  strictEqual(again.trade, '');
  strictEqual(again.category, 'trade');
});

test('smart mapping UI → confirm: the SAME appliedMapping drives buildParsedItems — 40 ALU lignes à importer, idempotent', () => {
  const rows = parseCsvContent(buildAluTestCsv());
  const headers = Object.keys(rows[0]);
  const applied = buildAppliedMapping(headers, resolveMapping(headers), {});
  const { items, errors } = buildParsedItems(rows, applied, { taxMode: 'ht', tvaRate: 19, rates: EMPTY_RATES });
  strictEqual(errors.length, 0);
  strictEqual(items.length, 40, '40 ligne(s) à importer');
  strictEqual(items[0].materialCode, 'ALU-001');
  strictEqual(items[39].materialCode, 'ALU-040');
  strictEqual(items[0].tvaRate, 19);
  strictEqual(items[0].currency, 'TND');
  // Confirm (applyParsedCatalog) on the very same items: 40 new materials added.
  const first = applyParsedCatalog(EMPTY_RATES, items, { supplierName: 'Konstrivo Test' });
  strictEqual(first.addedCount, 40);
  strictEqual(first.updatedCount, 0);
  const ids = new Set(first.updatedRates.map((r) => r.id));
  assertOk(ids.has('alu_001') && ids.has('alu_020') && ids.has('alu_040'), 'ALU-001…ALU-040 all added');
  // Re-importing the same CSV does NOT create duplicates.
  const second = applyParsedCatalog(first.updatedRates, items, { supplierName: 'Konstrivo Test' });
  strictEqual(second.addedCount, 0, 'no duplicates on re-import');
  strictEqual(second.updatedRates.length, first.updatedRates.length, 'catalog size unchanged');
  strictEqual(second.updatedCount, 40);
});

console.log('\n═══════════════════════════════════════════');
console.log(` CatalogUploadModal: ✅ ${passed} passed | ❌ ${failed} failed`);
console.log('═══════════════════════════════════════════\n');
if (failures.length > 0) {
  console.log('FAILED TESTS:');
  failures.forEach((f) => console.log(f));
  console.log('');
}
process.exit(failed > 0 ? 1 : 0);
