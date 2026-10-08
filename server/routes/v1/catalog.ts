import { Router, Response } from 'express';
import express from 'express';
import { authenticate, requireEntitlement, requireRole, optionalAuth, AuthenticatedRequest } from '../../middleware/auth';
import { createLimiter } from '../../middleware/rateLimit';
import { getPriceSourceSpec, normalizeConnectorCandidate, type PriceSourceSpec } from '../../priceSources/connector';
import { runSaudiGastatUpdate } from '../../priceSources/saudiPipeline';
import { toGastatRows } from '../../priceSources/saudiConstruction';
import { validateBody, roundMoney } from '../../utils/validation';
import { badRequest, payloadTooLarge, unsupportedMediaType } from '../../utils/errors';
import { config } from '../../config';
import { getBoundary, parseMultipart, isValidFileType, MultipartFile } from '../../utils/multipart';
import { parseCsv, parseCatalogCsv } from '../../utils/csv';
import { parseXlsxToRows } from '../../utils/xlsx';
import {
  IMPORT_MAX_ROWS,
  resolveMapping,
  normalizeAndValidateRows,
  commitValidRows,
  REQUIRED_FIELD_KEYS,
  PREVIEW_FIELDS,
  extractDefaultTrade,
  type ValidImportRow,
  type FailedRow,
} from '../../services/catalogImport';
import {
  upsertOfficialPrice,
  submitPendingPriceUpdate,
  listPendingPriceUpdates,
  approvePendingPriceUpdate,
} from '../../repositories/drizzlePriceRepository';
import { upsertMaterialByCode } from '../../repositories/drizzleMaterialRepository';
import { materialRepository } from '../../repositories/materialRepository';
import { calcRepository } from '../../repositories/calcRepository';
import { tradeRepository } from '../../repositories/tradeRepository';

const router = Router();
const priceUpdateLimiter = createLimiter('default', { max: 5, windowMs: 15 * 60 * 1000 });

// ── F17 (Phase 3 Batch 2) — admin defense-in-depth for ADMIN WRITE routes ───
// Mirrors the trades.ts guard: authenticate + requireEntitlement
// ('CATALOG_OFFICIAL_MANAGE') + requireRole('admin'). Read-only routes and
// /admin/price-update/run (own second factor: X-Price-Update-Token) are
// intentionally untouched.
const requireAdminWrite = [
  authenticate,
  requireEntitlement('CATALOG_OFFICIAL_MANAGE'),
  requireRole('admin'),
];

