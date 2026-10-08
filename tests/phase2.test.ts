/**
 * Phase 2 — Auth/Roles/FREE-PRO audit-fix tests (server coverage for F2/F5)
 *
 * Covers the confirmed Phase 2 audit violations:
 *  - F2: `requireEntitlement` consults the server-side paid plan
 *    (`getUserPlan` → single plan rule `planCodeFromSubscription`) when the
 *    JWT entitlements are stale, while staying fail-closed and keeping the
 *    admin bypass — JWT remains the first source and is never modified.
 *  - Bridge scope: only TIER_ENTITLEMENTS.PRO can be bridged (ENTERPRISE-only
 *    entitlements such as CATALOG_OFFICIAL_MANAGE must stay out).
 *  - Single plan rule: only tier PRO **and** status active → 'pro'.
 *
 * DB-free by design: the deny path resolves plan 'free' either from an empty
 * membership list or from getUserPlan's internal fallback, so assertions hold
 * with or without a reachable test database.
 *
 * F1 (frontend verification decoupling) is covered by `tsc --noEmit`; F5
 * (awaited registration subscription insert) is exercised by the DB-backed
 * auth suite (`tests/auth.test.ts`, needs TEST_DATABASE_URL + TEST_DB_CONFIRM).
 *
 * Standalone: `npx tsx tests/phase2.test.ts` — also wired into tests/run.ts.
 */
import { requireEntitlement } from '../server/middleware/auth';
import { TIER_ENTITLEMENTS } from '../server/utils/permissions';
import { planCodeFromSubscription } from '../server/services/featureService';
import { test, assertEq, ok, testResults } from './run';

type NextCapture = { called: boolean; err?: unknown };

/** Invoke requireEntitlement('PRICES_CUSTOM_EDIT') with a mock req and capture next(). */
async function runEntitlementCheck(user: Record<string, unknown> | undefined): Promise<NextCapture> {
  const mw = requireEntitlement('PRICES_CUSTOM_EDIT') as (
    req: unknown, res: unknown, next: (err?: unknown) => void
  ) => Promise<void>;
  let capture: NextCapture = { called: false };
  await mw({ user }, {}, (err?: unknown) => { capture = { called: true, err }; });
  return capture;
}

export async function runPhase2Tests() {
  console.log('\n🔐 Phase 2 — Auth audit fixes (F2 plan bridge / entitlements)\n');

  await test('F2: entitlement granted by the JWT passes without needing the plan bridge', async () => {
    const r = await runEntitlementCheck({
      uid: 'u-jwt-granted', companyId: 'c1', role: 'artisan', tier: 'FREE',
      entitlements: ['PRICES_CUSTOM_EDIT'], iat: 0, exp: 4102444800,
    });
    ok(r.called, 'next() must be called');
    ok(!r.err, `granted entitlement must not error, got: ${String((r.err as Error)?.message)}`);
  });

  await test('F2: missing entitlement with no paid plan → 403 (fail-closed, plan bridge resolves free)', async () => {
    // Random UUID: can never have a company membership / PRO subscription row.
    const r = await runEntitlementCheck({
      uid: '00000000-0000-4000-8000-000000000000', companyId: '', role: 'artisan', tier: 'FREE',
      entitlements: ['DEVIS_CREATE_BASIC', 'OFFLINE_MODE'], iat: 0, exp: 4102444800,
    });
    ok(r.called && r.err, 'FREE user without a paid plan must be denied');
    const msg = String((r.err as Error)?.message || '');
    ok(msg.includes('Missing entitlement'), `expected entitlement denial, got: ${msg || '(no message)'}`);
  });

  await test('F2: admin bypass is unchanged and never needs the plan bridge', async () => {
    const r = await runEntitlementCheck({
      uid: 'u-admin', companyId: 'c1', role: 'admin', tier: 'ENTERPRISE',
      entitlements: [], iat: 0, exp: 4102444800,
    });
    ok(r.called && !r.err, 'admin must always pass regardless of JWT entitlements');
  });

  await test('F2: unauthenticated request → 401', async () => {
    const r = await runEntitlementCheck(undefined);
    ok(r.called && r.err, 'missing user must be rejected');
  });

  await test('F2 bridge scope: PRO tier grants PRICES_CUSTOM_EDIT but never ENTERPRISE-only entitlements', async () => {
    ok(TIER_ENTITLEMENTS.PRO.includes('PRICES_CUSTOM_EDIT'), 'PRICES_CUSTOM_EDIT is the PRO entitlement the bridge exists for');
    for (const ent of ['CATALOG_OFFICIAL_MANAGE', 'SUPPLIER_IMPORT_APPROVE', 'ARTISAN_DIRECTORY_MANAGE'] as const) {
      ok(!TIER_ENTITLEMENTS.PRO.includes(ent), `${ent} must stay out of the PRO plan bridge`);
    }
  });

  await test('single plan rule (F2 bridge source): only active PRO subscription resolves to pro', async () => {
    assertEq(planCodeFromSubscription({ tier: 'PRO', status: 'active' }), 'pro');
    assertEq(planCodeFromSubscription({ tier: 'PRO', status: 'canceled' }), 'free');
    assertEq(planCodeFromSubscription({ tier: 'FREE', status: 'active' }), 'free');
    assertEq(planCodeFromSubscription(null), 'free');
  });
}

// ── Standalone execution ─────────────────────────────────────────────────────
// `npx tsx tests/phase2.test.ts` runs only this suite — run.ts's own direct-run
// guard does NOT fire on this entry point, so the full suite never auto-starts.
const __mainEntry = (process.argv[1] || '').replace(/\\/g, '/').toLowerCase();
if (__mainEntry.endsWith('tests/phase2.test.ts')) {
  runPhase2Tests()
    .then(() => {
      const { passed, failed, failures } = testResults();
      console.log(`\n PHASE 2 RESULTS: ✅ ${passed} passed | ❌ ${failed} failed\n`);
      failures.forEach(f => console.log(f));
      process.exit(failed > 0 ? 1 : 0);
    })
    .catch(err => {
      console.error('[KONSTRIVO] Phase 2 test runner crashed:', err);
      process.exit(1);
    });
}