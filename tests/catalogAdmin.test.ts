/**
 * Step 5 — Catalog Admin bridge unit tests (NO real database).
 * Run: npx tsx tests/catalogAdmin.test.ts
 */
import { strict as assert } from 'node:assert';

let passed = 0, failed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  PASS ${name}`); }
  catch (err: any) { failed++; const msg = `  FAIL ${name}\n       ${err?.message || err}`; failures.push(msg); console.log(msg); }
}

interface FakeMaterial { id: string; code: string; trade: string; category: string; nameFr: string; nameAr: string | null; nameEn: string | null; baseUnit: string; isOfficial: boolean; companyId: string | null; technicalSpecs: string | null; }
interface FakePrice { id: string; materialId: string; sourceCode: string; unitPrice: string; currencyCode: string; countryCode: string; isCurrent: boolean; companyId: string | null; effectiveFrom: string; }

let matSeq = 0, priceSeq = 0;
const db = { materials: [] as FakeMaterial[], prices: [] as FakePrice[] };
function resetDb() { matSeq = 0; priceSeq = 0; db.materials = []; db.prices = []; }

function upsertMaterialByCode(data: { code: string; trade: string; category: string; nameFr: string; nameAr?: string | null; nameEn?: string | null; baseUnit: string; technicalSpecs?: string | null; }) {
  const existing = db.materials.find(m => m.code === data.code && m.companyId === null);
  if (existing) { Object.assign(existing, { trade: data.trade, category: data.category, nameFr: data.nameFr, nameAr: data.nameAr ?? null, nameEn: data.nameEn ?? null, baseUnit: data.baseUnit, technicalSpecs: data.technicalSpecs ?? null, isOfficial: true }); return { ...existing }; }
  const created: FakeMaterial = { id: `mat-${++matSeq}`, code: data.code, trade: data.trade, category: data.category, nameFr: data.nameFr, nameAr: data.nameAr ?? null, nameEn: data.nameEn ?? null, baseUnit: data.baseUnit, isOfficial: true, companyId: null, technicalSpecs: data.technicalSpecs ?? null };
  db.materials.push(created); return { ...created };
}
function upsertOfficialPrice(data: { materialCode: string; price: number; currencyCode?: string; countryCode?: string; effectiveFrom?: string; }) {
  const mat = db.materials.find(m => m.code === data.materialCode && m.companyId === null);
  if (!mat) throw new Error(`Official material '${data.materialCode}' not found`);
  const existing = db.prices.find(p => p.materialId === mat.id && p.sourceCode === 'OFFICIAL_DEFAULT' && p.isCurrent === true && p.companyId === null && p.countryCode === (data.countryCode || 'TN'));
  const values = { unitPrice: String(data.price), currencyCode: data.currencyCode || 'TND', countryCode: data.countryCode || 'TN', effectiveFrom: data.effectiveFrom || '2026-01-01' };
  if (existing) { Object.assign(existing, values); return { ...existing }; }
  const created: FakePrice = { id: `price-${++priceSeq}`, materialId: mat.id, sourceCode: 'OFFICIAL_DEFAULT', companyId: null, isCurrent: true, ...values };
  db.prices.push(created); return { ...created };
}

test('upsertMaterialByCode creates official material keyed by legacy code', () => {
  resetDb();
  const m = upsertMaterialByCode({ code: 'plaque_ba13_standard', trade: 'placo', category: 'placo', nameFr: 'Plaque BA13', baseUnit: 'unit' });
  assert.equal(m.code, 'plaque_ba13_standard'); assert.equal(m.companyId, null); assert.equal(m.isOfficial, true); assert.equal(db.materials.length, 1);
});
test('upsertMaterialByCode is idempotent (updates, never duplicates)', () => {
  resetDb();
  upsertMaterialByCode({ code: 'plaque_ba13_standard', trade: 'placo', category: 'placo', nameFr: 'BA13 v1', baseUnit: 'unit' });
  const u = upsertMaterialByCode({ code: 'plaque_ba13_standard', trade: 'placo', category: 'placo', nameFr: 'BA13 v2', baseUnit: 'unit' });
  assert.equal(u.nameFr, 'BA13 v2'); assert.equal(db.materials.length, 1);
});
test('upsertOfficialPrice creates price for material found by legacy code', () => {
  resetDb();
  upsertMaterialByCode({ code: 'plaque_ba13_standard', trade: 'placo', category: 'placo', nameFr: 'BA13', baseUnit: 'unit' });
  const p = upsertOfficialPrice({ materialCode: 'plaque_ba13_standard', price: 30 });
  assert.equal(parseFloat(p.unitPrice), 30, 'price value is 30');
  assert.equal(p.sourceCode, 'OFFICIAL_DEFAULT'); assert.equal(p.isCurrent, true); assert.equal(p.companyId, null); assert.equal(db.prices.length, 1);
});
test('upsertOfficialPrice is idempotent (updates price in place)', () => {
  resetDb();
  upsertMaterialByCode({ code: 'plaque_ba13_standard', trade: 'placo', category: 'placo', nameFr: 'BA13', baseUnit: 'unit' });
  upsertOfficialPrice({ materialCode: 'plaque_ba13_standard', price: 30 });
  const p2 = upsertOfficialPrice({ materialCode: 'plaque_ba13_standard', price: 33 });
  assert.equal(parseFloat(p2.unitPrice), 33, 'price updated to 33');
  assert.equal(db.prices.length, 1);
});
test('company-specific price is NEVER touched by official upsert', () => {
  resetDb();
  upsertMaterialByCode({ code: 'plaque_ba13_standard', trade: 'placo', category: 'placo', nameFr: 'BA13', baseUnit: 'unit' });
  const mat = db.materials[0];
  db.prices.push({ id: 'custom-1', materialId: mat.id, sourceCode: 'CUSTOM', unitPrice: '99.000', currencyCode: 'TND', countryCode: 'TN', isCurrent: true, companyId: 'company-abc', effectiveFrom: '2026-01-01' });
  upsertOfficialPrice({ materialCode: 'plaque_ba13_standard', price: 30 });
  const customPrice = db.prices.find(pr => pr.companyId === 'company-abc');
  assert.equal(customPrice?.unitPrice, '99.000'); assert.equal(db.prices.length, 2);
});

test('upsertOfficialPrice keeps TN and FR prices separate (multi-market, Step 7)', () => {
  resetDb();
  upsertMaterialByCode({ code: 'plaque_ba13_standard', trade: 'placo', category: 'placo', nameFr: 'BA13', baseUnit: 'unit' });
  const tn = upsertOfficialPrice({ materialCode: 'plaque_ba13_standard', price: 30, countryCode: 'TN', currencyCode: 'TND' });
  const fr = upsertOfficialPrice({ materialCode: 'plaque_ba13_standard', price: 50, countryCode: 'FR', currencyCode: 'EUR' });
  // Two DISTINCT rows for the SAME material — different markets, no overwrite.
  assert.equal(db.prices.length, 2);
  assert.equal(tn.countryCode, 'TN'); assert.equal(parseFloat(tn.unitPrice), 30); assert.equal(tn.currencyCode, 'TND');
  assert.equal(fr.countryCode, 'FR'); assert.equal(parseFloat(fr.unitPrice), 50); assert.equal(fr.currencyCode, 'EUR');
});
test('upsertOfficialPrice is idempotent per market (FR price does not overwrite TN) (Step 7)', () => {
  resetDb();
  upsertMaterialByCode({ code: 'plaque_ba13_standard', trade: 'placo', category: 'placo', nameFr: 'BA13', baseUnit: 'unit' });
  upsertOfficialPrice({ materialCode: 'plaque_ba13_standard', price: 30, countryCode: 'TN', currencyCode: 'TND' });
  upsertOfficialPrice({ materialCode: 'plaque_ba13_standard', price: 50, countryCode: 'FR', currencyCode: 'EUR' });
  // Save FR again — updates the FR row in place, leaves TN untouched.
  const fr2 = upsertOfficialPrice({ materialCode: 'plaque_ba13_standard', price: 55, countryCode: 'FR', currencyCode: 'EUR' });
  assert.equal(db.prices.length, 2, 'still exactly 2 rows');
  assert.equal(parseFloat(fr2.unitPrice), 55);
  const tnRow = db.prices.find(p => p.countryCode === 'TN');
  assert.equal(parseFloat(tnRow!.unitPrice), 30, 'TN price unchanged by FR upsert');
});

console.log('\n═══════════════════════════════════════════');
console.log(` RESULTS: ✅ ${passed} passed | ❌ ${failed} failed`);
console.log('═══════════════════════════════════════════');
if (failures.length > 0) { console.log('FAILED TESTS:'); failures.forEach(f => console.log(f)); }
process.exit(failed > 0 ? 1 : 0);