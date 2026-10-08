/**
 * Phase 1 — Dynamic Métré DATA-DRIVEN (`trade_metre_elements`) suite.
 *
 * Covers the 3-tier contract DB → `METRE_ELEMENTS` config → []:
 *   1. `loadMetreElementsForTrade` fallback chain (incl. unreachable-DB path),
 *   2. DB row mapping + engine-safety validation (`mapMetreElementRow`),
 *   3. Aluminium registry/aliases unchanged (pairs with tests/metreRegistry.test.ts),
 *   4. OPTIONAL Catalog-import metadata (valid / invalid / legacy file),
 *   5. source-level architecture checks: additive migration, repository, read
 *      endpoint, API client, CalculatorTab wiring — never `if (trade === ...)`.
 *
 * NOT covered (frozen contracts): the 12 official calculators, `genericQty`,
 * `calculateGeneric`, `metreEngine` internals, prices, Devis, Country/Fiscal,
 * Auth/Admin. No Admin UI exists for elements in this phase (asserted below).
 *
 * Run: npx tsx tests/metreDataDriven.test.ts
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  METRE_ELEMENTS,
  METRE_ELEMENT_ALIASES,
  elementsForTrade,
  loadMetreElementsForTrade,
  mapMetreElementRow,
  isValidMetreElementShape,
  isMetreMethod,
  isMetreQtyUnit,
} from '../src/data/metreElements';
import { evaluateElement } from '../src/utils/metreEngine';
import { resolveMapping, normalizeAndValidateRows } from '../server/services/catalogImport';

let passed = 0;
let failed = 0;
const failures: string[] = [];
/** Async runner: counts and exit code are always accurate. */
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`  PASS ${name}`); }
  catch (err: any) {
    failed++;
    const msg = `  FAIL ${name}\n       ${err?.message || err}`;
    failures.push(msg);
    console.log(msg);
  }
}
const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');

console.log('\n📏 Phase 1 — Dynamic Métré data-driven (trade_metre_elements)\n');

/** A DB-shaped row that is fully engine-safe (surface method, m²). */
const VALID_ROW = {
  id: 'e1',
  tradeId: 't1',
  elementCode: 'panneau',
  labelFr: 'Panneau',
  labelAr: 'لوح',
  method: 'surface',
  dims: [
    { key: 'largeur', labelFr: 'Largeur', labelAr: 'العرض', unit: 'm' },
    { key: 'hauteur', labelFr: 'Hauteur', labelAr: 'الارتفاع', unit: 'm' },
  ],
  calc: { op: 'product', dims: ['largeur', 'hauteur'] },
  qtyUnit: 'm²',
  isActive: true,
  sortOrder: 0,
};

// ══════════════════════════════════════════════════════════════════════════
// 1) LOADER — DB → config → [] fallback chain
// ══════════════════════════════════════════════════════════════════════════

await test('loader: no tradeId → METRE_ELEMENTS config fallback (aluminium intact)', async () => {
  const list = await loadMetreElementsForTrade(null, 'aluminium');
  assert.deepEqual(list, elementsForTrade('aluminium'));
  assert.ok(list.length >= 11, `expected ≥ 11 aluminium elements, got ${list.length}`);
});

await test('loader: unknown métier → [] (engine never invents elements)', async () => {
  assert.deepEqual(await loadMetreElementsForTrade(null, 'brand-new-metier'), []);
  assert.deepEqual(await loadMetreElementsForTrade(null, ''), []);
});

await test('loader: unreachable DB (tradeId, no server) → config fallback, never throws', async () => {
  // In the test environment the relative API URL cannot resolve, so the DB
  // tier fails deterministically and the loader must land on the config tier.
  const list = await loadMetreElementsForTrade('00000000-0000-4000-8000-000000000000', 'placo');
  assert.deepEqual(list, elementsForTrade('placo'));
  assert.ok(list.length > 0, 'placo must resolve from config fallback');
});

await test('loader: alias-driven dynamic métier still resolves through config tier', async () => {
  assert.deepEqual(await loadMetreElementsForTrade(null, 'fenêtres'), elementsForTrade('aluminium'));
  assert.deepEqual(await loadMetreElementsForTrade(null, 'Menuiserie Aluminium'), elementsForTrade('aluminium'));
});

// ══════════════════════════════════════════════════════════════════════════
// 2) DB ROW MAPPING — engine-safe or rejected (never a crash)
// ══════════════════════════════════════════════════════════════════════════

