/**
 * KONSTRIVO — Central Website API client (Phase 1 auth foundation)
 *
 * Security posture:
 *  - The access (JWT) token lives ONLY in JS module memory (never in
 *    localStorage / sessionStorage), so it does not survive a tab close.
 *  - The refresh token lives in an HttpOnly + SameSite=Strict (+ Secure in
 *    production) cookie set by the server (see server/utils/cookies.ts).
 *  - On a 401 the client silently rotates the access token via the refresh
 *    cookie, then retries the original request once.
 *
 * Uses the native Fetch API + `credentials: 'include'` so the browser
 * automatically sends the HttpOnly refresh cookie for same-origin /api/v1 calls.
 * The SPA is served by the same Express origin, so no CORS preflight dance is
 * needed for the auth flow.
 */
import type { UserProfile, UserRole, CountryCode } from '../types';
import type { AdminFeatureEntitlement, AdminFeatureUpsertPayload } from './adminFeatures';
import { mapAdminFeatureRow } from './adminFeatures';
import type { AdminPlanCode, AdminPlanTarget } from './adminPlans';
import { buildAdminPlanQuery } from './adminPlans';

const BASE = '/api/v1';

// ── In-memory access token (never persisted to Web Storage) ────────────────
let accessToken: string | null = null;
type Listener = () => void;
const listeners = new Set<Listener>();

export const getAccessToken = (): string | null => accessToken;

export function setAccessToken(token: string | null): void {
  accessToken = token;
  listeners.forEach((l) => l());
}

export function onAuthChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Use the HttpOnly refresh cookie to obtain a fresh access token. */
async function silentRefresh(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return null;
    const data: { token?: string } = await res.json().catch(() => ({}));
    if (data.token) {
      setAccessToken(data.token);
      return data.token;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * fetch wrapper that attaches the in-memory access token and transparently
 * retries once on 401 after a silent refresh.
 */
async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  let res = await fetch(input, { ...init, headers, credentials: 'include' });

  if (res.status === 401) {
    const refreshed = await silentRefresh();
    if (refreshed) {
      headers.set('Authorization', `Bearer ${refreshed}`);
      res = await fetch(input, { ...init, headers, credentials: 'include' });
    }
  }
  return res;
}

// ── Backend user/company shapes (server returns these, sanitized) ──────────
interface BackendUser {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  role: UserRole;
  status: string;
  /** Independent server-side verification status (never plan/status-derived). */
  isVerified?: boolean;
  region?: string;
  country?: CountryCode;
  licenseNumber?: string;
  matriculeFiscale?: string;
  avatarUrl?: string;
  createdAt?: string;
}
interface BackendCompany {
  legalName?: string;
  tradeName?: string;
  email?: string;
  phone?: string;
  taxId?: string;
}

function mapUserToProfile(
  user: BackendUser,
  company: BackendCompany | null | undefined,
): UserProfile {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone || '',
    role: user.role,
    company: company?.legalName,
    companyName: company?.legalName,
    region: user.region || 'Tunis Grand',
    country: (user.country as CountryCode) || 'TN',
    matriculeFiscale: user.matriculeFiscale,
    taxNumber: user.matriculeFiscale,
    licenseNumber: user.licenseNumber,
    avatarUrl: user.avatarUrl,
    avatar: user.avatarUrl,
    // Rule 7 (Phase 2 fix F1): verification is an independent server-side
    // status — never derived from account status or the subscription/plan.
    // The server does not expose a per-user verification flag yet, so the
    // "Certifié" badge stays hidden until a real verification status exists.
    isVerified: user.isVerified === true,
    createdAt: user.createdAt,
  };
}

interface AuthResponse {
  user: BackendUser;
  company: BackendCompany | null;
  token: string;
  refreshToken: string;
}

export interface LoginInput { email: string; password: string; }
export interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  companyName?: string;
  role?: UserRole;
  region?: string;
  country?: CountryCode;
  matriculeFiscale?: string;
  licenseNumber?: string;
}

export async function login(input: LoginInput): Promise<UserProfile> {
  const res = await apiFetch(`${BASE}/auth/login`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message || 'Échec de la connexion');
  }
  const data: AuthResponse = await res.json();
  setAccessToken(data.token);
  return mapUserToProfile(data.user, data.company);
}

export async function register(input: RegisterInput): Promise<UserProfile> {
  const res = await apiFetch(`${BASE}/auth/register`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message || "Échec de l'inscription");
  }
  const data: AuthResponse = await res.json();
  setAccessToken(data.token);
  return mapUserToProfile(data.user, data.company);
}

/**
 * Reset the password using the one-time token from the reset email link
 * (POST /api/v1/auth/reset).
 *
 * Sends ONLY { token, password } — the "confirm password" field never leaves
 * the UI. On failure throws an Error with the HTTP `status` attached so the
 * UI can map it to a safe French message (raw payloads are never surfaced,
 * and the token never appears in any error text).
 */