// Step 16 — Protected Price Update HTTP Endpoint
// Auth: JWT + CATALOG_OFFICIAL_MANAGE entitlement + X-Price-Update-Token header.
router.post('/admin/price-update/run',
  priceUpdateLimiter,
  authenticate,
  requireEntitlement('CATALOG_OFFICIAL_MANAGE'),
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const tokenHeader = req.headers['x-price-update-token'];
      const secret = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
      const expectedSecret = process.env.PRICE_UPDATE_CRON_SECRET;
      if (!secret || !expectedSecret || secret !== expectedSecret) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const sourceCode = typeof req.body?.sourceCode === 'string' ? req.body.sourceCode : undefined;
      if (!sourceCode) {
        return res.status(400).json({ error: 'Invalid or missing sourceCode' });
      }

      const spec = getPriceSourceSpec(sourceCode);
      if (!spec || !spec.enabled) {
        return res.status(501).json({ error: `Source '${sourceCode}' not registered or not implemented` });
      }

      if (sourceCode === 'SOURCE_SA_GASTAT') {
        // Official GASTAT rows supplied by the authorized caller (transcribed from
        // the officially downloaded GASTAT monthly file). No live fetch, no cron and
        // no invented data: an absent/empty `rows` array keeps the historical
        // "no data available" response below.
        const rows = toGastatRows(req.body?.rows);
        if (rows.length === 0) {
          return res.status(501).json({
            sourceCode,
            market: 'SA',
            currency: 'SAR',
            submitted: 0,
            rejected: 0,
            errors: ['GASTAT data source not available: no official rows supplied. POST { sourceCode: "SOURCE_SA_GASTAT", rows: [{ label, unit, price, month }] } with rows transcribed from the officially downloaded GASTAT monthly file — prices are never fetched live or invented.'],
          });
        }

        const result = await runSaudiGastatUpdate(rows);
        return res.json({
          sourceCode,
          market: 'SA',
          currency: 'SAR',
          submitted: result.submitted,
          rejected: result.rejected,
          errors: result.errors,
        });
      }

      return res.status(501).json({
        error: `No orchestration registered for source '${sourceCode}'`,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Step 5 — Official Catalog Management (/api/v1/catalog)
 *
 * POST /catalog/upsert — idempotently create or update an OFFICIAL material
 * together with its OFFICIAL_DEFAULT current price. Requires the
 * CATALOG_OFFICIAL_MANAGE entitlement (admin / ENTERPRISE).
 *
 * Official prices are public (company_id = NULL) and never touch
 * company-specific CUSTOM or supplier prices.
 */

router.post('/upsert',
  ...requireAdminWrite,
  validateBody([
    { field: 'code', label: 'Material Code', required: true, type: 'string' },
    { field: 'price', label: 'Price', required: true, type: 'number', min: 0 },
    { field: 'nameFr', label: 'Name (FR)', required: true, type: 'string' },
  ]),
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const { code, price, nameFr, nameAr, nameEn, trade, category, unit, currencyCode, countryCode, effectiveFrom, technicalSpecs } = req.body || {};

      if (price < 0) throw badRequest('Price must be >= 0');

      const material = await upsertMaterialByCode({
        code,
        trade: trade || category || 'placo',
        category: category || trade || 'placo',
        nameFr,
        nameAr: nameAr || null,
        nameEn: nameEn || null,
        baseUnit: unit || 'unit',
        technicalSpecs: technicalSpecs || null,
      });

      const priceRow = await upsertOfficialPrice({
        materialCode: code,
        price: roundMoney(price),
        currencyCode,
        countryCode,
        effectiveFrom,
      });

      // Phase 2: attempt to create a calc link when a reliable rule exists.
      try {
        if (material && material.id) {
          const rule = await calcRepository.findRuleForMaterial({ code: material.code, materialId: material.id, trade: material.trade });
          if (rule) {
            await calcRepository.upsertMaterialCalcLink({ materialId: material.id, slotCode: rule.slotCode, ruleCode: rule.ruleCode, matchKey: rule.legacyKey || material.id });
          }
        }
      } catch (e) {
        // Non-fatal: do not block the administrative upsert for calc linking issues.
        // eslint-disable-next-line no-console
        console.warn('Calc linking skipped during /catalog/upsert:', e?.message || e);
      }

      res.status(200).json({ data: { material, price: priceRow } });
    } catch (err) { next(err); }
  }
);

// ── Phase A + B + C — Admin bulk catalog import (transactional) ──────────────
// POST /catalog/import-csv   (Phase A — CSV only, contract UNCHANGED)
// POST /catalog/preview      (Phase C — CSV + XLSX, mapping + preview, no write)
// POST /catalog/import       (Phase C — CSV + XLSX, mapping + transactional write)
//
// ALL parsing, validation and persistence happen SERVER-SIDE:
//   - Accepts multipart/form-data (file part "file") OR a raw body
//     (text/csv for CSV, application/vnd.openxmlformats-...sheet for XLSX).
//   - CSV and XLSX go through the SAME pipeline (services/catalogImport.ts):
//     Parser → Column Detection → Smart Mapping → Canonical Normalization →
//     Validation → ONE transaction (materials + official prices).
//   - EVERY row is validated BEFORE any database write; if ANY row is invalid
//     the import is aborted with 400 and NOTHING is written (all-or-nothing).
//   - Unknown trade codes are auto-created as dynamic (non-official) trades
//     so newly imported trades become immediately available in the trade
//     selection UI without a hardcoded TypeScript/React entry (Phase B).
//
// Reuses the existing building blocks (no schema change):
//   multipart validation (utils/multipart + config limits), the shared CSV
//   parser (utils/csv), the safe XLSX reader (utils/xlsx), the Step 5
//   official upserts and the CATALOG_OFFICIAL_MANAGE entitlement.

/** Raw-body content types accepted by the import endpoints. */
const IMPORT_RAW_TYPES = [
  'multipart/form-data',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
];

interface ExtractedUpload {
  buffer: Buffer;
  fileName: string;
  fileType: 'csv' | 'xlsx';
  countryCode: string;
  currencyCode: string;
  /** P1 — explicit "Métier par défaut" (undefined = not provided / blank). */
  defaultTrade?: string;
  /** PHASE 1 — optional stable source identity (never filename alone). */
  sourceRef?: string;
}

interface ParsedImportFile {
  fileType: 'csv' | 'xlsx';
  sheetName?: string;
  headerRowNumber?: number;
  headers: string[];
  rows: Array<Record<string, string>>;
}

/**
 * Extract + validate the uploaded file from a multipart form or a raw body.
 * Keeps every Phase A protection: upload size limit, allowed MIME types,
 * extension whitelist. When `csvOnly` is set (Phase A endpoint) only .csv is
 * accepted, with the exact Phase A error messages.
 */
function extractImportUpload(
  req: AuthenticatedRequest,
  opts: { csvOnly: boolean }
): ExtractedUpload {
  const contentType = String(req.headers['content-type'] || '');
  const isMultipart = contentType.toLowerCase().startsWith('multipart/form-data');

  let fileRaw: Buffer | null = null;
  let fileName = 'import.csv';
  let formCountryCode: string | undefined;
  let formCurrencyCode: string | undefined;
  let formDefaultTrade: string | undefined;
  // PHASE 1 — optional stable source identity (multipart part or ?sourceRef=).
  let formSourceRef: string | undefined;

  if (isMultipart) {
    const boundary = getBoundary(contentType);
    if (!boundary) throw badRequest('Missing multipart boundary');
    const fields = parseMultipart(req.body as Buffer, boundary);
    const file = fields.find((f): f is MultipartFile => 'buffer' in f && !!(f as MultipartFile).buffer);
    if (!file) throw badRequest('No CSV file uploaded. Provide a file part named "file".');
    // Same upload validation rules as the existing upload middleware.
    if (file.size > config.maxUploadBytes) {
      throw payloadTooLarge(`File too large. Max size: ${config.maxUploadBytes} bytes`);
    }
    if (!isValidFileType(file.filename, file.contentType, config.allowedUploadMime)) {
      throw unsupportedMediaType(`File type not allowed: ${file.filename}`);
    }
    const lowerName = (file.filename || '').toLowerCase();
    if (opts.csvOnly && !lowerName.endsWith('.csv')) {
      throw unsupportedMediaType(`Only .csv files are supported in Phase A (no Excel yet). Got: ${file.filename || 'unnamed'}`);
    }
    if (!opts.csvOnly && !lowerName.endsWith('.csv') && !lowerName.endsWith('.xlsx')) {
      throw unsupportedMediaType(`Only .csv and .xlsx files are supported. Got: ${file.filename || 'unnamed'}`);
    }
    if (lowerName.endsWith('.xls')) {
      // Legacy binary Excel format — deliberately unsupported (BIFF is not a
      // safe OOXML zip; it is NOT parsed by utils/xlsx).
      throw unsupportedMediaType(`Legacy .xls is not supported. Re-save the file as .xlsx. Got: ${file.filename}`);
    }
    fileRaw = file.buffer;
    fileName = file.filename || 'import.csv';
    for (const f of fields) {
      if ('buffer' in f) continue;
      if (f.name === 'countryCode') formCountryCode = f.value;
      if (f.name === 'currencyCode') formCurrencyCode = f.value;
      if (f.name === 'defaultTrade') formDefaultTrade = f.value;
      if (f.name === 'sourceRef' || f.name === 'source_ref') formSourceRef = f.value;
    }
  } else if (Buffer.isBuffer(req.body) && (req.body as Buffer).length > 0) {
    const isCsv = contentType.toLowerCase().includes('csv');
    const isXlsx = contentType.toLowerCase().includes('spreadsheetml') || contentType.toLowerCase().includes('octet-stream');
    if (opts.csvOnly && !isCsv) {
      throw unsupportedMediaType(`Unsupported media type: ${contentType || 'none'}. Use multipart/form-data or text/csv.`);
    }
    if (!opts.csvOnly && !isCsv && !isXlsx) {
      throw unsupportedMediaType(`Unsupported media type: ${contentType || 'none'}. Use multipart/form-data, text/csv or the .xlsx MIME type.`);
    }
    fileRaw = req.body as Buffer;
    fileName = isCsv ? 'import.csv' : 'import.xlsx';
  }

  if (!fileRaw || fileRaw.length === 0) {
    throw badRequest('No CSV file uploaded. Provide a multipart file part named "file" or a raw text/csv body.');
  }

  // ── One market + one currency for the WHOLE file (TN/TND home default) ───
  const countryCode = (formCountryCode || (req.query.countryCode as string | undefined) || 'TN').trim().toUpperCase();
  const currencyCode = (formCurrencyCode || (req.query.currencyCode as string | undefined) || 'TND').trim().toUpperCase();
  // PHASE 1 — optional stable source identity (Country + Catalog/Version
  // identity comes from the DB version row + content hash; filename alone is
  // never identity, but an explicit sourceRef helps operators track feeds).
  const sourceRef = (formSourceRef !== undefined ? formSourceRef : (req.query.sourceRef as string | undefined));
  if (!/^[A-Z]{2,3}$/.test(countryCode)) throw badRequest(`Invalid countryCode: '${countryCode}'`);
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw badRequest(`Invalid currencyCode: '${currencyCode}'`);

  // P1 — optional explicit "Métier par défaut" (multipart field or ?defaultTrade=).
  // Multipart wins over query, mirroring countryCode/currencyCode. Only used by
  // the Phase C endpoints (preview + import); the Phase A /import-csv route
  // keeps its unchanged contract and never reads this field.
  const defaultTrade = extractDefaultTrade(
    formDefaultTrade !== undefined ? formDefaultTrade : (req.query.defaultTrade as string | undefined)
  );
  if (defaultTrade && defaultTrade.length > 50) {
    throw badRequest(`Invalid defaultTrade: '${defaultTrade}'. Maximum 50 characters (trade code column limit).`);
  }

  return {
    buffer: fileRaw,
    fileName,
    fileType: fileName.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv',
    countryCode,
    currencyCode,
    defaultTrade,
    sourceRef: typeof sourceRef === 'string' && sourceRef.trim() !== '' ? sourceRef.trim().slice(0, 255) : undefined,
  };
}

/**
 * Parse an extracted upload into raw rows keyed by RAW header text.
 * CSV uses the shared parser (headers = first line, Phase A behaviour);
 * XLSX uses the safe ExcelJS reader (headers detected in the first rows).
 */
async function parseImportFile(upload: ExtractedUpload): Promise<ParsedImportFile> {
  if (upload.fileType === 'xlsx') {
    // parseXlsxToRows never throws; structural problems come back as { ok: false }.
    const parsed = await parseXlsxToRows(upload.buffer);
    if ('error' in parsed) throw badRequest(parsed.error);
    return {
      fileType: 'xlsx',
      sheetName: parsed.sheetName,
      headerRowNumber: parsed.headerRowNumber,
      headers: parsed.headers,
      rows: parsed.rows,
    };
  }
  const csvContent = upload.buffer.toString('utf8').replace(/^\uFEFF/, '');
  const parsedCsv = parseCatalogCsv(csvContent);
  const rows = parsedCsv.rows;
  if (rows.length === 0) throw badRequest('CSV file is empty or has no header row.');
  return {
    fileType: 'csv',
    headers: parsedCsv.headers,
    rows,
  };
}

/** Read the optional Smart-Mapping override (multipart field or ?mapping= query). */
function extractMappingOverride(req: AuthenticatedRequest): Record<string, string> | undefined {
  let raw: string | undefined;
  const contentType = String(req.headers['content-type'] || '');
  if (contentType.toLowerCase().startsWith('multipart/form-data')) {
    const boundary = getBoundary(contentType);
    if (boundary) {
      const fields = parseMultipart(req.body as Buffer, boundary);
      const field = fields.find((f) => f.name === 'mapping' && !('buffer' in f));
      if (field) raw = field.value;
    }
  }
  if (!raw) {
    const q = req.query.mapping;
    if (typeof q === 'string' && q !== '') raw = q;
  }
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const mapping: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) mapping[k] = String(v);
      return mapping;
    }
    throw new Error('not an object');
  } catch {
    throw badRequest("Invalid 'mapping' payload: expected a JSON object of { canonicalField: sourceColumn }.");
  }
}