await test('mapMetreElementRow: valid DB row → MetreElementDef + engine evaluates it', () => {
  const el = mapMetreElementRow(VALID_ROW, 'nouveau-metier');
  assert.ok(el, 'valid row must map');
  assert.equal(el!.code, 'panneau');
  assert.equal(el!.trade, 'nouveau-metier');
  assert.equal(el!.method, 'surface');
  assert.equal(el!.unit, 'm²');
  assert.equal(el!.labelAr, 'لوح');
  assert.ok(el!.dims.length === 2 && el!.qtyFormula.length > 0);
  const r = evaluateElement(el!, { largeur: 2, hauteur: 3 });
  assert.equal(r.ok, true);
  if (r.ok) { assert.equal(r.qty, 6); assert.equal(r.unit, 'm²'); }
});

await test('mapMetreElementRow: malformed rows → null (fallback tier protects the UI)', () => {
  assert.equal(mapMetreElementRow(null, 'x'), null);
  assert.equal(mapMetreElementRow({}, 'x'), null);
  assert.equal(mapMetreElementRow({ ...VALID_ROW, elementCode: '  ' }, 'x'), null);
  assert.equal(mapMetreElementRow({ ...VALID_ROW, method: 'diagometrie' }, 'x'), null);
  assert.equal(mapMetreElementRow({ ...VALID_ROW, qtyUnit: 'ft²' }, 'x'), null);
  assert.equal(mapMetreElementRow({ ...VALID_ROW, dims: [] }, 'x'), null);
  assert.equal(mapMetreElementRow({ ...VALID_ROW, dims: 'largeur,hauteur' }, 'x'), null);
  assert.equal(mapMetreElementRow({ ...VALID_ROW, calc: { op: 'eval', code: 'boom' } }, 'x'), null);
  assert.equal(mapMetreElementRow({ ...VALID_ROW, calc: { op: 'product', dims: ['inconnue'] } }, 'x'), null);
  assert.equal(mapMetreElementRow({ ...VALID_ROW, dims: [{ key: 'a', unit: 'parsec' }] }, 'x'), null);
});

await test('isValidMetreElementShape / whitelists: single truth for loader + import', () => {
  assert.ok(isMetreMethod('surface') && !isMetreMethod('SURFACE') && !isMetreMethod(7));
  assert.ok(isMetreQtyUnit('m²') && !isMetreQtyUnit('m2') && !isMetreQtyUnit('unité'));
  assert.ok(isValidMetreElementShape({ method: VALID_ROW.method, dims: VALID_ROW.dims, calc: VALID_ROW.calc, qtyUnit: VALID_ROW.qtyUnit }));
  assert.ok(!isValidMetreElementShape({ method: 'surface', dims: VALID_ROW.dims, calc: VALID_ROW.calc, qtyUnit: 'ft2' }));
  assert.ok(!isValidMetreElementShape({ method: 'surface', dims: [], calc: VALID_ROW.calc, qtyUnit: 'm²' }));
  assert.ok(!isValidMetreElementShape({ method: 'surface', dims: VALID_ROW.dims, calc: { op: 'product' }, qtyUnit: 'm²' }));
  // perimeter_h needs planeA/planeB/height all declared in dims.
  const per = {
    method: 'perimetre_hauteur',
    dims: [
      { key: 'a', unit: 'm', labelFr: 'A', labelAr: '' },
      { key: 'b', unit: 'm', labelFr: 'B', labelAr: '' },
      { key: 'h', unit: 'm', labelFr: 'H', labelAr: '' },
    ],
    calc: { op: 'perimeter_h', planeA: 'a', planeB: 'b', height: 'h' },
    qtyUnit: 'm²',
  };
  assert.ok(isValidMetreElementShape(per));
  assert.ok(!isValidMetreElementShape({ ...per, calc: { op: 'perimeter_h', planeA: 'a', planeB: 'b', height: 'zzz' } }));
});

// ══════════════════════════════════════════════════════════════════════════
// 3) ALUMINIUM REGRESSION — METRE_ELEMENTS + aliases byte-stable
// ══════════════════════════════════════════════════════════════════════════

await test('aluminium: registry entry + alias table unchanged by the loader work', () => {
  assert.ok(METRE_ELEMENTS.aluminium, 'METRE_ELEMENTS.aluminium missing');
  assert.ok(METRE_ELEMENTS.aluminium.length >= 11);
  assert.ok(Object.keys(METRE_ELEMENT_ALIASES).length >= 22);
  assert.deepEqual(elementsForTrade('aluminium'), [...METRE_ELEMENTS.aluminium]);
  assert.deepEqual(elementsForTrade('fenêtres'), [...METRE_ELEMENTS.aluminium]);
  assert.deepEqual(elementsForTrade('unknown-trade'), []);
});

