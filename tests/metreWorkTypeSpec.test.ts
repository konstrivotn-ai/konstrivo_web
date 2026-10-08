/**
 * PHASE 1 — EXTENSIBLE MÉTRÉ CORE CONTRACT (DB-free, UI-free).
 *   npx tsx tests/metreWorkTypeSpec.test.ts
 *
 * PURPOSE — Audit → Build → Test evidence for Phase 1:
 *   1. CONTRACT: an element using NONE of the new fields evaluates exactly
 *      as before (same qty, unit, ok).
 *   2. SEMANTICS LOCK: `openings`, `deductions` and `coveragePerProductUnit`
 *      keep their current meaning (mirrors tests/metreEnrichedSpec.test.ts).
 *   3. NEW `MetreWorkTypeSpec`: purely DESCRIPTIVE — attaching it to an
 *      element NEVER changes the computed quantity, and it is validated by
 *      ONE fail-closed entry point (absent = valid ⇒ legacy shapes pass).
 *   4. ENGINE GENERICITY: the engine source contains no trade branch and
 *      never reads `workType`.
 *   5. PLACO REGRESSION (before/after gate): the Métré element
 *      `placo/panneau_ba13` keeps identity + result, AND the official
 *      `calculatePlaco` output stays byte-identical to the frozen golden
 *      record (tests/fixtures/formulas/golden.json).
 *
 * RULES honoured: no production/DB data (fixtures are inline or frozen golden
 * records), no CalculatorTab edits, no PLACO formula changes, no trade branch.
 */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MetreElementDef } from '../src/data/metreElements';
import {
  isValidMetreElementShape,
  isValidMetreWorkTypeSpec,
  mapMetreElementRow,
  elementsForTrade,
  getMetreElement,
} from '../src/data/metreElements';
import { evaluateElement } from '../src/utils/metreEngine';
import { calculatePlaco, PlacoInput } from '../src/utils/calculations';
import { DEFAULT_MARKET_RATES } from '../src/data/marketRates';

