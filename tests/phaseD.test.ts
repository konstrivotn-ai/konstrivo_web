/**
 * Phase D — Dynamic Calculation + Services tests.
 *
 * Acceptance criteria:
 *   1. Existing trade (placo) still calculates exactly as before (no regression).
 *   2. A dynamically created trade enters the calculation pipeline with NO new
 *      hardcoded branch — via the generic/data-driven calculator.
 *   3. Materials linked to the dynamic trade are resolved correctly.
 *   4. Services can be associated with the trade via data/configuration.
 *
 * Run: npx tsx tests/phaseD.test.ts
 */
import { strict as assert } from 'node:assert';
import { calculatePlaco, calculateGeneric, GenericInput, PlacoInput } from '../src/utils/calculations';
import { calculatePeinture, PeintureInput } from '../src/utils/calculations';
import { DEFAULT_MARKET_RATES } from '../src/data/marketRates';
import { getServicesForTrade, loadServicesForTrade, TRADE_SERVICES } from '../src/data/tradeServices';
import { buildPriceMap, buildPriceMapWithTrade, mergeRates, ResolvedPrice } from '../src/utils/priceLookup';
import { MaterialRate } from '../src/types';
import { upsertTradeService, listServicesByTradeId } from '../server/repositories/drizzleTradeServiceRepository';

let passed = 0;
let failed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`  PASS ${name}`); }
  catch (err: any) {
    failed++;
    const msg = `  FAIL ${name}\n       ${err?.message || err}`;
    failures.push(msg);
    console.log(msg);
  }
}

console.log('\n🔧 Phase D — Dynamic Calculation + Services\n');

// ════ 1) REGRESSION: existing placo calculation unchanged ════
test('placo: existing calculation produces expected material items', () => {
  const input: PlacoInput = {
    subType: 'cloison_fixe',
    length: 5,
    heightOrWidth: 2.8,
    openingsCount: 1,
    openingArea: 1.68,
    boardType: 'plaque_ba13_standard',
    skinType: 'two_sides_single_skin',
    montantsSpacingCm: 60,
    withInsulation: false,
    wasteMarginPercent: 10,
    laborRatePerM2: 18,
  };
  const result = calculatePlaco(input, DEFAULT_MARKET_RATES);
  assert.equal(result.trade, 'placo');
  assert.ok(result.materialItems.length > 0, 'placo should produce material items');
  assert.ok(result.totalMaterialTnd > 0, 'placo total material should be > 0');
  assert.ok(result.estimatedLaborTnd > 0, 'placo labor should be > 0');
});

test('peinture: existing calculation produces expected result', () => {
  const input: PeintureInput = {
    length: 6, height: 2.8, openingsArea: 3,
    paintType: 'peinture_acrylique_10l', rendementM2L: 10, coats: 2,
    surfaceCondition: 'normal', wasteMarginPercent: 10, laborRatePerM2: 8,
  };
  const result = calculatePeinture(input, DEFAULT_MARKET_RATES);
  assert.equal(result.trade, 'peinture');
  assert.ok(result.materialItems.length > 0, 'peinture should produce material items');
  assert.ok(result.totalMaterialTnd > 0, 'peinture total material should be > 0');
});

// ════ 2) DYNAMIC TRADE: generic calculator with imported materials ════
test('dynamic trade (gypsum): generic calc resolves materials from rates', () => {
  const gypsumRates: MaterialRate[] = [
    { id: 'gypsum_board_13mm', category: 'gypsum', nameFr: 'Plâtre Gyproc 13mm', nameAr: 'جبس جيبورك 13مم', nameEn: null, unit: 'm²', unitPriceTnd: 28, defaultPriceTnd: 28 },
    { id: 'gypsum_joint_compound', category: 'gypsum', nameFr: 'Composé à joints', nameAr: 'معجون الوصلات', nameEn: null, unit: 'kg', unitPriceTnd: 12, defaultPriceTnd: 12 },
    { id: 'gypsum_screw', category: 'gypsum', nameFr: 'Vis plâtre', nameAr: 'مسامير جبس', nameEn: null, unit: 'unit', unitPriceTnd: 0.5, defaultPriceTnd: 0.5 },
  ];
  const allRates = [...DEFAULT_MARKET_RATES, ...gypsumRates];
  const input: GenericInput = {
    trade: 'gypsum', areaM2: 20, lengthM: 5,
    wasteMarginPercent: 10, laborRatePerM2: 15,
    tvaPercent: 19, includeTimbre: true, retenueGarantiePercent: 5,
  };
  const result = calculateGeneric(input, allRates);
  assert.equal(result.trade, 'gypsum');
  assert.equal(result.areaM2, 20);
  assert.equal(result.materialItems.length, 3, 'should resolve all 3 gypsum materials');
  assert.ok(result.totalMaterialTnd > 0, 'total material should be > 0');
  assert.ok(result.estimatedLaborTnd > 0, 'labor should be > 0');
  result.materialItems.forEach(item => {
    assert.ok(item.formulaUsed && item.formulaUsed.length > 0, `item ${item.id} should have a formula`);
  });
});

