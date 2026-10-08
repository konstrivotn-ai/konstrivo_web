/**
 * Phase 1 — Feature Usage Analytics (focused test)
 *
 * Run: npx tsx tests/featureUsageAnalytics.test.ts
 *
 * Proves, without requiring a database:
 *   1. Each of the 4 tracked actions has EXACTLY ONE usage call site.
 *   2. Server-side counters increment ONLY after the action succeeds
 *      (after the repository write, before the success response).
 *   3. Client-side tracking fires exactly once at the real success point.
 *   4. Tracking failure NEVER blocks the action.
 *   5. The existing system is REUSED: featureService.incrementUsage + the
 *      single user_feature_usage table (no duplicate tracking system), and
 *      P3 enforcement is ON by default (ALL_FEATURES_FREE is opt-in only).
 */
import { strictEqual, ok, deepStrictEqual } from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';

// The required command runs from the project root: npx tsx tests/featureUsageAnalytics.test.ts
const root = process.cwd();
const readSource = (rel: string): string => readFileSync(join(root, rel), 'utf8');

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    count++;
    i += needle.length;
  }
  return count;
}

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  PASS ${name}`);
  } catch (err: any) {
    failed++;
    const msg = `  FAIL ${name}\n       ${err?.message || err}`;
    failures.push(msg);
    console.log(msg);
  }
}

async function main() {
  // Ensure the test-environment flag BEFORE any dynamic import of server
  // modules (same mitigation as tests/run.ts: modules may construct rate
  // limiters / read env at import time).
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';

  // ── 1. Server-side call sites: exactly once, after success, non-blocking ──

  await test('devis:create — exactly one incrementUsage call site in POST /devis', () => {
    const src = readSource('server/routes/v1/devis.ts');
    strictEqual(
      countOccurrences(src, "incrementUsage(req.user!.uid, 'devis:create')"),
      1,
      'devis:create must be incremented exactly once',
    );
    ok(
      src.includes("import { incrementUsage } from '../../services/featureService'"),
      'must reuse the existing featureService.incrementUsage',
    );
  });

  await test('devis:create — increments only AFTER the devis is successfully created', () => {
    const src = readSource('server/routes/v1/devis.ts');
    const createIdx = src.indexOf('await (devisRepository as any).create(');
    const incIdx = src.indexOf("incrementUsage(req.user!.uid, 'devis:create')");
    const resIdx = src.indexOf('res.status(201).json({ data: devis })');
    ok(createIdx !== -1, 'repository create call found');
    ok(resIdx !== -1, '201 success response found');
    ok(incIdx > createIdx, 'increment must happen after the successful create');
    ok(incIdx < resIdx, 'increment must happen before the success response is sent');
  });

  await test('devis:create — tracking failure cannot fail the request (guarded call)', () => {
    const src = readSource('server/routes/v1/devis.ts');
    const incIdx = src.indexOf("incrementUsage(req.user!.uid, 'devis:create')");
    const before = src.slice(Math.max(0, incIdx - 120), incIdx);
    const after = src.slice(incIdx, incIdx + 240);
    ok(/try\s*\{[^]*$/.test(before), 'incrementUsage must be wrapped in try {');
    ok(/catch\s*\{[^]*non-blocking/.test(after), 'failure must be caught (non-blocking)');
  });

  await test('projects:save — exactly one call site, after success, before 201, guarded', () => {
    const src = readSource('server/routes/v1/projects.ts');
    strictEqual(
      countOccurrences(src, "incrementUsage(req.user!.uid, 'projects:save')"),
      1,
      'projects:save must be incremented exactly once',
    );
    ok(
      src.includes("import { incrementUsage } from '../../services/featureService'"),
      'must reuse the existing featureService.incrementUsage',
    );
    const createIdx = src.indexOf('await createProject(');
    const incIdx = src.indexOf("incrementUsage(req.user!.uid, 'projects:save')");
    const resIdx = src.indexOf('res.status(201).json({ data: created })');
    ok(createIdx !== -1, 'repository create call found');
    ok(resIdx !== -1, '201 success response found');
    ok(incIdx > createIdx, 'increment must happen after the successful save');
    ok(incIdx < resIdx, 'increment must happen before the success response is sent');
    const after = src.slice(incIdx, incIdx + 240);
    ok(/catch\s*\{[^]*non-blocking/.test(after), 'failure must be caught (non-blocking)');
  });

  // ── 2. Client-side call sites: exactly once, at the real success point ────

  await test('devis:export_pdf — exactly one client tracking call at the PDF/print success point', () => {
    const src = readSource('src/components/DevisTab.tsx');
    strictEqual(
      countOccurrences(src, "trackFeatureUsage('devis:export_pdf')"),
      1,
      'devis:export_pdf must be tracked exactly once',
    );
    ok(
      src.includes("import { trackFeatureUsage } from '../utils/featureUsage'"),
      'must reuse the shared client tracking helper',
    );
    const writeIdx = src.indexOf('win.document.write(html)');
    const incIdx = src.indexOf("trackFeatureUsage('devis:export_pdf')");
    ok(writeIdx !== -1, 'print-window success point found');
    ok(incIdx > writeIdx, 'tracking must fire only after the print/PDF document was generated');
  });

  await test('catalogue:export — exactly one client tracking call at the catalogue CSV download success point', () => {
    const src = readSource('src/components/AdminDashboardModal.tsx');
    strictEqual(
      countOccurrences(src, "trackFeatureUsage('catalogue:export')"),
      1,
      'catalogue:export must be tracked exactly once',
    );
    ok(
      src.includes("import { trackFeatureUsage } from '../utils/featureUsage'"),
      'must reuse the shared client tracking helper',
    );
    const dlIdx = src.indexOf('URL.revokeObjectURL(url)');
    const incIdx = src.indexOf("trackFeatureUsage('catalogue:export')");
    ok(dlIdx !== -1, 'CSV download success point found');
    ok(incIdx > dlIdx, 'tracking must fire only after the catalogue CSV download completed');
  });

  // ── 3. Helper behavior: exactly one dispatch, failure never blocks ─────────

  await test('trackFeatureUsage — dispatches exactly ONE request per successful action', async () => {
    const { trackFeatureUsage } = await import('../src/utils/featureUsage');
    const originalFetch = globalThis.fetch;
    let calls = 0;
    let lastUrl = '';
    let lastBody = '';
    (globalThis as any).fetch = async (url: any, init: any) => {
      calls++;
      lastUrl = String(url);
      lastBody = String(init?.body ?? '');
      return { ok: true, status: 200 } as any;
    };
    try {
      trackFeatureUsage('devis:export_pdf');
      await new Promise((r) => setTimeout(r, 10));
      strictEqual(calls, 1, 'exactly one usage request per action');
      ok(lastUrl.includes('/features/usage'), `must target the features API surface (got ${lastUrl})`);
      ok(lastBody.includes('devis:export_pdf'), 'payload must identify the feature key');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await test('trackFeatureUsage — tracking failure NEVER blocks the action', async () => {
    const { trackFeatureUsage } = await import('../src/utils/featureUsage');
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => {
      throw new Error('network down');
    };
    try {
      let completed = false;
      const action = async () => {
        trackFeatureUsage('catalogue:export');
        completed = true;
        return 'export-finished';
      };
      const result = await action();
      strictEqual(result, 'export-finished', 'the action must complete normally');
      ok(completed, 'the action must not be blocked by tracking');
      await new Promise((r) => setTimeout(r, 10)); // let the rejected dispatch settle (must be swallowed)
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ── 4. Reuse existing system + P3 entitlement policy ───────────────────────

  await test('reuse — existing incrementUsage + single user_feature_usage table (no duplicate system)', () => {
    const svc = readSource('server/services/featureService.ts');
    ok(
      svc.includes('export async function incrementUsage(userId: string, featureKey: string)'),
      'must reuse the existing incrementUsage helper',
    );
    const schema = readSource('server/db/schema/features.ts');
    strictEqual(
      countOccurrences(schema, "pgTable('user_feature_usage'"),
      1,
      'user_feature_usage must remain the single usage table (no duplicate tracking system)',
    );
  });

  await test('P3 — entitlement enforcement is ON by default (free mode is opt-in only)', async () => {
    const svc = readSource('server/services/featureService.ts');
    ok(
      !/PHASE1_ALL_FEATURES_FREE\s*=\s*true/.test(svc),
      'featureService must NOT hardcode PHASE1_ALL_FEATURES_FREE = true (Phase 1 superseded by P3)',
    );
    const mod: any = await import('../server/services/featureService');
    strictEqual(mod.resolveAllFeaturesFree({}), false, 'no env flag → REAL plan/scope/usage enforcement');
    strictEqual(mod.resolveAllFeaturesFree({ ALL_FEATURES_FREE: '1' }), true, 'ALL_FEATURES_FREE=1 is an opt-in operator switch');
    strictEqual(mod.resolveAllFeaturesFree({ ALL_FEATURES_FREE: '0' }), false, "'0' keeps enforcement ON");
    strictEqual(mod.isEntitlementEnforcementEnabled(), true, 'P3 default: gating really applied');
  });

  // ── 5. Backend receiver: POST /api/v1/features/usage (Phase 1) ─────────────

  await test('receiver — POST /usage exists, authenticated, reuses featureService.incrementUsage', () => {
    const src = readSource('server/routes/v1/features.ts');
    ok(src.includes("router.post('/usage'"), 'POST /usage route must exist in the features router');
    ok(/router\.use\(authenticate\)/.test(src), 'router must be guarded by authenticate (401 when unauthenticated)');
    ok(src.includes('incrementUsage(req.user.uid, featureKey)'), 'must call the existing incrementUsage');
    ok(
      /incrementUsage,?\s*\}\s*from\s*'\.\.\/\.\.\/services\/featureService'/.test(src),
      'incrementUsage must be imported from featureService (reuse — no new tracking system)',
    );
  });

  await test('receiver — allowlist contains exactly the two Phase 1 client-side keys', () => {
    const src = readSource('server/routes/v1/features.ts');
    ok(src.includes("'devis:export_pdf'"), 'devis:export_pdf must be accepted');
    ok(src.includes("'catalogue:export'"), 'catalogue:export must be accepted');
  });

  await test('receiver — valid key: records via incrementUsage and answers 204 (no DB required to answer)', async () => {
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';
    const mod: any = await import('../server/routes/v1/features');
    const { trackUsageHandler, TRACKABLE_FEATURE_KEYS } = mod;
    ok(
      Array.isArray(TRACKABLE_FEATURE_KEYS)
        && TRACKABLE_FEATURE_KEYS.length === 2
        && TRACKABLE_FEATURE_KEYS.includes('devis:export_pdf')
        && TRACKABLE_FEATURE_KEYS.includes('catalogue:export'),
      'allowlist must contain exactly devis:export_pdf and catalogue:export',
    );
    let status = 0;
    let terminated = false;
    const res: any = {
      status(code: number) { status = code; return res; },
      send() { terminated = true; return res; },
      json() { terminated = true; return res; },
    };
    const req: any = { user: { uid: 'test-user-1', role: 'artisan' }, body: { featureKey: 'devis:export_pdf' } };
    let nextArg: any = null;
    await trackUsageHandler(req, res, (e: any) => { nextArg = e ?? 'next-called'; });
    ok(!nextArg, `valid request must not be rejected (got: ${nextArg})`);
    strictEqual(status, 204, 'valid key must answer 204 No Content');
    ok(terminated, 'response must be terminated');
  });

  await test('receiver — server-side/unknown keys (devis:create, projects:save, …) → 400, never recorded', async () => {
    const mod: any = await import('../server/routes/v1/features');
    const { trackUsageHandler } = mod;
    for (const key of ['devis:create', 'projects:save', 'unknown:key', '', '   ']) {
      let status = 0;
      let nextArg: any = null;
      const res: any = {
        status(code: number) { status = code; return res; },
        send() { return res; },
        json() { return res; },
      };
      await trackUsageHandler({ user: { uid: 'test-user-1' }, body: { featureKey: key } } as any, res, (e: any) => { nextArg = e; });
      strictEqual(status, 0, `invalid key '${key}' must not answer with a status`);
      ok(nextArg, `invalid key '${key}' must be rejected via next(error)`);
      ok(nextArg && nextArg.statusCode === 400, `invalid key '${key}' must map to 400`);
    }
  });

  await test('receiver — unauthenticated request → 401', async () => {
    const mod: any = await import('../server/routes/v1/features');
    const { trackUsageHandler } = mod;
    let status = 0;
    let nextArg: any = null;
    const res: any = {
      status(code: number) { status = code; return res; },
      send() { return res; },
      json() { return res; },
    };
    await trackUsageHandler({ user: undefined, body: { featureKey: 'devis:export_pdf' } } as any, res, (e: any) => { nextArg = e; });
    ok(nextArg, 'unauthenticated request must be rejected');
    ok(nextArg && nextArg.statusCode === 401, `unauthenticated request must map to 401 (got ${nextArg?.statusCode})`);
  });

  await test('receiver — no new table/system: user_feature_usage remains the single usage table', () => {
    const schema = readSource('server/db/schema/features.ts');
    strictEqual(
      countOccurrences(schema, "pgTable('user_feature_usage'"),
      1,
      'user_feature_usage must remain the single usage table (receiver must not add a new system)',
    );
  });

  // ── 6. Phase 2 — Admin Usage Analytics (aggregation + admin-only access) ───

  await test('analytics — admin-only route exists behind requireRole("admin") and reuses the aggregation', () => {
    const src = readSource('server/routes/v1/adminFeatures.ts');
    ok(/router\.use\(requireRole\('admin'\)\)/.test(src), 'admin router must be guarded by requireRole("admin")');
    ok(/router\.use\(authenticate\)/.test(src), 'admin router must be guarded by authenticate');
    ok(src.includes("router.get('/usage'"), 'GET /usage endpoint must exist');
    ok(/getFeatureUsageStats\(/.test(src), 'route must return the real aggregation (no hardcoded stats)');
    const svc = readSource('server/services/featureService.ts');
    ok(
      svc.includes('export async function getFeatureUsageStats(')
        && svc.includes('export function aggregateFeatureUsageRows('),
      'featureService must export the read-only aggregation',
    );
  });

  await test('analytics — aggregation: totalUsage per feature (all periods summed)', async () => {
    const svc: any = await import('../server/services/featureService');
    const rows = [
      { userId: 'u1', featureKey: 'a', usageCount: 3, periodStart: '2026-08-01' },
      { userId: 'u1', featureKey: 'a', usageCount: 7, periodStart: '2026-09-01' },
      { userId: 'u2', featureKey: 'a', usageCount: 2, periodStart: '2026-09-01' },
    ];
    const stats = svc.aggregateFeatureUsageRows(rows, '2026-09-01');
    strictEqual(stats.length, 1);
    strictEqual(stats[0].featureKey, 'a');
    strictEqual(stats[0].totalUsage, 12, 'total = sum across ALL periods');
  });

  await test('analytics — aggregation: unique users per feature', async () => {
    const svc: any = await import('../server/services/featureService');
    const rows = [
      { userId: 'u1', featureKey: 'a', usageCount: 3, periodStart: '2026-09-01' },
      { userId: 'u2', featureKey: 'a', usageCount: 2, periodStart: '2026-08-01' },
      { userId: 'u1', featureKey: 'b', usageCount: 1, periodStart: '2026-09-01' },
    ];
    const stats = svc.aggregateFeatureUsageRows(rows, '2026-09-01');
    const byKey = Object.fromEntries(stats.map((s: any) => [s.featureKey, s]));
    strictEqual(byKey.a.uniqueUsers, 2, 'a used by u1+u2');
    strictEqual(byKey.b.uniqueUsers, 1, 'b used by u1 only');
  });

  await test('analytics — aggregation: current month only counts the current period', async () => {
    const svc: any = await import('../server/services/featureService');
    const rows = [
      { userId: 'u1', featureKey: 'a', usageCount: 7, periodStart: '2026-08-01' },
      { userId: 'u1', featureKey: 'a', usageCount: 3, periodStart: '2026-09-01' },
    ];
    const stats = svc.aggregateFeatureUsageRows(rows, '2026-09-01');
    strictEqual(stats[0].currentMonthUsage, 3, 'only the current period counts');
    strictEqual(stats[0].totalUsage, 10, 'all periods still count for the total');
  });

  await test('analytics — aggregation: sorted by usage desc (top-used features first)', async () => {
    const svc: any = await import('../server/services/featureService');
    const rows = [
      { userId: 'u1', featureKey: 'small', usageCount: 1, periodStart: '2026-09-01' },
      { userId: 'u1', featureKey: 'big', usageCount: 9, periodStart: '2026-09-01' },
      { userId: 'u1', featureKey: 'mid', usageCount: 4, periodStart: '2026-09-01' },
    ];
    const stats = svc.aggregateFeatureUsageRows(rows, '2026-09-01');
    strictEqual(
      stats.map((s: any) => s.featureKey).join(','),
      'big,mid,small',
      'top-used features must come first',
    );
  });

  await test('analytics — empty data → empty stats (no sample data ever)', async () => {
    const svc: any = await import('../server/services/featureService');
    deepStrictEqual(svc.aggregateFeatureUsageRows([], '2026-09-01'), []);
  });

  await test('analytics — real data shape: getFeatureUsageStats returns consistent real-data stats', async () => {
    const svc: any = await import('../server/services/featureService');
    const stats = await svc.getFeatureUsageStats();
    const expectedPeriod = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    strictEqual(stats.periodStart, expectedPeriod, 'periodStart must be the current month');
    ok(Array.isArray(stats.features), 'features must be an array (real rows only)');
    ok(typeof stats.totalUsage === 'number' && stats.totalUsage >= 0);
    strictEqual(
      stats.totalUsage,
      stats.features.reduce((s: number, f: any) => s + f.totalUsage, 0),
      'totalUsage must equal the sum of per-feature totals',
    );
    for (const f of stats.features) {
      ok(typeof f.featureKey === 'string' && f.featureKey.length > 0);
      ok(Number.isInteger(f.totalUsage) && f.totalUsage >= 0);
      ok(Number.isInteger(f.uniqueUsers) && f.uniqueUsers >= 0);
      ok(Number.isInteger(f.currentMonthUsage) && f.currentMonthUsage >= 0);
      ok(f.uniqueUsers <= f.totalUsage || f.totalUsage === 0, 'uniqueUsers cannot exceed totalUsage');
    }
  });

  await test('analytics — authorization: requireRole("admin") — admin passes, artisan 403, anonymous 401', async () => {
    const auth: any = await import('../server/middleware/auth');
    const middleware = auth.requireRole('admin');
    let adminErr: any = 'unset';
    middleware({ user: { role: 'admin', uid: 'a1' } } as any, {} as any, (e: any) => { adminErr = e ?? 'next-called'; });
    ok(adminErr === 'next-called', 'admin must pass');
    let artisanErr: any = null;
    middleware({ user: { role: 'artisan', uid: 'u1' } } as any, {} as any, (e: any) => { artisanErr = e; });
    ok(artisanErr, 'non-admin must be rejected');
    ok(artisanErr && artisanErr.statusCode === 403, `non-admin must get 403 (got ${artisanErr?.statusCode})`);
    let anonErr: any = null;
    middleware({ user: undefined } as any, {} as any, (e: any) => { anonErr = e; });
    ok(anonErr, 'anonymous must be rejected');
    ok(anonErr && anonErr.statusCode === 401, `anonymous must get 401 (got ${anonErr?.statusCode})`);
  });

  // ── 7. Phase 3 — Usage Analytics: date range, series, roles, top users ─────

  await test('endpoint — ?from&to are validated by normalizeUsageRange before use', () => {
    const src = readSource('server/routes/v1/adminFeatures.ts');
    ok(src.includes('normalizeUsageRange('), 'route must validate the range');
    ok(/req\.query\.from/.test(src) && /req\.query\.to/.test(src), 'route must read ?from and ?to');
    ok(/req\.query\.topUsers/.test(src), 'route must read ?topUsers');
    ok(src.includes("router.use(requireRole('admin'))"), 'endpoint stays admin-only');
    ok(src.includes('getFeatureUsageStats({ ...range, includeTopUsers })'), 'validated range must be passed to the service');
  });

  await test('normalizeUsageRange — valid inputs are normalized (none / from / both / from === to)', async () => {
    const mod: any = await import('../server/routes/v1/adminFeatures');
    const { normalizeUsageRange } = mod;
    deepStrictEqual(normalizeUsageRange(), {});
    deepStrictEqual(normalizeUsageRange(undefined, undefined), {});
    deepStrictEqual(normalizeUsageRange(' 2026-09-01 '), { from: '2026-09-01' });
    deepStrictEqual(normalizeUsageRange('2026-09-01', '2026-09-30'), { from: '2026-09-01', to: '2026-09-30' });
    deepStrictEqual(normalizeUsageRange('2026-09-01', '2026-09-01'), { from: '2026-09-01', to: '2026-09-01' });
    deepStrictEqual(normalizeUsageRange(null, null), {});
  });

  await test('normalizeUsageRange — invalid format / impossible date / from > to → 400', async () => {
    const mod: any = await import('../server/routes/v1/adminFeatures');
    const { normalizeUsageRange } = mod;
    const bad: Array<[string, string | undefined]> = [
      ['2026/09/01', undefined],
      ['01-09-2026', undefined],
      ['abc', undefined],
      ['2026-13-01', undefined],
      ['2026-00-10', undefined],
      ['2026-02-30', undefined],
      ['2026-09-01', '2026-08-31'],
    ];
    for (const [from, to] of bad) {
      let err: any = null;
      try { normalizeUsageRange(from, to); } catch (e: any) { err = e; }
      ok(err, `expected 400 for from=${from} to=${to}`);
      ok(err && err.statusCode === 400, `from=${from} to=${to} must map to 400 (got ${err?.statusCode})`);
    }
  });

  await test('filterUsageRowsByRange — keeps only rows whose periodStart is inside [from, to]', async () => {
    const svc: any = await import('../server/services/featureService');
    const rows = [
      { userId: 'u1', featureKey: 'a', usageCount: 5, periodStart: '2026-08-01' },
      { userId: 'u1', featureKey: 'a', usageCount: 2, periodStart: '2026-09-01' },
      { userId: 'u2', featureKey: 'b', usageCount: 1, periodStart: '2026-10-01' },
    ];
    strictEqual(svc.filterUsageRowsByRange(rows, '2026-09-01', '2026-09-30').length, 1);
    strictEqual(svc.filterUsageRowsByRange(rows, '2026-08-01', '2026-09-30').length, 2);
    strictEqual(svc.filterUsageRowsByRange(rows, '2026-09-01').length, 2, 'open-ended from');
    strictEqual(svc.filterUsageRowsByRange(rows, undefined, '2026-08-31').length, 1, 'open-ended to');
    strictEqual(svc.filterUsageRowsByRange(rows).length, 3, 'no range → everything');
  });

  await test('buildUsagePeriodSeries — ascending per-period usage with active users', async () => {
    const svc: any = await import('../server/services/featureService');
    const rows = [
      { userId: 'u1', featureKey: 'a', usageCount: 3, periodStart: '2026-09-01' },
      { userId: 'u2', featureKey: 'a', usageCount: 2, periodStart: '2026-09-01' },
      { userId: 'u1', featureKey: 'b', usageCount: 4, periodStart: '2026-08-01' },
      { userId: 'u1', featureKey: 'a', usageCount: 1, periodStart: '2026-08-01' },
    ];
    const series = svc.buildUsagePeriodSeries(rows);
    strictEqual(series.length, 2);
    deepStrictEqual(series[0], { periodStart: '2026-08-01', totalUsage: 5, activeUsers: 1 });
    deepStrictEqual(series[1], { periodStart: '2026-09-01', totalUsage: 5, activeUsers: 2 });
    deepStrictEqual(svc.buildUsagePeriodSeries([]), []);
  });

  await test('aggregateUsageByRole — role breakdown via userId→role map, unknown bucket, sorted desc', async () => {
    const svc: any = await import('../server/services/featureService');
    const rows = [
      { userId: 'u1', featureKey: 'a', usageCount: 5, periodStart: '2026-09-01' },
      { userId: 'u2', featureKey: 'a', usageCount: 2, periodStart: '2026-09-01' },
      { userId: 'u1', featureKey: 'b', usageCount: 1, periodStart: '2026-09-01' },
      { userId: 'u3', featureKey: 'a', usageCount: 4, periodStart: '2026-09-01' },
    ];
    const roles = { u1: 'artisan', u2: 'engineer' }; // u3 deliberately missing
    const breakdown = svc.aggregateUsageByRole(rows, roles);
    const byRole = Object.fromEntries(breakdown.map((r: any) => [r.role, r]));
    strictEqual(breakdown.length, 3);
    strictEqual(byRole.artisan.totalUsage, 6);
    strictEqual(byRole.artisan.uniqueUsers, 1);
    strictEqual(byRole.engineer.totalUsage, 2);
    strictEqual(byRole.unknown.totalUsage, 4, 'missing role lands in the unknown bucket');
    strictEqual(
      breakdown[0].totalUsage >= breakdown[breakdown.length - 1].totalUsage,
      true,
      'sorted by usage desc',
    );
    deepStrictEqual(svc.aggregateUsageByRole([], {}), []);
  });

  await test('computeTopUsersPerFeature — top N per feature, usage desc with stable tie-break', async () => {
    const svc: any = await import('../server/services/featureService');
    const rows = [
      { userId: 'u1', featureKey: 'a', usageCount: 3, periodStart: '2026-09-01' },
      { userId: 'u2', featureKey: 'a', usageCount: 5, periodStart: '2026-09-01' },
      { userId: 'u3', featureKey: 'a', usageCount: 5, periodStart: '2026-09-01' },
      { userId: 'u4', featureKey: 'a', usageCount: 1, periodStart: '2026-09-01' },
      { userId: 'u1', featureKey: 'b', usageCount: 2, periodStart: '2026-09-01' },
    ];
    const top = svc.computeTopUsersPerFeature(rows, 2);
    deepStrictEqual(top.a, [
      { userId: 'u2', totalUsage: 5 },
      { userId: 'u3', totalUsage: 5 },
    ]);
    deepStrictEqual(top.b, [{ userId: 'u1', totalUsage: 2 }]);
    const top1 = svc.computeTopUsersPerFeature(rows, 1);
    strictEqual(top1.a.length, 1);
    strictEqual(top1.a[0].userId, 'u2');
  });

  await test('usageRangeToParams — presets map to correct local month bounds (UI helper)', async () => {
    const lib: any = await import('../src/lib/usageRange');
    const now = new Date(2026, 8, 15); // Sep 15, 2026 (local components)
    const thisMonth = lib.usageRangeToParams('this_month', now);
    strictEqual(thisMonth.from, '2026-09-01');
    strictEqual(thisMonth.to, '2026-09-30');
    const lastMonth = lib.usageRangeToParams('last_month', now);
    strictEqual(lastMonth.from, '2026-08-01');
    strictEqual(lastMonth.to, '2026-08-31');
    const all = lib.usageRangeToParams('all', now);
    strictEqual(all.from, undefined);
    strictEqual(all.to, undefined);
    ok(typeof thisMonth.labelFr === 'string' && thisMonth.labelFr.length > 0);
  });

  await test('Phase 3 — real data shape: range + series + roles + activeUsers stay consistent', async () => {
    const svc: any = await import('../server/services/featureService');
    const expectedPeriod = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const stats = await svc.getFeatureUsageStats({ from: expectedPeriod, to: expectedPeriod });
    strictEqual(stats.from, expectedPeriod, 'range must be echoed back');
    strictEqual(stats.to, expectedPeriod, 'range must be echoed back');
    ok(Array.isArray(stats.series) && Array.isArray(stats.roleBreakdown));
    strictEqual(
      stats.series.reduce((s: number, p: any) => s + p.totalUsage, 0),
      stats.totalUsage,
      'series totals must add up to the range total',
    );
    strictEqual(
      stats.roleBreakdown.reduce((s: number, r: any) => s + r.totalUsage, 0),
      stats.totalUsage,
      'role totals must add up to the range total (missing roles → unknown bucket)',
    );
    ok(Number.isInteger(stats.activeUsersInRange) && stats.activeUsersInRange >= 0);
    const withTop = await svc.getFeatureUsageStats({ includeTopUsers: true });
    for (const f of withTop.features) {
      if (f.topUsers) {
        ok(Array.isArray(f.topUsers) && f.topUsers.length <= 5, 'top users must be capped at 5');
        ok(
          f.topUsers.every((t: any, i: number, arr: any[]) => i === 0 || arr[i - 1].totalUsage >= t.totalUsage),
          'top users must be sorted by usage desc',
        );
      }
    }
  });

  console.log('\n═══════════════════════════════════════════');
  console.log(` RESULTS: ✅ ${passed} passed | ❌ ${failed} failed`);
  console.log('═══════════════════════════════════════════\n');

  if (failures.length > 0) {
    console.log('FAILED TESTS:');
    failures.forEach((f) => console.log(f));
    console.log('');
  }

  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('[KONSTRIVO] featureUsageAnalytics test crashed:', err);
  process.exitCode = 1;
});
