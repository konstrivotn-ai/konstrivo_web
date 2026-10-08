CREATE INDEX "idx_members_user" ON "company_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_members_company" ON "company_members" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_company" ON "subscriptions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_prices_country" ON "material_prices" USING btree ("country_code");--> statement-breakpoint
CREATE INDEX "idx_prices_currency" ON "material_prices" USING btree ("currency_code");--> statement-breakpoint
CREATE INDEX "idx_prices_company" ON "material_prices" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_prices_supplier" ON "material_prices" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "idx_prices_effective_from" ON "material_prices" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "idx_materials_trade" ON "materials" USING btree ("trade");--> statement-breakpoint
CREATE INDEX "idx_materials_category" ON "materials" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_materials_company" ON "materials" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_devis_created_by" ON "devis" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "idx_catalog_items_import" ON "supplier_catalog_items" USING btree ("import_id");
