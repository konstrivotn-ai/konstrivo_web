/**
 * Phase 2 — Sync Routes (/api/v1/sync)
 *
 * POST /pull — pull server changes since a timestamp
 * POST /push — push client operations (idempotent, version-aware)
 */
import { Router, Response } from 'express';
import { syncRepository } from '../../repositories/syncRepository';
import { authenticate, AuthenticatedRequest } from '../../middleware/auth';
import { validateBody } from '../../utils/validation';
import { badRequest } from '../../utils/errors';
import { EntityType } from '../../types';

const router = Router();
router.use(authenticate);

// ── POST /pull ────────────────────────────────────────────────────────────

router.post('/pull',
  validateBody([
    { field: 'since', label: 'Since timestamp', type: 'string' },
    { field: 'entityTypes', label: 'Entity types', type: 'array' },
  ]),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const { since, entityTypes } = req.body || {};
      const entries = await (syncRepository as any).pull({
        since,
        entityTypes: entityTypes as EntityType[] | undefined,
      });
      res.json({
        data: entries,
        serverTime: new Date().toISOString(),
      });
    } catch (err) { next(err); }
  }
);

// ── POST /push ────────────────────────────────────────────────────────────

router.post('/push',
  validateBody([
    { field: 'operations', label: 'Operations', required: true, type: 'array', min: 1 },
  ]),
  async (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const operations = req.body?.operations;
      const clientId = req.body?.clientId || 'unknown';

      for (const op of operations) {
        if (!op.id || !op.entityType || !op.entityId || !op.operationType) {
          throw badRequest('Each operation requires: id, entityType, entityId, operationType');
        }
      }

      const { applied, conflicts } = await (syncRepository as any).push(req.user!.uid, clientId, operations);

      res.json({
        applied: applied.map(e => ({
          operationId: e.id,
          entityId: e.entityId,
          serverVersion: e.serverVersion,
          serverTimestamp: e.serverTimestamp,
        })),
        conflicts: conflicts.map(e => ({
          operationId: e.id,
          entityId: e.entityId,
          clientVersion: e.clientVersion,
          serverVersion: e.serverVersion,
          message: 'Stale version — server has a newer version',
        })),
      });
    } catch (err) { next(err); }
  }
);

export { router as syncRouter };
