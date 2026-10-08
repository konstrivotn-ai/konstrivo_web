// @ts-nocheck
/**
 * Phase 3 â€” Drizzle Schema: materials, price_sources, material_prices, package_definitions
 * Requires: npm install drizzle-orm postgres
 */
import { pgTable, uuid, varchar, text, boolean, integer, numeric, timestamp, date, bigint, uniqueIndex, index, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies } from './identity';

// â”€â”€ Trades (MÃ©tiers) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Independent, dynamic trade registry. Each trade owns its materials and prices.
// The 12 original trades are seeded as is_official = true and must never be deleted.
export const trades = pgTable('trades', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull(),
  labelFr: varchar('label_fr', { length: 100 }).notNull(),
  labelAr: varchar('label_ar', { length: 100 }),
  labelDerja: varchar('label_derja', { length: 100 }),
  icon: varchar('icon', { length: 50 }),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  isOfficial: boolean('is_official').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uqTradeCode: uniqueIndex('uq_trade_code').on(table.code),
  idxTradesOfficial: index('idx_trades_official').on(table.isOfficial),
  idxTradesActive: index('idx_trades_active').on(table.isActive),
}));

export const materials = pgTable('materials', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 100 }).notNull(),
  trade: varchar('trade', { length: 50 }).notNull(),
  tradeId: uuid('trade_id').references(() => trades.id),
  category: varchar('category', { length: 50 }).notNull(),
  nameFr: text('name_fr').notNull(),
  nameAr: text('name_ar'),
  nameEn: text('name_en'),
  baseUnit: varchar('base_unit', { length: 20 }).notNull().default('unit'),
  isOfficial: boolean('is_official').notNull().default(true),
  companyId: uuid('company_id').references(() => companies.id),
  technicalSpecs: text('technical_specs'),
  imageUrl: text('image_url'),
  standardNorm: varchar('standard_norm', { length: 50 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
  isDeleted: boolean('is_deleted').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  uqMaterial: uniqueIndex('uq_material_code').on(table.code, table.companyId),
  idxMaterialsTrade: index('idx_materials_trade').on(table.trade),
  idxMaterialsTradeId: index('idx_materials_trade_id').on(table.tradeId),
  idxMaterialsCategory: index('idx_materials_category').on(table.category),
  idxMaterialsCompany: index('idx_materials_company').on(table.companyId),
}));

// â”€â”€ Trade â†” Service association (Phase D) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Normalized, data-driven services per trade. A newly imported trade can have
// services defined here WITHOUT any source code change. Official trades are
// seeded; dynamic trades can be populated via admin/API.
export const tradeServices = pgTable('trade_services', {
  id: uuid('id').primaryKey().defaultRandom(),
  tradeId: uuid('trade_id').notNull().references(() => trades.id, { onDelete: 'cascade' }),
  nameFr: varchar('name_fr', { length: 150 }).notNull(),
  nameAr: varchar('name_ar', { length: 150 }),
  defaultUnit: varchar('default_unit', { length: 20 }).notNull().default('mÂ²'),
  suggestedRateTnd: numeric('suggested_rate_tnd', { precision: 12, scale: 3 }),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxTradeServicesTradeId: index('idx_trade_services_trade_id').on(table.tradeId),
  idxTradeServicesActive: index('idx_trade_services_active').on(table.isActive),
}));

