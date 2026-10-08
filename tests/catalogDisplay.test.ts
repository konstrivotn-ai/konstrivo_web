/**
 * catalogDisplay — display-only grouping/de-duplication helpers (regression).
 *
 * Covers the production data shape that produced the repeated "Aluminium"
 * label: 21 registry trades (profilés, fenêtres, portes, joints, …) all
 * carrying the SAME labelFr "Aluminium", plus a local price classification
 * stored as "aluminium". The helpers must:
 *   - collapse spelling variants ("Aluminium" / "aluminium" / " ALUMINIUM ")
 *     into ONE section,
 *   - never drop or rewrite a code (every classification stays reachable),
 *   - keep single-code métiers untouched (one card, as before),
 *   - never touch prices / categories / calculations.
 *
 * Run: npx tsx tests/catalogDisplay.test.ts
 */
import { strict as assert } from 'node:assert';
import {
  catalogKey,
  sameCatalogKey,
  uniqueCatalogValues,
  prettyCatalogCode,
  groupCatalogEntries,
} from '../src/utils/catalogDisplay';

function test(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS ${name}`); }
  catch (err: any) { console.log(`  FAIL ${name}\n       ${err?.message || err}`); process.exit(1); }
}

// The 21 aluminium classifications observed in the production trade registry.
const ALU_CODES = [
  'profilés', 'fenêtres', 'portes', 'baies vitrées', 'coulissants', 'châssis',
  'profilés dormants', 'profilés ouvrants', 'profilés coulissants', 'rails',
  'montants', 'traverses', 'cornières', 'quincaillerie', 'joints',
  'accessoires', 'consommables', 'vitrage', 'protection', 'fermetures', 'finition',
];

test('catalogKey: spelling variants of the same classification share one key', () => {
  assert.equal(catalogKey('Aluminium'), 'aluminium');
  assert.equal(catalogKey(' aluminium '), 'aluminium');
  assert.equal(catalogKey('ALUMINIUM'), 'aluminium');
  assert.equal(catalogKey('Profilés'), 'profiles');
  assert.equal(catalogKey('profilés'), 'profiles');
  assert.equal(catalogKey('PLACO / PLÂTRE'), 'placo platre');
  assert.equal(catalogKey(''), '');
  assert.equal(catalogKey(null), '');
  assert.equal(sameCatalogKey('Aluminium', 'aluminium'), true);
  assert.equal(sameCatalogKey('Aluminium', 'menuiserie'), false);
  assert.equal(sameCatalogKey('', ''), false, 'empty values never match');
});
test('uniqueCatalogValues: one entry per classification, first occurrence wins', () => {
  const categories = ['placo', 'Aluminium', 'aluminium', 'peinture', ' ALUMINIUM ', 'placo'];
  assert.deepEqual(uniqueCatalogValues(categories), ['placo', 'Aluminium', 'peinture']);
  assert.deepEqual(uniqueCatalogValues(['', '   ', null, undefined]), []);
  // Order follows the data — no re-sorting, no invented value.
  assert.deepEqual(uniqueCatalogValues(['peinture', 'placo']), ['peinture', 'placo']);
});

test('prettyCatalogCode: legible chip label, raw code preserved elsewhere', () => {
  assert.equal(prettyCatalogCode('profilés dormants'), 'Profilés Dormants');
  assert.equal(prettyCatalogCode('baies vitrées'), 'Baies Vitrées');
});

test('groupCatalogEntries: 21 registry codes + 1 rate classification = ONE Aluminium section', () => {
  const entries = [
    ...ALU_CODES.map((code) => ({ code, label: 'Aluminium', official: false })),
    // local price classification (CSV import): label falls back to the code
    { code: 'aluminium', label: 'aluminium', official: false },
  ];
  const groups = groupCatalogEntries(entries);
  assert.equal(groups.length, 1, 'exactly one section, never 22');
  const [alu] = groups;
  assert.equal(alu.label, 'Aluminium', 'the label is rendered once');
  assert.equal(alu.key, 'aluminium');
  assert.equal(alu.codes.length, 22, 'no code is dropped');
  for (const code of ALU_CODES) assert.ok(alu.codes.includes(code), `${code} stays reachable`);
  assert.ok(alu.codes.includes('aluminium'), 'the price classification stays reachable');
  assert.equal(alu.primaryCode, 'aluminium', 'the métier own code represents the section');
});

test('groupCatalogEntries: official métiers stay single-card and keep their order', () => {
  const groups = groupCatalogEntries([
    { code: 'placo', label: 'PLACO / PLÂTRE', sub: 'أسقف وجدران جبس', official: true },
    { code: 'peinture', label: 'PEINTURE', sub: 'دهان وطلاء', official: true },
    { code: 'menuiserie', label: 'MENUISERIE', official: true },
  ]);
  assert.deepEqual(groups.map((g) => g.codes.length), [1, 1, 1]);
  assert.deepEqual(groups.map((g) => g.label), ['PLACO / PLÂTRE', 'PEINTURE', 'MENUISERIE']);
  assert.equal(groups[0].sub, 'أسقف وجدران جبس', 'UI metadata subtitle preserved');
  assert.equal(groups[0].primaryCode, 'placo');
});

test('groupCatalogEntries: the métier own code is preferred as representative', () => {
  const groups = groupCatalogEntries([
    { code: 'vitrage', label: 'Aluminium' },   // registry row, not official
    { code: 'aluminium', label: 'Aluminium' }, // the métier's own code
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].primaryCode, 'aluminium');
});

test('groupCatalogEntries: official code wins, first label is never rewritten', () => {
  const groups = groupCatalogEntries([
    { code: 'placo', label: 'Placo / Plâtre', official: true },
    { code: 'placo2', label: 'placo / plâtre' },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].primaryCode, 'placo');
  assert.equal(groups[0].label, 'Placo / Plâtre', 'first label wins');
});

test('groupCatalogEntries: empty codes are ignored, unrelated métiers never merge', () => {
  const groups = groupCatalogEntries([
    { code: '', label: 'Aluminium' },
    { code: '   ', label: 'Aluminium' },
    { code: 'aluminium', label: 'Aluminium' },
    { code: 'gypsum', label: 'GYPSUM / PLASTER' },
    { code: 'gypsum2', label: 'GYPSUM 2' },
  ]);
  assert.deepEqual(groups.map((g) => g.key), ['aluminium', 'gypsum plaster', 'gypsum 2']);
  assert.equal(groups[0].codes.length, 1);
});

console.log('\n═══════════════════════════════════════════');
console.log(' catalogDisplay: ✅ all assertions passed');
console.log('═══════════════════════════════════════════\n');
