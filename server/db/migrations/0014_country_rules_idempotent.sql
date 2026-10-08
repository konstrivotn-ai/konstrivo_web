-- PHASE 1 repair — make (country_code, trade, rule_key) truly idempotent.
-- Root cause: the 0012 unique index used default NULLS DISTINCT semantics, so
-- seed rows with trade = NULL never conflict and 0013 replay duplicated them.
-- Scope of data change: ONLY the seed rows inserted by 0013 (+ its replay)
-- during this session are deduplicated. No pre-existing production data is
-- touched. The dropped index is the one created by 0012 in this same phase and
-- is recreated immediately under the SAME name with NULLS NOT DISTINCT.
-- 1) Deduplicate (keep the OLDEST row per logical key; IS NOT DISTINCT FROM
--    treats NULL trade as equal, unlike GROUP BY-free row comparison).
DELETE FROM "country_calculation_rules" a
USING "country_calculation_rules" b
WHERE a.country_code = b.country_code
  AND a.trade IS NOT DISTINCT FROM b.trade
  AND a.rule_key = b.rule_key
  AND a.ctid > b.ctid;
-- 2) Replace the index under the SAME name (schema/Drizzle parity kept).
DROP INDEX IF EXISTS "uq_country_calc_rule";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_country_calc_rule"
  ON "country_calculation_rules" USING btree ("country_code","trade","rule_key")
  NULLS NOT DISTINCT;
