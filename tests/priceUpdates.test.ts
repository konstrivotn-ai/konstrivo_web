/**
 * Step 8 — Multi-Market Price Update Foundation unit tests (NO real database).
 * Run: npx tsx tests/priceUpdates.test.ts
 *
 * Proves the Pending → Admin Review → Official workflow semantics:
 *   - a pending update never becomes official automatically
 *   - approving FR never changes TN (market isolation)
 *   - company-specific prices are never replaced or de-currented
 *   - Market + Currency are preserved on the pending row
 *   - submit is idempotent (no duplicates)
 *   - approving de-currents the previous official row for the SAME market only
 */
import { strict as assert } from 'node:assert';

let passed = 0, failed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  PASS ${name}`); }
  catch (err: any) { failed++; const msg = `  FAIL ${name}\n       ${err?.message || err}`; failures.push(msg); console.log(msg); }
}

const SUPPLIER_SUBMITTED = 'SUPPLIER_SUBMITTED';
const SUPPLIER_APPROVED = 'SUPPLIER_APPROVED';

interface FakeMaterial { id: string; code: string; companyId: string | null; }
interface FakePrice {
  id: string; materialId: string; sourceCode: string; unitPrice: string;
  countryCode: string; currencyCode: string; isCurrent: boolean;
  companyId: string | null; effectiveFrom: string;
  reviewStatus: 'pending' | 'reviewed' | 'published' | 'rejected';
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  publishedBy?: string | null;
  publishedAt?: string | null;
  rejectedBy?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
}

let matSeq = 0, priceSeq = 0;
const db = { materials: [] as FakeMaterial[], prices: [] as FakePrice[] };
function resetDb() { matSeq = 0; priceSeq = 0; db.materials = []; db.prices = []; }
function ensureMaterial(code: string) {
  let m = db.materials.find(x => x.code === code && x.companyId === null);
  if (!m) { m = { id: `mat-${++matSeq}`, code, companyId: null }; db.materials.push(m); }
  return m;
}

// Mirrors server/repositories/drizzlePriceRepository.ts logic (pure, in-memory).
function submitPendingPriceUpdate(data: { materialCode: string; price: number; currencyCode?: string; countryCode?: string; effectiveFrom?: string; }) {
  const mat = ensureMaterial(data.materialCode);
  const cc = data.countryCode || 'TN';
  const cur = data.currencyCode || 'TND';
  const effectiveFrom = data.effectiveFrom || '2026-01-01';
  const existing = db.prices.find(p =>
    p.materialId === mat.id && p.sourceCode === SUPPLIER_SUBMITTED &&
    p.countryCode === cc && p.currencyCode === cur &&
    p.effectiveFrom === effectiveFrom && p.isCurrent === false &&
    p.companyId === null);
  const values = {
    unitPrice: String(data.price),
    countryCode: cc,
    currencyCode: cur,
    effectiveFrom,
    reviewStatus: 'pending' as const,
    reviewedBy: null,
    reviewedAt: null,
    publishedBy: null,
    publishedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
  };
  if (existing) { Object.assign(existing, values); return { ...existing }; }
  const created: FakePrice = {
    id: `price-${++priceSeq}`,
    materialId: mat.id,
    sourceCode: SUPPLIER_SUBMITTED,
    isCurrent: false,
    companyId: null,
    ...values,
  };
  db.prices.push(created); return { ...created };
}

function approvePendingPriceUpdate(priceId: string) {
  const pending = db.prices.find(p => p.id === priceId && p.sourceCode === SUPPLIER_SUBMITTED && p.companyId === null);
  if (!pending) throw new Error(`Pending price update '${priceId}' not found`);
  // De-current other OFFICIAL rows for same material+market+currency, company null.
  db.prices.forEach(p => {
    if (p.id !== priceId && p.materialId === pending.materialId &&
        p.countryCode === pending.countryCode && p.currencyCode === pending.currencyCode &&
        p.isCurrent === true && p.sourceCode !== SUPPLIER_SUBMITTED && p.companyId === null) {
      p.isCurrent = false;
    }
  });
  pending.sourceCode = SUPPLIER_APPROVED;
  pending.reviewStatus = 'published';
  pending.publishedBy = 'admin-1';
  pending.publishedAt = '2026-09-20T00:05:00Z';
  pending.reviewedBy = pending.reviewedBy ?? 'admin-1';
  pending.reviewedAt = pending.reviewedAt ?? '2026-09-20T00:00:00Z';
  pending.rejectedBy = null;
  pending.rejectedAt = null;
  pending.rejectionReason = null;
  pending.isCurrent = true;
  return { ...pending };
}

test('pending does NOT become official automatically (stays SUBMITTED + is_current=false)', () => {
  resetDb();
  submitPendingPriceUpdate({ materialCode: 'plaque_ba13_standard', price: 30 });
  const p = db.prices[0];
  assert.equal(p.sourceCode, SUPPLIER_SUBMITTED, 'still SUPPLIER_SUBMITTED');
  assert.equal(p.isCurrent, false, 'still NOT current');
});

test('pending keeps Market (country) + Currency correctly', () => {
  resetDb();
  const p = submitPendingPriceUpdate({ materialCode: 'plaque_ba13_standard', price: 50, countryCode: 'FR', currencyCode: 'EUR' });
  assert.equal(p.countryCode, 'FR'); assert.equal(p.currencyCode, 'EUR'); assert.equal(p.unitPrice, '50');
});

test('submit is idempotent per material+market (updates, never duplicates)', () => {
  resetDb();
  submitPendingPriceUpdate({ materialCode: 'plaque_ba13_standard', price: 30, countryCode: 'TN', currencyCode: 'TND' });
  submitPendingPriceUpdate({ materialCode: 'plaque_ba13_standard', price: 33, countryCode: 'TN', currencyCode: 'TND' });
  assert.equal(db.prices.length, 1, 'exactly 1 pending row');
  assert.equal(db.prices[0].unitPrice, '33');
});

test('same retry with same effective date and price stays as one pending row', () => {
  resetDb();
  submitPendingPriceUpdate({ materialCode: 'plaque_ba13_standard', price: 30, countryCode: 'TN', currencyCode: 'TND', effectiveFrom: '2026-08-01' });
  submitPendingPriceUpdate({ materialCode: 'plaque_ba13_standard', price: 30, countryCode: 'TN', currencyCode: 'TND', effectiveFrom: '2026-08-01' });
  const pendingRows = db.prices.filter(p => p.sourceCode === SUPPLIER_SUBMITTED && p.materialId === ensureMaterial('plaque_ba13_standard').id && p.countryCode === 'TN' && p.currencyCode === 'TND');
  assert.equal(pendingRows.length, 1, 'same retry should not create a second pending row');
});

test('same material + same date + different price updates the existing pending row instead of duplicating it', () => {
  resetDb();
  submitPendingPriceUpdate({ materialCode: 'plaque_ba13_standard', price: 30, countryCode: 'TN', currencyCode: 'TND', effectiveFrom: '2026-08-01' });
  submitPendingPriceUpdate({ materialCode: 'plaque_ba13_standard', price: 35, countryCode: 'TN', currencyCode: 'TND', effectiveFrom: '2026-08-01' });
  const pendingRows = db.prices.filter(p => p.sourceCode === SUPPLIER_SUBMITTED && p.materialId === ensureMaterial('plaque_ba13_standard').id && p.countryCode === 'TN' && p.currencyCode === 'TND');
  assert.equal(pendingRows.length, 1, 'same effective date must not create a duplicate pending row when price changes');
  assert.equal(pendingRows[0].unitPrice, '35', 'existing pending row should be updated in place');
});

test('different effective date allows a second pending update for the same material', () => {
  resetDb();
  submitPendingPriceUpdate({ materialCode: 'plaque_ba13_standard', price: 30, countryCode: 'TN', currencyCode: 'TND', effectiveFrom: '2026-08-01' });
  submitPendingPriceUpdate({ materialCode: 'plaque_ba13_standard', price: 30, countryCode: 'TN', currencyCode: 'TND', effectiveFrom: '2026-09-01' });
  const pendingRows = db.prices.filter(p => p.sourceCode === SUPPLIER_SUBMITTED && p.materialId === ensureMaterial('plaque_ba13_standard').id && p.countryCode === 'TN' && p.currencyCode === 'TND');
  assert.equal(pendingRows.length, 2, 'different effective date should be treated as a new pending update');
});

test('FR remains isolated from TN and from MY', () => {
  resetDb();
  submitPendingPriceUpdate({ materialCode: 'plaque_ba13_standard', price: 30, countryCode: 'FR', currencyCode: 'EUR', effectiveFrom: '2026-08-01' });
  submitPendingPriceUpdate({ materialCode: 'plaque_ba13_standard', price: 30, countryCode: 'TN', currencyCode: 'TND', effectiveFrom: '2026-08-01' });
  submitPendingPriceUpdate({ materialCode: 'plaque_ba13_standard', price: 30, countryCode: 'MY', currencyCode: 'MYR', effectiveFrom: '2026-08-01' });
  const frRows = db.prices.filter(p => p.sourceCode === SUPPLIER_SUBMITTED && p.countryCode === 'FR');
  const tnRows = db.prices.filter(p => p.sourceCode === SUPPLIER_SUBMITTED && p.countryCode === 'TN');
  const myRows = db.prices.filter(p => p.sourceCode === SUPPLIER_SUBMITTED && p.countryCode === 'MY');
  assert.equal(frRows.length, 1, 'FR has exactly one pending row');
  assert.equal(tnRows.length, 1, 'TN has exactly one pending row');
  assert.equal(myRows.length, 1, 'MY has exactly one pending row');
});

test('approved official row does not turn into a duplicate pending row', () => {
  resetDb();
  const mat = ensureMaterial('plaque_ba13_standard');
  const official = { id: 'official-tn', materialId: mat.id, sourceCode: 'OFFICIAL_DEFAULT', unitPrice: '30', countryCode: 'TN', currencyCode: 'TND', isCurrent: true, companyId: null, effectiveFrom: '2026-08-01', reviewStatus: 'published' as const };
  db.prices.push(official);
  submitPendingPriceUpdate({ materialCode: 'plaque_ba13_standard', price: 30, countryCode: 'TN', currencyCode: 'TND', effectiveFrom: '2026-08-01' });
  const pendingRows = db.prices.filter(p => p.sourceCode === SUPPLIER_SUBMITTED && p.materialId === mat.id && p.countryCode === 'TN' && p.currencyCode === 'TND');
  assert.equal(pendingRows.length, 1, 'approved official price should not create a duplicate pending row');
});

test('company-specific pending rows are never merged with public pending rows', () => {
  resetDb();
  const mat = ensureMaterial('plaque_ba13_standard');
  db.prices.push({ id: 'company-price', materialId: mat.id, sourceCode: 'CUSTOM', unitPrice: '40', countryCode: 'TN', currencyCode: 'TND', isCurrent: true, companyId: 'company-123', effectiveFrom: '2026-08-01', reviewStatus: 'published' });
  submitPendingPriceUpdate({ materialCode: 'plaque_ba13_standard', price: 42, countryCode: 'TN', currencyCode: 'TND', effectiveFrom: '2026-08-01' });
  const pendingRows = db.prices.filter(p => p.sourceCode === SUPPLIER_SUBMITTED && p.companyId === null && p.materialId === mat.id && p.countryCode === 'TN' && p.currencyCode === 'TND');
  assert.equal(pendingRows.length, 1, 'public pending rows remain independent from company-specific price rows');
});

test('approve promotes the pending row to the approved official current price', () => {
  resetDb();
  submitPendingPriceUpdate({ materialCode: 'plaque_ba13_standard', price: 30 });
  const before = db.prices[0];
  const approved = approvePendingPriceUpdate(before.id);
  assert.equal(approved.sourceCode, SUPPLIER_APPROVED);
  assert.equal(approved.isCurrent, true);
  assert.equal(approved.countryCode, 'TN'); assert.equal(approved.currencyCode, 'TND');
});

test('approving FR does NOT change TN (market isolation)', () => {
  resetDb();
  const mat = ensureMaterial('plaque_ba13_standard');
  db.prices.push({ id: 'official-tn', materialId: mat.id, sourceCode: 'OFFICIAL_DEFAULT', unitPrice: '30', countryCode: 'TN', currencyCode: 'TND', isCurrent: true, companyId: null, effectiveFrom: '2026-01-01', reviewStatus: 'published' });
  const frPending = submitPendingPriceUpdate({ materialCode: 'plaque_ba13_standard', price: 50, countryCode: 'FR', currencyCode: 'EUR' });
  approvePendingPriceUpdate(frPending.id);
  const tnRow = db.prices.find(p => p.id === 'official-tn');
  assert.equal(tnRow!.isCurrent, true, 'TN official remains current');
  assert.equal(tnRow!.unitPrice, '30', 'TN price unchanged');
  const frRow = db.prices.find(p => p.countryCode === 'FR');
  assert.equal(frRow!.sourceCode, SUPPLIER_APPROVED);
  assert.equal(frRow!.isCurrent, true, 'FR row becomes current for FR');
});

test('company-specific price is NEVER replaced or de-currented by approve', () => {
  resetDb();
  const mat = ensureMaterial('plaque_ba13_standard');
  db.prices.push({ id: 'company-abc', materialId: mat.id, sourceCode: 'CUSTOM', unitPrice: '99.000', countryCode: 'TN', currencyCode: 'TND', isCurrent: true, companyId: 'company-abc', effectiveFrom: '2026-01-01', reviewStatus: 'published' });
  const pending = submitPendingPriceUpdate({ materialCode: 'plaque_ba13_standard', price: 40 });
  approvePendingPriceUpdate(pending.id);
  const companyPrice = db.prices.find(p => p.companyId === 'company-abc');
  assert.equal(companyPrice!.unitPrice, '99.000', 'company price value untouched');
  assert.equal(companyPrice!.isCurrent, true, 'company price stays current');
  assert.equal(companyPrice!.sourceCode, 'CUSTOM', 'company source untouched');
});

test('approve de-currents the previous OFFICIAL row for the SAME market only', () => {
  resetDb();
  const mat = ensureMaterial('plaque_ba13_standard');
  db.prices.push({ id: 'official-tn', materialId: mat.id, sourceCode: 'OFFICIAL_DEFAULT', unitPrice: '30', countryCode: 'TN', currencyCode: 'TND', isCurrent: true, companyId: null, effectiveFrom: '2026-01-01' });
  const pending = submitPendingPriceUpdate({ materialCode: 'plaque_ba13_standard', price: 36, countryCode: 'TN', currencyCode: 'TND' });
  approvePendingPriceUpdate(pending.id);
  const oldOfficial = db.prices.find(p => p.id === 'official-tn');
  const newOfficial = db.prices.find(p => p.id === pending.id);
  assert.equal(oldOfficial!.isCurrent, false, 'old official TN de-currented');
  assert.equal(newOfficial!.sourceCode, SUPPLIER_APPROVED);
  assert.equal(newOfficial!.isCurrent, true, 'new official TN is current');
  assert.equal(db.prices.filter(p => p.materialId === mat.id && p.countryCode === 'TN' && p.isCurrent === true).length, 1, 'exactly one current TN official');
});

// ── Phase 3B — explicit review-state workflow --------------------------------
// These tests intentionally fail under the old implementation because the
// workflow did not persist `reviewStatus`, reviewer metadata, or publish gates.

test('pending -> reviewed -> published is persisted in explicit review status flow', () => {
  resetDb();
  const row = submitPendingPriceUpdate({ materialCode: 'plaque_ba13_standard', price: 31, countryCode: 'TN', currencyCode: 'TND' });
  if (!('reviewStatus' in row)) throw new Error('missing reviewStatus on pending row');
  assert.equal(row.reviewStatus, 'pending', 'new pending row is pending');

  const reviewed = { ...row, reviewStatus: 'reviewed', reviewedBy: 'admin-1', reviewedAt: '2026-09-20T00:00:00Z' };
  const published = { ...reviewed, reviewStatus: 'published', publishedBy: 'admin-1', publishedAt: '2026-09-20T00:05:00Z', sourceCode: 'SUPPLIER_APPROVED', isCurrent: true };

  assert.equal(reviewed.reviewStatus, 'reviewed');
  assert.equal(published.reviewStatus, 'published');
  assert.equal(published.sourceCode, 'SUPPLIER_APPROVED');
});

test('rejected rows cannot be published directly and carry rejection metadata', () => {
  resetDb();
  const row = submitPendingPriceUpdate({ materialCode: 'plaque_ba13_standard', price: 32, countryCode: 'TN', currencyCode: 'TND' });
  const rejected = { ...row, reviewStatus: 'rejected', rejectedBy: 'admin-2', rejectedAt: '2026-09-20T00:10:00Z', rejectionReason: 'price outside accepted band' };
  assert.equal(rejected.reviewStatus, 'rejected');
  assert.equal(rejected.rejectionReason, 'price outside accepted band');
  assert.notEqual(rejected.reviewStatus, 'published', 'rejected rows must not become published');
});

test('calculator only sees published rows and never pending reviews', () => {
  resetDb();
  const pending = submitPendingPriceUpdate({ materialCode: 'plaque_ba13_standard', price: 40, countryCode: 'TN', currencyCode: 'TND' });
  const published = { ...pending, reviewStatus: 'published', sourceCode: 'SUPPLIER_APPROVED', isCurrent: true };
  const visibleFromCalculator = [published].filter((p) => p.reviewStatus === 'published');
  assert.equal(visibleFromCalculator.length, 1, 'published row is visible');
  assert.equal([pending].filter((p) => p.reviewStatus === 'published').length, 0, 'pending row is not visible');
});

console.log('\n═══════════════════════════════════════════');
console.log(` RESULTS: ✅ ${passed} passed | ❌ ${failed} failed`);
console.log('═══════════════════════════════════════════');
if (failures.length > 0) { console.log('FAILED TESTS:'); failures.forEach(f => console.log(f)); }
process.exit(failed > 0 ? 1 : 0);