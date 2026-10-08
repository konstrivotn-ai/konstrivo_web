/**
 * Phase 2 + Phase F — Subscription Routes (/api/v1/subscriptions)
 *
 * GET /me — current subscription and calculated entitlements.
 *
 * Phase F: reads the SAME PostgreSQL/Drizzle repository the payment service
 * writes to (`subscriptionRepositoryAsync` → drizzleSubscriptionsRepository),
 * NEVER the MemoryStore/Hybrid repository, so a paid PRO upgrade is reflected
 * on this endpoint. Response shape is unchanged.
 */
import { Router, Response } from 'express';
import { subscriptionRepositoryAsync } from '../../repositories/subscriptionRepository';
import { memberRepository } from '../../repositories/companyRepository';
import { authenticate, AuthenticatedRequest } from '../../middleware/auth';
import { notFound } from '../../utils/errors';
import { computeEntitlements } from '../../utils/permissions';
// P3 — the plan code below comes from the SAME resolver access control uses
// (getUserPlan → company subscription), so this endpoint can never advertise a
// different FREE/PRO than the feature gate enforces.
import { getUserPlan, isEntitlementEnforcementEnabled } from '../../services/featureService';

const router = Router();

router.get('/me',
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const memberships = memberRepository.findByUserId(req.user!.uid);
      const primaryCompanyId = req.user!.companyId || memberships[0]?.companyId || '';
      if (!primaryCompanyId) throw notFound('No active company membership');

      // Source of truth = PostgreSQL (same as PaymentService.ensureProSubscription).
      const subscription = await subscriptionRepositoryAsync.findByCompanyId(primaryCompanyId);
      if (!subscription) throw notFound('No subscription found for this company');

      // Calculate entitlements server-side
      const entitlements = computeEntitlements(req.user!.role, req.user!.tier);
      // P3 — single plan source (same resolver as canAccessFeature).
      const planCode = await getUserPlan(req.user!.uid);

      res.json({
        data: {
          subscription,
          tier: req.user!.tier,
          // P3 — authoritative FREE/PRO status (never re-derived in the UI).
          planCode,
          enforced: isEntitlementEnforcementEnabled(),
          status: subscription.status,
          entitlements,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        },
        note: 'Payment gateway integration is out of scope for Phase 2.',
      });
    } catch (err) { next(err); }
  }
);

export { router as subscriptionsRouter };
