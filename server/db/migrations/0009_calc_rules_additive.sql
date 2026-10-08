-- Phase 2 / Calculator Integration (ADDITIVE ONLY)
-- Adds independent calc slots + calculation rules, and a material link table
-- without changing current formulas or existing calculation logic.

CREATE TABLE IF NOT EXISTS "calc_slots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(80) NOT NULL,
  "label" varchar(120) NOT NULL,
  "trade" varchar(50) NOT NULL,
  "material_key" varchar(120),
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_calc_slot_code" ON "calc_slots" USING btree ("code");
CREATE INDEX IF NOT EXISTS "idx_calc_slots_trade" ON "calc_slots" USING btree ("trade");

CREATE TABLE IF NOT EXISTS "calc_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(80) NOT NULL,
  "slot_code" varchar(80) NOT NULL,
  "trade" varchar(50) NOT NULL,
  "legacy_key" varchar(120),
  "material_code" varchar(120),
  "description" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_calc_rule_code" ON "calc_rules" USING btree ("code");
CREATE INDEX IF NOT EXISTS "idx_calc_rules_trade" ON "calc_rules" USING btree ("trade");
CREATE INDEX IF NOT EXISTS "idx_calc_rules_slot" ON "calc_rules" USING btree ("slot_code");

CREATE TABLE IF NOT EXISTS "material_calc_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "material_id" uuid NOT NULL,
  "slot_code" varchar(80) NOT NULL,
  "rule_code" varchar(80),
  "match_key" varchar(120) NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
ALTER TABLE "material_calc_links"
  ADD CONSTRAINT "material_calc_links_material_id_materials_id_fk"
  FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_material_calc_link" ON "material_calc_links" USING btree ("material_id", "match_key");
CREATE INDEX IF NOT EXISTS "idx_material_calc_links_slot" ON "material_calc_links" USING btree ("slot_code");
CREATE INDEX IF NOT EXISTS "idx_material_calc_links_rule" ON "material_calc_links" USING btree ("rule_code");

-- Seed the common calculator slots used by the existing calculator logic.
INSERT INTO "calc_slots" ("code", "label", "trade", "material_key") VALUES
  ('placo_board', 'Plaque BA13 / plâtre', 'placo', 'plaque_ba13_standard'),
  ('placo_furrings', 'Fourrures', 'placo', 'fourrure'),
  ('placo_rail', 'Rail', 'placo', 'rail_48'),
  ('placo_montant', 'Montant', 'placo', 'montant_48'),
  ('placo_joint', 'Joint / bande', 'placo', 'bande_a_joint_90m'),
  ('placo_enduit', 'Enduit / colle', 'placo', 'enduit_joint_25kg'),
  ('placo_fastener', 'Vis/attaches', 'placo', 'vis_placo_25'),
  ('placo_insulation', 'Isolation', 'placo', 'laine_de_verre_50mm'),
  ('tile_plinth', 'Plinthe', 'carrelage', 'plinthes_carrelage')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "calc_rules" ("code", "slot_code", "trade", "legacy_key", "material_code", "description") VALUES
  ('placo_ba13_standard', 'placo_board', 'placo', 'plaque_ba13_standard', 'plaque-ba13-standard-3m', 'Standard BA13 board slot'),
  ('placo_ba13_hydrofuge', 'placo_board', 'placo', 'plaque_ba13_hydrofuge', 'plaque-ba13-hydro', 'Hydrofuge BA13 board slot'),
  ('placo_furrings', 'placo_furrings', 'placo', 'fourrure', 'fourrure-f47', 'Furring rule'),
  ('placo_rail_48', 'placo_rail', 'placo', 'rail_48', 'rail-48', 'Rail 48 rule'),
  ('placo_rail_70', 'placo_rail', 'placo', 'rail_70', 'rail-70', 'Rail 70 rule'),
  ('placo_montant_48', 'placo_montant', 'placo', 'montant_48', 'montant-48', 'Montant 48 rule'),
  ('placo_montant_70', 'placo_montant', 'placo', 'montant_70', 'montant-70', 'Montant 70 rule'),
  ('placo_joint', 'placo_joint', 'placo', 'bande_a_joint_90m', 'bande-joint', 'Joint rule'),
  ('placo_enduit', 'placo_enduit', 'placo', 'enduit_joint_25kg', 'enduit-25kg', 'Enduit rule'),
  ('placo_colle', 'placo_enduit', 'placo', 'colle_gypse_25kg', 'enduit-colle-25', 'Colle rule'),
  ('placo_vis', 'placo_fastener', 'placo', 'vis_placo_25', 'vis-placo-1000', 'Fastener rule'),
  ('placo_insulation', 'placo_insulation', 'placo', 'laine_de_verre_50mm', 'laine-verre-12', 'Insulation rule'),
  ('carrelage_plinth', 'tile_plinth', 'carrelage', 'plinthes_carrelage', 'plinthes-mdf-decor-2-4m', 'Plinth rule')
ON CONFLICT ("code") DO NOTHING;

-- No destructive change; material link rows are created on demand by the app.