// ══════════════════════════════════════════════════════════════════════════
// 4) CATALOG IMPORT — OPTIONAL metre metadata (legacy files untouched)
// ══════════════════════════════════════════════════════════════════════════

const FILE_PARAMS = { countryCode: 'TN', currencyCode: 'TND' };
const LEGACY_HEADERS = ['Reference', 'Nom_Materiau', 'Categorie', 'Prix_HT', 'Unite'];
const legacyRow: Record<string, string> = {
  Reference: 'REF001',
  Nom_Materiau: 'Plaque BA13',
  Categorie: 'placo',
  Prix_HT: '12,500',
  Unite: 'm²',
};
const DIMS_JSON = '[{"key":"largeur","labelFr":"Largeur","labelAr":"العرض","unit":"m"},{"key":"hauteur","labelFr":"Hauteur","labelAr":"الارتفاع","unit":"m"}]';
const CALC_JSON = '{"op":"product","dims":["largeur","hauteur"]}';
const METRE_HEADERS = [...LEGACY_HEADERS,
  'metre_element_id', 'metre_element_fr', 'metre_element_ar',
  'metre_methode', 'metre_dims', 'metre_calcul', 'metre_qty_unit'];
const metreRow: Record<string, string> = {
  ...legacyRow,
  Reference: 'REF002',
  metre_element_id: 'panneau',
  metre_element_fr: 'Panneau',
  metre_element_ar: 'لوح',
  metre_methode: 'surface',
  metre_dims: DIMS_JSON,
  metre_calcul: CALC_JSON,
  metre_qty_unit: 'm²',
};

await test('import mapping: legacy file maps ZERO metre fields (nothing stolen)', () => {
  const m = resolveMapping(LEGACY_HEADERS, legacyRow, null);
  const metreKeys = Object.keys(m.appliedMapping).filter((k) => k.startsWith('metre_'));
  assert.deepEqual(metreKeys, [], `legacy mapping must not touch metre fields: ${metreKeys.join(', ')}`);
  assert.deepEqual(m.unmappedRequired, []);
  assert.equal(m.appliedMapping.material_code, 'Reference');
  assert.equal(m.appliedMapping.unit, 'Unite');
});

await test('import mapping: explicit metre columns are suggested (exact aliases)', () => {
  const m = resolveMapping(METRE_HEADERS, metreRow, null);
  assert.deepEqual(m.unmappedRequired, []);
  assert.equal(m.appliedMapping.metre_element_id, 'metre_element_id');
  assert.equal(m.appliedMapping.metre_element_label_fr, 'metre_element_fr');
  assert.equal(m.appliedMapping.metre_method, 'metre_methode');
  assert.equal(m.appliedMapping.metre_dims, 'metre_dims');
  assert.equal(m.appliedMapping.metre_calc, 'metre_calcul');
  assert.equal(m.appliedMapping.metre_qty_unit, 'metre_qty_unit');
  assert.equal(m.appliedMapping.unit, 'Unite');
});

await test('import rows: legacy row → valid, NO metadata, NO review note', () => {
  const m = resolveMapping(LEGACY_HEADERS, legacyRow, null);
  const run = normalizeAndValidateRows([legacyRow], m.appliedMapping, FILE_PARAMS);
  assert.equal(run.failed.length, 0);
  assert.equal(run.valid.length, 1);
  assert.equal(run.valid[0].metre, undefined);
  assert.equal(run.valid[0].review, undefined);
  assert.equal(run.valid[0].trade, 'placo');
});

await test('import rows: complete metre metadata → parsed into row.metre', () => {
  const m = resolveMapping(METRE_HEADERS, metreRow, null);
  const run = normalizeAndValidateRows([metreRow], m.appliedMapping, FILE_PARAMS);
  assert.equal(run.failed.length, 0);
  assert.equal(run.valid.length, 1);
  assert.ok(run.valid[0].metre, 'metre metadata missing');
  assert.equal(run.valid[0].metre!.elementCode, 'panneau');
  assert.equal(run.valid[0].metre!.method, 'surface');
  assert.equal(run.valid[0].metre!.qtyUnit, 'm²');
  assert.deepEqual(run.valid[0].metre!.dims, JSON.parse(DIMS_JSON));
  assert.deepEqual(run.valid[0].metre!.calc, JSON.parse(CALC_JSON));
  assert.equal(run.valid[0].review, undefined);
});

