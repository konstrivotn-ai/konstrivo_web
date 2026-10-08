/**
 * P1 — Import preview gate helpers (pure functions — no React, no fetch, no DB).
 *
 * Extracted from AdminDashboardModal so the "Confirmer l'import" gate is
 * unit-testable and the audit's P1 findings are enforced in ONE place:
 *
 *   1. `trade_code` NEVER blocks the import. A file whose only métier-ish
 *      columns are groupings ('department' = 'Building Materials',
 *      'product_group' = 'Cement & Binders') imports normally: the server maps
 *      every other field, leaves `trade_code` unmapped (no métier is invented,
 *      no default is assumed) and imports the rows under its documented review
 *      sentinel. The explicit admin "Métier par défaut" stays available as an
 *      OPTION for those rows — it is never a precondition.
 *   2. A blocked confirm must NEVER return silently: it must produce a clear,
 *      persistent French reason built from the same deterministic preview
 *      report the server used (`canImport=false` mirrors the /import 400s).
 *
 * The server remains the source of truth (`canImport` from POST
 * /catalog/preview); these helpers only translate the report into UI state.
 */

export interface ImportRejectedRow {
  row?: number;
  reference?: string;
  reason?: string;
}

/** Subset of the POST /catalog/preview report the helpers consume. */
export interface ImportPreviewReport {
  canImport?: boolean;
  unmappedRequired?: string[];
  mappingErrors?: string[];
  rejectedCount?: number;
  rejected?: ImportRejectedRow[];
  totalRows?: number;
  /** Rows the server reports as importable (per-row contract). */
  validCount?: number;
  rowsToImport?: number;
  appliedMapping?: Record<string, string>;
  /** Echoed by the server when a default trade was part of the request. */
  defaultTrade?: string | null;
}

/** Sentinel select value for "Autre (code personnalisé)…". */
export const CUSTOM_DEFAULT_TRADE = '__custom__';

/** Effective default trade from the select choice + optional custom input. */
export function effectiveDefaultTrade(choice: string, custom: string): string {
  const value = choice === CUSTOM_DEFAULT_TRADE ? custom : choice;
  return value.trim();
}

/**
 * True when the file has no trade column mapped: the Smart Mapping step must
 * OFFER the optional "Métier par défaut" for those rows (it is never a gate —
 * the rows import under the review sentinel without it).
 */
export function isDefaultTradeRequired(preview: ImportPreviewReport | null | undefined): boolean {
  if (!preview) return false;
  return !preview.appliedMapping?.trade_code;
}

/**
 * Required-unmapped fields that ACTUALLY block the import: the data-bearing
 * required fields (`material_code` / `material_name` / `price_ht`).
 *
 * `trade_code` is published by the server in `unmappedRequired` for DISPLAY
 * only: a file with no métier column is still imported (its rows carry the
 * documented `unmapped_review` review sentinel — no métier is ever invented,
 * no default is assumed), so it must never be presented as a blocking field.
 */
export function visibleUnmappedRequired(
  preview: ImportPreviewReport | null | undefined,
  // Kept in the signature (existing call sites pass it): the default trade is
  // an OPTION offered for the trade-less rows, never a condition of the gate.
  _defaultTrade?: string
): string[] {
  const unmapped = Array.isArray(preview?.unmappedRequired) ? preview.unmappedRequired : [];
  return unmapped.filter((key) => key !== 'trade_code');
}

/**
 * Build the human-readable rejection reason for a blocked "Confirmer l'import".
 * Returns null when the preview is importable (nothing to explain). Mirrors —
 * in the same order — the deterministic 400s the /import endpoint produces.
 */
export function buildImportBlockReason(
  preview: ImportPreviewReport | null | undefined,
  defaultTrade: string
): string | null {
  if (!preview) {
    return "Aucun aperçu valide : sélectionnez un fichier CSV/Excel et attendez l'aperçu du serveur avant de confirmer l'import.";
  }
  if (preview.canImport) return null;

  const parts: string[] = [];

  const mappingErrors = Array.isArray(preview.mappingErrors) ? preview.mappingErrors : [];
  if (mappingErrors.length > 0) {
    parts.push(`mapping invalide : ${mappingErrors.join(' ; ')}`);
  }

  const blocking = visibleUnmappedRequired(preview, defaultTrade);
  if (blocking.length > 0) {
    parts.push(`champs obligatoires non mappés : ${blocking.join(', ')}`);
  }

  const rejectedCount =
    typeof preview.rejectedCount === 'number' ? preview.rejectedCount : (preview.rejected?.length ?? 0);
  if (rejectedCount > 0) {
    const first = (preview.rejected || [])
      .slice(0, 3)
      .map((f) => `ligne ${f.row ?? '?'}${f.reference ? ` (${f.reference})` : ''} : ${f.reason || 'raison inconnue'}`)
      .join(' | ');
    // PER-ROW contract: rejected rows never block the valid ones — they are
    // simply never written. They block the import ONLY when the file has NO
    // importable row at all (unknown count = 0: fail closed, never promise).
    const importableCount =
      typeof preview.validCount === 'number' ? preview.validCount : (preview.rowsToImport ?? 0);
    parts.push(
      importableCount > 0
        ? `${rejectedCount} ligne(s) rejetée(s) — elles ne seront pas écrites, ${importableCount} ligne(s) importable(s) seront importées${first ? ` (${first})` : ''}`
        : `${rejectedCount} ligne(s) rejetée(s) — aucune ligne importable, aucune écriture${first ? ` (${first})` : ''}`
    );
  }

  if (preview.totalRows === 0) {
    parts.push('le fichier ne contient aucune ligne de données');
  }

  if (parts.length === 0) {
    parts.push("l'aperçu actuel n'autorise pas l'import — corrigez le mapping ou les lignes rejetées, puis attendez un nouvel aperçu");
  }

  return `Import bloqué — ${parts.join(' · ')}. Aucune donnée n'a été écrite.`;
}
