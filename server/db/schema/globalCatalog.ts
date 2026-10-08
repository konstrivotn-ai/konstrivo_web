// @ts-nocheck
/**
 * Phase 4 — Global Product Master (ADDITIVE ONLY)
 *
 * IMPORTANT:
 * - `materials` remains the existing KONSTRIVO domain for calculator/trades/prices.
 * - This file introduces a higher-level global catalog identity that can be
 *   mapped to materials gradually.
 * - No existing table is renamed or replaced.
 */
import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { materials } from './catalog';
import { suppliers } from './operations';
import { countries } from './international';

/** Global product master (stable identity across countries/sources). */
export const globalProducts = pgTable('global_products', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Human display name (canonical). */
  name: text('name').notNull(),
  brand: varchar('brand', { length: 120 }),
  manufacturer: varchar('manufacturer', { length: 120 }),
  category: varchar('category', { length: 120 }),
  subcategory: varchar('subcategory', { length: 120 }),
  description: text('description'),
  specification: text('specification'),
  unit: varchar('unit', { length: 30 }),
  model: varchar('model', { length: 120 }),
  sku: varchar('sku', { length: 120 }),
  status: varchar('status', { length: 30 }).notNull().default('active'),
  media: jsonb('media').notNull().default('[]'),
  extra: jsonb('extra').notNull().default('{}'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxName: index('idx_global_products_name').on(t.name),
  idxBrand: index('idx_global_products_brand').on(t.brand),
  idxCategory: index('idx_global_products_category').on(t.category),
}));

/** Strong identifiers for global products (GTIN/EAN/UPC, SKU, manufacturer ref…). */
export const globalProductIdentifiers = pgTable('global_product_identifiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  globalProductId: uuid('global_product_id').notNull().references(() => globalProducts.id, { onDelete: 'cascade' }),
  /** gtin | ean | upc | sku | manufacturer_ref | model | supplier_ref | other */
  identifierType: varchar('identifier_type', { length: 40 }).notNull(),
  identifierValue: varchar('identifier_value', { length: 255 }).notNull(),
  /** Optional context: who asserted this identifier. */
  supplierId: uuid('supplier_id').references(() => suppliers.id),
  confidence: integer('confidence').notNull().default(100),
  source: varchar('source', { length: 50 }).notNull().default('manual'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Hardening: do NOT assume all identifiers are globally unique.
  // Strong types (gtin/ean/upc) are made unique at the DB layer via a partial index
  // in migration 0017. Weak identifiers are scoped by supplier_id (also in 0017).
  idxValue: index('idx_global_identifiers_value').on(t.identifierValue),
  idxProduct: index('idx_global_identifiers_product').on(t.globalProductId),
  idxSupplier: index('idx_global_identifiers_supplier').on(t.supplierId),
}));

/** Optional / gradual mapping from existing materials to global products. */
export const materialGlobalProductLinks = pgTable('material_global_product_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  materialId: uuid('material_id').notNull().references(() => materials.id, { onDelete: 'cascade' }),
  globalProductId: uuid('global_product_id').notNull().references(() => globalProducts.id, { onDelete: 'cascade' }),
  /** manual | import | review_approved */
  linkSource: varchar('link_source', { length: 40 }).notNull().default('manual'),
  /** proposed | approved | rejected */
  status: varchar('status', { length: 20 }).notNull().default('approved'),
  confidence: integer('confidence').notNull().default(100),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uqMaterial: uniqueIndex('uq_material_global_link').on(t.materialId),
  idxGlobal: index('idx_material_global_link_global').on(t.globalProductId),
}));

/** Availability + per-country local metadata for a global product. */
export const globalProductCountryAvailability = pgTable('global_product_country_availability', {
  id: uuid('id').primaryKey().defaultRandom(),
  globalProductId: uuid('global_product_id').notNull().references(() => globalProducts.id, { onDelete: 'cascade' }),
  countryCode: varchar('country_code', { length: 5 }).notNull().references(() => countries.code),
  isAvailable: boolean('is_available').notNull().default(true),
  localName: text('local_name'),
  localReference: varchar('local_reference', { length: 255 }),
  localSpecification: text('local_specification'),
  localUnit: varchar('local_unit', { length: 30 }),
  observedAt: timestamp('observed_at', { withTimezone: true }),
  // Hardening: allow direct source provenance.
  catalogSourceId: uuid('catalog_source_id').references(() => catalogSources.id),
  sourceRef: varchar('source_ref', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uqCountry: uniqueIndex('uq_global_product_country').on(t.globalProductId, t.countryCode),
  idxCountry: index('idx_global_product_country_code').on(t.countryCode, t.isAvailable),
}));

/**
 * Source registry for global catalog ingestion (API/CSV/XLSX/PDF/manual).
 * This does NOT replace `price_sources` (which is used by the pricing pipeline).
 */
export const catalogSources = pgTable('catalog_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 200 }).notNull(),
  /** api | csv | xlsx | pdf | manual | supplier_catalog | manufacturer_catalog */
  sourceType: varchar('source_type', { length: 40 }).notNull(),
  countryCode: varchar('country_code', { length: 5 }),
  provider: varchar('provider', { length: 200 }),
  url: text('url'),
  status: varchar('status', { length: 30 }).notNull().default('active'),
  configuration: jsonb('configuration').notNull().default('{}'),
  updateFrequency: varchar('update_frequency', { length: 40 }),
  lastSuccessfulSyncAt: timestamp('last_successful_sync_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxType: index('idx_catalog_sources_type').on(t.sourceType),
  idxCountry: index('idx_catalog_sources_country').on(t.countryCode),
}));

/** One import run for a source (preview/commit tracked out-of-band). */
export const catalogImports = pgTable('catalog_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').references(() => catalogSources.id),
  countryCode: varchar('country_code', { length: 5 }),
  fileName: varchar('file_name', { length: 255 }),
  fileSha256: varchar('file_sha256', { length: 64 }),
  fileMimeType: varchar('file_mime_type', { length: 120 }),
  importStatus: varchar('import_status', { length: 30 }).notNull().default('UPLOADED'),
  itemsCount: integer('items_count').notNull().default(0),
  importedCount: integer('imported_count').notNull().default(0),
  updatedCount: integer('updated_count').notNull().default(0),
  rejectedCount: integer('rejected_count').notNull().default(0),
  errorSummary: text('error_summary'),
  createdByUserId: uuid('created_by_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxImportsSource: index('idx_catalog_imports_source').on(t.sourceId),
  idxImportsStatus: index('idx_catalog_imports_status').on(t.importStatus),
}));

/** Individual raw/normalized rows staged for matching + review. */
export const catalogImportItems = pgTable('catalog_import_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  importId: uuid('import_id').notNull().references(() => catalogImports.id, { onDelete: 'cascade' }),
  sourceRow: integer('source_row'),
  countryCode: varchar('country_code', { length: 5 }),
  raw: jsonb('raw').notNull().default('{}'),
  normalized: jsonb('normalized').notNull().default('{}'),
  /** new | matched | possible_match | review_required | approved | rejected */
  matchStatus: varchar('match_status', { length: 30 }).notNull().default('new'),
  matchedGlobalProductId: uuid('matched_global_product_id').references(() => globalProducts.id),
  matchedMaterialId: uuid('matched_material_id').references(() => materials.id),
  confidence: integer('confidence').notNull().default(0),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxItemsImport: index('idx_catalog_import_items_import').on(t.importId),
  idxItemsStatus: index('idx_catalog_import_items_status').on(t.matchStatus),
  idxItemsGlobal: index('idx_catalog_import_items_global').on(t.matchedGlobalProductId),
}));
