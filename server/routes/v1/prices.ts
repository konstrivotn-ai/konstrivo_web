/**
 * Phase 2 — Prices Routes (/api/v1/prices)
 *
 * GET  /prices        — paginated price list with filters
 * POST /prices/custom — create a custom price (requires PRICES_CUSTOM_EDIT)
 */
import { Router, Response } from 'express';
import { priceRepository } from '../../repositories/priceRepository';
import { materialRepository } from '../../repositories/materialRepository';
import {
  authenticate, requireEntitlement, AuthenticatedRequest,
} from '../../middleware/auth';
import { validateBody, parseIntParam, roundMoney, isValidUuid } from '../../utils/validation';
import { notFound, forbidden, badRequest } from '../../utils/errors';

const router = Router();

// ── GET / ─────────────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const page = parseIntParam(req.query.page, 1);
    const limit = parseIntParam(req.query.limit, 20);
    const result = await (priceRepository as any).list({
      materialId: req.query.materialId as string | undefined,
      currency: req.query.currency as string | undefined,
      source: req.query.source as any,
      market: req.query.market as string | undefined,
      effectiveDate: req.query.effectiveDate as string | undefined,
      page,
      limit,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /sources ──────────────────────────────────────────────────────────

router.get('/sources', async (_req, res, next) => {
  try {
    const sources = await (priceRepository as any).getPriceSources();
    res.json({ data: sources });
  } catch (err) { next(err); }
});

// ── POST /custom ──────────────────────────────────────────────────────────
// Requires the PRICES_CUSTOM_EDIT entitlement. FREE users are blocked.

router.post('/custom',
  authenticate,
  requireEntitlement('PRICES_CUSTOM_EDIT'),
  validateBody([
    { field: 'materialId', label: 'Material ID', required: true, type: 'string' },
    { field: 'price', label: 'Price', required: true, type: 'number', min: 0 },
  ]),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const { materialId, price, currency, market, notes, effectiveFrom } = req.body || {};

      // Verify the material exists
      const material = await (materialRepository as any).findById(materialId);
      if (!material) throw notFound(`Material '${materialId}' not found`);

      // Company isolation: custom prices belong to the user's company
      const companyId = req.user!.companyId;
      if (!companyId) throw forbidden('No active company membership');

      if (price < 0) throw badRequest('Price must be >= 0');

      const newPrice = await (priceRepository as any).create({
        materialId,
        price: roundMoney(price),
        currency: currency || 'TND',
        source: 'CUSTOM',
        market: market || 'tn',
        countryCode: 'TN',
        companyId,
        isCurrent: true,
        effectiveFrom,
        notes,
      });

      res.status(201).json({ data: newPrice });
    } catch (err) { next(err); }
  }
);

export { router as pricesRouter };
