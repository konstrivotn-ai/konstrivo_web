/**
 * PLACO price-link regression tests (Tunisie / TND catalog bridge).
 *
 * Root cause being guarded:
 *   The production catalog stores PLACO materials under canonical hyphenated
 *   `materials.code` values (plaque-ba13-standard-3m, fourrure-f47, ...) while
 *   `calculatePlaco` looks prices up by legacy underscore business ids
 *   (plaque_ba13_standard, fourrure, ...). `buildPriceMap` must expand every
 *   canonical code to the business id(s) — otherwise mergeRates never matches
 *   and every PLACO material resolves to 0.000 DT.
 *
 * Run: npx tsx tests/placoPriceLookup.test.ts
 */
import { strict as assert } from 'node:assert';
import { buildPriceMap, buildPriceMapWithTrade, mergeRates, priceKeysFor, CANONICAL_PLACO_CODE_ALIASES, ResolvedPrice } from '../src/utils/priceLookup';
import { calculatePlaco, PlacoInput } from '../src/utils/calculations';
import { DEFAULT_MARKET_RATES } from '../src/data/marketRates';
import { MaterialRate } from '../src/types';

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

// ════ 1) EXACT canonical PLACO codes (production catalog) → business ids ════
const EXPECTED_ALIASES: Record<string, string | string[]> = {
  'plaque-ba13-standard-3m': 'plaque_ba13_standard',
  'plaque-ba13-standard-2m5': 'plaque_ba13_standard',
  'plaque-ba13-hydro': 'plaque_ba13_hydrofuge',
  'plaque-ba13-coupe-feu': 'plaque_ba13_coupe_feu',
  'plaque-ciment': ['plaque_aquapanel_ciment', 'plaque_aquapanel_exterieur'],
  'rail-48': 'rail_48',
  'rail-70': 'rail_70',
  'montant-48': 'montant_48',
  'montant-70': 'montant_70',
  'fourrure-f47': 'fourrure',
  'corniere-3m': ['corniere_rive_L', 'corniere_angle'],
  'porteur-t24': 'porteur_3600',
  'entretoise-t24-1.20': 'entretoise_1200',
  'entretoise-t24-0.60': 'entretoise_600',
  'dalle-60x60': 'dalle_vinyl_60x60',
  'bande-joint': 'bande_a_joint_90m',
  'bande-arm': 'bande_a_joint_90m',
  'enduit-25kg': 'enduit_joint_25kg',
  'enduit-colle-25': 'colle_gypse_25kg',
  'vis-placo-1000': 'vis_placo_25',
  'vis-trpf-1000': 'vis_trpf',
  'vis-ciment-1000': 'vis_aquapanel',
  'laine-verre-12': 'laine_de_verre_50mm',
};

test('all 23 canonical PLACO codes are bridged to the exact expected business ids', () => {
  for (const [code, target] of Object.entries(EXPECTED_ALIASES)) {
    assert.deepEqual(CANONICAL_PLACO_CODE_ALIASES[code], target, `alias of ${code}`);
    const expanded = priceKeysFor(code);
    assert.deepEqual(expanded, Array.isArray(target) ? target : [target], `priceKeysFor(${code})`);
  }
  assert.equal(Object.keys(CANONICAL_PLACO_CODE_ALIASES).length, 23, 'alias table stays scoped to the 23 verified PLACO codes');
});

test('non-aliased keys pass through unchanged (other trades, legacy slugs, UUIDs)', () => {
  assert.deepEqual(priceKeysFor('plaque_ba13_standard'), ['plaque_ba13_standard'], 'legacy slug untouched');
  assert.deepEqual(priceKeysFor('carreau_grand_60x60'), ['carreau_grand_60x60'], 'other trades untouched');
  assert.deepEqual(priceKeysFor('uuid-123'), ['uuid-123'], 'UUID untouched');
});
// ════ 2) Fake production catalog: canonical rows + FR/MY decoys ════
const DB = '2026-01-01';
interface RawRow {
  id: string; materialId: string; code: string; price: number;
  currencyCode: string; countryCode: string; sourceCode: string;
  isCurrent: boolean; effectiveFrom: string; updatedAt: string; isDeleted: boolean; version: number;
}
let seq = 0;
const row = (code: string, price: number, countryCode: string, currencyCode: string, updatedAt = '2026-06-02T00:00:00Z'): RawRow => ({
  id: `row-${++seq}`, materialId: `uuid-${++seq}`, code, price,
  currencyCode, countryCode, sourceCode: 'OFFICIAL_DEFAULT',
  isCurrent: true, effectiveFrom: DB, updatedAt, isDeleted: false, version: 1,
});

