/**
 * GENERIC DATA-DRIVEN CATALOG IMPORT — regression suite (DB-free).
 *
 * The requirement this suite locks down is NOT "fix one file": the import must
 * understand ANY valid catalogue from ANY source, with zero per-file code.
 * Every case below feeds a REAL fixture file through the SAME shared pipeline
 * (parser → value profiles → smart mapping → normalization → validation) and
 * asserts the outcome. No `if (file === ...)`, no `if (trade === ...)` exists
 * anywhere in the engine, and a new file shape is supported by declaring a
 * field in `CANONICAL_FIELDS` only.
 *
 *  FIXTURES (tests/fixtures/catalog/) — the 8 structurally different files:
 *   1. KONSTRIVO_MASTER_CATALOG_csv.csv  multi-trade, EN/FR, product_id + source_url
 *   2. comaf_placo.csv                   supplier export, `sep=;`, accents, HT vs TTC
 *   3. single_trade_default.csv          no trade column → admin defaultTrade
 *   4. multi_trade_catalog.csv           4 métiers + trade label + category
 *   5. catalogue_fr_en_ar.csv            FR/EN/AR headers (BOM, tashkeel, alef, teh marbuta)
 *   6. scraper_batimax.csv               `title`, links, brand; link in a price cell
 *   7. metre_faux_plafond.csv            data-driven `metre_*` for an unknown métier
 *   8. incomplete_invalid.csv            nothing invented, every rejection explained
 *   9. mock_camelcase.csv                real-world camelCase API export (incomplete)
 *
 * Run: npx tsx tests/catalogImportGeneric.test.ts
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

const TN = { countryCode: 'TN', currencyCode: 'TND' };
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'catalog');

/** Reads a fixture and runs it through the SHARED pipeline (same as /preview). */
function loadFixture(file: string, opts?: { bom?: boolean }) {
  const raw = fs.readFileSync(path.join(FIXTURES, file), 'utf8');
  // A BOM is what Excel actually prepends; the parser must see the same bytes.
  const parsed = parseCatalogCsv(opts?.bom ? `\uFEFF${raw}` : raw);
  const mapping = catalog.resolveMapping(parsed.headers, parsed.rows[0], null, parsed.rows);
  return { parsed, mapping };
}

console.log('\n═══════════════════════════════════════════');
console.log(' GENERIC DATA-DRIVEN CATALOG IMPORT');
console.log('═══════════════════════════════════════════\n');

// ════════════════════════════════════════════════════════════════════════════
// 1) MASTER CATALOG — every canonical field resolved from its MEANING
// ════════════════════════════════════════════════════════════════════════════
await test('1. master catalog: product_id/product_name/trade/unit/price/tva/currency/country/source/source_url/dates/status all mapped', () => {
  const { parsed, mapping } = loadFixture('KONSTRIVO_MASTER_CATALOG_csv.csv');
  const m = mapping.appliedMapping;
  assert.equal(m.material_code, 'product_id');
  assert.equal(m.material_name, 'product_name');
  assert.equal(m.trade_code, 'trade_code');
  assert.equal(m.trade_name, 'trade_name');
  assert.equal(m.unit, 'unit');
  assert.equal(m.price_ht, 'price_ht');
  assert.equal(m.tva_rate, 'tva_rate');
  assert.equal(m.currency, 'currency');
  assert.equal(m.market, 'country', '`country` is the market column');
  assert.equal(m.source, 'source');
  assert.equal(m.source_url, 'source_url', 'a `source` column must never steal the URL column');
  assert.equal(m.effective_from, 'effective_from');
  assert.equal(m.observed_at, 'observed_at');
  assert.equal(m.status, 'status');
  assert.deepEqual(mapping.unmappedRequired, [], 'no field may show « Non mappé » here');

  const run = catalog.normalizeAndValidateRows(parsed.rows, m, TN);
  assert.equal(run.failed.length, 0, JSON.stringify(run.failed));
  assert.equal(run.valid.length, 6);
  // Multi-trade in ONE file: each row keeps its OWN métier, no per-trade branch.
  assert.deepEqual([...new Set(run.valid.map((r) => r.trade))].sort(),
    ['electricite', 'peinture', 'placo', 'plomberie']);
  assert.equal(run.valid[0].reference, 'MAT-PLA-001', 'the file reference is used, never a generated one');
  assert.equal(run.valid[0].price, 18.5);
  assert.equal(run.valid[0].tvaRate, 19);
  assert.equal(run.valid[0].source, 'KONSTRIVO_MASTER');
  assert.equal(run.valid[0].sourceUrl, 'https://konstrivo.example/catalogue/mat-pla-001', 'the link is kept verbatim');
  assert.equal(run.valid[0].effectiveFrom, '2026-01-05');
  assert.equal(run.valid[0].observedAt, '2026-01-03');
  assert.equal(run.valid[0].sourceStatus, 'active');
  assert.equal(run.valid[3].sourceStatus, 'pending', 'a file status is stored, not normalized to active');
  assert.equal(run.valid[0].review, undefined, 'clean rows carry no review noise');
});

