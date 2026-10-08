/**
 * ALUMINIUM 40 — métier → materials matching regression (DB-free).
 *
 * WHAT BROKE (live Outils/Calculateur): the 40 imported aluminium materials
 * (AL001–AL040, supplier family label "Menuiserie Aluminium", trade
 * "aluminium", trade record "Aluminium") did not appear under the Aluminium
 * métier:
 *   • `calculateGeneric` matched materials ONLY by the exact
 *     `catalogKey(trade/category)` of the selected code — a registry code or
 *     its label resolved nothing when the rows carried the family label;
 *   • `ServicesTab` counted materials by `category` ONLY, so the Aluminium
 *     card showed «0 matériaux»;
 *   • the API's authoritative `trade`/`tradeId` (already returned by
 *     `/prices` and preserved in `ResolvedPrice`) was never published onto
 *     the merged rates (priceLookup stays frozen — App.tsx publishes it).
 *
 * THE FIX UNDER TEST (read-path only, no formula, no price, no DB change):
 *   1. `calculateGeneric` also matches by tradeId / registry record identity
 *      and registry label aliases (additive `GenericInput.tradeId` +
 *      `GenericInput.tradeAliases`; historical clauses byte-identical when
 *      both are omitted);
 *   2. `countRatesForCatalogGroup` (ServicesTab) counts by category OR trade;
 *   3. `publishServerTradeIdentity` (App.tsx) publishes trade/tradeId from the
 *      price map onto the merged rates (server priority).
 *
 * Run: npx tsx tests/aluminiumMaterialsMatch.test.ts
 */
import { strict as assert } from 'node:assert';
import { calculateGeneric, GenericInput } from '../src/utils/calculations';
import { buildPriceMapWithTrade, mergeRates } from '../src/utils/priceLookup';
import { countRatesForCatalogGroup } from '../src/components/ServicesTab';
import { groupCatalogEntries } from '../src/utils/catalogDisplay';
import { DEFAULT_MARKET_RATES } from '../src/data/marketRates';
import type { MaterialRate, Trade } from '../src/types';

