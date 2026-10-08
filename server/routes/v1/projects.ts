/**
 * Phase 3 — Projects Routes (/api/v1/projects)
 *
 * Drizzle-backed PostgreSQL repository.
 * Public read endpoints + authenticated create/update/delete.
 */
import { Router, Response } from 'express';
import {
  listProjects,
  findProjectById,
  createProject,
  updateProject,
  softDeleteProject,
} from '../../repositories/drizzleProjectsRepository';
import { optionalAuth, authenticate, AuthenticatedRequest } from '../../middleware/auth';
import { requireFeature } from '../../middleware/features';
import { parseIntParam } from '../../utils/validation';
import { notFound, badRequest, forbidden } from '../../utils/errors';
// Phase 1 Feature Usage Analytics — reuse the existing per-user usage counter.
import { incrementUsage } from '../../services/featureService';

const router = Router();

/**
 * Resolve the owning company for a project creation (Phase 3 — F7 fix).
 *
 * The company ALWAYS comes from the authenticated session/JWT — the same
 * server-side resolution the Devis routes use via `requireCompany` — so a
 * client can never create a project inside another company's tenant.
 * For backward compatibility a client-sent `companyId` is still accepted
 * when (and only when) it matches the caller's own membership; a mismatch
 * is rejected. Validation semantics otherwise unchanged: no company → 403,
 * no name → 400.
 */
function resolveCompanyId(req: AuthenticatedRequest, body: any): string {
  const fromToken = req.user?.companyId || '';
  if (!fromToken) throw forbidden('No active company membership');
  const fromBody = typeof body?.companyId === 'string' && body.companyId ? body.companyId : '';
  if (fromBody && fromBody !== fromToken) {
    throw forbidden('You do not have access to this company');
  }
  return fromToken;
}

/**
 * Ownership check for project mutations (Phase 3 — F7 fix).
 *
 * Mirrors `assertOwnership` in the Devis routes: admins may act across
 * companies, everyone else only on projects belonging to their own company.
 */
function assertOwnership(req: AuthenticatedRequest, projectCompanyId: string) {
  const userCompanyId = req.user!.companyId;
  if (req.user!.role === 'admin') return; // admins may access across companies
  if (!userCompanyId || projectCompanyId !== userCompanyId) {
    throw forbidden('You do not have access to this project');
  }
}

// Public endpoints may accept an optional token
router.use(optionalAuth);

router.get('/', async (req, res, next) => {
  try {
    const result = await listProjects({
      search: req.query.search as string | undefined,
      region: req.query.region as string | undefined,
      companyId: req.query.companyId as string | undefined,
      status: req.query.status as string | undefined,
      page: parseIntParam(req.query.page, 1),
      limit: parseIntParam(req.query.limit, 50),
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const p = await findProjectById(req.params.id);
    if (!p) throw notFound(`Project '${req.params.id}' not found`);
    res.json({ data: p });
  } catch (err) { next(err); }
});

// Mutations require authentication + plan-based feature access
router.post('/', authenticate, requireFeature('projects:save'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = req.body || {};
    if (!body.name) throw badRequest('name is required');
    // Company is resolved from the authenticated session (see
    // resolveCompanyId) — a client-sent `companyId` must match the caller's
    // own membership, never another company's (Phase 3 F7).
    const companyId = resolveCompanyId(req, body);
    const created = await createProject({
      ...body,
      companyId,
      managerUserId: req.user?.uid,
    });

    // ── Phase 1 Feature Usage Analytics: track successful project save ────────
    try {
      await incrementUsage(req.user!.uid, 'projects:save');
    } catch { /* non-blocking: usage recording never fails the request */ }

    res.status(201).json({ data: created });
    } catch (err) { next(err); }
  });

router.put('/:id', authenticate, async (req: AuthenticatedRequest, res, next) => {
  try {
    const existing = await findProjectById(req.params.id);
    if (!existing) throw notFound(`Project '${req.params.id}' not found`);
    assertOwnership(req, existing.companyId);
    // Tenant identity is never client-mutable — same field strip as Devis PUT.
    const { id, companyId, ...patch } = req.body || {};
    const patched = await updateProject(req.params.id, patch, req.body?.version);
    res.json({ data: patched });
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, async (req: AuthenticatedRequest, res, next) => {
  try {
    const existing = await findProjectById(req.params.id);
    if (!existing) throw notFound(`Project '${req.params.id}' not found`);
    assertOwnership(req, existing.companyId);
    await softDeleteProject(req.params.id);
    res.status(204).send();
  } catch (err) { next(err); }
});

export { router as projectsRouter };
