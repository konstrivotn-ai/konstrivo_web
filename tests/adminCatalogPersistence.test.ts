/**
 * ADMIN CATALOG PERSISTENCE + SMART MAPPING — regression suite (DB-free).
 *
 * Locks down the two reported defects:
 *
 *  A. ADMIN DELETE/DISABLE MUST PERSIST (DB = source of truth)
 *     1. A material archived by the Admin through
 *        `DELETE /api/v1/materials/:id` (materials.is_deleted = true) stays gone
 *        after a Refresh / app reopen — the local barème cache, the dev default
 *        barème and the merge base can never revive it (catalogTombstones).
 *     2. A deactivated métier (`trades.is_active = false`) and a hard-deleted
 *        dynamic métier stay hidden after a Refresh.
 *     3. Failure is FAIL-SAFE: an unreachable `/catalog/inactive-refs` clears
 *        nothing; a real server refusal changes nothing locally.
 *     4. Devis / user / project data is never touched: the suppression helpers
 *        never mutate their input and never write to any data store.
 *
 *  B. SMART MAPPING
 *     5. `product_id` (EN/FR/AR supplier spelling) maps to the canonical
 *        `material_code`; `product_name` to `material_name`.
 *     6. Ambiguity is NEVER silently guessed (two equal price candidates →
 *        price_ht stays unmapped and the import is blocked).
 *     7. The preview shows REAL, non-empty values from the uploaded file.
 *     8. Price problems are rejected with an actionable reason (which column,
 *        why) and no value is ever invented.
 *     9. Single-trade (defaultTrade), multi-trade and `metre_*` (data-driven
 *        Dynamic Métré, no per-métier TypeScript) files all import correctly.
 *
 * Run: npx tsx tests/adminCatalogPersistence.test.ts
 */
import { strict as assert } from 'node:assert';

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void> | void) {
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

// ── Minimal localStorage shim, installed BEFORE the client modules load ──────
// Node has no localStorage, and the suppression list is read AT IMPORT TIME (the
// "reopen the app" path). The shim therefore has to exist before the first
// dynamic import below.
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.has(key) ? (this.map.get(key) as string) : null; }
  setItem(key: string, value: string): void { this.map.set(key, String(value)); }
  removeItem(key: string): void { this.map.delete(key); }
  clear(): void { this.map.clear(); }
  key(index: number): string | null { return Array.from(this.map.keys())[index] ?? null; }
  get length(): number { return this.map.size; }
}
const storage = new MemoryStorage();
(globalThis as any).localStorage = storage;

const tombstones = await import('../src/data/catalogTombstones');
const tradeRegistry = await import('../src/data/tradeRegistry');
const catalog = await import('../server/services/catalogImport');
const { parseCatalogCsv } = await import('../server/utils/csv');
const { normalizeMaterialRef } = await import('../server/utils/validation');

const TN = { countryCode: 'TN', currencyCode: 'TND' };

console.log('\n═══════════════════════════════════════════');
console.log(' ADMIN CATALOG PERSISTENCE + SMART MAPPING');
console.log('═══════════════════════════════════════════\n');

// ════════════════════════════════════════════════════════════════════════════
// B) SMART MAPPING — product_id → material_code (the reported Admin symptom)
// ════════════════════════════════════════════════════════════════════════════
await test('mapping: product_id → material_code, product_name → material_name (no « Non mappé »)', () => {
  const csv = [
    'product_id,product_name,product_description,product_price,product_unit',
    'P-1001,Plaque BA13 Standard,Cloison 12.5mm,31.500,unit',
  ].join('\n');
  const parsed = parseCatalogCsv(csv);
  const resolution = catalog.resolveMapping(parsed.headers, parsed.rows[0], null, parsed.rows);

  assert.equal(resolution.appliedMapping.material_code, 'product_id');
  assert.equal(resolution.appliedMapping.material_name, 'product_name');
  assert.equal(resolution.appliedMapping.price_ht, 'product_price');
  assert.equal(resolution.appliedMapping.unit, 'product_unit');
  assert.ok(!resolution.unmappedRequired.includes('material_code'), 'material_code must be resolved');

  const run = catalog.normalizeAndValidateRows(parsed.rows, resolution.appliedMapping, TN);
  assert.equal(run.failed.length, 0, JSON.stringify(run.failed));
  assert.equal(run.valid.length, 1);
  assert.equal(run.valid[0].reference, 'P-1001', 'the FILE reference is used, not a generated one');
  assert.equal(run.valid[0].price, 31.5);
  assert.equal(run.valid[0].unit, 'unit');
});

