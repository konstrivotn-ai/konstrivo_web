// @ts-nocheck
// PHASE 1 — Country Catalog (ADDITIVE ONLY, part 1)
import { pgTable, uuid, varchar, text, boolean, integer, numeric, timestamp, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';
export const countryCatalogs = pgTable('country_catalogs', {
  id: uuid('id').primaryKey().defaultRandom(),
  countryCode: varchar('country_code', { length: 5 }).notNull(),
  version: integer('version').notNull().default(1),
  isActive: boolean('is_active').notNull().default(true),
  fileName: varchar('file_name', { length: 255 }),
  sourceRef: varchar('source_ref', { length: 255 }),
  contentSha256: varchar('content_sha256', { length: 64 }),
  currencyCode: varchar('currency_code', { length: 5 }).notNull().default('TND'),
  itemsCount: integer('items_count').notNull().default(0),
  importedCount: integer('imported_count').notNull().default(0),
  updatedCount: integer('updated_count').notNull().default(0),
  deactivatedCount: integer('deactivated_count').notNull().default(0),
  createdByUserId: uuid('created_by_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uqCountryVersion: uniqueIndex('uq_country_catalog_version').on(table.countryCode, table.version),
  idxCountryActive: index('idx_country_catalogs_active').on(table.countryCode, table.isActive),
  idxContentHash: index('idx_country_catalogs_hash').on(table.countryCode, table.contentSha256),
}));