// ── Shared pipeline runner (parse → smart mapping → validate) ────────────────
// NO database write happens here. Used by the Phase A CSV import, the
// Phase C preview and the Phase C import.

interface PipelineRun {
  upload: ExtractedUpload;
  parsed: ParsedImportFile;
  mapping: ReturnType<typeof resolveMapping>;
  valid: ValidImportRow[];
  failed: FailedRow[];
  /** P1 — echoed default trade (undefined = not provided). */
  defaultTrade?: string;
}

async function runImportPipeline(
  req: AuthenticatedRequest,
  opts: { csvOnly: boolean; mappingOverride?: Record<string, string> }
): Promise<PipelineRun> {
  const upload = extractImportUpload(req, opts);
  const parsed = await parseImportFile(upload);
  // `parsed.rows` is passed as the 4th argument so the preview shows a REAL,
  // non-empty value per detected column (a first row is often empty for
  // optional columns) AND so the engine can profile each column by the MEANING
  // of its values (a column of links is never auto-mapped to a price/name/date).
  const mapping = resolveMapping(parsed.headers, parsed.rows[0], opts.mappingOverride, parsed.rows);
  const { valid, failed } = await normalizeAndValidateRows(
    parsed.rows,
    mapping.appliedMapping,
    {
      countryCode: upload.countryCode,
      currencyCode: upload.currencyCode,
    },
    // P1 — the explicit admin "Métier par défaut" resolves rows that have no
    // trade column value. Deterministic: /preview and /import see the SAME
    // resolution. Phase A (/import-csv, csvOnly) NEVER receives it — its
    // missing-required-column contract is byte-identical (→ 400 trade_code).
    opts.csvOnly ? undefined : upload.defaultTrade,
    // Universal per-row name fallback chain (nom_fr / name_en / name_ar…):
    // computed by the SAME resolveMapping call as the applied mapping, so
    // /preview and /import always fall back identically. Phase A (csvOnly)
    // never receives it — its row validation messages stay byte-identical.
    opts.csvOnly ? undefined : mapping.nameFallbackHeaders,
    // CATALOG-ONLY — computed by the SAME resolveMapping call above, so
    // /preview, /import and Phase A all agree on whether THIS file carries a
    // price column. When it does, nothing changes (every price cell is still
    // validated exactly as before).
    { catalogOnly: mapping.catalogOnly }
  );
  return { upload, parsed, mapping, valid, failed, defaultTrade: upload.defaultTrade };
}

