/**
 * « Métiers du catalogue » cleaning — display-only regression (DB-free).
 *
 * Services → « Métiers du catalogue » must advertise ONLY the ADDITIONAL
 * catalogue métiers. It must never:
 *   • duplicate an OFFICIAL métier already served by the Calculator /
 *     « Nos services » (placo, carrelage, maconnerie, plomberie, electricite,
 *     etancheite, isolation, menuiserie, sols, facade, demolition, peinture);
 *   • show a bare import/administration machine identifier
 *     (`chauffage_climatisation`, `piscine_paysagisme`, `hvac systems`,
 *     `electrical equipment`, `plumbing supplies`, `construction materials`, …).
 *
 * The rule is a single shared, data-driven predicate
 * (`isDisplayableCatalogueTrade`), NOT a hardcoded métier list, so the dynamic
 * system (registry + imports) keeps driving the section. NOTHING is deleted from
 * the Registry or the DB and no `trade_code` is invented.
 *
 * Run: npx tsx tests/catalogueTradeCleaning.test.ts
 */
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isDisplayableCatalogueTrade,
  hasHumanTradeLabel,
  isExcludedSentinelTradeCode,
  groupCatalogEntries,
  catalogKey,
} from '../src/utils/catalogDisplay';

function test(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS ${name}`); }
  catch (err: any) { console.log(`  FAIL ${name}\n       ${err?.message || err}`); process.exit(1); }
}

// ── Representative registry shapes (mirror production) ───────────────────────
const OFFICIAL = [
  { code: 'placo', labelFr: 'PLACO / PLÂTRE' },
  { code: 'peinture', labelFr: 'PEINTURE' },
  { code: 'carrelage', labelFr: 'CARRELAGE' },
  { code: 'maconnerie', labelFr: 'MAÇONNERIE' },
  { code: 'plomberie', labelFr: 'PLOMBERIE' },
  { code: 'electricite', labelFr: 'ÉLECTRICITÉ' },
  { code: 'etancheite', labelFr: 'ÉTANCHÉITÉ' },
  { code: 'isolation', labelFr: 'ISOLATION' },
  { code: 'menuiserie', labelFr: 'MENUISERIE' },
  { code: 'sols', labelFr: 'REVÊTEMENTS DE SOL' },
  { code: 'facade', labelFr: 'FAÇADE & EXTÉRIEUR' },
  { code: 'demolition', labelFr: 'DÉMOLITION' },
].map((t) => ({ ...t, isOfficial: true }));

// The 21 aluminium classifications observed in the production trade registry.
const ALU_CODES = [
  'profilés', 'fenêtres', 'portes', 'baies vitrées', 'coulissants', 'châssis',
  'profilés dormants', 'profilés ouvrants', 'profilés coulissants', 'rails',
  'montants', 'traverses', 'cornières', 'quincaillerie', 'joints',
  'accessoires', 'consommables', 'vitrage', 'protection', 'fermetures', 'finition',
];

// Machine identifiers / import artefacts the section must hide.
const PARASITES = [
  'chauffage_climatisation', 'piscine_paysagisme', 'platre_traditionnel',
  'hvac systems', 'electrical equipment', 'plumbing supplies', 'construction materials',
];

const DYNAMIC = [
  { code: 'hvac', labelFr: 'Installation Chauffroie', isOfficial: false },
  ...ALU_CODES.map((code) => ({ code, labelFr: 'Aluminium', isOfficial: false })),
  { code: 'aluminium', labelFr: 'aluminium', isOfficial: false },
  ...PARASITES.map((code) => ({ code, labelFr: code, isOfficial: false })),
  { code: 'unmapped_review', labelFr: 'unmapped_review', isOfficial: false },
];

console.log('\n🧹 « Métiers du catalogue » cleaning — official/technical entries hidden, data kept\n');

test('hasHumanTradeLabel: a real métier name is distinct from the raw code', () => {
  assert.equal(hasHumanTradeLabel('Aluminium', 'aluminium'), true);
  assert.equal(hasHumanTradeLabel('Installation Chauffroie', 'hvac'), true);
  assert.equal(hasHumanTradeLabel('PLACO / PLÂTRE', 'placo'), true);
  assert.equal(hasHumanTradeLabel('chauffage_climatisation', 'chauffage_climatisation'), false);
  assert.equal(hasHumanTradeLabel('hvac systems', 'hvac systems'), false);
  assert.equal(hasHumanTradeLabel('', 'foo'), false);
  assert.equal(hasHumanTradeLabel(null, 'foo'), false);
});

test('isDisplayableCatalogueTrade: official métiers are never shown here', () => {
  for (const t of OFFICIAL) {
    assert.equal(isDisplayableCatalogueTrade(t), false, `${t.code} (official) is hidden`);
  }
  // Officiel with a human label is STILL hidden (rule 4) — the flag decides.
  assert.equal(isDisplayableCatalogueTrade({ code: 'carrelage', labelFr: 'CARRELAGE', isOfficial: true }), false);
});

test('isDisplayableCatalogueTrade: technical/import identifiers are hidden', () => {
  for (const code of PARASITES) {
    assert.equal(isDisplayableCatalogueTrade({ code, labelFr: code, isOfficial: false }), false, `${code} is hidden`);
  }
});

test('isDisplayableCatalogueTrade: human-labelled catalogue métiers stay dynamic', () => {
  assert.equal(isDisplayableCatalogueTrade({ code: 'aluminium', labelFr: 'Aluminium', isOfficial: false }), true);
  assert.equal(isDisplayableCatalogueTrade({ code: 'hvac', labelFr: 'Installation Chauffroie', isOfficial: false }), true);
});

test('simulation: cleaned section = additional métiers only (no official, no parasite)', () => {
  const displayable = [...OFFICIAL, ...DYNAMIC].filter(
    (t) => isDisplayableCatalogueTrade(t) && !isExcludedSentinelTradeCode(t.code),
  );
  const groups = groupCatalogEntries(displayable.map((t) => ({ code: t.code, label: t.labelFr, official: !!t.isOfficial })));

  const labels = groups.map((g) => g.label).sort();
  assert.deepEqual(labels, ['Aluminium', 'Installation Chauffroie'], 'only the two genuine métiers remain');

  const remainingCodes = groups.flatMap((g) => g.codes);
  for (const t of OFFICIAL) assert.ok(!remainingCodes.includes(t.code), `${t.code} (official) not duplicated`);
  for (const code of PARASITES) assert.ok(!remainingCodes.includes(code), `${code} (technical) absent`);

  const alu = groups.find((g) => catalogKey(g.label) === 'aluminium')!;
  assert.equal(alu.codes.length, 22, 'all 22 aluminium classifications stay reachable (dynamic system preserved)');
  assert.ok(!remainingCodes.includes('unmapped_review'), 'the review sentinel stays hidden');
});

// ── Source-level guarantees (comment-blind) ──────────────────────────────────
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVICES_SRC = fs.readFileSync(path.join(HERE, '..', 'src', 'components', 'ServicesTab.tsx'), 'utf8');
const SERVICES_CODE = SERVICES_SRC.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('source: Services applies the one shared predicate (no page-local métier list)', () => {
  assert.ok(/activeDynTrades[\s\S]{0,400}isDisplayableCatalogueTrade\(t\)/.test(SERVICES_CODE),
    'the registry path uses isDisplayableCatalogueTrade');
  assert.ok(/!officialTradeKeys\.has\(catalogKey\(code\)\)/.test(SERVICES_CODE),
    'the rates fallback excludes official codes too');
  // Official Calculator codes that are NEITHER in the untouched static
  // « Nos services » list NOR in the parasite set (placo/isolation/peinture
  // legitimately live in the static card data and are left byte-for-byte).
  const FORBIDDEN = [
    ...PARASITES,
    'carrelage', 'maconnerie', 'plomberie', 'electricite',
    'etancheite', 'menuiserie', 'sols', 'facade', 'demolition',
  ];
  for (const code of FORBIDDEN) {
    assert.ok(!SERVICES_CODE.includes(`'${code}'`) && !SERVICES_CODE.includes(`"${code}"`),
      `no hardcoded '${code}' literal in the page`);
  }
});

test('source: the dynamic system is preserved and stays display-only', () => {
  assert.ok(/groupCatalogEntries\(/.test(SERVICES_CODE), 'still groups dynamically (not a static list)');
  assert.ok(/listTrades\(/.test(SERVICES_CODE), 'still reads the trade registry');
  assert.ok(/countRatesForCatalogGroup\(/.test(SERVICES_CODE), 'still counts live catalogue materials');
  assert.ok(!/upsertTradeByCode|createTrade|registerTrade/.test(SERVICES_CODE), 'no trade-creation path added');
});

console.log('\n═══════════════════════════════════════════');
console.log(' catalogue trade cleaning: ✅ all assertions passed');
console.log('═══════════════════════════════════════════\n');

