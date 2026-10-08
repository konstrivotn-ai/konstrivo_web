/**
 * Phase C — Feature parity + plan enforcement tests.
 *
 * These tests validate that:
 *  - /api/v1/features returns the canonical feature key set
 *  - feature keys match the authoritative backend matrix
 *  - devis:export_pdf is available to devis-creating roles (not client-only)
 *  - plan is resolved from company subscription, not JWT tier
 *  - P3 (2026-09-20): the entitlement matrix is REAL access control — FREE
 *    keeps the features the admin marks freeAccess (with their usage limits),
 *    PRO-only features are denied on FREE, and GET /api/v1/features reports
 *    the SAME planCode + enforcement state the backend gate uses.
 *
 * Usage: npx tsx tests/runPhaseCFeatures.ts
 */
import { apiRequest } from './setup';
import { test, assertEq, ok, ctx } from './run';

export async function runPhaseCFeatureParityTests() {
  console.log('\n🟣 Phase C — Feature parity + plan enforcement\n');

  await test('GET /api/v1/features returns canonical keys with backend access fields', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/features', {
      token: ctx.freeToken,
    });
    assertEq(res.status, 200, 'features endpoint must be reachable for authenticated user');
    const payload = res.body.data || {};
    ok(Array.isArray(payload.features), 'features must be an array');
    const keys = (payload.features as any[]).map((f) => f.featureKey);
    const expected = [
      'devis:create',
      'devis:export_pdf',
      'projects:save',
      'projects:premium_formulas',
      'supplier:products',
      'supplier:bulk_update',
      'engineer:advanced_calc',
      'engineer:multi_project',
      'catalogue:browse',
      'catalogue:export',
      'analytics:view',
    ];
    assertEq(keys.sort().join(','), expected.sort().join(','), 'feature key set must match canonical matrix');

    // Backend response shape contract for this build.
    for (const f of payload.features as any[]) {
      ok(typeof f.featureKey === 'string', 'featureKey must be a string');
      ok(typeof f.canAccess === 'boolean', 'canAccess must be a boolean');
      ok(f.usageLimit === null || typeof f.usageLimit === 'number', 'usageLimit must be null or number');
      ok(f.usageRemaining === null || typeof f.usageRemaining === 'number', 'usageRemaining must be null or number');
    }
  });

  await test('P3: free artisan keeps the FREE features and is gated on PRO-only ones', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/features', {
      token: ctx.freeToken,
    });
    assertEq(res.status, 200);
    const byKey = Object.fromEntries((res.body.data!.features as any[]).map((f) => [f.featureKey, f]));
    ok(byKey['devis:create'].canAccess, 'free artisan must be able to create devis');
    ok(!byKey['devis:export_pdf'].canAccess, 'P3: devis PDF export is PRO-only (real entitlement)');
    ok(!byKey['analytics:view'].canAccess, 'P3: analytics is PRO-only (real entitlement)');
  });

  await test('P3: FREE plan reports the admin-managed usage limits + remaining counters', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/features', {
      token: ctx.freeToken,
    });
    assertEq(res.status, 200);
    for (const f of res.body.data!.features as any[]) {
      ok(typeof f.canAccess === 'boolean', `feature '${f.featureKey}' must report canAccess`);
      ok(f.usageLimit === null || typeof f.usageLimit === 'number', 'usageLimit must be null or number');
      ok(f.usageRemaining === null || typeof f.usageRemaining === 'number', 'usageRemaining must be null or number');
    }
    const byKey = Object.fromEntries((res.body.data!.features as any[]).map((f) => [f.featureKey, f]));
    assertEq(byKey['devis:create'].usageLimit, 3, 'devis:create keeps its admin-managed FREE limit');
    assertEq(byKey['projects:save'].usageLimit, 5, 'projects:save keeps its admin-managed FREE limit');
    ok(byKey['devis:create'].usageRemaining !== null, 'a limited feature must report a remaining counter');
    assertEq(byKey['catalogue:browse'].usageLimit, null, 'unlimited features report null');
  });

  await test('P3: the displayed plan comes from the same server source as access control', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/features', {
      token: ctx.freeToken,
    });
    assertEq(res.status, 200);
    assertEq((res.body.data as any)?.planCode, 'free', 'accounts without an active PRO subscription are FREE');
    ok(
      (res.body.data as any)?.enforced === true,
      'P3: the FREE/PRO gate must be active (enforced=true reported by the server)',
    );
  });

  await test('devis:export_pdf is available to all devis-creating roles, not client-only', async () => {
    // Engineer with an active PRO company subscription can export PDF.
    // (Phase F: role ≠ plan — role ingenieur grants engineer RBAC; PRO plan
    // comes from the active PRO subscription.)
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/features', {
      token: ctx.proToken,
    });
    assertEq(res.status, 200);
    const byKey = Object.fromEntries((res.body.data!.features as any[]).map((f) => [f.featureKey, f]));
    ok(byKey['devis:create'].canAccess, 'pro user must be able to create devis');
    ok(byKey['devis:export_pdf'].canAccess, 'pro user must be able to export PDF (scope must include devis creators)');
  });

  await test('feature plan is FREE when no active PRO subscription exists', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/features', {
      token: ctx.freeToken,
    });
    assertEq(res.status, 200);
    assertEq((res.body.data as any)?.planCode, 'free', 'plan must be free when no active PRO company subscription exists');
  });

  // Backend-side parity validation: the frontend canonical key list must match
  // the backend default matrix. This is the runtime counterpart to the frontend
  // assertFeatureParity() helper in src/hooks/useFeatures.ts.
  const { assertFeatureParity: backendAssertFeatureParity } = await import('../server/services/featureService');
  const frontendCanonicalKeys = [
    'devis:create',
    'devis:export_pdf',
    'projects:save',
    'projects:premium_formulas',
    'supplier:products',
    'supplier:bulk_update',
    'engineer:advanced_calc',
    'engineer:multi_project',
    'catalogue:browse',
    'catalogue:export',
    'analytics:view',
  ];
  const mismatches = backendAssertFeatureParity(frontendCanonicalKeys);
  ok(mismatches.length === 0, 'backend matrix must match frontend canonical key list; mismatches: ' + mismatches.join(', '));
}
