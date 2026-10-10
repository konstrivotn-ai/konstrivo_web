/**
 * M1-1 — Direct overrides adapter (DB-free, UI-free).
 * Run: npx tsx tests/metreDirectM1.test.ts
 * Pure adapter over the FROZEN engine. No trade branch, no invention.
 */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMetreElement, METRE_ELEMENTS } from '../src/data/metreElements';
import { evaluateElement } from '../src/utils/metreEngine';
import {
  buildDirectQuantity,
  buildDirectOverrides,
  buildDirectBoundOutput,
  buildDirectCalculationResult,
  buildDirectDevisItems,
  buildDirectFiscal,
  resolveDirectEffectiveElement,
  resolveDirectDownstreamElement,
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

console.log('\nM1-1 - Direct overrides adapter\n');

test('1. legacy without overrides = evaluateElement', () => {
  const placo = getMetreElement('placo', 'panneau_ba13')!;
  const dims = { largeur: 5, hauteur: 2.5, nb: 1 };
  const engine = evaluateElement(placo, dims);
  const direct = buildDirectQuantity(placo, dims);
  const over = buildDirectOverrides({ element: placo, dims });
  assert.ok(engine.ok && direct.ok && over.ok);
  assert.strictEqual(over.ok && over.qty, (engine as { qty: number }).qty);
  assert.strictEqual(over.ok && over.unit, (engine as { unit: string }).unit);
  assert.strictEqual((direct.ok && direct.qty), (over.ok && over.qty));
});

test('2. undeclared-block override ignored (legacy byte-identical)', () => {
  const placo = getMetreElement('placo', 'panneau_ba13')!;
  const dims = { largeur: 1.2, hauteur: 2.5, nb: 1 };
  const base = buildDirectQuantity(placo, dims);
  const over = buildDirectOverrides({
    element: placo, dims,
    overrides: { openings: { enabled: true, items: [{ areaM2: 1 }] }, layers: 2, wastePercent: 10 },
  });
  assert.ok(base.ok && over.ok);
  assert.strictEqual(over.ok && over.qty, 3);
  assert.strictEqual((base.ok && base.qty), (over.ok && over.qty));
});

test('3. valid opening override on declared block changes qty', () => {
  const porte = getMetreElement('aluminium', 'porte')!;
  const dims = { largeur: 2, hauteur: 2, nb: 1 };
  const base = buildDirectOverrides({ element: porte, dims });
  assert.ok(base.ok && base.qty === 4);
  const over = buildDirectOverrides({
    element: porte, dims,
    overrides: { openings: { enabled: true, items: [{ areaM2: 1 }] } },
  });
  assert.ok(over.ok);
  assert.strictEqual(over.ok && over.qty, 3);
  assert.strictEqual(over.ok && over.unit, 'm²');
});

test('4. invalid override returns engine error, never invented', () => {
  const porte = getMetreElement('aluminium', 'porte')!;
  const dims = { largeur: 2, hauteur: 2, nb: 1 };
  const over = buildDirectOverrides({
    element: porte, dims,
    overrides: { openings: { enabled: true, items: [{ areaM2: -5 }] } },
  });
  if (over.ok) throw new Error('Expected invalid openings override to fail');
  assert.strictEqual(over.error, 'invalid_openings');
});

test('5. layers=1 and disabled/empty openings stay neutral', () => {
  const porte = getMetreElement('aluminium', 'porte')!;
  const dims = { largeur: 0.9, hauteur: 2.1, nb: 1 };
  const a = buildDirectOverrides({
    element: porte, dims, overrides: { layers: 1 },
  });
  assert.ok(a.ok && a.qty === 1.89);
  const b = buildDirectOverrides({
    element: porte, dims,
    overrides: { openings: { enabled: false, items: [{ areaM2: 3 }] } },
  });
  assert.ok(b.ok && b.qty === 1.89);
});

test('6. no trade-specific branch in adapter', () => {
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const src = strip(read('src/utils/metreDirectResult.ts'));
  assert.ok(!/trade\s*===/.test(src), 'no trade === branch');
  assert.ok(!/switch\s*\(\s*trade/.test(src), 'no switch(trade)');
  assert.ok(!/element\s*\.\s*(trade|code)\s*===/.test(src), 'no element.trade/code branch');
});

test('7. M1-2: legacy element exposes no capability (no advanced section)', () => {
  const placo = getMetreElement('placo', 'panneau_ba13')!;
  const caps = [
    (placo as { openings?: unknown }).openings,
    (placo as { deductions?: unknown }).deductions,
    (placo as { layers?: unknown }).layers,
    (placo as { wastePercent?: unknown }).wastePercent,
  ];
  assert.ok(caps.every((c) => c === undefined || c === null));
  const r = buildDirectOverrides({ element: placo, dims: { largeur: 1.2, hauteur: 2.5, nb: 1 }, overrides: {} });
  assert.ok(r.ok && r.qty === 3);
});

test('8. M1-2: porte exposes openings+layers capability (advanced section)', () => {
  const porte = getMetreElement('aluminium', 'porte')!;
  assert.ok((porte as { openings?: unknown }).openings !== undefined);
  assert.ok((porte as { layers?: unknown }).layers !== undefined);
  const base = buildDirectOverrides({ element: porte, dims: { largeur: 2, hauteur: 2, nb: 1 }, overrides: {} });
  assert.ok(base.ok && base.qty === 4);
});

test('9. M1-2: valid opening override flows to engine result', () => {
  const porte = getMetreElement('aluminium', 'porte')!;
  const r = buildDirectOverrides({
    element: porte, dims: { largeur: 2, hauteur: 2, nb: 1 },
    overrides: { openings: { enabled: true, items: [{ width: 1, height: 1, count: 1 }] } },
  });
  assert.ok(r.ok && r.qty === 3 && r.unit === 'm²');
});

test('10. M1-3: stages+breakdown derive from the SAME effective element', () => {
  const porte = getMetreElement('aluminium', 'porte')!;
  const dims = { largeur: 2, hauteur: 2, nb: 1 };
  const over = { openings: { enabled: true, items: [{ width: 1, height: 0.5, count: 1 }] } };
  const r = buildDirectOverrides({ element: porte, dims, overrides: over });
  assert.ok(r.ok);
  // 4 gross − 0.5 opening = 3.5 final, breakdown tail and final stage agree.
  assert.strictEqual(r.ok && r.qty, 3.5);
  assert.ok(r.ok && r.breakdown.endsWith('= 3.50 m²'));
  const stages = r.ok ? r.stages : [];
  const final = stages.find((s) => s.key === 'final')!;
  assert.ok(final.detail.includes('3.50 m²'));
  const openings = stages.find((s) => s.key === 'openings')!;
  assert.strictEqual(openings.effective, true);
  // Effective element resolves to the SAME VALUES for downstream consumers
  // (separate merged objects by design — compare structurally, not by ref).
  const eff = resolveDirectEffectiveElement({ element: porte, dims, overrides: over });
  assert.ok(eff !== null && eff !== porte);
  assert.deepStrictEqual((eff as { openings?: unknown }).openings, over.openings);
  const down = resolveDirectDownstreamElement({ element: porte, overrides: over });
  assert.ok(down !== null && down !== porte);
  assert.deepStrictEqual((down as { openings?: unknown }).openings, over.openings);
  assert.deepStrictEqual(down, eff);
});

test('11. M1-3: bindings preview uses effective dims+qty (no invention)', () => {
  const porte = getMetreElement('aluminium', 'porte')!;
  const dims = { largeur: 2, hauteur: 2, nb: 1 };
  const over = { openings: { enabled: true, items: [{ width: 1, height: 0.5, count: 1 }] } };
  const r = buildDirectOverrides({ element: porte, dims, overrides: over });
  assert.ok(r.ok);
  const eff = resolveDirectEffectiveElement({ element: porte, dims, overrides: over })!;
  const out = buildDirectBoundOutput({
    element: eff, dims,
    lines: [{ qty: r.ok ? r.qty : 0, unit: r.ok ? r.unit : 'm²' }], rates: [],
  });
  // No bindings declared → REVIEW preserved, nothing invented.
  assert.ok(out.issues.some((i) => i.type === 'missing_binding'));
  const dto = buildDirectCalculationResult({
    element: eff,
    quantity: { qty: r.ok ? r.qty : 0, unit: r.ok ? r.unit : 'm²' },
    materialItems: out.materialItems,
    fiscal: buildDirectFiscal(0, 0, 'TN'),
  });
  assert.strictEqual(dto.areaM2, 3.5);
  assert.strictEqual(dto.netAreaM2, 3.5);
});

test('12. M1-3: legacy resolves to the original reference (identity)', () => {
  const placo = getMetreElement('placo', 'panneau_ba13')!;
  const eff = resolveDirectEffectiveElement({ element: placo, dims: { largeur: 1.2, hauteur: 2.5, nb: 1 } });
  assert.strictEqual(eff, placo);
  const down = resolveDirectDownstreamElement({ element: placo });
  assert.strictEqual(down, placo);
});

test('13. M1-4/A: legacy downstream outputs unchanged', () => {
  const placo = getMetreElement('placo', 'panneau_ba13')!;
  const dims = { largeur: 1.2, hauteur: 2.5, nb: 1 };
  const q = buildDirectOverrides({ element: placo, dims });
  assert.ok(q.ok && q.qty === 3 && q.unit === 'm²');
  const eff = resolveDirectDownstreamElement({ element: placo });
  assert.strictEqual(eff, placo);
  const out = buildDirectBoundOutput({
    element: eff, dims, lines: [{ qty: 3, unit: 'm²' }], rates: [],
  });
  assert.ok(out.issues.some((i) => i.type === 'missing_binding'));
  assert.strictEqual(out.materialItems.length, 0);
  assert.strictEqual(out.serviceItems.length, 0);
});

test('14. M1-4/B: effective qty reaches downstream (porte opening)', () => {
  const porte = getMetreElement('aluminium', 'porte')!;
  const dims = { largeur: 2, hauteur: 2, nb: 1 };
  const over = { openings: { enabled: true, items: [{ width: 1, height: 0.5, count: 1 }] } };
  const engine = evaluateElement(
    resolveDirectEffectiveElement({ element: porte, dims, overrides: over })!,
    dims,
  );
  assert.ok(engine.ok && (engine as { qty: number }).qty === 3.5);
  const q = buildDirectOverrides({ element: porte, dims, overrides: over });
  assert.ok(q.ok && q.qty === 3.5);
  const eff = resolveDirectDownstreamElement({ element: porte, overrides: over });
  const out = buildDirectBoundOutput({
    element: eff, dims, lines: [{ qty: 3.5, unit: 'm²' }], rates: [],
  });
  assert.ok(out.issues.some((i) => i.type === 'missing_binding'));
});

test('15. M1-4/C+D: nothing invented for known trade', () => {
  const porte = getMetreElement('aluminium', 'porte')!;
  const dims = { largeur: 2, hauteur: 2, nb: 1 };
  const eff = resolveDirectDownstreamElement({
    element: porte,
    overrides: { openings: { enabled: true, items: [{ width: 1, height: 0.5, count: 1 }] } },
  });
  const out = buildDirectBoundOutput({ element: eff, dims, lines: [{ qty: 3.5, unit: 'm²' }], rates: [] });
  assert.strictEqual(out.materialItems.length, 0);
  assert.strictEqual(out.serviceItems.length, 0);
  const src = read('src/utils/metreDirectResult.ts');
  assert.ok(!src.includes('suggestedRateTnd'), 'adapter never reads suggested rates');
});

test('16. M1-4/E+F+G: fiscal+devis+DTO from effective result', () => {
  const porte = getMetreElement('aluminium', 'porte')!;
  const dims = { largeur: 2, hauteur: 2, nb: 1 };
  const eff = resolveDirectDownstreamElement({
    element: porte,
    overrides: { openings: { enabled: true, items: [{ width: 1, height: 0.5, count: 1 }] } },
  });
  const out = buildDirectBoundOutput({
    element: eff, dims, lines: [{ qty: 3.5, unit: 'm²' }], rates: [],
  });
  const a = buildDirectFiscal(100, 0, 'TN');
  assert.deepStrictEqual(a, buildDirectFiscal(100, 0, 'TN'));
  assert.deepStrictEqual(buildDirectDevisItems({ tradeCode: 'aluminium', element: eff, materialItems: out.materialItems }), []);
  const dto = buildDirectCalculationResult({
    element: eff,
    quantity: { qty: 3.5, unit: 'm²' },
    materialItems: out.materialItems,
    fiscal: buildDirectFiscal(0, 0, 'TN'),
  });
  assert.strictEqual(dto.areaM2, 3.5);
  assert.strictEqual(dto.netAreaM2, 3.5);
  assert.strictEqual(dto.subType, 'porte');
});

test('17. M1-4/H: component wires effective element downstream', () => {
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const comp = strip(read('src/components/MetreDirectTab.tsx'));
  assert.ok(comp.includes('resolveDirectDownstreamElement'), 'resolves effective element');
  assert.ok(comp.includes('element: effectiveElement'), 'bindings/DTO use effective');
  assert.ok(!/trade\s*===/.test(comp), 'no trade branch');
  assert.ok(!/switch\s*\(\s*trade/.test(comp), 'no switch(trade)');
});

test('18. M1-4: all legacy elements byte-identical with empty overrides', () => {
  let checked = 0;
  for (const els of Object.values(METRE_ELEMENTS)) {
    for (const el of els as readonly { code: string; trade: string }[]) {
      const full = getMetreElement(el.trade, el.code)!;
      const dims: Record<string, number> = {};
      for (const d of full.dims) dims[d.key] = typeof d.default === 'number' ? d.default : 1;
      const engine = evaluateElement(full, dims);
      const over = buildDirectOverrides({ element: full, dims, overrides: {} });
      if (engine.ok) {
        assert.ok(over.ok, `${full.trade}/${full.code} evaluates`);
        assert.strictEqual(over.ok && over.qty, (engine as { qty: number }).qty, `${full.trade}/${full.code} qty`);
      } else {
        assert.ok(!over.ok, `${full.trade}/${full.code} error preserved`);
      }
      checked++;
    }
  }
  assert.ok(checked >= 25, `expected full registry, got ${checked}`);
});

console.log(` M1-1 overrides: ${passed} passed, ${failed} failed`);
console.log('==============================================\n');
if (failures.length > 0) {
  console.log('FAILED TESTS:');
  failures.forEach((f) => console.log(f));
  console.log('');
}
process.exit(failed > 0 ? 1 : 0);
