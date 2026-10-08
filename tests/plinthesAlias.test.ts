import { strict as assert } from 'node:assert';
import { priceKeysFor, buildPriceMap } from '../src/utils/priceLookup';
import { DEFAULT_MARKET_RATES } from '../src/data/marketRates';

function test(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS ${name}`); }
  catch (err: any) { console.log(`  FAIL ${name}\n       ${err?.message || err}`); process.exit(1); }
}

test('plinthes canonical hyphen maps to carrelage legacy id via alias', () => {
  const expanded = priceKeysFor('plinthes-mdf-decor-2-4m');
  assert.deepEqual(expanded, ['plinthes_carrelage']);
});

test('buildPriceMap places plinthes price under legacy id', () => {
  const now = new Date().toISOString().slice(0,10);
  const row = { id: 'r-1', materialId: 'm-1', code: 'plinthes-mdf-decor-2-4m', price: 11.0, currency: 'TND', countryCode: 'TN', source: 'OFFICIAL_DEFAULT', isCurrent: true, effectiveFrom: now, updatedAt: now } as any;
  const map = buildPriceMap([row]);
  assert.equal(map.get('plinthes_carrelage'), 11.0);
  assert.equal(map.has('plinthes-mdf-decor-2-4m'), false);
});

console.log('\nplinthesAlias tests completed');