let passed = 0;
let failed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  PASS ${name}`); }
  catch (err: any) {
    failed++;
    const msg = `  FAIL ${name}\n       ${err?.message || err}`;
    failures.push(msg); console.log(msg);
  }
}

console.log('\nPHASE 1 - Extensible Metre core contract (workType descriptor + regressions)\n');

/** Base element: a plain 10 m2 wall. Enriched/workType blocks are added per test. */
function wall(spec: Partial<MetreElementDef> = {}): MetreElementDef {
  return {
    code: 'mur_test',
    trade: 'peinture',
    labelFr: 'Mur',
    labelAr: '',
    method: 'surface',
    dims: [
      { key: 'largeur', labelFr: 'Largeur', labelAr: '', unit: 'm' },
      { key: 'hauteur', labelFr: 'Hauteur', labelAr: '', unit: 'm' },
    ],
    calc: { op: 'product', dims: ['largeur', 'hauteur'] },
    qtyFormula: 'Largeur x Hauteur',
    unit: 'm²',
    ...spec,
  } as MetreElementDef;
}
const DIMS_5x2 = { largeur: 5, hauteur: 2 }; // 10 m2
// ─────────────────────────────────────────────────────────────────────────────
// 1. CONTRACT — an OLD element (no new fields) is byte-identical
// ─────────────────────────────────────────────────────────────────────────────

test('contract: legacy element without any new field is unchanged (10 m2)', () => {
  const r = evaluateElement(wall(), DIMS_5x2);
  assert.strictEqual(r.ok, true);
  assert.strictEqual((r as any).qty, 10);
  assert.strictEqual((r as any).unit, 'm²');
});

test('contract: legacy element declares NONE of the new keys', () => {
  const el = wall();
  for (const k of ['workType', 'openings', 'deductions', 'layers', 'wastePercent', 'coveragePerProductUnit']) {
    assert.ok(!(k in el), `legacy element must not carry "${k}"`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. SEMANTICS LOCK — openings / deductions / coverage keep current meaning
// ─────────────────────────────────────────────────────────────────────────────

test('openings: gross - declared opening area (10 - 1.68 = 8.32 m2)', () => {
  const el = wall({ openings: { enabled: true, items: [{ width: 1, height: 1.68 }] } });
  const r = evaluateElement(el, DIMS_5x2);
  assert.strictEqual(r.ok, true);
  assert.strictEqual((r as any).qty, 8.32);
  assert.strictEqual((r as any).unit, 'm²');
});

test('deductions: explicit amount deducted from the gross (10 - 2 = 8 m2)', () => {
  const el = wall({ deductions: { enabled: true, items: [{ amount: 2, unit: 'm²' }] } });
  const r = evaluateElement(el, DIMS_5x2);
  assert.strictEqual(r.ok, true);
  assert.strictEqual((r as any).qty, 8);
});

test('coveragePerProductUnit: 20 m2 / (1 L per 10 m2) = 2 L', () => {
  const el = wall({ coveragePerProductUnit: { value: 10, unit: 'L', basis: 'm²' } });
  const r = evaluateElement(el, { largeur: 5, hauteur: 4 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual((r as any).qty, 2);
  assert.strictEqual((r as any).unit, 'L');
});

test('chain order: gross - openings - deductions x layers / yield x waste', () => {
  // (10 - 1) - 2 = 7 -> x2 = 14 -> /10 = 1.4 L -> +10% = 1.54 L
  const el = wall({
    openings: { enabled: true, items: [{ areaM2: 1 }] },
    deductions: { enabled: true, items: [{ amount: 2, unit: 'm²' }] },
    layers: 2,
    coveragePerProductUnit: { value: 10, unit: 'L', basis: 'm²' },
    wastePercent: 10,
  });
  const r = evaluateElement(el, DIMS_5x2);
  assert.strictEqual(r.ok, true);
  assert.strictEqual((r as any).qty, 1.54);
  assert.strictEqual((r as any).unit, 'L');
});
// ─────────────────────────────────────────────────────────────────────────────
// 3. NEW `MetreWorkTypeSpec` — DESCRIPTIVE ONLY, never changes a quantity
// ─────────────────────────────────────────────────────────────────────────────

const WORK_TYPE: any = {
  code: 'cloison_peinture',
  labelFr: 'Cloison peinte',
  labelAr: 'جدار مطلي',
  measurementMethod: 'surface',
  methodology: 'Mesure surface nette L x l, puis déductions ouvertures',
  norms: ['NF EN 13300', 'DTU 59.1'],
  validationHints: ['Vérifier la planéité avant relevé'],
  durationHint: { value: 0.1, unit: 'h/m²' },
};

test('workType: validator accepts a full descriptor (absent also valid)', () => {
  assert.strictEqual(isValidMetreWorkTypeSpec(WORK_TYPE), true);
  assert.strictEqual(isValidMetreWorkTypeSpec(undefined), true);
  assert.strictEqual(isValidMetreWorkTypeSpec(null), true);
  assert.strictEqual(isValidMetreWorkTypeSpec({ code: 'x', labelFr: 'X', labelAr: '' }), true);
});

test('workType: validator refuses malformed descriptors (fail-closed)', () => {
  assert.strictEqual(isValidMetreWorkTypeSpec({}), false); // missing identity
  assert.strictEqual(isValidMetreWorkTypeSpec({ code: ' ', labelFr: 'X', labelAr: '' }), false);
  assert.strictEqual(isValidMetreWorkTypeSpec({ code: 'x', labelFr: '', labelAr: '' }), false);
  assert.strictEqual(isValidMetreWorkTypeSpec({ code: 'x', labelFr: 'X', labelAr: 42 }), false);
  assert.strictEqual(isValidMetreWorkTypeSpec({ code: 'x', labelFr: 'X', labelAr: '', measurementMethod: 'levage' }), false);
  assert.strictEqual(isValidMetreWorkTypeSpec({ code: 'x', labelFr: 'X', labelAr: '', norms: ['ok', ''] }), false);
  assert.strictEqual(isValidMetreWorkTypeSpec({ code: 'x', labelFr: 'X', labelAr: '', durationHint: { value: 0, unit: 'h' } }), false);
  assert.strictEqual(isValidMetreWorkTypeSpec({ code: 'x', labelFr: 'X', labelAr: '', durationHint: { value: 1, unit: '' } }), false);
});

test('workType: INERT — same element, same inputs, with vs without descriptor', () => {
  const without = evaluateElement(wall(), DIMS_5x2);
  const withDesc = evaluateElement(wall({ workType: WORK_TYPE } as any), DIMS_5x2);
  assert.deepStrictEqual(withDesc, without);
  assert.strictEqual((withDesc as any).qty, 10);
  // Also inert on an ENRICHED element (chain result identical).
  const enriched: Partial<MetreElementDef> = {
    openings: { enabled: true, items: [{ width: 1, height: 1.68 }] },
    layers: 2,
    wastePercent: 5,
  };
  const a = evaluateElement(wall(enriched), DIMS_5x2);
  const b = evaluateElement(wall({ ...enriched, workType: WORK_TYPE } as any), DIMS_5x2);
  assert.deepStrictEqual(b, a);
});

test('workType: shape validator — legacy shape passes, bad descriptor rejected', () => {
  const baseShape = {
    method: 'surface',
    dims: [{ key: 'a', labelFr: 'A', labelAr: '', unit: 'm' }],
    calc: { op: 'single', dim: 'a' },
    qtyUnit: 'm²',
  };
  assert.strictEqual(isValidMetreElementShape({ ...baseShape }), true); // unchanged
  assert.strictEqual(isValidMetreElementShape({ ...baseShape, workType: WORK_TYPE }), true);
  assert.strictEqual(isValidMetreElementShape({ ...baseShape, workType: { labelFr: 'no code' } }), false);
});

test('workType: mapMetreElementRow carries a valid descriptor, refuses an invalid one', () => {
  const row = {
    elementCode: 'x',
    method: 'surface',
    dims: [{ key: 'a', labelFr: 'A', labelAr: '', unit: 'm' }],
    calc: { op: 'single', dim: 'a' },
    qtyUnit: 'm²',
  };
  const plain = mapMetreElementRow(row, 'peinture');
  assert.ok(plain);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(plain!, 'workType'), false);

  const withDesc = mapMetreElementRow({ ...row, workType: WORK_TYPE }, 'peinture');
  assert.ok(withDesc);
  assert.deepStrictEqual((withDesc as any).workType, WORK_TYPE);

  assert.strictEqual(mapMetreElementRow({ ...row, workType: { code: 'x' } }, 'peinture'), null);
});
// ─────────────────────────────────────────────────────────────────────────────
// 4. ENGINE GENERICITY — no trade branch, no workType read in the engine
// ─────────────────────────────────────────────────────────────────────────────

test('engine: no trade-specific branch and workType never read by the engine', () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(HERE, '..', 'src', 'utils', 'metreEngine.ts'), 'utf8');
  assert.ok(!src.includes('workType'), 'engine must never read workType');
  assert.ok(!/trade\s*===/.test(src), 'engine must never branch on trade ===');
  assert.ok(!/switch\s*\(\s*trade/.test(src), 'engine must never switch on trade');
  assert.ok(!src.includes("'placo'") && !src.includes('"placo"') && !src.includes("'peinture'"),
    'engine must not name métiers');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. PLACO REGRESSION GATE (must PASS before Phase 2)
// ─────────────────────────────────────────────────────────────────────────────

test('placo metre element: identity frozen (code/trade/method/calc/unit/formula)', () => {
  const el = getMetreElement('placo', 'panneau_ba13');
  assert.ok(el, 'placo/panneau_ba13 must exist in the registry');
  assert.strictEqual(el!.code, 'panneau_ba13');
  assert.strictEqual(el!.trade, 'placo');
  assert.strictEqual(el!.method, 'surface');
  assert.deepStrictEqual(el!.calc, { op: 'product', dims: ['largeur', 'hauteur', 'nb'] });
  assert.strictEqual(el!.qtyFormula, 'Largeur × Hauteur × Nb');
  assert.strictEqual(el!.unit, 'm²');
  assert.strictEqual((el as any).linkedSlotCode, 'placo_board');
  // No enriched block, no workType ⇒ the fast path (pre-Phase-1 expression) runs.
  for (const k of ['openings', 'deductions', 'layers', 'wastePercent', 'coveragePerProductUnit', 'workType']) {
    assert.ok(!(k in el!), `placo element must not carry "${k}"`);
  }
});

test('placo metre element: quantity unchanged (defaults 1.2 x 2.5 x 1 = 3 m2)', () => {
  const el = getMetreElement('placo', 'panneau_ba13')!;
  const defaults: Record<string, unknown> = {};
  for (const d of el.dims) defaults[d.key] = d.default;
  const r = evaluateElement(el, defaults);
  assert.strictEqual(r.ok, true);
  assert.strictEqual((r as any).qty, 3);
  assert.strictEqual((r as any).unit, 'm²');
  const r2 = evaluateElement(el, { largeur: 6, hauteur: 4, nb: 2 });
  assert.strictEqual((r2 as any).qty, 48);
  // Registry lookup paths unchanged.
  const viaTrade = elementsForTrade('placo');
  assert.strictEqual(viaTrade.length, 1);
  assert.strictEqual(viaTrade[0].code, 'panneau_ba13');
});

test('placo metre element: attaching a workType does NOT change the quantity', () => {
  const el = getMetreElement('placo', 'panneau_ba13')!;
  const withDesc = { ...el, workType: { code: 'pose_doublage_ba13', labelFr: 'Doublage BA13', labelAr: 'تغطية جبس' } } as MetreElementDef;
  const dims = { largeur: 1.2, hauteur: 2.5, nb: 1 };
  assert.deepStrictEqual(evaluateElement(withDesc, dims), evaluateElement(el, dims));
});
test('placo official calculator: byte-identical to the frozen golden record', () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const GOLDEN = JSON.parse(
    fs.readFileSync(path.join(HERE, 'fixtures', 'formulas', 'golden.json'), 'utf8'),
  ) as Record<string, any>;
  const R = DEFAULT_MARKET_RATES;
  const PLACO_BASE = {
    subType: 'cloison_fixe', length: 5, heightOrWidth: 2.8,
    openingsCount: 1, openingArea: 1.68,
    boardType: 'plaque_ba13_standard', boardThickness: '12.5mm', boardDimension: '120x250',
    studType: '48mm', skinType: 'two_sides_single_skin', montantsSpacingCm: 60,
    withInsulation: false, wasteMarginPercent: 10, laborRatePerM2: 18,
    tvaPercent: 19, includeTimbre: true, retenueGarantiePercent: 5,
  };
  const cases: Array<{ key: string; input: PlacoInput }> = [
    { key: 'placo_cloison_fixe', input: { ...PLACO_BASE } as PlacoInput },
    { key: 'placo_faux_plafond_ba13', input: { ...PLACO_BASE, subType: 'faux_plafond_ba13', openingsCount: 0, openingArea: 0 } as PlacoInput },
    { key: 'placo_opening_under_1m2', input: { ...PLACO_BASE, openingsCount: 2, openingArea: 0.8 } as PlacoInput },
  ];
  for (const c of cases) {
    const expected = GOLDEN[c.key];
    assert.ok(expected, `golden fixture "${c.key}" missing`);
    const actual: any = calculatePlaco(c.input, R);
    for (const f of ['trade', 'subType', 'areaM2', 'netAreaM2', 'perimeterM',
      'totalMaterialTnd', 'estimatedLaborTnd', 'grandTotalTnd',
      'wasteMarginPercent', 'tvaPercent', 'tvaAmountTnd', 'timbreFiscalTnd',
      'retenueGarantiePercent', 'retenueGarantieTnd', 'totalTtcTnd', 'netAPayerTnd']) {
      assert.strictEqual(actual[f], expected[f], `${c.key}.${f} changed: was ${expected[f]}, now ${actual[f]}`);
    }
    assert.strictEqual(actual.materialItems.length, expected.materialItems.length, `${c.key} material count changed`);
    actual.materialItems.forEach((it: any, i: number) => {
      const e = expected.materialItems[i];
      for (const f of ['id', 'qty', 'unit', 'unitPriceTnd', 'totalTnd', 'category', 'formulaUsed']) {
        assert.strictEqual(it[f], e[f], `${c.key}.materialItems[${i}].${f} changed: was ${e[f]}, now ${it[f]}`);
      }
    });
    assert.strictEqual(actual.trade, 'placo');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n==============================================');
console.log(` Phase 1 workType contract: ${passed} passed, ${failed} failed`);
console.log('==============================================\n');
if (failures.length > 0) {
  console.log('FAILED TESTS:');
  failures.forEach((f) => console.log(f));
  console.log('');
}
process.exit(failed > 0 ? 1 : 0);