export const priceSources = pgTable('price_sources', {
  code: varchar('code', { length: 50 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  isVerified: boolean('is_verified').notNull().default(true),
  priorityWeight: integer('priority_weight').notNull().default(50),
});

// â”€â”€ Trade â†” Dynamic MÃ©trÃ© element association (Phase 1 â€” data-driven) â”€â”€â”€â”€â”€â”€â”€
// ADDITIVE mirror of `trade_services`: a NEW catalogue mÃ©tier gets measurable
// Dynamic MÃ©trÃ© elements as DATA rows â€” never a `metreElements.ts` edit and
// never an `if (trade === ...)` branch. Read path:
//   GET /trades/:id/metre-elements â†’ `loadMetreElementsForTrade`
//   (DB â†’ METRE_ELEMENTS config fallback â†’ []).
export const tradeMetreElements = pgTable('trade_metre_elements', {
  id: uuid('id').primaryKey().defaultRandom(),
  tradeId: uuid('trade_id').notNull().references(() => trades.id, { onDelete: 'cascade' }),
  elementCode: varchar('element_code', { length: 100 }).notNull(),
  labelFr: varchar('label_fr', { length: 150 }).notNull(),
  labelAr: varchar('label_ar', { length: 150 }),
  /** `MetreMethod` whitelist â€” validated by `isValidMetreElementShape` before write. */
  method: varchar('method', { length: 30 }).notNull(),
  /** `ElementDim[]` â€” structured JSON, never eval'ed (see metreEngine.ts). */
  dims: jsonb('dims').notNull().default('[]'),
  /** `QtyCalcSpec` â€” whitelisted `op`, evaluated only by metreEngine. */
  calc: jsonb('calc').notNull().default('{}'),
  qtyUnit: varchar('qty_unit', { length: 10 }).notNull().default('unit'),
  // â”€â”€ PHASE 1 â€” ENRICHED SPECIFICATION (ADDITIVE, NULLABLE, migration 0019) â”€â”€â”€
  // Every column below is NULLABLE with NO default: an existing row keeps NULL,
  // which the engine reads as "not configured" and contributes exactly nothing.
  // No existing row is rewritten and no existing behaviour changes.
  /** `MetreOpeningsSpec` â€” structured openings (porte / fenÃªtre / baie). */
  openings: jsonb('openings'),
  /** `MetreDeductionsSpec` â€” explicit deductions, independent from openings. */
  deductions: jsonb('deductions'),
  /** Repetition count (coats / layers). NULL = 1 (no multiplication). */
  layers: numeric('layers', { precision: 8, scale: 2 }),
  /** Waste percentage applied ONCE at the end. NULL = no waste. */
  wastePercent: numeric('waste_percent', { precision: 6, scale: 3 }),
  /** `MetreYieldSpec` â€” explicit coverage (kg/mÂ², L/mÂ², â€¦). NULL = no conversion. */
  yieldPerUnit: jsonb('yield_per_unit'),
  /** Phase 1.1 preferred field (explicit coverage semantics). */
  coveragePerProductUnit: jsonb('coverage_per_product_unit'),
  // PHASE 2 - explicit bindings (ADDITIVE, NULLABLE; migration 0020)
  materialBindings: jsonb('material_bindings'),
  serviceBindings: jsonb('service_bindings'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uqTradeMetreElement: uniqueIndex('uq_trade_metre_element').on(table.tradeId, table.elementCode),
  idxTradeMetreElementsTradeId: index('idx_trade_metre_elements_trade_id').on(table.tradeId),
  idxTradeMetreElementsActive: index('idx_trade_metre_elements_active').on(table.isActive),
}));

/** NUMERIC(12,3) for monetary values â€” never FLOAT. */
export const materialPrices = pgTable('material_prices', {
  id: uuid('id').primaryKey().defaultRandom(),
  materialId: uuid('material_id').notNull().references(() => materials.id),
  sourceCode: varchar('source_code', { length: 50 }).notNull().references(() => priceSources.code),
  countryCode: varchar('country_code', { length: 5 }).notNull().default('TN'),
  currencyCode: varchar('currency_code', { length: 5 }).notNull().default('TND'),
  unitPrice: numeric('unit_price', { precision: 12, scale: 3 }).notNull(),
  companyId: uuid('company_id').references(() => companies.id),
  supplierId: uuid('supplier_id'),
  reviewStatus: varchar('review_status', { length: 20 }).notNull().default('published'),
  reviewedBy: uuid('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  publishedBy: uuid('published_by'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  rejectedBy: uuid('rejected_by'),
  rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  isCurrent: boolean('is_current').notNull().default(true),
  effectiveFrom: date('effective_from').notNull().defaultNow(),
  effectiveTo: date('effective_to'),
  packageDefinitionId: uuid('package_definition_id'),
  packagePrice: numeric('package_price', { precision: 12, scale: 3 }),
  supplierCatalogItemId: uuid('supplier_catalog_item_id'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
  isDeleted: boolean('is_deleted').notNull().default(false),
}, (table) => ({
  idxMaterial: index('idx_prices_material').on(table.materialId),
  idxCurrent: index('idx_prices_is_current').on(table.isCurrent),
  idxPricesCountry: index('idx_prices_country').on(table.countryCode),
  idxPricesCurrency: index('idx_prices_currency').on(table.currencyCode),
  idxPricesCompany: index('idx_prices_company').on(table.companyId),
  idxPricesSupplier: index('idx_prices_supplier').on(table.supplierId),
  idxPricesEffectiveFrom: index('idx_prices_effective_from').on(table.effectiveFrom),
  idxPricesReviewStatus: index('idx_prices_review_status').on(table.reviewStatus),
}));

/**
 * package_definitions â€” mirrors server/db/migrations/0001_initial.sql exactly.
 * Supports package-aware price lookup (material_prices.package_definition_id).
 * FK: material_id â†’ materials.id
 */
export const packageDefinitions = pgTable('package_definitions', {
  id: uuid('id').primaryKey().default(sql`uuid_generate_v4()`),
  materialId: uuid('material_id').notNull().references(() => materials.id),
  packageType: varchar('package_type', { length: 20 }).notNull().default('unit'),
  unitsPerPackage: numeric('units_per_package', { precision: 12, scale: 3 }).notNull().default('1'),
  allowPartial: boolean('allow_partial').notNull().default(false),
  barcode: varchar('barcode', { length: 50 }),
  packageDimensions: varchar('package_dimensions', { length: 100 }),
  packageWeightKg: numeric('package_weight_kg', { precision: 10, scale: 3 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

