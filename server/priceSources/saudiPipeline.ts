/**
 * Step 14 — Saudi GASTAT Connector → Pending Pipeline Activation.
 *
 * Pure orchestration only. This module glues the EXISTING pieces together:
 *   - buildSaudiGastatPendingPlan()  [Step 13 — pure, returns normalized plan]
 *   - submitPendingPriceUpdate()    [Step 8 — repository, writes SUPPLIER_SUBMITTED]
 *
 * NO new route, NO new DB schema, NO cron, NO scraping, NO auto-approve.
 * The connector still cannot make anything official — it only produces PENDING rows
 * that must pass through Admin Review → Approve (Step 8).
 *
 * Pipeline:
 *   GASTAT rows → buildSaudiGastatPendingPlan → applySaudiGastatPlan(submit)
 *     → submitPendingPriceUpdate → SUPPLIER_SUBMITTED → Admin Review → Approve
 */

import { submitPendingPriceUpdate } from '../repositories/drizzlePriceRepository';
import {
  buildSaudiGastatPendingPlan,
  SaudiGastatPendingPlan,
} from './saudiConstruction';

/** Result of applying one GASTAT batch to the pending pipeline. */
export interface SaudiGastatRunSummary {
  submitted: number;
  rejected: number;
  submissionIds: string[];
  errors: Array<{ label: string; reason: string }>;
}

/**
 * Pure orchestration: apply a GASTAT pending plan to the pending pipeline.
 *
 * Separated from I/O so it can be unit-tested with a mock submit function.
 * NEVER calls approve — only submits pending rows.
 */
export async function applySaudiGastatPlan(
  plan: SaudiGastatPendingPlan,
  submit: typeof submitPendingPriceUpdate,
): Promise<SaudiGastatRunSummary> {
  const summary: SaudiGastatRunSummary = {
    submitted: 0,
    rejected: plan.rejected.length,
    submissionIds: [],
    errors: [],
  };

  for (const s of plan.submissions) {
    try {
      const row = await submit({
        materialCode: s.materialCode,
        price: s.price,
        countryCode: s.countryCode,
        currencyCode: s.currencyCode,
        effectiveFrom: s.effectiveFrom,
        notes: s.notes,
      });
      summary.submitted++;
      summary.submissionIds.push(row.id);
    } catch (err) {
      summary.errors.push({ label: s.materialCode, reason: (err as Error).message });
    }
  }

  return summary;
}

/**
 * Convenience entry point: build the plan from raw GASTAT rows AND apply it
 * to the live pending pipeline in one call.
 *
 * IMPORTANT: The rows must come from OFFICIALLY DOWNLOADED GASTAT data.
 * This function does NOT fetch live data (WAF-protected). It only processes
 * rows you pass to it.
 */
export async function runSaudiGastatUpdate(
  rows: Parameters<typeof buildSaudiGastatPendingPlan>[0],
  opts: Parameters<typeof buildSaudiGastatPendingPlan>[1] = {},
): Promise<SaudiGastatRunSummary> {
  const plan = buildSaudiGastatPendingPlan(rows, opts);
  return applySaudiGastatPlan(plan, submitPendingPriceUpdate);
}
