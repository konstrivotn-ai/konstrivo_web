/**
 * Phase 2 + Phase 1.1 — Auth Routes (/api/v1/auth)
 *
 * POST /register  — create user + company + membership + token
 * POST /login     — verify credentials, return user + company + token
 * POST /refresh   — rotate access token from a valid refresh token
 */
import { Router, Response } from 'express';
import { userRepository } from '../../repositories/userRepository';
import { companyRepository, memberRepository } from '../../repositories/companyRepository';
import { subscriptionRepository, subscriptionRepositoryAsync } from '../../repositories/subscriptionRepository';
import { hashPassword, comparePassword, signJWT, verifyJWT, decodeJWT } from '../../utils/crypto';
import { computeEntitlements, ROLE_DEFAULT_TIER } from '../../utils/permissions';
import { authenticate, AuthenticatedRequest } from '../../middleware/auth';
import { validateBody, isValidEmail, isValidPassword } from '../../utils/validation';
import { passwordResetService } from '../../services/passwordResetService';
import { sendPasswordResetEmail } from '../../utils/email';
import {
  badRequest, unauthorized, conflict, forbidden, validationError,
} from '../../utils/errors';
import { User, Company, UserRole, UserTier } from '../../types';
import { config, getPublicAppUrl, isProduction } from '../../config';
import { setRefreshCookie, clearRefreshCookie, getCookie, REFRESH_COOKIE_NAME } from '../../utils/cookies';
import { createLimiter } from '../../middleware/rateLimit';
// Root cause of `GET /subscriptions/me` → 404: the default subscription has to
// land in the SAME repository that endpoint reads (Drizzle/PostgreSQL).
import { isDatabaseAvailable } from '../../db/client';

const router = Router();
const meRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────

/** Strip passwordHash before returning a user in API responses. */
function sanitizeUser(user: User): Omit<User, 'passwordHash'> {
  const { passwordHash, ...safe } = user;
  return safe;
}

function buildToken(user: User, companyId: string) {
  const tier = ROLE_DEFAULT_TIER[user.role] || 'FREE' as UserTier;
  const entitlements = computeEntitlements(user.role, tier);
  const token = signJWT(
    { uid: user.id, companyId, role: user.role, tier, entitlements },
    config.jwtSecret,
    config.jwtExpiresInSeconds,
  );
  const refreshToken = signJWT(
    { uid: user.id, companyId, role: user.role, tier, entitlements, typ: 'refresh' },
    config.jwtSecret,
    config.jwtRefreshExpiresInSeconds,
  );
  return { token, refreshToken };
}

// ── POST /register ────────────────────────────────────────────────────────

router.post('/register', createLimiter('register'), validateBody([
  { field: 'email', label: 'Email', required: true, type: 'string', max: 254 },
  { field: 'password', label: 'Password', required: true, type: 'string', min: 8, max: 128 },
  { field: 'fullName', label: 'Full name', required: true, type: 'string', min: 2, max: 200 },
]), async (req, res, next) => {
  try {
    const { email, password, fullName, phone, companyName } = req.body || {};

    if (!isValidEmail(email)) throw badRequest('Invalid email format');
    if (!isValidPassword(password)) throw badRequest('Password must be at least 8 characters');

    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await userRepository.findByEmail(normalizedEmail);
    if (existingUser) {
      throw conflict('An account with this email already exists');
    }

    const requestedRole = req.body?.role as UserRole;
    const publicRoles: UserRole[] = ['particulier', 'artisan', 'fournisseur', 'ingenieur', 'client', 'contractor', 'vendor', 'engineer'];
    
    // SECURITY FIX: Explicitly reject admin role in public registration
    if (requestedRole === 'admin') {
      throw validationError('Admin registration is not allowed. Contact system administrator.');
    }
    
    const role: UserRole = publicRoles.includes(requestedRole) ? requestedRole : 'artisan';
    const tier = ROLE_DEFAULT_TIER[role] || 'FREE' as UserTier;

    const passwordHash = await hashPassword(password);
    const user = await userRepository.create({
      email: normalizedEmail,
      passwordHash,
      fullName,
      phone: phone || '',
      role,
      tier,
      status: 'active',
    });

    const company = await companyRepository.create({
      legalName: companyName || fullName + "'s Company",
      tradeName: companyName || undefined,
      countryCode: 'TN',
      currencyCode: 'TND',
      status: 'active',
    });

    await memberRepository.create(user.id, company.id, role, tier, computeEntitlements(role, tier));

    // Phase 2 contract: every new company starts with a default subscription.
    // F5 (Phase 2 fix): the insert is now awaited and made deterministic.
    // Guarded: a subscription failure must neither roll back the just-created
    // account nor fail the request (getUserPlan falls back to FREE when no row
    // exists).
    //
    // READ/WRITE SOURCE — root cause of `GET /subscriptions/me` → 404:
    // that endpoint reads ONLY the Drizzle/PostgreSQL repository (Phase F source
    // of truth — the same one PaymentService.ensureProSubscription and the admin
    // plan tools write to). The default subscription must therefore be written
    // THERE whenever a database is actually connected. The old non-production
    // branch wrote to MemoryStore alone, so the row was invisible to the
    // endpoint and every freshly registered account 404'd on /subscriptions/me.
    try {
      if (await isDatabaseAvailable()) {
        await subscriptionRepositoryAsync.create(company.id, tier);
      }
    } catch {
      /* Non-fatal: without a row the account plan resolves FREE (default). */
    }

    // Legacy in-memory copy — UNCHANGED behaviour for the hybrid readers (e.g.
    // GET /users/me resolves the subscription from MemoryStore outside
    // production, where HybridSubscriptionRepository.create is allowed; it
    // throws in production, hence the guard).
    try {
      if (!(config.databaseUrl && config.isProduction)) {
        await subscriptionRepository.create(company.id, tier);
      }
    } catch {
      /* Non-fatal: without a row the account plan resolves FREE (default). */
    }

    const { token, refreshToken } = buildToken(user, company.id);
    setRefreshCookie(res, refreshToken);

    res.status(201).json({
      user: sanitizeUser(user),
      company,
      token,
      refreshToken,
    });
  } catch (err) { next(err); }
});

