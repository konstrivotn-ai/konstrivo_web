import { Router, Response } from 'express';
import { authenticate, requireEntitlement, requireRole, AuthenticatedRequest } from '../../middleware/auth';
import { listPriceReviewQueue, reviewPendingPriceUpdate, rejectPriceUpdate, publishPriceUpdate, approvePendingPriceUpdate } from '../../repositories/drizzlePriceRepository';
import { badRequest } from '../../utils/errors';

const router = Router();

// Require admin entitlement for all review actions
const requireAdmin = [authenticate, requireEntitlement('CATALOG_OFFICIAL_MANAGE')];

// F17 (Phase 3 Batch 2) — ADMIN WRITE routes add the role second factor,
// mirroring the trades.ts guard: authenticate + requireEntitlement
// ('CATALOG_OFFICIAL_MANAGE') + requireRole('admin'). The read-only GET
// /review route above is intentionally unchanged.
const requireAdminWrite = [
  authenticate,
  requireEntitlement('CATALOG_OFFICIAL_MANAGE'),
  requireRole('admin'),
];

// Phase 3B — review-queue states. The default preserves the previous behaviour
// of this endpoint (it used to always return PENDING rows).
const REVIEW_STATUSES = ['pending', 'reviewed', 'published', 'rejected'] as const;
type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Query normalisation: missing/empty → 'pending'; unknown value → 400. */
function resolveReviewStatus(raw: unknown): ReviewStatus {
  if (raw === undefined || raw === null || raw === '') return 'pending';
  const value = String(raw).trim().toLowerCase();
  if (value === '') return 'pending';
  if (!(REVIEW_STATUSES as readonly string[]).includes(value)) {
    throw badRequest(`Invalid status '${String(raw)}'. Allowed values: ${REVIEW_STATUSES.join(', ')}`);
  }
  return value as ReviewStatus;
}

/** Express query values can be string | string[] | undefined — keep only strings. */
function asOptionalString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw !== '' ? raw : undefined;
}

// GET /admin/prices/review?status=&countryCode=&currencyCode=
// Returns the repository payload as-is: { data: [...], total: N }
router.get('/review', requireAdmin, async (req: AuthenticatedRequest, res: Response, next: any) => {
  try {
    const { status, countryCode, currencyCode } = req.query as any;
    const queue = await listPriceReviewQueue({
      status: resolveReviewStatus(status),
      countryCode: asOptionalString(countryCode),
      currencyCode: asOptionalString(currencyCode),
    });
    res.json(queue);
  } catch (err) { next(err); }
});

router.post('/review/:id/review', ...requireAdminWrite, async (req: AuthenticatedRequest, res: Response, next: any) => {
  try {
    const id = req.params.id;
    const actor = req.user?.uid;
    const row = await reviewPendingPriceUpdate(id, actor);
    res.json({ data: row });
  } catch (err) { next(err); }
});

router.post('/review/:id/reject', ...requireAdminWrite, async (req: AuthenticatedRequest, res: Response, next: any) => {
  try {
    const id = req.params.id;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : 'Rejected by admin';
    const actor = req.user?.uid;
    const row = await rejectPriceUpdate(id, reason, actor);
    res.json({ data: row });
  } catch (err) { next(err); }
});

router.post('/review/:id/publish', ...requireAdminWrite, async (req: AuthenticatedRequest, res: Response, next: any) => {
  try {
    const id = req.params.id;
    const actor = req.user?.uid;
    const row = await publishPriceUpdate(id, actor);
    res.json({ data: row });
  } catch (err) { next(err); }
});

router.post('/review/:id/approve', ...requireAdminWrite, async (req: AuthenticatedRequest, res: Response, next: any) => {
  try {
    const id = req.params.id;
    const actor = req.user?.uid;
    const row = await approvePendingPriceUpdate(id, actor);
    res.json({ data: row });
  } catch (err) { next(err); }
});

export { router as priceReviewRouter };
