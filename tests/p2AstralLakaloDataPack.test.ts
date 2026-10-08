/**
 * P2 — ASTRAL LAKALO TRIAL DATA PACK (DB-free, read-only proof).
 *   npx tsx tests/p2AstralLakaloDataPack.test.ts
 *
 * SCOPE (strict):
 *   - Exercises ONLY the temporary pack
 *     `tests/fixtures/p2/astral_lakalo_datapack.json` (outside Production).
 *   - ZERO Supabase/DB writes, ZERO migrations, NO production data touched.
 *   - `src/utils/metreEngine.ts`, Calculator, Devis and WhatsApp are READ-ONLY
 *     here (leakage guard below) — never modified by this session.
 *   - The pack's `materialCode` is the deliberate placeholder `PROPOSED_ONLY`:
 *     no official material code is invented or guessed.
 *
 * NOTE ON THE POSITIVE QUANTITY TEST (rule 5):
 *   `computeMetreBoundOutputs` only emits a material item AFTER it resolves the
 *   binding against the rates list it is given. To OBSERVE the quantity
 *   (50 m² → 3.846 L) the test passes a clearly-labelled IN-MEMORY TEST DOUBLE
 *   (`[TEST DOUBLE — NOT OFFICIAL]`) that exists only inside this process — it
 *   is never persisted and is not a catalogue/price claim. The real-world case
 *   (no official Material Catalog row) is asserted separately in the
 *   REJECTION tests, which use an empty/official-only rates list.
 */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getMetreElement,
  mapMetreElementRow,
  isValidMetreElementShape,
} from '../src/data/metreElements';
import { evaluateElement } from '../src/utils/metreEngine';
import { computeMetreBoundOutputs } from '../src/utils/metreToCalculationResult';

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
const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.join(HERE, '..', rel), 'utf8');

const PACK_REL = 'tests/fixtures/p2/astral_lakalo_datapack.json';
const pack = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'p2', 'astral_lakalo_datapack.json'), 'utf8'));

console.log('\nP2 - ASTRAL LAKALO trial data pack (audit + read-path proof)\n');

// ── 1) Pack identity — a non-publishable PENDING_REVIEW artefact ────────────

test('1. pack identity: trial pack, reviewStatus=PENDING_REVIEW, not publishable', () => {
  assert.strictEqual(pack.packId, 'P2_TRIAL_ASTRAL_LAKALO');
  assert.strictEqual(pack.reviewStatus, 'PENDING_REVIEW');
  assert.strictEqual(pack.publishable, false);
  assert.strictEqual(pack.provenance.supabaseWrites, 0);
  assert.strictEqual(pack.provenance.officialMaterialCatalogMatch, null);
  assert.strictEqual(pack.provenance.officialPriceMatch, null);
});

test('2. pack target: Astral Lakalo / brand Astral / trade peinture / mur_interieur', () => {
  assert.strictEqual(pack.target.product.nameFr, 'Astral Lakalo');
  assert.strictEqual(pack.target.product.brand, 'Astral');
  assert.strictEqual(pack.target.trade, 'peinture');
  assert.strictEqual(pack.target.workType, 'mur_interieur');
  // The element mirror really is the current registry element (source of truth).
  const registry = getMetreElement('peinture', 'mur_interieur');
  assert.ok(registry, 'peinture/mur_interieur must exist in the registry');
  assert.strictEqual(pack.metreElement.elementCode, registry!.code);
  assert.strictEqual(pack.metreElement.method, registry!.method);
  assert.deepStrictEqual(pack.metreElement.dims, registry!.dims);
  assert.deepStrictEqual(pack.metreElement.calc, registry!.calc);
  assert.strictEqual(pack.metreElement.qtyUnit, registry!.unit);
});

// ── 3) Binding data: driver / coefficient / coverage / placeholder code ──────

