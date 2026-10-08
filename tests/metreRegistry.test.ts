/**
 * Phase 2 — Dynamic Métier ALIAS registry (data-driven lookup, DB-free).
 *
 * Regression suite for the fix that makes `elementsForTrade()` resolve
 * DYNAMIC métiers (e.g. "Menuiserie Aluminium") through DATA only:
 *   1. `METRE_ELEMENTS.aluminium` — shared element set for the whole
 *      Menuiserie Aluminium family (porte, fenêtre, baie vitrée, coulissant,
 *      châssis, profil, vitrage, cornière, joint, quincaillerie, consommable).
 *   2. `METRE_ELEMENT_ALIASES` — catalogKey()-folded spelling → canonical key:
 *      family label + the 21 production "Aluminium" barème codes.
 *   3. `elementsForTrade` order: direct key → alias → folded key → []
 *      (unknown métiers keep the legacy fallback contract).
 *
 * NOT covered here (frozen contracts, untouched by this fix): CalculatorTab,
 * metreWiring, genericQty, prices, official calculators, Devis, API.
 *
 * Run: npx tsx tests/metreRegistry.test.ts
 */
import { strict as assert } from 'node:assert';
import {
  METRE_ELEMENTS,
  METRE_ELEMENT_ALIASES,
  elementsForTrade,
  getMetreElement,
  methodsForTrade,
} from '../src/data/metreElements';
import { catalogKey } from '../src/utils/catalogDisplay';
import { evaluateElement } from '../src/utils/metreEngine';

