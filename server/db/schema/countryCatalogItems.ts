// PHASE 1 — Country Catalog items + calc rules (ADDITIVE, part 2)
import { pgTable, uuid, varchar, text, boolean, integer, numeric, timestamp, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { countryCatalogs } from './countryCatalog';
export const countryCatalogItems = pgTable('country_catalog_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  catalogId: uuid('catalog_id').notNull().references(() => countryCatalogs.id, { onDelete: 'cascade' }),
  countryCode: varchar('country_code', { length: 5 }).notNull(),
  materialCode: varchar('material_code', { length: 100 }).notNull(),
  materialName: text('material_name').notNull(),
  trade: varchar('trade', { length: 50 }).notNull(),
  tradeLabel: varchar('trade_label', { length: 200 }),
  category: varchar('category', { length: 100 }).notNull(),
  unit: varchar('unit', { length: 20 }).notNull().default('unit'),
  priceHt: numeric('price_ht', { precision: 12, scale: 3 }).notNull(),
  currencyCode: varchar('currency_code', { length: 5 }).notNull().default('TND'),
  tvaRate: numeric('tva_rate', { precision: 6, scale: 3 }),
  isActive: boolean('is_active').notNull().default(true),
  sourceRow: integer('source_row'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uqCatalogMaterial: uniqueIndex('uq_country_catalog_item').on(table.catalogId, table.materialCode),
  idxCatalogItemsCatalog: index('idx_country_catalog_items_catalog').on(table.catalogId),
  idxCatalogItemsCountry: index('idx_country_catalog_items_country').on(table.countryCode, table.isActive),
  idxCatalogItemsTrade: index('idx_country_catalog_items_trade').on(table.countryCode, table.trade),
}));
export const countryCalculationRules = pgTable('country_calculation_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  countryCode: varchar('country_code', { length: 5 }).notNull(),
  trade: varchar('trade', { length: 50 }),
  ruleKey: varchar('rule_key', { length: 100 }).notNull(),
  ruleValue: jsonb('rule_value').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uqCountryRule: uniqueIndex('uq_country_calc_rule').on(table.countryCode, table.trade, table.ruleKey),
  idxCountryRules: index('idx_country_calc_rules_country').on(table.countryCode, table.isActive),
}));
