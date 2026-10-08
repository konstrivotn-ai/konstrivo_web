/**
 * UNIT FIDELITY — CSV import → material.unit → priceLookup → calculateGeneric → Outils.
 *
 * DB-free regression for the confirmed bug: a CSV catalog using the real units
 * `m / m² / Unit / Kg / Litre / Set` had `m`, `Kg`, `Litre`, `Set` collapsed to
 * `unit` inside `mergeRates()` (and `mapImportedUnit()`), so Outils displayed
 * "1 unit" and multiplied the price by 1 for every one of those materials.
 *
 * Covered here:
 *   1. `normalizeRateUnit()` preserves each real unit (case/accent insensitive).
 *   2. The full server path: price row (what `/prices` returns for a CSV import)
 *      → buildPriceMapWithTrade → mergeRates → rate.unit is NOT lost.
 *   3. calculateGeneric prices each unit with its own documented rule.
 *   4. The client CSV cache path (`mapImportedUnit`) agrees 1:1 with the server
 *      path (single source of truth — no divergent alias table).
 *   5. Unknown units keep the documented neutral behaviour (qty 1, unit='unit').
 *   6. The official calculator units are untouched (same formulas as before).
 *
 * Run: npx tsx tests/outilsUnitPreservation.test.ts
 */
import { strict as assert } from 'node:assert';
import { normalizeRateUnit, buildPriceMapWithTrade, mergeRates } from '../src/utils/priceLookup';
import { calculateGeneric, GenericInput } from '../src/utils/calculations';
import { mapImportedUnit, applyParsedCatalog } from '../src/components/CatalogUploadModal';
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

console.log('\nOutils unit fidelity — CSV import → calculateGeneric (DB-free)\n');

const AREA = 40;
const LENGTH = 25;
const WASTE_FACTOR = 1.1; // wasteMarginPercent = 10
const TRADE = 'dynamique_test';

/** The six units of the reported CSV, in their ORIGINAL CSV spelling. */
const CSV_UNITS: Array<{ csv: string; expected: MaterialRate['unit'] }> = [
  { csv: 'm', expected: 'm' },
  { csv: 'm²', expected: 'm²' },
  { csv: 'Unit', expected: 'unit' },
  { csv: 'Kg', expected: 'kg' },
  { csv: 'Litre', expected: 'litre' },
  { csv: 'Set', expected: 'set' },
];

function inputFor(): GenericInput {
  return {
    trade: TRADE,
    areaM2: AREA,
    lengthM: LENGTH,
    wasteMarginPercent: 10,
    laborRatePerM2: 30,
    tvaPercent: 19,
    includeTimbre: true,
    retenueGarantiePercent: 5,
  };
}

/** Exact shape of a `/prices` row produced by listPrices (materials JOIN). */
function priceRow(code: string, csvUnit: string, price: number, useBaseUnitOnly = false) {
  const base: any = {
    materialId: `uuid-${code}`,
    code,
    price,
    currency: 'TND',
    market: 'tn',
    isCurrent: true,
    trade: TRADE,
    category: 'Dynamique test',
    nameFr: `Matériau ${code}`,
    reviewStatus: 'published',
  };
  return useBaseUnitOnly ? { ...base, baseUnit: csvUnit } : { ...base, unit: csvUnit };
}

function rate(id: string, unit: string, price: number): MaterialRate {
  return {
    id,
    category: TRADE,
    trade: TRADE,
    nameFr: 'M',
    nameAr: '',
    unit: unit as MaterialRate['unit'],
    unitPriceTnd: price,
    defaultPriceTnd: price,
  };
}

// ── 1) normalizeRateUnit preserves the real CSV units ────────────────────────
test('normalizeRateUnit preserves m / m² / Unit / Kg / Litre / Set', () => {
  for (const { csv, expected } of CSV_UNITS) {
    assert.equal(normalizeRateUnit(csv), expected, `${csv} must stay ${expected}`);
  }
});