/** All-or-nothing guard for the Phase A /import-csv contract (UNCHANGED: one
 * invalid row still refuses the WHOLE file there). The universal Smart-Mapping
 * /import is deliberately per-row instead — see `splitImportableRows`. */
function invalidRowsResponse(res: Response, run: PipelineRun) {
  // Nothing has been written — validation ran before any database access,
  // which IS the full-rollback guarantee for invalid files.
  return res.status(400).json({
    error: {
      code: 'BAD_REQUEST',
      message: `Import aborted: ${run.failed.length} invalid row(s). No data was written (all-or-nothing import).`,
    },
    data: {
      fileName: run.upload.fileName,
      totalRows: run.parsed.rows.length,
      committed: false,
      imported: 0,
      updated: 0,
      failed: run.failed,
    },
  });
}

/**
 * Universal per-row partition (Smart-Mapping /preview + /import — ONE shared,
 * deterministic definition so the preview counts and the import outcome can
 * never disagree):
 *
 *   • `run.failed` rows (empty price, link-as-price, bad TVA/date/currency,
 *     missing name…) are already per-row rejections from the normalizer.
 *   • A row with NO trade column value and no explicit admin `defaultTrade` is
 *     still importable: the engine refuses to INVENT a métier (a grouping such
 *     as 'Building Materials' / 'Cement & Binders' is never a trade), so the
 *     row keeps the documented `unmapped_review` review sentinel and its
 *     « Missing Categorie (trade) — requires review. » note. A realistic
 *     supplier file whose only grouping columns are not métiers therefore
 *     imports (the note is published in `reviewWarnings`) instead of being
 *     reported as 0 importable / N rejected.
 *
 * Everything left is importable. Nothing here knows any file, trade or header
 * spelling — it consumes only the generic validation output.
 */
