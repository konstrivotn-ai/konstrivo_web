-- Phase 3B / Review State workflow (ADDITIVE ONLY)
-- Adds the persisted review-state fields required by the current schema while
-- preserving all existing rows and values.

ALTER TABLE "material_prices"
  ADD COLUMN IF NOT EXISTS "review_status" varchar(20) DEFAULT 'published' NOT NULL,
  ADD COLUMN IF NOT EXISTS "reviewed_by" uuid,
  ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "published_by" uuid,
  ADD COLUMN IF NOT EXISTS "published_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "rejected_by" uuid,
  ADD COLUMN IF NOT EXISTS "rejected_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "rejection_reason" text;

UPDATE "material_prices"
SET "review_status" = 'published'
WHERE "review_status" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_prices_review_status"
  ON "material_prices" USING btree ("review_status");