// ════════════════════════════════════════════════════════════════════════════
// 2) SUPPLIER EXPORT — `sep=;`, accents, and HT vs TTC read by MEANING
// ════════════════════════════════════════════════════════════════════════════
await test('2. comaf supplier file: HT column chosen although TTC also contains `Prix`', () => {
  const { parsed, mapping } = loadFixture('comaf_placo.csv');
  const m = mapping.appliedMapping;
  assert.equal(parsed.headers[0], 'Réf. Article', '`sep=;` directive must not become the header');
  assert.equal(m.material_code, 'Réf. Article');
  assert.equal(m.material_name, 'Désignation');
  assert.equal(m.unit, 'Unité de vente', 'a differently named unit column is still the unit');
  assert.equal(m.price_ht, 'Prix public HT', 'the HT column wins');
  assert.notEqual(m.price_ht, 'Prix public TTC', 'TTC is NEVER read as the HT price');
  assert.equal(m.tva_rate, 'Taux TVA');
  assert.equal(m.observed_at, 'Date observation');
  assert.equal(m.trade_code, 'Famille');
  assert.ok(!Object.values(m).includes('Image'), 'an image column is mapped to nothing');
  assert.ok(!Object.values(m).includes('Fiche PDF'), 'a PDF link column is mapped to nothing');

  const run = catalog.normalizeAndValidateRows(parsed.rows, m, TN);
  assert.equal(run.valid.length, 4, 'the row WITHOUT a price is the only rejection');
  assert.equal(run.failed.length, 1);
  assert.match(run.failed[0].reason, /Prix vide dans la colonne « Prix public HT »/);
  assert.match(run.failed[0].reason, /aucune valeur inventée/);
  assert.equal(run.failed[0].row, 6, 'the row NUMBER of the real file line is reported');
  assert.equal(run.valid[0].price, 18.5, '"18,500" is 18.5 (decimal comma, no rescaling)');
});

// ════════════════════════════════════════════════════════════════════════════
// 3) SINGLE TRADE — no trade column, explicit admin defaultTrade
// ════════════════════════════════════════════════════════════════════════════
await test('3. single-trade file: defaultTrade applied to every row and flagged for review', () => {
  const { parsed, mapping } = loadFixture('single_trade_default.csv');
  const m = mapping.appliedMapping;
  assert.ok(!m.trade_code, 'a file with no trade column must not invent one');
  assert.deepEqual(mapping.unmappedRequired, ['trade_code']);
  assert.equal(m.material_code, 'SKU');
  assert.equal(m.material_name, 'Designation');
  assert.equal(m.price_ht, 'Prix');
  assert.equal(m.currency, 'Devise');
  assert.equal(m.source, 'Source');

  const run = catalog.normalizeAndValidateRows(parsed.rows, m, TN, 'plomberie');
  assert.equal(run.failed.length, 0, JSON.stringify(run.failed));
  assert.equal(run.valid.length, 4);
  assert.ok(run.valid.every((r) => r.trade === 'plomberie'));
  assert.ok(run.valid.every((r) => r.review?.some((n) => n.includes("Métier par défaut 'plomberie'"))));
});

await test('3b. same file WITHOUT defaultTrade → sentinel trade + explicit review (never a guess)', () => {
  const { parsed, mapping } = loadFixture('single_trade_default.csv');
  const run = catalog.normalizeAndValidateRows(parsed.rows, mapping.appliedMapping, TN);
  assert.equal(run.failed.length, 0, 'the file still reads: a missing métier is reported, not fatal');
  assert.ok(run.valid.every((r) => r.trade === 'unmapped_review'));
  assert.ok(run.valid.every((r) => r.review?.includes('Missing Categorie (trade) — requires review.')));
});

