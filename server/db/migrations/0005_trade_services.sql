CREATE TABLE "trade_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"name_fr" varchar(150) NOT NULL,
	"name_ar" varchar(150),
	"default_unit" varchar(20) DEFAULT 'm²' NOT NULL,
	"suggested_rate_tnd" numeric(12, 3),
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trade_services" ADD CONSTRAINT "trade_services_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_trade_services_trade_id" ON "trade_services" USING btree ("trade_id");
--> statement-breakpoint
CREATE INDEX "idx_trade_services_active" ON "trade_services" USING btree ("is_active");
