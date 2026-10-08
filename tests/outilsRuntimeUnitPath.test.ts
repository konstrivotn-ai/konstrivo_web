/**
 * OUTILS RUNTIME UNIT REGRESSION — the exact chain the screen uses:
 *   /api/v1/prices → App.tsx → buildPriceMapWithTrade → mergeRates → rates
 *                  → CalculatorTab → calculateGeneric
 *
 * WHY THIS SUITE EXISTS (traced on the live localhost, not synthetic):
 *   The reported Outils screen showed «1 unit» for `Profilé aluminium` (CSV `m`),
 *   `Rail aluminium` (m), `Montant aluminium` (m), `Visserie` (Set),
 *   `Silicone` (Litre), `Mastic` (Kg) while `Baie vitrée` (m²) was correct.
 *   Root cause: the MATERIAL ROWS themselves had lost the unit upstream
 *   (`materials.base_unit` held the import placeholder `unit` for exactly those
 *   file units, `m²` survived) — so `/prices` honestly returned `unit`.
 *   This suite locks the CLIENT half of the chain so that, whatever `/prices`
 *   reports, the rate that reaches `calculateGeneric()` carries that real unit,
 *   for the REAL runtime identity (`AL001` in the API ↔ `al001` in the local
 *   cache, and the hyphenated `ALU-001` ↔ `alu_001` spelling the CSV importer
 *   slugifies), and the quantity follows the documented per-unit rule.
 *
 * Run: npx tsx tests/outilsRuntimeUnitPath.test.ts
 */
import { strict as assert } from 'node:assert';
import { buildPriceMapWithTrade, mergeRates } from '../src/utils/priceLookup';
import { calculateGeneric, GenericInput } from '../src/utils/calculations';
import type { MaterialRate } from '../src/types';

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

console.log('\nOutils runtime unit path — /prices → rates → calculateGeneric (DB-free)\n');

const AREA = 20;          // m²  (matches the reported «22 m²» = 20 × 1.1)
const LENGTH = 10;        // m
const WASTE = 10;         // %
const TRADE = 'aluminium';
const CATEGORY = 'Menuiserie Aluminium';

/** The real catalog rows (code ↔ local-cache id) with their FILE units. */
const CASES: Array<{ code: string; cacheId: string; fileUnit: string; canonical: MaterialRate['unit']; qty: number; nameFr: string }> = [
  { code: 'AL001', cacheId: 'al001', fileUnit: 'm',     canonical: 'm',     qty: 11, nameFr: 'Profilé aluminium' },
  { code: 'ALU-001', cacheId: 'alu_001', fileUnit: 'm', canonical: 'm',     qty: 11, nameFr: 'Profilé aluminium' },
  { code: 'AL007', cacheId: 'al007', fileUnit: 'm',     canonical: 'm',     qty: 11, nameFr: 'Rail aluminium' },
  { code: 'AL008', cacheId: 'al008', fileUnit: 'm',     canonical: 'm',     qty: 11, nameFr: 'Montant aluminium' },
  { code: 'AL021', cacheId: 'al021', fileUnit: 'Set',   canonical: 'set',   qty: 1,  nameFr: 'Visserie' },
  { code: 'AL022', cacheId: 'al022', fileUnit: 'Litre', canonical: 'litre', qty: 1,  nameFr: 'Silicone' },
  { code: 'AL023', cacheId: 'al023', fileUnit: 'Kg',    canonical: 'kg',    qty: 11, nameFr: 'Mastic' },   // 20 × 0.5 × 1.1
  { code: 'AL004', cacheId: 'al004', fileUnit: 'm²',    canonical: 'm²',    qty: 22, nameFr: 'Baie vitrée aluminium' },
  { code: 'AL005', cacheId: 'al005', fileUnit: 'Unit',  canonical: 'unit',  qty: 1,  nameFr: 'Coulissant aluminium' },
];

/** The `unit` App.tsx sends to buildPriceMapWithTrade comes from this field. */
function apiRow(c: { code: string; fileUnit: string; nameFr: string }, unitKey: 'unit' | 'baseUnit' = 'unit') {
  return {
    materialId: `uuid-${c.code}`,
    code: c.code,
    price: 25,
    currency: 'TND',
    market: 'tn',
    isCurrent: true,
    trade: TRADE,
    category: CATEGORY,
    nameFr: c.nameFr,
    reviewStatus: 'published',
    [unitKey]: c.fileUnit,
  } as any;
}

/** The stale local cache entry (imported before the unit fix → 'unit'). */
function cachedRate(c: { cacheId: string; nameFr: string }, unit: string, price = 1): MaterialRate {
  return {
    id: c.cacheId, category: CATEGORY, trade: TRADE, nameFr: c.nameFr,
    nameAr: '', nameEn: null, unit: unit as MaterialRate['unit'],
    unitPriceTnd: price, defaultPriceTnd: price,
  };
}