let passed = 0;
let failed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  PASS ${name}`); }
  catch (err: any) {
    failed++;
    const msg = `  FAIL ${name}\n       ${err?.message || err}`;
    failures.push(msg);
    console.log(msg);
  }
}
/** Pending async tests — awaited by the final report before exiting. */
const pendingAsync: Array<Promise<void>> = [];
function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  const p = (async () => {
    try { await fn(); passed++; console.log(`  PASS ${name}`); }
    catch (err: any) {
      failed++;
      const msg = `  FAIL ${name}\n       ${err?.message || err}`;
      failures.push(msg);
      console.log(msg);
    }
  })();
  pendingAsync.push(p);
  return p;
}

console.log('\nAluminium 40 — métier → materials matching (DB-free)\n');

// ── Fixtures mirroring the production data (probes + trade registry) ─────────
const ALU_TRADE_ID = '7d1f9e5a-1111-4c6e-9f2a-0a1b2c3d4e5f';
const OTHER_TRADE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const FAMILY_LABEL = 'Menuiserie Aluminium';
const REGISTRY_CODES = [
  'profils', 'fenêtres', 'portes', 'baies vitrées', 'coulissants', 'châssis',
  'profilés dormants', 'profilés ouvrants', 'profilés coulissants', 'rails',
  'montants', 'traverses', 'cornières', 'quincaillerie', 'joints',
  'accessoires', 'consommables', 'vitrage', 'protection', 'fermetures', 'finition',
];
const ALU_UNITS = ['m²', 'm', 'unit', 'kg', 'set', 'litre'] as const;

function aluRate(i: number, overrides?: Partial<MaterialRate>): MaterialRate {
  const code = `AL${String(i).padStart(3, '0')}`;
  const unit = ALU_UNITS[(i - 1) % ALU_UNITS.length];
  return {
    id: code.toLowerCase(),                        // CSV importer slug id
    category: FAMILY_LABEL,                        // supplier family label
    trade: 'aluminium',                            // authoritative trade code
    nameFr: `Matériau aluminium ${code}`,
    nameAr: '',
    unit,
    unitPriceTnd: 25,
    defaultPriceTnd: 25,
    ...overrides,
  };
}
const ALU40: MaterialRate[] = Array.from({ length: 40 }, (_v, i) => aluRate(i + 1));

/** Registry row (GET /api/v1/trades) as the calculator receives it. */
function registryTrade(code: string, labelFr = 'Aluminium', id = ALU_TRADE_ID): Trade {
  return {
    id, code, labelFr, sortOrder: 0, isActive: true,
    isOfficial: false, createdAt: '', updatedAt: '',
  };
}

/** Calculator input the way CalculatorTab builds it for a registry métier. */
function calculatorInput(over: Partial<GenericInput> = {}): GenericInput {
  return {
    trade: 'aluminium',
    tradeId: ALU_TRADE_ID,
    tradeAliases: ['Aluminium'],
    areaM2: 20,
    lengthM: 10,
    wasteMarginPercent: 10,
    laborRatePerM2: 30,
    tvaPercent: 19,
    includeTimbre: true,
    retenueGarantiePercent: 5,
    ...over,
  };
}

// Documented generic rules (area 20, length 10, waste 10 % → factor 1.1)
const QTY: Record<string, number> = {
  'm²': 22,            // Area × waste
  'm': 11,             // Length × waste
  'unit': 1,           // neutral piece
  'kg': 11,            // Area × 0.5 × waste
  'set': 1,
  'litre': 1,
};

// ═══ 1) calculateGeneric — registry identity resolves the métier's materials ═
test('aluminium: the métier code resolves all 40 materials (historical trade match)', () => {
  const r = calculateGeneric(calculatorInput(), ALU40);
  assert.equal(r.materialItems.length, 40, 'all 40 materials, never the placeholder');
  const al001 = r.materialItems.find(i => i.id === 'al001');
  assert.ok(al001, 'AL001 resolved');
  assert.equal(al001!.unit, 'm²');
  assert.equal(al001!.qty, QTY['m²']);
});

test('aluminium: a registry SUB-CODE resolves the métier materials via the registry label alias', () => {
  // The user picks the «Profilés» chip (code 'profils') of the Aluminium card —
  // the materials carry trade 'aluminium' / category 'Menuiserie Aluminium'.
  const r = calculateGeneric(calculatorInput({ trade: 'profils' }), ALU40);
  assert.equal(r.materialItems.length, 40, 'registry label identity resolves the métier materials');
  const al002 = r.materialItems.find(i => i.id === 'al002');
  assert.ok(al002, 'AL002 resolved through the alias');
  assert.equal(al002!.unit, 'm');
  assert.equal(al002!.qty, QTY['m'], 'm = Length × waste — genericQty untouched');
});

test('aluminium: tradeId (trade record identity) resolves materials filed under the family label', () => {
  // Worst production shape: trade AND category both hold the family label;
  // only the record uuid links the rows to the métier.
  const familyRates = ALU40.map(r => ({ ...r, trade: FAMILY_LABEL, tradeId: ALU_TRADE_ID }));
  const r = calculateGeneric(calculatorInput({ trade: 'profils' }), familyRates);
  assert.equal(r.materialItems.length, 40, 'record identity (uuid ↔ uuid) resolves the materials');
  const al004 = r.materialItems.find(i => i.id === 'al004');
  assert.ok(al004, 'AL004 resolved through tradeId');
  assert.equal(al004!.unit, 'kg');
  assert.equal(al004!.qty, QTY['kg'], 'kg = Area × 0.5 × waste — genericQty untouched');
});

test('aluminium: a DIFFERENT trade record never claims the materials (no false positive)', () => {
  const familyRates = ALU40.map(r => ({ ...r, trade: FAMILY_LABEL, tradeId: ALU_TRADE_ID }));
  const r = calculateGeneric(
    calculatorInput({ trade: 'profils', tradeId: OTHER_TRADE_ID, tradeAliases: ['Aluminium'] }),
    familyRates
  );
  assert.equal(r.materialItems.length, 1, 'only the documented zero placeholder');
  assert.equal(r.materialItems[0].id, 'profils-material');
  assert.equal(r.materialItems[0].unitPriceTnd, 0);
});

test('no identity supplied → historical behaviour byte-identical (placeholder unchanged)', () => {
  // Mirrors tests/phaseD.test.ts — an unknown métier on the default barème
  // still yields exactly one zero placeholder.
  const r = calculateGeneric(
    { trade: 'aluminum', areaM2: 20, wasteMarginPercent: 10, laborRatePerM2: 20 },
    DEFAULT_MARKET_RATES
  );
  assert.equal(r.trade, 'aluminum');
  assert.equal(r.materialItems.length, 1, 'should produce exactly 1 placeholder');
  // …and the direct trade spelling still matches, exactly as before.
  const r2 = calculateGeneric(
    { trade: 'aluminium', areaM2: 20, wasteMarginPercent: 10, laborRatePerM2: 20 },
    ALU40
  );
  assert.equal(r2.materialItems.length, 40);
});

// ═══ 2) App.tsx — publishServerTradeIdentity (priceLookup stays frozen) ══════
testAsync('App.tsx: the API trade/tradeId is published onto the merged rates (server priority)', async () => {
  const { publishServerTradeIdentity } = await import('../src/App');

  // Stale local cache — what the screen had before the repair (no trade info).
  const staleCache: MaterialRate[] = ALU40.map(r => ({
    id: r.id, category: FAMILY_LABEL, nameFr: r.nameFr, nameAr: '',
    unit: 'unit', unitPriceTnd: 1, defaultPriceTnd: 1,
  }));
  const priceRows = ALU40.map(r => ({
    materialId: `uuid-${r.id}`, code: r.id.toUpperCase(), price: 25,
    trade: 'aluminium', tradeId: ALU_TRADE_ID, nameFr: r.nameFr, nameAr: '',
    unit: r.unit, category: FAMILY_LABEL, currency: 'TND', isCurrent: true,
  }));
  const priceMap = buildPriceMapWithTrade(priceRows);
  const merged = mergeRates(staleCache, priceMap);
  const published = publishServerTradeIdentity(merged, priceMap);

  assert.equal(published.length, 40, 'no duplicate line is created');
  const al001 = published.find(r => r.id === 'al001');
  assert.ok(al001, 'AL001 present');
  assert.equal(al001!.trade, 'aluminium', 'API trade published on the matched rate');
  assert.equal(al001!.tradeId, ALU_TRADE_ID, 'API tradeId published on the matched rate');
  assert.equal(al001!.unitPriceTnd, 25, 'price priority unchanged');

  // Identity bridge spelling (ALU-001 ↔ alu_001, as documented in
  // tests/outilsUnitPreservation.test.ts) reaches the identity too.
  const hyphenRow = { ...priceRows[0], code: 'ALU-001' };
  const map2 = buildPriceMapWithTrade([hyphenRow]);
  const merged2 = mergeRates([{ ...staleCache[0], id: 'alu_001' }], map2);
  const published2 = publishServerTradeIdentity(merged2, map2);
  assert.equal(published2[0].trade, 'aluminium', 'identity bridge (ALU-001 ↔ alu_001) publishes the API trade');
  assert.equal(published2[0].tradeId, ALU_TRADE_ID);

  // A server row WITHOUT identity never erases a real cached identity.
  const rowNoIdentity: any = { ...priceRows[0] };
  delete rowNoIdentity.trade;
  delete rowNoIdentity.tradeId;
  const map3 = buildPriceMapWithTrade([rowNoIdentity]);
  const published3 = publishServerTradeIdentity(
    mergeRates([{ ...staleCache[0], trade: 'aluminium', tradeId: ALU_TRADE_ID }], map3),
    map3
  );
  assert.equal(published3[0].trade, 'aluminium', 'cached trade kept when the API row has none');
  assert.equal(published3[0].tradeId, ALU_TRADE_ID, 'cached tradeId kept when the API row has none');

  // Empty price map → the input array is returned untouched.
  const untouched = publishServerTradeIdentity(staleCache, new Map());
  assert.equal(untouched, staleCache);
});

// ═══ 3) ServicesTab — material counting by category OR trade ═════════════════
test('ServicesTab: the Aluminium card counts the 40 materials (category OR trade)', () => {
  // The Aluminium group: 21 registry codes, all labelled "Aluminium" → ONE card.
  const entries = [
    ...REGISTRY_CODES.map(code => ({ code, label: 'Aluminium', official: false })),
    { code: FAMILY_LABEL, label: FAMILY_LABEL, official: false }, // rate category code
  ];
  const groups = groupCatalogEntries(entries);
  const aluminium = groups.find(g => g.key === 'aluminium')!;
  assert.ok(aluminium, 'the Aluminium group exists');
  // OLD behaviour (category only): catalogKey('Menuiserie Aluminium') ∉ codes
  // keys → 0 matériaux. NEW behaviour: the rate's trade 'aluminium' matches
  // the group's métier key → all 40.
  assert.equal(countRatesForCatalogGroup(ALU40, aluminium), 40, 'count by category OR trade');
});

test('ServicesTab: a rate whose category AND trade both map into one group counts ONCE', () => {
  const group = { key: 'aluminium', codes: ['aluminium', FAMILY_LABEL] };
  assert.equal(countRatesForCatalogGroup(ALU40, group), 40, 'deduped per rate, never 80');
});

test('ServicesTab: unrelated métiers never cross-count', () => {
  const placoGroup = { key: 'placo', codes: ['placo'] };
  assert.equal(countRatesForCatalogGroup(ALU40, placoGroup), 0, 'aluminium rates are not placo materials');
  const placoRates: MaterialRate[] = [{
    id: 'plaque_ba13', category: 'placo', nameFr: 'Plaque BA13', nameAr: '',
    unit: 'm²', unitPriceTnd: 28, defaultPriceTnd: 28,
  }];
  const aluminiumGroup = { key: 'aluminium', codes: ['aluminium'] };
  assert.equal(countRatesForCatalogGroup(placoRates, aluminiumGroup), 0);
  assert.equal(countRatesForCatalogGroup(placoRates, placoGroup), 1);
});

test('ServicesTab: spelling variants collapse (Aluminium / ALUMINIUM / aluminium)', () => {
  const group = { key: 'aluminium', codes: ['ALUMINIUM'] };
  const rates: MaterialRate[] = [
    { id: 'x1', category: 'Menuiserie Aluminium', trade: 'ALUMINIUM', nameFr: 'x1', nameAr: '', unit: 'unit', unitPriceTnd: 5, defaultPriceTnd: 5 },
    { id: 'x2', category: 'ALUMINIUM', trade: undefined, nameFr: 'x2', nameAr: '', unit: 'unit', unitPriceTnd: 5, defaultPriceTnd: 5 },
  ];
  assert.equal(countRatesForCatalogGroup(rates, group), 2);
});

// ═══ 4) End-to-end — the exact Outils runtime chain (reported case) ══════════
testAsync('E2E: /prices → mergeRates → publish → calculateGeneric shows the 40 aluminium materials', async () => {
  const { publishServerTradeIdentity } = await import('../src/App');
  // /prices rows: trade = code, category = family label, tradeId = record uuid.
  const priceRows = ALU40.map(r => ({
    materialId: `uuid-${r.id}`, code: r.id.toUpperCase(), price: 25,
    trade: 'aluminium', tradeId: ALU_TRADE_ID, nameFr: r.nameFr, nameAr: '',
    unit: r.unit, category: FAMILY_LABEL, currency: 'TND', isCurrent: true,
  }));
  const staleCache: MaterialRate[] = ALU40.map(r => ({
    id: r.id, category: FAMILY_LABEL, nameFr: r.nameFr, nameAr: '',
    unit: 'unit', unitPriceTnd: 1, defaultPriceTnd: 1,
  }));
  const priceMap = buildPriceMapWithTrade(priceRows, 'TND');
  const rates = publishServerTradeIdentity(mergeRates(staleCache, priceMap), priceMap);
  // CalculatorTab: the selected métier is the registry record "Aluminium".
  const registryRow = registryTrade('aluminium');
  const result = calculateGeneric({
    trade: registryRow.code,
    tradeId: registryRow.id,
    tradeAliases: [registryRow.labelFr].filter(Boolean),
    areaM2: 20, lengthM: 10, wasteMarginPercent: 10, laborRatePerM2: 30,
    tvaPercent: 19, includeTimbre: true, retenueGarantiePercent: 5,
  }, rates);
  assert.equal(result.materialItems.length, 40, '40 materials in Outils/Calculateur — no placeholder');
  for (const rate of ALU40) {
    const item = result.materialItems.find(i => i.id === rate.id);
    assert.ok(item, `${rate.id} resolved`);
    assert.equal(item!.unit, rate.unit, `${rate.id}: real unit preserved (unit fidelity untouched)`);
    assert.equal(item!.qty, QTY[rate.unit], `${rate.id}: documented quantity for '${rate.unit}'`);
    assert.equal(item!.totalTnd, Math.round(item!.qty * 25 * 100) / 100, `${rate.id}: total = qty × price`);
  }
  // The métier card count on Services sees the same published rates.
  const aluminiumGroup = { key: 'aluminium', codes: ['aluminium', ...REGISTRY_CODES] };
  assert.equal(countRatesForCatalogGroup(rates, aluminiumGroup), 40, 'the card shows «40 matériaux»');
});

// ── Report ───────────────────────────────────────────────────────────────────
Promise.all(pendingAsync)
  .then(() => {
    console.log(`\nAluminium 40 matching result: ${passed} PASS / ${failed} FAIL`);
    if (failed > 0) {
      failures.forEach((f) => console.log(f));
      process.exit(1);
    }
    process.exit(0);
  })
  .catch((e) => { console.error(e); process.exit(1); });