const RAW_ROWS: RawRow[] = [
  // ── TN / TND — the canonical catalog (codes as verified above) ──
  row('plaque-ba13-standard-3m', 32.0, 'TN', 'TND', '2026-06-05T00:00:00Z'), // newest → wins the shared BA13 slot
  row('plaque-ba13-standard-2m5', 28.0, 'TN', 'TND', '2026-06-01T00:00:00Z'),
  row('plaque-ba13-hydro', 46.0, 'TN', 'TND'),
  row('plaque-ba13-coupe-feu', 50.0, 'TN', 'TND'),
  row('plaque-ciment', 85.0, 'TN', 'TND'),
  row('rail-48', 7.5, 'TN', 'TND'),
  row('rail-70', 10.5, 'TN', 'TND'),
  row('montant-48', 8.0, 'TN', 'TND'),
  row('montant-70', 11.5, 'TN', 'TND'),
  row('fourrure-f47', 7.0, 'TN', 'TND'),
  row('corniere-3m', 8.0, 'TN', 'TND'),
  row('porteur-t24', 14.0, 'TN', 'TND'),
  row('entretoise-t24-1.20', 4.5, 'TN', 'TND'),
  row('entretoise-t24-0.60', 2.5, 'TN', 'TND'),
  row('dalle-60x60', 5.5, 'TN', 'TND'),
  row('bande-joint', 18.0, 'TN', 'TND', '2026-06-02T00:00:00Z'),
  row('bande-arm', 21.0, 'TN', 'TND', '2026-06-01T00:00:00Z'),
  row('enduit-25kg', 42.0, 'TN', 'TND'),
  row('enduit-colle-25', 35.0, 'TN', 'TND'),
  row('vis-placo-1000', 22.0, 'TN', 'TND'),
  row('vis-trpf-1000', 27.5, 'TN', 'TND'),
  row('vis-ciment-1000', 35.0, 'TN', 'TND'),
  row('laine-verre-12', 68.0, 'TN', 'TND'),
  // ── Decoys: FR/EUR and MY/MYR must NEVER reach the TN calculator ──
  row('plaque-ba13-standard-3m', 12.5, 'FR', 'EUR'),
  row('rail-48', 3.9, 'FR', 'EUR'),
  row('enduit-25kg', 15.5, 'FR', 'EUR'),
  row('plaque-ba13-standard-3m', 44.5, 'MY', 'MYR'),
  row('rail-48', 15.25, 'MY', 'MYR'),
  row('vis-placo-1000', 17.75, 'MY', 'MYR'),
];
const DECOY_PRICES = [12.5, 3.9, 15.5, 44.5, 15.25, 17.75];

// Mirror of the server listPrices (Step 1+2+5+8 semantics used in production):
// is_deleted=false, pending excluded, case-insensitive market, code JOIN.
const listPrices = (market: string) =>
  RAW_ROWS
    .filter(r => !r.isDeleted && r.sourceCode !== 'SUPPLIER_SUBMITTED' && r.countryCode.toUpperCase() === market.toUpperCase())
    .map(r => ({
      id: r.id, materialId: r.materialId, code: r.code, price: r.price,
      currency: r.currencyCode, source: r.sourceCode, market: r.countryCode.toLowerCase(),
      countryCode: r.countryCode, isCurrent: r.isCurrent, effectiveFrom: r.effectiveFrom,
      effectiveTo: undefined, createdAt: r.updatedAt, updatedAt: r.updatedAt, version: r.version, isDeleted: false,
    }));

// TN_MAP for buildPriceMap tests (backward-compatible Map<string, number>)
const TN_MAP = buildPriceMap(listPrices('tn'));
// TN_MAP_WITH_TRADE for mergeRates tests (needs ResolvedPrice)
const TN_MAP_WITH_TRADE = buildPriceMapWithTrade(listPrices('tn'));

