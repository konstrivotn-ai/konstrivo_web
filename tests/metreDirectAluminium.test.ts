/**
 * PHASE 2.3-B6.1 — ALUMINIUM / PORTE enriched proof case (DB-free).
 * Run: npx tsx tests/metreDirectAluminium.test.ts
 * NOTE: the empty openings block + layers:1 on porte are ILLUSTRATIVE /
 * TEST-ONLY (zero-effect: quantity stays byte-identical, 1.89 m²).
 */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMetreElement, elementsForTrade } from '../src/data/metreElements';
import { getWorkTypeSpec } from '../src/data/metreTradeSpecs';
import { evaluateElement } from '../src/utils/metreEngine';
import { computeFiscalData } from '../src/utils/calculations';
import { getCountryConfig } from '../src/data/countryConfig';
import {
  buildDirectQuantity,
  buildDirectDefaults,
  buildDirectBoundOutput,
  buildDirectFiscal,
  buildDirectDevisItems,
  buildDirectCalculationResult,
  sumMaterialTotals,
} from '../src/utils/metreDirectResult';

let passed = 0;
let failed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  PASS ${name}`); }
  catch (err: unknown) {
    failed++;
    const msg = `  FAIL ${name}\n       ${(err as Error)?.message || err}`;
    failures.push(msg); console.log(msg);
  }
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => fs.readFileSync(path.join(HERE, '..', rel), 'utf8');

console.log('\nPHASE B6.1 - Aluminium / porte enriched proof case\n');

test('1. aluminium/porte is discoverable (registry + descriptor intact)', () => {
  const el = getMetreElement('aluminium', 'porte');
  assert.ok(el, 'aluminium/porte must exist');
  assert.strictEqual(el!.trade, 'aluminium');
  assert.strictEqual(el!.method, 'surface');
  assert.deepStrictEqual(el!.calc, { op: 'product', dims: ['largeur', 'hauteur', 'nb'] });
  assert.strictEqual(el!.unit, 'm²');
  assert.ok(elementsForTrade('aluminium').some((e) => e.code === 'porte'));
  const spec = getWorkTypeSpec('aluminium', 'porte');
  assert.ok(spec && spec.code === 'porte');
});

test('2. base semantics unchanged: defaults evaluate via engine', () => {
  const el = getMetreElement('aluminium', 'porte')!;
  const defaults = buildDirectDefaults(el);
  assert.deepStrictEqual(defaults, { largeur: '0.9', hauteur: '2.1', nb: '1' });
  const r = buildDirectQuantity(el, defaults);
  assert.ok(r.ok, 'defaults must evaluate');
  // Zero-effect enrichment: empty openings + layers 1 contribute nothing,
  // so the quantity stays byte-identical to the pre-B6.1 gross (1.89 m²).
  assert.strictEqual(r.ok && r.qty, 1.89);
  assert.ok(r.ok && r.unit === 'm²');
  const r2 = buildDirectQuantity(el, { largeur: 1, hauteur: 2.15, nb: 2 });
  assert.ok(r2.ok && r2.qty === 4.3);
});

test('3. enriched metadata reaches evaluateElement (chain active, neutral)', () => {
  const el = getMetreElement('aluminium', 'porte')!;
  assert.deepStrictEqual((el as { openings?: unknown }).openings, { enabled: false, items: [] });
  assert.strictEqual((el as { layers?: unknown }).layers, 1);
  const engine = evaluateElement(el, { largeur: 1, hauteur: 2, nb: 1 });
  assert.ok(engine.ok);
  assert.strictEqual((engine as { qty: number }).qty, 2);
});

test('4. adapter quantity is byte-identical to evaluateElement', () => {
  const el = getMetreElement('aluminium', 'porte')!;
  const dims = { largeur: 1.2, hauteur: 2, nb: 3 };
  const engine = evaluateElement(el, dims);
  const direct = buildDirectQuantity(el, dims);
  assert.ok(engine.ok && direct.ok);
  assert.strictEqual(direct.ok && direct.qty, (engine as { qty: number }).qty);
  assert.strictEqual(direct.ok && direct.unit, (engine as { unit: string }).unit);
});

test('5. breakdown shows enriched chain; plain elements keep old shape', () => {
  const el = getMetreElement('aluminium', 'porte')!;
  const r = buildDirectQuantity(el, { largeur: 1, hauteur: 2, nb: 1 });
  assert.ok(r.ok);
  const breakdown = r.ok ? r.breakdown : '';
  assert.ok(breakdown.includes('Largeur 1.00'), 'base dims still shown');
  assert.ok(breakdown.includes('ouvertures'), 'openings stage listed from definition');
  assert.ok(breakdown.includes('(neutre'), 'disabled/empty openings marked neutral, not applied');
  assert.ok(breakdown.endsWith('= 2.00 m²'), 'engine tail preserved');
  const placo = getMetreElement('placo', 'panneau_ba13')!;
  const pr = buildDirectQuantity(placo, { largeur: 5, hauteur: 2.5, nb: 1 });
  assert.ok(pr.ok);
  assert.ok(!(pr.ok && pr.breakdown.includes('ouvertures')), 'placo untouched');
  assert.ok(!(pr.ok && pr.breakdown.includes('couche(s)')), 'placo untouched');
  assert.ok(pr.ok && pr.breakdown.endsWith('= 12.50 m²'));
});

test('5b. B6.2 stages: gross → neutral openings/layers → final engine qty/unit', () => {
  const el = getMetreElement('aluminium', 'porte')!;
  const r = buildDirectQuantity(el, { largeur: 1, hauteur: 2, nb: 1 });
  assert.ok(r.ok);
  const stages = r.ok ? r.stages : [];
  const keys = stages.map((s) => s.key);
  assert.deepStrictEqual(keys, ['gross', 'openings', 'layers', 'final']);
  const openings = stages.find((s) => s.key === 'openings')!;
  assert.strictEqual(openings.effective, false);
  const layers = stages.find((s) => s.key === 'layers')!;
  assert.strictEqual(layers.effective, false);
  assert.ok(layers.detail.includes('1'));
  const final = stages.find((s) => s.key === 'final')!;
  const engine = evaluateElement(el, { largeur: 1, hauteur: 2, nb: 1 });
  assert.ok(engine.ok);
  assert.strictEqual(r.ok && r.qty, (engine as { qty: number }).qty);
  assert.strictEqual(r.ok && r.unit, (engine as { unit: string }).unit);
  assert.ok(final.detail.includes('2.00 m²'));
  // Legacy element: gross + final only, no phantom stages.
  const placo = getMetreElement('placo', 'panneau_ba13')!;
  const pr = buildDirectQuantity(placo, { largeur: 5, hauteur: 2.5, nb: 1 });
  assert.ok(pr.ok);
  assert.deepStrictEqual((pr.ok ? pr.stages : []).map((s) => s.key), ['gross', 'final']);
});

test('6. placo reference behaviour unchanged (defaults + qty + waste 0)', () => {
  const placo = getMetreElement('placo', 'panneau_ba13')!;
  assert.deepStrictEqual(buildDirectDefaults(placo), { largeur: '1.2', hauteur: '2.5', nb: '1' });
  const r = buildDirectQuantity(placo, buildDirectDefaults(placo));
  assert.ok(r.ok && r.qty === 3 && r.unit === 'm²');
  assert.strictEqual((placo as { wastePercent?: unknown }).wastePercent, undefined);
  const dto = buildDirectCalculationResult({
    element: placo,
    quantity: { qty: 3, unit: 'm²' },
    materialItems: [],
    fiscal: buildDirectFiscal(0, 0, 'TN'),
  });
  assert.strictEqual(dto.wasteMarginPercent, 0);
});

test('7. porte without bindings stays REVIEW missing_binding', () => {
  const el = getMetreElement('aluminium', 'porte')!;
  const out = buildDirectBoundOutput({
    element: el, dims: { largeur: 1, hauteur: 2, nb: 1 },
    lines: [{ qty: 2, unit: 'm²' }], rates: [],
  });
  assert.strictEqual(out.materialItems.length, 0);
  assert.strictEqual(out.serviceItems.length, 0);
  assert.ok(out.issues.some((i) => i.type === 'missing_binding'));
});

test('8. no price invented: totals 0, adapter has no price field', () => {
  const el = getMetreElement('aluminium', 'porte')!;
  const out = buildDirectBoundOutput({
    element: el, dims: { largeur: 1, hauteur: 2, nb: 1 },
    lines: [{ qty: 2, unit: 'm²' }], rates: [],
  });
  assert.strictEqual(sumMaterialTotals(out.materialItems), 0);
  const adapter = read('src/utils/metreDirectResult.ts');
  // Pass-through `unitPriceTnd: item.unitPriceTnd` (B5 devis mapping) is
  // legitimate; only a literal assignment would be price fabrication.
  assert.ok(!/\bunitPriceTnd\s*:\s*\d/.test(adapter), 'adapter never assigns a literal price');
  assert.ok(adapter.includes('item.unitPriceTnd'), 'devis mapping is pass-through only');
});

test('9. fiscal adapter still delegates to computeFiscalData', () => {
  const cfg = getCountryConfig('TN');
  const expected = computeFiscalData(1000, 500, {
    tvaPercent: Number(cfg.defaultVatRate ?? 0) || 0,
    includeTimbre: Number(cfg.timbreFiscalDefault ?? 0) > 0,
    retenueGarantiePercent: Number(cfg.standardRetenueRate ?? 0) || 0,
  });
  const direct = buildDirectFiscal(1000, 500, 'TN');
  assert.strictEqual(direct.totalTtcTnd, expected.totalTtcTnd);
  assert.strictEqual(direct.netAPayerTnd, expected.netAPayerTnd);
});

test('10. DTO carries actual waste + m2 mapping; gates hold', () => {
  const el = getMetreElement('aluminium', 'porte')!;
  const out = buildDirectBoundOutput({
    element: el, dims: { largeur: 1, hauteur: 2, nb: 1 },
    lines: [{ qty: 2, unit: 'm²' }], rates: [],
  });
  const fiscal = buildDirectFiscal(0, 0, 'TN');
  const dto = buildDirectCalculationResult({
    element: el,
    quantity: { qty: 2, unit: 'm²' },
    materialItems: out.materialItems,
    fiscal,
  });
  // Zero-effect enrichment declares no waste ⇒ DTO keeps the legacy 0.
  assert.strictEqual(dto.wasteMarginPercent, 0);
  assert.strictEqual(dto.areaM2, 2);
  assert.strictEqual(dto.netAreaM2, 2);
  assert.strictEqual(dto.perimeterM, 0);
  assert.deepStrictEqual(buildDirectDevisItems({ tradeCode: 'aluminium', element: el, materialItems: [] }), []);
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const adapter = strip(read('src/utils/metreDirectResult.ts'));
  const comp = strip(read('src/components/MetreDirectTab.tsx'));
  assert.ok(!/trade\s*===/.test(adapter) && !/trade\s*===/.test(comp), 'no trade branch');
  assert.ok(!comp.includes('evaluateElement'), 'component presentation-only');
  assert.ok(!adapter.includes('metreWiring') && !comp.includes('metreWiring'), 'no wiring');
});

console.log('\n==============================================');
console.log(` Phase B6.1 aluminium/porte: ${passed} passed, ${failed} failed`);
console.log('==============================================\n');
if (failures.length > 0) {
  console.log('FAILED TESTS:');
  failures.forEach((f) => console.log(f));
  console.log('');
}
process.exit(failed > 0 ? 1 : 0);

