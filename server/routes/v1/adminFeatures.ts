/**
 * Phase 4 — Admin Feature/Entitlement API (/api/v1/admin/features)
 *
 * Admin-only (role 'admin' via existing `requireRole` — additive, no RBAC
 * change). Gives the Admin independent control over FREE/PRO access and
 * usage limits per feature key (not a single `required_plan` column).
 *
 * GET    /admin/features        — list all entitlements
 * GET    /admin/features/usage  — Phase 2/3 usage analytics (?from&to&topUsers, read-only)
 * POST   /admin/features        — create/update an entitlement
 * DELETE /admin/features/:key   — soft-deactivate an entitlement
 */
import { Router, Response } from 'express';
import { authenticate, requireRole, AuthenticatedRequest } from '../../middleware/auth';
import {
  listEntitlements,
  upsertEntitlement,
  deactivateEntitlement,
  getFeatureUsageStats,
  FeatureEntitlement,
} from '../../services/featureService';
import { badRequest } from '../../utils/errors';

const router = Router();
router.use(authenticate);
router.use(requireRole('admin'));

router.get('/', async (_req, res: Response, next) => {
  try {
    res.json({ data: await listEntitlements() });
  } catch (err) { next(err); }
});

// ── Phase 2/3 — Admin Usage Analytics (read-only; real DB data only) ───────
const USAGE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate optional ?from/?to (YYYY-MM-DD). Invalid format, impossible
 * calendar date, or from > to → 400 (ApiError). Absent values are allowed.
 */
export function normalizeUsageRange(
  from?: string | null,
  to?: string | null
): { from?: string; to?: string } {
  const clean = (v?: string | null) => (typeof v === 'string' ? v.trim() : '');
  const f = clean(from);
  const t = clean(to);
  const check = (value: string, name: string) => {
    if (!USAGE_DATE_RE.test(value)) {
      throw badRequest(`${name} must be a date in YYYY-MM-DD format`);
    }
    const [y, m, d] = value.split('-').map(Number);
    const asDate = new Date(y, m - 1, d);
    if (asDate.getFullYear() !== y || asDate.getMonth() !== m - 1 || asDate.getDate() !== d) {
      throw badRequest(`${name} is not a real calendar date`);
    }
  };
  if (f) check(f, 'from');
  if (t) check(t, 'to');
  if (f && t && f > t) throw badRequest('from must be less than or equal to to');
  const out: { from?: string; to?: string } = {};
  if (f) out.from = f;
  if (t) out.to = t;
  return out;
}

router.get('/usage', async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const range = normalizeUsageRange(
      req.query.from as string | undefined,
      req.query.to as string | undefined
    );
    const includeTopUsers = req.query.topUsers === '1' || req.query.topUsers === 'true';
    res.json({
      data: await getFeatureUsageStats({ ...range, includeTopUsers }),
    });
  } catch (err) { next(err); }
});

// ── F13 (Phase 3 Batch 2) — server-side validation of POST /admin/features ──
// Mirrors the existing CLIENT rules (src/lib/adminFeatures.ts —
// buildUpsertPayload / buildFeatureCreatePayload): feature key format and
// varchar(100) length, scope ∈ the supported scopes (server/db/schema/
// features.ts), usageLimit = null (unlimited) or a non-negative integer,
// REAL booleans (never Boolean('false')), labels within varchar(200).
// Invalid payloads → 400 through the existing ApiError style (badRequest).
// Authorization is unchanged (router-level authenticate + requireRole('admin'))
// and Batch 1's partial-upsert semantics in featureService.upsertEntitlement
// are preserved: an ABSENT field (undefined) never clobbers the stored row,
// while an explicit null is honored on the nullable columns (labels,
// usageLimit).
const FEATURE_KEY_MAX_LENGTH = 100; // varchar(100) — feature_key
const FEATURE_LABEL_MAX_LENGTH = 200; // varchar(200) — label_fr / label_ar / label_derja
const FEATURE_KEY_PATTERN = /^[a-z0-9][a-z0-9:._-]*$/; // client pattern (after trim + lowercase)
/** Role scoping supported by the schema (server/db/schema/features.ts). */
const SUPPORTED_SCOPES = ['all', 'client', 'artisan', 'supplier', 'engineer'] as const;