export async function resetPassword(token: string, password: string): Promise<void> {
  const res = await apiFetch(`${BASE}/auth/reset`, {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
  if (res.ok) return;
  let message = '';
  try {
    const err = await res.json().catch(() => ({}));
    message = (err as any)?.error?.message || '';
  } catch {
    /* ignore parse errors — the UI never surfaces raw payloads */
  }
  const error: any = new Error(message);
  error.status = res.status;
  throw error;
}

/**
 * Ask the backend to send a password-reset email (POST /api/v1/auth/forgot).
 * The backend answer is intentionally generic (it never reveals whether the
 * account exists) and the UI shows exactly that generic message. On validation
 * failure throws an Error with the HTTP `status` attached so the UI can map it
 * to a safe French message (raw payloads are never surfaced).
 */
export async function forgotPassword(email: string): Promise<string> {
  const res = await apiFetch(`${BASE}/auth/forgot`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  let message = '';
  try {
    const data = await res.json().catch(() => ({}));
    message = (data as any)?.message || (data as any)?.error?.message || '';
  } catch {
    /* ignore parse errors — the UI never surfaces raw payloads */
  }
  if (!res.ok) {
    const error: any = new Error(message);
    error.status = res.status;
    throw error;
  }
  return message || 'Si cette adresse existe, un lien de réinitialisation sera envoyé.';
}

/**
 * Restore a session on page load using the HttpOnly refresh cookie.
 * Returns the server-validated profile (or null when not authenticated).
 */
export async function restoreSession(): Promise<UserProfile | null> {
  const res = await apiFetch(`${BASE}/users/me`, { method: 'GET' });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({})) as {
    user: BackendUser;
    company?: BackendCompany | null;
  };
  return mapUserToProfile(data.user, data.company ?? null);
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${BASE}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    /* ignore network errors on logout */
  }
  setAccessToken(null);
}

// ---------------- Devis API (minimal client wrappers) --------------------
export async function listDevis(opts?: { page?: number; limit?: number; status?: string; search?: string }) {
  const q = new URLSearchParams();
  if (opts?.page) q.set('page', String(opts.page));
  if (opts?.limit) q.set('limit', String(opts.limit));
  if (opts?.status) q.set('status', opts.status);
  if (opts?.search) q.set('search', opts.search);
  const url = `${BASE}/devis${q.toString() ? '?' + q.toString() : ''}`;
  const res = await apiFetch(url, { method: 'GET' });
  if (!res.ok) throw new Error('Failed to list devis');
  return await res.json().catch(() => ({ data: [], page: 1, limit: 20, total: 0 }));
}

// ---------------- Prices API ---------------------------------------------
export async function listPrices(opts?: { materialId?: string; market?: string; currency?: string; limit?: number }) {
  const q = new URLSearchParams();
  if (opts?.materialId) q.set('materialId', opts.materialId);
  if (opts?.market) q.set('market', opts.market);
  if (opts?.currency) q.set('currency', opts.currency);
  if (opts?.limit) q.set('limit', String(opts.limit));
  const url = `${BASE}/prices${q.toString() ? '?' + q.toString() : ''}`;
  const res = await apiFetch(url, { method: 'GET' });
  if (!res.ok) throw new Error('Failed to list prices');
  return await res.json().catch(() => ({ data: [], page: 1, limit: 20, total: 0 }));
}

// ---------------- Trades API (Phase 2B — read-only registry) --------------
export async function listTrades(opts?: { officialOnly?: boolean }) {
  const q = new URLSearchParams();
  if (opts?.officialOnly) q.set('officialOnly', 'true');
  const url = `${BASE}/trades${q.toString() ? '?' + q.toString() : ''}`;
  const res = await apiFetch(url, { method: 'GET' });
  if (!res.ok) throw new Error('Failed to list trades');
  return await res.json().catch(() => ({ data: [] }));
}

// Phase D — data-driven services for a trade (from trade_services table).
export async function listTradeServices(tradeId: string): Promise<any[]> {
  const url = `${BASE}/trades/${encodeURIComponent(tradeId)}/services`;
  const res = await apiFetch(url, { method: 'GET' });
  if (!res.ok) return [];
  const json = await res.json().catch(() => ({ data: [] }));
  return Array.isArray(json?.data) ? json.data : [];
}

// DYNAMIC MÉTRÉ — data-driven elements for a trade (trade_metre_elements).
// Returns [] on any failure so `loadMetreElementsForTrade` falls back to the
// METRE_ELEMENTS config registry (never an empty replacement).
export async function listTradeMetreElements(tradeId: string): Promise<any[]> {
  const url = `${BASE}/trades/${encodeURIComponent(tradeId)}/metre-elements`;
  const res = await apiFetch(url, { method: 'GET' });
  if (!res.ok) return [];
  const json = await res.json().catch(() => ({ data: [] }));
  return Array.isArray(json?.data) ? json.data : [];
}

// PHASE 1 — Calculators Rules Bridge: read-only rows of country_calculation_rules.
// Returns [] on any failure so the calculator falls back to its current defaults.
export async function listCountryCalcRules(country: string): Promise<any[]> {
  const url = `${BASE}/reference/calc-rules?country=${encodeURIComponent(country)}`;
  const res = await apiFetch(url, { method: 'GET' });
  if (!res.ok) return [];
  const json = await res.json().catch(() => ({ data: [] }));
  return Array.isArray(json?.data) ? json.data : [];
}

// ─────────────── PHASE 1 — International reference readers (ADDITIVE) ───────
// Read-only GET /reference/* consumers for the API-first country registry.
// EVERY reader returns `null` on ANY failure (offline, 503, malformed body) so
// the client registry keeps its local fallback — never an empty replacement.

/** Row shape of `GET /reference/countries` (drizzle `countries`, snake→camel). */
export interface ReferenceCountryRow {
  code: string;
  nameFr: string;
  nameAr?: string | null;
  flag?: string | null;
  defaultCurrency: string;
  supportedCurrencies?: unknown;
  defaultVatRate?: string | number | null;
  timbreFiscalDefault?: string | number | null;
  standardRetenueRate?: string | number | null;
  buildingCodes?: string | null;
  unitSystem?: string | null;
  isDefaultMarket?: boolean;
  isActive?: boolean;
}

/** Row shape of `GET /reference/currencies`. */
export interface ReferenceCurrencyRow {
  code: string;
  label: string;
  symbol?: string | null;
  /** numeric column → arrives as string from the pg driver. */
  decimals?: string | number | null;
  isActive?: boolean;
}

/** Row shape of `GET /reference/fx-rates` (rate = quote per 1 base). */
export interface ReferenceFxRateRow {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string | number;
  source?: string;
  effectiveFrom?: string;
}

/** Row shape of `GET /reference/tax-rules` (VAT / TIMBRE / RETENUE …). */
export interface ReferenceTaxRuleRow {
  countryCode: string;
  taxType: string;
  rate?: string | number | null;
  labelFr?: string | null;
  labelAr?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
}

async function listReferenceRows<T>(path: string): Promise<T[] | null> {
  try {
    const res = await apiFetch(`${BASE}${path}`, { method: 'GET' });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    return json && Array.isArray((json as any).data) ? ((json as any).data as T[]) : null;
  } catch {
    return null;
  }
}

export async function listReferenceCountries(): Promise<ReferenceCountryRow[] | null> {
  return listReferenceRows<ReferenceCountryRow>('/reference/countries');
}

export async function listReferenceCurrencies(): Promise<ReferenceCurrencyRow[] | null> {
  return listReferenceRows<ReferenceCurrencyRow>('/reference/currencies');
}

/** FX rows for ONE base (the registry only converts FROM TND). */
export async function listReferenceFxRates(base?: string): Promise<ReferenceFxRateRow[] | null> {
  const q = base ? `?base=${encodeURIComponent(base)}` : '';
  return listReferenceRows<ReferenceFxRateRow>(`/reference/fx-rates${q}`);
}

export async function listReferenceTaxRules(country?: string): Promise<ReferenceTaxRuleRow[] | null> {
  const q = country ? `?country=${encodeURIComponent(country)}` : '';
  return listReferenceRows<ReferenceTaxRuleRow>(`/reference/tax-rules${q}`);
}

// ─────────────── Admin → Métiers (trades registry, admin-only writes) ───────

// The SAME `trades` registry Outils + Services read. No second data source:
// `isActive=false` removes the métier from both tabs at once.

/** Admin-only: also returns deactivated trades (requires an admin session). */
export async function listTradesForAdmin(opts?: { officialOnly?: boolean }): Promise<any[]> {
  const q = new URLSearchParams({ includeInactive: 'true' });
  if (opts?.officialOnly) q.set('officialOnly', 'true');
  const res = await apiFetch(`${BASE}/trades?${q.toString()}`, { method: 'GET' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message || 'Failed to list trades');
  }
  const json = await res.json().catch(() => ({ data: [] }));
  return Array.isArray(json?.data) ? json.data : [];
}

export interface TradePatchPayload {
  labelFr?: string;
  labelAr?: string | null;
  labelDerja?: string | null;
  icon?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

/** Admin-only: update labels/icon/sortOrder/activation of ONE trade. */
export async function updateTrade(id: string, patch: TradePatchPayload): Promise<any> {
  const res = await apiFetch(`${BASE}/trades/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message || 'Failed to update trade');
  }
  const json = await res.json().catch(() => null);
  return json?.data ?? null;
}

/** Admin-only: delete a NON-OFFICIAL trade (official trades → 409). */
export async function deleteTrade(id: string): Promise<void> {
  const res = await apiFetch(`${BASE}/trades/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message || 'Failed to delete trade');
  }
}

/** Admin-only: list a trade's services INCLUDING deactivated ones. */
export async function listTradeServicesForAdmin(tradeId: string): Promise<any[]> {
  const url = `${BASE}/trades/${encodeURIComponent(tradeId)}/services?includeInactive=true`;
  const res = await apiFetch(url, { method: 'GET' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message || 'Failed to list trade services');
  }
  const json = await res.json().catch(() => ({ data: [] }));
  return Array.isArray(json?.data) ? json.data : [];
}

/** Admin-only: create/update ONE service of a trade (idempotent by nameFr). */
export async function upsertTradeService(
  tradeId: string,
  body: { nameFr: string; nameAr?: string | null; defaultUnit?: string; suggestedRateTnd?: number | null; sortOrder?: number }
): Promise<any> {
  const res = await apiFetch(`${BASE}/trades/${encodeURIComponent(tradeId)}/services`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message || 'Failed to save trade service');
  }
  const json = await res.json().catch(() => null);
  return json?.data ?? null;
}