// ════════════════════════════════════════════════════════════════════════════
// 4) MULTI TRADE — code, label and category kept SEPARATELY
// ════════════════════════════════════════════════════════════════════════════
await test('4. multi-trade file: Metier/Libelle_Metier/Categorie resolved without competing', () => {
  const { parsed, mapping } = loadFixture('multi_trade_catalog.csv');
  const m = mapping.appliedMapping;
  assert.equal(m.trade_code, 'Metier', 'the exact-alias column wins over the keyword-only label column');
  assert.equal(m.trade_name, 'Libelle_Metier');
  assert.equal(m.category, 'Categorie', 'the category stays its OWN field (never merged into the trade)');
  assert.equal(m.effective_from, 'Date_debut');
  const run = catalog.normalizeAndValidateRows(parsed.rows, m, TN);
  assert.equal(run.failed.length, 0, JSON.stringify(run.failed));
  assert.deepEqual([...new Set(run.valid.map((r) => r.trade))].sort(),
    ['carrelage', 'menuiserie_alu', 'peinture', 'terrassement']);
  assert.equal(run.valid[2].tradeLabel, 'Menuiserie aluminium');
  assert.equal(run.valid[2].category, 'Profilés');
  assert.ok(run.valid.every((r) => r.review === undefined), 'a fully described file needs no review note');
});

// ════════════════════════════════════════════════════════════════════════════
// 5) FR / EN / AR HEADERS — BOM, tashkeel, alef, teh marbuta, accents, spaces
// ════════════════════════════════════════════════════════════════════════════
await test('5. bilingual FR/EN/AR file (BOM + tashkeel + alef + teh marbuta): all fields mapped', () => {
  const { parsed, mapping } = loadFixture('catalogue_fr_en_ar.csv', { bom: true });
  const m = mapping.appliedMapping;
  assert.equal(parsed.headers[0], 'كود_المنتج', 'the BOM must not corrupt the first header');
  assert.equal(m.material_code, 'كود_المنتج');
  assert.equal(m.material_name, 'اسم_المادة');
  assert.equal(m.trade_code, 'المهنة');
  assert.equal(m.price_ht, 'السعر');
  assert.equal(m.unit, 'الوحدة');
  assert.equal(m.tva_rate, 'الإداءُ على القيمة المضافة', 'tashkeel/alef/teh-marbuta spelling still resolves');
  assert.equal(m.source_url, 'رابط_المنتج');
  assert.equal(m.observed_at, 'تاريخ_الملاحظة');
  assert.notEqual(m.price_ht, 'الثمن_مع_الضريبة', 'the TTC column is never the price');
  assert.deepEqual(mapping.unmappedRequired, []);

  const run = catalog.normalizeAndValidateRows(parsed.rows, m, TN);
  assert.equal(run.failed.length, 0, JSON.stringify(run.failed));
  assert.equal(run.valid.length, 4);
  assert.equal(run.valid[0].nameFr, 'دهان أكريليك جدران أبيض 10 لتر', 'the REAL Arabic designation is stored');
  assert.equal(run.valid[0].price, 245);
  assert.equal(run.valid[0].sourceUrl, 'https://mtvin.example/produit/mtv-pei-01');
  assert.deepEqual([...new Set(run.valid.map((r) => r.trade))].sort(), ['carrelage', 'isolation', 'peinture']);
});

// ════════════════════════════════════════════════════════════════════════════
// 6) SCRAPER EXPORT — links stay links, titles become designations
// ════════════════════════════════════════════════════════════════════════════
await test('6. scraper file: title → material_name, product_url → source_url, image/ref links unmapped', () => {
  const { parsed, mapping } = loadFixture('scraper_batimax.csv');
  const m = mapping.appliedMapping;
  assert.equal(m.material_name, 'title', '`title` is the designation of the scraped row');
  assert.equal(m.source_url, 'product_url', 'the product page is the source link');
  assert.ok(!Object.values(m).includes('image_url'), 'an IMAGE link is never the source page');
  assert.ok(!Object.values(m).includes('reference_link'), 'a category link is mapped by nothing');
  assert.ok(!m.material_code, '`reference_link` holds links → it can never be the material code');
  assert.equal(m.price_ht, 'price');
  assert.equal(m.source, 'brand', 'the brand column names the source');

  const run = catalog.normalizeAndValidateRows(parsed.rows, m, TN, 'peinture');
  // The 4 rows with a real price import under a generated code; the row whose
  // price cell holds a link is refused, and the rest of the file is unaffected.
  assert.equal(run.valid.length, 4, JSON.stringify(run.failed));
  assert.equal(run.failed.length, 1);
  assert.match(run.failed[0].reason, /contient un lien et non un prix HT/);
  assert.match(run.failed[0].reason, /aucun prix inventé/);
  assert.ok(run.valid.every((r) => r.reference.includes('_'), 'no stable id in the file → deterministic generated code'));
  assert.ok(run.valid.every((r) => r.review?.includes('Generated material_code from material name')));
  assert.equal(run.valid[0].sourceUrl, 'https://batimax.example/produit/peinture-acrylique-blanche-10l');
  assert.equal(run.valid[0].source, 'BATIMAX');
});

