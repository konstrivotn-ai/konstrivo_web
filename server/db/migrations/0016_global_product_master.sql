-- PHASE 4 — Global Product Master (ADDITIVE ONLY)
--
-- SAFETY RULES:
-- - Does NOT modify existing `materials` or `material_prices`.
-- - Adds new tables to support a global catalog layer.
-- - Mapping from materials → global products is OPTIONAL and can be populated gradually.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) global_products
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "global_products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "brand" varchar(120),
  "manufacturer" varchar(120),
  "category" varchar(120),
  "subcategory" varchar(120),
  "description" text,
  "specification" text,
  "unit" varchar(30),
  "model" varchar(120),
  "sku" varchar(120),
  "status" varchar(30) NOT NULL DEFAULT 'active',
  "media" jsonb NOT NULL DEFAULT '[]',
  "extra" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_global_products_name" ON "global_products" USING btree ("name");
CREATE INDEX IF NOT EXISTS "idx_global_products_brand" ON "global_products" USING btree ("brand");
CREATE INDEX IF NOT EXISTS "idx_global_products_category" ON "global_products" USING btree ("category");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) global_product_identifiers (strong IDs)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "global_product_identifiers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "global_product_id" uuid NOT NULL,
  "identifier_type" varchar(40) NOT NULL,
  "identifier_value" varchar(255) NOT NULL,
  "supplier_id" uuid,
  "confidence" integer NOT NULL DEFAULT 100,
  "source" varchar(50) NOT NULL DEFAULT 'manual',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "global_product_identifiers_global_product_id_fk" FOREIGN KEY ("global_product_id") REFERENCES "public"."global_products"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "global_product_identifiers_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_global_identifier" ON "global_product_identifiers" USING btree ("identifier_type","identifier_value");
CREATE INDEX IF NOT EXISTS "idx_global_identifiers_value" ON "global_product_identifiers" USING btree ("identifier_value");
CREATE INDEX IF NOT EXISTS "idx_global_identifiers_product" ON "global_product_identifiers" USING btree ("global_product_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) material_global_product_links (optional 1:1 link)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "material_global_product_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "material_id" uuid NOT NULL,
  "global_product_id" uuid NOT NULL,
  "link_source" varchar(40) NOT NULL DEFAULT 'manual',
  "status" varchar(20) NOT NULL DEFAULT 'approved',
  "confidence" integer NOT NULL DEFAULT 100,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "material_global_product_links_material_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "material_global_product_links_global_product_id_fk" FOREIGN KEY ("global_product_id") REFERENCES "public"."global_products"("id") ON DELETE cascade ON UPDATE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_material_global_link" ON "material_global_product_links" USING btree ("material_id");
CREATE INDEX IF NOT EXISTS "idx_material_global_link_global" ON "material_global_product_links" USING btree ("global_product_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) global_product_country_availability
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "global_product_country_availability" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "global_product_id" uuid NOT NULL,
  "country_code" varchar(5) NOT NULL,
  "is_available" boolean NOT NULL DEFAULT true,
  "local_name" text,
  "local_reference" varchar(255),
  "local_specification" text,
  "local_unit" varchar(30),
  "observed_at" timestamp with time zone,
  "source_ref" varchar(255),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "global_product_country_availability_global_product_id_fk" FOREIGN KEY ("global_product_id") REFERENCES "public"."global_products"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "global_product_country_availability_country_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_global_product_country" ON "global_product_country_availability" USING btree ("global_product_id","country_code");
CREATE INDEX IF NOT EXISTS "idx_global_product_country_code" ON "global_product_country_availability" USING btree ("country_code","is_available");

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) catalog_sources / catalog_imports / catalog_import_items
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "catalog_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(200) NOT NULL,
  "source_type" varchar(40) NOT NULL,
  "country_code" varchar(5),
  "provider" varchar(200),
  "url" text,
  "status" varchar(30) NOT NULL DEFAULT 'active',
  "configuration" jsonb NOT NULL DEFAULT '{}',
  "update_frequency" varchar(40),
  "last_successful_sync_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
-- Guard: `catalog_sources` may pre-exist (created by an earlier partial run or a
-- schema push) without `source_type`. `CREATE TABLE IF NOT EXISTS` above is then a
-- silent no-op, so ensure the column exists BEFORE indexing it.
-- No-op on fresh installs (the column is already defined NOT NULL in the DDL above).
ALTER TABLE IF EXISTS "catalog_sources" ADD COLUMN IF NOT EXISTS "source_type" varchar(40);

CREATE INDEX IF NOT EXISTS "idx_catalog_sources_type" ON "catalog_sources" USING btree ("source_type");
CREATE INDEX IF NOT EXISTS "idx_catalog_sources_country" ON "catalog_sources" USING btree ("country_code");

CREATE TABLE IF NOT EXISTS "catalog_imports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_id" uuid,
  "country_code" varchar(5),
  "file_name" varchar(255),
  "file_sha256" varchar(64),
  "file_mime_type" varchar(120),
  "import_status" varchar(30) NOT NULL DEFAULT 'UPLOADED',
  "items_count" integer NOT NULL DEFAULT 0,
  "imported_count" integer NOT NULL DEFAULT 0,
  "updated_count" integer NOT NULL DEFAULT 0,
  "rejected_count" integer NOT NULL DEFAULT 0,
  "error_summary" text,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "catalog_imports_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."catalog_sources"("id") ON DELETE no action ON UPDATE no action
);
CREATE INDEX IF NOT EXISTS "idx_catalog_imports_source" ON "catalog_imports" USING btree ("source_id");
CREATE INDEX IF NOT EXISTS "idx_catalog_imports_status" ON "catalog_imports" USING btree ("import_status");

CREATE TABLE IF NOT EXISTS "catalog_import_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "import_id" uuid NOT NULL,
  "source_row" integer,
  "country_code" varchar(5),
  "raw" jsonb NOT NULL DEFAULT '{}',
  "normalized" jsonb NOT NULL DEFAULT '{}',
  "match_status" varchar(30) NOT NULL DEFAULT 'new',
  "matched_global_product_id" uuid,
  "matched_material_id" uuid,
  "confidence" integer NOT NULL DEFAULT 0,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "catalog_import_items_import_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."catalog_imports"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "catalog_import_items_matched_global_product_id_fk" FOREIGN KEY ("matched_global_product_id") REFERENCES "public"."global_products"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "catalog_import_items_matched_material_id_fk" FOREIGN KEY ("matched_material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action
);

CREATE INDEX IF NOT EXISTS "idx_catalog_import_items_import" ON "catalog_import_items" USING btree ("import_id");
CREATE INDEX IF NOT EXISTS "idx_catalog_import_items_status" ON "catalog_import_items" USING btree ("match_status");
CREATE INDEX IF NOT EXISTS "idx_catalog_import_items_global" ON "catalog_import_items" USING btree ("matched_global_product_id");
