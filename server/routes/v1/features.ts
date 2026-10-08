/**
 * Phase 4 — Feature/Entitlement API (/api/v1/features)
 *
 * GET  /features      — current user's resolved plan + access for every
 *                       entitlement (FREE/PRO flags + usage limits/remaining).
 * GET  /features/:key — current user's access for one feature key.
 * POST /features/usage — Phase 1 Feature Usage Analytics receiver: records a
 *                       successful CLIENT-SIDE action (devis:export_pdf,
 *                       catalogue:export) via the existing incrementUsage
 *                       helper (user_feature_usage). Server-side actions
 *                       (devis:create, projects:save) are counted directly
 *                       by their own routes and are NOT accepted here.
 *
 * The plan is resolved SERVER-SIDE from the company subscription; users
 * without an active PRO company subscription resolve to FREE. It is never
 * read from the JWT (JWT payload stays unchanged).
 *
 * P3: `canAccess` is now REAL (plan/scope/usage gating) and this endpoint is
 * the SINGLE source the UI displays: `planCode` + `enforced` + the per-feature
 * access rows come from the very same resolvers access control uses
 * (getUserPlan / canAccessFeature / getCurrentUsage).
 */
import { Router, Response, NextFunction } from 'express';
import { authenticate, AuthenticatedRequest } from '../../middleware/auth';
import { unauthorized, notFound, badRequest } from '../../utils/errors';
import {
  getUserPlan,
  listEntitlements,
  canAccessFeature,
  getCurrentUsage,
  isEntitlementEnforcementEnabled,
  incrementUsage,
} from '../../services/featureService';
function mapAccess(ent: any, access: any, usageCount: number | null = null): any {
  const requiredPlan = (ent.freeAccess && ent.proAccess)
    ? 'free'
    : (ent.proAccess ? 'pro' : 'free');
  return {
    featureKey: access.featureKey,
    canAccess: access.canAccess,
    requiredPlan,
    usageLimit: access.usageLimit == null ? null : access.usageLimit,
    // P3: real consumed usage for the current monthly period (null = unlimited
    // or unknown), so the UI can display the same numbers the gate enforces.
    usageCount,
    usageRemaining: access.usageRemaining == null ? null : access.usageRemaining,
    // F15 (Phase 3 Batch 2) — ADDITIVE: the server's access `reason` so the UI
    // can show WHY a feature is locked (PRO_REQUIRED / SCOPE_MISMATCH /
    // USAGE_EXHAUSTED / PLAN_DENIED / FEATURE_DISABLED / unmanaged / …)
    // instead of always claiming "PRO uniquement". All previous fields and
    // the enforcement itself are unchanged.
    reason: access.reason == null ? null : access.reason,
  };
}
function mapAccessList(entitlements: any[], accessRows: any[], usageCounts: Array<number | null>): any[] {
  return accessRows.map((access, idx) => mapAccess(entitlements[idx], access, usageCounts[idx] ?? null));
}


const router = Router();
router.use(authenticate);

router.get('/', async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    if (!req.user) throw unauthorized();
    const uid = req.user.uid;
    const [planCode, entitlements] = await Promise.all([
      getUserPlan(uid),
      listEntitlements(),
    ]);
    const accessRows = await Promise.all(
      entitlements.map((e) => canAccessFeature(uid, e.featureKey, req.user!.role))
    );
    // Real usage only where a limit exists (unlimited features report null).
    const usageCounts = await Promise.all(
      entitlements.map((e) => (e.usageLimit == null ? Promise.resolve(null) : getCurrentUsage(uid, e.featureKey)))
    );
    const features = mapAccessList(entitlements, accessRows, usageCounts);
    res.json({
      data: {
        planCode,
        // Whether FREE/PRO gating is really applied (single source of truth =
        // server/service policy; the UI must not invent its own plan state).
        enforced: isEntitlementEnforcementEnabled(),
        features,
      },
    });
  } catch (err) { next(err); }
});

router.get('/:key', async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    if (!req.user) throw unauthorized();
    const key = String(req.params.key || '');
    if (!key) throw badRequest('feature key is required');
    // Unknown keys are a 404, never a crash.
    const entitlements = await listEntitlements();
    const ent = entitlements.find((e) => e.featureKey === key);
    if (!ent) {
      throw notFound(`Unknown feature '${key}'`);
    }
    const access = await canAccessFeature(req.user.uid, key, req.user.role);
    const usageCount = ent.usageLimit == null ? null : await getCurrentUsage(req.user.uid, key);
    res.json({ data: mapAccess(ent, access, usageCount) });
  } catch (err) { next(err); }
});
// ── POST /usage — Phase 1 Feature Usage Analytics receiver ─────────────────
// Records successful CLIENT-SIDE actions in the EXISTING user_feature_usage
// system via featureService.incrementUsage. No new table, no new system.
// Strict allowlist: only the two Phase 1 client-side actions. The server-side
// actions (devis:create, projects:save) are counted by their own routes and
// are explicitly rejected here so a single action can never be counted twice.
// incrementUsage never throws (DB failures are swallowed inside it), so this
// receiver answers fast and never becomes a load-bearing dependency.
export const TRACKABLE_FEATURE_KEYS: readonly string[] = [
  'devis:export_pdf',
  'catalogue:export',
];

export async function trackUsageHandler(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw unauthorized();
    const body = (req.body || {}) as { featureKey?: unknown };
    const featureKey = typeof body.featureKey === 'string' ? body.featureKey.trim() : '';
    if (!TRACKABLE_FEATURE_KEYS.includes(featureKey)) {
      throw badRequest(`featureKey must be one of: ${TRACKABLE_FEATURE_KEYS.join(', ')}`);
    }
    await incrementUsage(req.user.uid, featureKey);
    res.status(204).send();
  } catch (err) { next(err); }
}

router.post('/usage', trackUsageHandler);

export { router as featuresRouter };