await test('6b. link-valued columns are never auto-mapped to a text field (generic veto)', () => {
  const headers = ['Reference', 'Designation', 'Prix', 'url_prix', 'date_prix', 'image'];
  const rows = [
    { Reference: 'A1', Designation: 'Ciment', Prix: '12.5', url_prix: 'https://x.example/a1', date_prix: 'https://x.example/d1', image: 'https://cdn.example/a1.jpg' },
    { Reference: 'A2', Designation: 'Sable', Prix: '8.0', url_prix: 'https://x.example/a2', date_prix: 'https://x.example/d2', image: 'https://cdn.example/a2.jpg' },
  ];
  const m = catalog.resolveMapping(headers, rows[0], null, rows).appliedMapping;
  assert.equal(m.price_ht, 'Prix');
  assert.equal(m.material_code, 'Reference');
  assert.equal(m.material_name, 'Designation');
  assert.equal(m.source_url, 'url_prix', 'the link column is the SOURCE LINK, not a price');
  assert.notEqual(m.price_ht, 'url_prix');
  assert.notEqual(m.effective_to, 'date_prix', 'a column of links is never a date');
  assert.ok(!Object.values(m).includes('image'), 'a media link is never the source page');
});

// ════════════════════════════════════════════════════════════════════════════
// 7) DATA-DRIVEN MÉTRÉ — a brand new métier described ONLY by its file
// ════════════════════════════════════════════════════════════════════════════
await test('7. metre_* file for an unknown métier: elements parsed per row, bad ones degraded', () => {
  const { parsed, mapping } = loadFixture('metre_faux_plafond.csv');
  const m = mapping.appliedMapping;
  assert.equal(m.metre_element_id, 'metre_element_id');
  assert.equal(m.metre_element_label_fr, 'metre_element_fr');
  assert.equal(m.metre_element_label_ar, 'metre_element_ar');
  assert.equal(m.metre_method, 'metre_methode');
  assert.equal(m.metre_dims, 'metre_dims');
  assert.equal(m.metre_calc, 'metre_calcul');
  assert.equal(m.metre_qty_unit, 'metre_qty_unit');

  const run = catalog.normalizeAndValidateRows(parsed.rows, m, TN);
  assert.equal(run.failed.length, 0, 'a métré problem must NEVER reject the material row');
  assert.equal(run.valid.length, 6);
  assert.ok(run.valid.every((r) => r.trade === 'faux_plafond'), 'the métier comes from the file, not from code');
  const withMetre = run.valid.filter((r) => r.metre);
  assert.deepEqual(withMetre.map((r) => r.metre!.elementCode), ['plafond_ba13', 'isolant_plafond', 'querre_angle']);
  assert.equal(withMetre[0].metre!.method, 'surface');
  assert.equal(withMetre[2].metre!.method, 'longueur');
  assert.equal(withMetre[2].metre!.qtyUnit, 'ml');
  assert.deepEqual(withMetre[0].metre!.dims, [
    { key: 'largeur', labelFr: 'Largeur', labelAr: 'العرض', unit: 'm' },
    { key: 'longueur', labelFr: 'Longueur', labelAr: 'الطول', unit: 'm' },
  ]);
  // Unknown method, calc referencing an undeclared dim → metadata dropped,
  // row kept, and the Admin is TOLD why (config fallback applies).
  const degraded = run.valid.filter((r) => !r.metre && r.review?.some((n) => n.includes('métré')));
  assert.deepEqual(degraded.map((r) => r.reference), ['FPC-CORN-25', 'FPL-STIL-60']);
  // A row with empty métré cells is simply a material — no noise.
  const plain = run.valid.find((r) => r.reference === 'FPE-JOINT-50');
  assert.equal(plain?.metre, undefined);
  assert.equal(plain?.review, undefined);
});

