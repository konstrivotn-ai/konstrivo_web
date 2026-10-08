/**
 * Phase 2B — Trade Registry Routes (/api/v1/trades)
 *
 * READ (public, unchanged):
 *   GET /trades      — list trades (?officialOnly=true restricts to official trades)
 *   GET /trades/:id  — single trade by id (404 for unknown or invalid ids)
 *   GET /trades/:id/services — data-driven services of a trade
 *   GET /trades/:id/metre-elements — data-driven Dynamic Métré elements (Phase 1)
 *
 * ADMIN (Admin → Métiers, additive):
 *   GET    /trades?includeInactive=true    — admin only: also returns deactivated trades
 *   PATCH  /trades/:id                     — labels (FR/AR/Derja), icon, sortOrder, isActive
 *   DELETE /trades/:id                     — NON-OFFICIAL trades only (materials guard → 409)
 *   POST   /trades/:id/services            — create/update one service of a trade
 *   PATCH  /trades/:id/services/:serviceId — activate/deactivate one service
 *
 * `trades` stays the SINGLE source of truth: Outils (CalculatorTab) and
 * Services both read this same registry, so `isActive=false` hides a métier
 * everywhere at once — no separate data source is introduced.
 */
import { Router, Response } from 'express';
import { tradeRepository, countMaterialsForTrade } from '../../repositories/tradeRepository';
import {
  listServicesByTradeId,
  listAllServicesByTradeId,
  upsertTradeService,
  setTradeServiceActive,
} from '../../repositories/drizzleTradeServiceRepository';
import {
  listMetreElementsByTradeId,
  listAllMetreElementsByTradeId,
} from '../../repositories/drizzleTradeMetreElementRepository';
import {
  authenticate, requireRole, requireEntitlement, optionalAuth, AuthenticatedRequest,
} from '../../middleware/auth';
import { badRequest, conflict, notFound } from '../../utils/errors';

const router = Router();

router.use(optionalAuth);

/** Schema limits (mirror server/db/schema/catalog.ts — varchar lengths). */
const LABEL_MAX = 100;
const ICON_MAX = 50;
const SERVICE_NAME_MAX = 150;

/** Admin guard shared by every write endpoint of this router. */
const requireAdmin = [authenticate, requireEntitlement('CATALOG_OFFICIAL_MANAGE'), requireRole('admin')];

function isAdmin(req: AuthenticatedRequest): boolean {
  return req.user?.role === 'admin';
}

function normalizeOptionalText(value: unknown, max: number, field: string): string | null {
  if (value === null) return null;
  const text = String(value ?? '').trim();
  if (text === '') return null;
  if (text.length > max) throw badRequest(`${field} must be at most ${max} characters`);
  return text;
}

// ── GET / ─────────────────────────────────────────────────────────────────

router.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const officialOnly = req.query.officialOnly === 'true';
    // Admin → Métiers needs to see deactivated rows too; everyone else always
    // gets the active registry (identical to the previous behaviour).
    const includeInactive = req.query.includeInactive === 'true' && isAdmin(req);
    const trades = await tradeRepository.list(officialOnly, includeInactive);
    res.json({ data: trades });
  } catch (err) { next(err); }
});

// ── GET /:id ──────────────────────────────────────────────────────────────

router.get('/:id', async (req, res, next) => {
  try {
    const trade = await tradeRepository.findById(req.params.id);
    if (!trade) throw notFound(`Trade '${req.params.id}' not found`);
    res.json({ data: trade });
  } catch (err) { next(err); }
});

// ── GET /:id/services ──────────────────────────────────────────────────────
// Phase D — data-driven services for a trade. Returns services from the
// trade_services table so dynamic trades can have meaningful services
// without any source code change.

router.get('/:id/services', async (req: AuthenticatedRequest, res, next) => {
  try {
    // Admins may also see inactive services (so they can re-activate them).
    const services = req.query.includeInactive === 'true' && isAdmin(req)
      ? await listAllServicesByTradeId(req.params.id)
      : await listServicesByTradeId(req.params.id);
    res.json({ data: services });
  } catch (err) { next(err); }
});

// ── GET /:id/metre-elements ──────────────────────────────────────────────────
// DYNAMIC MÉTRÉ — data-driven elements for a trade (trade_metre_elements,
// migration 0015). Same read contract as /:id/services: active rows for
// everyone, admins may pass ?includeInactive=true. A NEW catalogue métier
// gets Dynamic Métré through this data — no `metreElements.ts` change and no
// `if (trade === ...)` branch anywhere.

router.get('/:id/metre-elements', async (req: AuthenticatedRequest, res, next) => {
  try {
    const elements = req.query.includeInactive === 'true' && isAdmin(req)
      ? await listAllMetreElementsByTradeId(req.params.id)
      : await listMetreElementsByTradeId(req.params.id);
    res.json({ data: elements });
  } catch (err) { next(err); }
});

// ── PATCH /:id ─────────────────────────────────────────────────────────────
// Admin → Métiers: labels, icon, sortOrder and activation.
// `code` and `isOfficial` are intentionally NOT patchable (identity +
// official protection).