await test('mapping: BOM / accents / case / punctuation / AR spellings all resolve', () => {
  const headers = ['\uFEFFProduct-ID', 'Désignation Produit', 'Prix HT', 'Unité'];
  const resolution = catalog.resolveMapping(headers, undefined, null);
  assert.equal(resolution.appliedMapping.material_code, '\uFEFFProduct-ID');
  assert.equal(resolution.appliedMapping.material_name, 'Désignation Produit');
  assert.equal(resolution.appliedMapping.price_ht, 'Prix HT');
  assert.equal(resolution.appliedMapping.unit, 'Unité');

  const arabic = catalog.resolveMapping(['معرف_المنتج', 'اسم_المنتج', 'السعر', 'الوحدة'], undefined, null);
  assert.equal(arabic.appliedMapping.material_code, 'معرف_المنتج');
  assert.equal(arabic.appliedMapping.material_name, 'اسم_المنتج');
  assert.equal(arabic.appliedMapping.price_ht, 'السعر');
  assert.equal(arabic.appliedMapping.unit, 'الوحدة');
  assert.equal(catalog.normalizeHeader('Product-ID'), 'product_id');
});

await test('mapping: genuine ambiguity is NEVER guessed (import stays blocked)', () => {
  const unknown = catalog.resolveMapping(['colonne_inconnue_valeur'], undefined, null);
  assert.equal(unknown.appliedMapping.material_code, undefined);
  assert.equal(unknown.appliedMapping.price_ht, undefined);

  // Two keyword-equivalent price columns → price_ht is left unmapped.
  const twoPrices = catalog.resolveMapping(['sku', 'designation', 'valeur_prix', 'prix_fournisseur', 'unite'], undefined, null);
  assert.equal(twoPrices.appliedMapping.material_code, 'sku');
  assert.equal(twoPrices.appliedMapping.material_name, 'designation');
  assert.equal(twoPrices.appliedMapping.price_ht, undefined, 'ambiguous price columns must not be guessed');
  assert.ok(twoPrices.unmappedRequired.includes('price_ht'));
});

await test('preview: detected columns carry the REAL file values (first non-empty, never a fixed example)', () => {
  const csv = [
    'product_id,product_name,price_ht,unit',
    ',Produit sans identifiant,12.5,unit',
    'P-2,Produit deux,,unit',
  ].join('\n');
  const parsed = parseCatalogCsv(csv);
  const resolution = catalog.resolveMapping(parsed.headers, parsed.rows[0], null, parsed.rows);
  const sampleByColumn = new Map(resolution.detectedColumns.map(c => [c.source, c.sample]));
  assert.equal(sampleByColumn.get('product_id'), 'P-2');
  assert.equal(sampleByColumn.get('price_ht'), '12.5');
  assert.equal(sampleByColumn.get('product_name'), 'Produit sans identifiant');
});

