/**
 * Step 11 — Supplier CSV/Excel → Pending Price Updates (bridge).
 *
 * PURE glue between the existing supplier import path (parseCsv + matching in
 * /api/v1/suppliers/upload) and the Step 8 pending pipeline. It reuses the
 * Step 9 normalizer so a supplier file can NEVER:
 *   - invent/rename a material code (code is carried verbatim → materials.code)
 *   - mix markets/currencies (the whole file is pinned to ONE market+currency)
 *   - mark anything official (this module has no write access at all —
 *     `official` is a compile-time false constant and no material_prices
 *     import exists in this file)
 *   - touch company-specific prices (no companyId is ever emitted; the
 *     Step 8 submit path only writes company_id = NULL rows)
 *
 * Pipeline (mandatory):
 *   Supplier CSV/Excel → parse → materials.code mapping → market+currency
 *     → normalizeConnectorCandidate → submitPendingPriceUpdate()
 *     → SUPPLIER_SUBMITTED → Admin Review → Approve → SUPPLIER_APPROVED
 */
import { PriceCandidate, PriceSourceSpec, normalizeConnectorCandidate } from './connector';

/** Minimal shape of a parsed SupplierCatalogItem (structural, for testability). */
export interface SupplierCsvItemLike {
  materialCode?: string;
  priceTnd: number;
  matchedMaterialId?: string;
  status?: 'pending' | 'matched' | 'unmatched' | 'rejected';
}

export interface SupplierCsvImportOptions {
  /** Explicit market for the WHOLE file (no hidden per-row mixing). */
  countryCode: string;
  /** Explicit currency for the WHOLE file. */
  currencyCode: string;
  /** Preserved from the import record (supplier isolation). */
  supplierId?: string;
  fileName?: string;
  observedAt?: string;
}

/** What the route submits — 1:1 with submitPendingPriceUpdate() input. */
export interface SupplierCsvSubmission {
  materialCode: string;
  price: number;
  countryCode: string;
  currencyCode: string;
  supplierId?: string;
  effectiveFrom?: string;
  notes?: string;
  /** The normalized Step 9 candidate this came from (audit trail). */
  candidate: PriceCandidate;
}

export interface SupplierCsvPendingPlan {
  spec: PriceSourceSpec;
  submissions: SupplierCsvSubmission[];
  /** Codes with no materials.code match — reported, NEVER guessed/created. */
  unmapped: string[];
  /** Rows rejected by normalization (bad price etc.) with reasons. */
  invalid: Array<{ materialCode: string; reason: string }>;
  /** Compile-time proof: this bridge can never produce an official price. */
  readonly official: false;
}

export function buildSupplierCsvPendingPlan(
  items: SupplierCsvItemLike[],
  opts: SupplierCsvImportOptions,
): SupplierCsvPendingPlan {
  const market = opts.countryCode.toUpperCase();
  const currency = opts.currencyCode.toUpperCase();

  // Per-import connector spec: the WHOLE file is pinned to one market+currency.
  // sourceCode 'SUPPLIER_SUBMITTED' matches the Step 8 pending convention.
  const spec: PriceSourceSpec = {
    code: 'SUPPLIER_SUBMITTED',
    name: opts.fileName ? `Supplier CSV/Excel — ${opts.fileName}` : 'Supplier CSV/Excel',
    market,
    currency,
    kind: 'csv',
    enabled: true,
  };

  const plan: SupplierCsvPendingPlan = {
    spec,
    submissions: [],
    unmapped: [],
    invalid: [],
    official: false,
  };

  for (const item of items) {
    const code = (item.materialCode || '').trim();
    // Unknown code → recorded for review, never auto-created, never guessed.
    if (!code || item.status === 'unmatched' || item.status === 'rejected' || !item.matchedMaterialId) {
      if (code) plan.unmapped.push(code);
      continue;
    }
    try {
      const candidate = normalizeConnectorCandidate(spec, {
        materialCode: code,
        price: item.priceTnd,
        observedAt: opts.observedAt,
        notes: opts.fileName ? `Supplier import: ${opts.fileName}` : 'Supplier CSV/Excel import',
      });
      plan.submissions.push({
        materialCode: candidate.materialCode,
        price: candidate.price,
        countryCode: candidate.market,
        currencyCode: candidate.currency,
        supplierId: opts.supplierId,
        effectiveFrom: candidate.effectiveFrom,
        notes: candidate.notes,
        candidate,
      });
    } catch (err) {
      plan.invalid.push({ materialCode: code, reason: (err as Error).message });
    }
  }
  return plan;
}