import { useCallback, useEffect, useState } from 'react';
import { listMyFeatures } from '../lib/api';

/** One feature/entitlement row as returned by GET /api/v1/features. */
export interface FeatureAccess {
  featureKey: string;
  canAccess: boolean;
  requiredPlan: 'free' | 'pro';
  usageLimit: number | null;
  /** P3: consumed usage for the current month (null = unlimited/unknown). */
  usageCount: number | null;
  usageRemaining: number | null;
  /** F15: server denial reason (ADDITIVE; null when absent / access allowed). */
  reason?: string | null;
}

/**
 * Map the backend /api/v1/features response row into the frontend contract.
 * The backend returns: featureKey, canAccess, requiredPlan, usageLimit,
 * usageCount, usageRemaining. We normalize it to the stable frontend shape and
 * derive requiredPlan defensively (the server value wins when present).
 */
function mapBackendFeature(
  planCode: 'free' | 'pro',
  row: {
    featureKey: string;
    canAccess: boolean;
    requiredPlan?: 'free' | 'pro';
    usageLimit?: number | null;
    usageCount?: number | null;
    usageRemaining?: number | null;
    reason?: string;
  }
): FeatureAccess {
  const usageLimit = row.usageLimit ?? null;
  const usageRemaining = row.usageRemaining ?? null;

  let requiredPlan: 'free' | 'pro' = row.requiredPlan === 'pro' ? 'pro' : 'free';
  if (row.requiredPlan == null) {
    // Fallback for older servers that do not send requiredPlan.
    if (!row.canAccess) {
      requiredPlan = 'pro';
    } else if (planCode === 'free') {
      requiredPlan = 'free';
    } else {
      requiredPlan = 'pro';
    }
  }

  return {
    featureKey: row.featureKey,
    canAccess: row.canAccess,
    requiredPlan,
    usageLimit,
    // P3: real consumed usage reported by the server (null = unlimited/unknown).
    usageCount: row.usageCount == null ? null : Number(row.usageCount),
    usageRemaining,
    // F15 (additive): the server's access reason, for honest lock messages.
    reason: row.reason ?? null,
  };
}

interface FeaturesState {
  planCode: 'free' | 'pro';
  /** P3: whether the server really applies FREE/PRO gating (single source). */
  enforced: boolean;
  features: FeatureAccess[];
}

const EMPTY: FeaturesState = { planCode: 'free', enforced: false, features: [] };

/**
 * Feature awareness for the current session (plan resolved from the company
 * subscription server-side; users without a company default to FREE).
 * P3: this is the ONLY plan/feature source in the UI — the same endpoint that
 * the backend gate resolves (GET /api/v1/features → planCode + enforced +
 * canAccess). No UI re-derivation, so the displayed FREE/PRO status can never
 * disagree with what access control enforces.
 */
export function useFeatures(opts?: { enabled?: boolean }) {
  const [state, setState] = useState<FeaturesState>(EMPTY);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listMyFeatures();
      const mapped = {
        planCode: data.planCode,
        enforced: data.enforced === true,
        features: (data.features || []).map((f: any) => mapBackendFeature(data.planCode, f)),
      };
      setState(mapped);
    } catch {
      /* offline / unauthenticated → FREE defaults */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (opts?.enabled === false) return;
    refresh();
  }, [refresh, opts?.enabled]);

  const can = useCallback(
    (featureKey: string) => state.features.find(f => f.featureKey === featureKey)?.canAccess ?? false,
    [state.features],
  );

  const remaining = useCallback(
    (featureKey: string) => state.features.find(f => f.featureKey === featureKey)?.usageRemaining ?? null,
    [state.features],
  );

  return {
    planCode: state.planCode,
    enforced: state.enforced,
    features: state.features,
    loading,
    refresh,
    can,
    remaining,
  };
}

// ── F9 (Phase 3 audit) — honest presentation of the 11-key matrix ────────────
// Audit of the shipped matrix against REAL capabilities (2026-09-24):
//
// • COMING_SOON — keys with NO implementing code anywhere (no server route, no
//   UI gate, no feature logic): they are still part of the canonical matrix
//   (parity contract), but presenting them as active/upgradeable PRO features
//   would promise something that does not exist. They must render as
//   "Bientôt" — never as available, never as PRO upsell.
//
// • CLIENT_ONLY — genuine capabilities that intentionally have NO server
//   endpoint of their own: the action runs entirely in the browser
//   (window.print / CSV download), is PRO-gated at the UI level only via
//   FeatureGate, and reports usage through POST /api/v1/features/usage.
//   They must be presented as UI-level actions, never as server-enforced
//   endpoints.
//
// Every other key maps to a real server entry point — enforced with
// requireFeature where a genuine, separately protectable entry exists
// (devis:create, projects:save, supplier:products on POST /suppliers/upload)
// — or is a free read (catalogue:browse) / admin-gated capability
// (analytics:view, role 'admin' via requireRole).
export const COMING_SOON_FEATURE_KEYS: ReadonlySet<string> = new Set([
  'projects:premium_formulas',
  'engineer:multi_project',
  'engineer:advanced_calc',
]);

export const CLIENT_ONLY_FEATURE_KEYS: ReadonlySet<string> = new Set([
  'devis:export_pdf',
  'catalogue:export',
]);

/**
 * Parity check: the frontend feature contract should include every canonical
 * backend feature key. This is the frontend side of the backend parity guard in
 * server/services/featureService.ts. It is intended for tests/typecheck, not for
 * runtime UI behavior.
 */
export function assertFeatureParity(frontendKeys: ReadonlyArray<string>): string[] {
  const backendKeys = [
    'devis:create',
    'devis:export_pdf',
    'projects:save',
    'projects:premium_formulas',
    'supplier:products',
    'supplier:bulk_update',
    'engineer:advanced_calc',
    'engineer:multi_project',
    'catalogue:browse',
    'catalogue:export',
    'analytics:view',
  ];

  const missing = backendKeys.filter(key => !frontendKeys.includes(key));
  const extra = frontendKeys.filter(key => !backendKeys.includes(key));
  return [...missing, ...extra];
}
