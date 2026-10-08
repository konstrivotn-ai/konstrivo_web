CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" varchar(255) NOT NULL,
	"trade_name" varchar(255),
	"country_code" varchar(5) DEFAULT 'TN' NOT NULL,
	"currency_code" varchar(5) DEFAULT 'TND' NOT NULL,
	"tax_id_matricule_fiscal" varchar(50),
	"commercial_register_rc" varchar(50),
	"logo_url" text,
	"address_street" text,
	"address_city" varchar(100),
	"address_postal_code" varchar(10),
	"bank_rib" varchar(50),
	"website_url" text,
	"phone" varchar(20),
	"email" varchar(254),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "company_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"role" varchar(30) DEFAULT 'artisan' NOT NULL,
	"tier" varchar(20) DEFAULT 'FREE' NOT NULL,
	"entitlements" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"tier" varchar(20) DEFAULT 'FREE' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"current_period_start" timestamp with time zone DEFAULT now() NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"payment_method_id" varchar(100),
	"discount_code" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"phone" varchar(20),
	"full_name" varchar(200) NOT NULL,
	"password_hash" text NOT NULL,
	"global_role" varchar(30) DEFAULT 'artisan' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"avatar_url" text,
	"preferred_lang" varchar(10) DEFAULT 'fr',
	"region" varchar(100),
	"country" varchar(5) DEFAULT 'TN',
	"license_number" varchar(50),
	"matricule_fiscale" varchar(30),
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "material_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"source_code" varchar(50) NOT NULL,
	"country_code" varchar(5) DEFAULT 'TN' NOT NULL,
	"currency_code" varchar(5) DEFAULT 'TND' NOT NULL,
	"unit_price" numeric(12, 3) NOT NULL,
	"company_id" uuid,
	"supplier_id" uuid,
	"is_current" boolean DEFAULT true NOT NULL,
	"effective_from" date DEFAULT now() NOT NULL,
	"effective_to" date,
	"package_definition_id" uuid,
	"package_price" numeric(12, 3),
	"supplier_catalog_item_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(100) NOT NULL,
	"trade" varchar(50) NOT NULL,
	"category" varchar(50) NOT NULL,
	"name_fr" text NOT NULL,
	"name_ar" text,
	"name_derja" text,
	"base_unit" varchar(20) DEFAULT 'unit' NOT NULL,
	"is_official" boolean DEFAULT true NOT NULL,
	"company_id" uuid,
	"technical_specs" text,
	"image_url" text,
	"standard_norm" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "package_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"package_type" varchar(20) DEFAULT 'unit' NOT NULL,
	"units_per_package" numeric(12, 3) DEFAULT '1' NOT NULL,
	"allow_partial" boolean DEFAULT false NOT NULL,
	"barcode" varchar(50),
	"package_dimensions" varchar(100),
	"package_weight_kg" numeric(10, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_sources" (
	"code" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"is_verified" boolean DEFAULT true NOT NULL,
	"priority_weight" integer DEFAULT 50 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"devis_number" varchar(50) NOT NULL,
	"reference" varchar(50),
	"date" date,
	"client_name" varchar(200),
	"client_phone" varchar(20),
	"client_address" text,
	"project_title" varchar(200),
	"country" varchar(5) DEFAULT 'TN',
	"currency" varchar(5) DEFAULT 'TND',
	"region" varchar(100),
	"surface_area_m2" numeric(12, 3),
	"perimeter_linear_m" numeric(12, 3),
	"waste_margin_percent" numeric(5, 2),
	"total_materials_cost_tnd" numeric(12, 3),
	"total_labor_cost_tnd" numeric(12, 3),
	"subtotal_before_tax_tnd" numeric(12, 3),
	"tax_rate_percent" numeric(5, 2),
	"tax_amount_tnd" numeric(12, 3),
	"grand_total_tnd" numeric(12, 3),
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"sync_state" varchar(20) DEFAULT 'SYNCED',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "devis_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"devis_id" uuid NOT NULL,
	"line_number" integer DEFAULT 1 NOT NULL,
	"material_id" uuid,
	"trade" varchar(50),
	"title" text,
	"description_snapshot" text,
	"unit" varchar(20),
	"exact_calculated_quantity" numeric(12, 3) DEFAULT '0',
	"waste_included_quantity" numeric(12, 3) DEFAULT '0',
	"billable_quantity" numeric(12, 3) DEFAULT '0',
	"unit_price_applied_tnd" numeric(12, 3) DEFAULT '0' NOT NULL,
	"total_price_tnd" numeric(12, 3) DEFAULT '0' NOT NULL,
	"is_custom_added" boolean DEFAULT false NOT NULL,
	"package_details_snapshot" text,
	"supplier_reference" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artisan_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"company_name" varchar(255),
	"trade" varchar(50) NOT NULL,
	"region" varchar(100),
	"rating" numeric(3, 2),
	"is_verified" boolean DEFAULT false,
	"is_pro" boolean DEFAULT false,
	"phone" varchar(20),
	"whatsapp" varchar(20),
	"hourly_rate_tnd" numeric(12, 3),
	"square_meter_rate_tnd" numeric(12, 3),
	"services" jsonb DEFAULT '[]',
	"badges" jsonb DEFAULT '[]',
	"bio" text,
	"avatar_url" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" varchar(255) PRIMARY KEY NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid NOT NULL,
	"response_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_catalog_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid,
	"file_name" varchar(255) NOT NULL,
	"file_size_bytes" bigint DEFAULT 0 NOT NULL,
	"file_sha256" varchar(64),
	"file_mime_type" varchar(100),
	"import_status" varchar(30) DEFAULT 'UPLOADED' NOT NULL,
	"items_count" integer DEFAULT 0,
	"parsed_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"material_code" varchar(100),
	"name_fr" text,
	"category" varchar(50),
	"unit" varchar(20),
	"price_tnd" numeric(12, 3),
	"tva_included" boolean DEFAULT false,
	"matched_material_id" uuid,
	"status" varchar(20) DEFAULT 'pending',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"legal_registration_number" varchar(50),
	"country_code" varchar(5) DEFAULT 'TN',
	"contact_email" varchar(254),
	"contact_phone" varchar(20),
	"is_verified" boolean DEFAULT false,
	"verification_status" varchar(20) DEFAULT 'pending',
	"logo_url" text,
	"region_governorate" varchar(100),
	"address" text,
	"website_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" varchar(100),
	"entity_type" varchar(30) NOT NULL,
	"entity_id" varchar(100) NOT NULL,
	"operation_type" varchar(20) NOT NULL,
	"client_version" integer,
	"server_version" integer,
	"client_timestamp" timestamp with time zone,
	"server_timestamp" timestamp with time zone DEFAULT now(),
	"sync_status" varchar(20) DEFAULT 'pending',
	"payload" jsonb
);
--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_prices" ADD CONSTRAINT "material_prices_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_prices" ADD CONSTRAINT "material_prices_source_code_price_sources_code_fk" FOREIGN KEY ("source_code") REFERENCES "public"."price_sources"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_prices" ADD CONSTRAINT "material_prices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_definitions" ADD CONSTRAINT "package_definitions_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devis" ADD CONSTRAINT "devis_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devis" ADD CONSTRAINT "devis_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devis_items" ADD CONSTRAINT "devis_items_devis_id_devis_id_fk" FOREIGN KEY ("devis_id") REFERENCES "public"."devis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devis_items" ADD CONSTRAINT "devis_items_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artisan_profiles" ADD CONSTRAINT "artisan_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_catalog_imports" ADD CONSTRAINT "supplier_catalog_imports_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_catalog_imports" ADD CONSTRAINT "supplier_catalog_imports_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_catalog_items" ADD CONSTRAINT "supplier_catalog_items_import_id_supplier_catalog_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."supplier_catalog_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_catalog_items" ADD CONSTRAINT "supplier_catalog_items_matched_material_id_materials_id_fk" FOREIGN KEY ("matched_material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_company_member" ON "company_members" USING btree ("user_id","company_id");--> statement-breakpoint
CREATE INDEX "idx_prices_material" ON "material_prices" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "idx_prices_is_current" ON "material_prices" USING btree ("is_current");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_material_code" ON "materials" USING btree ("code","company_id");--> statement-breakpoint
CREATE INDEX "idx_devis_company_status" ON "devis" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "idx_devis_items_devis" ON "devis_items" USING btree ("devis_id");--> statement-breakpoint
CREATE INDEX "idx_imports_supplier" ON "supplier_catalog_imports" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "idx_imports_status" ON "supplier_catalog_imports" USING btree ("import_status");--> statement-breakpoint
CREATE INDEX "idx_sync_user" ON "sync_operations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sync_entity" ON "sync_operations" USING btree ("entity_type","entity_id");
