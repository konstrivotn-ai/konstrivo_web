/**
 * Phase 2 — Supplier Import Routes (/api/v1/suppliers)
 *
 * POST /upload              — upload CSV/XLSX metadata (isolated, no catalog mutation)
 * GET  /imports/:id         — get import status + parsed items
 * POST /imports/:id/approve — approve an import (requires SUPPLIER_IMPORT_APPROVE)
 *
 * State machine: UPLOADED → PARSED → PENDING_APPROVAL → APPROVED → PUBLISHED
 */
import { Router, Response } from 'express';
import express from 'express';
import { supplierImportRepository } from '../../repositories/supplierImportRepository';
import { materialRepository } from '../../repositories/materialRepository';
import {
  authenticate, requireEntitlement, AuthenticatedRequest,
} from '../../middleware/auth';
import { requireFeature } from '../../middleware/features';
import { handleUpload, getField, getFile, UploadRequest } from '../../middleware/upload';
import { parseCsv, CsvRow } from '../../utils/csv';
import { sha256Hex, generateId } from '../../utils/crypto';
import { notFound, badRequest, forbidden, conflict, unsupportedMediaType } from '../../utils/errors';
import { SupplierCatalogItem } from '../../types';
import { incrementUsage } from '../../services/featureService';
import { submitPendingPriceUpdate } from '../../repositories/drizzlePriceRepository';
import { buildSupplierCsvPendingPlan } from '../../priceSources/supplierCsv';
import { listSuppliers } from '../../repositories/globalCatalogRepository';

const router = Router();

// ── GET / ────────────────────────────────────────────────────────────────────
// Phase "Country + Supplier + Prices" — READ-ONLY supplier listing (ADDITIVE).
//
// Registered at the TOP of the router on purpose: it is the only `GET /` here,
// so it cannot shadow `/upload` (POST), `/imports/:id` (GET) or
// `/imports/:id/approve` (POST), whose paths are all distinct and longer.
//
// - AUTHENTICATED read, matching the convention of EVERY other route in this
//   router (`/upload`, `/imports/:id`, `/imports/:id/approve` all start with
//   `authenticate`). Anonymous and bad-token callers get 401 before any DB
//   read. The projection ALSO omits every internal field
//   (`legalRegistrationNumber`, `contactEmail`, `contactPhone`, `address`,
//   `version`, `isDeleted`), so no registry/PII data is exposed even to a
//   logged-in user.
// - Soft-deleted suppliers are never returned (repository filter).
// - Optional `country` / `search` / `verified` filters; an invalid filter is
//   refused with 400 instead of being silently ignored.
// - No write verb is registered on this path.

router.get('/',
  authenticate,
  async (req: any, res: Response, next) => {
  try {
    const read = (v: any): string | undefined => (typeof v === 'string' ? v : undefined);
    const out = await listSuppliers({
      country: read(req.query?.country) ?? read(req.query?.countryCode),
      search: read(req.query?.search) ?? read(req.query?.q),
      verified: read(req.query?.verified),
      limit: read(req.query?.limit),
      offset: read(req.query?.offset),
    });
    res.json({ data: out.data, total: out.total });
  } catch (err) { next(err); }
  }
);

// ── POST /upload ──────────────────────────────────────────────────────────