// ════════════════════════════════════════════════════════════════════════════
// 8) INCOMPLETE / INVALID — explained, never repaired by invention
// ════════════════════════════════════════════════════════════════════════════
await test('8. invalid rows each carry their own reason while the valid ones import', () => {
  const { parsed, mapping } = loadFixture('incomplete_invalid.csv');
  const m = mapping.appliedMapping;
  assert.equal(m.price_ht, 'Prix_Net', '`Prix_Net` is the price column');
  assert.ok(!Object.values(m).includes('Valeur_TTC'), 'a TTC value column is never mapped as the HT price');
  assert.equal(m.effective_to, 'Date_fin_validite');
  assert.equal(m.currency, 'Monnaie');
  assert.deepEqual(mapping.unmappedRequired, ['trade_code'], 'the missing métier is declared, not guessed');

  const run = catalog.normalizeAndValidateRows(parsed.rows, m, TN);
  assert.equal(run.valid.length, 3, 'the good rows of a partly bad file are still readable');
  assert.equal(run.failed.length, 2);
  const reasons = run.failed.map((f) => f.reason).join(' | ');
  assert.match(reasons, /Invalid effective_to '99\/99\/9999'/, 'non-ISO date named with its raw value');
  assert.match(reasons, /Price must be >= 0/, 'a negative price is refused, never abs()olved');
  // The USD row is NOT rejected any more: the row's OWN valid currency is
  // PRESERVED (the TN selection is a fallback only — nothing is ever silently
  // converted, and a divergence never invalidates a healthy row).
  assert.equal(
    run.valid.find((r) => r.reference === 'ISO-PS-10')!.currencyCode,
    'USD',
    'the row keeps its own currency instead of being coerced/rejected'
  );
  assert.deepEqual(run.failed.map((f) => f.row), [4, 5], 'the failing file lines are identified');
});

await test('8b. incomplete file: nothing is invented — unmapped fields + per-row reasons', () => {
  const { parsed, mapping } = loadFixture('mock_camelcase.csv');
  const m = mapping.appliedMapping;
  assert.equal(m.material_code, 'id', '`id` is accepted as the reference only because no real code column exists');
  assert.equal(m.price_ht, 'priceHT', 'camelCase header spacing folded to the canonical spelling');
  assert.equal(m.observed_at, 'observedAt');
  assert.ok(!m.material_name, 'no designation column → reported, never fabricated');
  assert.deepEqual(mapping.unmappedRequired.sort(), ['material_name', 'trade_code']);

  const run = catalog.normalizeAndValidateRows(parsed.rows, m, TN, 'electricite');
  assert.equal(run.valid.length, 0, 'a file without designations cannot be imported');
  assert.equal(run.failed.length, 2);
  assert.ok(run.failed.every((f) => /Missing Nom_Materiau/.test(f.reason)));
});

// ════════════════════════════════════════════════════════════════════════════
// 9) GENERIC SAFEGUARDS — the rules that make the engine file-agnostic
// ════════════════════════════════════════════════════════════════════════════
await test('9. isUrlLikeValue: real addresses yes, dotted codes / dates / units no', () => {
  const links = ['https://x.example/a/b', 'http://localhost:3000/p', 'www.example.com/tpe', 'example.com/fiche.pdf', 'ftp://files.example/a'];
  const notLinks = ['4.1/m2', 'BA13.STD', '2026-01-05', '1 500,25', 'm²', '12.5', 'REF/2026', 'user@example.com', 'C:/tmp'];
  links.forEach((v) => assert.ok(catalog.isUrlLikeValue(v), `${v} must be a link`));
  notLinks.forEach((v) => assert.ok(!catalog.isUrlLikeValue(v), `${v} must NOT be a link`));
});

await test('9b. camelCase folding is additive (existing spellings byte-stable)', () => {
  assert.equal(catalog.normalizeHeader('observedAt'), 'observed_at');
  assert.equal(catalog.normalizeHeader('unitPrice'), 'unit_price');
  assert.equal(catalog.normalizeHeader('productID'), 'product_id');
  assert.equal(catalog.normalizeHeader('Prix_HT_TND'), 'prix_ht_tnd');
  assert.equal(catalog.normalizeHeader('Product-ID'), 'product_id');
  assert.equal(catalog.normalizeHeader('\uFEFFRéférence Matériau'), 'reference_materiau');
});