// ── POST /login ───────────────────────────────────────────────────────────

router.post('/login', createLimiter('login'), validateBody([
  { field: 'email', label: 'Email', required: true, type: 'string', max: 254 },
  { field: 'password', label: 'Password', required: true, type: 'string', min: 1, max: 128 },
]), async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const normalizedEmail = email.toLowerCase().trim();

    const user = await userRepository.findByEmail(normalizedEmail);
    if (!user) throw unauthorized('Invalid email or password');

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) throw unauthorized('Invalid email or password');

    if (user.status === 'suspended') throw forbidden('Account is suspended');

    const memberships = await memberRepository.findByUserId(user.id);
    const companyId = memberships[0]?.companyId || '';

    const { token, refreshToken } = buildToken(user, companyId);
    setRefreshCookie(res, refreshToken);

    res.json({
      user: sanitizeUser(user),
      company: companyId ? await companyRepository.findById(companyId) : null,
      token,
      refreshToken,
    });
  } catch (err) { next(err); }
});

// ── POST /refresh ─────────────────────────────────────────────────────────

router.post('/refresh', createLimiter('refresh'), async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let token = (authHeader && authHeader.startsWith('Bearer '))
      ? authHeader.substring(7)
      : req.body?.refreshToken;

    if (!token) {
      token = getCookie(req, REFRESH_COOKIE_NAME);
    }

    if (!token) throw unauthorized('Refresh token required');

    const claims = verifyJWT(token, config.jwtSecret);
    if (!claims) throw unauthorized('Invalid or expired refresh token');

    const user = await userRepository.findById(claims.uid);
    if (!user) throw unauthorized('User no longer exists');
    if (user.status === 'suspended') throw forbidden('Account is suspended');

    const memberships = await memberRepository.findByUserId(user.id);
    const companyId = claims.companyId || memberships[0]?.companyId || '';

    if (companyId) {
      const membership = await memberRepository.findMembership(user.id, companyId);
      if (!membership) throw forbidden('No active company membership');
    }

    const { token: newToken, refreshToken } = buildToken(user, companyId);
    setRefreshCookie(res, refreshToken);
    res.json({ token: newToken, refreshToken });
  } catch (err) { next(err); }
});

// ── POST /logout ────────────────────────────────────────────────────────────
router.post('/logout', (_req, res) => {
  clearRefreshCookie(res);
  res.json({ ok: true });
});

/**
 * Build a password-reset URL from the validated server-side `PUBLIC_APP_URL`.
 *
 * SECURITY:
 * - Only `getPublicAppUrl()` (server config) is used for the configured value.
 *   It is never read from any HTTP input (body/query/header/cookie) or from
 *   the frontend.
 * - In production `PUBLIC_APP_URL` is REQUIRED and must be an absolute http(s)
 *   URL with a non-loopback host. If it is missing, invalid, or loopback this
 *   returns `undefined`: the route then skips the email entirely while keeping
 *   the generic response — no config details ever reach the client. There is
 *   NO localhost fallback in production.
 * - In development/test an unset value may fall back to the local dev URL, but
 *   a set-but-invalid value still disables the email (no invalid link sent).
 * - The raw token only ever appears inside this returned URL (and in the email
 *   built from it). It is never logged and never returned in JSON or error
 *   responses.
 */
