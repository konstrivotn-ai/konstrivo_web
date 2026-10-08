/**
 * SAFE FIX regression - Dynamic Trade -> Outils (DB-free).
 * Run: npx tsx tests/dynamicTradeNeutralQty.test.ts
 */
import { strict as assert } from 'node:assert';
import { calculateGeneric, GenericInput } from '../src/utils/calculations';
import { buildPriceMapWithTrade, mergeRates } from '../src/utils/priceLookup';
import { formatCalculationForWhatsApp } from '../src/utils/whatsapp';
import { auditCalculationResult, generateAuditPdfHtml } from '../src/utils/auditEngine';
import { toServerDevisPayload } from '../src/utils/devisFields';
import { convertFromTnd } from '../src/data/countryConfig';
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

console.log('\nDynamic Trade neutral-qty regression (DB-free)\n');

const AREA = 40;
const LENGTH = 25;
const WASTE_FACTOR = 1.1;

function ratesFor(units: Array<{ id: string; unit: string; price: number }>): MaterialRate[] {
  return units.map((u) => ({
    id: u.id,
    category: 'outillage_test',
    trade: 'outillage_test',
    nameFr: `Mat ${u.id}`,
    nameAr: '',
    unit: u.unit as MaterialRate['unit'],
    unitPriceTnd: u.price,
    defaultPriceTnd: u.price,
  }));
}

function inputFor(): GenericInput {
  return {
    trade: 'outillage_test',
    areaM2: AREA,
    lengthM: LENGTH,
    wasteMarginPercent: 10,
    laborRatePerM2: 30,
    tvaPercent: 19,
    includeTimbre: true,
    retenueGarantiePercent: 5,
  };
}

test('unit (equipment) uses neutral qty=1, never ceil(Area/3)', () => {
  const result = calculateGeneric(inputFor(), ratesFor([{ id: 'eq_unit', unit: 'unit', price: 2450 }]));
  assert.equal(result.materialItems.length, 1);
  const item = result.materialItems[0];
  assert.equal(item.qty, 1);
  assert.equal(item.totalTnd, 2450);
  const buggyQty = Math.max(1, Math.ceil((AREA / 3) * WASTE_FACTOR));
  assert.notEqual(item.qty, buggyQty);
  assert.ok(!item.formulaUsed!.includes('/ 3'));
});

test('panneau keeps ceil(Area/3) x waste', () => {
  const result = calculateGeneric(inputFor(), ratesFor([{ id: 'board', unit: 'panneau', price: 100 }]));
  const expected = Math.max(1, Math.ceil((AREA / 3) * WASTE_FACTOR));
  assert.equal(result.materialItems[0].qty, expected);
  assert.equal(result.materialItems[0].totalTnd, expected * 100);
});

test('m2/ml/kg/sac/boite/rouleau/point formulas unchanged', () => {
  const cases: Array<{ unit: string; expected: number }> = [
    { unit: 'm²', expected: Math.round(AREA * WASTE_FACTOR * 100) / 100 },
    { unit: 'ml', expected: Math.round(LENGTH * WASTE_FACTOR * 100) / 100 },
    { unit: 'kg', expected: Math.round(AREA * 0.5 * WASTE_FACTOR * 100) / 100 },
    { unit: 'sac', expected: Math.max(1, Math.ceil(((AREA / 10) * WASTE_FACTOR))) },
    { unit: 'boite', expected: Math.max(1, Math.ceil(((AREA / 15) * WASTE_FACTOR))) },
    { unit: 'rouleau', expected: Math.max(1, Math.ceil(((AREA / 12) * WASTE_FACTOR))) },
    { unit: 'point', expected: Math.max(1, Math.ceil(AREA / 4)) },
  ];
  for (const c of cases) {
    const r = calculateGeneric(inputFor(), ratesFor([{ id: `id_${c.unit}`, unit: c.unit, price: 10 }]));
    assert.equal(r.materialItems[0].qty, c.expected, `${c.unit} qty`);
    assert.equal(r.materialItems[0].totalTnd, Math.round(c.expected * 10 * 100) / 100, `${c.unit} total`);
  }
});

// __PART2__
test('boite_1000/tube/m3/metre keep legacy area x waste fallback', () => {
  const expected = Math.round(AREA * WASTE_FACTOR * 100) / 100;
  for (const u of ['boite_1000', 'tube', 'm³', 'mètre']) {
    const r = calculateGeneric(inputFor(), ratesFor([{ id: `id_${u}`, unit: u, price: 5 }]));
    assert.equal(r.materialItems[0].qty, expected, `${u} fallback qty`);
  }
});

test('unknown unit string uses neutral qty=1', () => {
  const r = calculateGeneric(inputFor(), ratesFor([{ id: 'weird', unit: 'piece', price: 77 }]));
  assert.equal(r.materialItems[0].qty, 1);
  assert.equal(r.materialItems[0].totalTnd, 77);
});