router.patch('/:id', ...requireAdmin, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const existing = await tradeRepository.findById(req.params.id);
    if (!existing) throw notFound(`Trade '${req.params.id}' not found`);

    const patch: Record<string, unknown> = {};

    if ('labelFr' in body) {
      const labelFr = normalizeOptionalText(body.labelFr, LABEL_MAX, 'labelFr');
      if (!labelFr) throw badRequest('labelFr cannot be empty');
      patch.labelFr = labelFr;
    }
    if ('labelAr' in body) patch.labelAr = normalizeOptionalText(body.labelAr, LABEL_MAX, 'labelAr');
    if ('labelDerja' in body) patch.labelDerja = normalizeOptionalText(body.labelDerja, LABEL_MAX, 'labelDerja');
    if ('icon' in body) patch.icon = normalizeOptionalText(body.icon, ICON_MAX, 'icon');
    if ('sortOrder' in body) {
      const sortOrder = Number(body.sortOrder);
      if (!Number.isFinite(sortOrder) || !Number.isInteger(sortOrder) || sortOrder < 0) {
        throw badRequest('sortOrder must be an integer >= 0');
      }
      patch.sortOrder = sortOrder;
    }
    if ('isActive' in body) {
      if (typeof body.isActive !== 'boolean') throw badRequest('isActive must be a boolean');
      patch.isActive = body.isActive;
    }
    if (Object.keys(patch).length === 0) {
      throw badRequest('No editable field provided (labelFr, labelAr, labelDerja, icon, sortOrder, isActive)');
    }

    const updated = await tradeRepository.update(req.params.id, patch as any);
    if (!updated) throw notFound(`Trade '${req.params.id}' not found`);
    res.json({ data: updated });
  } catch (err) { next(err); }
});

// ── DELETE /:id ────────────────────────────────────────────────────────────
// NON-OFFICIAL trades only. Official trades can never be deleted (the
// repository re-checks `is_official = false` in SQL too). A trade that still
// owns materials is refused with 409 instead of leaking an FK error.

router.delete('/:id', ...requireAdmin, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const existing = await tradeRepository.findById(req.params.id);
    if (!existing) throw notFound(`Trade '${req.params.id}' not found`);
    if (existing.isOfficial) {
      throw conflict('Official trades cannot be deleted. Deactivate it instead (isActive=false).');
    }
    const attached = await countMaterialsForTrade(existing.id);
    if (attached > 0) {
      throw conflict(
        `Cannot delete '${existing.code}': ${attached} material(s) still reference it. ` +
        'Move or remove those materials first, or deactivate the trade instead.'
      );
    }
    const removed = await tradeRepository.remove(existing.id);
    if (!removed) throw notFound(`Trade '${req.params.id}' not found`);
    res.status(204).send();
  } catch (err) { next(err); }
});

// ── POST /:id/services ─────────────────────────────────────────────────────
// Admin → Métiers: create or update ONE service of a trade (idempotent by
// (tradeId, nameFr) — the same helper the catalog import uses).

router.post('/:id/services', ...requireAdmin, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const existing = await tradeRepository.findById(req.params.id);
    if (!existing) throw notFound(`Trade '${req.params.id}' not found`);

    const body = (req.body || {}) as Record<string, unknown>;
    const nameFr = normalizeOptionalText(body.nameFr, SERVICE_NAME_MAX, 'nameFr');
    if (!nameFr) throw badRequest('nameFr is required');

    let suggestedRateTnd: number | null | undefined;
    if ('suggestedRateTnd' in body) {
      if (body.suggestedRateTnd === null || body.suggestedRateTnd === '') {
        suggestedRateTnd = null;
      } else {
        const rate = Number(body.suggestedRateTnd);
        if (!Number.isFinite(rate) || rate < 0) throw badRequest('suggestedRateTnd must be a number >= 0');
        suggestedRateTnd = rate;
      }
    }

    let sortOrder: number | undefined;
    if ('sortOrder' in body) {
      const value = Number(body.sortOrder);
      if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
        throw badRequest('sortOrder must be an integer >= 0');
      }
      sortOrder = value;
    }

    const service = await upsertTradeService(existing.id, {
      nameFr,
      nameAr: 'nameAr' in body ? normalizeOptionalText(body.nameAr, SERVICE_NAME_MAX, 'nameAr') : undefined,
      defaultUnit: 'defaultUnit' in body
        ? (normalizeOptionalText(body.defaultUnit, 20, 'defaultUnit') || 'm²')
        : undefined,
      suggestedRateTnd,
      sortOrder,
    });
    if (!service) throw badRequest('Services can only be stored when the database is available');
    res.status(201).json({ data: service });
  } catch (err) { next(err); }
});

// ─ PATCH /:id/services/:serviceId ─────────────────────────────────────────
// Admin → Métiers: activate/deactivate one service (the row is never deleted).

router.patch('/:id/services/:serviceId', ...requireAdmin, async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    if (typeof body.isActive !== 'boolean') throw badRequest('isActive must be a boolean');
    const updated = await setTradeServiceActive(req.params.serviceId, body.isActive);
    if (!updated) throw notFound(`Service '${req.params.serviceId}' not found`);
    res.json({ data: updated });
  } catch (err) { next(err); }
});

export { router as tradesRouter };