/** Admin-only: activate/deactivate ONE service (the row is never deleted). */
export async function setTradeServiceActive(
  tradeId: string,
  serviceId: string,
  isActive: boolean
): Promise<any> {
  const res = await apiFetch(
    `${BASE}/trades/${encodeURIComponent(tradeId)}/services/${encodeURIComponent(serviceId)}`,
    { method: 'PATCH', body: JSON.stringify({ isActive }) }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message || 'Failed to update trade service');
  }
  const json = await res.json().catch(() => null);
  return json?.data ?? null;
}

// ─────────────── Catalog state (DB truth for archived/deactivated refs) ───────

/**
 * Read-only DB truth: the reference codes the catalog no longer serves
 * (`materials.is_deleted = true` official rows, `trades.is_active = false`).
 * Public/additive; returns `null` on ANY failure so a caller never mistakes an
 * unreachable endpoint for "nothing is archived" (fail-safe suppression list).
 */
export async function listInactiveCatalogRefs(): Promise<{ tradeCodes: string[]; materialCodes: string[] } | null> {
  try {
    const res = await apiFetch(`${BASE}/catalog/inactive-refs`, { method: 'GET' });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const data = json?.data;
    if (!data || typeof data !== 'object') return null;
    return {
      tradeCodes: Array.isArray(data.tradeCodes) ? data.tradeCodes.filter((c: any) => typeof c === 'string') : [],
      materialCodes: Array.isArray(data.materialCodes) ? data.materialCodes.filter((c: any) => typeof c === 'string') : [],
    };
  } catch {
    return null;
  }
}

/**
 * ADMIN ONLY — archive (soft delete) ONE official material so it stops being
 * served by /prices + /materials. Reversible: the row, its code, its price
 * history and every Devis snapshot stay untouched; re-importing the same code
 * publishes it again.
 *
 * `reference` accepts the material code or the calculator's id spelling
 * (`plaque-ba13-standard` ↔ `plaque_ba13_standard`). Returns the archived row
 * reported by the server, or throws with the server's message. A 404 means the
 * material does not exist in the database (the caller may still remove it
 * locally, but must say so instead of pretending a server write happened).
 */
export async function archiveCatalogMaterial(reference: string): Promise<{ id: string; code: string; isDeleted: boolean }> {
  const res = await apiFetch(`${BASE}/materials/${encodeURIComponent(reference)}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const error: any = new Error((err as any)?.error?.message || `Failed to archive material '${reference}'`);
    error.status = res.status;
    throw error;
  }
  const json = await res.json().catch(() => null);
  return json?.data ?? { id: reference, code: reference, isDeleted: true };
}

// ─────────────── Features & Entitlements (FREE/PRO) ───────────────
// Plan is resolved SERVER-side from the company subscription; users without
// a company default to FREE. Never cached in JWT — always fetched fresh.
export async function listMyFeatures(): Promise<{ planCode: 'free' | 'pro'; enforced?: boolean; features: any[] }> {
  const res = await apiFetch(`${BASE}/features`, { method: 'GET' });
  if (!res.ok) return { planCode: 'free', features: [] };
  const json = await res.json().catch(() => null);
  return json?.data ?? { planCode: 'free', features: [] };
}

/** Check access (plan + usage) for one feature key. */
export async function checkFeatureAccess(featureKey: string): Promise<any | null> {
  const res = await apiFetch(`${BASE}/features/${encodeURIComponent(featureKey)}`, { method: 'GET' });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  return json?.data ?? null;
}

// ─────────── Admin Features API (Phase 2 — server-backed admin controls) ────
// Admin-only management of the SAME Feature Entitlement system the backend
// enforces (server/routes/v1/adminFeatures.ts). P3: the backend now REALLY
// enforces these rows (freeAccess / proAccess / role `scope` / usageLimit),
// so an admin change takes effect on the next access check — no UI-side plan
// state, no paywall toggle to flip elsewhere.
export type { AdminFeatureEntitlement, AdminFeatureUpsertPayload } from './adminFeatures';

/** List all feature entitlements (admin-only). Throws with the server message. */
export async function listAdminFeatures(): Promise<AdminFeatureEntitlement[]> {
  const res = await apiFetch(`${BASE}/admin/features`, { method: 'GET' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message || 'Failed to list feature entitlements');
  }
  const json = await res.json().catch(() => null);
  return Array.isArray(json?.data) ? json.data.map(mapAdminFeatureRow) : [];
}

/** Create/update one feature entitlement (admin-only upsert). */
export async function upsertAdminFeature(
  body: AdminFeatureUpsertPayload
): Promise<AdminFeatureEntitlement> {
  const res = await apiFetch(`${BASE}/admin/features`, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message || 'Failed to save feature entitlement');
  }
  const json = await res.json().catch(() => null);
  return mapAdminFeatureRow(json?.data);
}

/** Soft-deactivate one feature entitlement (admin-only; row stays in the DB). */
export async function deactivateAdminFeature(featureKey: string): Promise<void> {
  const res = await apiFetch(`${BASE}/admin/features/${encodeURIComponent(featureKey)}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message || 'Failed to deactivate feature entitlement');
  }
}