test('buildPriceMap: TN canonical codes resolve under legacy business ids (not 0)', () => {
  assert.equal(TN_MAP.get('plaque_ba13_standard'), 32.0);
  assert.equal(TN_MAP.get('fourrure'), 7.0);
  assert.equal(TN_MAP.get('porteur_3600'), 14.0);
  assert.equal(TN_MAP.get('entretoise_1200'), 4.5);
  assert.equal(TN_MAP.get('entretoise_600'), 2.5);
  assert.equal(TN_MAP.get('dalle_vinyl_60x60'), 5.5);
  assert.equal(TN_MAP.get('vis_placo_25'), 22.0);
  assert.equal(TN_MAP.get('laine_de_verre_50mm'), 68.0);
  // one-to-many aliases feed every calculator slot
  assert.equal(TN_MAP.get('corniere_rive_L'), 8.0);
  assert.equal(TN_MAP.get('corniere_angle'), 8.0);
  assert.equal(TN_MAP.get('plaque_aquapanel_ciment'), 85.0);
  assert.equal(TN_MAP.get('plaque_aquapanel_exterieur'), 85.0);
});

test('buildPriceMap: aliased codes do NOT leak their raw hyphenated key (no junk rows)', () => {
  assert.equal(TN_MAP.has('plaque-ba13-standard-3m'), false);
  assert.equal(TN_MAP.has('fourrure-f47'), false);
  assert.equal(TN_MAP.has('porteur-t24'), false);
});

test('buildPriceMap: newest updatedAt wins when two canonical codes share one business id', () => {
  assert.equal(TN_MAP.get('plaque_ba13_standard'), 32.0, '3m row (2026-06-05) beats 2m5 row (2026-06-01) — existing tiebreak rule');
  assert.equal(TN_MAP.get('bande_a_joint_90m'), 18.0, 'bande-joint (2026-06-02) beats bande-arm (2026-06-01)');
});

test('market isolation: FR/MY prices never selected for the TN calculator (positive control both ways)', () => {
  const FR_MAP = buildPriceMap(listPrices('fr'));
  assert.equal(FR_MAP.get('plaque_ba13_standard'), 12.5, 'FR selector gets the FR price');
  assert.equal(FR_MAP.get('rail_48'), 3.9);
  for (const v of TN_MAP.values()) {
    assert.equal(DECOY_PRICES.includes(v), false, `TN map must not contain a FR/MY price (found ${v})`);
  }
});

test('memory/dev path unchanged: materialId legacy slug still resolves, UUID never a key', () => {
  const map = buildPriceMap([{ materialId: 'plaque_ba13_standard', price: 30, isCurrent: true, effectiveFrom: DB }]);
  assert.equal(map.get('plaque_ba13_standard'), 30);
  const mapUuid = buildPriceMap([{ materialId: 'uuid-x', code: 'plaque-ba13-standard-3m', price: 32, isCurrent: true, effectiveFrom: DB }]);
  assert.equal(mapUuid.has('uuid-x'), false);
});
// ════ 3) mergeRates semantics with aliased keys ════
test('mergeRates: server price overrides cached value for the aliased slug (server priority)', () => {
  const prev: MaterialRate[] = DEFAULT_MARKET_RATES.filter(r => r.id === 'plaque_ba13_standard');
  const merged = mergeRates(prev, new Map<string, ResolvedPrice>([['plaque_ba13_standard', { price: 32.0, trade: 'placo', tradeId: null }]]));
  assert.equal(merged[0].unitPriceTnd, 32.0);
  assert.equal(merged[0].nameFr, prev[0].nameFr, 'identity fields preserved — price-only update');
});

test('mergeRates: local value kept when no server price (offline fallback preserved)', () => {
  const prev: MaterialRate[] = DEFAULT_MARKET_RATES.filter(r => r.id === 'plaque_ba13_standard');
  const merged = mergeRates(prev, new Map());
  assert.equal(merged[0].unitPriceTnd, 30.0);
});

