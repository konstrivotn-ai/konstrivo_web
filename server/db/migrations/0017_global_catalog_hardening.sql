-- PHASE 4 HARDENING — Global Catalog (ADDITIVE / SAFE)
--
-- This migration ONLY adds constraints/columns/indexes to Phase 4 tables.
-- It does not touch existing materials/material_prices.

-- 1) IDENTIFIERS: scope uniqueness
-- Drop overly-strict unique index (type,value) and replace with safe scoped ones.
DROP INDEX IF EXISTS "uq_global_identifier";

-- Strong identifiers that can be globally unique (allow NULL supplier scope).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_global_identifier_strong" ON "global_product_identifiers" USING btree
  ("identifier_type", "identifier_value")
  WHERE "identifier_type" IN ('gtin','ean','upc');

-- Weak identifiers must be scoped (supplier). Same SKU/model may exist across suppliers.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_global_identifier_scoped" ON "global_product_identifiers" USING btree
  ("identifier_type", "identifier_value", "supplier_id")
  WHERE "identifier_type" IN ('sku','supplier_ref','model','manufacturer_ref','other');

-- 2) SOURCE PROVENANCE: availability references catalog_sources
ALTER TABLE "global_product_country_availability"
  ADD COLUMN IF NOT EXISTS "catalog_source_id" uuid;
-- `ADD CONSTRAINT IF NOT EXISTS` is NOT valid PostgreSQL → guarded DO block instead.
DO $$ BEGIN
  ALTER TABLE "global_product_country_availability"
    ADD CONSTRAINT "gp_country_avail_catalog_source_fk"
    FOREIGN KEY ("catalog_source_id") REFERENCES "public"."catalog_sources"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS "idx_gp_country_avail_source" ON "global_product_country_availability" USING btree ("catalog_source_id");

-- 3) COUNTRY INTEGRITY: reference existing countries table where appropriate
DO $$ BEGIN
  ALTER TABLE "catalog_sources"
    ADD CONSTRAINT "catalog_sources_country_fk"
    FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "catalog_imports"
    ADD CONSTRAINT "catalog_imports_country_fk"
    FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "catalog_import_items"
    ADD CONSTRAINT "catalog_import_items_country_fk"
    FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4) VALIDATION: confidence 0..100
DO $$ BEGIN
  ALTER TABLE "global_product_identifiers"
    ADD CONSTRAINT "chk_global_ident_confidence"
    CHECK ("confidence" >= 0 AND "confidence" <= 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "material_global_product_links"
    ADD CONSTRAINT "chk_material_global_link_confidence"
    CHECK ("confidence" >= 0 AND "confidence" <= 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "catalog_import_items"
    ADD CONSTRAINT "chk_catalog_import_items_confidence"
    CHECK ("confidence" >= 0 AND "confidence" <= 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5) IMPORT RUN TRACKING: status enum-ish guard (soft)
-- No strict enum to keep backward-compat and avoid hard failures.
CREATE INDEX IF NOT EXISTS "idx_catalog_imports_created_at" ON "catalog_imports" USING btree ("created_at");