await test('9c. ambiguous competitors are never guessed; an explicit admin mapping still wins', () => {
  const headers = ['Reference', 'Designation', 'Metier', 'valeur_prix', 'prix_fournisseur'];
  const rows = [{ Reference: 'A', Designation: 'B', Metier: 'placo', valeur_prix: '10', prix_fournisseur: '12' }];
  const auto = catalog.resolveMapping(headers, rows[0], null, rows);
  assert.ok(!auto.appliedMapping.price_ht, 'two equal price candidates → the engine refuses to choose');
  assert.deepEqual(auto.unmappedRequired, ['price_ht']);
  // The Admin decides. A manual choice is authoritative (the vetoes above only
  // gate AUTO-suggestion), and it is resolved BOM/case/accent-insensitively.
  const chosen = catalog.resolveMapping(headers, rows[0], { price_ht: 'prix_fournisseur' }, rows);
  assert.equal(chosen.appliedMapping.price_ht, 'prix_fournisseur');
  assert.deepEqual(chosen.unmappedRequired, []);
  assert.deepEqual(chosen.mappingErrors, []);
});

await test('9d. the Admin field list comes FROM the registry (one declaration only)', () => {
  const keys = catalog.PREVIEW_FIELDS.map((f) => f.key);
  for (const field of catalog.CANONICAL_FIELDS) {
    assert.ok(keys.includes(field.key), `${field.key} missing from the Admin mapping list`);
  }
  assert.deepEqual(catalog.REQUIRED_FIELD_KEYS, ['material_code', 'material_name', 'trade_code', 'price_ht']);
  // `source_url` and every `metre_*` field are mappable from the UI without a
  // second list in the route (that duplicate used to hide them).
  assert.ok(keys.includes('source_url'));
  assert.ok(keys.filter((k) => k.startsWith('metre_')).length >= 7);
});

await test('9e. no per-file / per-trade branch exists in the engine', () => {
  const ENGINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'services', 'catalogImport.ts');
  const src = fs.readFileSync(ENGINE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/if\s*\(\s*trade\s*===/.test(src), 'the engine must not special-case a métier');
  assert.ok(!/comaf|batimax|master_catalog/i.test(src), 'the engine must not know any supplier file');
});

// The legacy KONSTRIVO Phase A export (the header contract of
// tests/catalogImportCsv.test.ts): `Nom_Arabe` is the ARABIC NAME of the
// material. It was previously captured by `trade_name` through the bare
// keyword `nom` — a generic registry bug, invisible until this file shape was
// compared with the others. Locked here so no future keyword can steal it.
await test('9f. legacy Phase A header: Nom_Arabe is name_ar, never trade_name', () => {
  const headers = ['Reference', 'Nom_Materiau', 'Categorie', 'Unite', 'Prix_TND_HT', 'Note_Technique', 'Nom_Arabe'];
  const row = { Reference: 'REF1', Nom_Materiau: 'Plaque BA13', Categorie: 'placo', Unite: 'unit', Prix_TND_HT: '31.5', Note_Technique: 'note', Nom_Arabe: 'بلاك' };
  const { appliedMapping } = catalog.resolveMapping(headers, row, null, [row]);
  assert.equal(appliedMapping.material_code, 'Reference');
  assert.equal(appliedMapping.material_name, 'Nom_Materiau');
  assert.equal(appliedMapping.trade_code, 'Categorie');
  assert.equal(appliedMapping.price_ht, 'Prix_TND_HT');
  assert.equal(appliedMapping.unit, 'Unite');
  assert.equal(appliedMapping.note, 'Note_Technique');
  assert.equal(appliedMapping.name_ar, 'Nom_Arabe');
  assert.ok(!appliedMapping.trade_name, 'a material-name column must never become the métier label');
});

// ════════════════════════════════════════════════════════════════════════════
// 10) PER-ROW IMPORT — 45 lignes → 31 valides + 14 rejetées, correction,
//     ré-import. The engine is STATELESS: every upload is re-analyzed from
//     scratch, rejected rows are never "rejected forever".
// ════════════════════════════════════════════════════════════════════════════
/** Build the 45-row file in memory: 31 valid + 14 broken rows, each with its
 * own defect (5 empty prices, 4 URL-in-price, 3 missing designations,
 * 1 negative price, 1 over-long unit). */