router.post('/upload',
  authenticate,
  // ── F9 (Phase 3 audit) — REAL server-side enforcement for supplier:products ──
  // The matrix row is scope='supplier' with a FREE 10/month usage limit; before
  // F9 this entry had no feature gate at all, so the GET /api/v1/features
  // answer could disagree with the route. Same middleware pair as POST
  // /api/v1/projects (requireFeature): admins bypass, the ALL_FEATURES_FREE
  // switch still applies, FREE suppliers pass (freeAccess=true) until the
  // usage limit is reached (counted on success below). F8's ROLE_SCOPE makes
  // fournisseur/vendor pass the 'supplier' scope while other roles get 403.
  requireFeature('supplier:products'),
  express.raw({ type: ['multipart/form-data', 'text/csv'], limit: '10mb' }),
  handleUpload,
  async (req: UploadRequest & AuthenticatedRequest, res: Response, next) => {
    try {
      const file = req.uploadedFiles?.[0];
      const contentType = req.headers['content-type'] || '';

      // Accept raw text/csv body OR multipart file
      let csvContent: string | null = null;
      let fileName = 'upload.csv';
      let mimeType = 'text/csv';
      let fileBuffer: Buffer | null = null;

      if (file) {
        fileBuffer = file.buffer;
        csvContent = file.value;
        fileName = file.filename || 'upload.csv';
        mimeType = file.contentType || mimeType;
      } else if (Buffer.isBuffer(req.body)) {
        fileBuffer = req.body;
        csvContent = req.body.toString('utf8');
      }

      if (!fileBuffer || !csvContent) {
        throw badRequest('No file uploaded. Provide a CSV/XLSX file.');
      }
      if (!fileName.toLowerCase().endsWith('.csv')) {
        throw unsupportedMediaType(`Only .csv files supported in Phase 2. Got: ${fileName}`);
      }
      const lowerType = mimeType.toLowerCase();
      if (!lowerType.includes('csv') && !lowerType.includes('excel') && !lowerType.includes('spreadsheet') && !lowerType.includes('multipart')) {
        throw unsupportedMediaType(`Unsupported media type: ${mimeType}. Use text/csv.`);
      }

      const sha256 = sha256Hex(fileBuffer);
      const supplierName = getField(req.uploadedFields, 'supplierName')
        || req.body?.supplierName
        || undefined;

      const imp = supplierImportRepository.create({
        fileName,
        fileSizeBytes: fileBuffer.length,
        fileSha256: sha256,
        fileMimeType: mimeType,
        supplierId: req.user?.companyId,
        supplierName,
      });

      // Step 11 — explicit market/currency for the WHOLE file (form fields or
      // query-style body fields). No hidden mixing: an FR/EUR file must be
      // uploaded with countryCode=FR&currencyCode=EUR. The endpoint's
      // documented home default is TN/TND (the supplier portal's market).
      const countryCode = String(getField(req.uploadedFields, 'countryCode') || req.body?.countryCode || 'TN').toUpperCase();
      const currencyCode = String(getField(req.uploadedFields, 'currencyCode') || req.body?.currencyCode || 'TND').toUpperCase();
      const pendingSummary = { submitted: 0, unmapped: 0, invalid: [] as string[], market: countryCode, currency: currencyCode };

      // Parse CSV rows → SupplierCatalogItem[] (ISOLATED — never mutates official data)
      try {
        const rows: CsvRow[] = parseCsv(csvContent);
        const items: SupplierCatalogItem[] = await Promise.all(rows.map(async row => {
          const nameFr = row['Designation'] || row['nameFr'] || '';
          const category = row['Categorie'] || row['category'] || row['trade'] || '';
          const unit = row['Unite'] || row['unit'] || 'unit';
          const priceStr = row['Prix_HT_TND'] || row['price'] || '0';
          const priceTnd = parseFloat(String(priceStr).replace(',', '.')) || 0;
          const materialCode = row['Reference'] || row['materialCode'] || '';

          // Try to match against official materials (read-only lookup)
          const matched = await (materialRepository as any).findByCode(materialCode);

          return {
            id: generateId(),
            importId: imp.id,
            materialCode: materialCode || undefined,
            nameFr,
            category,
            unit,
            priceTnd,
            tvaIncluded: false,
            matchedMaterialId: matched?.id,
            matchedRateId: matched?.code,
            status: (matched ? 'matched' : 'unmatched') as SupplierCatalogItem['status'],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        }));
        supplierImportRepository.setParsedItems(imp.id, items);

        // Step 11 — route matched rows into the PENDING pipeline instead of
        // dropping them. Mapping is by materials.code (already done above via
        // findByCode); unmatched codes are reported, NEVER auto-created.
        // submitPendingPriceUpdate writes SUPPLIER_SUBMITTED / is_current=false /
        // company_id=NULL rows only — the official price stays untouched until
        // an explicit Admin approve (Step 8 review UI).
        const plan = buildSupplierCsvPendingPlan(items, {
          countryCode,
          currencyCode,
          supplierId: imp.supplierId,
          fileName,
        });
        pendingSummary.unmapped = plan.unmapped.length;
        for (const s of plan.submissions) {
          try {
            await submitPendingPriceUpdate({
              materialCode: s.materialCode,
              price: s.price,
              countryCode: s.countryCode,
              currencyCode: s.currencyCode,
              supplierId: s.supplierId,
              effectiveFrom: s.effectiveFrom,
              notes: s.notes,
            });
            pendingSummary.submitted++;
          } catch (subErr) {
            pendingSummary.invalid.push(`${s.materialCode}: ${(subErr as Error).message}`);
          }
        }
        for (const inv of plan.invalid) pendingSummary.invalid.push(inv.reason);
      } catch (parseErr) {
        // Parsing failure keeps the import in UPLOADED state with a note.
      }

      const updated = supplierImportRepository.findById(imp.id)!;
      // ── F9 — server-side usage for supplier:products (counted ONLY after a
      // successful import and before the 201): same guarded pattern as
      // devis:create / projects:save, so the FREE 10/month limit reported by
      // GET /api/v1/features reflects real consumption. Non-blocking.
      try {
        await incrementUsage(req.user!.uid, 'supplier:products');
      } catch { /* non-blocking: usage recording never fails the request */ }
      res.status(201).json({ data: updated, pendingPriceUpdates: pendingSummary });
    } catch (err) { next(err); }
  }
);

// ── GET /imports/:id ──────────────────────────────────────────────────────

router.get('/imports/:id',
  authenticate,
  (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const imp = supplierImportRepository.findById(req.params.id);
      if (!imp) throw notFound(`Import '${req.params.id}' not found`);
      // Company isolation
      if (req.user!.role !== 'admin' && imp.supplierId && imp.supplierId !== req.user!.companyId) {
        throw forbidden('You do not have access to this import');
      }
      res.json({ data: imp });
    } catch (err) { next(err); }
  }
);

// ── POST /imports/:id/approve ─────────────────────────────────────────────
// Requires SUPPLIER_IMPORT_APPROVE. Does NOT publish to official catalog.

router.post('/imports/:id/approve',
  authenticate,
  requireEntitlement('SUPPLIER_IMPORT_APPROVE'),
  (req: AuthenticatedRequest, res: Response, next) => {
    try {
      const imp = supplierImportRepository.findById(req.params.id);
      if (!imp) throw notFound(`Import '${req.params.id}' not found`);

      if (imp.status === 'APPROVED') {
        return res.status(200).json({ data: imp, message: 'Already approved' });
      }
      if (!['PARSED', 'PENDING_APPROVAL'].includes(imp.status)) {
        throw conflict(`Cannot approve import in status '${imp.status}'. Expected PARSED or PENDING_APPROVAL.`);
      }

      const approved = supplierImportRepository.setStatus(req.params.id, 'APPROVED', {
        approvedAt: new Date().toISOString(),
        approvedByUserId: req.user!.uid,
      });

      // NOTE: We do NOT modify official Materials or official Prices here.
      // Publishing to the official catalog is a separate controlled action.

      res.json({ data: approved, message: 'Import approved. Publishing requires a separate explicit action.' });
    } catch (err) { next(err); }
  }
);

export { router as suppliersRouter };