function inputFor(): GenericInput {
  return {
    trade: TRADE, areaM2: AREA, lengthM: LENGTH, wasteMarginPercent: WASTE,
    laborRatePerM2: 30, tvaPercent: 19, includeTimbre: true, retenueGarantiePercent: 5,
  };
}


// ── 1) The REAL runtime identity: the API unit reaches the merged rate ───────
test('runtime: /prices unit lands on the cached rate for AL001 ↔ al001 (and ALU-001 ↔ alu_001)', () => {
  for (const c of CASES) {
    const merged = mergeRates(
      [cachedRate(c, 'unit', 1)],                       // stale cache (= the reported «1 unit»)
      buildPriceMapWithTrade([apiRow(c)])
    );
    assert.equal(merged.length, 1, `${c.code}: the cached line is updated, never duplicated`);
    assert.equal(merged[0].id, c.cacheId, `${c.code}: the cached rate id is preserved`);
    assert.equal(merged[0].unit, c.canonical, `${c.code}: unit '${c.fileUnit}' must reach the rate`);
    assert.equal(merged[0].unitPriceTnd, 25, `${c.code}: server price applied`);
  }
});

// ── 2) calculateGeneric receives the REAL unit (the Outils screen) ───────────
test('runtime: calculateGeneric prices every reported material with its real unit (never «1 unit»)', () => {
  const merged = mergeRates(
    CASES.map((c) => cachedRate(c, 'unit', 1)),
    buildPriceMapWithTrade(CASES.map((c) => apiRow(c)))
  );
  const items = calculateGeneric(inputFor(), merged).materialItems;
  for (const c of CASES) {
    const item = items.find((i) => i.id === c.cacheId);
    assert.ok(item, `${c.code}: material resolved by the aluminium calculator`);
    assert.equal(item!.unit, c.canonical, `${c.code}: displayed unit`);
    assert.equal(item!.qty, c.qty, `${c.code}: documented quantity for '${c.canonical}'`);
  }
  // The reported regression, verbatim: m-priced profiles are linear metres, not 1 piece.
  const profile = items.find((i) => i.id === 'al001')!;
  assert.equal(profile.unit, 'm');
  assert.equal(profile.qty, Math.round(LENGTH * (1 + WASTE / 100) * 100) / 100);
  assert.equal(profile.totalTnd, Math.round(profile.qty * 25 * 100) / 100);
  // …and the one material that was already correct keeps its area rule.
  const baie = items.find((i) => i.id === 'al004')!;
  assert.equal(baie.unit, 'm²');
  assert.equal(baie.qty, Math.round(AREA * (1 + WASTE / 100) * 100) / 100);
});

// ── 3) Priority: server/API unit ALWAYS wins over the cached unit ────────────
test('priority: a server unit overrides a DIFFERENT cached unit (server is the source of truth)', () => {
  const merged = mergeRates(
    [cachedRate(CASES[0], 'm²', 1)],                    // stale cache says m²
    buildPriceMapWithTrade([apiRow(CASES[0])])          // API says m
  );
  assert.equal(merged[0].unit, 'm', 'server unit wins over the cached unit');
});

// ── 4) A missing API unit must NEVER rewrite a real existing unit ────────────
test('missing API unit: normalizeRateUnit(undefined) never rewrites a real unit', () => {
  const rowWithoutUnit = apiRow(CASES[0]);
  delete (rowWithoutUnit as any).unit;
  const merged = mergeRates([cachedRate(CASES[0], 'm', 1)], buildPriceMapWithTrade([rowWithoutUnit]));
  assert.equal(merged[0].unit, 'm', 'the cached real unit is kept — never replaced by the neutral default');
});

// ── 5) A row that only carries baseUnit (raw materials.base_unit) works too ──
test('runtime: a row carrying baseUnit instead of unit is handled identically', () => {
  for (const c of CASES) {
    const map = buildPriceMapWithTrade([apiRow(c, 'baseUnit')]);
    const merged = mergeRates([cachedRate(c, 'unit', 1)], map);
    assert.equal(merged[0].unit, c.canonical, `${c.code}: baseUnit is honoured`);
  }
});

// ── 6) Server-only material (no cached line) keeps its real unit ─────────────
test('runtime: a server-only material is appended with its REAL unit (never «unit»)', () => {
  for (const c of CASES) {
    const merged = mergeRates([], buildPriceMapWithTrade([apiRow(c)]));
    assert.equal(merged.length, 1, `${c.code}: one appended line`);
    assert.equal(merged[0].id, c.code, `${c.code}: appended under the API code`);
    assert.equal(merged[0].unit, c.canonical, `${c.code}: real unit on the appended rate`);
  }
});

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`\nOutils runtime unit path: ${passed} PASS / ${failed} FAIL`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
