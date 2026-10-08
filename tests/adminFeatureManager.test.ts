/**
 * Phase 3 — Admin Feature Manager (future control center) — focused tests.
 *
 * Pure-logic tests for the Phase 3 additions to src/lib/adminFeatures.ts:
 *   - sortEntitlementsByMode: VIEW-ONLY display ordering (the backend model
 *     has NO ordering column — nothing here persists an order)
 *   - validateLabel: varchar(200) contract from server/db/schema/features.ts
 *   - matchesFeatureSearch / featureSearchHaystack: client-side filter
 *   - computeFeatureSummary: overview counters
 *   - buildFeatureCreatePayload / normalizeFeatureKey / isValidFeatureKey:
 *     creation validation (unique key, scope, usage limit, label length)
 *
 * P3 note: these helpers never touch enforcement — the backend applies the
 * persisted rows (freeAccess / proAccess / scope / usageLimit) itself.
 *
 * Run: npx tsx tests/adminFeatureManager.test.ts
 */
import { deepStrictEqual, strictEqual, ok as assertOk } from 'assert';
import {
  AdminFeatureEntitlement,
  AdminFeatureCreateDraft,
  sortEntitlements,
  sortEntitlementsByMode,
  validateLabel,
  matchesFeatureSearch,
  featureSearchHaystack,
  computeFeatureSummary,
  buildFeatureCreatePayload,
  normalizeFeatureKey,
  isValidFeatureKey,
  FEATURE_SORT_MODES,
  FEATURE_MAX_LABEL_LENGTH,
} from '../src/lib/adminFeatures';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS ${name}`);
  } catch (err: any) {
    failed++;
    const msg = `  FAIL ${name}\\n       ${err?.message || err}`;
    failures.push(msg);
    console.log(msg);
  }
}

const ROW: AdminFeatureEntitlement = {
  id: '11111111-1111-1111-1111-111111111111',
  featureKey: 'devis:create',
  labelFr: 'Création de devis',
  labelAr: null,
  labelDerja: null,
  freeAccess: true,
  proAccess: true,
  usageLimit: 3,
  scope: 'all',
  isActive: true,
};

// ── FEATURE_SORT_MODES ───────────────────────────────────────────────────────

test('FEATURE_SORT_MODES exposes the 4 supported display orders', () => {
  deepStrictEqual(FEATURE_SORT_MODES, ['key', 'label', 'scope', 'status']);
});

test('FEATURE_MAX_LABEL_LENGTH matches the varchar(200) backend columns', () => {
  strictEqual(FEATURE_MAX_LABEL_LENGTH, 200);
});

// ── sortEntitlementsByMode ───────────────────────────────────────────────────

test("sortEntitlementsByMode 'key' matches the Phase 2 default sortEntitlements", () => {
  const rows = [
    { ...ROW, featureKey: 'projects:save', isActive: false },
    { ...ROW, featureKey: 'analytics:view', isActive: true },
  ];
  deepStrictEqual(
    sortEntitlementsByMode(rows, 'key'),
    sortEntitlements(rows)
  );
});

test("sortEntitlementsByMode 'label' orders by labelFr (fallback featureKey), active first", () => {
  const sorted = sortEntitlementsByMode(
    [
      { ...ROW, featureKey: 'analytics:view', labelFr: 'Statistiques' },
      { ...ROW, featureKey: 'catalogue:browse', labelFr: 'Catalogue', isActive: false },
      { ...ROW, featureKey: 'projects:save', labelFr: null },
    ],
    'label'
  );
  deepStrictEqual(
    sorted.map((r) => r.featureKey),
    ['projects:save', 'analytics:view', 'catalogue:browse']
  );
});

test("sortEntitlementsByMode 'scope' groups rows in backend scope order", () => {
  const sorted = sortEntitlementsByMode(
    [
      { ...ROW, featureKey: 'supplier:products', scope: 'supplier' },
      { ...ROW, featureKey: 'devis:create', scope: 'all' },
      { ...ROW, featureKey: 'engineer:advanced_calc', scope: 'engineer' },
    ],
    'scope'
  );
  deepStrictEqual(
    sorted.map((r) => r.featureKey),
    ['devis:create', 'supplier:products', 'engineer:advanced_calc']
  );
});

test("sortEntitlementsByMode 'status' pushes inactive rows to the bottom", () => {
  const sorted = sortEntitlementsByMode(
    [
      { ...ROW, featureKey: 'zzz:last', isActive: false },
      { ...ROW, featureKey: 'analytics:view', isActive: true },
      { ...ROW, featureKey: 'projects:save', isActive: false },
    ],
    'status'
  );
  deepStrictEqual(
    sorted.map((r) => r.featureKey),
    ['analytics:view', 'zzz:last', 'projects:save']
  );
});

test('sortEntitlementsByMode does not mutate the input array', () => {
  const input = [
    { ...ROW, featureKey: 'zzz:last', isActive: true },
    { ...ROW, featureKey: 'aaa:first', isActive: false },
  ];
  sortEntitlementsByMode(input, 'scope');
  strictEqual(input[0].featureKey, 'zzz:last');
});

// ── validateLabel ────────────────────────────────────────────────────────────

test('validateLabel: null for valid and empty values', () => {
  strictEqual(validateLabel('Création de devis'), null);
  strictEqual(validateLabel(''), null);
  strictEqual(validateLabel('   '), null);
});

test('validateLabel: error above varchar(200) length', () => {
  const long = 'x'.repeat(201);
  const err = validateLabel(long);
  assertOk(err, 'expected an error message for a 201-char label');
  assertOk(err.includes('200'), 'error should mention the 200-char limit');
  strictEqual(validateLabel('x'.repeat(200)), null);
});

// ── matchesFeatureSearch / featureSearchHaystack ─────────────────────────────

test('featureSearchHaystack includes key, all 3 labels and scope', () => {
  const hay = featureSearchHaystack({
    ...ROW,
    labelAr: 'إنشاء عرض سعر',
    labelDerja: 'عرض',
  });
  assertOk(hay.includes('devis:create'));
  assertOk(hay.includes('création de devis'));
  assertOk(hay.includes('إنشاء عرض سعر'));
  assertOk(hay.includes('عرض'));
  assertOk(hay.includes('all'));
});

test('matchesFeatureSearch: empty query matches everything', () => {
  strictEqual(matchesFeatureSearch(ROW, ''), true);
  strictEqual(matchesFeatureSearch(ROW, '   '), true);
});

test("matchesFeatureSearch 'key' matches case-insensitively", () => {
  strictEqual(matchesFeatureSearch(ROW, 'DEVIS:CREATE', 'key'), true);
  strictEqual(matchesFeatureSearch(ROW, 'projects', 'key'), false);
});

test("matchesFeatureSearch 'label' matches labelFr/Ar/Derja but not key/scope", () => {
  const row = { ...ROW, labelAr: 'إنشاء عرض سعر' };
  strictEqual(matchesFeatureSearch(row, 'إنشاء', 'label'), true);
  strictEqual(matchesFeatureSearch(row, 'création', 'label'), true);
  strictEqual(matchesFeatureSearch(row, 'devis:create', 'label'), false);
  strictEqual(matchesFeatureSearch(row, 'all', 'label'), false);
});

test("matchesFeatureSearch 'scope' matches only the scope", () => {
  const row = { ...ROW, scope: 'supplier' };
  strictEqual(matchesFeatureSearch(row, 'supplier', 'scope'), true);
  strictEqual(matchesFeatureSearch(row, 'devis', 'scope'), false);
});

test("matchesFeatureSearch 'all' matches across every field", () => {
  strictEqual(matchesFeatureSearch(ROW, 'devis', 'all'), true);
  strictEqual(matchesFeatureSearch(ROW, 'all', 'all'), true);
  strictEqual(matchesFeatureSearch(ROW, 'nimporte quoi', 'all'), false);
});

// ── computeFeatureSummary ────────────────────────────────────────────────────

test('computeFeatureSummary counts total/active/freeAccess/proOnly/limited', () => {
  const summary = computeFeatureSummary([
    { ...ROW, featureKey: 'a', isActive: true, freeAccess: true, proAccess: true, usageLimit: 3 },
    { ...ROW, featureKey: 'b', isActive: true, freeAccess: false, proAccess: true, usageLimit: null },
    { ...ROW, featureKey: 'c', isActive: false, freeAccess: true, proAccess: true, usageLimit: null },
    { ...ROW, featureKey: 'd', isActive: true, freeAccess: false, proAccess: true, usageLimit: 10 },
  ]);
  strictEqual(summary.total, 4);
  strictEqual(summary.active, 3);
  strictEqual(summary.freeAccess, 2);
  strictEqual(summary.proOnly, 2);
  strictEqual(summary.limited, 2);
});

test('computeFeatureSummary on an empty list returns all zeros', () => {
  deepStrictEqual(computeFeatureSummary([]), {
    total: 0,
    active: 0,
    freeAccess: 0,
    proOnly: 0,
    limited: 0,
  });
});

// ── buildFeatureCreatePayload / creation validation ──────────────────────────

const VALID_DRAFT: AdminFeatureCreateDraft = {
  featureKey: 'Devis:Export_Excel ',
  labelFr: 'Export Excel des devis',
  labelAr: 'تصدير إكسل',
  labelDerja: 'إكسور إكسل',
  freeAccess: true,
  proAccess: true,
  usageLimit: '',
  scope: 'all',
  isActive: true,
};

test('normalizeFeatureKey trims and lowercases', () => {
  strictEqual(normalizeFeatureKey('  Devis:Export_Excel '), 'devis:export_excel');
  strictEqual(normalizeFeatureKey(''), '');
});

test('isValidFeatureKey accepts canonical keys and rejects bad ones', () => {
  strictEqual(isValidFeatureKey('devis:create'), true);
  strictEqual(isValidFeatureKey('supplier:bulk_update'), true);
  strictEqual(isValidFeatureKey('a'), true);
  strictEqual(isValidFeatureKey('x'.repeat(100)), true);
  strictEqual(isValidFeatureKey(''), false);
  strictEqual(isValidFeatureKey('has space'), false);
  strictEqual(isValidFeatureKey('.leading-dot'), false);
  strictEqual(isValidFeatureKey('x'.repeat(101)), false);
});

test('create: valid draft is normalized (trim+lowercase key) and passes the shared gate', () => {
  const res = buildFeatureCreatePayload(VALID_DRAFT, ['devis:create', 'projects:save']);
  strictEqual(res.error, undefined);
  assertOk(res.payload, 'expected a payload for a valid draft');
  strictEqual(res.payload.featureKey, 'devis:export_excel');
  strictEqual(res.payload.labelFr, 'Export Excel des devis');
  strictEqual(res.payload.labelAr, 'تصدير إكسل');
  strictEqual(res.payload.labelDerja, 'إكسور إكسل');
  strictEqual(res.payload.freeAccess, true);
  strictEqual(res.payload.proAccess, true);
  strictEqual(res.payload.usageLimit, null);
  strictEqual(res.payload.scope, 'all');
  strictEqual(res.payload.isActive, true);
  deepStrictEqual(
    Object.keys(res.payload).sort(),
    ['featureKey', 'freeAccess', 'isActive', 'labelAr', 'labelDerja', 'labelFr', 'proAccess', 'scope', 'usageLimit']
  );
});

test('create: empty feature key rejected', () => {
  const res = buildFeatureCreatePayload({ ...VALID_DRAFT, featureKey: '   ' }, []);
  assertOk(res.error, 'expected an error for an empty key');
});

test('create: key with inner spaces rejected', () => {
  const res = buildFeatureCreatePayload({ ...VALID_DRAFT, featureKey: 'devis export excel' }, []);
  assertOk(res.error, 'expected an error for a key with spaces');
});

test('create: key above varchar(100) rejected', () => {
  const res = buildFeatureCreatePayload({ ...VALID_DRAFT, featureKey: 'x'.repeat(101) }, []);
  assertOk(res.error, 'expected an error for a 101-char key');
  const ok = buildFeatureCreatePayload({ ...VALID_DRAFT, featureKey: 'x'.repeat(100) }, []);
  assertOk(ok.payload, 'expected a 100-char key to be accepted');
});

test('create: duplicate key (case-insensitive) rejected with a clear message', () => {
  const res = buildFeatureCreatePayload(
    { ...VALID_DRAFT, featureKey: 'DEVIS:CREATE' },
    ['devis:create', 'projects:save']
  );
  assertOk(res.error, 'expected a duplicate-key error');
  assertOk(res.error!.includes('existe déjà'), 'error should say the key already exists');
});

test('create: usageLimit valid value passes, invalid variants rejected', () => {
  const ok = buildFeatureCreatePayload({ ...VALID_DRAFT, usageLimit: '5' }, []);
  strictEqual(ok.error, undefined);
  strictEqual(ok.payload!.usageLimit, 5);
  for (const bad of ['0', '-2', '2.5', 'abc']) {
    const res = buildFeatureCreatePayload({ ...VALID_DRAFT, usageLimit: bad }, []);
    assertOk(res.error, `expected an error for usageLimit '${bad}'`);
  }
});

test('create: invalid scope rejected with the allowed list', () => {
  const res = buildFeatureCreatePayload({ ...VALID_DRAFT, scope: 'partner' }, []);
  assertOk(res.error, 'expected a scope error');
  assertOk(res.error!.includes('supplier'), 'error should list the allowed scopes');
});

test('create: label length reuses the varchar(200) contract', () => {
  const res = buildFeatureCreatePayload({ ...VALID_DRAFT, labelFr: 'x'.repeat(201) }, []);
  assertOk(res.error, 'expected a label-length error');
  assertOk(res.error!.includes('200'), 'error should mention the 200-char limit');
});

test('create: empty labels are allowed and sent as null (backend columns nullable)', () => {
  const res = buildFeatureCreatePayload(
    { ...VALID_DRAFT, labelFr: '', labelAr: '   ', labelDerja: '' },
    []
  );
  strictEqual(res.error, undefined);
  assertOk(res.payload, 'labels are optional');
  strictEqual(res.payload.labelFr, null);
  strictEqual(res.payload.labelAr, null);
  strictEqual(res.payload.labelDerja, null);
});

test('create: access/active booleans pass through (both accesses false is storable)', () => {
  const res = buildFeatureCreatePayload(
    { ...VALID_DRAFT, freeAccess: false, proAccess: false, isActive: false },
    []
  );
  strictEqual(res.error, undefined);
  strictEqual(res.payload!.freeAccess, false);
  strictEqual(res.payload!.proAccess, false);
  strictEqual(res.payload!.isActive, false);
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════');
console.log(` RESULTS: ✅ ${passed} passed | ❌ ${failed} failed`);
console.log('═══════════════════════════════════════════\n');
if (failures.length > 0) {
  console.log('FAILED TESTS:');
  failures.forEach(f => console.log(f));
  console.log('');
}
process.exit(failed > 0 ? 1 : 0);