/** Trim + lowercase — mirrors normalizeFeatureKey in src/lib/adminFeatures.ts. */
function normalizeFeatureKey(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

/** Labels: nullable varchar(200) — a string within the limit, or explicit null. */
function normalizeLabel(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw badRequest(`${field} must be a string or null`);
  if (value.length > FEATURE_LABEL_MAX_LENGTH) {
    throw badRequest(`${field} must be at most ${FEATURE_LABEL_MAX_LENGTH} characters`);
  }
  return value;
}

/** Booleans MUST be real booleans — Boolean('false') must never become true. */
function normalizeBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw badRequest(`${field} must be a boolean`);
  return value;
}

/** usageLimit: null = unlimited, otherwise a non-negative integer (DB integer column). */
function normalizeUsageLimit(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw badRequest('usageLimit must be null (unlimited) or a non-negative integer');
  }
  return value;
}

router.post('/', async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;

    // featureKey — required, ≤ varchar(100), client key format.
    const featureKey = normalizeFeatureKey(body.featureKey);
    if (!featureKey) throw badRequest('featureKey is required');
    if (featureKey.length > FEATURE_KEY_MAX_LENGTH) {
      throw badRequest(`featureKey must be at most ${FEATURE_KEY_MAX_LENGTH} characters`);
    }
    if (!FEATURE_KEY_PATTERN.test(featureKey)) {
      throw badRequest("featureKey is invalid: allowed characters are lowercase letters, digits, ':', '_', '-', '.' (e.g. devis:export_pdf)");
    }

    // Absent (undefined) fields are NEVER handed to the service (Batch 1: they
    // must not clobber stored values). Explicit nulls are kept for nullable
    // columns (labels, usageLimit). `scope` is NOT NULL, so null = absent.
    const ent: Partial<FeatureEntitlement> & { featureKey: string } = { featureKey };
    if (body.labelFr !== undefined) ent.labelFr = normalizeLabel(body.labelFr, 'labelFr');
    if (body.labelAr !== undefined) ent.labelAr = normalizeLabel(body.labelAr, 'labelAr');
    if (body.labelDerja !== undefined) ent.labelDerja = normalizeLabel(body.labelDerja, 'labelDerja');
    if (body.freeAccess !== undefined && body.freeAccess !== null) {
      ent.freeAccess = normalizeBoolean(body.freeAccess, 'freeAccess');
    }
    if (body.proAccess !== undefined && body.proAccess !== null) {
      ent.proAccess = normalizeBoolean(body.proAccess, 'proAccess');
    }
    if (body.isActive !== undefined && body.isActive !== null) {
      ent.isActive = normalizeBoolean(body.isActive, 'isActive');
    }
    if (body.usageLimit !== undefined) ent.usageLimit = normalizeUsageLimit(body.usageLimit);
    if (body.scope !== undefined && body.scope !== null) {
      const scope = String(body.scope);
      if (!(SUPPORTED_SCOPES as readonly string[]).includes(scope)) {
        throw badRequest(`scope must be one of: ${SUPPORTED_SCOPES.join(', ')}`);
      }
      ent.scope = scope;
    }

    const saved = await upsertEntitlement(ent);
    res.status(201).json({ data: saved });
  } catch (err) { next(err); }
});

router.delete('/:key', async (req, res: Response, next) => {
  try {
    const key = String(req.params.key || '');
    if (!key) throw badRequest('feature key is required');
    await deactivateEntitlement(key);
    res.status(204).send();
  } catch (err) { next(err); }
});

export { router as adminFeaturesRouter };