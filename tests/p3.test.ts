/**
 * P3 — FREE/PRO + Admin (executable contract, DB-free).
 *
 * Covers the P3 requirements against the REAL implementation:
 *
 *  1. FREE/PRO entitlements are REAL backend-controlled access:
 *     `resolveAllFeaturesFree()` (enforcement ON by default, opt-in
 *     ALL_FEATURES_FREE=1 / legacy alias) + `decideFeatureAccess()` applied to
 *     the SHIPPED entitlement matrix (DEFAULT_ENTITLEMENTS).
 *  2. New users default to FREE — `DEFAULT_PLAN_CODE` + one plan rule
 *     (`planCodeFromSubscription`) reused by getUserPlan() / the admin tools.
 *  3. Admin can manage Plans / Features / Roles / usage limits: the existing
 *     /admin/features matrix (freeAccess, proAccess, role `scope`, usageLimit)
 *     is now enforced, and the NEW admin-only /admin/plans endpoints grant the
 *     FREE/PRO plan on the EXISTING subscriptions row (same repository the
 *     Flouci webhook/PRO verification writes to).
 *  4. The displayed FREE/PRO status and the enforced FREE/PRO come from the
 *     same source (GET /api/v1/features → planCode/enforced; useFeatures()).
 *  5. Auth / payment / webhook / PRO verification and the completed P1+P2 work
 *     are preserved (source guards).
 *
 * Run: npx tsx tests/p3.test.ts
 */
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ALL_FEATURES_FREE,
  ALL_FEATURES_FREE_SWITCH,
  DEFAULT_ENTITLEMENTS,
  DEFAULT_PLAN_CODE,
  decideFeatureAccess,
  getEntitlement,
  getUserPlan,
  isEntitlementEnforcementEnabled,
  listEntitlements,
  mergeEffectiveEntitlements,
  planCodeFromSubscription,
  resolveAllFeaturesFree,
  roleMatchesScope,
  type FeatureEntitlement,
} from '../server/services/featureService';
import {
  PLAN_CODES,
  normalizePlanCode,
  parsePlanTarget,
} from '../server/services/planAdminService';
import {
  adminPlanLabel,
  buildAdminPlanQuery,
  enforcementStatusLabel,
  normalizeAdminPlanCode,
  parseAdminPlanTarget,
} from '../src/lib/adminPlans';

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`  PASS ${name}`); }
  catch (err: any) {
    failed++;
    const msg = `  FAIL ${name}\n       ${err?.message || err}`;
    failures.push(msg);
    console.log(msg);
  }
}

// Run from the project root (same convention as tests/featureUsageAnalytics.test.ts):
//   npx tsx tests/p3.test.ts
const ROOT = process.cwd();
function read(file: string): string {
  return readFileSync(resolve(ROOT, file), 'utf8');
}
/** The shipped entitlement row for a key (throws when the matrix drifts). */
function ent(key: string): FeatureEntitlement {
  const row = DEFAULT_ENTITLEMENTS.find((e) => e.featureKey === key);
  assert.ok(row, `entitlement '${key}' must exist in the shipped matrix`);
  return row as FeatureEntitlement;
}

