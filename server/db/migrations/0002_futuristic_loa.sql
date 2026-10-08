CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"manager_user_id" uuid,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"client_name" varchar(200),
	"client_phone" varchar(20),
	"address" text,
	"region" varchar(100),
	"country" varchar(5) DEFAULT 'TN' NOT NULL,
	"currency" varchar(5) DEFAULT 'TND' NOT NULL,
	"type" varchar(30) DEFAULT 'residentiel' NOT NULL,
	"status" varchar(30) DEFAULT 'planification' NOT NULL,
	"progress_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"budget_total_ht" numeric(15, 3),
	"depenses_actuelles_ht" numeric(15, 3) DEFAULT '0' NOT NULL,
	"start_date" timestamp with time zone,
	"target_end_date" timestamp with time zone,
	"phases" jsonb DEFAULT '[]' NOT NULL,
	"logs" jsonb DEFAULT '[]' NOT NULL,
	"team" jsonb DEFAULT '[]' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_manager_user_id_users_id_fk" FOREIGN KEY ("manager_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_projects_company" ON "projects" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_projects_manager" ON "projects" USING btree ("manager_user_id");--> statement-breakpoint
CREATE INDEX "idx_projects_status" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_projects_deleted" ON "projects" USING btree ("is_deleted");