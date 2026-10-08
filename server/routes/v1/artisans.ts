/**
 * Phase 2 — Artisan Directory Routes (/api/v1/artisans)
 *
 * GET /artisans      — public read-only list with trade/governorate/pro filters
 * GET /artisans/:id  — public read-only single artisan
 *
 * Private user info (email, password) is NEVER exposed.
 */
import { Router, Response } from 'express';
import { artisanRepository } from '../../repositories/artisanRepository';
import { optionalAuth } from '../../middleware/auth';
import { parseIntParam } from '../../utils/validation';
import { notFound } from '../../utils/errors';

const router = Router();
router.use(optionalAuth);

/** Strip private fields for public exposure. */
function publicArtisan(a: any) {
  const { userId, isDeleted, ...pub } = a;
  return pub;
}

router.get('/', async (req, res, next) => {
  try {
    const result = await (artisanRepository as any).list({
      trade: req.query.trade as string | undefined,
      governorate: req.query.governorate as string | undefined,
      pro: req.query.pro === 'true' ? true : req.query.pro === 'false' ? false : undefined,
      search: req.query.search as string | undefined,
      page: parseIntParam(req.query.page, 1),
      limit: parseIntParam(req.query.limit, 20),
    });
    res.json({ ...result, data: result.data.map(publicArtisan) });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const artisan = await (artisanRepository as any).findById(req.params.id);
    if (!artisan) throw notFound(`Artisan '${req.params.id}' not found`);
    res.json({ data: publicArtisan(artisan) });
  } catch (err) { next(err); }
});

export { router as artisansRouter };
