-- PHASE 1 — Country Catalog + CSV import (ADDITIVE ONLY, idempotent).
-- New tables only. No ALTER/DROP of existing tables. Safe to re-run.
CREATE TABLE IF NOT EXISTS "country_catalogs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "country_code" varchar(5) NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "file_name" varchar(255),
  "source_ref" varchar(255),
  "content_sha256" varchar(64),
  "currency_code" varchar(5) DEFAULT 'TND' NOT NULL,
  "items_count" integer DEFAULT 0 NOT NULL,
  "imported_count" integer DEFAULT 0 NOT NULL,
  "updated_count" integer DEFAULT 0 NOT NULL,
  "deactivated_count" integer DEFAULT 0 NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_country_catalog_version" ON "country_catalogs" USING btree ("country_code","version");
CREATE INDEX IF NOT EXISTS "idx_country_catalogs_active" ON "country_catalogs" USING btree ("country_code","is_active");
CREATE INDEX IF NOT EXISTS "idx_country_catalogs_hash" ON "country_catalogs" USING btree ("country_code","content_sha256");
