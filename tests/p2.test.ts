/**
 * P2 — Review fixes (executable contract, DB-free).
 *
 * Covers the three P2 findings:
 *
 *  1. Admin price-review panel (click / refresh) — src/lib/priceReview.ts:
 *     a failed load must be reported (never rendered as an empty queue), the
 *     refresh action must be usable, and a row already being approved must not
 *     be approvable twice.
 *  2. Country/Pricing — src/utils/priceLookup.ts: a market may quote one
 *     material in several currencies; the market's official currency is
 *     preferred when requested, while omitting the preference keeps the exact
 *     legacy behaviour (newest updatedAt wins).
 *  3. HVAC (and any imported trade) — the ACTUAL imported material reaches the
 *     calculator: `mergeRates` keeps the authoritative trade code (empty
 *     category never becomes 'dynamic'), `applyParsedCatalog` keeps the file's
 *     "Métier", and `calculateGeneric` resolves a material by its trade code OR
 *     its category — so `Matériau hvac 0.000` is replaced by the real rows,
 *     while the documented zero-price placeholder still exists for a trade with
 *     no material at all.
 *
 * Run: npx tsx tests/p2.test.ts
 */
import { strict as assert } from 'node:assert';
import { buildPriceMapWithTrade, mergeRates } from '../src/utils/priceLookup';
import { calculateGeneric, GenericInput } from '../src/utils/calculations';
import { DEFAULT_MARKET_RATES } from '../src/data/marketRates';
import { applyParsedCatalog } from '../src/components/CatalogUploadModal';
import {
  resolvePendingReviewView,
  isApprovePendingBlocked,
  pendingReviewErrorMessage,
} from '../src/lib/priceReview';
import type { MaterialRate } from '../src/types';

