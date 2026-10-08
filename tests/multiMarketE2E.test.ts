/**
 * Step 12 — Multi-Market End-to-End Price Verification (in-memory, NO database).
 * Run: npx tsx tests/multiMarketE2E.test.ts
 *
 * Proves the FULL mandated path for a second market (FR/EUR) while TN/TND stays
 * untouched, for the material `plaque_ba13_standard`:
 *
 *   Supplier CSV FR/EUR
 *     ↓  buildSupplierCsvPendingPlan()     ← REAL (server/priceSources/supplierCsv.ts)
 *     ↓  normalizeConnectorCandidate()     ← REAL (called inside the plan builder)
 *     ↓  submitPendingPriceUpdate()        ← in-memory replica of drizzlePriceRepository
 *     ↓  SUPPLIER_SUBMITTED (is_current=false, company_id=NULL)
 *     ↓  listPrices('fr' | 'tn')           ← in-memory replica (Step 1+2 semantics)
 *     ↓  buildPriceMap() + mergeRates()    ← REAL (src/utils/priceLookup.ts — what App.tsx runs)
 *     ↓  getPrice()                        ← replica of the src/utils/calculations.ts lookup
 *
 * REAL vs REPLICA (honesty note):
 *  - The pure pipeline functions (CSV plan, price map, rates merge) are the REAL
 *    project functions imported directly — the exact code the website executes.
 *  - The repository stage needs a live PostgreSQL connection, so it is replicated
 *    rule-for-rule from server/repositories/drizzlePriceRepository.ts. The same
 *    WHERE semantics are independently proven against the REAL repo by
 *    tests/price_normalization.test.ts (Step 2, via .toSQL()) and
 *    tests/priceUpdates.test.ts (Step 8):
 *      listPrices: is_deleted=false AND source_code <> 'SUPPLIER_SUBMITTED'
 *                  AND upper(country_code)=upper(market)
 *                  ORDER BY effective_from DESC, updated_at DESC
 *                  JOIN materials → code (Step 5 bridge)
 *      submit:     lookup (material, SUPPLIER_SUBMITTED, country, currency,
 *                  is_current=false, company IS NULL) → update in place | insert
 *      approve:    demote official rows of SAME material+country+currency only
 *                  (company IS NULL) → promote pending to SUPPLIER_APPROVED
 *      normalize:  price:number, market lowercase, code from materials JOIN (Step 1)
 */
import { strict as assert } from 'node:assert';
import { buildSupplierCsvPendingPlan } from '../server/priceSources/supplierCsv';
import { buildPriceMapWithTrade, mergeRates } from '../src/utils/priceLookup';

