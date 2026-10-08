/**
 * Phase 3 — Usage Analytics range presets.
 *
 * Pure, DOM-free, timezone-safe helpers shared by the Admin Dashboard
 * usage panel and its focused tests. All dates are local-component
 * YYYY-MM-DD (no UTC drift), matching the server's monthly period keys.
 */
export type UsageRangePreset = 'this_month' | 'last_month' | 'all';

export interface UsageRangeParams {
  from?: string;
  to?: string;
  labelFr: string;
}

/** Format a Date using its LOCAL year/month/day components (YYYY-MM-DD). */
export function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** First day of the month of the given date (local). */
export function monthStart(date: Date): string {
  return ymd(new Date(date.getFullYear(), date.getMonth(), 1));
}

/** Last day of the month of the given date (local). */
export function monthEnd(date: Date): string {
  return ymd(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

/**
 * Map a UI preset to optional ?from/?to query params.
 *  - this_month → [first, last] of the current month
 *  - last_month → [first, last] of the previous month
 *  - all        → no bounds (entire history)
 */
export function usageRangeToParams(preset: UsageRangePreset, now: Date = new Date()): UsageRangeParams {
  if (preset === 'all') return { labelFr: "Tout l'historique" };
  if (preset === 'last_month') {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { from: monthStart(prev), to: monthEnd(prev), labelFr: 'Mois dernier' };
  }
  return { from: monthStart(now), to: monthEnd(now), labelFr: 'Ce mois' };
}