async function main() {
  console.log('\n🧩 P3 — FREE/PRO + Admin (enforcement / plans / single source)\n');

  // ══════════════════════════════════════════════════════════════════════════
  // 1) Enforcement policy — real by default, opt-out is explicit
  // ══════════════════════════════════════════════════════════════════════════

  await test('policy: enforcement is ON by default (no env flag → gating applied)', () => {
    assert.equal(resolveAllFeaturesFree({}), false, 'unset env must mean REAL enforcement');
    assert.equal(resolveAllFeaturesFree({ ALL_FEATURES_FREE: '' }), false, 'empty value = enforced');
    assert.equal(resolveAllFeaturesFree({ [ALL_FEATURES_FREE_SWITCH]: '0' }), false, "'0' = enforced");
    assert.equal(resolveAllFeaturesFree({ ALL_FEATURES_FREE: 'false' }), false, "'false' = enforced");
    assert.equal(resolveAllFeaturesFree({ ALL_FEATURES_FREE: 'off' }), false, "'off' = enforced");
  });

  await test('policy: the "all features free" switch is opt-in (truthy values only)', () => {
    for (const v of ['1', 'true', 'TRUE', 'Yes', 'on', ' 1 ']) {
      assert.equal(resolveAllFeaturesFree({ ALL_FEATURES_FREE: v }), true, `'${v}' must enable free mode`);
    }
    assert.equal(resolveAllFeaturesFree({ PHASE1_ALL_FEATURES_FREE: '1' }), true, 'legacy alias must still work');
    assert.equal(
      resolveAllFeaturesFree({ ALL_FEATURES_FREE: '0', PHASE1_ALL_FEATURES_FREE: '1' }),
      false,
      'ALL_FEATURES_FREE wins over the legacy alias',
    );
  });

  await test('policy: source has no hardcoded always-free constant', () => {
    const src = read('server/services/featureService.ts');
    assert.ok(
      !/PHASE1_ALL_FEATURES_FREE\s*=\s*true/.test(src),
      'featureService must not hardcode PHASE1_ALL_FEATURES_FREE = true',
    );
    assert.ok(src.includes('export function resolveAllFeaturesFree'), 'policy must be env-driven and exported');
    assert.ok(src.includes('export function isEntitlementEnforcementEnabled'), 'enforcement status must be queryable');
    assert.equal(isEntitlementEnforcementEnabled(), !ALL_FEATURES_FREE, 'status mirrors the resolved flag');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2) New users default to FREE — ONE plan rule
  // ══════════════════════════════════════════════════════════════════════════

  await test('plan: new users default to FREE', async () => {
    assert.equal(DEFAULT_PLAN_CODE, 'free');
    const plan = await getUserPlan('00000000-0000-4000-8000-000000000000');
    assert.equal(plan, 'free', 'a user without an active PRO company subscription is FREE');
  });

  await test('plan: planCodeFromSubscription is the single PRO rule', () => {
    assert.equal(planCodeFromSubscription(null), 'free');
    assert.equal(planCodeFromSubscription({ tier: 'FREE', status: 'active' }), 'free');
    assert.equal(planCodeFromSubscription({ tier: 'PRO', status: 'active' }), 'pro');
    assert.equal(planCodeFromSubscription({ tier: 'PRO', status: 'canceled' }), 'free');
    assert.equal(planCodeFromSubscription({ tier: 'PRO', status: 'expired' }), 'free');
    assert.equal(planCodeFromSubscription({ tier: 'ENTERPRISE', status: 'active' }), 'free');
    assert.equal(planCodeFromSubscription({ tier: 'pro', status: 'ACTIVE' }), 'pro', 'case-insensitive tier/status');
  });

  await test('plan: admin accepts only free|pro (server + frontend)', () => {
    assert.deepEqual([...PLAN_CODES], ['free', 'pro']);
    assert.equal(normalizePlanCode('PRO'), 'pro');
    assert.equal(normalizePlanCode(' free '), 'free');
    assert.equal(normalizePlanCode('enterprise'), null);
    assert.equal(normalizePlanCode(''), null);
    assert.equal(normalizeAdminPlanCode('Pro'), 'pro');
    assert.equal(normalizeAdminPlanCode('gold'), null);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3) REAL access decisions on the shipped matrix
  // ══════════════════════════════════════════════════════════════════════════

  await test('matrix: FREE artisan keeps the FREE features (plan gate)', () => {
    const devis = decideFeatureAccess(ent('devis:create'), 'free', 0, 'artisan');
    assert.equal(devis.canAccess, true);
    assert.equal(devis.usageLimit, 3);
    assert.equal(devis.usageRemaining, 3);
    assert.equal(decideFeatureAccess(ent('projects:save'), 'free', 0, 'artisan').canAccess, true);
    assert.equal(decideFeatureAccess(ent('catalogue:browse'), 'free', 0, 'artisan').canAccess, true);
  });

  await test('matrix: FREE is denied the PRO-only features (real paywall)', () => {
    const proOnly = [
      'devis:export_pdf',
      'projects:premium_formulas',
      'supplier:bulk_update',
      'engineer:advanced_calc',
      'engineer:multi_project',
      'catalogue:export',
      'analytics:view',
    ];
    for (const key of proOnly) {
      const res = decideFeatureAccess(ent(key), 'free', 0, 'artisan');
      assert.equal(res.canAccess, false, `${key} must be denied on FREE`);
      assert.equal(res.reason, 'PRO_REQUIRED', `${key} must report PRO_REQUIRED`);
    }
  });

  await test('matrix: PRO gets the PRO-only features', () => {
    for (const key of ['devis:export_pdf', 'analytics:view', 'catalogue:export']) {
      const res = decideFeatureAccess(ent(key), 'pro', 0, 'artisan');
      assert.equal(res.canAccess, true, `${key} must be allowed on PRO`);
    }
  });

  await test('matrix: monthly usage limits are enforced (FREE)', () => {
    assert.equal(decideFeatureAccess(ent('devis:create'), 'free', 2, 'artisan').usageRemaining, 1);
    const exhausted = decideFeatureAccess(ent('devis:create'), 'free', 3, 'artisan');
    assert.equal(exhausted.canAccess, false);
    assert.equal(exhausted.reason, 'USAGE_EXHAUSTED');
    assert.equal(exhausted.usageRemaining, 0);
    assert.equal(decideFeatureAccess(ent('devis:create'), 'free', 99, 'artisan').canAccess, false);
  });

  await test('matrix: admin-managed limits also apply to PRO (no plan bypass)', () => {
    assert.equal(ent('projects:save').usageLimit, 5);
    assert.equal(decideFeatureAccess(ent('projects:save'), 'pro', 4, 'artisan').canAccess, true);
    assert.equal(decideFeatureAccess(ent('projects:save'), 'pro', 5, 'artisan').canAccess, false);
  });

  await test('F8: role scope gates match canonical UserRole aliases (real roles, not raw scope strings)', () => {
    // ── supplier scope ← fournisseur / vendor (no role is literally 'supplier') ──
    const artisanOnSupplier = decideFeatureAccess(ent('supplier:products'), 'free', 0, 'artisan');
    assert.equal(artisanOnSupplier.canAccess, false, 'artisan must not pass the supplier scope');
    assert.equal(artisanOnSupplier.reason, 'SCOPE_MISMATCH');
    const fournisseur = decideFeatureAccess(ent('supplier:products'), 'free', 0, 'fournisseur');
    assert.equal(fournisseur.canAccess, true, 'fournisseur (supplier alias) must pass the supplier scope');
    assert.equal(fournisseur.usageRemaining, 10, 'the admin-managed usage limit still applies');
    assert.equal(
      decideFeatureAccess(ent('supplier:products'), 'free', 0, 'vendor').canAccess, true,
      'vendor (supplier alias) must pass the supplier scope',
    );

    // ── engineer scope ← ingenieur / engineer; other roles still denied ──
    assert.equal(
      decideFeatureAccess(ent('engineer:multi_project'), 'pro', 0, 'ingenieur').canAccess, true,
      'ingenieur (engineer alias) must pass the engineer scope',
    );
    assert.equal(
      decideFeatureAccess(ent('engineer:multi_project'), 'pro', 0, 'engineer').canAccess, true,
      'engineer must pass the engineer scope',
    );
    assert.equal(
      decideFeatureAccess(ent('engineer:multi_project'), 'pro', 0, 'client').reason, 'SCOPE_MISMATCH',
      'client must not pass the engineer scope',
    );

    // ── client scope ← client / particulier (shipped matrix has no client-only key) ──
    const clientScope: FeatureEntitlement = { ...ent('devis:create'), featureKey: 'custom:client', scope: 'client' };
    assert.equal(
      decideFeatureAccess(clientScope, 'free', 0, 'particulier').canAccess, true,
      'particulier (client alias) must pass the client scope',
    );
    assert.equal(decideFeatureAccess(clientScope, 'free', 0, 'client').canAccess, true, 'client must pass the client scope');
    assert.equal(
      decideFeatureAccess(clientScope, 'free', 0, 'fournisseur').reason, 'SCOPE_MISMATCH',
      'fournisseur must not pass the client scope',
    );

    // ── artisan scope ← artisan / contractor ──
    const artisanScope: FeatureEntitlement = { ...ent('devis:create'), featureKey: 'custom:artisan', scope: 'artisan' };
    assert.equal(
      decideFeatureAccess(artisanScope, 'free', 0, 'contractor').canAccess, true,
      'contractor (artisan alias) must pass the artisan scope',
    );
    assert.equal(decideFeatureAccess(artisanScope, 'free', 0, 'artisan').canAccess, true, 'artisan must pass the artisan scope');
    assert.equal(
      decideFeatureAccess(artisanScope, 'free', 0, 'vendor').reason, 'SCOPE_MISMATCH',
      'vendor must not pass the artisan scope',
    );

    // ── scope 'all' preserved: every role passes the gate ──
    assert.equal(decideFeatureAccess(ent('devis:create'), 'free', 0, 'fournisseur').canAccess, true);
    assert.equal(decideFeatureAccess(ent('devis:create'), 'free', 0, 'particulier').canAccess, true);

    // ── the canonical alias map is the single source of truth for the gate ──
    assert.equal(roleMatchesScope('fournisseur', 'supplier'), true);
    assert.equal(roleMatchesScope('vendor', 'supplier'), true);
    assert.equal(roleMatchesScope('ingenieur', 'engineer'), true);
    assert.equal(roleMatchesScope('engineer', 'engineer'), true);
    assert.equal(roleMatchesScope('particulier', 'client'), true);
    assert.equal(roleMatchesScope('client', 'client'), true);
    assert.equal(roleMatchesScope('contractor', 'artisan'), true);
    assert.equal(roleMatchesScope('artisan', 'artisan'), true);
    assert.equal(roleMatchesScope('artisan', 'supplier'), false, 'an artisan is not a supplier');
    assert.equal(roleMatchesScope('fournisseur', 'artisan'), false, 'a fournisseur is not an artisan');
    // scope 'all' and a missing role are preserved (gate never blocks).
    assert.equal(roleMatchesScope('artisan', 'all'), true);
    assert.equal(roleMatchesScope(undefined, 'supplier'), true);
  });

  await test('F11: unknown keys stay unmanaged; deactivated features are DISABLED (never open)', () => {
    // Unknown / never-configured key → unmanaged (unchanged contract).
    assert.equal(decideFeatureAccess(null, 'free', 0, 'artisan').canAccess, true);
    assert.equal(decideFeatureAccess(null, 'free', 0, 'artisan').reason, 'unmanaged');
    // F11: a KNOWN feature with isActive=false must DENY with FEATURE_DISABLED —
    // deactivation is an admin kill switch, not open/unmanaged access.
    const inactive = { ...ent('devis:export_pdf'), isActive: false };
    const res = decideFeatureAccess(inactive, 'free', 0, 'artisan');
    assert.equal(res.canAccess, false, 'a deactivated feature must not become open access');
    assert.equal(res.reason, 'FEATURE_DISABLED', 'the denial reason must be explicit');
    assert.equal(res.usageRemaining, 0);
    // The kill switch also wins over the opt-in ALL_FEATURES_FREE policy…
    const inFreeMode = decideFeatureAccess(inactive, 'free', 0, 'artisan', { allFeaturesFree: true });
    assert.equal(inFreeMode.canAccess, false, 'deactivation must not open up in all-free mode');
    // …and over every plan.
    assert.equal(decideFeatureAccess(inactive, 'pro', 0, 'artisan').canAccess, false);
  });

  await test('F12: defaults are the baseline — DB rows override, missing rows never open', async () => {
    // Same effective matrix on both surfaces (no-DB / empty-DB path here).
    const list = await listEntitlements();
    assert.equal(list.length, DEFAULT_ENTITLEMENTS.length, 'the shipped matrix must fully resolve');
    const known = await getEntitlement('devis:create');
    assert.ok(known, 'a known key must resolve even without its own DB row');
    assert.equal(known!.usageLimit, 3, 'the shipped default applies until a DB row overrides it');
    assert.equal(await getEntitlement('nope:unknown'), null, 'unknown keys stay unknown (null)');
    // The shared merge rule: a partial set of DB rows must not drop defaults.
    const override = { ...ent('devis:create'), usageLimit: 9, isActive: false };
    const merged = mergeEffectiveEntitlements([override]);
    assert.equal(merged.length, DEFAULT_ENTITLEMENTS.length, 'missing DB rows keep their defaults');
    assert.equal(
      merged.find((e) => e.featureKey === 'devis:create')!.usageLimit, 9,
      'an existing DB row overrides its own default',
    );
    assert.equal(
      merged.find((e) => e.featureKey === 'analytics:view')!.freeAccess, false,
      'a key without a DB row keeps the shipped default (not open/unmanaged)',
    );
    // Extra (non-shipped) DB rows are preserved, never discarded.
    const withExtra = mergeEffectiveEntitlements([{ ...ent('devis:create'), featureKey: 'custom:extra' }]);
    assert.equal(withExtra.length, DEFAULT_ENTITLEMENTS.length + 1);
    assert.ok(withExtra.some((e) => e.featureKey === 'custom:extra'));
  });

  await test('matrix: PRO can be denied by the admin (proAccess=false → PLAN_DENIED)', () => {
    const custom: FeatureEntitlement = {
      ...ent('analytics:view'), featureKey: 'custom:blocked', freeAccess: true, proAccess: false,
    };
    assert.equal(decideFeatureAccess(custom, 'pro', 0, 'artisan').canAccess, false);
    assert.equal(decideFeatureAccess(custom, 'pro', 0, 'artisan').reason, 'PLAN_DENIED');
  });

  await test('matrix: legacy devis:create scope repair is preserved', () => {
    const legacy = { ...ent('devis:create'), scope: 'client' };
    const res = decideFeatureAccess(legacy, 'free', 0, 'artisan');
    assert.equal(res.canAccess, true, 'artisans must still create devis');
    assert.equal(res.usageLimit, 3, 'the usage limit still applies');
  });

  await test('policy: opt-in free mode still grants everything (emergency switch)', () => {
    const res = decideFeatureAccess(
      ent('analytics:view'), 'free', 0, 'artisan', { allFeaturesFree: true },
    );
    assert.equal(res.canAccess, true);
    assert.equal(res.usageLimit, null);
    assert.equal(res.reason, 'PHASE1_ALL_FREE');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4) Admin can manage Plans / Features / Roles / usage limits
  // ══════════════════════════════════════════════════════════════════════════

  await test('admin plans: target parsing never guesses (exactly one identifier)', () => {
    assert.throws(() => parsePlanTarget({}), /userId, email or companyId is required/);
    assert.throws(() => parsePlanTarget({ email: '   ' }), /userId, email or companyId is required/);
    assert.deepEqual(parsePlanTarget({ email: ' A@B.co ' }), { email: 'a@b.co' });
    assert.deepEqual(parsePlanTarget({ userId: ' u1 ' }), { userId: 'u1' });
    assert.deepEqual(parsePlanTarget({ companyId: ' c1 ' }), { companyId: 'c1' });
  });

  await test('admin plans route: admin-only and reuses the payment subscription repo', () => {
    assert.ok(existsSync(resolve(ROOT, 'server/routes/v1/adminPlans.ts')), 'adminPlans route must exist');
    const src = read('server/routes/v1/adminPlans.ts');
    assert.ok(src.includes('router.use(authenticate)'), 'admin plans must require authentication');
    assert.ok(src.includes("router.use(requireRole('admin'))"), 'admin plans must be admin-only');
    assert.ok(src.includes('subscriptionRepositoryAsync'), 'must reuse the payment subscription repository');
    assert.ok(src.includes('getUserPlan'), 'must resolve the plan through the access-control resolver');
    assert.ok(src.includes('normalizePlanCode'), 'plan value must be validated');
    assert.ok(!src.includes('db.update(users'), 'must never write the users table (roles unchanged)');
    assert.ok(!src.includes('globalRole'), 'must not touch global roles');
  });

  await test('admin plans service: no new table, no schema, reuses existing repos', () => {
    const src = read('server/services/planAdminService.ts');
    assert.ok(!src.includes('getDatabase'), 'plan admin must go through the repositories');
    assert.ok(!src.includes('db/schema/'), 'plan admin must not import schemas (no new table)');
    assert.ok(src.includes('subscriptionRepositoryAsync'), 'must reuse the existing subscriptions repository');
    assert.ok(src.includes('planCodeFromSubscription'), 'must reuse the SINGLE plan rule');
    assert.ok(src.includes('userRepository'), 'must resolve a user target through the existing user repository');
    assert.ok(src.includes('memberRepository'), 'must resolve the company through existing memberships');
  });

  await test('admin plans route is mounted under /api/v1/admin/plans', () => {
    const src = read('server/routes/v1/index.ts');
    assert.ok(src.includes('adminPlansRouter'), 'router must be imported');
    assert.ok(src.includes("router.use('/admin/plans', adminPlansRouter)"), 'router must be mounted');
  });

  await test('admin plans client: target parsing is strict (frontend helpers)', () => {
    assert.deepEqual(parseAdminPlanTarget('  A@B.co '), { target: { email: 'a@b.co' } });
    assert.deepEqual(parseAdminPlanTarget('user:0f0e0d0c-1111-2222-3333-444455556666'), {
      target: { userId: '0f0e0d0c-1111-2222-3333-444455556666' },
    });
    assert.deepEqual(parseAdminPlanTarget('company:0f0e0d0c-1111-2222-3333-444455556666'), {
      target: { companyId: '0f0e0d0c-1111-2222-3333-444455556666' },
    });
    assert.ok(parseAdminPlanTarget('').error, 'empty input must be rejected');
    assert.ok(parseAdminPlanTarget('not an email or id').error, 'garbage must be rejected');
    assert.ok(parseAdminPlanTarget('user:abc').error, 'invalid user id must be rejected');
    assert.equal(buildAdminPlanQuery({ email: 'a@b.co' }), 'email=a%40b.co');
    assert.equal(buildAdminPlanQuery({ companyId: 'c1' }), 'companyId=c1');
    assert.equal(buildAdminPlanQuery({ userId: 'u1' }), 'userId=u1');
    assert.equal(adminPlanLabel('pro'), 'PRO');
    assert.equal(adminPlanLabel(null), 'FREE');
  });

  await test('enforcement status label states the real server mode', () => {
    assert.equal(enforcementStatusLabel(true), 'Contrôle FREE/PRO : ACTIF');
    assert.match(enforcementStatusLabel(false), /ALL_FEATURES_FREE/);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5) Displayed status = enforced status (single plan source)
  // ══════════════════════════════════════════════════════════════════════════

  await test('GET /features exposes planCode + enforced + real usage (same source)', () => {
    const src = read('server/routes/v1/features.ts');
    assert.ok(src.includes('planCode'), 'planCode must be reported');
    assert.ok(src.includes('enforced: isEntitlementEnforcementEnabled()'), 'enforced must come from the service policy');
    assert.ok(src.includes('getCurrentUsage'), 'real usage must be read for limited features');
    assert.ok(src.includes('usageCount'), 'usageCount must be surfaced to the UI');
    assert.ok(src.includes('canAccessFeature'), 'access must come from the SAME resolver the gate uses');
  });

  await test('/subscriptions/me reports the SAME planCode (no second plan source)', () => {
    const src = read('server/routes/v1/subscriptions.ts');
    assert.ok(src.includes('getUserPlan'), 'planCode must be resolved by getUserPlan');
    assert.ok(src.includes('enforced: isEntitlementEnforcementEnabled()'), 'enforced must be surfaced');
  });

  await test('frontend: useFeatures is the single plan/feature source', () => {
    const hook = read('src/hooks/useFeatures.ts');
    assert.ok(hook.includes('enforced'), 'hook must expose the server enforcement flag');
    assert.ok(hook.includes('usageCount'), 'hook must expose the server usage counter');
    assert.ok(!hook.includes('currentUser.tier'), 'hook must never read a client-side tier');
    const account = read('src/components/AccountModal.tsx');
    assert.ok(account.includes('useFeatures('), 'AccountModal must read the plan from useFeatures');
    assert.ok(account.includes('planSource'), 'AccountModal must disclose the plan provenance');
    assert.ok(!account.includes('currentUser.tier'), 'AccountModal must not display a client-side tier');
    const admin = read('src/components/AdminDashboardModal.tsx');
    assert.ok(admin.includes('getAdminPlan') && admin.includes('setAdminPlan'), 'admin UI must manage plans');
    assert.ok(admin.includes('enforcementStatusLabel'), 'admin UI must show the live enforcement state');
    assert.ok(admin.includes('featureEnforced'), 'admin UI must not invent the enforcement state');
  });

  await test('api client: admin plans endpoints wired to /api/v1/admin/plans', () => {
    const src = read('src/lib/api.ts');
    assert.ok(src.includes('/admin/plans'), 'client must call the admin plans endpoints');
    assert.ok(src.includes('getAdminPlan'), 'getAdminPlan must exist');
    assert.ok(src.includes('setAdminPlan'), 'setAdminPlan must exist');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 6) Preservation — auth / payments / webhooks / PRO / P1 / P2 untouched
  // ══════════════════════════════════════════════════════════════════════════

  await test('payments: PRO verification path untouched (webhook still grants PRO)', () => {
    const svc = read('server/services/paymentService.ts');
    assert.ok(svc.includes('ensureProSubscription'), 'PRO upgrade must still go through ensureProSubscription');
    assert.ok(svc.includes("tier: 'PRO'"), 'a verified settlement must still grant tier PRO');
    assert.ok(svc.includes('processWebhookSignal'), 'webhook handling must stay in place');
    assert.ok(existsSync(resolve(ROOT, 'server/routes/v1/webhooks.ts')), 'webhook route must still exist');
  });

  await test('no DB schema change: P3 adds no migration', () => {
    const dir = resolve(ROOT, 'server/db/migrations');
    assert.ok(existsSync(dir), 'migrations directory must exist');
    const files = readdirSync(dir).filter((f) => /\.sql$/i.test(f));
    const suspicious = files.filter((f) => /plan|p3|entitlement/i.test(f) && f !== '0004_feature_entitlements.sql');
    assert.ok(
      suspicious.length === 0,
      `P3 must not add a migration (found: ${suspicious.join(', ')})`,
    );
    const schema = read('server/db/schema/features.ts');
    assert.ok(!/planCode|plans/.test(schema), 'features schema must be untouched by P3');
  });

  await test('P1/P2 artifacts preserved', () => {
    assert.ok(existsSync(resolve(ROOT, 'src/lib/priceReview.ts')), 'P2 price-review helpers must remain');
    assert.ok(existsSync(resolve(ROOT, 'tests/p2.test.ts')), 'P2 suite must remain');
    assert.ok(existsSync(resolve(ROOT, 'tests/catalogPreviewTradeGate.test.ts')), 'P1 suite must remain');
    const priceLookup = read('src/utils/priceLookup.ts');
    assert.ok(priceLookup.includes('preferredCurrency'), 'P2 currency preference must remain');
    const calc = read('src/utils/calculations.ts');
    assert.ok(calc.includes('calculateGeneric'), 'calculator engine must remain untouched');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 7) F9 — 11-key matrix audit: real server gates + honest presentation
  // ══════════════════════════════════════════════════════════════════════════

  await test('F9: requireFeature is applied ONLY at genuine server entry points', () => {
    const routeDir = resolve(ROOT, 'server/routes/v1');
    const files = readdirSync(routeDir).filter((f) => f.endsWith('.ts'));
    const all = files.map((f) => read(`server/routes/v1/${f}`)).join('\n');
    const raw = all.match(/requireFeature\('[^']+'\)/g) || [];
    const keys = raw.map((s) => s.slice("requireFeature('".length, -2)).sort();
    assert.deepEqual(
      keys,
      ['devis:create', 'projects:save', 'supplier:products'],
      'exactly the implemented, separately protectable capabilities may be feature-gated',
    );
    // Never fabricate a gate: client-only actions have no server endpoint, and
    // not-yet-built / non-separable keys must stay presentation-only (Bientôt).
    for (const key of [
      'devis:export_pdf', 'catalogue:export',
      'projects:premium_formulas', 'engineer:multi_project', 'engineer:advanced_calc',
      'supplier:bulk_update', 'analytics:view', 'catalogue:browse',
    ]) {
      assert.ok(
        !all.includes(`requireFeature('${key}')`),
        `${key} must not carry a requireFeature gate (no genuine/separable server entry)`,
      );
    }
  });

  await test('F9: supplier:products is gated + counted at POST /suppliers/upload', () => {
    const src = read('server/routes/v1/suppliers.ts');
    const postIdx = src.indexOf("router.post('/upload'");
    assert.ok(postIdx > -1, 'the real supplier:products entry point must exist');
    const authIdx = src.indexOf('authenticate', postIdx);
    const gateIdx = src.indexOf("requireFeature('supplier:products')", postIdx);
    assert.ok(authIdx > postIdx && gateIdx > authIdx, 'must be authenticate → requireFeature("supplier:products")');
    const incIdx = src.indexOf("incrementUsage(req.user!.uid, 'supplier:products')");
    const resIdx = src.indexOf('res.status(201).json', postIdx);
    assert.ok(incIdx > postIdx, 'usage must be counted server-side (FREE 10/month becomes real)');
    assert.ok(incIdx > -1 && resIdx > incIdx, 'counted after success, before the 201 response');
    const supTest = read('tests/suppliers.test.ts');
    assert.ok(supTest.includes("role: 'fournisseur'"), 'the upload flow must run as a supplier (scope-gated)');
    assert.ok(
      supTest.includes('F9: upload with a non-supplier role'),
      'the supplier scope gate must be asserted at runtime',
    );
  });

  await test('F9: unimplemented keys are Bientôt, client-only keys are UI-level (frontend matrix source)', () => {
    const uf = read('src/hooks/useFeatures.ts');
    const grab = (name: string): string[] => {
      const m = new RegExp(`${name}[^=]*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(uf);
      return m ? (m[1].match(/'[^']+'/g) || []).map((s) => s.slice(1, -1)).sort() : [];
    };
    assert.deepEqual(
      grab('COMING_SOON_FEATURE_KEYS'),
      ['engineer:advanced_calc', 'engineer:multi_project', 'projects:premium_formulas'],
      'exactly the three keys without implementing code are marked Bientôt',
    );
    assert.deepEqual(
      grab('CLIENT_ONLY_FEATURE_KEYS'),
      ['catalogue:export', 'devis:export_pdf'],
      'exactly the two browser-side actions are marked UI-level',
    );
    const am = read('src/components/AccountModal.tsx');
    assert.ok(am.includes('COMING_SOON_FEATURE_KEYS'), 'AccountModal must render Bientôt from the shared source');
    assert.ok(am.includes('CLIENT_ONLY_FEATURE_KEYS'), 'AccountModal must mark client-only actions as UI-level');
    assert.ok(/comingSoon:/.test(am), 'the Bientôt label must exist');
    assert.ok(/uiOnly:/.test(am), 'the UI-level hint label must exist');
    assert.ok(am.includes('implementedFeatures'), 'the X/Y available counter must exclude Bientôt keys');
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════');
  console.log(` P3 — ${passed} passed / ${failed} failed`);
  console.log('═══════════════════════════════════════════\n');
  if (failures.length > 0) {
    console.log('FAILED TESTS:');
    failures.forEach((f) => console.log(f));
    console.log('');
  }
  process.exitCode = failed > 0 ? 1 : 0;
  }

main().catch((err) => {
  console.error('[KONSTRIVO] P3 test runner crashed:', err);
  process.exit(1);
});