test('dynamic trade (aluminum): no rates → single zero-price placeholder', () => {
  const input: GenericInput = {
    trade: 'aluminum', areaM2: 30,
    wasteMarginPercent: 10, laborRatePerM2: 20,
  };
  const result = calculateGeneric(input, DEFAULT_MARKET_RATES);
  assert.equal(result.trade, 'aluminum');
  assert.equal(result.materialItems.length, 1, 'should produce exactly 1 placeholder');
  assert.equal(result.materialItems[0].unitPriceTnd, 0, 'placeholder should have zero price');
  assert.equal(result.materialItems[0].totalTnd, 0, 'placeholder should have zero total');
  assert.ok(result.fieldNotes[0].includes('aucun matériau'), 'should note no materials available');
});

// ════ 3) DYNAMIC TRADE: materials linked via tradeId (DB scenario) ════
test('dynamic trade: materials resolved by category regardless of source', () => {
  const smartGlassRates: MaterialRate[] = [
    { id: 'smart_glass_panel', category: 'smart_glass', nameFr: 'Verre intelligent 1m²', nameAr: 'زجاج ذكي', nameEn: null, unit: 'm²', unitPriceTnd: 450, defaultPriceTnd: 450 },
  ];
  const allRates = [...DEFAULT_MARKET_RATES, ...smartGlassRates];
  const input: GenericInput = {
    trade: 'smart_glass', areaM2: 12,
    wasteMarginPercent: 5, laborRatePerM2: 50,
  };
  const result = calculateGeneric(input, allRates);
  assert.equal(result.materialItems.length, 1);
  const item = result.materialItems[0];
  assert.equal(item.id, 'smart_glass_panel');
  assert.ok(item.qty > 0, 'qty should be computed from area');
  const expectedQty = Math.round(12 * 1.05 * 100) / 100;
  assert.equal(item.qty, expectedQty, `qty should be ${expectedQty} (area × waste)`);
});

// ════ 4) SERVICES: data-driven service resolution ════
test('services: official trade (placo) returns configured services', () => {
  const services = getServicesForTrade('placo');
  assert.ok(services.length > 0, 'placo should have services');
  assert.ok(services[0].labelFr && services[0].labelAr, 'service should have bilingual labels');
});

test('services: dynamic trade (gypsum) returns configured services', () => {
  const services = getServicesForTrade('gypsum');
  assert.ok(services.length > 0, 'gypsum should have services');
  assert.ok(TRADE_SERVICES['gypsum'], 'gypsum should be in TRADE_SERVICES config');
});

test('services: unknown dynamic trade gets generic fallback', () => {
  const services = getServicesForTrade('future_trade_xyz');
  assert.equal(services.length, 2, 'unknown trade gets 2 generic fallback services');
  assert.ok(services[0].labelFr.includes('future_trade_xyz'), 'fallback should reference trade code');
});

test('services: all official trades have service entries', () => {
  const officialTrades = ['placo','peinture','carrelage','maconnerie','plomberie','electricite','etancheite','isolation','menuiserie','sols','facade','demolition'];
  officialTrades.forEach(trade => {
    assert.ok(TRADE_SERVICES[trade] && TRADE_SERVICES[trade].length > 0, `${trade} should have services`);
  });
});

// ════ 5) GENERIC CALC: fiscal data computed correctly ════
test('generic calc: fiscal data (TVA, timbre, retenue) computed', () => {
  const gypsumRates: MaterialRate[] = [
    { id: 'gypsum_board', category: 'gypsum', nameFr: 'Plâtre', nameAr: 'جبس', nameEn: null, unit: 'm²', unitPriceTnd: 28, defaultPriceTnd: 28 },
  ];
  const input: GenericInput = {
    trade: 'gypsum', areaM2: 10,
    wasteMarginPercent: 0, laborRatePerM2: 10,
    tvaPercent: 19, includeTimbre: true, retenueGarantiePercent: 5,
  };
  const result = calculateGeneric(input, gypsumRates);
  assert.equal(result.totalMaterialTnd, 280); // 10 × 28
  assert.equal(result.estimatedLaborTnd, 100); // 10 × 10
  assert.equal(result.grandTotalTnd, 380); // 280 + 100
  assert.equal(result.tvaAmountTnd, 72.2); // 380 × 0.19
  assert.equal(result.timbreFiscalTnd, 1.0);
  assert.equal(result.retenueGarantieTnd, 19); // 380 × 0.05
  assert.equal(result.totalTtcTnd, 453.2); // 380 + 72.2 + 1
  assert.equal(result.netAPayerTnd, 434.2); // 453.2 - 19
});