let passed = 0;
let failed = 0;
const failures: string[] = [];
/** Synchronous runner: counts and exit code are always accurate. */
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  PASS ${name}`); }
  catch (err: any) {
    failed++;
    const msg = `  FAIL ${name}\n       ${err?.message || err}`;
    failures.push(msg);
    console.log(msg);
  }
}

console.log('\n🧱 Phase 2 — Aluminium alias registry (data-driven lookup)\n');

const aluminium = elementsForTrade('aluminium');

/** The 21 production trade codes (label_fr = "Aluminium") — PROJECT_STATE.md. */
const BAREME_CODES = [
  'profilés', 'fenêtres', 'portes', 'baies vitrées', 'coulissants', 'châssis',
  'profilés dormants', 'profilés ouvrants', 'profilés coulissants', 'rails',
  'montants', 'traverses', 'cornières', 'quincaillerie', 'joints',
  'accessoires', 'consommables', 'vitrage', 'protection', 'fermetures',
  'finition',
];

// ══════════════════════════════════════════════════════════════════════════
// 1) Registry — the aluminium entry itself
// ══════════════════════════════════════════════════════════════════════════

test('registry: aluminium entry exists and carries the barème elements', () => {
  for (const code of ['porte', 'fenetre', 'baie_vitree', 'coulissant', 'chassis']) {
    assert.ok(aluminium.some((el) => el.code === code), `missing element: ${code}`);
  }
  assert.ok(aluminium.length >= 11, `expected ≥ 11 elements, got ${aluminium.length}`);
});

test('registry: every aluminium element is well-formed (key/code/dims/op/unit)', () => {
  const codes = new Set<string>();
  for (const el of aluminium) {
    assert.equal(el.trade, 'aluminium', `${el.code} trade key mismatch`);
    assert.ok(!codes.has(el.code), `duplicate code ${el.code}`);
    codes.add(el.code);
    assert.ok(el.dims.length > 0, `${el.code} has no dims`);
    assert.ok(['single', 'product', 'perimeter_h'].includes(el.calc.op), `${el.code} op not whitelisted`);
    assert.ok(['m²', 'ml', 'm³', 'unit'].includes(el.unit), `${el.code} bad unit`);
    const used: string[] = el.calc.op === 'product' ? el.calc.dims
      : el.calc.op === 'single' ? [el.calc.dim]
      : [el.calc.planeA, el.calc.planeB, el.calc.height];
    for (const d of used) {
      assert.ok(el.dims.some((x) => x.key === d), `${el.code} calc refs undeclared dim ${d}`);
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 2) Aliases — every spelling reaches the SAME non-empty list
// ══════════════════════════════════════════════════════════════════════════

test('alias: family label + spelling variants resolve to the aluminium list', () => {
  const spellings = [
    'Menuiserie Aluminium', 'menuiserie aluminium', 'MENUISERIE-ALUMINIUM',
    'menuiserie_aluminium', ' Menuiserie  Aluminium ',
    'Aluminium', 'ALUMINIUM', 'aluminium',
  ];
  for (const s of spellings) {
    assert.ok(elementsForTrade(s).length > 0, `"${s}" → [] (Dynamic Métré would fall back)`);
    assert.deepEqual(elementsForTrade(s), aluminium, `"${s}" resolved to a different list`);
  }
});

test('alias: the 21 production barème codes resolve to the aluminium list', () => {
  assert.equal(BAREME_CODES.length, 21);
  for (const code of BAREME_CODES) {
    const list = elementsForTrade(code);
    assert.ok(list.length > 0, `"${code}" → [] (Dynamic Métré would fall back)`);
    assert.deepEqual(list, aluminium, `"${code}" resolved to a different list`);
  }
});

test('alias table: keys in catalogKey form, valid targets, full barème coverage', () => {
  const keys = Object.keys(METRE_ELEMENT_ALIASES);
  assert.ok(keys.length >= 22, `expected ≥ 22 aliases, got ${keys.length}`);
  for (const k of keys) {
    assert.equal(catalogKey(k), k, `alias key "${k}" is not in catalogKey form`);
    const target = METRE_ELEMENT_ALIASES[k] ?? '';
    assert.ok(target !== '', `alias "${k}" has an empty target`);
    assert.ok(METRE_ELEMENTS[target], `alias "${k}" targets unknown key "${target}"`);
  }
  for (const code of BAREME_CODES) {
    assert.ok(METRE_ELEMENT_ALIASES[catalogKey(code)], `barème code "${code}" has no alias`);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 3) Fallback contract + helpers unchanged
// ══════════════════════════════════════════════════════════════════════════

test('unknowns → [] ; official direct keys keep byte-identical behaviour', () => {
  for (const unknown of ['unknown-trade', 'menuiserie bois', '', null, undefined]) {
    assert.deepEqual(elementsForTrade(unknown), [], `"${String(unknown)}" should be []`);
  }
  assert.ok(elementsForTrade(' PLACO ').length >= 1);
  assert.deepEqual(elementsForTrade('placo'), METRE_ELEMENTS['placo']);
  assert.deepEqual(elementsForTrade('plomberie'), METRE_ELEMENTS['plomberie']);
});

test('helpers route through aliases (getMetreElement / methodsForTrade)', () => {
  assert.equal(getMetreElement('Menuiserie Aluminium', 'porte')?.method, 'surface');
  assert.equal(getMetreElement('fenêtres', 'fenetre')?.unit, 'm²');
  assert.equal(getMetreElement('châssis', 'nope'), null);
  assert.deepEqual(methodsForTrade('Menuiserie Aluminium'), ['surface', 'longueur', 'unite']);
  assert.deepEqual(methodsForTrade('baies vitrées'), ['surface', 'longueur', 'unite']);
  assert.deepEqual(methodsForTrade('bois'), []);
});

test('aluminium elements evaluate (engine smoke: surface / longueur / unité)', () => {
  const porte = getMetreElement('aluminium', 'porte')!;
  const r1 = evaluateElement(porte, { largeur: 1, hauteur: 2.1, nb: 3 });
  assert.equal(r1.ok, true);
  if (r1.ok) { assert.equal(r1.qty, 6.3); assert.equal(r1.unit, 'm²'); }

  const profil = getMetreElement('profilés dormants', 'profil')!;
  const r2 = evaluateElement(profil, { longueur: 4.5 });
  assert.equal(r2.ok, true);
  if (r2.ok) { assert.equal(r2.qty, 4.5); assert.equal(r2.unit, 'ml'); }

  const quin = getMetreElement('quincaillerie', 'quincaillerie')!;
  const r3 = evaluateElement(quin, { nombre: 7 });
  assert.equal(r3.ok, true);
  if (r3.ok) { assert.equal(r3.qty, 7); assert.equal(r3.unit, 'unit'); }
});

console.log(`\n═══════════════════════════════════════════════`);
console.log(` Aluminium alias registry: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════════════\n`);
if (failed > 0) {
  for (const f of failures) console.log(f);
  process.exit(1);
}
