/**
 * Phase 1 — Feature Usage Analytics (client-side dispatch).
 *
 * Tracks successful CLIENT-SIDE actions (devis:export_pdf, catalogue:export)
 * so they are counted exactly once in the existing `user_feature_usage`
 * system. Server-side actions (devis:create, projects:save) are recorded
 * directly by their routes via featureService.incrementUsage — this helper
 * only covers actions that complete in the browser.
 *
 * Contract:
 *  - Fire-and-forget: never awaited, never throws, never blocks the action.
 *  - Exactly one dispatch per invocation; call sites invoke it exactly once,
 *    at the moment the action has succeeded.
 *  - Reuses the existing authenticated transport (in-memory access token +
 *    HttpOnly refresh cookie) — no duplicate tracking system.
 */
import { getAccessToken } from '../lib/api';

const BASE = '/api/v1';

export function trackFeatureUsage(featureKey: string): void {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    void fetch(`${BASE}/features/usage`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ featureKey }),
    }).catch(() => {
      /* non-blocking: usage recording must never fail the user action */
    });
  } catch {
    /* non-blocking: usage recording must never fail the user action */
  }
}