function splitImportableRows(run: PipelineRun): { importable: ValidImportRow[]; rejected: FailedRow[] } {
  const importable: ValidImportRow[] = run.valid;
  const rejected = [...run.failed].sort((a, b) => a.row - b.row);
  return { importable, rejected };
}

router.post('/import-csv',
  ...requireAdminWrite,
  express.raw({ type: ['multipart/form-data', 'text/csv'], limit: '10mb' }),
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      // ── 1) Extract, parse, smart-map and validate the file (CSV only —
      //       the Phase A endpoint keeps its .csv-only contract).
      const run = await runImportPipeline(req, { csvOnly: true });

      // Required columns must be resolvable from the file headers.
      // CATALOG-ONLY: a Master Catalog file that carries NO price column at
      // all does not have to provide `price_ht` (it imports as material-only,
      // no price invented) — every OTHER required column still blocks with the
      // exact same message and contract.
      const missingHeaderColumns = run.mapping.unmappedRequired.filter(
        (k) => !(k === 'price_ht' && run.mapping.catalogOnly)
      );
      if (missingHeaderColumns.length > 0) {
        throw badRequest(
          `CSV header is missing required column(s): ${missingHeaderColumns.join(', ')}. ` +
          'Expected headers: Reference;Nom_Materiau;Categorie;Unite;Prix_TND_HT;Note_Technique;Nom_Arabe'
        );
      }
      if (run.parsed.rows.length > IMPORT_MAX_ROWS) {
        throw badRequest(`Too many rows (${run.parsed.rows.length}). Maximum ${IMPORT_MAX_ROWS} rows per import.`);
      }

      // ── 2) Validate EVERY row BEFORE touching the database (all-or-nothing)
      if (run.failed.length > 0) { return invalidRowsResponse(res, run); }

      // Phase A contract: a blank/missing Reference (material_code) in any
      // data row is a hard failure for the CSV-only endpoint. The shared
      // normalizer may generate a stable `material_code` for Phase C files
      // (to support supplier imports), but the Phase A endpoint must NOT
      // accept generated codes — reject the file and preserve full rollback.
      const generatedRows = run.valid.filter(v => v.review && v.review.includes('Generated material_code from material name'));
      if (generatedRows.length > 0) {
        const failedRows = generatedRows.map((r) => ({ row: r.row, reference: r.reference, reason: 'Missing Reference (stable material code).' }));
        return res.status(400).json({
          error: {
            code: 'BAD_REQUEST',
            message: `Import aborted: ${failedRows.length} invalid row(s). No data was written (all-or-nothing import).`,
          },
          data: {
            fileName: run.upload.fileName,
            totalRows: run.parsed.rows.length,
            committed: false,
            imported: 0,
            updated: 0,
            failed: failedRows,
          },
        });
      }

      // ── 2b) Phase A contract (src/lib/api.ts): /import-csv REFUSES unknown
      // (non-official) trades. They are never coerced to a default AND they are
      // never auto-created here — dynamic trades (Phase B) are registered via
      // the trade registry / the mapped /catalog/import endpoint. All-or-nothing:
      // if any row has an unknown trade the WHOLE file is refused, nothing written.
      if (run.valid.length > 0) {
        const officialCodes = new Set((await tradeRepository.list(true)).map((t) => t.code));
        const unknownTradeRows = run.valid.filter((row) => !row.trade || !officialCodes.has(row.trade));
        if (unknownTradeRows.length > 0) {
          const failed: FailedRow[] = unknownTradeRows.map((row) => ({
            row: row.row,
            reference: row.reference,
            reason: `Unknown trade '${row.trade}' — refused. Dynamic trades (Phase B) require the mapped /api/v1/catalog/import endpoint.`,
          }));
          return res.status(400).json({
            error: {
              code: 'BAD_REQUEST',
              message: `Import aborted: ${failed.length} row(s) with unknown trade. No data was written (all-or-nothing import).`,
            },
            data: {
              fileName: run.upload.fileName,
              totalRows: run.parsed.rows.length,
              committed: false,
              imported: 0,
              updated: 0,
              failed,
            },
          });
        }
      }

      // ── 3) Commit: dynamic trades (Phase B) + ONE transaction (materials +
      //       official prices). Any database failure rolls the WHOLE batch back.
      //       PHASE 1: Country + content-hash version row is created inside the
      //       same transaction (new ACTIVE version; history kept).
      const commit = await commitValidRows(run.valid, {
        countryCode: run.upload.countryCode,
        currencyCode: run.upload.currencyCode,
      }, { fileName: run.upload.fileName, sourceRef: run.upload.sourceRef });
      // `in` narrowing (the project compiles without strictNullChecks).
      if ('message' in commit) {
        return res.status(500).json({
          error: { code: 'INTERNAL_ERROR', message: commit.message },
          data: {
            fileName: run.upload.fileName,
            totalRows: run.parsed.rows.length,
            committed: false,
            imported: 0,
            updated: 0,
            failed: commit.failedRows,
          },
        });
      }

      return res.status(200).json({
        data: {
          fileName: run.upload.fileName,
          totalRows: run.parsed.rows.length,
          committed: true,
          imported: commit.imported,
          updated: commit.updated,
          failed: [],
          results: commit.results,
          countryCode: run.upload.countryCode,
          currencyCode: run.upload.currencyCode,
          catalog: (commit as any).catalog || undefined,
        },
      });
    } catch (err) { next(err); }
  }
);