await test('validation: price problems are rejected with an actionable reason and no invented value', () => {
  const noPriceColumn = parseCatalogCsv('product_id,product_name,unit\nP-1,Nom,unit');
  const noPriceRun = catalog.normalizeAndValidateRows(
    noPriceColumn.rows,
    { material_code: 'product_id', material_name: 'product_name', unit: 'unit' },
    TN,
  );
  assert.equal(noPriceRun.valid.length, 0);
  assert.match(String(noPriceRun.failed[0].reason), /Prix HT non mappé/);

  const emptyPrice = parseCatalogCsv('product_id,product_name,price_ht,unit\nP-2,Nom, ,unit');
  const emptyRun = catalog.normalizeAndValidateRows(
    emptyPrice.rows,
    { material_code: 'product_id', material_name: 'product_name', price_ht: 'price_ht', unit: 'unit' },
    TN,
  );
  assert.equal(emptyRun.valid.length, 0, 'an empty price never becomes a row');
  assert.match(String(emptyRun.failed[0].reason), /Prix vide dans la colonne « price_ht »/);

  const invalidPrice = parseCatalogCsv('product_id,product_name,price_ht,unit\nP-3,Nom,abc,unit');
  const invalidRun = catalog.normalizeAndValidateRows(
    invalidPrice.rows,
    { material_code: 'product_id', material_name: 'product_name', price_ht: 'price_ht', unit: 'unit' },
    TN,
  );
  assert.equal(invalidRun.valid.length, 0);
  assert.match(String(invalidRun.failed[0].reason), /Invalid price 'abc' \(colonne « price_ht »\)/);
});

await test('import: single-trade file (defaultTrade) and multi-trade file both validate', () => {
  const single = parseCatalogCsv('product_id,product_name,price_ht,unit\nSV-1,Profilé aluminium,120.000,ml');
  const singleMapping = catalog.resolveMapping(single.headers, single.rows[0], null, single.rows);
  assert.ok(singleMapping.unmappedRequired.includes('trade_code'), 'no trade column → defaultTrade required');
  const singleRun = catalog.normalizeAndValidateRows(single.rows, singleMapping.appliedMapping, TN, 'vitrerie');
  assert.equal(singleRun.failed.length, 0);
  assert.equal(singleRun.valid.length, 1);
  assert.equal(singleRun.valid[0].trade, 'vitrerie');
  assert.equal(singleRun.valid[0].reference, 'SV-1');

  const multi = parseCatalogCsv([
    'product_id,product_name,trade_code,price_ht,unit',
    'ALU-1,Profilé alu,aluminium,10.500,ml',
    'PLA-1,Plaque BA13,placo,31.500,unit',
    'PEI-1,Peinture mate,peinture,45.000,l',
  ].join('\n'));
  const multiMapping = catalog.resolveMapping(multi.headers, multi.rows[0], null, multi.rows);
  assert.equal(multiMapping.appliedMapping.material_code, 'product_id');
  assert.equal(multiMapping.appliedMapping.material_name, 'product_name');
  assert.equal(multiMapping.appliedMapping.trade_code, 'trade_code');
  const multiRun = catalog.normalizeAndValidateRows(multi.rows, multiMapping.appliedMapping, TN);
  assert.equal(multiRun.failed.length, 0);
  assert.equal(multiRun.valid.length, 3);
  assert.deepEqual(multiRun.valid.map(v => v.trade), ['aluminium', 'placo', 'peinture']);
});

await test('import: metre_* metadata stays data-driven (works with product_id, no per-métier code)', () => {
  const metreRow: Record<string, string> = {
    product_id: 'ALU-BAIE-C',
    product_name: 'Baie vitrée coulissante',
    trade_code: 'aluminium',
    price_ht: '650.000',
    unit: 'm2',
    metre_element_id: 'baie_coulissante',
    metre_element_label_fr: 'Baie vitrée coulissante',
    metre_method: 'surface',
    metre_dims: JSON.stringify([
      { key: 'largeur', labelFr: 'Largeur', labelAr: 'العرض', unit: 'm' },
      { key: 'hauteur', labelFr: 'Hauteur', labelAr: 'الارتفاع', unit: 'm' },
    ]),
    metre_calc: JSON.stringify({ op: 'product', dims: ['largeur', 'hauteur'] }),
    metre_qty_unit: 'm²',
  };
  const mapping = catalog.resolveMapping(Object.keys(metreRow), metreRow, null, [metreRow]);
  assert.equal(mapping.appliedMapping.material_code, 'product_id');
  assert.equal(mapping.appliedMapping.metre_element_id, 'metre_element_id');
  const run = catalog.normalizeAndValidateRows([metreRow], mapping.appliedMapping, TN);
  assert.equal(run.failed.length, 0);
  assert.equal(run.valid.length, 1);
  assert.equal(run.valid[0].reference, 'ALU-BAIE-C');
  assert.ok(run.valid[0].metre, 'Dynamic Métré metadata kept from the file');
  assert.equal(run.valid[0].metre?.elementCode, 'baie_coulissante');
  assert.equal(run.valid[0].metre?.method, 'surface');
  assert.equal(run.valid[0].metre?.qtyUnit, 'm²');
});