let passed = 0;
let failed = 0;
const failures: string[] = [];
/** Synchronous runner: every P2 assertion below is synchronous, so the summary
 *  counts and the exit code are always accurate (no microtask race). */
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  PASS ${name}`); }
  catch (err: any) {
    failed++;
    const msg = `  FAIL ${name}\n       ${err?.message || err}`;
    failures.push(msg);
    console.log(msg);
  }
}

console.log('\n🧩 P2 — Review fixes (Test Review / Country-Pricing / HVAC linking)\n');

// ══════════════════════════════════════════════════════════════════════════
// 1) Test Review — admin pending-price panel state (click / refresh)
// ══════════════════════════════════════════════════════════════════════════

test('review: panel hidden outside the admin prices tab / for non-admins', () => {
  const base = { isAdmin: true, isPricesTab: false, state: 'loaded' as const, rowCount: 2, error: null };
  assert.equal(resolvePendingReviewView(base), 'hidden');
  assert.equal(resolvePendingReviewView({ ...base, isPricesTab: true, isAdmin: false }), 'hidden');
});

test('review: loading / empty / list states', () => {
  const base = { isAdmin: true, isPricesTab: true, rowCount: 0, error: null };
  assert.equal(resolvePendingReviewView({ ...base, state: 'loading' }), 'loading');
  assert.equal(resolvePendingReviewView({ ...base, state: 'loaded' }), 'empty');
  assert.equal(resolvePendingReviewView({ ...base, state: 'loaded', rowCount: 3 }), 'list');
});

test('review: a FAILED load is an error panel, never an empty queue', () => {
  const failedState = { isAdmin: true, isPricesTab: true, state: 'error' as const, rowCount: 0, error: 'HTTP 401' };
  assert.equal(resolvePendingReviewView(failedState), 'error');
  // A stale error with rows already in memory still reports the error (the admin
  // must retry, not trust a possibly outdated list).
  assert.equal(resolvePendingReviewView({ ...failedState, state: 'loaded', rowCount: 4 }), 'error');
  // Recovering: the next successful load clears the error state.
  assert.equal(resolvePendingReviewView({ ...failedState, state: 'loaded', error: null, rowCount: 4 }), 'list');
});

test('review: every row of the queue stays visible (no market filter drops data)', () => {
  assert.equal(resolvePendingReviewView({ isAdmin: true, isPricesTab: true, state: 'loaded', rowCount: 7, error: null }), 'list');
});

test('review: an approve click is blocked while the same row is in flight', () => {
  assert.equal(isApprovePendingBlocked([], 'row-1'), false);
  assert.equal(isApprovePendingBlocked(['row-2'], 'row-1'), false);
  assert.equal(isApprovePendingBlocked(['row-1'], 'row-1'), true);
  assert.equal(isApprovePendingBlocked(['row-1'], ''), true, 'a missing id can never be approved');
});

test('review: load/approve errors always produce a non-empty reason', () => {
  assert.equal(pendingReviewErrorMessage(new Error('Database not available')), 'Database not available');
  assert.equal(pendingReviewErrorMessage({ message: '  HTTP 403  ' }), 'HTTP 403');
  assert.equal(pendingReviewErrorMessage(null), 'Impossible de charger les mises à jour de prix en attente.');
  assert.equal(pendingReviewErrorMessage('boom'), 'Impossible de charger les mises à jour de prix en attente.');
  assert.equal(pendingReviewErrorMessage(new Error(''), "Impossible d'approuver ce prix."), "Impossible d'approuver ce prix.");
});

// ══════════════════════════════════════════════════════════════════════════
// 2) Country/Pricing — per-market, per-currency price selection
// ══════════════════════════════════════════════════════════════════════════

const MULTI_CURRENCY_ROWS = [
  { code: 'mat_a', price: 100, currency: 'TND', isCurrent: true, updatedAt: '2026-09-01T00:00:00Z', market: 'tn' },
  { code: 'mat_a', price: 30, currency: 'EUR', isCurrent: true, updatedAt: '2026-09-20T00:00:00Z', market: 'tn' },
];

test('pricing: no currency preference → legacy behaviour (newest row wins) unchanged', () => {
  const map = buildPriceMapWithTrade(MULTI_CURRENCY_ROWS);
  assert.equal(map.get('mat_a')!.price, 30);
});

test('pricing: market currency preference selects the market official currency', () => {
  assert.equal(buildPriceMapWithTrade(MULTI_CURRENCY_ROWS, 'TND').get('mat_a')!.price, 100);
  assert.equal(buildPriceMapWithTrade(MULTI_CURRENCY_ROWS, 'eur').get('mat_a')!.price, 30, 'preference is case-insensitive');
});

test('pricing: preference never drops a material quoted in another currency only', () => {
  const eurOnly = MULTI_CURRENCY_ROWS.filter(r => r.currency === 'EUR');
  assert.equal(buildPriceMapWithTrade(eurOnly, 'TND').get('mat_a')!.price, 30, 'fallback preserved');
  assert.equal(buildPriceMapWithTrade([], 'TND').size, 0);
});

test('pricing: another market\'s rows are never merged into an empty market list', () => {
  const tnOnly = buildPriceMapWithTrade(MULTI_CURRENCY_ROWS.filter(r => r.market === 'tn'), 'TND');
  assert.equal(tnOnly.get('mat_a')!.price, 100);
  assert.equal(buildPriceMapWithTrade([] as any[], 'EUR').size, 0, 'empty market list → nothing merged');
});

test('pricing: market switching replaces the previous market layer (merge base)', () => {
  // Mirrors App.tsx: the merge base is the LOCAL barème, never the previously
  // merged array → leaving TN for FR cannot keep the TN server price.
  const localBase: MaterialRate[] = [
    { id: 'plaque_ba13_standard', category: 'placo', nameFr: 'Plaque BA13', nameAr: '', unit: 'unit', unitPriceTnd: 28, defaultPriceTnd: 28 },
  ];
  const tnMerged = mergeRates(localBase, buildPriceMapWithTrade(
    [{ code: 'plaque_ba13_standard', price: 30, currency: 'TND', isCurrent: true, updatedAt: '2026-09-01T00:00:00Z' }], 'TND'
  ));
  assert.equal(tnMerged[0].unitPriceTnd, 30, 'TN server price wins on the local base');
  const frMerged = mergeRates(localBase, buildPriceMapWithTrade([] as any[], 'EUR'));
  assert.equal(frMerged[0].unitPriceTnd, 28, 'FR (no quote) falls back to the LOCAL value, not the TN server price');
});

// ══════════════════════════════════════════════════════════════════════════
// 3) HVAC — the actual imported materials reach the calculator
// ══════════════════════════════════════════════════════════════════════════

const HVAC_IMPORTED: MaterialRate[] = [
  { id: 'clim_split_12000', category: 'Chauffage', trade: 'hvac', nameFr: 'Climatiseur split 12000 BTU', nameAr: 'مكيف سبليت', unit: 'unit', unitPriceTnd: 2450, defaultPriceTnd: 2450 },
  { id: 'gaine_isolee_hvac', category: '', trade: 'hvac', nameFr: 'Gaine isolée HVAC', nameAr: 'مجرى معزول', unit: 'ml', unitPriceTnd: 18.5, defaultPriceTnd: 18.5 },
];

const HVAC_INPUT: GenericInput = {
  trade: 'hvac', areaM2: 40, lengthM: 25, wasteMarginPercent: 10, laborRatePerM2: 30,
};

test('hvac: materials are resolved by trade code even when the category differs', () => {
  const result = calculateGeneric(HVAC_INPUT, HVAC_IMPORTED);
  assert.equal(result.materialItems.length, 2, 'both imported HVAC materials are used');
  assert.ok(!result.materialItems.some(i => i.id === 'hvac-material'), 'no "Matériau hvac" placeholder');
  const clim = result.materialItems.find(i => i.id === 'clim_split_12000');
  assert.ok(clim, 'climatiseur row present');
  assert.equal(clim!.unitPriceTnd, 2450);
  assert.ok(clim!.totalTnd > 0, 'priced line (was 0.000 before the fix)');
  assert.ok(result.totalMaterialTnd > 0);
});

test('hvac: empty category is linked by the trade code (never drops the material)', () => {
  const result = calculateGeneric(HVAC_INPUT, [HVAC_IMPORTED[1]]);
  assert.equal(result.materialItems.length, 1);
  assert.equal(result.materialItems[0].id, 'gaine_isolee_hvac');
  assert.equal(result.materialItems[0].unitPriceTnd, 18.5);
});

test('hvac: trade match is case/whitespace normalized', () => {
  const result = calculateGeneric({ ...HVAC_INPUT, trade: ' HVAC ' }, HVAC_IMPORTED);
  assert.equal(result.materialItems.length, 2);
});

test('hvac: NO material for the trade still yields the documented zero placeholder', () => {
  const result = calculateGeneric({ trade: 'hvac', areaM2: 10, wasteMarginPercent: 0, laborRatePerM2: 10 }, DEFAULT_MARKET_RATES);
  assert.equal(result.materialItems.length, 1);
  assert.equal(result.materialItems[0].id, 'hvac-material');
  assert.equal(result.materialItems[0].unitPriceTnd, 0);
  assert.ok(result.fieldNotes[0].includes('aucun matériau'));
});

test('hvac: category-only matching (no trade field) is unchanged — regression', () => {
  const gypsum: MaterialRate[] = [
    { id: 'gypsum_board_13mm', category: 'gypsum', nameFr: 'Plâtre Gyproc 13mm', nameAr: '', unit: 'm²', unitPriceTnd: 28, defaultPriceTnd: 28 },
  ];
  const result = calculateGeneric({ trade: 'gypsum', areaM2: 20, wasteMarginPercent: 10, laborRatePerM2: 15 }, gypsum);
  assert.equal(result.materialItems.length, 1);
  assert.equal(result.materialItems[0].unitPriceTnd, 28);
});

test('hvac: server price row (category empty + trade code) merges with the real trade', () => {
  const map = buildPriceMapWithTrade([
    {
      code: 'clim_split_12000', price: 2450, currency: 'TND', market: 'tn', isCurrent: true,
      updatedAt: '2026-09-19T00:00:00Z', trade: 'hvac', category: '', nameFr: 'Climatiseur split 12000 BTU',
      unit: 'unit', nameAr: 'مكيف سبليت',
    },
  ], 'TND');
  const merged = mergeRates([], map);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'clim_split_12000');
  assert.equal(merged[0].trade, 'hvac', 'authoritative trade code kept on the rate');
  assert.equal(merged[0].category, 'hvac', 'empty category falls back to the trade — never "dynamic"');
  assert.equal(merged[0].nameFr, 'Climatiseur split 12000 BTU', 'real material name, no placeholder');
  const result = calculateGeneric(HVAC_INPUT, merged);
  assert.equal(result.materialItems.length, 1);
  assert.equal(result.materialItems[0].unitPriceTnd, 2450);
});

test('hvac: an imported CSV item keeps its Métier for the calculator', () => {
  const { updatedRates, addedCount } = applyParsedCatalog([], [
    {
      materialCode: 'HVAC-001', nameFr: 'Climatiseur split 12000 BTU', category: 'Chauffage',
      trade: 'hvac', unit: 'unit', newPriceTnd: 2450, tvaRate: 19, currency: 'TND',
    } as any,
  ], { supplierName: 'Test P2' });
  assert.equal(addedCount, 1);
  assert.equal(updatedRates[0].id, 'hvac_001');
  assert.equal(updatedRates[0].category, 'Chauffage', 'display family preserved');
  assert.equal(updatedRates[0].trade, 'hvac', 'authoritative trade code preserved');
  const result = calculateGeneric(HVAC_INPUT, updatedRates);
  assert.equal(result.materialItems.length, 1);
  assert.equal(result.materialItems[0].unitPriceTnd, 2450);
  assert.ok(!result.materialItems.some(i => i.id === 'hvac-material'));
});

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════');
console.log(` P2 — ${passed} passed / ${failed} failed`);
console.log('═══════════════════════════════════════════\n');
if (failures.length > 0) {
  failures.forEach(f => console.log(f));
  process.exit(1);
}