test('mergeRates: aliased codes append their business id (never the raw canonical code)', () => {
  const merged = mergeRates([], TN_MAP_WITH_TRADE);
  assert.equal(merged.find(r => r.id === 'plaque-ba13-standard-3m'), undefined);
  assert.ok(merged.find(r => r.id === 'plaque_ba13_standard'), 'business id rate present');
  assert.ok(merged.every(r => !r.id.includes('-')), 'every merged id is a legacy business id');
});

// ════ 4) calculatePlaco integration — the production flow, 4 mandatory cases ════
const RATES_PROD = mergeRates([], TN_MAP_WITH_TRADE);                     // production: empty cache, server-only
const RATES_CACHED = mergeRates(DEFAULT_MARKET_RATES, TN_MAP_WITH_TRADE); // dev / cached barème overridden by server
const RATES_ZERO: MaterialRate[] = [];                         // unresolved baseline (the bug state)

const EXPECTED_TN: Record<string, number> = {
  plaque_ba13_standard: 32.0,
  plaque_ba13_hydrofuge: 46.0,
  plaque_ba13_coupe_feu: 50.0,
  plaque_aquapanel_ciment: 85.0,
  plaque_aquapanel_exterieur: 85.0,
  rail_48: 7.5, rail_70: 10.5, montant_48: 8.0, montant_70: 11.5,
  fourrure: 7.0, corniere_rive_L: 8.0, corniere_angle: 8.0,
  porteur_3600: 14.0, entretoise_1200: 4.5, entretoise_600: 2.5,
  dalle_vinyl_60x60: 5.5,
  bande_a_joint_90m: 18.0, enduit_joint_25kg: 42.0, colle_gypse_25kg: 35.0,
  vis_placo_25: 22.0, vis_trpf: 27.5, vis_aquapanel: 35.0,
  laine_de_verre_50mm: 68.0,
};
// Codes intentionally absent from the canonical catalog — existing safe fallback must hold.
const NOT_IN_CATALOG = ['suspente', 'colle_ciment_exterieur_25kg'];
// Existing in-code fallbacks that must stay untouched (no calculation change).
const BUILTIN_FALLBACK: Record<string, number> = {
  tige_filetee_1m: 3.0, bande_resiliente_48mm: 25.0, trame_fibre_exterieur: 45.0,
};
const BASE: Omit<PlacoInput, 'subType'> = {
  length: 4, heightOrWidth: 3, openingsCount: 0, openingArea: 0,
  boardType: 'plaque_ba13_standard', boardThickness: '12.5mm', boardDimension: '120x250',
  studType: '48mm', skinType: 'two_sides_single_skin', montantsSpacingCm: 60,
  withInsulation: false, wasteMarginPercent: 10, laborRatePerM2: 12,
};

const CASES: Array<{ label: string; input: PlacoInput }> = [
  { label: 'Faux Plafond Simple BA13', input: { ...BASE, subType: 'faux_plafond_ba13' } },
  {
    label: 'Cloison BA13 (double peau + laine)', input: {
      ...BASE, subType: 'cloison_fixe', length: 5, heightOrWidth: 2.7, openingsCount: 1, openingArea: 1.68,
      studType: '70mm', withInsulation: true, laborRatePerM2: 14,
    },
  },
  { label: 'Plafond Démontable (dalles 60x60 + T24)', input: { ...BASE, subType: 'plafond_demontable', length: 6, heightOrWidth: 4, wasteMarginPercent: 5, laborRatePerM2: 10 } },
  {
    label: 'Aquapanel Extérieur (plaque ciment)', input: {
      ...BASE, subType: 'aquapanel_exterieur', length: 8, heightOrWidth: 2.8,
      boardType: 'plaque_aquapanel_ciment', laborRatePerM2: 18,
    },
  },
];

const qtySignature = (r: ReturnType<typeof calculatePlaco>) =>
  r.materialItems.map(i => ({ id: i.id, qty: i.qty, unit: i.unit }));

