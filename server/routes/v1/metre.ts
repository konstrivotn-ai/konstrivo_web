// @ts-nocheck
import { Router } from 'express';
import { authenticate, AuthenticatedRequest } from '../../middleware/auth';
import { requireFeature } from '../../middleware/features';
import { badRequest, forbidden, notFound } from '../../utils/errors';
import { findProjectById } from '../../repositories/drizzleProjectsRepository';
import {
  listProjectZones,
  createProjectZone,
  listProjectOuvrages,
  createProjectOuvrage,
  findProjectOuvrage,
  listRelevesForOuvrage,
  createReleve,
  findReleve,
  listReleveLines,
  addReleveLine,
} from '../../repositories/drizzleMetrePersistenceRepository';

const router = Router();

router.use(authenticate, requireFeature('projects:save'));

async function assertProjectAccess(
  req: AuthenticatedRequest,
  projectId: string,
) {
  const project = await findProjectById(projectId);

  if (!project) {
    throw notFound(`Project '${projectId}' not found`);
  }

  if (
    req.user!.role !== 'admin' &&
    (!req.user!.companyId || project.companyId !== req.user!.companyId)
  ) {
    throw forbidden('You do not have access to this project');
  }

  return project;
}

async function assertOuvrageAccess(
  req: AuthenticatedRequest,
  ouvrageId: string,
) {
  const ouvrage = await findProjectOuvrage(ouvrageId);

  if (!ouvrage) {
    throw notFound(`Ouvrage '${ouvrageId}' not found`);
  }

  await assertProjectAccess(req, ouvrage.projectId);

  return ouvrage;
}

async function assertReleveAccess(
  req: AuthenticatedRequest,
  releveId: string,
) {
  const releve = await findReleve(releveId);

  if (!releve) {
    throw notFound(`Releve '${releveId}' not found`);
  }

  await assertProjectAccess(req, releve.projectId);

  return releve;
}

router.get('/projects/:projectId/zones', async (req, res, next) => {
  try {
    await assertProjectAccess(req as AuthenticatedRequest, req.params.projectId);

    const rows = await listProjectZones(req.params.projectId);
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

router.post('/projects/:projectId/zones', async (req, res, next) => {
  try {
    await assertProjectAccess(req as AuthenticatedRequest, req.params.projectId);

    const name = String(req.body?.name || '').trim();
    if (!name) throw badRequest('name is required');

    const row = await createProjectZone({
      projectId: req.params.projectId,
      name,
      sortOrder: req.body?.sortOrder ?? 0,
    });

    res.status(201).json({ data: row });
  } catch (e) {
    next(e);
  }
});

router.get('/projects/:projectId/ouvrages', async (req, res, next) => {
  try {
    await assertProjectAccess(req as AuthenticatedRequest, req.params.projectId);

    const zoneId =
      typeof req.query.zoneId === 'string'
        ? req.query.zoneId
        : undefined;

    const rows = await listProjectOuvrages(
      req.params.projectId,
      zoneId,
    );

    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

router.post('/projects/:projectId/ouvrages', async (req, res, next) => {
  try {
    await assertProjectAccess(req as AuthenticatedRequest, req.params.projectId);

    const body = req.body || {};
    const title = String(body.title || '').trim();
    const tradeCode = String(body.tradeCode || '').trim();
    const metreElementCode = String(body.metreElementCode || '').trim();

    if (!title || !tradeCode || !metreElementCode) {
      throw badRequest(
        'title, tradeCode, metreElementCode are required',
      );
    }

    const row = await createProjectOuvrage({
      projectId: req.params.projectId,
      zoneId: body.zoneId || null,
      title,
      tradeCode,
      metreElementCode,
      specVersion: body.specVersion ?? 1,
      notes: body.notes || null,
    });

    res.status(201).json({ data: row });
  } catch (e) {
    next(e);
  }
});

router.get('/ouvrages/:ouvrageId/releves', async (req, res, next) => {
  try {
    await assertOuvrageAccess(
      req as AuthenticatedRequest,
      req.params.ouvrageId,
    );

    const rows = await listRelevesForOuvrage(req.params.ouvrageId);
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

router.post('/ouvrages/:ouvrageId/releves', async (req, res, next) => {
  try {
    const ouvrage = await assertOuvrageAccess(
      req as AuthenticatedRequest,
      req.params.ouvrageId,
    );

    const body = req.body || {};

    const row = await createReleve({
      projectId: ouvrage.projectId,
      zoneId: body.zoneId || null,
      ouvrageId: req.params.ouvrageId,
      status: body.status || 'draft',
      specVersion: body.specVersion ?? 1,
      wasteOverridePercent: body.wasteOverridePercent ?? null,
      layersOverride: body.layersOverride ?? null,
      notes: body.notes || null,
    });

    res.status(201).json({ data: row });
  } catch (e) {
    next(e);
  }
});

router.get('/releves/:releveId/lines', async (req, res, next) => {
  try {
    await assertReleveAccess(
      req as AuthenticatedRequest,
      req.params.releveId,
    );

    const rows = await listReleveLines(req.params.releveId);
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
});

router.post('/releves/:releveId/lines', async (req, res, next) => {
  try {
    await assertReleveAccess(
      req as AuthenticatedRequest,
      req.params.releveId,
    );

    const body = req.body || {};

    const row = await addReleveLine({
      releveId: req.params.releveId,
      lineNo: body.lineNo ?? 0,
      dims: body.dims || {},
      openings: body.openings || null,
      deductions: body.deductions || null,
    });

    res.status(201).json({ data: row });
  } catch (e) {
    next(e);
  }
});

export { router as metreRouter };