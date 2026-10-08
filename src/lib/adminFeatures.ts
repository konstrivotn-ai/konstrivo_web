/**
 * Phase 2 — Admin Feature Entitlement helpers (server-backed admin controls).
 *
 * Pure, DOM-free helpers shared by the Admin Dashboard "Offres PRO" tab and
 * the /api/v1/admin/features API client in src/lib/api.ts.
 *
 * NO duplicate storage: the single source of truth is the backend
 * feature_entitlements table through the existing Admin API
 * (server/routes/v1/adminFeatures.ts → server/services/featureService.ts).
 *
 * Phase 1 contract (superseded by P3): while the server ran with the
 * "all features free" mode, entitlement settings were STORED for future PRO
 * control but never gated access. P3 made those rows REAL: canAccessFeature()
 * now applies freeAccess / proAccess / role `scope` / usageLimit, and the
 * legacy mode is only reachable through the explicit opt-in server switch
 * (ALL_FEATURES_FREE=1). These helpers still never touch enforcement — they
 * only build/validate the payloads the admin API persists.
 */

/** One entitlement row exactly as returned by GET /api/v1/admin/features. */
export interface AdminFeatureEntitlement {
  id: string;
  featureKey: string;
  labelFr: string | null;
  labelAr: string | null;
  labelDerja: string | null;
  freeAccess: boolean;
  proAccess: boolean;
  /** NULL = unlimited. Stored for future PRO control (inert during Phase 1). */
  usageLimit: number | null;
  scope: string;
  isActive: boolean;
}

/** Role scoping supported by the backend (server/db/schema/features.ts). */
export const FEATURE_SCOPES = ['all', 'client', 'artisan', 'supplier', 'engineer'] as const;
export type FeatureScope = (typeof FEATURE_SCOPES)[number];

/** Partial edit applied to one entitlement row by the admin UI. */
export interface AdminFeaturePatch {
  labelFr?: string | null;
  labelAr?: string | null;
  labelDerja?: string | null;
  freeAccess?: boolean;
  proAccess?: boolean;
  usageLimit?: number | null;
  scope?: string;
  isActive?: boolean;
}

/** POST /api/v1/admin/features request body (upsert). */
export interface AdminFeatureUpsertPayload {
  featureKey: string;
  labelFr: string | null;
  labelAr: string | null;
  labelDerja: string | null;
  freeAccess: boolean;
  proAccess: boolean;
  usageLimit: number | null;
  scope: string;
  isActive: boolean;
}

/**
 * Pure optimistic update: merge `patch` over `ent` WITHOUT mutating the input.
 * Validation lives in buildUpsertPayload (single gate before saving).
 */
export function applyPatch(
  ent: AdminFeatureEntitlement,
  patch: AdminFeaturePatch
): AdminFeatureEntitlement {
  return {
    ...ent,
    ...(patch.labelFr !== undefined ? { labelFr: patch.labelFr } : {}),
    ...(patch.labelAr !== undefined ? { labelAr: patch.labelAr } : {}),
    ...(patch.labelDerja !== undefined ? { labelDerja: patch.labelDerja } : {}),
    ...(patch.freeAccess !== undefined ? { freeAccess: patch.freeAccess } : {}),
    ...(patch.proAccess !== undefined ? { proAccess: patch.proAccess } : {}),
    ...(patch.usageLimit !== undefined ? { usageLimit: patch.usageLimit } : {}),
    ...(patch.scope !== undefined ? { scope: patch.scope } : {}),
    ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
  };
}

/**
 * Build the upsert payload for POST /api/v1/admin/features from the current
 * server row + the admin's patch. Returns `{ error }` for invalid drafts so
 * the UI can show a clear per-row error instead of silently clamping.
 *
 * Rules (mirroring server/routes/v1/adminFeatures.ts + featureService):
 *  - EDITS: featureKey always comes from the server row. Creating NEW keys
 *    goes through the dedicated buildFeatureCreatePayload below (same gate).
 *  - usageLimit: null (unlimited) or an integer >= 1
 *  - scope must be one of FEATURE_SCOPES
 */