test('normalizeRateUnit is case / accent / separator insensitive (no unit loss)', () => {
  assert.equal(normalizeRateUnit('  M  '), 'm');
  assert.equal(normalizeRateUnit('M²'), 'm²');
  assert.equal(normalizeRateUnit('m2'), 'm²');
  assert.equal(normalizeRateUnit('KG'), 'kg');
  assert.equal(normalizeRateUnit('LITRE'), 'litre');
  assert.equal(normalizeRateUnit('liter'), 'litre');
  assert.equal(normalizeRateUnit('L'), 'litre');
  assert.equal(normalizeRateUnit('SETS'), 'set');
  assert.equal(normalizeRateUnit('Kit'), 'set');
  assert.equal(normalizeRateUnit('metre'), 'mètre');
  assert.equal(normalizeRateUnit('ML'), 'ml');
  assert.equal(normalizeRateUnit('ROULEAU'), 'rouleau');
  assert.equal(normalizeRateUnit('boite de 1000'), 'boite_1000');
});

test('normalizeRateUnit: only a genuinely unknown unit falls back to the safe default', () => {
  assert.equal(normalizeRateUnit('unité inconnue xyz'), 'unit');
  assert.equal(normalizeRateUnit(''), 'unit');
  assert.equal(normalizeRateUnit(null), 'unit');
  assert.equal(normalizeRateUnit(undefined), 'unit');
});

// ── 2) Server path: price row → mergeRates keeps the unit ────────────────────
test('mergeRates: units are NOT collapsed to "unit" for the reported CSV', () => {
  const rows = CSV_UNITS.map(({ csv }, i) => priceRow(`mat_${i}`, csv, 10 + i));
  const merged = mergeRates([], buildPriceMapWithTrade(rows));
  assert.equal(merged.length, CSV_UNITS.length);
  CSV_UNITS.forEach(({ csv, expected }, i) => {
    const found = merged.find((r) => r.id === `mat_${i}`)!;
    assert.ok(found, `mat_${i} (${csv}) must exist`);
    assert.equal(found.unit, expected, `CSV "${csv}" must reach Outils as "${expected}"`);
  });
});

test('mergeRates: a row carrying only baseUnit (raw materials.base_unit) keeps its unit too', () => {
  const merged = mergeRates([], buildPriceMapWithTrade([priceRow('mat_raw_litre', 'Litre', 65, true)]));
  assert.equal(merged[0].unit, 'litre');
});

test('mergeRates: a cached rate is enriched with the REAL imported unit (never downgraded to "unit")', () => {
  const prev: MaterialRate[] = [rate('mat_kg_cached', 'm²', 1)];
  const merged = mergeRates(prev, buildPriceMapWithTrade([priceRow('mat_kg_cached', 'Kg', 42)]));
  assert.equal(merged[0].unit, 'kg', 'cached unit replaced by the REAL imported unit');
  assert.equal(merged[0].unitPriceTnd, 42);
});

// ── 3) calculateGeneric prices each unit with its own documented rule ────────
const EXPECTED: Array<{ csv: string; unit: MaterialRate['unit']; qty: number }> = [
  { csv: 'm', unit: 'm', qty: Math.round(LENGTH * WASTE_FACTOR * 100) / 100 },
  { csv: 'm²', unit: 'm²', qty: Math.round(AREA * WASTE_FACTOR * 100) / 100 },
  { csv: 'Unit', unit: 'unit', qty: 1 },
  { csv: 'Kg', unit: 'kg', qty: Math.round(AREA * 0.5 * WASTE_FACTOR * 100) / 100 },
  { csv: 'Litre', unit: 'litre', qty: 1 },
  { csv: 'Set', unit: 'set', qty: 1 },
];

test('calculateGeneric: qty + unit + total per real unit (no more "1 unit" for m / kg / litre / set)', () => {
  for (const { csv, unit, qty } of EXPECTED) {
    const price = 20;
    const rates = mergeRates([], buildPriceMapWithTrade([priceRow(`only_${unit}`, csv, price)]));
    const result = calculateGeneric(inputFor(), rates);
    assert.equal(result.materialItems.length, 1, `${csv}: exactly one material line`);
    const item = result.materialItems[0];
    assert.equal(item.unit, unit, `${csv}: unit shown in Outils`);
    assert.equal(item.qty, qty, `${csv}: quantity`);
    assert.equal(item.totalTnd, Math.round(qty * price * 100) / 100, `${csv}: total = qty × P.U`);
  }
});

test('calculateGeneric: no reported material is left with the equipment "1 unit" label by mistake', () => {
  for (const { csv } of CSV_UNITS) {
    const rates = mergeRates([], buildPriceMapWithTrade([priceRow(`guard_${csv}`, csv, 10)]));
    const item = calculateGeneric(inputFor(), rates).materialItems[0];
    if (csv === 'Unit') {
      assert.equal(item.unit, 'unit', 'Unit really is the unit');
      continue;
    }
    assert.notEqual(item.unit, 'unit', `CSV "${csv}" must not be reported as 'unit'`);
  }
});