// ── GET /catalog/inactive-refs — DB truth for archived/deactivated refs ──────
// Admin archive/deactivate actions write the database (`materials.is_deleted`,
// `trades.is_active`). Every client (Outils / Services / Tarifs) also keeps a
// LOCAL barème cache which must never revive an item the DB no longer serves.
// This additive read-only endpoint exposes ONLY the reference codes that are
// archived/deactivated (no price, no name, no user data), so all clients can
// suppress them locally and stay aligned with the database. It fails CLOSED:
// if the DB cannot be read the request errors (500) and the client keeps its
// previously known list instead of receiving an empty one.
router.get('/inactive-refs', optionalAuth, async (_req: AuthenticatedRequest, res: Response, next: any) => {
  try {
    const trades = await tradeRepository.list(false, true);
    const tradeCodes = (Array.isArray(trades) ? trades : [])
      .filter((t: any) => t && t.isActive === false && t.code)
      .map((t: any) => String(t.code));
    const materialCodes = await materialRepository.listArchivedOfficialCodes();
    return res.json({ data: { tradeCodes, materialCodes } });
  } catch (err) { next(err); }
});

// ── Phase C — Smart Mapping preview (NO database write) ─────────────────────
// POST /catalog/preview
//
// Accepts .csv or .xlsx (multipart "file" part, optional "mapping" field with
// a JSON object { canonicalField: sourceColumn }) and returns the full
// mapping/preview/validation report WITHOUT touching the database:
//   { detectedColumns, suggestedMapping, appliedMapping, unmappedRequired,
//     totalRows, sampleRows, validCount, rejectedCount, rejected, canImport }
router.post('/preview',
  authenticate,
  requireEntitlement('CATALOG_OFFICIAL_MANAGE'),
  express.raw({ type: IMPORT_RAW_TYPES, limit: '10mb' }),
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const mappingOverride = extractMappingOverride(req);
      const run = await runImportPipeline(req, { csvOnly: false, mappingOverride });

      if (run.mapping.mappingErrors.length > 0) {
        throw badRequest(`Invalid mapping: ${run.mapping.mappingErrors.join('; ')}`);
      }
      if (run.parsed.rows.length > IMPORT_MAX_ROWS) {
        throw badRequest(`Too many rows (${run.parsed.rows.length}). Maximum ${IMPORT_MAX_ROWS} rows per import.`);
      }
      // A file whose métier-ish columns are only GROUPINGS ('department' =
      // 'Building Materials', 'product_group' = 'Cement & Binders') is a valid
      // catalog file: `trade_code` simply stays unmapped (nothing is invented,
      // no default is assumed) and the rows import under the documented review
      // sentinel. `trade_code` therefore NEVER blocks the import — it is
      // published in `unmappedRequired` for DISPLAY only, exactly as the
      // /import endpoint decides (preview == import determinism).
      // Same rule for `price_ht` when the FILE has no price column at all
      // (`catalogOnly` — Master Catalog sans prix): the price is optional for
      // THAT file only (material-only import, no price invented); a file that
      // carries a price column keeps `price_ht` as a blocking required field.
      const requiredMissing = REQUIRED_FIELD_KEYS.filter(
        (k) => !run.mapping.appliedMapping[k] && !(k === 'price_ht' && run.mapping.catalogOnly)
      );
      const unmappedOther = requiredMissing.filter(k => k !== 'material_code' && k !== 'trade_code');
      // Preview must remain a 200 informational report. Do NOT throw here;
      // report missing required fields via the `unmappedRequired` + `canImport`
      // flags so the admin UI can present a blocked preview without an HTTP
      // error response.

      // (removed debug logging)

      // PER-ROW partition (identical to /import): rejected rows are reported
      // with their exact reason but NEVER block the valid rows of the same
      // file. `canImport` = at least ONE importable row + a readable schema.
      const { importable, rejected } = splitImportableRows(run);

      // First 5 normalized rows in the canonical field shape (preview only).
      const sampleRows = importable.slice(0, 5).map((item) => ({
        row: item.row,
        material_code: item.reference,
        material_name: item.nameFr,
        trade_code: item.trade,
        ...(item.tradeLabel ? { trade_name: item.tradeLabel } : {}),
        unit: item.unit,
        price_ht: item.price,
        ...(item.tvaRate !== undefined ? { tva_rate: item.tvaRate } : {}),
        ...(item.category ? { category: item.category } : {}),
        // PER-ROW currency/market — the row's OWN file values, which are what
        // will actually be stored. The Admin selection is only a FALLBACK when
        // the row (or the whole column) carried no value: the preview table
        // must never display a currency/market the import will not use.
        currency: item.currencyCode || run.upload.currencyCode,
        market: item.countryCode || run.upload.countryCode,
        source: item.source || 'OFFICIAL_DEFAULT',
        ...(item.sourceUrl ? { source_url: item.sourceUrl } : {}),
        ...(item.effectiveFrom ? { effective_from: item.effectiveFrom } : {}),
        ...(item.effectiveTo ? { effective_to: item.effectiveTo } : {}),
        ...(item.observedAt ? { observed_at: item.observedAt } : {}),
        ...(item.sourceStatus ? { status: item.sourceStatus } : {}),
      }));

      return res.json({
        data: {
          fileName: run.upload.fileName,
          fileType: run.upload.fileType,
          sheetName: run.parsed.sheetName,
          headerRowNumber: run.parsed.headerRowNumber,
          // Canonical field registry (display metadata for the Admin UI).
          // DERIVED FROM THE SERVICE REGISTRY — a field declared once in
          // `CANONICAL_FIELDS` automatically becomes mappable in the Admin
          // panel. A second hardcoded list here silently made every new field
          // (metre_*, source_url, …) impossible to map from the UI.
          fields: PREVIEW_FIELDS,
          detectedColumns: run.mapping.detectedColumns,
          suggestedMapping: run.mapping.suggestedMapping,
          appliedMapping: run.mapping.appliedMapping,
          // Per SOURCE column: the canonical field it feeds + its role
          // (`field` / `name_fallback` / `unmapped`). Lets the Admin panel show
          // an EXPLICIT mapping line for EVERY detected column — including a
          // designation fallback such as `name_en` — instead of leaving it
          // looking like an unexplained « — Non mappé — ».
          columnAssignments: run.mapping.columnAssignments,
          mappingErrors: run.mapping.mappingErrors,
          unmappedRequired: requiredMissing,
          reviewWarnings: importable.filter(v => v.review && v.review.length > 0).map(v => ({ row: v.row, reference: v.reference, reasons: v.review })),
          totalRows: run.parsed.rows.length,
          sampleRows,
          validCount: importable.length,
          rowsToImport: importable.length,
          rejectedCount: rejected.length,
          rejected: rejected.slice(0, 50),
          canImport:
            unmappedOther.length === 0 &&
            run.mapping.mappingErrors.length === 0 &&
            importable.length > 0 &&
            run.parsed.rows.length > 0,
          defaultTrade: run.defaultTrade ?? null,
          countryCode: run.upload.countryCode,
          currencyCode: run.upload.currencyCode,
          source: sampleRows[0]?.source || 'OFFICIAL_DEFAULT',
        },
      });
    } catch (err) { next(err); }
  }
);