test('3. binding: driver=metre_qty, coefficient=1, coverage=13 m²/L, code=PROPOSED_ONLY', () => {
  assert.strictEqual(pack.materialBindings.length, 1);
  const b = pack.materialBindings[0];
  assert.deepStrictEqual(b.driver, { type: 'metre_qty' });
  assert.strictEqual(b.coefficient.value, 1);
  assert.deepStrictEqual(b.coveragePerProductUnit, { value: 13, unit: 'L', basis: 'm²' });
  assert.strictEqual(pack.productCoverage.value, 13);
  assert.strictEqual(pack.productCoverage.unit, 'm²/L');
  // No invented final code — the schema-required code is the explicit placeholder.
  assert.strictEqual(b.materialCode, 'PROPOSED_ONLY');
  assert.ok(String(pack._materialCodeNote).includes('NOT an official catalogue code'));
});

test('4. rule 3: NO layers (no layers=2) anywhere in the pack', () => {
  assert.strictEqual(pack.metreElement.layers, null);
  const el = mapMetreElementRow({ ...pack.metreElement, materialBindings: pack.materialBindings }, 'peinture');
  assert.ok(el, 'pack element must map');
  assert.strictEqual('layers' in el!, false, 'mapped element must carry no layers field');
  for (const b of pack.materialBindings) {
    assert.strictEqual('layers' in b, false, 'a binding has no layers concept');
  }
});

// ── 5) Production surface untouched (read-only guards) ───────────────────────

test('5. production registry element stays binding-free (no production data changed)', () => {
  const el = getMetreElement('peinture', 'mur_interieur')!;
  assert.strictEqual('materialBindings' in el, false);
  assert.strictEqual('serviceBindings' in el, false);
  assert.strictEqual('layers' in el, false);
  assert.strictEqual('coveragePerProductUnit' in el, false);
  assert.strictEqual('yieldPerUnit' in el, false);
});

test('6. leakage guard: engine/calculator/devis/whatsapp carry no trial data', () => {
  const files = [
    'src/utils/metreEngine.ts',
    'src/utils/metreBindings.ts',
    'src/utils/metreToCalculationResult.ts',
    'src/data/metreElements.ts',
    'src/components/CalculatorTab.tsx',
    'src/components/DevisTab.tsx',
    'src/utils/whatsapp.ts',
  ];
  for (const f of files) {
    const src = read(f);
    for (const token of ['Astral Lakalo', 'PROPOSED_ONLY', 'P2_TRIAL_ASTRAL_LAKALO']) {
      assert.ok(!src.includes(token), `${f} must not contain "${token}"`);
    }
  }
});

// ── 6) Mapping path: pack row → mapMetreElementRow → binding carried ────────

test('7. pack binding travels through mapMetreElementRow; shape stays engine-valid', () => {
  const el = mapMetreElementRow({ ...pack.metreElement, materialBindings: pack.materialBindings }, 'peinture');
  assert.ok(el, 'row with pack bindings must map');
  assert.deepStrictEqual((el as any).materialBindings, pack.materialBindings);
  assert.strictEqual(isValidMetreElementShape({
    method: el!.method,
    dims: el!.dims,
    calc: el!.calc,
    qtyUnit: el!.unit,
  }), true);
});

// ── 7) Rule 5 — 50 m² ÷ 13 = 3.846 L (metre_qty, coefficient 1) ──────────────

test('8. 50 m² → 50 / 13 = 3.846 L (driver=metre_qty, coverage=13, coefficient=1)', () => {
  const el = mapMetreElementRow({ ...pack.metreElement, materialBindings: pack.materialBindings }, 'peinture')!;
  assert.ok(el);
  const dims = { largeur: 10, hauteur: 5, nb: 1 }; // 10 × 5 × 1 = 50 m²
  const q = evaluateElement(el, dims) as any;
  assert.ok(q.ok && q.qty === 50 && q.unit === 'm²', `engine must yield 50 m² (got ${JSON.stringify(q)})`);

  // IN-MEMORY TEST DOUBLE — NOT an official catalogue row, never persisted.
  const TEST_DOUBLE = {
    id: 'PROPOSED_ONLY',
    nameFr: '[TEST DOUBLE — NOT OFFICIAL] Astral Lakalo (in-memory only)',
    nameAr: '',
    unit: 'L',
    unitPriceTnd: 1,
    defaultPriceTnd: 1,
    category: 'peinture',
  };
  const out = computeMetreBoundOutputs({
    metreElement: el,
    metreDims: dims,
    metreLines: [{ qty: q.qty, unit: q.unit }],
    rates: [TEST_DOUBLE] as any,
  });
  assert.deepStrictEqual(out.issues, [], 'binding must resolve against the double');
  assert.strictEqual(out.materialItems.length, 1);
  const item = out.materialItems[0];
  assert.strictEqual(item.qty, 3.846, '50 × 1 ÷ 13 must round to 3.846');
  assert.strictEqual(item.unit, 'L');
  assert.strictEqual(item.formulaUsed, 'metre_binding(m²→L)');
  // Engine totals stay untouched by bindings.
  assert.deepStrictEqual(out.totals, { 'm²': 50 });
  assert.strictEqual(pack.trialExpectation.expectedQty, 3.846);
  assert.strictEqual(pack.trialExpectation.expectedUnit, 'L');
});