let passed = 0, failed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  PASS ${name}`); }
  catch (err: any) { failed++; const msg = `  FAIL ${name}\n       ${err?.message || err}`; failures.push(msg); console.log(msg); }
}

// ── Fixture constants ────────────────────────────────────────────────────────
const CODE = 'plaque_ba13_standard';                       // materials.code (never changed)
const MAT_UUID = '11111111-1111-4111-8111-111111111111';   // materials.id (never changed)
const OFFICIAL = 'OFFICIAL_DEFAULT';
const SUBMITTED = 'SUPPLIER_SUBMITTED';
const APPROVED = 'SUPPLIER_APPROVED';

interface Row {
  id: string; materialId: string; sourceCode: string; unitPrice: string;
  countryCode: string; currencyCode: string; isCurrent: boolean;
  companyId: string | null; supplierId: string | null;
  effectiveFrom: string; effectiveTo: string | null;
  isDeleted: boolean; createdAt: string; updatedAt: string; version: number;
  notes: string | null;
}

// The materials registry holds EXACTLY ONE material — nothing may ever create another.
const materials: Array<{ id: string; code: string; companyId: string | null }> = [
  { id: MAT_UUID, code: CODE, companyId: null },
];

let rows: Row[] = [];
let seq = 0;
const nowIso = () => new Date().toISOString();

function materialByCode(code: string) {
  return materials.find(m => m.code === code && m.companyId === null) ?? null;
}
// upsertOfficialPrice — Step 4/7 semantics (seeds the official TN price).
function upsertOfficialPrice(code: string, p: { price: number; countryCode: string; currencyCode: string; effectiveFrom: string; updatedAt: string }): Row {
  const mat = materialByCode(code);
  if (!mat) throw new Error(`upsertOfficialPrice: material '${code}' not found`);
  const existing = rows.find(r => r.materialId === mat.id && r.sourceCode === OFFICIAL &&
    r.isCurrent === true && r.countryCode === p.countryCode && r.currencyCode === p.currencyCode &&
    r.companyId === null && !r.isDeleted);
  if (existing) {
    existing.unitPrice = p.price.toFixed(3);
    existing.effectiveFrom = p.effectiveFrom;
    existing.updatedAt = p.updatedAt;
    return existing;
  }
  const row: Row = { id: `row-${++seq}`, materialId: mat.id, sourceCode: OFFICIAL,
    unitPrice: p.price.toFixed(3), countryCode: p.countryCode, currencyCode: p.currencyCode,
    isCurrent: true, companyId: null, supplierId: null, effectiveFrom: p.effectiveFrom,
    effectiveTo: null, isDeleted: false, createdAt: p.updatedAt, updatedAt: p.updatedAt,
    version: 1, notes: null };
  rows.push(row);
  return row;
}

// submitPendingPriceUpdate — Step 8 semantics (pending only; company rows never written).
function submitPendingPriceUpdate(s: { materialCode: string; price: number; countryCode: string; currencyCode: string; supplierId?: string; effectiveFrom?: string; notes?: string; observedAt?: string }): Row {
  const mat = materialByCode(s.materialCode);
  if (!mat) throw new Error(`submitPendingPriceUpdate: material '${s.materialCode}' not found (never auto-created)`);
  const cc = s.countryCode.toUpperCase();
  const cur = s.currencyCode.toUpperCase();
  const existing = rows.find(r => r.materialId === mat.id && r.sourceCode === SUBMITTED &&
    r.countryCode === cc && r.currencyCode === cur && r.isCurrent === false &&
    r.companyId === null && !r.isDeleted);
  const ts = s.observedAt || nowIso();
  if (existing) {
    existing.unitPrice = s.price.toFixed(3);
    existing.effectiveFrom = s.effectiveFrom || existing.effectiveFrom;
    existing.updatedAt = ts;
    existing.supplierId = s.supplierId ?? existing.supplierId;
    return existing;
  }
  const row: Row = { id: `row-${++seq}`, materialId: mat.id, sourceCode: SUBMITTED,
    unitPrice: s.price.toFixed(3), countryCode: cc, currencyCode: cur, isCurrent: false,
    companyId: null, supplierId: s.supplierId ?? null,
    effectiveFrom: s.effectiveFrom || ts.slice(0, 10), effectiveTo: null, isDeleted: false,
    createdAt: ts, updatedAt: ts, version: 1, notes: s.notes ?? null };
  rows.push(row);
  return row;
}

// approvePendingPriceUpdate — Step 8 semantics (same market+currency only).
function approvePendingPriceUpdate(priceId: string): Row {
  const pending = rows.find(r => r.id === priceId && r.sourceCode === SUBMITTED &&
    r.companyId === null && !r.isDeleted);
  if (!pending) throw new Error(`Pending price update '${priceId}' not found`);
  rows.forEach(p => {
    if (p.id !== priceId && p.materialId === pending.materialId &&
        p.countryCode === pending.countryCode && p.currencyCode === pending.currencyCode &&
        p.isCurrent === true && p.sourceCode !== SUBMITTED && p.companyId === null && !p.isDeleted) {
      p.isCurrent = false;
    }
  });
  pending.sourceCode = APPROVED;
  pending.isCurrent = true;
  pending.updatedAt = nowIso();
  return pending;
}

// listPrices — Step 1 (normalize) + Step 2 (case-insensitive market, ordering)
// + Step 5 (materials.code JOIN) + Step 8 (pending excluded).
function listPrices(market: string) {
  const m = market.toUpperCase();
  return rows
    .filter(r => !r.isDeleted && r.sourceCode !== SUBMITTED && r.countryCode.toUpperCase() === m)
    .sort((a, b) => {
      if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom < b.effectiveFrom ? 1 : -1;
      return a.updatedAt < b.updatedAt ? 1 : -1;
    })
    .map(r => ({
      id: r.id,
      materialId: r.materialId,
      code: materials.find(m2 => m2.id === r.materialId)!.code,  // JOIN materials → code
      price: Number(r.unitPrice),                                // NUMERIC → number
      currency: r.currencyCode,
      source: r.sourceCode,
      market: r.countryCode.toLowerCase(),
      countryCode: r.countryCode,
      companyId: r.companyId,
      supplierId: r.supplierId,
      isCurrent: r.isCurrent,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo ?? undefined,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      version: r.version,
    }));
}

// ── Website side: REAL functions from src/utils/priceLookup.ts (used by App.tsx) ──
import { MaterialRate } from '../src/types';
const LOCAL_RATES: MaterialRate[] = [{ id: CODE, category: 'placo', nameFr: 'Plaque de plâtre BA13',
  nameAr: '', nameEn: null, unit: 'unit', unitPriceTnd: 28, defaultPriceTnd: 28 }];
// Mirrors App.tsx: priceMap = buildPriceMap(await listPrices({ market: country.toLowerCase() }))
const syncRates = (market: string, prev = LOCAL_RATES) => mergeRates(prev, buildPriceMapWithTrade(listPrices(market)));
// Mirrors src/utils/calculations.ts: getPrice = (id) => rates.find(r => r.id === id)?.unitPriceTnd || 0
const getPrice = (rates: Array<{ id: string; unitPriceTnd: number }>, id: string) =>
  rates.find(r => r.id === id)?.unitPriceTnd || 0;
// ════ STAGE A — seed: ONE material, official TN/TND 30, company-specific TN 99 ════
const TN_OFFICIAL_BEFORE = JSON.parse(JSON.stringify(
  upsertOfficialPrice(CODE, { price: 30, countryCode: 'TN', currencyCode: 'TND',
    effectiveFrom: '2026-08-01', updatedAt: '2026-08-01T10:00:00Z' })));
rows.push({ id: 'company-abc', materialId: MAT_UUID, sourceCode: 'CUSTOM',
  unitPrice: '99.000', countryCode: 'TN', currencyCode: 'TND', isCurrent: true,
  companyId: 'company-abc', supplierId: null, effectiveFrom: '2026-01-01', effectiveTo: null,
  isDeleted: false, createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z',
  version: 1, notes: null });
const COMPANY_BEFORE = JSON.parse(JSON.stringify(rows.find(r => r.id === 'company-abc')));

// ════ STAGE B — supplier CSV FR/EUR arrives (parse + materials.code matching output) ════
const FR_ITEMS = [
  { materialCode: CODE, priceTnd: 52, matchedMaterialId: MAT_UUID, status: 'matched' as const },
  { materialCode: 'PLA-UNKNOWN-999', priceTnd: 12, status: 'unmatched' as const },
];
const plan = buildSupplierCsvPendingPlan(FR_ITEMS, {
  countryCode: 'FR', currencyCode: 'EUR', supplierId: 'sup-fr-1',
  fileName: 'catalogue_fr.csv', observedAt: '2026-09-01T08:00:00Z',
});

// ════ STAGE C — /suppliers/upload applies the plan → pending rows ════
for (const s of plan.submissions) submitPendingPriceUpdate(s);
// a duplicate re-send must not create a second pending row (idempotency)
submitPendingPriceUpdate({ materialCode: CODE, price: 52, countryCode: 'FR',
  currencyCode: 'EUR', supplierId: 'sup-fr-1', observedAt: '2026-09-01T08:30:00Z' });

const pendingRow = rows.find(r => r.sourceCode === SUBMITTED)!;
// Snapshot BEFORE approve (rows are live objects — approve mutates them in place).
const PENDING_BEFORE = JSON.parse(JSON.stringify(pendingRow));
const PENDING_COUNT_BEFORE = rows.filter(r => r.sourceCode === SUBMITTED).length;
const BEFORE = {
  frList: listPrices('fr'),
  tnList: listPrices('tn'),
  frRates: syncRates('fr'),
  tnRates: syncRates('tn'),
};

// ════ STAGE D — admin approves the FR pending update ════
approvePendingPriceUpdate(pendingRow.id);
const AFTER = {
  frList: listPrices('FR'),   // upper-case input on purpose (Step 2 case-insensitivity)
  tnList: listPrices('tn'),
  frRates: syncRates('fr'),
  tnRates: syncRates('tn'),
  frRow: rows.find(r => r.countryCode === 'FR')!,
  tnOfficial: rows.find(r => r.sourceCode === OFFICIAL)!,
  company: rows.find(r => r.id === 'company-abc')!,
};

// ════ Assertions — the mandated end-to-end properties ════

test('E2E 1 — one material: FR pending and TN official share the SAME UUID via materials.code', () => {
  assert.equal(materials.length, 1, 'no material was ever created');
  assert.equal(pendingRow.materialId, MAT_UUID, 'FR pending → same materials.id');
  assert.equal(TN_OFFICIAL_BEFORE.materialId, MAT_UUID, 'TN official → same materials.id');
  assert.equal(plan.submissions.length, 1, 'only the matched row is submitted');
  assert.equal(plan.submissions[0].materialCode, CODE, 'code carried verbatim → materials.code');
  assert.equal(plan.official, false, 'the bridge can never produce an official price');
  assert.equal(plan.spec.market, 'FR');
  assert.equal(plan.spec.currency, 'EUR', 'whole file pinned to one market+currency');
});

test('E2E 2 — FR/EUR stays FR/EUR: pending row stores market+currency+price+supplier', () => {
  assert.equal(PENDING_BEFORE.countryCode, 'FR');
  assert.equal(PENDING_BEFORE.currencyCode, 'EUR');
  assert.equal(PENDING_BEFORE.unitPrice, '52.000');
  assert.equal(PENDING_BEFORE.sourceCode, SUBMITTED, 'SUPPLIER_SUBMITTED until approved');
  assert.equal(PENDING_BEFORE.isCurrent, false, 'is_current=false until approve');
  assert.equal(PENDING_BEFORE.companyId, null, 'company rows are never written');
  assert.equal(PENDING_BEFORE.supplierId, 'sup-fr-1', 'supplier isolation preserved');
  assert.equal(typeof plan.submissions[0].candidate.observedAt, 'string');
});

test('E2E 3 — TN/TND stays TN/TND: official row shape intact before anything happens', () => {
  assert.equal(TN_OFFICIAL_BEFORE.countryCode, 'TN');
  assert.equal(TN_OFFICIAL_BEFORE.currencyCode, 'TND');
  assert.equal(TN_OFFICIAL_BEFORE.unitPrice, '30.000');
  assert.equal(TN_OFFICIAL_BEFORE.sourceCode, OFFICIAL);
  assert.equal(TN_OFFICIAL_BEFORE.isCurrent, true);
});

test('E2E 4 — BEFORE approve: TN price unchanged; FR update is pending ONLY (never official)', () => {
  assert.equal(BEFORE.frList.length, 0, 'SUPPLIER_SUBMITTED is excluded from GET /prices');
  const tnOfficial = BEFORE.tnList.filter(p => p.source === OFFICIAL && p.isCurrent);
  assert.equal(tnOfficial.length, 1, 'exactly one official current TN price');
  assert.equal(tnOfficial[0].price, 30);
  assert.equal(tnOfficial[0].isCurrent, true);
  assert.equal(PENDING_COUNT_BEFORE, 1, 'idempotent submit → no duplicates before approve');
});

test('E2E 5 — BEFORE approve: FR calculator keeps the local fallback (28) — pending leaks nowhere', () => {
  assert.equal(getPrice(BEFORE.frRates, CODE), 28, 'no official FR price yet → local fallback value');
});

test('E2E 6 — BEFORE approve: TN calculator already uses the server TN price (30) via materials.code', () => {
  assert.equal(getPrice(BEFORE.tnRates, CODE), 30, 'server price wins over the local cached 28 (Step 3 priority)');
});
test('E2E 7 — AFTER approve: FR becomes official/current (FR/EUR 52, SUPPLIER_APPROVED)', () => {
  assert.equal(AFTER.frRow.sourceCode, APPROVED);
  assert.equal(AFTER.frRow.isCurrent, true);
  assert.equal(AFTER.frRow.currencyCode, 'EUR');
  const frOfficial = AFTER.frList.filter(p => p.isCurrent);
  assert.equal(frOfficial.length, 1, 'exactly one current official FR price');
  assert.equal(frOfficial[0].price, 52);
  assert.equal(frOfficial[0].source, APPROVED);
  assert.equal(frOfficial[0].code, CODE, 'Step 5 bridge: code rides on every price row');
});

test('E2E 8 — AFTER approve: TN official is byte-identical to before the whole FR operation', () => {
  const now = AFTER.tnOfficial;
  assert.equal(now.id, TN_OFFICIAL_BEFORE.id);
  assert.equal(now.unitPrice, TN_OFFICIAL_BEFORE.unitPrice);   // 30.000 — unchanged
  assert.equal(now.sourceCode, TN_OFFICIAL_BEFORE.sourceCode); // OFFICIAL_DEFAULT
  assert.equal(now.isCurrent, true);
  assert.equal(now.effectiveFrom, TN_OFFICIAL_BEFORE.effectiveFrom);
  assert.equal(now.updatedAt, TN_OFFICIAL_BEFORE.updatedAt);   // approve did not even touch it
  const tnOfficial = AFTER.tnList.filter(p => p.source === OFFICIAL && p.isCurrent);
  assert.equal(tnOfficial.length, 1);
  assert.equal(tnOfficial[0].price, 30);
  assert.ok(!AFTER.tnList.some(p => p.currency !== 'TND'), 'no EUR row ever leaks into TN list');
});

test('E2E 9 — market lists are mutually exclusive: FR list has no TN price, TN list has no FR price', () => {
  assert.equal(AFTER.frList.length, 1, 'FR list = exactly the approved FR row');
  assert.equal(AFTER.frList[0].market, 'fr');
  assert.equal(AFTER.frList[0].currency, 'EUR');
  assert.ok(!AFTER.tnList.some(p => p.countryCode !== 'TN'));
  assert.ok(!AFTER.frList.some(p => p.countryCode !== 'FR'));
  assert.ok(!AFTER.tnList.some(p => p.price === 52), 'FR price 52 is not in the TN list');
  assert.ok(!AFTER.frList.some(p => p.price === 30), 'TN price 30 is not in the FR list');
});

test('E2E 10 — AFTER approve: FR calculator picks the FR server price (52) via the SAME materials.code', () => {
  assert.equal(getPrice(AFTER.frRates, CODE), 52, 'same legacy id as TN — only the market differs');
});

test('E2E 11 — AFTER approve: TN calculator still picks the TN price (30) — FR changed nothing', () => {
  assert.equal(getPrice(AFTER.tnRates, CODE), 30);
});

test('E2E 12 — company-specific price is untouched in BOTH markets through the whole flow', () => {
  const c = AFTER.company;
  assert.equal(c.unitPrice, COMPANY_BEFORE.unitPrice);   // 99.000
  assert.equal(c.isCurrent, COMPANY_BEFORE.isCurrent);   // true
  assert.equal(c.sourceCode, COMPANY_BEFORE.sourceCode); // CUSTOM
  assert.equal(c.companyId, COMPANY_BEFORE.companyId);   // 'company-abc'
  assert.equal(c.updatedAt, COMPANY_BEFORE.updatedAt);   // approve/submit never wrote to it
  // Honest note (pre-existing documented gap, NOT part of this flow): the real
  // listPrices does not filter companyId yet, so the company row appears in the
  // public list. What MUST hold — and does — is that the FR/TN flow never
  // modified it and the Calculator never SELECTS it for TN (official row is
  // newer → buildPriceMap tiebreak picks 30, never the company 99):
  assert.notEqual(getPrice(AFTER.tnRates, CODE), 99);
  assert.equal(getPrice(AFTER.tnRates, CODE), 30);
  assert.equal(rows.filter(r => r.companyId !== null && r.countryCode === 'FR').length, 0,
    'the FR pipeline wrote zero company rows');
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n📋 Multi-Market E2E: ${passed} passed, ${failed} failed\n`);
if (failures.length) process.exit(1);
console.log('END-TO-END VERIFIED: Supplier CSV FR/EUR → materials.code → Pending → Approve →');
console.log('Official FR/EUR → GET /prices?market=fr → rates → Calculator — while TN/TND and');
console.log('company-specific prices stay byte-identical.\n');