export function buildUpsertPayload(
  ent: AdminFeatureEntitlement,
  patch: AdminFeaturePatch
): { payload?: AdminFeatureUpsertPayload; error?: string } {
  if (!ent || !ent.featureKey || !String(ent.featureKey).trim()) {
    return { error: 'featureKey is required' };
  }
  const merged = applyPatch(ent, patch);
  if (!FEATURE_SCOPES.includes(merged.scope as FeatureScope)) {
    return { error: `scope must be one of: ${FEATURE_SCOPES.join(', ')}` };
  }
  if (merged.usageLimit !== null && (!Number.isInteger(merged.usageLimit) || merged.usageLimit < 1)) {
    return { error: 'usageLimit must be null (unlimited) or an integer >= 1' };
  }
  return {
    payload: {
      featureKey: ent.featureKey,
      labelFr: merged.labelFr,
      labelAr: merged.labelAr,
      labelDerja: merged.labelDerja,
      freeAccess: merged.freeAccess,
      proAccess: merged.proAccess,
      usageLimit: merged.usageLimit,
      scope: merged.scope,
      isActive: merged.isActive,
    },
  };
}

/** Deterministic display order: active rows first, then by featureKey. */
export function sortEntitlements(
  rows: AdminFeatureEntitlement[]
): AdminFeatureEntitlement[] {
  return [...rows].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return a.featureKey.localeCompare(b.featureKey);
  });
}

// ── Phase 3 — Admin Feature Manager (future control center) helpers ─────────

/**
 * Display-ordering modes for the admin list. The backend model has NO
 * persistent ordering column, so ordering is VIEW-ONLY (never persisted);
 * the stored order of entitlements is unaffected.
 */
export const FEATURE_SORT_MODES = ['key', 'label', 'scope', 'status'] as const;
export type FeatureSortMode = (typeof FEATURE_SORT_MODES)[number];

/**
 * Sort rows for display in the selected mode. Pure — returns a new array.
 *  - 'key'    → active first, then featureKey (Phase 2 default)
 *  - 'label'  → active first, then labelFr (fallback featureKey)
 *  - 'scope'  → scope order, then featureKey
 *  - 'status' → active rows first; inactive rows keep their incoming (server)
 *    order at the bottom (Array.prototype.sort is stable, ES2019+)
 */
export function sortEntitlementsByMode(
  rows: AdminFeatureEntitlement[],
  mode: FeatureSortMode
): AdminFeatureEntitlement[] {
  const copy = [...rows];
  if (mode === 'scope') {
    const scopeRank = (s: string): number => {
      const idx = FEATURE_SCOPES.indexOf(s as FeatureScope);
      return idx === -1 ? FEATURE_SCOPES.length : idx;
    };
    return copy.sort(
      (a, b) =>
        scopeRank(a.scope) - scopeRank(b.scope) ||
        a.featureKey.localeCompare(b.featureKey)
    );
  }
  if (mode === 'status') {
    // Active rows first (true=1 sorts before false=0); among equal flags the
    // stable sort preserves the incoming server order — no tie-break.
    return copy.sort(
      (a, b) =>
        Number(b.isActive) - Number(a.isActive)
    );
  }
  // 'key' and 'label' both keep active rows first.
  return copy.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    if (mode === 'label') {
      const la = a.labelFr || a.featureKey;
      const lb = b.labelFr || b.featureKey;
      return la.localeCompare(lb) || a.featureKey.localeCompare(b.featureKey);
    }
    return a.featureKey.localeCompare(b.featureKey);
  });
}

/** Backend columns are varchar(200) (server/db/schema/features.ts). */
export const FEATURE_MAX_LABEL_LENGTH = 200;

