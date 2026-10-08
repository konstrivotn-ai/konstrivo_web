// @ts-nocheck
import { Router, Response } from 'express';
import express from 'express';
import {
  authenticate,
  requireEntitlement,
  requireRole,
  AuthenticatedRequest,
} from '../../middleware/auth';
import { validateBody, isValidUuid } from '../../utils/validation';
import { badRequest, notFound, payloadTooLarge, unsupportedMediaType } from '../../utils/errors';
import { config } from '../../config';
import { getBoundary, parseMultipart, isValidFileType, MultipartFile } from '../../utils/multipart';

import {
  listGlobalProducts,
  getGlobalProductById,
  createGlobalProduct,
  updateGlobalProduct,
  upsertGlobalIdentifier,
  linkMaterialToGlobalProduct,
  setGlobalProductAvailability,
  listCatalogImports,
  listCatalogSources,
  createCatalogSource,
  updateCatalogSource,
  getCatalogSourceById,
  // ── Phase "Country + Supplier + Prices" — READ-ONLY access layer ──
  getGlobalProductAvailability,
  listGlobalProductPrices,
  getGlobalProductPriceHistory,
  normalizeGlobalProductPriceFilters,
  listSuppliers,
} from '../../repositories/globalCatalogRepository';

import {
  listImportItems,
  approveImportItem,
  rejectImportItem,
} from '../../repositories/globalCatalogReviewRepository';

import {
  previewGlobalCatalogImport,
  commitGlobalCatalogImport,
} from '../../services/globalCatalogImport';
import {
  previewApiImportRows,
} from '../../services/catalogApiImportPreview';
import {
  previewApiImportDocument,
  commitApiImportRows,
  sha256Json,
} from '../../services/catalogApiImportCommit';

import { runCatalogSourceTestConnection } from '../../services/catalogSourceTestConnection';
import {
  isCatalogApiSyncRunning,
  runCatalogApiSync,
} from '../../services/catalogApiSync';

const router = Router();

// Mirror catalog.ts defense-in-depth for admin write routes.
const requireAdminWrite = [
  authenticate,
  requireEntitlement('CATALOG_OFFICIAL_MANAGE'),
  requireRole('admin'),
];

// ─────────────────────────────────────────────────────────────────────────────
// Public / read-only
// ─────────────────────────────────────────────────────────────────────────────

router.get('/products', async (req: any, res: Response, next: any) => {
  try {
    const search = typeof req.query?.search === 'string' ? req.query.search : undefined;
    const page = typeof req.query?.page === 'string' ? Number(req.query.page) : undefined;
    const limit = typeof req.query?.limit === 'string' ? Number(req.query.limit) : undefined;
    const data = await listGlobalProducts({ search, page, limit });
    res.json({ data });
  } catch (e) { next(e); }
});

