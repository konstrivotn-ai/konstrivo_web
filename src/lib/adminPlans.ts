/**
 * P3 — Admin plan helpers (FREE/PRO). Pure, DOM-free.
 *
 * Shared by the Admin Dashboard "Offres PRO" tab and the admin plans API
 * client in src/lib/api.ts. NO duplicated plan state: the plan shown and the
 * plan enforced BOTH come from the server (GET /api/v1/features →
 * planCode/enforced, GET+POST /api/v1/admin/plans), which resolve through the
 * same rule access control uses.
 */

/** Plans an administrator may assign. */
export type AdminPlanCode = 'free' | 'pro';

export const ADMIN_PLAN_CODES: readonly AdminPlanCode[] = ['free', 'pro'] as const;

/** Normalize/validate a plan value ('free' | 'pro', case-insensitive). */
export function normalizeAdminPlanCode(raw: unknown): AdminPlanCode | null {
  const value = String(raw ?? '').trim().toLowerCase();
  return (ADMIN_PLAN_CODES as readonly string[]).includes(value) ? (value as AdminPlanCode) : null;
}

/** Server-side plan target (mirrors server/services/planAdminService.ts). */
export interface AdminPlanTarget {
  userId?: string;
  email?: string;
  companyId?: string;
}

/** Backend-accepted id lengths (users.id / companies.id are uuid columns). */
export const ADMIN_PLAN_ID_PATTERN = /^[0-9a-fA-F-]{8,64}$/;
const ADMIN_PLAN_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parse the single admin input into a server target.
 * Accepted forms (explicit prefixes remove the user-id / company-id ambiguity):
 *   an@email.tn          → email
 *   user:<uuid>          → userId
 *   company:<uuid>       → companyId
 *   <uuid>               → userId (default)
 * Returns `{ error }` (French, admin-facing) instead of guessing.
 */
export function parseAdminPlanTarget(raw: string): { target?: AdminPlanTarget; error?: string } {
  const value = String(raw ?? '').trim();
  if (!value) {
    return { error: 'Entrez un email, un ID utilisateur (user:<id>) ou un ID entreprise (company:<id>).' };
  }
  const lower = value.toLowerCase();
  if (lower.startsWith('user:')) {
    const id = value.slice(5).trim();
    if (!ADMIN_PLAN_ID_PATTERN.test(id)) return { error: 'ID utilisateur invalide.' };
    return { target: { userId: id } };
  }
  if (lower.startsWith('company:')) {
    const id = value.slice(8).trim();
    if (!ADMIN_PLAN_ID_PATTERN.test(id)) return { error: 'ID entreprise invalide.' };
    return { target: { companyId: id } };
  }
  if (value.includes('@')) {
    if (!ADMIN_PLAN_EMAIL_PATTERN.test(value)) return { error: 'Adresse email invalide.' };
    return { target: { email: lower } };
  }
  if (!ADMIN_PLAN_ID_PATTERN.test(value)) {
    return { error: 'Format non reconnu : utilisez un email, user:<id> ou company:<id>.' };
  }
  return { target: { userId: value } };
}

/** Query string for GET /api/v1/admin/plans (exactly one identifier). */
export function buildAdminPlanQuery(target: AdminPlanTarget): string {
  if (target.email) return `email=${encodeURIComponent(target.email)}`;
  if (target.companyId) return `companyId=${encodeURIComponent(target.companyId)}`;
  return `userId=${encodeURIComponent(String(target.userId ?? ''))}`;
}

/** Human label of a plan code (uppercase, as displayed in the app). */
export function adminPlanLabel(code: unknown): string {
  const normalized = normalizeAdminPlanCode(code);
  return normalized ? normalized.toUpperCase() : 'FREE';
}

/** Whether the server currently applies FREE/PRO gating. */
export function enforcementStatusLabel(enforced: boolean): string {
  return enforced ? 'Contrôle FREE/PRO : ACTIF' : 'Contrôle FREE/PRO : désactivé (ALL_FEATURES_FREE)';
}
