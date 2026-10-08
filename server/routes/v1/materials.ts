/**
 * Phase 2 — Materials Routes (/api/v1/materials)
 *
 * GET /materials      — paginated list with trade/category/search filters
 * GET /materials/:id  — single material
 * DELETE /materials/:id — ADMIN ONLY: ARCHIVE (soft delete) one OFFICIAL
 *                          material so it stops being served by /prices and
 *                          /materials. Nothing is hard-deleted: the row keeps
 *                          its id/code, its historical price rows, and every
 *                          Devis item / snapshot that references it. A later
 *                          import of the same code publishes it again.
 *
 * Prices are NOT attached to the canonical Material entity.
 */
import { Router, Response } from 'express';
import { materialRepository } from '../../repositories/materialRepository';
import { authenticate, requireRole, requireEntitlement, optionalAuth, AuthenticatedRequest } from '../../middleware/auth';
import { parseIntParam } from '../../utils/validation';
import { badRequest, conflict, notFound } from '../../utils/errors';

const router = Router();

router.use(optionalAuth);

/** Same admin guard as the trades registry writers (Admin → catalogue). */
const requireAdmin = [authenticate, requireEntitlement('CATALOG_OFFICIAL_MANAGE'), requireRole('admin')];

// ── GET / ─────────────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const page = parseIntParam(req.query.page, 1);
    const limit = parseIntParam(req.query.limit, 20);
    const result = await (materialRepository as any).list({
      trade: req.query.trade as string | undefined,
      category: req.query.category as string | undefined,
      search: req.query.search as string | undefined,
      page,
      limit,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /:id ──────────────────────────────────────────────────────────────

router.get('/:id', async (req, res, next) => {
  try {
    const material = await (materialRepository as any).findById(req.params.id);
    if (!material) throw notFound(`Material '${req.params.id}' not found`);
    res.json({ data: material });
  } catch (err) { next(err); }
});

// ── DELETE /:id — ADMIN archive (soft delete, reversible) ─────────────────
//
// The DB is the source of truth: `materials.is_deleted = true` makes the row
// disappear from /materials AND /prices (see listPrices's `materials.is_deleted`
// condition), so every client — cache included, through the additive
// GET /catalog/inactive-refs list — stops showing it.
//
// NOTHING is hard-deleted and NOTHING is rewritten:
//   • the material row keeps its id/code/price history (is_deleted only),
//   • material_prices rows are untouched (superseded in place as before),
//   • devis / devis_items / projects / users are never touched.
// Re-importing the same official code publishes it again (upsertMaterialByCode).
router.delete('/:id', ...requireAdmin, async (req: AuthenticatedRequest, res: Response, next: any) => {
  try {
    const ref = String(req.params.id ?? '').trim();
    if (!ref) throw badRequest('Material reference is required');
    const lookup = await (materialRepository as any).findForArchive(ref);
    if (lookup.status === 'ambiguous') {
      throw conflict(
        `Ambiguous material reference '${ref}': ${lookup.count} official materials match (${lookup.codes.join(', ')}). ` +
        'Nothing was archived — use the exact code.'
      );
    }
    if (lookup.status === 'missing') throw notFound(`Material '${ref}' not found`);
    const material: any = lookup.material;
    if (material.companyId) {
      throw conflict('Company-owned (tenant) materials cannot be archived from the official catalog.');
    }
    await materialRepository.softDelete(material.id);
    res.json({ data: { id: material.id, code: material.code, isDeleted: true } });
  } catch (err) { next(err); }
});

export { router as materialsRouter };