// ── Phase C — Smart Mapping import (CSV + XLSX, transactional) ──────────────
// POST /catalog/import
//
// Same pipeline as /preview, but commits through the EXISTING Phase A
// transactional mechanism (dynamic trades + ONE transaction).
// PER-ROW contract (final): only the VALID rows are committed — a rejected row
// is reported with its exact reason and never written; rejected rows NEVER
// fail the whole import. The request itself is refused (400, nothing written)
// only when the file schema is unusable (mapping errors, unmapped required
// fields) or when NO row at all is importable.
router.post('/import',
  ...requireAdminWrite,
  express.raw({ type: IMPORT_RAW_TYPES, limit: '10mb' }),
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const mappingOverride = extractMappingOverride(req);
      const run = await runImportPipeline(req, { csvOnly: false, mappingOverride });

      if (run.mapping.mappingErrors.length > 0) {
        throw badRequest(`Invalid mapping: ${run.mapping.mappingErrors.join('; ')}`);
      }
      // Import is blocked only on the DATA-bearing required fields. Use the
      // applied mapping as the single source-of-truth so preview+import are
      // consistent. `trade_code` is NOT one of them: a file with no métier
      // column (only groupings such as 'Building Materials' / 'Cement &
      // Binders') stays importable — the normalizer already gave those rows the
      // documented `unmapped_review` review sentinel (no métier invented, no
      // default assumed), and an explicit admin "Métier par défaut"
      // (defaultTrade) still wins whenever it is provided.
      // `price_ht` is NOT one of them either WHEN the file has no price column
      // at all (`catalogOnly`): that Master Catalog then commits as
      // material-only — no `material_prices` row is created or modified and no
      // price is ever invented. A file that DOES carry a price column keeps
      // `price_ht` blocking exactly as before.
      const missingRequired = REQUIRED_FIELD_KEYS.filter(
        (k) => !run.mapping.appliedMapping[k] && k !== 'trade_code' && !(k === 'price_ht' && run.mapping.catalogOnly)
      );
      if (missingRequired.length > 0) {
        throw badRequest(
          `Import blocked: required field(s) not mapped: ${missingRequired.join(', ')}. ` +
          'Map every required field in the Smart Mapping step before importing.'
        );
      }
      if (run.parsed.rows.length > IMPORT_MAX_ROWS) {
        throw badRequest(`Too many rows (${run.parsed.rows.length}). Maximum ${IMPORT_MAX_ROWS} rows per import.`);
      }
      if (run.parsed.rows.length === 0) {
        throw badRequest('The file contains no data rows to import.');
      }

      // ── PER-ROW import (final contract) ───────────────────────────────────
      // Rejected rows NEVER block the valid ones: exactly the rows reported as
      // importable by /preview are committed (ONE transaction — the batch of
      // valid rows itself stays all-or-nothing), the rejected ones are never
      // written and are returned with their precise per-row reason. The whole
      // file is only refused when NOTHING is importable (or the schema itself
      // is unusable — mapping errors / unmapped required fields above).
      const { importable, rejected } = splitImportableRows(run);
      if (importable.length === 0) {
        return res.status(400).json({
          error: {
            code: 'BAD_REQUEST',
            message: `Import aborted: no importable row (${rejected.length} rejected). No data was written.`,
          },
          data: {
            fileName: run.upload.fileName,
            totalRows: run.parsed.rows.length,
            committed: false,
            imported: 0,
            updated: 0,
            rejectedCount: rejected.length,
            rejected: rejected.slice(0, 50),
            failed: rejected,
          },
        });
      }

      const commit = await commitValidRows(importable, {
        countryCode: run.upload.countryCode,
        currencyCode: run.upload.currencyCode,
      }, { fileName: run.upload.fileName, sourceRef: run.upload.sourceRef });
      // `in` narrowing (the project compiles without strictNullChecks).
      if ('message' in commit) {
        return res.status(500).json({
          error: { code: 'INTERNAL_ERROR', message: commit.message },
          data: {
            fileName: run.upload.fileName,
            totalRows: run.parsed.rows.length,
            committed: false,
            imported: 0,
            updated: 0,
            failed: commit.failedRows,
          },
        });
      }

      return res.status(200).json({
        data: {
          fileName: run.upload.fileName,
          fileType: run.upload.fileType,
          totalRows: run.parsed.rows.length,
          committed: true,
          imported: commit.imported,
          updated: commit.updated,
          failed: [],
          // PER-ROW outcome — the rejected rows were NOT written, each with
          // its precise reason (ADDITIVE fields; existing consumers keep the
          // previous shape).
          rowsImported: importable.length,
          rejectedCount: rejected.length,
          rejected: rejected.slice(0, 50),
          results: commit.results,
          countryCode: run.upload.countryCode,
          currencyCode: run.upload.currencyCode,
          mapping: run.mapping.appliedMapping,
          catalog: (commit as any).catalog || undefined,
        },
      });
    } catch (err) { next(err); }
  }
);

