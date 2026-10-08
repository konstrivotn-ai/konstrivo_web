-- Additive TEST-DB migration: subscriptions provider columns missing from DB.
-- Mirrors server/db/schema/identity.ts (subscriptions) exactly (types + defaults).
ALTER TABLE "subscriptions" ADD COLUMN "provider" varchar(50) DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provider_subscription_id" varchar(255);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "price_id" varchar(100);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "currency" varchar(5) DEFAULT 'TND' NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "amount" numeric(12, 2);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "renewal_type" varchar(20) DEFAULT 'manual' NOT NULL;