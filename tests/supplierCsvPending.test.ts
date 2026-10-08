/**
 * Step 11 — Supplier CSV/Excel → Pending Price Updates (unit, no DB).
 * Proves the mandated safety properties of the parse→pending bridge.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { buildSupplierCsvPendingPlan } from '../server/priceSources/supplierCsv';
import { normalizeConnectorCandidate, getPriceSourceSpec } from '../server/priceSources/connector';

const TN_ITEM = {
  materialCode: 'plaque_ba13_standard',
  priceTnd: 31.5,
  matchedMaterialId: 'uuid-ba13',
  status: 'matched' as const,
};
const UNMATCHED = {
  materialCode: 'PLA-TEST-001',
  priceTnd: 12,
  status: 'unmatched' as const,
};

test('known code row becomes a pending price submission (SUPPLIER_SUBMITTED)', () => {
  const plan = buildSupplierCsvPendingPlan([TN_ITEM], { countryCode: 'TN', currencyCode: 'TND', supplierId: 'sup-1', fileName: 'catalogue.csv' });
  assert.strictEqual(plan.submissions.length, 1);
  assert.strictEqual(plan.submissions[0].materialCode, 'plaque_ba13_standard');
  assert.strictEqual(plan.submissions[0].price, 31.5);
  assert.strictEqual(plan.submissions[0].candidate.sourceCode, 'SUPPLIER_SUBMITTED');
  ok(typeof plan.submissions[0].candidate.observedAt === 'string');
});

test('TN/TND file stays TN/TND', () => {
  const plan = buildSupplierCsvPendingPlan([TN_ITEM], { countryCode: 'TN', currencyCode: 'TND' });
  assert.strictEqual(plan.submissions[0].countryCode, 'TN');
  assert.strictEqual(plan.submissions[0].currencyCode, 'TND');
});

test('FR/EUR file stays FR/EUR and never leaks into TN/TND', () => {
  const fr = buildSupplierCsvPendingPlan([TN_ITEM], { countryCode: 'FR', currencyCode: 'EUR' });
  assert.strictEqual(fr.submissions[0].countryCode, 'FR');
  assert.strictEqual(fr.submissions[0].currencyCode, 'EUR');
  // Market mixing is impossible: the FR candidate cannot be re-normalized by a TN spec.
  const tnSpec = { code: 'SUPPLIER_SUBMITTED', name: 'TN', market: 'TN', currency: 'TND', kind: 'csv' as const, enabled: true };
  assert.throws(() => normalizeConnectorCandidate(tnSpec, {
    materialCode: 'plaque_ba13_standard',
    price: 52,
    market: 'FR',
    currency: 'EUR',
  }), /market/);
});

test('supplier update is NEVER official: no official flag, no write path', () => {
  const plan = buildSupplierCsvPendingPlan([TN_ITEM], { countryCode: 'TN', currencyCode: 'TND' });
  assert.strictEqual(plan.official, false);
  const candidate: Record<string, unknown> = { ...plan.submissions[0].candidate };
  for (const banned of ['isCurrent', 'is_current', 'status', 'approved', 'official']) {
    assert.ok(!(banned in candidate), `candidate must not carry '${banned}'`);
  }
  // Pending convention: SUPPLIER_SUBMITTED is the unverified source (price_sources.is_verified = false);
  // only the Step 8 admin approve path can promote it.
  assert.strictEqual(plan.submissions[0].candidate.sourceCode, 'SUPPLIER_SUBMITTED');
  assert.strictEqual(getPriceSourceSpec('OFFICIAL_DEFAULT'), undefined, 'connector layer exposes no official path');
});

test('unknown code → unmapped only; no material is created or guessed', () => {
  const plan = buildSupplierCsvPendingPlan([UNMATCHED, TN_ITEM], { countryCode: 'TN', currencyCode: 'TND' });
  assert.deepStrictEqual(plan.unmapped, ['PLA-TEST-001']);
  assert.strictEqual(plan.submissions.length, 1, 'unmatched row must not be submitted');
  // The plan output contains no material-creation payload — only codes/prices.
  const keys = new Set(plan.submissions.flatMap(s => Object.keys(s)));
  assert.ok(!keys.has('materialToCreate') && !keys.has('newMaterial'));
});

test('company-specific prices untouched: no companyId ever emitted, supplierId preserved', () => {
  const plan = buildSupplierCsvPendingPlan([TN_ITEM], { countryCode: 'TN', currencyCode: 'TND', supplierId: 'sup-77' });
  const s = plan.submissions[0];
  assert.strictEqual(s.supplierId, 'sup-77', 'supplier id preserved for isolation');
  assert.ok(!('companyId' in s), 'no companyId may be emitted (company rows are never written)');
  assert.ok(!('companyId' in s.candidate));
});

test('invalid price goes to invalid[], not submissions', () => {
  const plan = buildSupplierCsvPendingPlan([{ ...TN_ITEM, priceTnd: -5 }], { countryCode: 'TN', currencyCode: 'TND' });
  assert.strictEqual(plan.submissions.length, 0);
  assert.strictEqual(plan.invalid.length, 1);
  ok(/price/i.test(plan.invalid[0].reason));
});

test('materialCode is carried verbatim (no renaming, materials.code bridge)', () => {
  const plan = buildSupplierCsvPendingPlan([{ ...TN_ITEM, materialCode: 'enduit_enduit_pcp_25' }], { countryCode: 'TN', currencyCode: 'TND' });
  assert.strictEqual(plan.submissions[0].materialCode, 'enduit_enduit_pcp_25');
  assert.strictEqual(plan.submissions[0].candidate.materialCode, 'enduit_enduit_pcp_25');
});

function ok(cond: unknown, msg = 'expected truthy'): void {
  assert.ok(cond, msg);
}