await test('import rows: invalid/incomplete metadata → dropped + review note, row still imports', async () => {
  const m = resolveMapping(METRE_HEADERS, metreRow, null);
  const note = (row: Record<string, string>) => {
    const run = normalizeAndValidateRows([row], m.appliedMapping, FILE_PARAMS);
    assert.equal(run.failed.length, 0, 'metadata problems must never reject the material row');
    assert.equal(run.valid.length, 1);
    assert.equal(run.valid[0].metre, undefined);
    assert.ok(run.valid[0].review?.some((r) => r.includes('métré')), 'expected an informational review note');
  };
  note({ ...metreRow, metre_methode: 'inventee' });              // unknown method
  note({ ...metreRow, metre_qty_unit: '' });                     // missing qty_unit (never inferred)
  note({ ...metreRow, metre_dims: 'not-json' });                 // malformed dims JSON
  note({ ...metreRow, metre_calcul: '{"op":"eval"}' });          // non-whitelisted op
  note({ ...metreRow, metre_element_id: 'x'.repeat(101) });      // over column length
});

await test('import rows: blank element code → no metadata and NO note (optional per row)', () => {
  const m = resolveMapping(METRE_HEADERS, { ...metreRow, metre_element_id: '' }, null);
  const run = normalizeAndValidateRows([{ ...metreRow, metre_element_id: '' }], m.appliedMapping, FILE_PARAMS);
  assert.equal(run.failed.length, 0);
  assert.equal(run.valid[0].metre, undefined);
  assert.equal(run.valid[0].review, undefined);
});

// ══════════════════════════════════════════════════════════════════════════
// 5) SOURCE-LEVEL architecture checks (what the code IS, not what it does)
// ══════════════════════════════════════════════════════════════════════════