router.get('/products/:id', async (req: any, res: Response, next: any) => {
  try {
    const id = String(req.params?.id || '');
    const row = await getGlobalProductById(id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ data: row });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase "Country + Supplier + Prices" — READ-ONLY endpoints (ADDITIVE)
//
// Contract notes (nothing existing is changed or re-registered):
// - All four are `GET` only. No write verb is registered on any of them, so no
//   mutation can be reached through this surface.
// - Authorization mirrors `GET /products` / `GET /products/:id` (the existing
//   public read surface of this router). No entitlement or role gate is added,
//   because the payloads are already-served public data (`material_prices` is
//   public via `GET /api/v1/prices`) and every row is projected through a
//   public-safe mapper. A soft-deleted material or an unpublished price is
//   never returned.
// - `:id` is validated as a UUID and the product existence is checked BEFORE
//   any related read, so a bad/unknown id is a 404 and never a partial payload.
// - Invalid query filters are refused with 400 by the repository validators —
//   a filter is never silently ignored.
// ─────────────────────────────────────────────────────────────────────────────

/** Reads a query param only when it is a string (Express gives arrays/objects otherwise). */
function readQueryString(value: any): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Resolve the global product for a read endpoint.
 *
 * The UUID is validated HERE, before any database call: `getGlobalProductById`
 * opens the connection before it checks the id, so an unchecked value would
 * spend a connection on a request that can never succeed. Returns `undefined`
 * for both an invalid id and an unknown product — the route then answers 404
 * without ever leaking the difference.
 */
async function resolveReadableProduct(id: string) {
  if (!isValidUuid(id)) return undefined;
  return getGlobalProductById(id);
}

router.get('/products/:id/availability', async (req: any, res: Response, next: any) => {
  try {
    const id = String(req.params?.id || '');
    const product = await resolveReadableProduct(id);
    if (!product) return res.status(404).json({ error: 'Not found' });
    const rows = await getGlobalProductAvailability(id);
    res.json({ data: rows || [] });
  } catch (e) { next(e); }
});

router.get('/products/:id/prices', async (req: any, res: Response, next: any) => {
  try {
    const id = String(req.params?.id || '');
    // Validate the filters FIRST: an unusable filter must be refused with 400
    // without spending a database round-trip on a request that cannot succeed.
    const filters = normalizeGlobalProductPriceFilters({
      country: readQueryString(req.query?.country) ?? readQueryString(req.query?.countryCode),
      currency: readQueryString(req.query?.currency) ?? readQueryString(req.query?.currencyCode),
      supplierId: readQueryString(req.query?.supplierId),
      limit: readQueryString(req.query?.limit),
    });
    const product = await resolveReadableProduct(id);
    if (!product) return res.status(404).json({ error: 'Not found' });
    const out = await listGlobalProductPrices(id, filters);
    res.json({ data: out.data, materialId: out.materialId });
  } catch (e) { next(e); }
});

router.get('/products/:id/price-history', async (req: any, res: Response, next: any) => {
  try {
    const id = String(req.params?.id || '');
    const filters = normalizeGlobalProductPriceFilters({
      country: readQueryString(req.query?.country) ?? readQueryString(req.query?.countryCode),
      currency: readQueryString(req.query?.currency) ?? readQueryString(req.query?.currencyCode),
      supplierId: readQueryString(req.query?.supplierId),
      limit: readQueryString(req.query?.limit),
    });
    const product = await resolveReadableProduct(id);
    if (!product) return res.status(404).json({ error: 'Not found' });
    const out = await getGlobalProductPriceHistory(id, filters);
    res.json({ data: out.data, materialId: out.materialId });
  } catch (e) { next(e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin: CRUD + identifiers + linking + availability
// ─────────────────────────────────────────────────────────────────────────────

router.post('/admin/products',
  ...requireAdminWrite,
  validateBody([
    { field: 'name', label: 'Name', required: true, type: 'string' },
  ]),
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const gp = await createGlobalProduct({
        name: req.body.name,
        brand: req.body.brand,
        manufacturer: req.body.manufacturer,
        category: req.body.category,
        subcategory: req.body.subcategory,
        description: req.body.description,
        specification: req.body.specification,
        unit: req.body.unit,
        model: req.body.model,
        sku: req.body.sku,
        status: req.body.status,
        media: req.body.media,
        extra: req.body.extra,
      });
      res.status(201).json({ data: gp });
    } catch (e) { next(e); }
  }
);

router.patch('/admin/products/:id',
  ...requireAdminWrite,
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const id = String(req.params?.id || '');
      const gp = await updateGlobalProduct(id, req.body || {});
      if (!gp) return res.status(404).json({ error: 'Not found' });
      res.json({ data: gp });
    } catch (e) { next(e); }
  }
);

router.post('/admin/products/:id/identifiers',
  ...requireAdminWrite,
  validateBody([
    { field: 'identifierType', label: 'Identifier Type', required: true, type: 'string' },
    { field: 'identifierValue', label: 'Identifier Value', required: true, type: 'string' },
  ]),
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const id = String(req.params?.id || '');
      const row = await upsertGlobalIdentifier({
        globalProductId: id,
        identifierType: req.body.identifierType,
        identifierValue: req.body.identifierValue,
        supplierId: req.body.supplierId,
        confidence: req.body.confidence,
        source: req.body.source,
      });
      res.status(201).json({ data: row });
    } catch (e) { next(e); }
  }
);