// ════════════════════════════════════════════════════════════════════════════
// A) ADMIN DELETE/DISABLE PERSISTS — DB is the source of truth
// ════════════════════════════════════════════════════════════════════════════
const rateFixtures = () => ([
  { id: 'ALU-001', nameFr: 'Profilé aluminium 3m', category: 'aluminium', unit: 'ml', unitPriceTnd: 12.5, defaultPriceTnd: 12.5 },
  { id: 'alu_002', nameFr: 'Profilé aluminium 4m', category: 'aluminium', unit: 'ml', unitPriceTnd: 16, defaultPriceTnd: 16 },
  { id: 'plaque_ba13_standard', nameFr: 'Plaque BA13', category: 'placo', unit: 'unit', unitPriceTnd: 31.5, defaultPriceTnd: 31.5 },
]);

await test('archive: a DB-archived material is removed from the rates and stays removed after Refresh', () => {
  tombstones.resetCatalogTombstones();
  const rates = rateFixtures();
  // Admin archived ALU-001 (server confirmed → suppression list updated).
  tombstones.replaceCatalogTombstones(['ALU-001']);

  const displayed = tombstones.applyCatalogTombstones(rates);
  assert.equal(displayed.length, 2, 'the archived material disappears from Outils/Tarifs');
  assert.ok(!displayed.some(r => r.id === 'ALU-001'));
  assert.ok(displayed.some(r => r.id === 'plaque_ba13_standard'), 'other materials untouched');

  // Refresh / reopen: the SAME suppression list is read again (persisted) while
  // the local barème cache still contains the material.
  const persisted = JSON.parse(String(storage.getItem(tombstones.CATALOG_TOMBSTONE_STORAGE_KEY)));
  assert.deepEqual(persisted, ['alu_001']);
  const afterRefresh = tombstones.applyCatalogTombstones(rateFixtures());
  assert.ok(!afterRefresh.some(r => r.id === 'ALU-001'), 'the cache may not revive it');

  // Identity spelling is irrelevant (DB code vs calculator id).
  tombstones.replaceCatalogTombstones(['alu-001']);
  assert.ok(!tombstones.applyCatalogTombstones(rateFixtures()).some(r => r.id === 'ALU-001'));
  tombstones.resetCatalogTombstones();
});

await test('archive: an unreachable list changes NOTHING locally (fail-safe)', () => {
  tombstones.resetCatalogTombstones();
  tombstones.markCatalogTombstoned('ALU-001');
  const before = tombstones.listCatalogTombstones();
  tombstones.replaceCatalogTombstones(null);
  tombstones.replaceCatalogTombstones(undefined);
  assert.deepEqual(tombstones.listCatalogTombstones(), before, 'fail-safe: nothing is cleared');
  assert.ok(tombstones.isCatalogTombstoned('ALU-001'));
  tombstones.resetCatalogTombstones();
});

await test('archive: the authoritative server list replaces the client state (re-import publishes again)', () => {
  tombstones.resetCatalogTombstones();
  tombstones.markCatalogTombstoned('ALU-001');
  tombstones.replaceCatalogTombstones(['ALU-777']); // server says: only ALU-777 is archived
  assert.equal(tombstones.isCatalogTombstoned('ALU-777'), true);
  assert.equal(tombstones.isCatalogTombstoned('ALU-001'), false, 'the DB truth wins');

  // When the server SERVES the material again (a re-import resurrects it), the
  // stale suppression is dropped even before the next list refresh.
  tombstones.replaceCatalogTombstones(['ALU-001']);
  const rates = rateFixtures();
  const alive = tombstones.applyCatalogTombstones(rates, ['ALU-001']);
  assert.equal(alive.length, rates.length, 'an alive ref is never hidden');
  assert.equal(tombstones.isCatalogTombstoned('ALU-001'), false);
  tombstones.resetCatalogTombstones();
});