// ── 8) Rule 6 — binding REJECTED without a matching OFFICIAL material ────────

test('9. rejection: empty official rates list → unresolved_material, no items', () => {
  const el = mapMetreElementRow({ ...pack.metreElement, materialBindings: pack.materialBindings }, 'peinture')!;
  const dims = { largeur: 10, hauteur: 5, nb: 1 };
  const q = evaluateElement(el, dims) as any;
  const out = computeMetreBoundOutputs({
    metreElement: el,
    metreDims: dims,
    metreLines: [{ qty: q.qty, unit: q.unit }],
    rates: [], // no official Material Catalog at all
  });
  assert.strictEqual(out.materialItems.length, 0, 'nothing may be emitted without a catalogue match');
  assert.ok(out.issues.some((i: any) => i.type === 'unresolved_material'
    && i.message.includes('PROPOSED_ONLY')), 'must reject with unresolved_material');
  assert.ok(!out.issues.some((i: any) => i.type === 'price_unavailable'),
    'it must fail at resolution, not silently invent a price');
});

test('10. rejection: real official peinture rows do NOT satisfy the PROPOSED_ONLY binding', () => {
  const el = mapMetreElementRow({ ...pack.metreElement, materialBindings: pack.materialBindings }, 'peinture')!;
  const dims = { largeur: 10, hauteur: 5, nb: 1 };
  const q = evaluateElement(el, dims) as any;
  // Official peinture codes seeded by scripts/seed-production-tn.sql — the pack
  // must NOT silently attach to them: its code is PROPOSED_ONLY, so it stays
  // REVIEW until a Material Catalog row is officially created for Astral Lakalo.
  const officialOnly = [
    { id: 'peinture_acrylique_10l', nameFr: 'Peinture acrylique 10L', nameAr: '', unit: 'L', unitPriceTnd: 45, defaultPriceTnd: 45, category: 'peinture' },
    { id: 'peinture_satinee_10l', nameFr: 'Peinture satinée 10L', nameAr: '', unit: 'L', unitPriceTnd: 62, defaultPriceTnd: 62, category: 'peinture' },
  ];
  const out = computeMetreBoundOutputs({
    metreElement: el,
    metreDims: dims,
    metreLines: [{ qty: q.qty, unit: q.unit }],
    rates: officialOnly as any,
  });
  assert.strictEqual(out.materialItems.length, 0, 'no arbitrary official material may be picked');
  assert.ok(out.issues.some((i: any) => i.type === 'unresolved_material'));
});

// ── 9) Report present ────────────────────────────────────────────────────────

test('11. P2 report exists next to the pack', () => {
  const report = fs.readFileSync(path.join(HERE, 'fixtures', 'p2', 'P2_REPORT.md'), 'utf8');
  assert.ok(report.includes('PASS/FAIL'), 'report must state the verdict section');
  assert.ok(report.includes(PACK_REL), 'report must reference the pack path');
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n==============================================');
console.log(` P2 Astral Lakalo data pack: ${passed} passed, ${failed} failed`);
console.log('==============================================\n');
if (failures.length > 0) {
  console.log('FAILED TESTS:');
  failures.forEach((f) => console.log(f));
  console.log('');
}
process.exit(failed > 0 ? 1 : 0);