/**
 * Validate an admin-edited label (labelFr / labelAr / labelDerja).
 * Empty string means "clear the label" (sent as null). Returns a user-facing
 * French error message, or null when valid.
 */
export function validateLabel(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length > FEATURE_MAX_LABEL_LENGTH) {
    return `Libellé trop long (${trimmed.length}/${FEATURE_MAX_LABEL_LENGTH} caractères max).`;
  }
  return null;
}

/** Filter mode for the admin search box. */
export type FeatureFilterField = 'all' | 'key' | 'label' | 'scope';

/** Case-insensitive haystack for the search box (pure string, DOM-free). */
export function featureSearchHaystack(
  ent: AdminFeatureEntitlement,
  field: FeatureFilterField = 'all'
): string {
  const key = ent.featureKey.toLowerCase();
  const labelFr = (ent.labelFr || '').toLowerCase();
  const labelAr = (ent.labelAr || '').toLowerCase();
  const labelDerja = (ent.labelDerja || '').toLowerCase();
  const scope = ent.scope.toLowerCase();
  switch (field) {
    case 'key':
      return key;
    case 'label':
      return `${labelFr} ${labelAr} ${labelDerja}`;
    case 'scope':
      return scope;
    default:
      return `${key} ${labelFr} ${labelAr} ${labelDerja} ${scope}`;
  }
}

/** True when the row matches the admin's search query. */
export function matchesFeatureSearch(
  ent: AdminFeatureEntitlement,
  query: string,
  field: FeatureFilterField = 'all'
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return featureSearchHaystack(ent, field).includes(q);
}

/** One line of the control-center overview strip. */
export interface FeatureSummaryCounts {
  total: number;
  active: number;
  freeAccess: number;
  proOnly: number;
  limited: number;
}

/** Pure overview counters for the "control center" summary strip. */
export function computeFeatureSummary(
  rows: AdminFeatureEntitlement[]
): FeatureSummaryCounts {
  return {
    total: rows.length,
    active: rows.filter(r => r.isActive).length,
    freeAccess: rows.filter(r => r.freeAccess).length,
    proOnly: rows.filter(r => r.proAccess && !r.freeAccess).length,
    limited: rows.filter(r => r.usageLimit != null).length,
  };
}

/** Defensively map a raw API row into AdminFeatureEntitlement. */
export function mapAdminFeatureRow(raw: any): AdminFeatureEntitlement {
  const limit = raw?.usageLimit;
  return {
    id: String(raw?.id ?? ''),
    featureKey: String(raw?.featureKey ?? ''),
    labelFr: raw?.labelFr == null ? null : String(raw.labelFr),
    labelAr: raw?.labelAr == null ? null : String(raw.labelAr),
    labelDerja: raw?.labelDerja == null ? null : String(raw.labelDerja),
    freeAccess: Boolean(raw?.freeAccess),
    proAccess: Boolean(raw?.proAccess),
    usageLimit: limit == null ? null : Number(limit),
    scope: String(raw?.scope ?? 'all'),
    isActive: Boolean(raw?.isActive),
  };
}

// ── Create a new Feature Entitlement ("+ Ajouter une fonctionnalité") ───────
// Persists through the SAME single system: POST /api/v1/admin/features →
// feature_entitlements (no duplicate storage). The DB unique index
// (uq_feature_entitlements_key) is the final authority on key uniqueness; the
// client-side duplicate check below just gives the admin a friendlier error.

/** feature_key is varchar(100) in server/db/schema/features.ts. */
export const FEATURE_MAX_KEY_LENGTH = 100;

const FEATURE_KEY_PATTERN = /^[a-z0-9][a-z0-9:._-]*$/;

/** Trim + lowercase (keys are lowercase by convention: e.g. devis:export_excel). */
export function normalizeFeatureKey(raw: string): string {
  return String(raw ?? '').trim().toLowerCase();
}

