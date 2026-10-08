/**
 * Phase 4 — Plan-based Feature Enforcement middleware.
 *
 * ADDITIVE: complements the existing role/tier `requireEntitlement` in
 * `middleware/auth.ts`. Effective access = Role/Entitlement (existing RBAC)
 * AND Plan/Feature (this middleware). Neither system modifies the other.
 *
 * Plan resolution is server-side and company-first:
 *   - user belongs to a company with an active PRO subscription → PRO
 *   - otherwise → FREE (users without a company are always FREE)
 *
 * - Admins always pass (mirrors `requireEntitlement`).
 * - When the database is unavailable, `featureService` falls back to the
 *   DEFAULT entitlements with a FREE plan so existing functionality is
 *   never blocked by a transient DB outage (fail-open for FREE features).
 */
import { NextFunction, Response } from 'express';
import { AuthenticatedRequest } from './auth';
import { unauthorized, forbidden } from '../utils/errors';
import { canAccessFeature } from '../services/featureService';

export function requireFeature(featureKey: string) {
  return async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) return next(unauthorized());

      // Admin always has access — mirrors requireEntitlement behavior.
      if (req.user.role === 'admin') return next();

      const access = await canAccessFeature(req.user.uid, featureKey, req.user.role);
      if (!access.canAccess) {
        let message = 'This feature requires a PRO subscription';
        if (access.reason === 'USAGE_EXHAUSTED') {
          message = 'Monthly usage limit reached for this feature';
        } else if (access.reason === 'SCOPE_MISMATCH') {
          message = 'This feature is not available for your role';
        } else if (access.reason === 'FEATURE_DISABLED') {
          // F11: a deactivated feature must not masquerade as a PRO paywall.
          message = 'This feature has been disabled by an administrator';
        }
        return next(forbidden(message));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}