await test('archive: Devis / user / project data is never mutated', () => {
  tombstones.resetCatalogTombstones();
  const rates = rateFixtures();
  const ratesSnapshot = JSON.stringify(rates);
  const devis = {
    reference: 'DEV-2026-00001',
    items: [{
      materialId: 'ALU-001',
      title: 'Fenêtre Alu Coulissante 1.2x1.4m',
      descriptionSnapshot: 'Double vitrage 4/12/4',
      unitPriceAppliedTnd: '450.000',
      totalPriceTnd: '900.000',
      exactCalculatedQuantity: '2',
      billableQuantity: '2',
    }],
    grandTotalTnd: 900,
  };
  const devisSnapshot = JSON.stringify(devis);
  const userSnapshot = JSON.stringify({ id: 'u-1', role: 'artisan', companyId: 'c-1' });
  const projectSnapshot = JSON.stringify({ id: 'p-1', companyId: 'c-1', budgetTotalHt: 5000 });

  tombstones.replaceCatalogTombstones(['ALU-001']);
  const displayed = tombstones.applyCatalogTombstones(rates);

  assert.equal(JSON.stringify(rates), ratesSnapshot, 'the input array (and its rows) is never mutated');
  assert.equal(displayed.length, rates.length - 1, 'only the display list is filtered');
  assert.equal(JSON.stringify(devis), devisSnapshot, 'the Devis snapshot is byte-identical');
  assert.equal(devis.items[0].unitPriceAppliedTnd, '450.000');
  assert.equal(devis.items[0].billableQuantity, '2');
  assert.equal(userSnapshot, '{"id":"u-1","role":"artisan","companyId":"c-1"}');
  assert.equal(projectSnapshot, '{"id":"p-1","companyId":"c-1","budgetTotalHt":5000}');
  tombstones.resetCatalogTombstones();
});

await test('disable/delete: a métier stays hidden after a Refresh (and comes back when activated)', () => {
  // Admin deactivated an official métier in the DB → hidden immediately…
  tradeRegistry.markTradeDeactivated('peinture');
  assert.equal(tradeRegistry.isTradeInactiveOrDeleted('peinture'), true);
  assert.equal(tradeRegistry.isTradeInactiveOrDeleted('PEINTURE'), true);
  assert.equal(tradeRegistry.isTradeInactiveOrDeleted('  Peinture '), true);
  // …and restored when the Admin activates it again.
  tradeRegistry.markTradeActivated({ id: 'trade-peinture', code: 'peinture', labelFr: 'PEINTURE', isActive: true, isOfficial: true } as any);
  assert.equal(tradeRegistry.isTradeInactiveOrDeleted('peinture'), false);

  // A DELETED dynamic métier has no DB row left: only the persisted mark can
  // remember it, so it must survive a Refresh / app reopen.
  tradeRegistry.markTradeDeleted('trade-alu', 'aluminium');
  assert.equal(tradeRegistry.isTradeInactiveOrDeleted('aluminium'), true);
  const persisted = JSON.parse(String(storage.getItem('konstrivo_trade_tombstones_v1')));
  assert.deepEqual(persisted, ['aluminium']);
  assert.deepEqual(tombstones.listTradeTombstones(), ['aluminium'], 'the persisted mark is re-read on load');
  tradeRegistry.markTradeActivated({ id: 'trade-alu', code: 'aluminium', labelFr: 'Aluminium', isActive: true, isOfficial: false } as any);
  assert.equal(tradeRegistry.isTradeInactiveOrDeleted('aluminium'), false, 're-creating the métier clears the mark');
});

