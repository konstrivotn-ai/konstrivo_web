-- Universal Professional Métré — Phase 2+3 (ADDITIVE ONLY, idempotent)
-- Adds explicit bindings to trade_metre_elements and persistence tables for
-- Project → Zone → Ouvrage → Relevé → Lines.
--
-- SAFETY:
--  - additive only (ADD COLUMN / CREATE TABLE IF NOT EXISTS)
--  - no default that changes existing behavior
--  - no data rewrite

-- Phase 2: bindings on trade_metre_elements
--> statement-breakpoint
ALTER TABLE "trade_metre_elements" ADD COLUMN IF NOT EXISTS "material_bindings" jsonb;
--> statement-breakpoint
ALTER TABLE "trade_metre_elements" ADD COLUMN IF NOT EXISTS "service_bindings" jsonb;

-- Phase 3: project zones
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_zones" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "name" varchar(150) NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_zones_project" ON "project_zones"("project_id");

-- Phase 3: ouvrages
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_ouvrages" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "zone_id" uuid REFERENCES "project_zones"("id") ON DELETE SET NULL,
  "trade_code" varchar(50) NOT NULL,
  "metre_element_code" varchar(100) NOT NULL,
  "title" varchar(200) NOT NULL,
  "spec_version" integer NOT NULL DEFAULT 1,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_ouvrages_project" ON "project_ouvrages"("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_ouvrages_zone" ON "project_ouvrages"("zone_id");

-- Phase 3: releves
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "releves" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "zone_id" uuid REFERENCES "project_zones"("id") ON DELETE SET NULL,
  "ouvrage_id" uuid NOT NULL REFERENCES "project_ouvrages"("id") ON DELETE CASCADE,
  "status" varchar(30) NOT NULL DEFAULT 'draft',
  "spec_version" integer NOT NULL DEFAULT 1,
  "waste_override_percent" numeric(6,3),
  "layers_override" integer,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_releves_project" ON "releves"("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_releves_ouvrage" ON "releves"("ouvrage_id");

-- Phase 3: releve lines
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "releve_lines" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  "releve_id" uuid NOT NULL REFERENCES "releves"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL DEFAULT 0,
  "dims" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "openings" jsonb,
  "deductions" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_releve_lines_releve" ON "releve_lines"("releve_id");