function buildMixed45(fixed: boolean): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  const R = (id: string, name: string, price: string, unit = 'unit') =>
    ({ product_id: id, product_name: name, trade: 'placo', unit, price });
  for (let i = 1; i <= 31; i++) rows.push(R(`MIX-${i}`, `Matériau mixte ${i}`, '10,50'));
  for (let i = 1; i <= 5; i++) rows.push(R(`MIX-EMPTY-${i}`, `Prix vide ${i}`, fixed ? '12,00' : ''));
  for (let i = 1; i <= 4; i++) rows.push(R(`MIX-URL-${i}`, `Prix lien ${i}`, fixed ? '13,00' : `https://fournisseur.example/produit/${i}`));
  for (let i = 1; i <= 3; i++) rows.push(R(`MIX-NONAME-${i}`, fixed ? `Désignation ajoutée ${i}` : '', fixed ? '14,00' : '9,00'));
  rows.push(R('MIX-NEG', 'Prix négatif', fixed ? '15,00' : '-5'));
  rows.push(R('MIX-UNIT', 'Unité trop longue', fixed ? '8,00' : '7,50', fixed ? 'unit' : 'x'.repeat(25)));
  return rows;
}

await test('10. 45-row file → 31 valides + 14 rejetées, each rejection carrying its own reason', () => {
  const rows = buildMixed45(false);
  const headers = Object.keys(rows[0]);
  const { appliedMapping } = catalog.resolveMapping(headers, rows[0], null, rows);
  assert.equal(appliedMapping.material_code, 'product_id');
  assert.equal(appliedMapping.material_name, 'product_name');
  assert.deepEqual(appliedMapping.trade_code ? [] : ['trade_code'], [], 'the trade column is detected');
  assert.equal(appliedMapping.price_ht, 'price');

  const run = catalog.normalizeAndValidateRows(rows, appliedMapping, TN);
  assert.equal(run.valid.length, 31, 'one broken row never blocks the valid ones');
  assert.equal(run.failed.length, 14);
  const joined = run.failed.map((f) => f.reason).join(' | ');
  assert.equal(run.failed.filter((f) => /Prix vide/.test(f.reason)).length, 5, 'empty price → row-only rejection');
  assert.equal(run.failed.filter((f) => /contient un lien et non un prix/.test(f.reason)).length, 4, 'URL in price → rejection, NEVER a guessed price');
  assert.equal(run.failed.filter((f) => /Missing Nom_Materiau/.test(f.reason)).length, 3);
  assert.equal(run.failed.filter((f) => /Price must be >= 0/.test(f.reason)).length, 1);
  assert.equal(run.failed.filter((f) => /Unit too long/.test(f.reason)).length, 1);
  assert.ok(joined.length > 0);
  assert.deepEqual([...new Set(run.failed.map((f) => f.row))].length, 14, 'every rejection names its file line');
  // The valid rows carry their REAL file values — nothing invented.
  assert.ok(run.valid.every((v) => v.price === 10.5 && v.trade === 'placo'));
});

await test('10b. correction puis ré-import: fixed file → 45 valides + 0 rejetées (stateless, from scratch)', () => {
  const headers = ['product_id', 'product_name', 'trade', 'unit', 'price'];
  const broken = buildMixed45(false);
  const first = catalog.normalizeAndValidateRows(broken, catalog.resolveMapping(headers, broken[0], null, broken).appliedMapping, TN);
  const second = catalog.normalizeAndValidateRows(broken, catalog.resolveMapping(headers, broken[0], null, broken).appliedMapping, TN);
  assert.deepEqual(second.failed, first.failed, 're-uploading the SAME file re-analyzes it identically (no stored verdict)');

  const fixed = buildMixed45(true);
  const m = catalog.resolveMapping(headers, fixed[0], null, fixed).appliedMapping;
  const run = catalog.normalizeAndValidateRows(fixed, m, TN);
  assert.equal(run.failed.length, 0, 'the previously rejected rows are importable once fixed');
  assert.equal(run.valid.length, 45, '45 lignes → 45 importables');
});

// ════════════════════════════════════════════════════════════════════════════
console.log('\n═══════════════════════════════════════════');
console.log(` Generic catalog import: ${passed} passed, ${failed} failed`);
if (failures.length) console.log(failures.join('\n'));
console.log('═══════════════════════════════════════════\n');
if (failed > 0) process.exit(1);