// ── 4) Local CSV cache path = server path (one shared normalizer) ────────────
test('mapImportedUnit (client CSV cache) agrees 1:1 with the server path', () => {
  for (const { csv, expected } of CSV_UNITS) {
    assert.equal(mapImportedUnit(csv), expected, `mapImportedUnit('${csv}')`);
    assert.equal(mapImportedUnit(csv), normalizeRateUnit(csv), `same source of truth for '${csv}'`);
  }
});

// ── 5) Documented behaviour that must NOT change ─────────────────────────────
test('unknown units keep the neutral behaviour (unit + qty 1)', () => {
  const result = calculateGeneric(inputFor(), [
    { ...rate('weird', 'unit', 77), unit: 'piece' as MaterialRate['unit'] },
  ]);
  assert.equal(result.materialItems[0].qty, 1);
  assert.equal(result.materialItems[0].totalTnd, 77);
});

test('official calculator units keep their exact formulas', () => {
  const cases: Array<{ unit: string; expected: number }> = [
    { unit: 'm²', expected: Math.round(AREA * WASTE_FACTOR * 100) / 100 },
    { unit: 'ml', expected: Math.round(LENGTH * WASTE_FACTOR * 100) / 100 },
    { unit: 'kg', expected: Math.round(AREA * 0.5 * WASTE_FACTOR * 100) / 100 },
    { unit: 'sac', expected: Math.max(1, Math.ceil(((AREA / 10) * WASTE_FACTOR))) },
    { unit: 'boite', expected: Math.max(1, Math.ceil(((AREA / 15) * WASTE_FACTOR))) },
    { unit: 'rouleau', expected: Math.max(1, Math.ceil(((AREA / 12) * WASTE_FACTOR))) },
    { unit: 'point', expected: Math.max(1, Math.ceil(AREA / 4)) },
    { unit: 'panneau', expected: Math.max(1, Math.ceil(((AREA / 3) * WASTE_FACTOR))) },
    { unit: 'boite_1000', expected: Math.round(AREA * WASTE_FACTOR * 100) / 100 },
    { unit: 'tube', expected: Math.round(AREA * WASTE_FACTOR * 100) / 100 },
    { unit: 'm³', expected: Math.round(AREA * WASTE_FACTOR * 100) / 100 },
    { unit: 'mètre', expected: Math.round(AREA * WASTE_FACTOR * 100) / 100 },
    { unit: 'unit', expected: 1 },
  ];
  for (const c of cases) {
    const item = calculateGeneric(inputFor(), [rate(`u_${c.unit}`, c.unit, 10)]).materialItems[0];
    assert.equal(item.qty, c.expected, `${c.unit} formula unchanged`);
  }
});

// ── 6) REAL-PATH IDENTITY: cached slug id ↔ server verbatim `materials.code` ─
// The reported production case: the CSV import stores `materials.code` VERBATIM
// (`ALU-001`, `profil-aluminium-3m`) while the calculator/cache id is the slug
// (`alu_001`, `profil_aluminium_3m`). Before the fix `priceMap.has(r.id)` never
// matched, so the cached rate kept `unit: 'unit'` for ever AND the server row
// was listed a second time. These tests lock the repair in.

function cachedRate(id: string, unit: string, price: number, nameFr = 'Profilé aluminium 3m'): MaterialRate {
  return {
    id,
    category: TRADE,
    trade: TRADE,
    nameFr,
    nameAr: '',
    unit: unit as MaterialRate['unit'],
    unitPriceTnd: price,
    defaultPriceTnd: price,
  };
}

test('ALU-001 (DB) ↔ alu_001 (cache): unit repaired, price updated, ONE line only', () => {
  const merged = mergeRates(
    [cachedRate('alu_001', 'unit', 1)],
    buildPriceMapWithTrade([priceRow('ALU-001', 'm', 12.5)])
  );
  assert.equal(merged.length, 1, 'the same material must not be listed twice');
  assert.equal(merged[0].id, 'alu_001', 'cached id preserved (no cache rewrite)');
  assert.equal(merged[0].unit, 'm', 'the real CSV unit reaches the calculator');
  assert.equal(merged[0].unitPriceTnd, 12.5, 'server price still wins');
});

