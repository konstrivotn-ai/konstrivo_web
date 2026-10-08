// @ts-nocheck
/**
 * Phase 4 — Feature Entitlements & Usage Tracking schema.
 *
 * Additive ONLY: two new tables. No existing table is modified.
 * - feature_entitlements: admin-controlled FREE/PRO access per feature key
 * - user_feature_usage:   per-user monthly usage counters (for FREE limits)
 *
 * Plan resolution stays company-first:
 *   company with active PRO subscription → PRO; otherwise → FREE.
 */
import { pgTable, uuid, varchar, boolean, integer, date, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';

export const featureEntitlements = pgTable('feature_entitlements', {
  id: uuid('id').primaryKey().defaultRandom(),
  featureKey: varchar('feature_key', { length: 100 }).notNull(),
  labelFr: varchar('label_fr', { length: 200 }),
  labelAr: varchar('label_ar', { length: 200 }),
  labelDerja: varchar('label_derja', { length: 200 }),
  /** Admin-controlled: whether the FREE plan may use this feature. */
  freeAccess: boolean('free_access').notNull().default(true),
  /** Admin-controlled: whether the PRO plan may use this feature. */
  proAccess: boolean('pro_access').notNull().default(true),
  /** NULL = unlimited. Monthly limit applied to whichever plan has access. */
  usageLimit: integer('usage_limit'),
  /** 'all' | 'client' | 'artisan' | 'supplier' | 'engineer' — role scoping. */
  scope: varchar('scope', { length: 20 }).notNull().default('all'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uqFeatureKey: uniqueIndex('uq_feature_entitlements_key').on(table.featureKey),
  idxFeatureScope: index('idx_feature_entitlements_scope').on(table.scope),
  idxFeatureActive: index('idx_feature_entitlements_active').on(table.isActive),
}));

export const userFeatureUsage = pgTable('user_feature_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  featureKey: varchar('feature_key', { length: 100 }).notNull(),
  usageCount: integer('usage_count').notNull().default(0),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uqUsagePeriod: uniqueIndex('uq_user_feature_usage_period').on(
    table.userId, table.featureKey, table.periodStart
  ),
  idxUsageUser: index('idx_user_feature_usage_user').on(table.userId),
  idxUsagePeriod: index('idx_user_feature_usage_period').on(
    table.periodStart, table.periodEnd
  ),
}));