// ─────────── Admin Plans API (P3 — REAL FREE/PRO control) ───────────────────
// Admin-only management of a company's plan on the EXISTING subscriptions row
// (server/routes/v1/adminPlans.ts → planAdminService → subscriptionRepositoryAsync,
// the same repository PaymentService/Flouci webhook writes to). The returned
// `planCode` is resolved by the SAME rule access control uses (getUserPlan for
// a user target, planCodeFromSubscription for a company target), so the admin
// never sees a plan different from the one enforced.

export interface AdminPlanView {
  planCode: AdminPlanCode;
  enforced: boolean;
  companyId: string;
  subscription: any | null;
  /** How the plan was resolved (proves it comes from the access-control source). */
  resolvedFrom?: 'user_plan' | 'company_subscription';
  /** Echo of the requested plan on POST. */
  requestedPlan?: AdminPlanCode;
}

function mapAdminPlanView(raw: any): AdminPlanView {
  const planCode: AdminPlanCode = raw?.planCode === 'pro' ? 'pro' : 'free';
  return {
    planCode,
    enforced: Boolean(raw?.enforced),
    companyId: String(raw?.companyId ?? ''),
    subscription: raw?.subscription ?? null,
    resolvedFrom: raw?.resolvedFrom,
    requestedPlan: raw?.requestedPlan,
  };
}

/** Resolve the current plan of a user/company (admin-only). */
export async function getAdminPlan(target: AdminPlanTarget): Promise<AdminPlanView> {
  const res = await apiFetch(`${BASE}/admin/plans?${buildAdminPlanQuery(target)}`, { method: 'GET' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message || 'Failed to resolve the plan');
  }
  const json = await res.json().catch(() => null);
  return mapAdminPlanView(json?.data);
}

/** Grant FREE/PRO to a user/company (admin-only; backend-verified). */
export async function setAdminPlan(
  target: AdminPlanTarget & { plan: AdminPlanCode }
): Promise<AdminPlanView> {
  const body: any = { plan: target.plan };
  if (target.email) body.email = target.email;
  if (target.companyId) body.companyId = target.companyId;
  if (target.userId) body.userId = target.userId;
  const res = await apiFetch(`${BASE}/admin/plans`, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message || 'Failed to update the plan');
  }
  const json = await res.json().catch(() => null);
  return mapAdminPlanView(json?.data);
}

// ---------------- Catalog (Admin → PostgreSQL) ----------------
/**
 * Step 5 — upsert an OFFICIAL material + its official current price.
 * Requires CATALOG_OFFICIAL_MANAGE (admin / ENTERPRISE).
 */
export async function upsertCatalogItem(body: {
  code: string;
  price: number;
  nameFr: string;
  nameAr?: string;
  nameEn?: string;
  trade?: string;
  category?: string;
  unit?: string;
  currencyCode?: string;
  countryCode?: string;
  effectiveFrom?: string;
  technicalSpecs?: string;
}) {
  const res = await apiFetch(`${BASE}/catalog/upsert`, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message || 'Failed to upsert catalog item');
  }
  const data = await res.json();
  return data.data || data;
}

// ─────────────── Phase A — Admin bulk CSV import (transactional) ───────────
/**
 * Upload the RAW CSV file to POST /catalog/import-csv. The server does ALL
 * parsing/validation/persistence inside ONE database transaction
 * (all-or-nothing) and returns a per-row report:
 *   { totalRows, committed, imported, updated, failed[] }.
 * Requires CATALOG_OFFICIAL_MANAGE (admin). Unknown trades are refused by the
 * server (never coerced to 'placo'; dynamic trades come in Phase B).
 *
 * Uses a raw fetch (NOT apiFetch) on purpose: a multipart FormData body must
 * keep its own multipart Content-Type with boundary (apiFetch forces
 * application/json, which would break the multipart parsing server-side).
 */
export async function importCatalogCsv(
  file: File,
  opts?: { countryCode?: string; currencyCode?: string }
): Promise<any> {
  const q = new URLSearchParams();
  if (opts?.countryCode) q.set('countryCode', opts.countryCode);
  if (opts?.currencyCode) q.set('currencyCode', opts.currencyCode);

  const form = new FormData();
  form.append('file', file, file.name);

  const headers: Record<string, string> = {};
  if (getAccessToken()) headers.Authorization = `Bearer ${getAccessToken()}`;

  const res = await fetch(`${BASE}/catalog/import-csv${q.toString() ? '?' + q.toString() : ''}`, {
    method: 'POST',
    body: form,
    headers,
    credentials: 'include',
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error((payload as any)?.error?.message || 'CSV import failed');
    err.status = res.status;
    err.report = (payload as any)?.data;
    throw err;
  }
  return payload;
}

// ─────────────── Phase C — Smart Mapping import (CSV + XLSX) ───────────────
/**
 * Shared raw-fetch uploader for the Phase C Smart Mapping endpoints
 * (POST /catalog/preview and POST /catalog/import). Same protections as
 * importCatalogCsv: multipart body keeps its own boundary Content-Type and
 * the Bearer token is attached manually.
 */
async function catalogFileRequest(
  path: string,
  file: File,
  opts?: { mapping?: Record<string, string>; countryCode?: string; currencyCode?: string; defaultTrade?: string }
): Promise<any> {
  const q = new URLSearchParams();
  if (opts?.countryCode) q.set('countryCode', opts.countryCode);
  if (opts?.currencyCode) q.set('currencyCode', opts.currencyCode);
  // Preserve manual mapping: `{}` is a valid explicit value (no deltas), so
  // only undefined/null means "absent". An empty object must still be sent —
  // the server `{}` guard then keeps its auto-suggestion (never unmapped).
  if (opts?.mapping !== undefined && opts?.mapping !== null) q.set('mapping', JSON.stringify(opts.mapping));
  // P1 — explicit "Métier par défaut" for files without a trade column.
  if (opts?.defaultTrade && opts.defaultTrade.trim() !== '') q.set('defaultTrade', opts.defaultTrade.trim());

  const form = new FormData();
  form.append('file', file, file.name);
  // The mapping override must travel INSIDE the multipart body too: the
  // import endpoints read multipart fields (not only ?mapping=), otherwise a
  // manual column choice would be silently dropped on confirm.
  if (opts?.mapping !== undefined && opts?.mapping !== null) form.append('mapping', JSON.stringify(opts.mapping));
  if (opts?.defaultTrade && opts.defaultTrade.trim() !== '') form.append('defaultTrade', opts.defaultTrade.trim());

  const headers: Record<string, string> = {};
  if (getAccessToken()) headers.Authorization = `Bearer ${getAccessToken()}`;

  const res = await fetch(`${BASE}${path}${q.toString() ? '?' + q.toString() : ''}`, {
    method: 'POST',
    body: form,
    headers,
    credentials: 'include',
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error((payload as any)?.error?.message || 'Catalog import request failed');
    err.status = res.status;
    err.report = (payload as any)?.data;
    throw err;
  }
  return payload;
}

/**
 * Phase C — Upload a .csv/.xlsx file to POST /catalog/preview.
 * Returns the detected columns, the suggested mapping, sample normalized
 * rows and the validation report. NO catalog data is written.
 */
export async function previewCatalogImport(
  file: File,
  opts?: { mapping?: Record<string, string>; countryCode?: string; currencyCode?: string; defaultTrade?: string }
): Promise<any> {
  return catalogFileRequest('/catalog/preview', file, opts);
}

/**
 * Phase C — Upload a .csv/.xlsx file to POST /catalog/import with the Admin
 * confirmed mapping. Commits through the server-side transactional pipeline
 * (dynamic trades + ONE transaction) — PER ROW: only the valid rows are
 * written, the rejected ones are reported (200 `rejected`/`rejectedCount`)
 * and never block them. Refused (400, nothing written) when the file schema
 * is unusable (mapping errors, unmapped required fields) or when NO row is
 * importable.
 */
export async function importCatalogFile(
  file: File,
  opts?: { mapping?: Record<string, string>; countryCode?: string; currencyCode?: string; defaultTrade?: string }
): Promise<any> {
  return catalogFileRequest('/catalog/import', file, opts);
}

// ─────────────── Price Update Foundation (Step 8) ───────────────────────────
// Incoming Price Update → Pending → Admin Review → Official Current Price.
// All require CATALOG_OFFICIAL_MANAGE (server-side, unchanged).

export async function listPendingPriceUpdates(opts?: { countryCode?: string; currencyCode?: string }) {
  const q = new URLSearchParams();
  if (opts?.countryCode) q.set('countryCode', opts.countryCode);
  if (opts?.currencyCode) q.set('currencyCode', opts.currencyCode);
  const res = await apiFetch(`${BASE}/catalog/price-updates/pending?${q.toString()}`, { method: 'GET' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message || 'Failed to list pending price updates');
  }
  const data = await res.json();
  return data.data || [];
}

export async function submitPendingPriceUpdate(body: {
  materialCode: string;
  price: number;
  currencyCode?: string;
  countryCode?: string;
  supplierId?: string;
  effectiveFrom?: string;
  notes?: string;
}) {
  const res = await apiFetch(`${BASE}/catalog/price-updates`, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message || 'Failed to submit pending price update');
  }
  const data = await res.json();
  return data.data || data;
}

export async function approvePendingPriceUpdate(id: string) {
  const res = await apiFetch(`${BASE}/catalog/price-updates/${id}/approve`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message || 'Failed to approve pending price update');
  }
  const data = await res.json();
  return data.data || data;
}

