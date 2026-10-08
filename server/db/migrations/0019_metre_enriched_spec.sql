-- DYNAMIC MÉTRÉ — PHASE 1: enriched element specification (ADDITIVE ONLY, idempotent).
--
-- WHAT THIS CHANGES (nothing else):
--   5 NULLABLE columns added to "trade_metre_elements":
--     openings        jsonb        — structured openings (porte / fenêtre / baie)
--     deductions      jsonb        — explicit deductions, independent from openings
--     layers          numeric(8,2) — repetition count (coats / layers), NULL = 1
--     waste_percent   numeric(6,3) — waste %, applied ONCE at the end, NULL = none
--     yield_per_unit  jsonb        — explicit coverage (kg/m², L/m², …), NULL = none
--     coverage_per_product_unit jsonb — Phase 1.1 preferred coverage semantics, NULL = none
--
-- SAFETY CONTRACT:
--   - ADD COLUMN only. No DROP, no RENAME, no ALTER of any existing column.
--   - Every new column is NULLABLE and has NO DEFAULT: existing rows keep NULL,
--     which the engine reads as "not configured" and contributes exactly nothing.
--     Every pre-existing element therefore keeps a byte-identical result.
--   - No existing row is INSERTed / UPDATEd / DELETEd — production data untouched.
--   - Idempotent: re-running is a no-op thanks to the IF NOT EXISTS guards.
--   - The 12 official calculators, their formulas, prices, Devis, Services and
--     the catalog import are NOT affected by this file in any way.
--> statement-breakpoint
ALTER TABLE "trade_metre_elements" ADD COLUMN IF NOT EXISTS "openings" jsonb;--> statement-breakpoint
ALTER TABLE "trade_metre_elements" ADD COLUMN IF NOT EXISTS "deductions" jsonb;--> statement-breakpoint
ALTER TABLE "trade_metre_elements" ADD COLUMN IF NOT EXISTS "layers" numeric(8,2);--> statement-breakpoint
ALTER TABLE "trade_metre_elements" ADD COLUMN IF NOT EXISTS "waste_percent" numeric(6,3);--> statement-breakpoint
ALTER TABLE "trade_metre_elements" ADD COLUMN IF NOT EXISTS "yield_per_unit" jsonb;
--> statement-breakpoint
ALTER TABLE "trade_metre_elements" ADD COLUMN IF NOT EXISTS "coverage_per_product_unit" jsonb;