// ── Price Update Foundation (Step 8) ────────────────────────────────────────
// Incoming Price Update → Pending → Admin Review → Official Current Price.
// All endpoints require the SAME existing CATALOG_OFFICIAL_MANAGE entitlement.
// No schema change, no auth change, no company-price access.

// GET /catalog/price-updates/pending — list pending (unapproved) updates.
router.get('/price-updates/pending',
  authenticate,
  requireEntitlement('CATALOG_OFFICIAL_MANAGE'),
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const result = await listPendingPriceUpdates({
        countryCode: req.query.countryCode as string | undefined,
        currencyCode: req.query.currencyCode as string | undefined,
      });
      res.json(result);
    } catch (err) { next(err); }
  }
);

// POST /catalog/price-updates — record an incoming price update as PENDING
// (source=SUPPLIER_SUBMITTED, is_current=false). Always idempotent.
router.post('/price-updates',
  ...requireAdminWrite,
  validateBody([
    { field: 'materialCode', label: 'Material Code', required: true, type: 'string' },
    { field: 'price', label: 'Price', required: true, type: 'number', min: 0 },
  ]),
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const { materialCode, price, currencyCode, countryCode, supplierId, effectiveFrom, notes } = req.body || {};
      if (price < 0) throw badRequest('Price must be >= 0');

      // Phase 3C — manual Admin market update: market/currency are normalized to
      // UPPERCASE (existing TN/TND defaults preserved) and validated through the
      // SAME normalizer every other source uses (connector.ts), so a manual
      // update can never carry a market/currency other than the one explicitly
      // requested. The market+currency pair is carried by the manual_admin spec
      // itself; no reference-table lookup is added here.
      const manualAdminSpec: PriceSourceSpec = {
        code: 'SUPPLIER_SUBMITTED', // existing pending convention (Step 8 / Step 11)
        name: 'Manual Admin Update',
        market: String(countryCode || 'TN').toUpperCase(),
        currency: String(currencyCode || 'TND').toUpperCase(),
        kind: 'manual_admin',
        enabled: true,
      };
      const candidate = normalizeConnectorCandidate(manualAdminSpec, {
        materialCode,
        price: roundMoney(price),
        effectiveFrom,
        notes,
      });

      const row = await submitPendingPriceUpdate({
        materialCode: candidate.materialCode,
        price: candidate.price,
        currencyCode: candidate.currency,
        countryCode: candidate.market,
        supplierId,
        effectiveFrom: candidate.effectiveFrom,
        notes: candidate.notes,
      });
      // Response contract: the shared normalizePriceRow() mapper exposes the
      // legacy MemoryRepo field `currency` (mapped from currency_code) and
      // deliberately omits the raw `currencyCode` key — that is asserted by
      // tests/price_normalization.test.ts, so the mapper must not change. The
      // persisted values are already normalized (country/currency uppercased,
      // TN/TND defaults applied above); this endpoint echoes the persisted
      // currency under `currencyCode` as an ADDITIVE field, mirroring the
      // `countryCode` already present, so callers can read both codes.
      res.status(201).json({ data: { ...row, currencyCode: row.currency } });
    } catch (err) { next(err); }
  }
);

// POST /catalog/price-updates/:id/approve — promote the pending row to the
// approved official current price FOR ITS OWN market/currency only.
router.post('/price-updates/:id/approve',
  ...requireAdminWrite,
  async (req: AuthenticatedRequest, res: Response, next: any) => {
    try {
      const row = await approvePendingPriceUpdate(req.params.id);
      res.json({ data: row });
    } catch (err) { next(err); }
  }
);

export { router as catalogRouter };