export async function createDevis(body: any, idempotencyKey?: string) {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await apiFetch(`${BASE}/devis`, { method: 'POST', body: JSON.stringify(body), headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message || 'Failed to create devis');
  }
  const data = await res.json();
  return data.data || data;
}

export async function updateDevis(id: string, body: any) {
  const res = await apiFetch(`${BASE}/devis/${id}`, { method: 'PUT', body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message || 'Failed to update devis');
  }
  const data = await res.json();
  return data.data || data;
}

export async function deleteDevis(id: string) {
  const res = await apiFetch(`${BASE}/devis/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message || 'Failed to delete devis');
  }
  return;
}

// ---------------- Projects API (Phase 1 — wire the existing endpoint) -------
// `POST /api/v1/projects` already exists on the server (authenticate +
// requireFeature('projects:save') + usage tracking). It used to require a
// client-supplied `companyId`; the server now resolves the company from the
// JWT when the body omits it, so this wrapper sends only project data.
export async function createProject(body: any) {
  const res = await apiFetch(`${BASE}/projects`, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message || 'Failed to create project');
  }
  const data = await res.json();
  return data.data || data;
}

export async function listProjects(opts?: { page?: number; limit?: number; status?: string; region?: string; search?: string }) {
  const q = new URLSearchParams();
  if (opts?.page) q.set('page', String(opts.page));
  if (opts?.limit) q.set('limit', String(opts.limit));
  if (opts?.status) q.set('status', opts.status);
  if (opts?.region) q.set('region', opts.region);
  if (opts?.search) q.set('search', opts.search);
  const url = `${BASE}/projects${q.toString() ? '?' + q.toString() : ''}`;
  const res = await apiFetch(url, { method: 'GET' });
  if (!res.ok) throw new Error('Failed to list projects');
  return await res.json().catch(() => ({ data: [], page: 1, limit: 50, total: 0 }));
}

// ── Phase 2/3 — Admin usage analytics (real DB aggregation, read-only) ─────
export interface AdminUsageTopUser {
  userId: string;
  totalUsage: number;
}

export interface AdminUsagePeriodPoint {
  periodStart: string;
  totalUsage: number;
  /** Distinct users with usage inside this period ("active users"). */
  activeUsers: number;
}

export interface AdminUsageRoleStat {
  role: string;
  totalUsage: number;
  uniqueUsers: number;
}

export interface AdminFeatureUsageStat {
  featureKey: string;
  totalUsage: number;
  uniqueUsers: number;
  currentMonthUsage: number;
  lastActivityAt: string | null;
  /** Phase 3 — present only when topUsers=1 was requested (admin-only). */
  topUsers?: AdminUsageTopUser[];
}

export interface AdminFeatureUsageStats {
  periodStart: string;
  totalUsage: number;
  generatedAt: string;
  /** Sorted by usage desc — top-used features first. */
  features: AdminFeatureUsageStat[];
  /** Phase 3 — echoed range when from/to were provided. */
  from?: string;
  to?: string;
  /** Phase 3 — distinct users with usage inside the selected range. */
  activeUsersInRange: number;
  /** Phase 3 — per-period series (ascending). */
  series: AdminUsagePeriodPoint[];
  /** Phase 3 — usage per role (read-only join with users.global_role). */
  roleBreakdown: AdminUsageRoleStat[];
}

/** GET /api/v1/admin/features/usage — admin-only, read-only usage statistics. */
export async function getFeatureUsageStats(
  params: { from?: string; to?: string; topUsers?: boolean } = {}
): Promise<AdminFeatureUsageStats> {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.topUsers) qs.set('topUsers', '1');
  const query = qs.toString();
  const res = await apiFetch(`${BASE}/admin/features/usage${query ? `?${query}` : ''}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message || 'Failed to load feature usage statistics');
  }
  const data = await res.json();
  return data.data || data;
}

// ───────────── Phase E — PRO subscription checkout (real flow) ──────────────
/**
 * Create a PRO checkout session via POST /api/v1/payments/checkout.
 *
 * Contract (server-owned): the amount/plan/price are resolved SERVER-SIDE —
 * this client sends only non-monetary redirect URLs, never an amount or tier.
 * companyId comes from the JWT; PRO activates ONLY after the backend verifies
 * the payment (webhook → verify_payment → verifyAndSettle).
 *
 * Fails CLOSED with a readable message when the backend refuses (e.g. Flouci
 * credentials not configured). Callers must surface that error — never fake a
 * PRO state from the client.
 */
