import type { ReactNode } from 'react';
import { useFeatures } from '../hooks/useFeatures';

interface FeatureGateProps {
  feature: string;
  children: ReactNode;
  /** Rendered only when the server EXPLICITLY denies access. */
  fallback?: ReactNode;
}

/**
 * Reusable server-aware feature gate: children render when the current plan
 * (from the company subscription, FREE default) allows the feature.
 *
 * FREE-safety contract (Phase 1):
 *  - While the entitlement list is loading, or when it is unavailable
 *    (logged out, offline, or API error), the gate is FAIL-OPEN and renders the
 *    children. The backend applies the same fail-open policy to FREE features,
 *    and the actions behind the current gates (browser-side PDF export and the
 *    catalogue CSV template download) make no API call of their own, so hiding
 *    them on a missing entitlement response would be a pure regression.
 *  - Only an explicit `canAccess: false` returned by GET /api/v1/features hides
 *    the children, so PRO control can be switched on later with no UI change.
 *
 * Server-side enforcement remains the source of truth.
 */
export function FeatureGate({ feature, children, fallback = null }: FeatureGateProps) {
  const { features, can } = useFeatures();
  const isKnown = features.some((f) => f.featureKey === feature);
  // Unknown / not-yet-loaded / unauthenticated → fail-open (never block FREE).
  if (!isKnown) return <>{children}</>;
  return can(feature) ? <>{children}</> : <>{fallback}</>;
}