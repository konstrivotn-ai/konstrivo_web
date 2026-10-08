-- ════════════ Phase 1 / Foundation — International base (ADDITIVE) ════════════
-- Migration 0008: new reference tables + two NULLABLE additive columns on
-- materials + safe idempotent backfill of materials.trade_id + Tunisia as
-- the first Country Profile (DATA row, not hardcoded logic).
-- No column is dropped or altered destructively. Safe to re-run.

-- ── UoM ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "units_of_measure" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(20) NOT NULL,
  "symbol" varchar(20),
  "name_fr" varchar(100) NOT NULL,
  "name_ar" varchar(100),
  "name_derja" varchar(100),
  "dimension" varchar(20) DEFAULT 'other' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_uom_code" ON "units_of_measure" USING btree ("code");
CREATE INDEX IF NOT EXISTS "idx_uom_dimension" ON "units_of_measure" USING btree ("dimension");

CREATE TABLE IF NOT EXISTS "unit_conversions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "from_unit_id" uuid NOT NULL,
  "to_unit_id" uuid NOT NULL,
  "factor" numeric(18, 8) NOT NULL,
  "source" varchar(50) DEFAULT 'official' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_from_unit_id_units_of_measure_id_fk"
  FOREIGN KEY ("from_unit_id") REFERENCES "public"."units_of_measure"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_to_unit_id_units_of_measure_id_fk"
  FOREIGN KEY ("to_unit_id") REFERENCES "public"."units_of_measure"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_unit_conversion" ON "unit_conversions" USING btree ("from_unit_id","to_unit_id");