export interface ProCheckoutResult {
  paymentId: string;
  checkoutUrl: string;
  replay: boolean;
}

export async function requestProCheckout(referenceId?: string): Promise<ProCheckoutResult> {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const body: Record<string, string> = {
    successLink: `${origin}/payment/success`,
    failLink: `${origin}/payment/fail`,
  };
  if (referenceId) body.referenceId = referenceId;

  const res = await apiFetch(`${BASE}/payments/checkout`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = (err as any)?.error?.message ?? (err as any)?.error;
    throw new Error(
      typeof msg === 'string' && msg ? msg : 'Payment is temporarily unavailable',
    );
  }
  const data = await res.json().catch(() => ({} as any));
  if (!data?.checkoutUrl || typeof data.checkoutUrl !== 'string') {
    throw new Error('Payment provider did not return a checkout URL');
  }
  return {
    paymentId: typeof data.paymentId === 'string' ? data.paymentId : '',
    checkoutUrl: data.checkoutUrl,
    replay: data.replay === true,
  };
}
// ─────────────────────────────────────────────────────────────────────────────
// Global Catalog Admin
// ─────────────────────────────────────────────────────────────────────────────

export interface GlobalCatalogProduct {
  id: string;
  name: string;
  brand?: string | null;
  manufacturer?: string | null;
  category?: string | null;
  subcategory?: string | null;
  description?: string | null;
  specification?: string | null;
  unit?: string | null;
  model?: string | null;
  sku?: string | null;
  status?: string | null;
  media?: unknown;
  extra?: unknown;
  createdAt?: string;
  updatedAt?: string;
}

export interface GlobalCatalogProductInput {
  name: string;
  brand?: string;
  manufacturer?: string;
  category?: string;
  subcategory?: string;
  description?: string;
  specification?: string;
  unit?: string;
  model?: string;
  sku?: string;
  status?: string;
  media?: unknown;
  extra?: unknown;
}

export async function listGlobalCatalogProducts(params: {
  search?: string;
  page?: number;
  limit?: number;
} = {}): Promise<any> {
  const qs = new URLSearchParams();

  if (params.search) qs.set('search', params.search);
  if (params.page !== undefined) qs.set('page', String(params.page));
  if (params.limit !== undefined) qs.set('limit', String(params.limit));

  const query = qs.toString();
  const res = await apiFetch(
    `${BASE}/global-catalog/products${query ? `?${query}` : ''}`,
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message =
      (err as any)?.error?.message ||
      (err as any)?.error ||
      'Failed to load Global Catalog products';

    throw new Error(
      typeof message === 'string'
        ? message
        : 'Failed to load Global Catalog products',
    );
  }

  const data = await res.json();
  return data.data ?? data;
}

export async function getGlobalCatalogProduct(
  id: string,
): Promise<GlobalCatalogProduct> {
  const res = await apiFetch(
    `${BASE}/global-catalog/products/${encodeURIComponent(id)}`,
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message =
      (err as any)?.error?.message ||
      (err as any)?.error ||
      'Failed to load Global Catalog product';

    throw new Error(
      typeof message === 'string'
        ? message
        : 'Failed to load Global Catalog product',
    );
  }

  const data = await res.json();
  return data.data ?? data;
}

export async function adminCreateGlobalProduct(
  input: GlobalCatalogProductInput,
): Promise<GlobalCatalogProduct> {
  const res = await apiFetch(`${BASE}/global-catalog/admin/products`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message =
      (err as any)?.error?.message ||
      (err as any)?.error ||
      'Failed to create Global Catalog product';

    throw new Error(
      typeof message === 'string'
        ? message
        : 'Failed to create Global Catalog product',
    );
  }

  const data = await res.json();
  return data.data ?? data;
}

