/**
 * Step 5 — Material ID bridge unit tests (NO database needed).
 *
 * Proves the legacy-slug ↔ PostgreSQL-UUID bridge works in BOTH paths:
 *   - DB path   : price carries `code` (legacy slug) + `materialId` (UUID)
 *   - Memory path: price carries `materialId` (= legacy slug), no `code`
 *
 * Run: npx tsx tests/priceLookup.test.ts
 */
import { strict as assert } from 'node:assert';
import { buildPriceMap, mergeRates, priceKey, ResolvedPrice } from '../src/utils/priceLookup';
import { MaterialRate } from '../src/types';

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

const DB = '2026-01-01'; // effectiveFrom in the past so window covers "now"

// ── priceKey: chooses code (DB) or falls back to materialId (memory) ──────
test('priceKey prefers code (DB path: code = legacy slug)', () => {
  assert.equal(priceKey({ code: 'plaque_ba13_standard', materialId: 'uuid-111' }), 'plaque_ba13_standard');
});
test('priceKey falls back to materialId when code absent (memory path)', () => {
  assert.equal(priceKey({ materialId: 'plaque_ba13_standard' }), 'plaque_ba13_standard');
});
test('priceKey returns empty string when both absent', () => {
  assert.equal(priceKey({}), '');
});

// ── buildPriceMap: keyed by legacy slug, NOT by UUID ──────────────────────
test('DB path: price keyed by code, so legacy slug reaches the price (NOT 0)', () => {
  const serverPrices = [
    { materialId: 'uuid-ba13', code: 'plaque_ba13_standard', price: 30, isCurrent: true, effectiveFrom: DB },
    { materialId: 'uuid-hydro', code: 'plaque_ba13_hydrofuge', price: 46, isCurrent: true, effectiveFrom: DB },
  ];
  const map = buildPriceMap(serverPrices);
  assert.equal(map.has('plaque_ba13_standard'), true, 'legacy slug must be a key');
  assert.equal(map.get('plaque_ba13_standard'), 30, 'price 30 must be reachable by legacy slug');
  assert.equal(map.has('uuid-ba13'), false, 'UUID must NOT be the key');
});

test('Memory path: price keyed by materialId (legacy slug), no code field', () => {
  const serverPrices = [
    { materialId: 'plaque_ba13_standard', price: 30, isCurrent: true, effectiveFrom: DB },
  ];
  const map = buildPriceMap(serverPrices);
  assert.equal(map.get('plaque_ba13_standard'), 30, 'memory path reaches price by materialId');
});

test('legacy slug lookup does NOT end at 0 when server price exists', () => {
  const map = buildPriceMap([
    { materialId: 'uuid-x', code: 'plaque_ba13_standard', price: 30, isCurrent: true, effectiveFrom: DB },
  ]);
  const price = map.get('plaque_ba13_standard') ?? 0;
  assert.notEqual(price, 0, 'must not resolve to 0');
  assert.equal(price, 30);
});

// ── candidate selection / tiebreak (business logic preserved) ─────────────
test('isCurrent candidate is preferred', () => {
  const map = buildPriceMap([
    { materialId: 'u', code: 'plaque_ba13_standard', price: 99, isCurrent: false, effectiveFrom: '2099-01-01' },
    { materialId: 'u', code: 'plaque_ba13_standard', price: 30, isCurrent: true, effectiveFrom: DB },
  ]);
  assert.equal(map.get('plaque_ba13_standard'), 30, 'current price wins');
});

test('newest updatedAt wins on tie', () => {
  const map = buildPriceMap([
    { materialId: 'u', code: 'plaque_ba13_standard', price: 10, isCurrent: true, effectiveFrom: DB, updatedAt: '2026-01-01T00:00:00Z' },
    { materialId: 'u', code: 'plaque_ba13_standard', price: 42, isCurrent: true, effectiveFrom: DB, updatedAt: '2026-06-01T00:00:00Z' },
  ]);
  assert.equal(map.get('plaque_ba13_standard'), 42, 'newest updatedAt wins');
});

// ── mergeRates: server price priority over cached value ───────────────────
test('mergeRates: server price overrides cached value for same legacy slug', () => {
  const prev: MaterialRate[] = [
    { id: 'plaque_ba13_standard', category: 'placo', nameFr: 'BA13', nameAr: '', nameEn: null, unit: 'unit', unitPriceTnd: 5, defaultPriceTnd: 5 },
  ];
  const priceMap = new Map<string, ResolvedPrice>([['plaque_ba13_standard', { price: 30, trade: 'placo', tradeId: null }]]);
  const merged = mergeRates(prev, priceMap);
  const ba13 = merged.find(r => r.id === 'plaque_ba13_standard');
  assert.equal(ba13?.unitPriceTnd, 30, 'server price 30 must override cached 5');
});

test('mergeRates: keeps local value when no server price (fallback preserved)', () => {
  const prev: MaterialRate[] = [
    { id: 'plaque_ba13_standard', category: 'placo', nameFr: 'BA13', nameAr: '', nameEn: null, unit: 'unit', unitPriceTnd: 5, defaultPriceTnd: 5 },
  ];
  const merged = mergeRates(prev, new Map()); // empty map = offline / no data
  const ba13 = merged.find(r => r.id === 'plaque_ba13_standard');
  assert.equal(ba13?.unitPriceTnd, 5, 'local value preserved when no server price');
});

test('mergeRates: appends server-only slugs (Tier 3)', () => {
  const prev: MaterialRate[] = [];
  const priceMap = new Map<string, ResolvedPrice>([['plaque_ba13_standard', { price: 30, trade: 'placo', tradeId: null }]]);
  const merged = mergeRates(prev, priceMap);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'plaque_ba13_standard');
  assert.equal(merged[0].unitPriceTnd, 30);
});

console.log('\n═══════════════════════════════════════════');
console.log(` RESULTS: ✅ ${passed} passed | ❌ ${failed} failed`);
console.log('═══════════════════════════════════════════');
if (failures.length > 0) {
  console.log('FAILED TESTS:');
  failures.forEach(f => console.log(f));
}
process.exit(failed > 0 ? 1 : 0);