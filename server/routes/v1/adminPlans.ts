/**
 * P3 — Admin Plans API (/api/v1/admin/plans)
 *
 * Admin-only (role 'admin' via the existing `requireRole` — additive, no RBAC
 * change). Lets an administrator READ and GRANT the FREE/PRO plan of a company
 * (or of a user's company) so "Plans" become a managed dimension next to
 * Features, Roles (feature `scope`) and usage limits.
 *
 *   GET  /admin/plans?userId=|email=|companyId=  — resolve the current plan
 *   POST /admin/plans { plan: 'free'|'pro', userId?|email?|companyId? }
 *
 * No schema change: the plan is the EXISTING `subscriptions` row, written via
 * `subscriptionRepositoryAsync` — the same repository the Flouci payment
 * webhook/PRO verification writes to. Payment, webhooks and PRO verification
 * are untouched (they still grant PRO on a verified settlement).
 */
import { Router, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth';
import { badRequest } from '../../utils/errors';
import {
  parsePlanTarget,
  normalizePlanCode,
  resolveTargetPlan,
  resolvePlanCompanyId,
  setCompanyPlan,
  getCompanyPlan,
} from '../../services/planAdminService';
import { getUserPlan, isEntitlementEnforcementEnabled } from '../../services/featureService';
import { subscriptionRepositoryAsync } from '../../repositories/subscriptionRepository';

const router = Router();
router.use(authenticate);
router.use(requireRole('admin'));

router.get('/', async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const target = parsePlanTarget({
      userId: req.query.userId,
      email: req.query.email,
      companyId: req.query.companyId,
    });
    const view = await resolveTargetPlan(target);
    res.json({ data: view });
  } catch (err) { next(err); }
});

router.post('/', async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const requestedPlan = normalizePlanCode(body.plan);
    if (!requestedPlan) throw badRequest("plan must be 'free' or 'pro'");
    const target = parsePlanTarget(body);
    const companyId = await resolvePlanCompanyId(target);
    const applied = await setCompanyPlan(companyId, requestedPlan);
    // Report the plan through the SAME resolver access control uses, so the
    // admin sees exactly what the gate will enforce (user target → getUserPlan).
    let planCode = applied.planCode;
    if (target.userId) planCode = await getUserPlan(target.userId);
    res.json({
      data: {
        planCode,
        enforced: isEntitlementEnforcementEnabled(),
        companyId,
        subscription: applied.subscription,
        requestedPlan,
        resolvedFrom: target.userId ? 'user_plan' : 'company_subscription',
      },
    });
  } catch (err) { next(err); }
});

export { router as adminPlansRouter };

// Light re-exports kept local for the route tests (read-only helpers).
export {
  getCompanyPlan,
  subscriptionRepositoryAsync,
  isEntitlementEnforcementEnabled,
};