export async function adminUpdateGlobalProduct(
  id: string,
  input: Partial<GlobalCatalogProductInput>,
): Promise<GlobalCatalogProduct> {
  const res = await apiFetch(
    `${BASE}/global-catalog/admin/products/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message =
      (err as any)?.error?.message ||
      (err as any)?.error ||
      'Failed to update Global Catalog product';

    throw new Error(
      typeof message === 'string'
        ? message
        : 'Failed to update Global Catalog product',
    );
  }

  const data = await res.json();
  return data.data ?? data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Global Catalog — Import (CSV / XLSX) + Review workflow
// ─────────────────────────────────────────────────────────────────────────────

export interface GlobalCatalogImportPreviewItem {
  sourceRow: number;
  raw: Record<string, string>;
  normalized: any;
  errors: string[];
  matchStatus: 'new' | 'matched' | 'possible_match' | 'review_required';
  matchedGlobalProductId?: string | null;
  confidence: number;
}

export interface GlobalCatalogImportPreview {
  fileType: 'csv' | 'xlsx';
  headers: string[];
  items: GlobalCatalogImportPreviewItem[];
  summary: {
    total: number;
    valid: number;
    invalid: number;
    matched: number;
    reviewRequired: number;
    new: number;
  };
  fileSha256: string;
}

export interface GlobalCatalogImportResult {
  importId: string;
  created: number;
  matched: number;
  updated: number;
  reviewRequired: number;
  skipped: number;
  invalid: number;
  rejected: number;
}

export interface GlobalCatalogImportItem {
  id: string;
  importId: string;
  sourceRow?: number | null;
  countryCode?: string | null;
  raw?: Record<string, any> | null;
  normalized?: Record<string, any> | null;
  matchStatus: string;
  matchedGlobalProductId?: string | null;
  matchedMaterialId?: string | null;
  confidence?: number | null;
  notes?: string | null;
}

/**
 * Shared raw-fetch uploader for the Global Catalog import endpoints
 * (POST /global-catalog/admin/import/preview and …/commit).
 *
 * Same protection as `catalogFileRequest`: the multipart body must keep its own
 * Content-Type with boundary (apiFetch forces application/json, which breaks the
 * server-side multipart parsing) and the Bearer token is attached manually.
 */
async function globalCatalogFileRequest(
  path: string,
  file: File,
  opts?: { countryCode?: string; skipNoId?: boolean },
): Promise<any> {
  const q = new URLSearchParams();
  if (opts?.countryCode) q.set('country', opts.countryCode);
  if (opts?.skipNoId) q.set('skipNoId', 'true');

  const form = new FormData();
  form.append('file', file, file.name);

  const headers: Record<string, string> = {};
  if (getAccessToken()) headers.Authorization = `Bearer ${getAccessToken()}`;

  const res = await fetch(`${BASE}${path}${q.toString() ? '?' + q.toString() : ''}`, {
    method: 'POST',
    body: form,
    headers,
    credentials: 'include',
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (payload as any)?.error?.message || 'Global Catalog import request failed',
    );
  }
  return (payload as any)?.data ?? payload;
}

/** POST /global-catalog/admin/import/preview — parses the file, writes NOTHING. */
export async function previewGlobalCatalogImport(
  file: File,
  opts?: { countryCode?: string },
): Promise<GlobalCatalogImportPreview> {
  return globalCatalogFileRequest('/global-catalog/admin/import/preview', file, opts);
}

/** POST /global-catalog/admin/import/commit — one transaction, returns importId. */
export async function commitGlobalCatalogImport(
  file: File,
  opts?: { countryCode?: string; skipNoId?: boolean },
): Promise<GlobalCatalogImportResult> {
  return globalCatalogFileRequest('/global-catalog/admin/import/commit', file, opts);
}

/** GET /global-catalog/admin/imports/:importId/items */
export async function listGlobalCatalogImportItems(params: {
  importId: string;
  matchStatus?: string;
  limit?: number;
  offset?: number;
}): Promise<GlobalCatalogImportItem[]> {
  const qs = new URLSearchParams();
  if (params.matchStatus) qs.set('matchStatus', params.matchStatus);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset !== undefined) qs.set('offset', String(params.offset));

  const query = qs.toString();
  const res = await apiFetch(
    `${BASE}/global-catalog/admin/imports/${encodeURIComponent(params.importId)}/items${
      query ? `?${query}` : ''
    }`,
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message =
      (err as any)?.error?.message ||
      (err as any)?.error ||
      'Failed to load Global Catalog import items';

    throw new Error(
      typeof message === 'string'
        ? message
        : 'Failed to load Global Catalog import items',
    );
  }

  const data = await res.json();
  const payload = data.data ?? data;

  return Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : [];
}

/**
 * One existing `catalog_imports` run (Admin Import History, read-only).
 * `new` is the number of staged items still flagged as `new` by the matcher.
 */
export interface GlobalCatalogImportRun {
  importId: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  fileName?: string | null;
  sourceId?: string | null;
  sourceName?: string | null;
  sourceType?: string | null;
  fileType?: string | null;
  fileMimeType?: string | null;
  fileSha256?: string | null;
  countryCode?: string | null;
  status: string;
  total: number;
  valid: number;
  invalid: number;
  matched: number;
  review: number;
  new: number;
  approved: number;
  imported: number;
  updated: number;
  rejected: number;
  errorSummary?: string | null;
}

/**
 * GET /global-catalog/admin/imports — READ-ONLY list of the existing import runs.
 * No mutation: it only reads the `catalog_imports` rows already in the database.
 */
export async function listGlobalCatalogImports(
  params: { status?: string; limit?: number; offset?: number } = {},
): Promise<GlobalCatalogImportRun[]> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset !== undefined) qs.set('offset', String(params.offset));

  const query = qs.toString();
  const res = await apiFetch(
    `${BASE}/global-catalog/admin/imports${query ? `?${query}` : ''}`,
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message =
      (err as any)?.error?.message ||
      (err as any)?.error ||
      'Failed to load Global Catalog import history';

    throw new Error(
      typeof message === 'string'
        ? message
        : 'Failed to load Global Catalog import history',
    );
  }

  const data = await res.json();
  const payload = data.data ?? data;
  const rows = Array.isArray(payload) ? payload : payload?.data;

  return Array.isArray(rows) ? rows : [];
}

/**
 * Connection settings of an API source, stored under `configuration.api`.
 *
 * SECURITY: this project has NO secrets abstraction (no vault / encryption /
 * secret table), so a new secrets system is deliberately NOT introduced in
 * Phase 1. This shape only carries NON-SENSITIVE REFERENCES:
 *  - `credentialRef`  → the NAME of an environment variable / secret-store
 *                       entry (e.g. `MY_SOURCE_API_KEY`), never the value;
 *  - `headerNames`    → HTTP header NAMES only, never a header value.
 * The server enforces both with a key allow-list + strict patterns and
 * rejects any other field (so `apiKey`, `token`, `password` can never be sent).
 *
 * Phase 3 adds the optional `mapping` block (response root / product
 * collection / field paths). It is pure metadata: no request, no import and
 * no sync is derived from it yet, and it stores no response data or secret.
 */
export interface GlobalCatalogSourceApiMapping {
  /** Dot path to the object holding the product list ('' = document root). */
  root: string;
  /** Dot path (relative to `root`) of the product array ('' = root is it). */
  collection: string;
  /** Global Catalog field key → dot path relative to one product. */
  fields: Record<string, string>;
}

export interface GlobalCatalogSourceApiConfiguration {
  baseUrl: string;
  authType: string;
  headerNames: string[];
  credentialRef: string | null;
  credentialLocation: string;
  credentialKey: string;
  username: string | null;
  responseFormat: string;
  /** Absent on Phase 1 rows; `null` in a payload removes it. */
  mapping?: GlobalCatalogSourceApiMapping;
}

/**
 * The mappable Global Catalog fields — MIRROR of the server registry
 * (`API_MAPPING_FIELDS` in `server/repositories/globalCatalogRepository.ts`).
 *
 * The two lists can never be imported from one another (the server module
 * pulls in Drizzle/Postgres, so it must not enter the browser bundle), exactly
 * like `CatalogUploadModal.tsx` mirroring `CANONICAL_FIELDS`. A DB-free test
 * reads BOTH files and fails if they ever drift apart.
 */
export const GLOBAL_CATALOG_API_MAPPING_FIELDS: Array<{
  key: string;
  label: string;
  required: boolean;
}> = [
  { key: 'name', label: 'Nom du produit', required: true },
  { key: 'sku', label: 'SKU', required: false },
  { key: 'gtin', label: 'GTIN / EAN / UPC', required: false },
  { key: 'brand', label: 'Marque', required: false },
  { key: 'manufacturer', label: 'Fabricant', required: false },
  { key: 'category', label: 'Catégorie', required: false },
  { key: 'subcategory', label: 'Sous-catégorie', required: false },
  { key: 'unit', label: 'Unité', required: false },
  { key: 'description', label: 'Description', required: false },
  { key: 'price', label: 'Prix', required: false },
  { key: 'currency', label: 'Devise', required: false },
  { key: 'availability', label: 'Disponibilité', required: false },
];

/** One UI row: which Global Catalog field reads which response path. */
export type GlobalCatalogApiMappingRow = {
  field: string;
  path: string;
};

/**
 * `catalog_sources.configuration` — an open JSON object (legacy/unknown keys
 * are preserved verbatim) with the optional Phase 1 `api` block.
 */
export interface GlobalCatalogSourceConfiguration {
  api?: GlobalCatalogSourceApiConfiguration | null;
  [key: string]: unknown;
}

/**
 * One `catalog_sources` row (Admin Sources Management).
 * `lastSuccessfulSyncAt` stays null until a future sync phase runs.
 */
export interface GlobalCatalogSource {
  id: string;
  name: string;
  sourceType: string;
  countryCode?: string | null;
  provider?: string | null;
  url?: string | null;
  status: string;
  configuration?: GlobalCatalogSourceConfiguration;
  updateFrequency?: string | null;
  lastSuccessfulSyncAt?: string | null;
  lastError?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface GlobalCatalogSourceInput {
  name: string;
  sourceType: string;
  countryCode?: string | null;
  provider?: string | null;
  url?: string | null;
  status?: string | null;
  updateFrequency?: string | null;
  configuration?: GlobalCatalogSourceConfiguration;
}

/**
 * GET /global-catalog/admin/sources — list/search (read-only).
 * Filters: free-text `search`, `country`, `type`, `status`.
 */
export async function listGlobalCatalogSources(
  params: {
    search?: string;
    country?: string;
    type?: string;
    status?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<GlobalCatalogSource[]> {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.country) qs.set('country', params.country);
  if (params.type) qs.set('type', params.type);
  if (params.status) qs.set('status', params.status);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.offset !== undefined) qs.set('offset', String(params.offset));

  const query = qs.toString();
  const res = await apiFetch(
    `${BASE}/global-catalog/admin/sources${query ? `?${query}` : ''}`,
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message =
      (err as any)?.error?.message ||
      (err as any)?.error ||
      'Failed to load Global Catalog sources';

    throw new Error(
      typeof message === 'string'
        ? message
        : 'Failed to load Global Catalog sources',
    );
  }

  const data = await res.json();
  const payload = data.data ?? data;
  const rows = Array.isArray(payload) ? payload : payload?.data;

  return Array.isArray(rows) ? rows : [];
}

/** POST /global-catalog/admin/sources — create a source (no import/sync started). */
export async function adminCreateGlobalCatalogSource(
  input: GlobalCatalogSourceInput,
): Promise<GlobalCatalogSource> {
  const res = await apiFetch(`${BASE}/global-catalog/admin/sources`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message =
      (err as any)?.error?.message ||
      (err as any)?.error ||
      'Failed to create Global Catalog source';

    throw new Error(
      typeof message === 'string'
        ? message
        : 'Failed to create Global Catalog source',
    );
  }

  const data = await res.json();
  return data.data ?? data;
}

/** PATCH /global-catalog/admin/sources/:id — update or disable (`status: 'inactive'`). */
export async function adminUpdateGlobalCatalogSource(
  id: string,
  patch: Partial<GlobalCatalogSourceInput>,
): Promise<GlobalCatalogSource> {
  const res = await apiFetch(
    `${BASE}/global-catalog/admin/sources/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message =
      (err as any)?.error?.message ||
      (err as any)?.error ||
      'Failed to update Global Catalog source';

    throw new Error(
      typeof message === 'string'
        ? message
        : 'Failed to update Global Catalog source',
    );
  }

  const data = await res.json();
  return data.data ?? data;
}