-- ── Country / Market profiles ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "countries" (
  "code" varchar(5) PRIMARY KEY,
  "name_fr" varchar(100) NOT NULL,
  "name_ar" varchar(100),
  "flag" varchar(10),
  "default_currency" varchar(5) DEFAULT 'TND' NOT NULL,
  "supported_currencies" jsonb DEFAULT '["TND"]' NOT NULL,
  "default_vat_rate" numeric(5, 2),
  "timbre_fiscal_default" numeric(12, 3),
  "standard_retenue_rate" numeric(5, 2),
  "building_codes" varchar(200),
  "unit_system" varchar(10) DEFAULT 'metric' NOT NULL,
  "is_default_market" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

-- ── Currencies + FX ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "currencies" (
  "code" varchar(5) PRIMARY KEY,
  "label" varchar(100) NOT NULL,
  "symbol" varchar(10),
  "decimals" integer DEFAULT 2 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "fx_rates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "base_currency" varchar(5) NOT NULL,
  "quote_currency" varchar(5) NOT NULL,
  "rate" numeric(18, 8) NOT NULL,
  "source" varchar(50) DEFAULT 'manual' NOT NULL,
  "effective_from" date DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_base_currency_currencies_code_fk"
  FOREIGN KEY ("base_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_quote_currency_currencies_code_fk"
  FOREIGN KEY ("quote_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;
CREATE INDEX IF NOT EXISTS "idx_fx_pair" ON "fx_rates" USING btree ("base_currency","quote_currency");
CREATE INDEX IF NOT EXISTS "idx_fx_effective" ON "fx_rates" USING btree ("effective_from");

-- ── Tax rules ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "tax_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "country_code" varchar(5) NOT NULL,
  "tax_type" varchar(30) DEFAULT 'VAT' NOT NULL,
  "rate" numeric(6, 3),
  "label_fr" varchar(200),
  "label_ar" varchar(200),
  "is_default" boolean DEFAULT false NOT NULL,
  "valid_from" date,
  "valid_to" date,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_country_code_countries_code_fk"
  FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;
CREATE INDEX IF NOT EXISTS "idx_tax_rules_country" ON "tax_rules" USING btree ("country_code","tax_type");

-- ── Material identifiers / attributes ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "material_identifiers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "material_id" uuid NOT NULL,
  "identifier_type" varchar(30) NOT NULL,
  "identifier_value" varchar(255) NOT NULL,
  "supplier_id" uuid,
  "source" varchar(50) DEFAULT 'official' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
ALTER TABLE "material_identifiers" ADD CONSTRAINT "material_identifiers_material_id_materials_id_fk"
  FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "material_identifiers" ADD CONSTRAINT "material_identifiers_supplier_id_suppliers_id_fk"
  FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_material_identifier" ON "material_identifiers" USING btree ("identifier_type","identifier_value","material_id");
CREATE INDEX IF NOT EXISTS "idx_material_identifiers_material" ON "material_identifiers" USING btree ("material_id");
CREATE INDEX IF NOT EXISTS "idx_material_identifiers_value" ON "material_identifiers" USING btree ("identifier_value");

CREATE TABLE IF NOT EXISTS "material_attributes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "material_id" uuid NOT NULL,
  "attribute_key" varchar(100) NOT NULL,
  "attribute_value" text,
  "source" varchar(50) DEFAULT 'official' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
ALTER TABLE "material_attributes" ADD CONSTRAINT "material_attributes_material_id_materials_id_fk"
  FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX IF NOT EXISTS "idx_material_attributes_material" ON "material_attributes" USING btree ("material_id","attribute_key");

-- ── Import / source provenance (reuses EXISTING supplier staging) ─────────
CREATE TABLE IF NOT EXISTS "import_provenance" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_type" varchar(50) NOT NULL,
  "entity_id" uuid NOT NULL,
  "import_id" uuid,
  "source_type" varchar(30) DEFAULT 'manual' NOT NULL,
  "source_ref" varchar(255),
  "created_by_user_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
ALTER TABLE "import_provenance" ADD CONSTRAINT "import_provenance_import_id_supplier_catalog_imports_id_fk"
  FOREIGN KEY ("import_id") REFERENCES "public"."supplier_catalog_imports"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX IF NOT EXISTS "idx_provenance_entity" ON "import_provenance" USING btree ("entity_type","entity_id");
CREATE INDEX IF NOT EXISTS "idx_provenance_import" ON "import_provenance" USING btree ("import_id");

-- ── ADDITIVE columns on materials (provenance) — NULLABLE, no backfill needed
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "source_type" varchar(30);
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "source_import_id" uuid;

ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "source_import_id" uuid;

-- ════════════ SAFE BACKFILL: materials.trade_id ════════════
-- Existing rows were written with trade (code) but trade_id left NULL because
-- the import pipeline never persisted the link. Fill it from the trades
-- registry; create any missing dynamic trade (is_official=false) first.
-- Idempotent: re-running is a no-op.

-- 1) Ensure dynamic trades exist for orphan trade codes (never touches official trades)
INSERT INTO "trades" ("code", "label_fr", "sort_order", "is_active", "is_official")
SELECT DISTINCT m."trade", m."trade", 999, true, false
FROM "materials" m
WHERE m."trade_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "trades" t WHERE t."code" = m."trade")
ON CONFLICT ("code") DO NOTHING;

-- 2) Backfill the FK from the trade code
UPDATE "materials" m
SET "trade_id" = t."id", "updated_at" = NOW()
FROM "trades" t
WHERE m."trade" = t."code" AND m."trade_id" IS NULL;

-- ════════════ SEED: reference data (idempotent) ════════════
INSERT INTO "currencies" ("code", "label", "symbol", "decimals") VALUES
  ('TND', 'Dinar Tunisien', 'DT', 3),
  ('EUR', 'Euro', '€', 2),
  ('USD', 'US Dollar', '$', 2),
  ('DZD', 'Dinar Algérien', 'DA', 2),
  ('SAR', 'Riyal Saoudien', 'SR', 2),
  ('AED', 'Dirham Émirati', 'AED', 2)
ON CONFLICT ("code") DO NOTHING;

-- Tunisia = FIRST Country Profile (a DATA row; adding markets = adding rows)
INSERT INTO "countries" ("code", "name_fr", "name_ar", "flag", "default_currency", "supported_currencies",
                         "default_vat_rate", "timbre_fiscal_default", "standard_retenue_rate",
                         "building_codes", "unit_system", "is_default_market")
VALUES ('TN', 'Tunisie', 'تونس', '🇹🇳', 'TND', '["TND","EUR","USD"]'::jsonb,
        19.00, 1.000, 5.00, 'DTU Tunisie / Normes NT 2026', 'metric', true)
ON CONFLICT ("code") DO NOTHING;

-- Tunisia VAT rules (from the existing front-end profile — data parity only)
INSERT INTO "tax_rules" ("country_code", "tax_type", "rate", "label_fr", "is_default")
SELECT 'TN', 'VAT', r.rate, r.label, r.is_default
FROM (VALUES
  (19.000, '19% (Taux Standard BTP Tunisie)', true),
  (13.000, '13% (Taux Intermédiaire)', false),
  (7.000,  '7% (Régime Artisans & Patentes)', false),
  (0.000,  '0% (Exonéré / Net H.T)', false)
) AS r(rate, label, is_default)
WHERE NOT EXISTS (
  SELECT 1 FROM "tax_rules" tr WHERE tr."country_code" = 'TN' AND tr."tax_type" = 'VAT' AND tr."rate" = r.rate
);

INSERT INTO "tax_rules" ("country_code", "tax_type", "rate", "label_fr", "is_default")
SELECT 'TN', 'TIMBRE', 1.000, '1.000 DT (Timbre Fiscal)', true
WHERE NOT EXISTS (
  SELECT 1 FROM "tax_rules" tr WHERE tr."country_code" = 'TN' AND tr."tax_type" = 'TIMBRE'
);

INSERT INTO "tax_rules" ("country_code", "tax_type", "rate", "label_fr", "is_default")
SELECT 'TN', 'RETENUE', 5.000, 'Retenue à la source 5%', true
WHERE NOT EXISTS (
  SELECT 1 FROM "tax_rules" tr WHERE tr."country_code" = 'TN' AND tr."tax_type" = 'RETENUE'
);

-- Common UoM seed (metric, construction)
INSERT INTO "units_of_measure" ("code", "symbol", "name_fr", "name_ar", "dimension") VALUES
  ('unit', 'u',  'Unité', 'وحدة', 'count'),
  ('m',    'm',  'Mètre', 'متر', 'length'),
  ('m2',   'm²', 'Mètre carré', 'متر مربع', 'area'),
  ('m3',   'm³', 'Mètre cube', 'متر مكعب', 'volume'),
  ('kg',   'kg', 'Kilogramme', 'كيلوغرام', 'mass'),
  ('ton',  't',  'Tonne', 'طن', 'mass'),
  ('l',    'L',  'Litre', 'لتر', 'volume'),
  ('ml',   'ml', 'Millilitre', 'مليلتر', 'volume'),
  ('cm',   'cm', 'Centimètre', 'سنتيمتر', 'length'),
  ('mm',   'mm', 'Millimètre', 'مليمتر', 'length')
ON CONFLICT ("code") DO NOTHING;

-- Base conversions (within same dimension)
INSERT INTO "unit_conversions" ("from_unit_id", "to_unit_id", "factor", "source")
SELECT f."id", t."id", c.factor, 'official'
FROM (VALUES
  ('m',   'cm', 100.0),
  ('m',   'mm', 1000.0),
  ('ton', 'kg', 1000.0),
  ('m3',  'l',  1000.0),
  ('l',   'ml', 1000.0)
) AS c(from_code, to_code, factor)
JOIN "units_of_measure" f ON f."code" = c.from_code
JOIN "units_of_measure" t ON t."code" = c.to_code
WHERE NOT EXISTS (
  SELECT 1 FROM "unit_conversions" uc WHERE uc."from_unit_id" = f."id" AND uc."to_unit_id" = t."id"
);

-- FX from TND (mirrors the existing front-end table — data parity only)
INSERT INTO "fx_rates" ("base_currency", "quote_currency", "rate", "source")
SELECT 'TND', q.code, q.rate, 'seed'
FROM (VALUES
  ('EUR', 0.295),
  ('DZD', 43.80),
  ('SAR', 1.21),
  ('AED', 1.18),
  ('USD', 0.322)
) AS q(code, rate)
WHERE NOT EXISTS (
  SELECT 1 FROM "fx_rates" fx WHERE fx."base_currency" = 'TND' AND fx."quote_currency" = q.code
);