router.post('/admin/material-link',
  ...requireAdminWrite,
  validateBody([
    { field: 'materialId', label: 'Material ID', required: true, type: 'string' },
    { field: 'globalProductId', label: 'Global Product ID', required: true, type: 'string' },
  ]),
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const row = await linkMaterialToGlobalProduct({
        materialId: req.body.materialId,
        globalProductId: req.body.globalProductId,
        linkSource: req.body.linkSource,
        status: req.body.status,
        confidence: req.body.confidence,
        notes: req.body.notes,
        forceReassign: !!req.body.forceReassign,
      });
      res.status(201).json({ data: row });
    } catch (e) { next(e); }
  }
);

router.post('/admin/availability',
  ...requireAdminWrite,
  validateBody([
    { field: 'globalProductId', label: 'Global Product ID', required: true, type: 'string' },
    { field: 'countryCode', label: 'Country', required: true, type: 'string' },
    { field: 'isAvailable', label: 'Available', required: true, type: 'boolean' },
  ]),
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const row = await setGlobalProductAvailability({
        globalProductId: req.body.globalProductId,
        countryCode: req.body.countryCode,
        isAvailable: !!req.body.isAvailable,
        localName: req.body.localName,
        localReference: req.body.localReference,
        localSpecification: req.body.localSpecification,
        localUnit: req.body.localUnit,
        observedAt: req.body.observedAt,
        catalogSourceId: req.body.catalogSourceId,
        sourceRef: req.body.sourceRef,
      });
      res.status(201).json({ data: row });
    } catch (e) { next(e); }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Catalog Sources Management (`catalog_sources`)
//
// Same guard as every other Global Catalog admin route. These endpoints only
// read/create/update `catalog_sources` — they NEVER start an import or a sync.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/admin/sources',
  ...requireAdminWrite,
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const str = (v: any) => (typeof v === 'string' ? v : undefined);
      const num = (v: any) => (typeof v === 'string' ? Number(v) : undefined);
      const result = await listCatalogSources({
        search: str(req.query?.search),
        countryCode: str(req.query?.country) ?? str(req.query?.countryCode),
        sourceType: str(req.query?.type) ?? str(req.query?.sourceType),
        status: str(req.query?.status),
        limit: num(req.query?.limit),
        offset: num(req.query?.offset),
      });
      res.json({ data: result });
    } catch (e) { next(e); }
  }
);

router.post('/admin/sources',
  ...requireAdminWrite,
  validateBody([
    { field: 'name', label: 'Source Name', required: true, type: 'string', min: 1, max: 200 },
    { field: 'sourceType', label: 'Source Type', required: true, type: 'string' },
  ]),
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const row = await createCatalogSource({
        name: req.body?.name,
        sourceType: req.body?.sourceType,
        countryCode: req.body?.countryCode ?? req.body?.country ?? null,
        provider: req.body?.provider,
        url: req.body?.url,
        status: req.body?.status,
        updateFrequency: req.body?.updateFrequency,
        configuration: req.body?.configuration,
      });
      // No import, no sync: only the source row is created.
      res.status(201).json({ data: row });
    } catch (e) { next(e); }
  }
);

router.patch('/admin/sources/:id',
  ...requireAdminWrite,
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const id = String(req.params?.id || '');
      const patch: any = {};
      const keys = [
        'name', 'sourceType', 'countryCode', 'provider', 'url', 'status',
        'updateFrequency', 'configuration',
      ];
      for (const key of keys) {
        if (req.body && Object.prototype.hasOwnProperty.call(req.body, key)) patch[key] = req.body[key];
      }
      // `country` is accepted as an alias of `countryCode`.
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'country')) {
        patch.countryCode = req.body.country;
      }

      const row = await updateCatalogSource(id, patch);
      if (!row) return res.status(404).json({ error: 'Not found' });
      res.json({ data: row });
    } catch (e) { next(e); }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Phase 2 — TEST CONNECTION (read-only probe of an API source)
//
// Fires exactly ONE GET at the source's `configuration.api.baseUrl`, and only
// when the admin presses `Tester la connexion`. It writes NOTHING: no
// `catalog_sources` update, no `catalog_imports` run, no
// `last_successful_sync_at` / `last_error`, no import, no sync, no schedule.
// The request hardening (short fixed timeout, redirects never followed,
// capped response body, SSRF guard, secret read from the environment by
// reference only) lives in services/catalogSourceTestConnection.ts.
// ─────────────────────────────────────────────────────────────────────────────