/** Remove comments so prose ("there is NO `if (trade === ...`)") never trips a code check. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

await test('migration 0015: additive + idempotent (CREATE … IF NOT EXISTS only, no DROP)', () => {
  const mig = read('server/db/migrations/0015_trade_metre_elements.sql');
  assert.ok(mig.includes('CREATE TABLE IF NOT EXISTS "trade_metre_elements"'), 'table must be CREATE IF NOT EXISTS');
  assert.ok(mig.includes('EXCEPTION WHEN duplicate_object THEN NULL'), 'FK must be guarded (idempotent)');
  assert.ok(mig.includes('"uq_trade_metre_element"'), 'unique (trade_id, element_code) index missing');
  assert.ok(mig.includes('REFERENCES "public"."trades"("id")'), 'FK target trades(id) missing');
  // Split FIRST (the separators look like comments), then clean each segment:
  // comments + the guarded DO block, so only plain SQL statements remain.
  const statements = mig
    .split('--> statement-breakpoint')
    .map((s) => s
      .replace(/^[^\S\n]*--.*$/gm, '')                  // comment lines
      .replace(/DO \$\$[\s\S]*?END \$\$;/g, '')         // guarded DO block (idempotent ALTER)
      .trim())
    .filter(Boolean);
  assert.ok(statements.length >= 3, `expected >=3 statements, got ${statements.length}`);
  // The header comment may MENTION drop — only real SQL statements count.
  assert.ok(!/\b(DROP|TRUNCATE)\b/i.test(statements.join('\n')), 'migration must never DROP/TRUNCATE');
  for (const s of statements) {
    assert.ok(/^CREATE\s+(TABLE|UNIQUE\s+INDEX|INDEX)\b/i.test(s), `non-CREATE statement: ${s.slice(0, 60)}`);
    assert.ok(/IF NOT EXISTS/i.test(s), `non-idempotent statement: ${s.slice(0, 60)}`);
  }
});

await test('schema + repository: pgTable and list/upsert functions exist', () => {
  const schema = read('server/db/schema/catalog.ts');
  assert.ok(schema.includes("pgTable('trade_metre_elements'"), 'tradeMetreElements pgTable missing');
  assert.ok(schema.includes('uq_trade_metre_element'), 'schema unique index missing');
  assert.ok(schema.includes('idx_trade_metre_elements_active'), 'schema active index missing');

  const repo = read('server/repositories/drizzleTradeMetreElementRepository.ts');
  assert.ok(repo.includes('export async function listMetreElementsByTradeId'), 'list-by-trade missing');
  assert.ok(repo.includes('export async function listAllMetreElementsByTradeId'), 'list-all-by-trade missing');
  assert.ok(repo.includes('export async function upsertTradeMetreElement'), 'upsert missing');
  assert.ok(repo.includes('eq(tradeMetreElements.isActive, true)'), 'read path must filter is_active');
});

await test('endpoint + API client: GET /trades/:id/metre-elements wired end-to-end', () => {
  const routes = read('server/routes/v1/trades.ts');
  assert.ok(routes.includes("router.get('/:id/metre-elements'"), 'route missing');
  assert.ok(routes.includes('listMetreElementsByTradeId'), 'route must use the repository');
  assert.ok(routes.includes('res.json({ data: elements })'), 'response must follow the { data } contract');

  const api = read('src/lib/api.ts');
  assert.ok(api.includes('export async function listTradeMetreElements'), 'client helper missing');
  assert.ok(api.includes('/metre-elements'), 'client URL must target the new endpoint');
});

await test('CalculatorTab: wired to the LOADER (resolved state), getMetreElement no longer imported', () => {
  const calc = read('src/components/CalculatorTab.tsx');
  assert.ok(calc.includes('loadMetreElementsForTrade('), 'loader call missing');
  assert.ok(calc.includes('const [resolvedMetreElements, setResolvedMetreElements]'), 'resolved state missing');
  assert.ok(!calc.includes('getMetreElement('), 'CalculatorTab must read the resolved state, not the config helper');
});

await test('loader source: DB tier strictly BEFORE config fallback', () => {
  const el = read('src/data/metreElements.ts');
  const dbIdx = el.indexOf("await import('../lib/api')");
  const cfgIdx = el.indexOf('return elementsForTrade(tradeCode);');
  assert.ok(dbIdx > -1, 'DB tier (listTradeMetreElements import) missing');
  assert.ok(cfgIdx > dbIdx, 'config fallback must come AFTER the DB tier');
  assert.ok(el.includes('export async function loadMetreElementsForTrade'), 'loader export missing');
});

await test('catalog import: probe OUTSIDE tx, guarded persist INSIDE tx, no method inference', () => {
  const imp = read('server/services/catalogImport.ts');
  const probeIdx = imp.indexOf('tradeMetreElements.id');
  const txIdx = imp.indexOf('db.transaction(');
  assert.ok(probeIdx > -1, 'table-existence probe missing');
  assert.ok(txIdx > -1, 'commit transaction missing');
  assert.ok(probeIdx < txIdx, 'probe MUST run outside the transaction (missing table would ABORT it)');
  const guardIdx = imp.indexOf('if (metreTableReady && item.metre)');
  assert.ok(guardIdx > txIdx, 'metre persist must run inside the transaction');
  assert.ok(imp.includes('tradeIdByCode.get(item.trade)'), 'tradeId must resolve via tradeIdByCode');
  assert.ok(imp.includes('metre?:'), 'ValidImportRow.metre must stay OPTIONAL');
  // method/qty_unit are read as-is — NEVER derived from unit/category.
  assert.ok(imp.includes("method: pick('metre_method')"), 'method must come from its own column');
  assert.ok(imp.includes("qtyUnit: pick('metre_qty_unit')"), 'qtyUnit must come from its own column');
});

await test('NO `if (trade === …)` anywhere in the métré path (data-driven, comments stripped)', () => {
  const metrePathFiles = [
    'src/data/metreElements.ts',
    'src/components/CalculatorTab.tsx',
    'server/services/catalogImport.ts',
    'server/routes/v1/trades.ts',
    'server/db/schema/catalog.ts',
    'src/lib/api.ts',
  ];
  for (const f of metrePathFiles) {
    const code = stripComments(read(f));
    assert.ok(!/if\s*\(\s*trade\s*===/.test(code), `${f}: contains an if (trade === …) branch`);
    assert.ok(!/trade\s*===\s*'/.test(code), `${f}: contains a trade === '…' literal comparison`);
  }
});

await test('Phase 1 scope: Admin has NO métré-elements editor yet (asserted, documented)', () => {
  const admin = read('src/components/AdminTradesPanel.tsx');
  assert.ok(!admin.includes('metre-elements'), 'AdminTradesPanel must not reference the endpoint in Phase 1');
  assert.ok(!admin.includes('listTradeMetreElements'), 'AdminTradesPanel must not call the metre API in Phase 1');
});

// ══════════════════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════════════════

console.log(`\n═══════════════════════════════════════════════`);
console.log(` Dynamic Métré data-driven: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════════════\n`);
if (failed > 0) {
  console.log('FAILED TESTS:');
  for (const f of failures) console.log(f);
}
process.exitCode = failed > 0 ? 1 : 0;