for (const { label, input } of CASES) {
  const resolved = calculatePlaco(input, RATES_PROD);
  const cached = calculatePlaco(input, RATES_CACHED);
  const broken = calculatePlaco(input, RATES_ZERO);

  test(`${label}: material quantities identical with and without resolved prices`, () => {
    assert.deepEqual(qtySignature(resolved), qtySignature(broken), 'resolved vs unresolved');
    assert.deepEqual(qtySignature(resolved), qtySignature(cached), 'resolved vs cached-defaults');
    assert.ok(resolved.materialItems.length > 0);
  });

  test(`${label}: every catalog-linked material resolves to its exact TN/TND price (> 0)`, () => {
    for (const item of resolved.materialItems) {
      if (item.id in EXPECTED_TN) {
        assert.equal(item.unitPriceTnd, EXPECTED_TN[item.id], `${item.id} must equal the TN server price`);
        assert.ok(item.unitPriceTnd > 0, `${item.id} must not be 0`);
        assert.equal(item.totalTnd, item.qty * item.unitPriceTnd, `${item.id} total unchanged formula`);
      }
    }
    // positive proof the bug is fixed at the boundary the calculator consumes
    assert.ok(resolved.materialItems.some(i => i.id in EXPECTED_TN && i.unitPriceTnd > 0));
  });

  test(`${label}: missing prices fall back to the existing safe behavior`, () => {
    for (const item of resolved.materialItems) {
      if (NOT_IN_CATALOG.includes(item.id)) {
        assert.equal(item.unitPriceTnd, 0, `${item.id} absent from catalog → 0 (existing behavior, no crash)`);
      }
      if (item.id in BUILTIN_FALLBACK) {
        assert.equal(item.unitPriceTnd, BUILTIN_FALLBACK[item.id], `${item.id} keeps its existing in-code fallback`);
      }
      assert.equal(DECOY_PRICES.includes(item.unitPriceTnd), false, `no FR/MY price leaked into ${item.id}`);
    }
  });

  test(`${label}: cached barème keeps its names while server prices override`, () => {
    for (const item of cached.materialItems) {
      if (item.id in EXPECTED_TN) assert.equal(item.unitPriceTnd, EXPECTED_TN[item.id], `${item.id} server-over-cached`);
    }
    const boardRate = RATES_CACHED.find(r => r.id === 'plaque_ba13_standard');
    const defaultRate = DEFAULT_MARKET_RATES.find(r => r.id === 'plaque_ba13_standard');
    assert.equal(boardRate?.nameFr, defaultRate?.nameFr, 'cached identity preserved');
  });
}

// ════ 5) Partial catalog: TN still wins where present, safe 0 where absent ════
const PARTIAL_MAP = buildPriceMapWithTrade(listPrices('tn').filter(p => !['dalle-60x60', 'vis-trpf-1000', 'laine-verre-12'].includes(p.code)));
const PARTIAL_RATES = mergeRates([], PARTIAL_MAP);
const demontable = calculatePlaco(CASES[2].input, PARTIAL_RATES);

test('Plafond Démontable: absent canonical code → 0 + unchanged quantities (existing fallback)', () => {
  const dalle = demontable.materialItems.find(i => i.id === 'dalle_vinyl_60x60');
  assert.ok(dalle);
  assert.equal(dalle!.unitPriceTnd, 0, 'dalle absent from partial catalog → 0');
  const full = calculatePlaco(CASES[2].input, RATES_PROD);
  assert.deepEqual(qtySignature(demontable), qtySignature(full), 'quantities unchanged regardless of price availability');
  assert.equal(demontable.materialItems.find(i => i.id === 'porteur_3600')?.unitPriceTnd, 14.0, 'present codes still resolve');
});

test('Cloison: vis TRPF keeps its in-code 26.0 default only when its code is absent', () => {
  const cloisonPartial = calculatePlaco(CASES[1].input, PARTIAL_RATES);
  assert.equal(cloisonPartial.materialItems.find(i => i.id === 'vis_trpf')?.unitPriceTnd, 26.0, 'existing || default preserved');
  const cloisonFull = calculatePlaco(CASES[1].input, RATES_PROD);
  assert.equal(cloisonFull.materialItems.find(i => i.id === 'vis_trpf')?.unitPriceTnd, 27.5, 'server price wins when present');
});

console.log('\n═══════════════════════════════════════════');
console.log(` RESULTS: ✅ ${passed} passed | ❌ ${failed} failed`);
console.log('═══════════════════════════════════════════');
if (failures.length > 0) {
  console.log('FAILED TESTS:');
  failures.forEach(f => console.log(f));
}
process.exit(failed > 0 ? 1 : 0);



