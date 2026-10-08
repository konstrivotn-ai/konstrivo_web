CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"label_fr" varchar(100) NOT NULL,
	"label_ar" varchar(100),
	"label_derja" varchar(100),
	"icon" varchar(50),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_official" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "trade_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_trade_code" ON "trades" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_trades_official" ON "trades" USING btree ("is_official");--> statement-breakpoint
CREATE INDEX "idx_trades_active" ON "trades" USING btree ("is_active");--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_materials_trade_id" ON "materials" USING btree ("trade_id");
