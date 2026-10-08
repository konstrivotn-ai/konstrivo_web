CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"provider" varchar(50) DEFAULT 'manual' NOT NULL,
	"provider_payment_id" varchar(255),
	"amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(5) DEFAULT 'TND' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"payment_type" varchar(30) DEFAULT 'manual' NOT NULL,
	"subscription_id" uuid,
	"invoice_number" varchar(50),
	"metadata" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_payments_company" ON "payments" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_payments_provider" ON "payments" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payments_provider_payment_id" ON "payments" USING btree ("provider","provider_payment_id");