export function isValidFeatureKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= FEATURE_MAX_KEY_LENGTH &&
    FEATURE_KEY_PATTERN.test(key)
  );
}

/** Draft state for the admin "create feature" form (usageLimit '' = unlimited). */
export interface AdminFeatureCreateDraft {
  featureKey: string;
  labelFr: string;
  labelAr: string;
  labelDerja: string;
  freeAccess: boolean;
  proAccess: boolean;
  usageLimit: string;
  scope: string;
  isActive: boolean;
}

export const EMPTY_FEATURE_CREATE_DRAFT: AdminFeatureCreateDraft = {
  featureKey: '',
  labelFr: '',
  labelAr: '',
  labelDerja: '',
  freeAccess: true,
  proAccess: true,
  usageLimit: '',
  scope: 'all',
  isActive: true,
};

/**
 * Validate the create form and build the upsert payload. Reuses the SAME
 * validation gate as edits (buildUpsertPayload) — no duplicated rules — plus
 * key format/length (varchar(100)) and uniqueness against the loaded rows.
 * Returns a French admin-facing error, or the exact POST body.
 *
 * P3: the created row is a REAL entitlement — once persisted it is applied by
 * canAccessFeature() (freeAccess / proAccess / scope / usageLimit) on the next
 * access check, exactly like every other row.
 */
export function buildFeatureCreatePayload(
  draft: AdminFeatureCreateDraft,
  existingKeys: string[]
): { payload?: AdminFeatureUpsertPayload; error?: string } {
  const key = normalizeFeatureKey(draft?.featureKey);
  if (!key) {
    return { error: 'La clé de fonctionnalité est requise (ex : devis:export_excel).' };
  }
  if (key.length > FEATURE_MAX_KEY_LENGTH) {
    return { error: `La clé ne doit pas dépasser ${FEATURE_MAX_KEY_LENGTH} caractères (colonne feature_key varchar(${FEATURE_MAX_KEY_LENGTH})).` };
  }
  if (!FEATURE_KEY_PATTERN.test(key)) {
    return { error: "Clé invalide : caractères autorisés = lettres, chiffres, ':', '_', '-', '.' (ex : devis:export_excel)." };
  }
  const duplicate = (existingKeys || []).some(
    (k) => String(k ?? '').trim().toLowerCase() === key
  );
  if (duplicate) {
    return { error: `La clé « ${key} » existe déjà — les clés de fonctionnalités doivent être uniques.` };
  }

  const labelFr = String(draft?.labelFr ?? '');
  const labelAr = String(draft?.labelAr ?? '');
  const labelDerja = String(draft?.labelDerja ?? '');
  const labelError = validateLabel(labelFr) || validateLabel(labelAr) || validateLabel(labelDerja);
  if (labelError) return { error: labelError };

  // usageLimit: '' = unlimited (null); otherwise the same rule as edits
  // (integer >= 1) — revalidated by buildUpsertPayload below.
  const rawLimit = String(draft?.usageLimit ?? '').trim();
  let usageLimit: number | null = null;
  if (rawLimit !== '') {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return { error: 'Limite mensuelle invalide : vide = illimité, sinon un nombre entier ≥ 1 (ex : 5).' };
    }
    usageLimit = parsed;
  }

  const scope = String(draft?.scope ?? 'all');
  if (!FEATURE_SCOPES.includes(scope as FeatureScope)) {
    return { error: `Scope invalide — valeurs autorisées : ${FEATURE_SCOPES.join(', ')}.` };
  }

  return buildUpsertPayload(
    {
      id: '',
      featureKey: key,
      labelFr: labelFr.trim() || null,
      labelAr: labelAr.trim() || null,
      labelDerja: labelDerja.trim() || null,
      freeAccess: Boolean(draft?.freeAccess),
      proAccess: Boolean(draft?.proAccess),
      usageLimit,
      scope,
      isActive: Boolean(draft?.isActive),
    },
    {}
  );
}
