/**
 * Phase 2 — Authentication & Authorization Middleware
 *
 * - authenticate: verifies JWT, attaches claims to req.user
 * - requireRole: checks user role
 * - requirePermission: checks user permission
 * - requireEntitlement: checks user entitlement
 *
 * NEVER trust frontend role/tier/permission values.
 * The JWT is the server-signed source of truth.
 */
import { Request, Response, NextFunction } from 'express';
import { verifyJWT, JwtPayload } from '../utils/crypto';
import { config } from '../config';
import { JwtClaims, Entitlement, Permission, UserRole } from '../types';
import {
  hasRole,
  hasEntitlement,
  hasPermission,
  computePermissions,
  computeEntitlements,
  TIER_ENTITLEMENTS,
} from '../utils/permissions';
import { unauthorized, forbidden } from '../utils/errors';
import { getUserPlan } from '../services/featureService';

// ── Express Request augmentation ────────────────────────────────────────────

export interface AuthenticatedRequest extends Request {
  user?: JwtClaims;
}

/**
 * authenticate — verifies the JWT from the Authorization header.
 * Attaches the decoded claims to req.user.
 * Optional: fails with 401 if no/invalid token.
 */
export function authenticate(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(unauthorized('Authorization header missing or invalid'));
  }

  const token = authHeader.substring(7);
  const claims = verifyJWT(token, config.jwtSecret) as JwtClaims | null;

  if (!claims) {
    return next(unauthorized('Invalid or expired token'));
  }

  // Ensure entitlements are always present (in case of legacy tokens)
  if (!claims.entitlements || claims.entitlements.length === 0) {
    claims.entitlements = computeEntitlements(claims.role, claims.tier);
  }

  req.user = claims;
  next();
}

/**
 * Optional authenticate — attaches user if token is present, but does NOT fail.
 * For endpoints that work for both authenticated and anonymous users.
 */
export function optionalAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const claims = verifyJWT(token, config.jwtSecret) as JwtClaims | null;
    if (claims) {
      if (!claims.entitlements || claims.entitlements.length === 0) {
        claims.entitlements = computeEntitlements(claims.role, claims.tier);
      }
      req.user = claims;
    }
  }
  next();
}

/**
 * requireRole — fails with 403 if the user doesn't have the required role.
 * Admin always passes.
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(unauthorized());
    }
    if (!hasRole(req.user.role, allowedRoles)) {
      return next(forbidden(`Role '${req.user.role}' is not authorized for this action`));
    }
    next();
  };
}

/**
 * requirePermission — fails with 403 if the user lacks the permission.
 */
export function requirePermission(...requiredPerms: Permission[]) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(unauthorized());
    }
    const perms = computePermissions(req.user.entitlements || []);
    for (const perm of requiredPerms) {
      if (!hasPermission(perms, perm)) {
        return next(forbidden(`Missing permission: ${perm}`));
      }
    }
    next();
  };
}

/**
 * requireEntitlement — fails with 403 if the user lacks the entitlement.
 *
 * Phase 2 fix (F2 — plan bridge): the JWT `tier` is ALWAYS the role default
 * (FREE) — `buildToken` never consults the subscription and tokens are not
 * re-issued after a verified payment — so entitlements embedded in the token
 * can be stale for paying subscribers. Before denying, this middleware
 * resolves the user's plan server-side via the SAME resolver the feature gate
 * uses (`getUserPlan` → single plan rule `planCodeFromSubscription`) and, for
 * an active PRO plan, additionally accepts TIER_ENTITLEMENTS.PRO (which never
 * contains ENTERPRISE-only entitlements such as CATALOG_OFFICIAL_MANAGE).
 *
 * Guarantees:
 *  - JWT is never modified or trusted differently — it stays the first source.
 *  - Plan lookup happens LAZILY (only when the JWT does not already grant).
 *  - Admin bypass is unchanged and never triggers a plan lookup.
 *  - Fail-closed: if the plan cannot be resolved, the check denies (403)
 *    exactly as before — an error can never grant access.
 */
export function requireEntitlement(...requiredEntitlements: Entitlement[]) {
  return async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        return next(unauthorized());
      }
      const userEnts = req.user.entitlements || [];
      // Admin always has all entitlements
      if (req.user.role === 'admin') return next();

      let planEnts: Entitlement[] | null = null;
      for (const ent of requiredEntitlements) {
        if (hasEntitlement(userEnts, ent)) continue;
        // Lazy plan resolution — only reached when the JWT is insufficient.
        if (planEnts === null) {
          const plan = await getUserPlan(req.user.uid);
          planEnts = plan === 'pro' ? TIER_ENTITLEMENTS.PRO : [];
        }
        if (hasEntitlement(planEnts, ent)) continue;
        return next(forbidden(`Missing entitlement: ${ent}`));
      }
      next();
    } catch {
      // Fail closed: an unresolved plan must never grant access.
      return next(forbidden('Entitlement check failed'));
    }
  };
}

/**
 * getCompanyId — returns the authenticated user's companyId.
 * Throws if not authenticated.
 */
export function requireCompanyId(req: AuthenticatedRequest): string {
  if (!req.user) throw unauthorized();
  if (!req.user.companyId) throw forbidden('User has no company membership');
  return req.user.companyId;
}
