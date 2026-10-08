-- PHASE "COUNTRY + SUPPLIER + PRICES" — Referential integrity (ADDITIVE ONLY)
--
-- SCOPE: two referential-integrity constraints that were missing in the DDL.
--   1. material_prices.supplier_id  -> suppliers.id
--   2. suppliers.country_code       -> countries.code
--
-- SAFETY RULES (identical in spirit to migrations 0011/0012/0016/0017):
-- - No DELETE, no UPDATE, no TRUNCATE, no DROP of a table/column.
-- - NO data repair and NO data coercion: a value is never rewritten, NULLed
--   or removed. Orphan rows are REPORTED, never fixed.
-- - The pre-checks RAISE and abort the whole transaction when existing data
--   would violate a foreign key, so this migration can never "succeed" by
--   silently discarding or rewriting a price/supplier/country row.
-- - Re-runnable: each constraint is created inside a guarded DO block that
--   swallows ONLY `duplicate_object` (the 0017 pattern).
-- - Tables that do not exist on the target database are SKIPPED, never created.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) PRE-CHECK — material_prices.supplier_id must resolve to an existing supplier
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_orphans bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'material_prices')
     AND EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'suppliers') THEN

    SELECT count(*) INTO v_orphans
    FROM "material_prices" p
    WHERE p."supplier_id" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "suppliers" s WHERE s."id" = p."supplier_id");

    IF v_orphans > 0 THEN
      RAISE EXCEPTION
        'FK ABORT (material_prices.supplier_id -> suppliers.id): % row(s) reference a supplier that does not exist. No data was changed. Resolve these references manually, then re-run this migration.',
        v_orphans;
    END IF;
  ELSE
    RAISE NOTICE 'SKIP: material_prices or suppliers is absent on this database — supplier FK not attempted.';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) PRE-CHECK — suppliers.country_code must resolve to an existing country
--    (NULL is allowed; an empty/blank string is NOT a valid country code)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_orphans bigint;
  v_blank bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'suppliers')
     AND EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'countries') THEN

    SELECT count(*) INTO v_blank
    FROM "suppliers" s
    WHERE s."country_code" IS NOT NULL AND btrim(s."country_code") = '';

    SELECT count(*) INTO v_orphans
    FROM "suppliers" s
    WHERE s."country_code" IS NOT NULL
      AND btrim(s."country_code") <> ''
      AND NOT EXISTS (SELECT 1 FROM "countries" c WHERE c."code" = s."country_code");

    IF v_blank > 0 OR v_orphans > 0 THEN
      RAISE EXCEPTION
        'FK ABORT (suppliers.country_code -> countries.code): % row(s) reference an unknown country and % row(s) carry a blank country code. No data was changed. Resolve these references manually, then re-run this migration.',
        v_orphans, v_blank;
    END IF;
  ELSE
    RAISE NOTICE 'SKIP: suppliers or countries is absent on this database — country FK not attempted.';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) ADD THE CONSTRAINTS (only reachable when both pre-checks passed)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "material_prices"
    ADD CONSTRAINT "material_prices_supplier_id_suppliers_id_fk"
    FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE 'SKIP: material_prices absent — supplier FK not added.';
END $$;

DO $$ BEGIN
  ALTER TABLE "suppliers"
    ADD CONSTRAINT "suppliers_country_code_countries_code_fk"
    FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code")
    ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE 'SKIP: suppliers or countries absent — country FK not added.';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) DIAGNOSTIC ONLY — report the orphan situation after the fact
--    (read-only SELECTs; they never modify anything)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'material_prices')
     AND EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'suppliers') THEN
    RAISE NOTICE 'OK: material_prices.supplier_id values=% (null=%), suppliers=%',
      (SELECT count(*) FROM "material_prices" WHERE "supplier_id" IS NOT NULL),
      (SELECT count(*) FROM "material_prices" WHERE "supplier_id" IS NULL),
      (SELECT count(*) FROM "suppliers");
  END IF;
END $$;