test('server unknown unit merges to unit + neutral qty; panneau preserved', () => {
  const map = buildPriceMapWithTrade(
    [
      { code: 'eq_unknown_u', price: 500, currency: 'TND', market: 'tn', isCurrent: true, trade: 'outillage_test', category: 'Outillage', unit: 'piece', nameFr: 'Equipement piece' },
      { code: 'board_pan', price: 100, currency: 'TND', market: 'tn', isCurrent: true, trade: 'outillage_test', category: 'Outillage', unit: 'panneau', nameFr: 'Panneau test' },
    ],
    'TND'
  );
  const merged = mergeRates([], map);
  const eq = merged.find((r) => r.id === 'eq_unknown_u')!;
  const board = merged.find((r) => r.id === 'board_pan')!;
  assert.equal(eq.unit, 'unit');
  assert.equal(board.unit, 'panneau');
  const result = calculateGeneric(inputFor(), merged);
  const eqItem = result.materialItems.find((i) => i.id === 'eq_unknown_u')!;
  const boardItem = result.materialItems.find((i) => i.id === 'board_pan')!;
  assert.equal(eqItem.qty, 1);
  assert.equal(eqItem.totalTnd, 500);
  assert.equal(boardItem.qty, Math.max(1, Math.ceil((AREA / 3) * WASTE_FACTOR)));
});

test('totals = sum(qty x unitPrice)', () => {
  const result = calculateGeneric(
    inputFor(),
    ratesFor([
      { id: 'eq', unit: 'unit', price: 2450 },
      { id: 'surf', unit: 'm²', price: 28 },
      { id: 'board', unit: 'panneau', price: 100 },
    ])
  );
  let expected = 0;
  for (const it of result.materialItems) {
    assert.equal(it.totalTnd, Math.round(it.qty * it.unitPriceTnd * 100) / 100, `${it.id} total`);
    expected += it.totalTnd;
  }
  assert.equal(result.totalMaterialTnd, expected);
});

test('labor and TVA/timbre/retenue via current fiscal pipeline', () => {
  const result = calculateGeneric(
    { trade: 'outillage_test', areaM2: 10, wasteMarginPercent: 0, laborRatePerM2: 10, tvaPercent: 19, includeTimbre: true, retenueGarantiePercent: 5 },
    ratesFor([{ id: 'eq', unit: 'unit', price: 100 }])
  );
  assert.equal(result.totalMaterialTnd, 100);
  assert.equal(result.estimatedLaborTnd, 100);
  assert.equal(result.grandTotalTnd, 200);
  assert.equal(result.tvaAmountTnd, 38);
  assert.equal(result.timbreFiscalTnd, 1.0);
  assert.equal(result.retenueGarantieTnd, 10);
  assert.equal(result.totalTtcTnd, 239);
  assert.equal(result.netAPayerTnd, 229);
});

// __PART3__
test('CalculationResult flows to devis/WhatsApp/audit/currency (no API change)', () => {
  const result = calculateGeneric(inputFor(), ratesFor([{ id: 'eq', unit: 'unit', price: 2450 }]));
  const waFr = formatCalculationForWhatsApp(result, 'fr');
  const waAr = formatCalculationForWhatsApp(result, 'ar');
  assert.ok(waFr.length > 0 && waAr.length > 0);
  assert.ok(waFr.includes('2450'));
  const audit = auditCalculationResult(result, 'TN');
  assert.ok(Array.isArray(audit.checks) && audit.checks.length > 0);
  const html = generateAuditPdfHtml(result, audit);
  assert.ok(html.length > 0);
  const converted = convertFromTnd(result.totalMaterialTnd, 'EUR');
  assert.ok(typeof converted === 'number' && converted >= 0);
  const devis: any = {
    id: 'dev-test',
    reference: 'DEV-2026-0001',
    date: '2026-09-21',
    status: 'brouillon',
    clientName: 'Client Test',
    items: result.materialItems.map((m) => ({
      id: m.id, title: m.nameFr, quantity: m.qty, unit: m.unit, unitPrice: m.unitPriceTnd, total: m.totalTnd,
    })),
    subtotalMaterials: result.totalMaterialTnd,
    subtotalLabor: result.estimatedLaborTnd,
    discount: 0,
    netHt: result.grandTotalTnd,
    tvaPercent: result.tvaPercent,
    tvaAmount: result.tvaAmountTnd,
    timbreAmount: result.timbreFiscalTnd,
    totalTtc: result.totalTtcTnd,
    retenueAmount: result.retenueGarantieTnd,
    netAPayer: result.netAPayerTnd,
  };
  const payload = toServerDevisPayload(devis) as Record<string, unknown>;
  assert.ok(payload && typeof payload === 'object');
});

console.log(`\nDynamicTrade NeutralQty Result: ${passed} PASS / ${failed} FAIL`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