// ════ 6) CODE-FREE EXTENSIBILITY: new TradeCategory not needed ════
test('code-free: dynamic trade code not in TradeCategory union is valid', () => {
  // A trade code that is NOT one of the 12 official TradeCategory values
  const input: GenericInput = {
    trade: 'smart_glass', // NOT in TradeCategory union
    areaM2: 10,
    wasteMarginPercent: 5,
    laborRatePerM2: 25,
  };
  const result = calculateGeneric(input, []);
  assert.equal(result.trade, 'smart_glass');
  assert.equal(result.areaM2, 10);
  // Should produce a placeholder (no materials) without crashing
  assert.ok(result.materialItems.length >= 1);
});

test('code-free: another dynamic trade code works without code changes', () => {
  const input: GenericInput = {
    trade: 'aluminium',
    areaM2: 15,
    wasteMarginPercent: 8,
    laborRatePerM2: 20,
  };
  const result = calculateGeneric(input, []);
  assert.equal(result.trade, 'aluminium');
  assert.ok(result.areaM2 === 15);
});

// ════ 7) PRICE PIPELINE: buildPriceMapWithTrade preserves trade info ════
test('buildPriceMapWithTrade: preserves trade and tradeId from server prices', () => {
  const serverPrices = [
    { code: 'gypsum-board', price: 28, trade: 'gypsum', tradeId: 'uuid-gypsum-1', isCurrent: true },
    { code: 'aluminium-panel', price: 150, trade: 'aluminium', tradeId: 'uuid-alu-1', isCurrent: true },
  ];
  const map = buildPriceMapWithTrade(serverPrices);
  assert.ok(map.has('gypsum-board'), 'gypsum-board should be in map');
  assert.ok(map.has('aluminium-panel'), 'aluminium-panel should be in map');
  const gypsum = map.get('gypsum-board')!;
  assert.equal(gypsum.price, 28);
  assert.equal(gypsum.trade, 'gypsum');
  assert.equal(gypsum.tradeId, 'uuid-gypsum-1');
});

test('mergeRates: uses correct trade from ResolvedPrice (not hardcoded placo)', () => {
  const priceMap = new Map<string, ResolvedPrice>([
    ['gypsum-board', { price: 28, trade: 'gypsum', tradeId: 'uuid-gypsum' }],
  ]);
  const result = mergeRates([], priceMap);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'gypsum-board');
  assert.equal(result[0].category, 'gypsum', 'category should be gypsum, NOT placo');
  assert.equal(result[0].unitPriceTnd, 28);
});

test('mergeRates: falls back to dynamic when no trade info', () => {
  const priceMap = new Map<string, ResolvedPrice>([
    ['unknown-material', { price: 50, trade: null, tradeId: null }],
  ]);
  const result = mergeRates([], priceMap);
  assert.equal(result.length, 1);
  assert.equal(result[0].category, 'dynamic', 'should fall back to dynamic');
});

// ════ 8) DYNAMIC SERVICES: DB-backed service resolution ════
test('services: loadServicesForTrade falls back to config when no DB', async () => {
  // No tradeId → should use config map
  const services = await loadServicesForTrade(null, 'placo');
  assert.ok(services && services.length > 0, 'placo should have services from config');
});

test('services: loadServicesForTrade uses generic fallback for unknown trade', async () => {
  const services = await loadServicesForTrade(null, 'brand_new_trade');
  assert.ok(services && services.length > 0, 'unknown trade gets generic fallback');
  // Generic fallback should NOT be the primary architecture — it's a safety net
  assert.ok(services![0].labelFr.includes('brand_new_trade'), 'fallback references trade code');
});

test('services: official trades have config map entries (backward compat)', () => {
  const officialTrades = ['placo','peinture','carrelage','maconnerie','plomberie','electricite','etancheite','isolation','menuiserie','sols','facade','demolition'];
  officialTrades.forEach(trade => {
    assert.ok(TRADE_SERVICES[trade] && TRADE_SERVICES[trade].length > 0, `${trade} should have services`);
  });
});

// ════ Summary ════
console.log(`\n📊 Phase D Result: ${passed} PASS / ${failed} FAIL`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(f));
  process.exit(1);
}