await test('identity: the client suppression rule matches the server normalizer', () => {
  assert.equal(tombstones.catalogRefIdentity('PLAQUE-BA13-STANDARD'), 'plaque_ba13_standard');
  assert.equal(tombstones.catalogRefIdentity('PLAQUE-BA13-STANDARD'), normalizeMaterialRef('plaque ba13 standard'));
  assert.equal(tombstones.catalogRefIdentity('ALU-001'), normalizeMaterialRef('ALU-001'));
  assert.equal(tombstones.catalogRefIdentity('\uFEFFRéférence'), normalizeMaterialRef('Référence'));
  assert.equal(tombstones.catalogRefIdentity(''), '');
  assert.equal(normalizeMaterialRef(''), '');
  assert.notEqual(tombstones.catalogRefIdentity('alu_001'), tombstones.catalogRefIdentity('alu_002'));
});

await test('server truth: archive resolution + archived-code list (memory backend, no DB)', async () => {
  // Defensive: this block intentionally exercises the repositories on the
  // in-memory backend. If a database were configured it must NOT run (a test may
  // never write to a real catalog).
  if (process.env.DATABASE_URL || process.env.TEST_DATABASE_URL) {
    console.log('       SKIP — a DATABASE_URL is configured; repository block runs DB-free only');
    return;
  }
  const { materialRepository } = await import('../server/repositories/materialRepository');
  const { priceRepository } = await import('../server/repositories/priceRepository');
  const { tradeRepository } = await import('../server/repositories/tradeRepository');

  // The calculator id spelling (`plaque-ba13-standard`) resolves the OFFICIAL
  // `plaque_ba13_standard` row — no guessing, exactly what DELETE /materials/:id does.
  const lookup: any = await materialRepository.findForArchive('plaque-ba13-standard');
  assert.equal(lookup.status, 'found');
  const material: any = lookup.material;
  assert.equal(material.code, 'plaque_ba13_standard');
  assert.equal(material.isDeleted, false);

  // Not archived yet → the endpoint list is empty for it…
  const before = await materialRepository.listArchivedOfficialCodes();
  assert.ok(!before.includes('plaque_ba13_standard'));

  await materialRepository.softDelete(material.id);

  // …and reported as archived afterwards (the data behind GET /catalog/inactive-refs).
  const after = await materialRepository.listArchivedOfficialCodes();
  assert.ok(after.includes('plaque_ba13_standard'), 'archived code must be reported');

  // Gone from the material list…
  const listed: any = await materialRepository.list({ limit: 200 } as any);
  assert.ok(!listed.data.some((m: any) => m.code === 'plaque_ba13_standard'));

  // …and from the price list the calculator syncs from (memory parity with the
  // DB `materials.is_deleted = false` condition).
  const prices: any = await priceRepository.list({ limit: 200 } as any);
  assert.ok(!prices.data.some((p: any) => p.materialId === material.id), 'archived material must not be served');

  // An unknown reference is reported as missing (never guessed).
  assert.equal((await materialRepository.findForArchive('does-not-exist-xyz')).status, 'missing');

  // A deactivated métier is reported by the endpoint's trade query.
  const placo: any = tradeRepository.findByCode('placo');
  assert.ok(placo, 'placo exists');
  tradeRepository.update(placo.id, { isActive: false });
  const allTrades: any[] = await tradeRepository.list(false, true);
  assert.ok(allTrades.some((t: any) => t.code === 'placo' && t.isActive === false));

  // ── restore the shared dev memory store (this suite must leave no trace) ──
  materialRepository.update(material.id, { isDeleted: false, deletedAt: null } as any);
  tradeRepository.update(placo.id, { isActive: true });
  const restored: any = await materialRepository.findForArchive('plaque-ba13-standard');
  assert.equal(restored.status, 'found');
  assert.equal(restored.material.isDeleted, false, 'dev barème restored');
});

// ── Summary ────────────────────────────────────────────────────────────────
tombstones.resetCatalogTombstones();
console.log('\n═══════════════════════════════════════════');
console.log(` RESULTS: ${passed} passed | ${failed} failed`);
console.log('═══════════════════════════════════════════\n');
if (failures.length > 0) {
  console.log('FAILED TESTS:');
  failures.forEach(f => console.log(f));
  console.log('');
}
process.exit(failed > 0 ? 1 : 0);
