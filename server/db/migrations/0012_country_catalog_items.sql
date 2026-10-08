-- PHASE 1 part 2 — items + rules (ADDITIVE ONLY, idempotent).
CREATE TABLE IF NOT EXISTS "country_catalog_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "catalog_id" uuid NOT NULL,
  "country_code" varchar(5) NOT NULL,
  "material_code" varchar(100) NOT NULL,
  "material_name" text NOT NULL,
  "trade" varchar(50) NOT NULL,
  "trade_label" varchar(200),
  "category" varchar(100) NOT NULL,
  "unit" varchar(20) DEFAULT 'unit' NOT NULL,
  "price_ht" numeric(12, 3) NOT NULL,
  "currency_code" varchar(5) DEFAULT 'TND' NOT NULL,
  "tva_rate" numeric(6, 3),
  "is_active" boolean DEFAULT true NOT NULL,
  "source_row" integer,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
DO $$ BEGIN
  ALTER TABLE "country_catalog_items" ADD CONSTRAINT "country_catalog_items_catalog_id_country_catalogs_id_fk"
    FOREIGN KEY ("catalog_id") REFERENCES "country_catalogs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_country_catalog_item" ON "country_catalog_items" USING btree ("catalog_id","material_code");
CREATE INDEX IF NOT EXISTS "idx_country_catalog_items_catalog" ON "country_catalog_items" USING btree ("catalog_id");
CREATE INDEX IF NOT EXISTS "idx_country_catalog_items_country" ON "country_catalog_items" USING btree ("country_code","is_active");
CREATE INDEX IF NOT EXISTS "idx_country_catalog_items_trade" ON "country_catalog_items" USING btree ("country_code","trade");
CREATE TABLE IF NOT EXISTS "country_calculation_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "country_code" varchar(5) NOT NULL,
  "trade" varchar(50),
  "rule_key" varchar(100) NOT NULL,
  "rule_value" jsonb NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_country_calc_rule" ON "country_calculation_rules" USING btree ("country_code","trade","rule_key") NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS "idx_country_calc_rules_country" ON "country_calculation_rules" USING btree ("country_code","is_active");
