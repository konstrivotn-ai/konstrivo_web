-- PHASE "CATALOG LANGUAGE FR/AR/EN" — Replace Derja material names with English (ADDITIVE, RE-RUNNABLE)
--
-- SCOPE: catalog material language model FR/AR/Derja -> FR/AR/EN.
--   1. materials.name_derja        -> DROP (Derja is not English; values are NOT copied)
--   2. materials.name_en           -> ADD nullable (optional; NULL until genuine English is supplied)
--   3. units_of_measure.name_derja -> DROP
--   4. units_of_measure.name_en    -> ADD nullable
--
-- SAFETY RULES:
-- - No data migration: existing Derja values are NEVER copied into name_en.
-- - No DELETE/UPDATE/TRUNCATE of any row; only DDL (DROP COLUMN / ADD COLUMN).
-- - Re-runnable: every statement is guarded (IF EXISTS / IF NOT EXISTS).
-- - Tables absent on the target database are SKIPPED, never created.
-- - Historical migrations (0000, 0008, migrations_backup) are untouched.
-- - Dynamic Metre, calculator rules, trade logic, material IDs and relationships: untouched.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) materials: DROP name_derja, ADD name_en (nullable)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'materials') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'materials'
                 AND column_name = 'name_derja') THEN
      ALTER TABLE "materials" DROP COLUMN "name_derja";
    ELSE
      RAISE NOTICE 'SKIP: materials.name_derja already absent.';
    END IF;
  ELSE
    RAISE NOTICE 'SKIP: materials absent on this database — no column change attempted.';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'materials') THEN
    ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "name_en" text;
  ELSE
    RAISE NOTICE 'SKIP: materials absent on this database — name_en not added.';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) units_of_measure: DROP name_derja, ADD name_en (nullable)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'units_of_measure') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'units_of_measure'
                 AND column_name = 'name_derja') THEN
      ALTER TABLE "units_of_measure" DROP COLUMN "name_derja";
    ELSE
      RAISE NOTICE 'SKIP: units_of_measure.name_derja already absent.';
    END IF;
  ELSE
    RAISE NOTICE 'SKIP: units_of_measure absent on this database — no column change attempted.';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'units_of_measure') THEN
    ALTER TABLE "units_of_measure" ADD COLUMN IF NOT EXISTS "name_en" varchar(100);
  ELSE
    RAISE NOTICE 'SKIP: units_of_measure absent on this database — name_en not added.';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) DIAGNOSTIC ONLY — report the resulting columns (read-only)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'materials') THEN
    RAISE NOTICE 'OK: materials has name_en=% name_derja=%',
      (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'materials' AND column_name = 'name_en'),
      (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'materials' AND column_name = 'name_derja');
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'units_of_measure') THEN
    RAISE NOTICE 'OK: units_of_measure has name_en=% name_derja=%',
      (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'units_of_measure' AND column_name = 'name_en'),
      (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'units_of_measure' AND column_name = 'name_derja');
  END IF;
END $$;