function buildResetUrl(token: string): string | undefined {
  const isProd = isProduction();
  const configPublicUrl = getPublicAppUrl();
  const base = isProd
    ? configPublicUrl
    : (process.env.PUBLIC_APP_URL ? configPublicUrl : 'http://localhost:5173');
  if (!base) return undefined;

  try {
    const u = new URL(base);
    if (!['http:', 'https:'].includes(u.protocol)) return undefined;
    if (!u.hostname) return undefined;

    if (isProd) {
      // Never emit localhost/loopback reset links in production.
      if (u.hostname === 'localhost' || u.hostname === '0.0.0.0' || u.hostname === '::1' || /^127\./.test(u.hostname)) {
        return undefined;
      }
    }

    return `${base}/reset-password?token=${encodeURIComponent(token)}`;
  } catch {
    return undefined;
  }
}

// ── POST /forgot ───────────────────────────────────────────────────────────
router.post('/forgot', createLimiter('login'), validateBody([
  { field: 'email', label: 'Email', required: true, type: 'string', max: 254 },
]), async (req, res, next) => {
  try {
    const { email } = req.body || {};
    if (!isValidEmail(email)) throw validationError('Invalid email');
    const normalized = email.toLowerCase().trim();

    // Request a reset token. The raw token is returned to THIS server-side
    // caller only (never to HTTP clients) so the reset URL can be built and
    // emailed. The `returnRawTokenToCaller` flag is hard-coded in server code;
    // it is NOT read from the request body, query, headers, cookies, frontend,
    // or any user-controlled environment variable, so HTTP clients can never
    // trigger or disable raw-token exposure.
    const maybe = await passwordResetService.requestPasswordReset(normalized, { returnRawTokenToCaller: true }) as any;

    // Only email the user if the account exists and we have a raw token. The
    // reset URL is built from a validated server-side `PUBLIC_APP_URL`; if that
    // is unavailable (e.g. unset/invalid in production) we silently skip the
    // email while preserving the generic response.
    const user = await userRepository.findByEmail(normalized);
    if (user && maybe && maybe.token) {
      const resetUrl = buildResetUrl(maybe.token);
      // Never log the raw token or the reset URL. Delivery errors are swallowed
      // so the response stays generic and account existence is not revealed.
      if (resetUrl) {
        try { await sendPasswordResetEmail(user.email, resetUrl); } catch { /* swallow */ }
      }
    }

    res.json({ ok: true, message: 'Si cette adresse existe, un lien de réinitialisation sera envoyé.' });
  } catch (err) { next(err); }
});

// ── POST /reset ────────────────────────────────────────────────────────────
router.post('/reset', createLimiter('login'), validateBody([
  { field: 'token', label: 'Token', required: true, type: 'string', min: 1 },
  { field: 'password', label: 'Password', required: true, type: 'string', min: 8 },
]), async (req, res, next) => {
  try {
    const { token, password } = req.body || {};
    if (!token || typeof token !== 'string' || !password || !isValidPassword(password)) {
      throw validationError('Invalid input');
    }

    try {
      await passwordResetService.resetPassword(token, password);
      res.json({ ok: true, message: 'Mot de passe réinitialisé avec succès.' });
    } catch (err: any) {
      // Do not leak details about why the token failed
      return next(badRequest('Le lien de réinitialisation est invalide ou a expiré.'));
    }
  } catch (err) { next(err); }
});

// ── GET /users/me ─────────────────────────────────────────────────────────

meRouter.get('/me', authenticate, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const user = await userRepository.findById(req.user!.uid);
    if (!user) throw unauthorized('User not found');

    const memberships = await memberRepository.findByUserId(user.id);
    const primaryCompanyId = req.user!.companyId || memberships[0]?.companyId || '';
    const company = primaryCompanyId ? await companyRepository.findById(primaryCompanyId) : undefined;
    const subscription = primaryCompanyId ? subscriptionRepository.findByCompanyId(primaryCompanyId) : undefined;

    res.json({
      user: sanitizeUser(user),
      company: company || null,
      subscription: subscription || null,
      entitlements: req.user!.entitlements,
    });
  } catch (err) { next(err); }
});

export { router as authRouter, meRouter };