test('hyphenated code ↔ underscored cache id: same link (m / Kg / Litre / Set)', () => {
  const cases: Array<{ cacheId: string; code: string; csvUnit: string; expected: MaterialRate['unit'] }> = [
    { cacheId: 'profil_aluminium_3m', code: 'profil-aluminium-3m', csvUnit: 'm', expected: 'm' },
    { cacheId: 'enduit_alu_kg', code: 'enduit-alu-kg', csvUnit: 'Kg', expected: 'kg' },
    { cacheId: 'peinture_alu_l', code: 'peinture-alu-l', csvUnit: 'Litre', expected: 'litre' },
    { cacheId: 'kit_alu_set', code: 'kit-alu-set', csvUnit: 'Set', expected: 'set' },
  ];
  for (const c of cases) {
    const merged = mergeRates(
      [cachedRate(c.cacheId, 'unit', 1)],
      buildPriceMapWithTrade([priceRow(c.code, c.csvUnit, 30)])
    );
    assert.equal(merged.length, 1, `${c.code}: one line`);
    assert.equal(merged[0].unit, c.expected, `${c.code}: unit repaired to ${c.expected}`);
    assert.equal(merged[0].unitPriceTnd, 30);
  }
});

test('repaired cache rate prices correctly in Outils (m → Length × waste, litre → 1 litre)', () => {
  const merged = mergeRates(
    [cachedRate('alu_001', 'unit', 1), cachedRate('peinture_alu_l', 'unit', 1, 'Peinture')],
    buildPriceMapWithTrade([
      priceRow('ALU-001', 'm', 12.5),
      priceRow('peinture-alu-l', 'Litre', 65),
    ])
  );
  const items = calculateGeneric(inputFor(), merged).materialItems;
  const profile = items.find((i) => i.id === 'alu_001')!;
  assert.equal(profile.unit, 'm');
  assert.equal(profile.qty, Math.round(LENGTH * WASTE_FACTOR * 100) / 100);
  assert.equal(profile.totalTnd, Math.round(profile.qty * 12.5 * 100) / 100);
  const paint = items.find((i) => i.id === 'peinture_alu_l')!;
  assert.equal(paint.unit, 'litre', 'never the equipment "unit" label');
  assert.equal(paint.qty, 1);
});

test('re-importing the CSV repairs the unit of an existing rate (price-only update removed)', () => {
  const items = [
    { nameFr: 'Profilé aluminium 3m', materialCode: 'ALU-001', category: TRADE, trade: TRADE, unit: 'm', newPriceTnd: 12.5, tvaRate: 19, currency: 'TND' },
  ];
  const { updatedRates, updatedCount, addedCount } = applyParsedCatalog([cachedRate('alu_001', 'unit', 9)], items, {
    supplierName: 'Test',
    importedOn: new Date('2026-09-22'),
  });
  assert.equal(updatedCount, 1);
  assert.equal(addedCount, 0, 'no duplicate created');
  assert.equal(updatedRates.length, 1);
  assert.equal(updatedRates[0].unit, 'm', 'unit restored on re-import');
  assert.equal(updatedRates[0].unitPriceTnd, 12.5);
});

test('re-import never overwrites the unit with the default when the file has no unit', () => {
  const items = [
    { nameFr: 'Profilé aluminium 3m', materialCode: 'ALU-001', category: TRADE, trade: TRADE, unit: '', newPriceTnd: 15, tvaRate: 19, currency: 'TND' },
  ];
  const { updatedRates } = applyParsedCatalog([cachedRate('alu_001', 'm', 9)], items, {});
  assert.equal(updatedRates[0].unit, 'm', 'an empty unit cell keeps the stored unit');
  assert.equal(updatedRates[0].unitPriceTnd, 15);
});

test('identity bridge never merges two DIFFERENT materials', () => {
  const merged = mergeRates(
    [cachedRate('alu_001', 'm', 12.5)],
    buildPriceMapWithTrade([priceRow('ALU-002', 'm', 20)])
  );
  assert.equal(merged.length, 2, 'alu_001 kept + ALU-002 appended');
  assert.deepEqual(merged.map((r) => r.id).sort(), ['ALU-002', 'alu_001']);
  for (const r of merged) assert.equal(r.unit, 'm');
});


console.log(`\nOutils unit fidelity result: ${passed} PASS / ${failed} FAIL`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}


