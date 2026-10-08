/**
 * Phase 2 — Admin Feature Entitlement helpers (server-backed admin controls).
 *
 * Pure-logic tests for src/lib/adminFeatures.ts:
 *   - buildUpsertPayload: merges the patch over the server row, validates
 *     usageLimit (null = unlimited, integer >= 1 otherwise) and scope, and
 *     ALWAYS takes featureKey from the server row (no ghost feature creation)
 *   - applyPatch: immutable optimistic update
 *   - sortEntitlements: active rows first, then alphabetical by featureKey
 *   - mapAdminFeatureRow: defensive mapping of raw API rows
 *
 * These helpers drive the AdminDashboard "Offres PRO" tab which persists
 * changes to /api/v1/admin/features (the existing Feature Entitlement system).
 * P3 note: the backend now REALLY enforces these rows (freeAccess / proAccess /
 * role `scope` / usageLimit); the helpers here never touch enforcement.
 *
 * Run: npx tsx tests/adminFeatures.test.ts
 */
import { deepStrictEqual, strictEqual, ok as assertOk } from 'assert';
import {
  AdminFeatureEntitlement,
  buildUpsertPayload,
  applyPatch,
  sortEntitlements,
  mapAdminFeatureRow,
  FEATURE_SCOPES,
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
    const msg = `  FAIL ${name}\n       ${err?.message || err}`;
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

// ── buildUpsertPayload ───────────────────────────────────────────────────────

test('buildUpsertPayload with empty patch echoes the full server row', () => {
  const { payload, error } = buildUpsertPayload(ROW, {});
  strictEqual(error, undefined);
  deepStrictEqual(payload, {
    featureKey: 'devis:create',
    labelFr: 'Création de devis',
    labelAr: null,
    labelDerja: null,
    freeAccess: true,
    proAccess: true,
    usageLimit: 3,
    scope: 'all',
    isActive: true,
  });
});

test('buildUpsertPayload applies a toggle patch and keeps the rest intact', () => {
  const { payload, error } = buildUpsertPayload(ROW, { proAccess: false });
  strictEqual(error, undefined);
  strictEqual(payload!.proAccess, false);
  strictEqual(payload!.freeAccess, true);
  strictEqual(payload!.usageLimit, 3);
  strictEqual(payload!.featureKey, 'devis:create');
});

test('buildUpsertPayload keeps featureKey from the server row (no ghost keys)', () => {
  const { payload } = buildUpsertPayload(ROW, { labelFr: 'Nouveau libellé' });
  strictEqual(payload!.featureKey, 'devis:create');
  strictEqual(payload!.labelFr, 'Nouveau libellé');
});

test('buildUpsertPayload: usageLimit null = unlimited (allowed)', () => {
  const { payload, error } = buildUpsertPayload(ROW, { usageLimit: null });
  strictEqual(error, undefined);
  strictEqual(payload!.usageLimit, null);
});

test('buildUpsertPayload: usageLimit 0 rejected', () => {
  const { payload, error } = buildUpsertPayload(ROW, { usageLimit: 0 });
  assertOk(error && error.includes('usageLimit'), 'must return a usageLimit error');
  strictEqual(payload, undefined);
});

test('buildUpsertPayload: negative usageLimit rejected', () => {
  const { payload, error } = buildUpsertPayload(ROW, { usageLimit: -2 });
  assertOk(error && error.includes('usageLimit'));
  strictEqual(payload, undefined);
});

test('buildUpsertPayload: non-integer usageLimit rejected', () => {
  const { payload, error } = buildUpsertPayload(ROW, { usageLimit: 2.5 });
  assertOk(error && error.includes('usageLimit'));
  strictEqual(payload, undefined);
});

test('buildUpsertPayload: positive integer usageLimit accepted', () => {
  const { payload, error } = buildUpsertPayload(ROW, { usageLimit: 10 });
  strictEqual(error, undefined);
  strictEqual(payload!.usageLimit, 10);
});

test('buildUpsertPayload: unknown scope rejected', () => {
  const { payload, error } = buildUpsertPayload(ROW, { scope: 'banlieue' });
  assertOk(error && error.includes('scope'), 'must return a scope error');
  strictEqual(payload, undefined);
});

test('buildUpsertPayload: every backend scope is accepted', () => {
  for (const scope of FEATURE_SCOPES) {
    const { payload, error } = buildUpsertPayload(ROW, { scope });
    strictEqual(error, undefined, `scope '${scope}' must be valid`);
    strictEqual(payload!.scope, scope);
  }
});

test('buildUpsertPayload rejects a row without featureKey (defensive)', () => {
  const broken = { ...ROW, featureKey: '' };
  const { payload, error } = buildUpsertPayload(broken, {});
  assertOk(error && error.includes('featureKey'));
  strictEqual(payload, undefined);
});

// ── applyPatch ───────────────────────────────────────────────────────────────

test('applyPatch merges without mutating the input row', () => {
  const copy: AdminFeatureEntitlement = { ...ROW };
  const merged = applyPatch(ROW, { freeAccess: false, scope: 'artisan' });
  strictEqual(merged.freeAccess, false);
  strictEqual(merged.scope, 'artisan');
  strictEqual(merged.usageLimit, 3);
  deepStrictEqual(ROW, copy, 'input row must not be mutated');
});

test('applyPatch ignores undefined patch fields', () => {
  const merged = applyPatch(ROW, {});
  deepStrictEqual(merged, ROW);
});

// ── sortEntitlements ─────────────────────────────────────────────────────────

test('sortEntitlements: active rows first, then alphabetical featureKey', () => {
  const sorted = sortEntitlements([
    { ...ROW, featureKey: 'projects:save', isActive: false },
    { ...ROW, featureKey: 'analytics:view', isActive: true },
    { ...ROW, featureKey: 'catalogue:browse', isActive: true },
  ]);
  deepStrictEqual(sorted.map(r => r.featureKey), ['analytics:view', 'catalogue:browse', 'projects:save']);
});

test('sortEntitlements does not mutate the input array', () => {
  const input = [
    { ...ROW, featureKey: 'zzz:last', isActive: true },
    { ...ROW, featureKey: 'aaa:first', isActive: true },
  ];
  sortEntitlements(input);
  strictEqual(input[0].featureKey, 'zzz:last');
});

// ── mapAdminFeatureRow ───────────────────────────────────────────────────────

test('mapAdminFeatureRow preserves nulls and coerces numbers defensively', () => {
  const mapped = mapAdminFeatureRow({
    id: 'abc',
    featureKey: 'projects:save',
    labelFr: null,
    usageLimit: '5',
    scope: 'all',
    freeAccess: 1,
    proAccess: 0,
    isActive: true,
  });
  strictEqual(mapped.id, 'abc');
  strictEqual(mapped.labelFr, null);
  strictEqual(mapped.labelAr, null);
  strictEqual(mapped.labelDerja, null);
  strictEqual(mapped.usageLimit, 5);
  strictEqual(mapped.freeAccess, true);
  strictEqual(mapped.proAccess, false);
  strictEqual(mapped.isActive, true);
  strictEqual(mapped.scope, 'all');
});

test('mapAdminFeatureRow: missing/undefined usageLimit becomes null (unlimited)', () => {
  const mapped = mapAdminFeatureRow({ id: 'x', featureKey: 'k', isActive: true });
  strictEqual(mapped.usageLimit, null);
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