/**
 * Phase 2 — Concise, credential-free result of a Test Connection probe.
 * The server never returns a response body, a credential, an Authorization
 * header, or a URL carrying a query (it returns `url.origin` only).
 */
export interface GlobalCatalogSourceTestResult {
  success: boolean;
  status: number | null;
  durationMs: number;
  format: string | null;
  target: string | null;
  message: string;
}

/**
 * POST /global-catalog/admin/sources/:id/test-connection
 *
 * Sends ONE GET at the source's configured API endpoint, server-side.
 * It never imports, never syncs and never modifies the source row.
 * Throws when the server refuses the probe (unknown source, non-API source,
 * missing secret, blocked/private target) — the message is always generic.
 */
export async function testGlobalCatalogSourceConnection(
  id: string,
): Promise<GlobalCatalogSourceTestResult> {
  const res = await apiFetch(
    `${BASE}/global-catalog/admin/sources/${encodeURIComponent(id)}/test-connection`,
    { method: 'POST' },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message =
      (err as any)?.error?.message ||
      (err as any)?.error ||
      'Test de connexion impossible';

    throw new Error(
      typeof message === 'string' ? message : 'Test de connexion impossible',
    );
  }

  const data = await res.json();
  return (data.data ?? data) as GlobalCatalogSourceTestResult;
}

/**
 * Manual API sync run result.
 *
 * SAFE BY CONSTRUCTION: the server never returns a credential, an Authorization
 * header, a full URL carrying a query, or a raw API body. `target` is the
 * `url.origin` only and `errorSummary` is sanitized server-side.
 */
export interface GlobalCatalogSourceSyncResult {
  runId: string;
  sourceId: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'partial' | 'failed';
  counts: {
    total: number;
    valid: number;
    invalid: number;
    created: number;
    matched: number;
    updated: number;
    reviewRequired: number;
    rejected: number;
  };
  errorSummary: string | null;
  triggeredBy: string;
  target: string | null;
  message: string;
}

/**
 * POST /global-catalog/admin/sources/:id/sync
 *
 * Runs ONE manual synchronization of an API source through the existing
 * resolver → normalization → matching → preview → commit pipeline.
 *
 * Throws when the server refuses the run (unknown source, non-API source,
 * missing credential, blocked/private target) or when it is already running for
 * that source (409). A run that completed but reported `failed` is RETURNED
 * (not thrown) so the caller can display the counts and the safe summary.
 */
export async function syncGlobalCatalogSource(
  id: string,
): Promise<GlobalCatalogSourceSyncResult> {
  const res = await apiFetch(
    `${BASE}/global-catalog/admin/sources/${encodeURIComponent(id)}/sync`,
    { method: 'POST' },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message =
      (err as any)?.error?.message ||
      (err as any)?.error ||
      'Synchronisation impossible';

    throw new Error(
      typeof message === 'string' ? message : 'Synchronisation impossible',
    );
  }

  const data = await res.json();
  return (data.data ?? data) as GlobalCatalogSourceSyncResult;
}

/** POST /global-catalog/admin/import-items/:itemId/approve */
export async function adminApproveGlobalCatalogImportItem(
  itemId: string,
  body: { action: 'create_new' | 'link_existing'; globalProductId?: string },
): Promise<any> {
  const res = await apiFetch(
    `${BASE}/global-catalog/admin/import-items/${encodeURIComponent(itemId)}/approve`,
    { method: 'POST', body: JSON.stringify(body) },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message =
      (err as any)?.error?.message ||
      (err as any)?.error ||
      'Failed to approve Global Catalog import item';

    throw new Error(
      typeof message === 'string'
        ? message
        : 'Failed to approve Global Catalog import item',
    );
  }

  const data = await res.json();
  return data.data ?? data;
}

/** POST /global-catalog/admin/import-items/:itemId/reject */
export async function adminRejectGlobalCatalogImportItem(
  itemId: string,
  reason?: string,
): Promise<any> {
  const res = await apiFetch(
    `${BASE}/global-catalog/admin/import-items/${encodeURIComponent(itemId)}/reject`,
    {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message =
      (err as any)?.error?.message ||
      (err as any)?.error ||
      'Failed to reject Global Catalog import item';

    throw new Error(
      typeof message === 'string'
        ? message
        : 'Failed to reject Global Catalog import item',
    );
  }

  const data = await res.json();
  return data.data ?? data;
}

