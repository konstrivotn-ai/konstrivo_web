/**
 * Step 9 — Multi-Market Price Source Connector Foundation unit tests.
 * Run: npx tsx tests/priceSources.test.ts
 *
 * Proves the connector abstraction contracts WITHOUT any database:
 *   1. connector output is normalized to
 *      materialCode + market + currency + price + source + observedAt
 *   2. an FR-source update stays FR (never leaks to TN)
 *   3. a TN-source update stays TN
 *   4. a connector cannot make a price official directly (no write path,
 *      no official flag on the candidate)
 *   5. a known material code is what links to the internal material
 */
import { strict as assert } from 'node:assert';
import {
  PRICE_SOURCE_SPECS,
  getPriceSourceSpec,
  getEnabledSourcesForMarket,
  normalizeConnectorCandidate,
  PriceSourceConnector,
} from '../server/priceSources/connector';

let passed = 0, failed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  PASS ${name}`); }
  catch (err: any) { failed++; const msg = `  FAIL ${name}\n       ${err?.message || err}`; failures.push(msg); console.log(msg); }
}

// A compliant connector using ONLY the pure normalization (no DB/network).
const frSpec = getPriceSourceSpec('SOURCE_FR_OFFICIAL')!;
const tnSpec = getPriceSourceSpec('SOURCE_TN_OFFICIAL')!;
const frConnector: PriceSourceConnector = {
  spec: frSpec,
  fetchCandidates() {
    return [
      normalizeConnectorCandidate(frSpec, { materialCode: 'plaque_ba13_standard', price: 50, observedAt: '2026-09-01T10:00:00.000Z' }),
      normalizeConnectorCandidate(frSpec, { materialCode: 'plaque_ba13_hydrofuge', price: 72, observedAt: '2026-09-01T10:00:00.000Z' }),
    ];
  },
};
const tnConnector: PriceSourceConnector = {
  spec: tnSpec,
  fetchCandidates() {
    return [
      normalizeConnectorCandidate(tnSpec, { materialCode: 'plaque_ba13_standard', price: 30, observedAt: '2026-09-01T10:00:00.000Z' }),
    ];
  },
};

test('config registry has TN + FR official sources (extensible, not fabricated)', () => {
  assert.ok(PRICE_SOURCE_SPECS.length >= 2, 'at least TN + FR sources');
  assert.equal(tnSpec.market, 'TN'); assert.equal(tnSpec.currency, 'TND'); assert.equal(tnSpec.enabled, true);
  assert.equal(frSpec.market, 'FR'); assert.equal(frSpec.currency, 'EUR'); assert.equal(frSpec.enabled, true);
});

test('getEnabledSourcesForMarket filters by market case-insensitively', () => {
  assert.deepEqual(getEnabledSourcesForMarket('FR').map(s => s.code), ['SOURCE_FR_OFFICIAL']);
  assert.deepEqual(getEnabledSourcesForMarket('fr').map(s => s.code), ['SOURCE_FR_OFFICIAL']);
  assert.deepEqual(getEnabledSourcesForMarket('TN').map(s => s.code), ['SOURCE_TN_OFFICIAL']);
});

test('connector output is normalized to materialCode+market+currency+price+source+observedAt', () => {
  const c = frConnector.fetchCandidates()[0];
  assert.equal(c.materialCode, 'plaque_ba13_standard');
  assert.equal(c.market, 'FR');
  assert.equal(c.currency, 'EUR');
  assert.equal(c.price, 50);
  assert.equal(c.sourceCode, 'SOURCE_FR_OFFICIAL');
  assert.equal(c.observedAt, '2026-09-01T10:00:00.000Z');
});

test('FR source update stays FR (market isolation enforced by normalization)', () => {
  const c = frConnector.fetchCandidates()[0];
  assert.equal(c.market, 'FR'); assert.equal(c.currency, 'EUR');
  // And a TN candidate produced through an FR source is REJECTED.
  assert.throws(() => normalizeConnectorCandidate(frSpec, { materialCode: 'x', price: 10, market: 'TN', currency: 'TND' }), /market/);
});

test('TN source update stays TN', () => {
  const c = tnConnector.fetchCandidates()[0];
  assert.equal(c.market, 'TN'); assert.equal(c.currency, 'TND'); assert.equal(c.price, 30);
  assert.throws(() => normalizeConnectorCandidate(tnSpec, { materialCode: 'x', price: 10, currency: 'EUR' }), /currency/);
});

test('a connector cannot make a price official directly (no official flag / no write path)', () => {
  // The candidate has NO isCurrent / official / approve field.
  const c = frConnector.fetchCandidates()[0];
  assert.ok(!('isCurrent' in c), 'no isCurrent on candidate');
  assert.ok(!('status' in c), 'no status on candidate');
  assert.ok(!('approve' in c), 'no approve method on candidate');
  // And the connector type has no write method: it only has fetchCandidates.
  assert.equal(typeof (frConnector as any).submitPendingPriceUpdate, 'undefined');
  assert.equal(typeof (frConnector as any).approve, 'undefined');
});

test('known material code is what links to the internal material (bridge, no new material)', () => {
  // The bridge contract: candidate.materialCode must equal an existing
  // materials.code. We assert the normalization preserves it verbatim and
  // that the well-known seeded slug is present.
  const knownCodes = ['plaque_ba13_standard', 'plaque_ba13_hydrofuge'];
  const c1 = frConnector.fetchCandidates()[0];
  assert.ok(knownCodes.includes(c1.materialCode), `materialCode '${c1.materialCode}' is a known seeded code`);
  // normalizeConnectorCandidate does NOT rename/alias — it keeps materialCode as given.
  assert.equal(normalizeConnectorCandidate(frSpec, { materialCode: 'plaque_ba13_standard', price: 50 }).materialCode, 'plaque_ba13_standard');
});

test('disabled source is rejected by normalization', () => {
  const disabled = { ...tnSpec, enabled: false };
  assert.throws(() => normalizeConnectorCandidate(disabled, { materialCode: 'plaque_ba13_standard', price: 30 }), /disabled/);
});

console.log('\n═══════════════════════════════════════════');
console.log(` RESULTS: ✅ ${passed} passed | ❌ ${failed} failed`);
console.log('═══════════════════════════════════════════');
if (failures.length > 0) { console.log('FAILED TESTS:'); failures.forEach(f => console.log(f)); }
process.exit(failed > 0 ? 1 : 0);