router.post('/admin/sources/:id/test-connection',
  ...requireAdminWrite,
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const id = String(req.params?.id || '');
      const source = await getCatalogSourceById(id);
      if (!source) return res.status(404).json({ error: 'Not found' });
      const result = await runCatalogSourceTestConnection(source);
      res.json({ data: result });
    } catch (e) { next(e); }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Phase 1 — API sync (manual run only)
//
// Safety: API sources only. Source type must be `api` and the source cannot be
// already running. The sync uses the existing resolver + preview + commit path
// and writes no new secrets/raw payloads to the DB. No scheduler is added.
// ─────────────────────────────────────────────────────────────────────────────

router.post('/admin/sources/:id/sync',
  ...requireAdminWrite,
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const id = String(req.params?.id || '');
      const source = await getCatalogSourceById(id);
      if (!source) return res.status(404).json({ error: 'Not found' });
      if (String(source.sourceType ?? '').trim().toLowerCase() !== 'api') {
        return res.status(400).json({ error: 'Only API sources can be synchronized.' });
      }
      if (isCatalogApiSyncRunning(source.id)) {
        return res.status(409).json({ error: 'A sync for this source is already running.' });
      }
      const result = await runCatalogApiSync(source, { triggeredBy: req.user?.uid || 'manual' });
      const statusCode = result.status === 'failed' ? 502 : 200;
      res.status(statusCode).json({ data: result });
    } catch (e) { next(e); }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Review workflow for import items
// ─────────────────────────────────────────────────────────────────────────────

// Admin: Import History — READ-ONLY listing of the EXISTING catalog_imports runs.
// Writes nothing; Preview/Commit/Approve/Reject logic is untouched.
router.get('/admin/imports',
  ...requireAdminWrite,
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const status = typeof req.query?.status === 'string' ? req.query.status : undefined;
      const limit = typeof req.query?.limit === 'string' ? Number(req.query.limit) : undefined;
      const offset = typeof req.query?.offset === 'string' ? Number(req.query.offset) : undefined;
      const result = await listCatalogImports({ status, limit, offset });
      res.json({ data: result });
    } catch (e) { next(e); }
  }
);

router.get('/admin/imports/:importId/items',
  ...requireAdminWrite,
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const importId = String(req.params?.importId || '');
      const matchStatus = typeof req.query?.matchStatus === 'string' ? req.query.matchStatus : undefined;
      const limit = typeof req.query?.limit === 'string' ? Number(req.query.limit) : undefined;
      const offset = typeof req.query?.offset === 'string' ? Number(req.query.offset) : undefined;
      const rows = await listImportItems({ importId, matchStatus, limit, offset });
      res.json({ data: rows });
    } catch (e) { next(e); }
  }
);

router.post('/admin/import-items/:itemId/approve',
  ...requireAdminWrite,
  validateBody([
    { field: 'action', label: 'Action', required: true, type: 'string' },
  ]),
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const itemId = String(req.params?.itemId || '');
      const action = String(req.body.action || '');
      const globalProductId = req.body.globalProductId;
      if (action !== 'create_new' && action !== 'link_existing') {
        throw badRequest('Invalid action');
      }
      const out = await approveImportItem({ itemId, action, globalProductId });
      res.status(201).json({ data: out });
    } catch (e) { next(e); }
  }
);

router.post('/admin/import-items/:itemId/reject',
  ...requireAdminWrite,
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const itemId = String(req.params?.itemId || '');
      const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
      const row = await rejectImportItem({ itemId, reason });
      res.status(201).json({ data: row });
    } catch (e) { next(e); }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Import preview/commit (safe)
// ─────────────────────────────────────────────────────────────────────────────

