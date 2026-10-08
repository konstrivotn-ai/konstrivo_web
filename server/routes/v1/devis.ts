/**
 * Phase 2 — Devis Routes (/api/v1/devis)
 *
 * GET    /devis      — paginated company-scoped list
 * POST   /devis      — create (requires DEVIS_CREATE_BASIC; idempotency via Idempotency-Key)
 * GET    /devis/:id  — read (company isolation enforced)
 * PUT    /devis/:id  — update (optimistic version check → 409 on conflict)
 * DELETE /devis/:id  — soft delete only
 */
import { Router, Response } from 'express';
import { devisRepository } from '../../repositories/devisRepository';
import {
  authenticate, requireEntitlement, AuthenticatedRequest,
} from '../../middleware/auth';
import { validateBody, parseIntParam } from '../../utils/validation';
import { requireFeature } from '../../middleware/features';
import { notFound, forbidden, conflict, badRequest } from '../../utils/errors';
import { DevisStatus } from '../../types';
// Phase 1 Feature Usage Analytics — reuse the existing per-user usage counter.
import { incrementUsage } from '../../services/featureService';

const router = Router();
router.use(authenticate);

// ── Helpers ───────────────────────────────────────────────────────────────

function requireCompany(req: AuthenticatedRequest): string {
  const companyId = req.user?.companyId;
  if (!companyId) throw forbidden('No active company membership');
  return companyId;
}

function assertOwnership(req: AuthenticatedRequest, devisCompanyId: string) {
  const userCompanyId = req.user!.companyId;
  if (req.user!.role === 'admin') return; // admins may access across companies
  if (!userCompanyId || devisCompanyId !== userCompanyId) {
    throw forbidden('You do not have access to this devis');
  }
}

const IDEMPOTENCY_HEADER = 'idempotency-key';

// ── GET / ─────────────────────────────────────────────────────────────────

router.get('/', async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const companyId = requireCompany(req);
    const result = await (devisRepository as any).list({
      companyId,
      status: req.query.status as string | undefined,
      search: req.query.search as string | undefined,
      page: parseIntParam(req.query.page, 1),
      limit: parseIntParam(req.query.limit, 20),
    });
    res.json(result);
  } catch (err) { next(err); }
});

// ── POST / ────────────────────────────────────────────────────────────────

router.post('/',
  requireEntitlement('DEVIS_CREATE_BASIC'),
  requireFeature('devis:create'),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const companyId = requireCompany(req);

      // Idempotency
      const idempotencyKey = req.headers[IDEMPOTENCY_HEADER] as string | undefined;
      if (idempotencyKey) {
        const existing = await (devisRepository as any).findByIdempotencyKey(idempotencyKey);
        if (existing) {
          return res.status(200).json({ data: existing, idempotentReplay: true });
        }
      }

      const body = req.body || {};
      if (!body.clientName && !body.projectTitle) {
        throw badRequest('clientName or projectTitle is required');
      }

      // Validate status enum if provided
      if (body.status) {
        const validStatuses: DevisStatus[] = ['draft', 'sent', 'validated', 'cancelled'];
        if (!validStatuses.includes(body.status)) {
          throw badRequest(`status must be one of: ${validStatuses.join(', ')}`);
        }
      }

      const devis = await (devisRepository as any).create({
        companyId,
        createdByUserId: req.user!.uid,
        // Phase 1 — Devis mapping: pass through the client reference & date
        // (they were previously dropped here, so every saved Devis lost them).
        reference: body.reference,
        date: body.date,
        grandTotalTnd: body.totalTnd ?? body.total,
        clientName: body.clientName,
        clientPhone: body.clientPhone,
        clientAddress: body.clientAddress,
        projectTitle: body.projectTitle,
        country: body.country,
        currency: body.currency,
        region: body.region,
        items: body.items,
        tvaPercent: body.tvaPercent,
        timbreFiscal: body.timbreFiscal,
        retenueGarantiePercent: body.retenueGarantiePercent,
        discount: body.discount,
        status: body.status,
        idempotencyKey,
      });

      if (idempotencyKey) {
        await (devisRepository as any).storeIdempotencyKey(idempotencyKey, devis.id);
      }

      // ── Phase 1 Feature Usage Analytics: track successful devis creation ─────
      try {
        await incrementUsage(req.user!.uid, 'devis:create');
      } catch { /* non-blocking: usage recording never fails the request */ }

      res.status(201).json({ data: devis });
    } catch (err) { next(err); }
  }
);

// ── GET /:id ──────────────────────────────────────────────────────────────

router.get('/:id', async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const devis = await (devisRepository as any).findById(req.params.id);
    if (!devis) throw notFound(`Devis '${req.params.id}' not found`);
    assertOwnership(req, devis.companyId);
    res.json({ data: devis });
  } catch (err) { next(err); }
});

// ── PUT /:id ──────────────────────────────────────────────────────────────
// Optimistic version check: if client sends an outdated version → 409.

router.put('/:id', async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const existing = await (devisRepository as any).findById(req.params.id);
    if (!existing) throw notFound(`Devis '${req.params.id}' not found`);
    assertOwnership(req, existing.companyId);

    const body = req.body || {};
    const expectedVersion = body.version ?? body.expectedVersion;

    if (expectedVersion === undefined || expectedVersion === null) {
      throw badRequest('version (or expectedVersion) is required for optimistic update');
    }

    // Validate status enum if provided
    if (body.status) {
      const validStatuses: DevisStatus[] = ['draft', 'sent', 'validated', 'cancelled'];
      if (!validStatuses.includes(body.status)) {
        throw badRequest(`status must be one of: ${validStatuses.join(', ')}`);
      }
    }

    // Strip fields the client should never set directly
    const { id, companyId, createdByUserId, devisNumber, createdAt, isDeleted, deletedAt, ...patch } = body;
    patch.version = expectedVersion;

    try {
      const updated = await (devisRepository as any).update(req.params.id, patch, Number(expectedVersion));
      res.json({ data: updated });
    } catch (updateErr: any) {
      if (updateErr?.statusCode === 409) {
        throw conflict(updateErr.message);
      }
      throw updateErr;
    }
  } catch (err) { next(err); }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────
// SOFT DELETE ONLY.

router.delete('/:id', async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const existing = await (devisRepository as any).findById(req.params.id);
    if (!existing) throw notFound(`Devis '${req.params.id}' not found`);
    assertOwnership(req, existing.companyId);

    await (devisRepository as any).softDelete(req.params.id);
    res.status(204).send();
  } catch (err) { next(err); }
});

export { router as devisRouter };
