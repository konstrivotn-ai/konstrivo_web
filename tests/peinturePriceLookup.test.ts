import { strict as assert } from 'node:assert';
import { buildPriceMapWithTrade, mergeRates } from '../src/utils/priceLookup';
import { DEFAULT_MARKET_RATES } from '../src/data/marketRates';

function test(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS ${name}`); }
  catch (err: any) { console.log(`  FAIL ${name}\n       ${err?.message || err}`); process.exit(1); }
}

// Simulate server TN rows: canonical codes (hyphenated) or legacy slugs
const now = new Date().toISOString();
const row = (code: string, price: number) => ({
  id: `r-${code}`,
  materialId: `m-${code}`,
  code,
  price,
  currency: 'TND',
  countryCode: 'TN',
  source: 'OFFICIAL_DEFAULT',
  isCurrent: true,
  effectiveFrom: now,
  updatedAt: now,
  version: 1,
  isDeleted: false,
});

test('buildPriceMap + mergeRates resolves peinture_acrylique_10l when server has TN price', () => {
  const rows = [row('peinture-acrylique-10l', 65.0)];
  const map = buildPriceMapWithTrade(rows as any[]);
  const merged = mergeRates([], map);
  const found = merged.find(r => r.id === 'peinture_acrylique_10l');
  assert.ok(found, 'peinture_acrylique_10l must be present in merged rates');
  assert.equal(found!.unitPriceTnd, 65.0);
});

test('buildPriceMap + mergeRates resolves enduit_joint_25kg via canonical enduit-25kg', () => {
  const rows = [row('enduit-25kg', 42.0)];
  const map = buildPriceMapWithTrade(rows as any[]);
  const merged = mergeRates([], map);
  const found = merged.find(r => r.id === 'enduit_joint_25kg');
  assert.ok(found, 'enduit_joint_25kg must be present in merged rates');
  assert.equal(found!.unitPriceTnd, 42.0);
});

console.log('\npeinturePriceLookup tests completed');