type ExtractedUpload = { buffer: Buffer; fileName: string; fileType: 'csv' | 'xlsx' };
function extractUpload(req: AuthenticatedRequest): ExtractedUpload {
  const contentType = String(req.headers['content-type'] || '');
  const isMultipart = contentType.toLowerCase().startsWith('multipart/form-data');
  if (!isMultipart) throw badRequest('Expected multipart/form-data');
  const boundary = getBoundary(contentType);
  if (!boundary) throw badRequest('Missing multipart boundary');
  const fields = parseMultipart(req.body as Buffer, boundary);
  const file = fields.find((f): f is MultipartFile => 'buffer' in f && !!(f as MultipartFile).buffer);
  if (!file) throw badRequest('No file uploaded. Provide a file part named "file".');
  if (file.size > config.maxUploadBytes) throw payloadTooLarge(`File too large. Max size: ${config.maxUploadBytes} bytes`);
  if (!isValidFileType(file.filename, file.contentType, config.allowedUploadMime)) throw unsupportedMediaType(`File type not allowed: ${file.filename}`);
  const lower = (file.filename || '').toLowerCase();
  const fileType: 'csv' | 'xlsx' = lower.endsWith('.xlsx') ? 'xlsx' : 'csv';
  if (!lower.endsWith('.csv') && !lower.endsWith('.xlsx')) throw unsupportedMediaType('Only .csv or .xlsx supported');
  return { buffer: file.buffer, fileName: file.filename, fileType };
}

router.post('/admin/import/preview',
  ...requireAdminWrite,
  express.raw({ type: () => true, limit: config.maxUploadBytes }),
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const up = extractUpload(req);
      const countryFallback = typeof req.query?.country === 'string' ? String(req.query.country).toUpperCase() : undefined;
      const preview = await previewGlobalCatalogImport({ fileType: up.fileType, buffer: up.buffer, countryFallback });
      // Preview MUST NOT write.
      res.json({ data: preview });
    } catch (e) { next(e); }
  }
);

router.post('/admin/import/commit',
  ...requireAdminWrite,
  express.raw({ type: () => true, limit: config.maxUploadBytes }),
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const up = extractUpload(req);
      const countryFallback = typeof req.query?.country === 'string' ? String(req.query.country).toUpperCase() : undefined;
      const skipRowsWithoutIdentifier = String(req.query?.skipNoId || '').toLowerCase() === 'true';
      const out = await commitGlobalCatalogImport({
        fileType: up.fileType,
        buffer: up.buffer,
        countryFallback,
        skipRowsWithoutIdentifier,
        createdByUserId: req.user?.uid || null,
        source: { name: up.fileName, sourceType: up.fileType, countryCode: countryFallback || null },
      });
      res.status(201).json({ data: out });
    } catch (e) { next(e); }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin: API Import preview/commit (document JSON + saved mapping; NO fetch).
// Preview writes NOTHING. Commit uses the same transactional rules as file
// commit: matched -> safePatch, new identifier -> create + upsert, no-id and
// duplicates -> review_required, invalid -> rejected. Review stays on the
// existing approve/reject endpoints.
// ─────────────────────────────────────────────────────────────────────────────

router.post('/admin/api-import/preview',
  ...requireAdminWrite,
  express.json({ limit: '1mb' }),
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const body: any = req.body || {};
      const countryFallback = typeof req.query?.country === 'string' ? String(req.query.country).toUpperCase() : undefined;
      const out = await previewApiImportDocument(body.document, body.mapping, { countryFallback });
      // Preview MUST NOT write.
      res.json({ data: { source: 'api', mapping: out.mapping, resolved: out.resolved, items: out.preview.items, summary: out.preview.summary } });
    } catch (e) { next(e); }
  }
);

router.post('/admin/api-import/commit',
  ...requireAdminWrite,
  express.json({ limit: '1mb' }),
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const body: any = req.body || {};
      const countryFallback = typeof req.query?.country === 'string' ? String(req.query.country).toUpperCase() : undefined;
      const name = String(body.sourceName || body.name || 'api-source').trim() || 'api-source';
      const out = await previewApiImportDocument(body.document, body.mapping, { countryFallback });
      const result = await commitApiImportRows(out.preview.items as any, {
        source: { name, sourceType: 'api', countryCode: countryFallback || null },
        createdByUserId: req.user?.uid || null,
        documentSha256: sha256Json({ document: body.document ?? null, mapping: out.mapping }),
      });
      res.status(201).json({ data: result });
    } catch (e) { next(e); }
  }
);

export const globalCatalogRouter = router;
