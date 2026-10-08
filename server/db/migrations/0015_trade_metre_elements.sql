-- DYNAMIC MÉTRÉ — Phase 1 data-driven element registry (ADDITIVE ONLY, idempotent).
-- New table only: no ALTER/DROP of any existing table, no data touched.
-- Mirrors 0005_trade_services.sql (trade ↔ element association per métier).
CREATE TABLE IF NOT EXISTS "trade_metre_elements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"element_code" varchar(100) NOT NULL,
	"label_fr" varchar(150) NOT NULL,
	"label_ar" varchar(150),
	"method" varchar(30) NOT NULL,
	"dims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"calc" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"qty_unit" varchar(10) DEFAULT 'unit' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "trade_metre_elements" ADD CONSTRAINT "trade_metre_elements_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_trade_metre_element" ON "trade_metre_elements" USING btree ("trade_id","element_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_trade_metre_elements_trade_id" ON "trade_metre_elements" USING btree ("trade_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_trade_metre_elements_active" ON "trade_metre_elements" USING btree ("is_active");