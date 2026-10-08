/**
 * P2 — Admin price-review panel helpers (pure functions — no React, no fetch, no DB).
 *
 * Extracted from AdminDashboardModal so the "Mises à jour de prix en attente
 * d'approbation" panel (the review queue the admin uses to approve/publish a
 * price) is unit-testable and cannot regress into the silently-broken behaviour
 * the P2 review found:
 *
 *   1. A failed GET (expired admin session, DB down, 5xx…) must NEVER be shown
 *      as "Aucune mise à jour de prix en attente." — the panel stays visible
 *      with the real reason and a working refresh action ("Actualiser").
 *   2. Clicking "Approuver" must be blocked while that same row is already being
 *      approved (no double POST, no double publish).
 *
 * The server remains the source of truth (`POST /catalog/price-updates/:id/
 * approve`); these helpers only translate state into UI state.
 */

export type PendingReviewLoadState = 'idle' | 'loading' | 'loaded' | 'error';

/** What the prices tab must render for the review queue. */
export type PendingReviewView = 'hidden' | 'loading' | 'error' | 'empty' | 'list';

/**
 * Resolve the visible state of the review panel. The panel is only relevant to
 * an authenticated admin on the "prices" tab; on any failure it stays visible
 * ('error') so the admin sees the reason + the refresh action instead of an
 * empty list.
 */
export function resolvePendingReviewView(opts: {
  isAdmin: boolean;
  isPricesTab: boolean;
  state: PendingReviewLoadState;
  rowCount: number;
  /** Current last error message (kept until the next successful load). */
  error?: string | null;
}): PendingReviewView {
  if (!opts.isAdmin || !opts.isPricesTab) return 'hidden';
  const hasError = opts.state === 'error' || Boolean(opts.error);
  if (hasError) return 'error';
  if (opts.state === 'loading') return 'loading';
  return (opts.rowCount > 0 ? 'list' : 'empty');
}

/** True while the given row already has an approve request in flight. */
export function isApprovePendingBlocked(inFlightIds: readonly string[], id: string): boolean {
  if (!id) return true;
  return inFlightIds.includes(id);
}

/**
 * User-facing reason for a failed review-queue load / approve. Never empty, so
 * the panel can always explain itself.
 */
export function pendingReviewErrorMessage(
  err: unknown,
  fallback = 'Impossible de charger les mises à jour de prix en attente.'
): string {
  const raw = (err as any)?.message;
  const message = typeof raw === 'string' ? raw.trim() : '';
  return message !== '' ? message : fallback;
}
