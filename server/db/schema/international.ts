// @ts-nocheck
/**
 * Phase 1 / Foundation — International base (ADDITIVE ONLY)
 *
 * New reference tables: UoM + conversions, Country/Market profiles,
 * Currencies + FX rates, Tax rules, Material identifiers/attributes and
 * Import/source provenance. No existing table is modified here except two
 * NULLABLE additive columns on `materials` (source_type / source_import_id)
 * added by migration 0008. Tunisia is seeded as the FIRST country profile
 * (data row), never hardcoded logic.
 */
import { pgTable, uuid, varchar, text, boolean, integer, numeric, timestamp, date, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { companies } from './identity';
import { materials } from './catalog';
import { suppliers, supplierCatalogImports } from './operations';

// ── Units of Measure (UoM) ───────────────────────────────────────────────────
export const unitsOfMeasure = pgTable('units_of_measure', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 20 }).notNull(),
  symbol: varchar('symbol', { length: 20 }),
  nameFr: varchar('name_fr', { length: 100 }).notNull(),
  nameAr: varchar('name_ar', { length: 100 }),
  nameEn: varchar('name_en', { length: 100 }),
  /** length | area | volume | mass | count | other */
  dimension: varchar('dimension', { length: 20 }).notNull().default('other'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uqUomCode: uniqueIndex('uq_uom_code').on(table.code),
  idxUomDimension: index('idx_uom_dimension').on(table.dimension),
}));

/** factor: value in `toUnitId` per 1 `fromUnitId` (e.g. 1 m → 100 cm = 100). */
export const unitConversions = pgTable('unit_conversions', {
  id: uuid('id').primaryKey().defaultRandom(),
  fromUnitId: uuid('from_unit_id').notNull().references(() => unitsOfMeasure.id, { onDelete: 'cascade' }),
  toUnitId: uuid('to_unit_id').notNull().references(() => unitsOfMeasure.id, { onDelete: 'cascade' }),
  factor: numeric('factor', { precision: 18, scale: 8 }).notNull(),
  /** official | supplier | computed */
  source: varchar('source', { length: 50 }).notNull().default('official'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uqConversion: uniqueIndex('uq_unit_conversion').on(table.fromUnitId, table.toUnitId),
}));

// ── Country / Market profiles ────────────────────────────────────────────────
// Tunisia (TN) is the first profile seeded by migration 0008 — a DATA row,
// not business logic. Adding a market = adding a row.
export const countries = pgTable('countries', {
  code: varchar('code', { length: 5 }).primaryKey(),
  nameFr: varchar('name_fr', { length: 100 }).notNull(),
  nameAr: varchar('name_ar', { length: 100 }),
  flag: varchar('flag', { length: 10 }),
  defaultCurrency: varchar('default_currency', { length: 5 }).notNull().default('TND'),
  supportedCurrencies: jsonb('supported_currencies').notNull().default('["TND"]'),
  defaultVatRate: numeric('default_vat_rate', { precision: 5, scale: 2 }),
  timbreFiscalDefault: numeric('timbre_fiscal_default', { precision: 12, scale: 3 }),
  standardRetenueRate: numeric('standard_retenue_rate', { precision: 5, scale: 2 }),
  buildingCodes: varchar('building_codes', { length: 200 }),
  /** metric | imperial */
  unitSystem: varchar('unit_system', { length: 10 }).notNull().default('metric'),
  isDefaultMarket: boolean('is_default_market').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Currencies + FX ──────────────────────────────────────────────────────────
export const currencies = pgTable('currencies', {
  code: varchar('code', { length: 5 }).primaryKey(),
  label: varchar('label', { length: 100 }).notNull(),
  symbol: varchar('symbol', { length: 10 }),
  decimals: integer('decimals').notNull().default(2),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** rate: how many QUOTE per 1 BASE (e.g. base=TND quote=EUR rate=0.295). */
export const fxRates = pgTable('fx_rates', {
  id: uuid('id').primaryKey().defaultRandom(),
  baseCurrency: varchar('base_currency', { length: 5 }).notNull().references(() => currencies.code),
  quoteCurrency: varchar('quote_currency', { length: 5 }).notNull().references(() => currencies.code),
  rate: numeric('rate', { precision: 18, scale: 8 }).notNull(),
  source: varchar('source', { length: 50 }).notNull().default('manual'),
  effectiveFrom: date('effective_from').notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxFxPair: index('idx_fx_pair').on(table.baseCurrency, table.quoteCurrency),
  idxFxEffective: index('idx_fx_effective').on(table.effectiveFrom),
}));

// ── Tax rules ────────────────────────────────────────────────────────────────
/** taxType: VAT | TIMBRE | RETENUE | OTHER — per country, validity-dated. */
export const taxRules = pgTable('tax_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  countryCode: varchar('country_code', { length: 5 }).notNull().references(() => countries.code),
  taxType: varchar('tax_type', { length: 30 }).notNull().default('VAT'),
  rate: numeric('rate', { precision: 6, scale: 3 }),
  labelFr: varchar('label_fr', { length: 200 }),
  labelAr: varchar('label_ar', { length: 200 }),
  isDefault: boolean('is_default').notNull().default(false),
  validFrom: date('valid_from'),
  validTo: date('valid_to'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxTaxCountry: index('idx_tax_rules_country').on(table.countryCode, table.taxType),
}));

// ── Material identifiers / attributes ────────────────────────────────────────
/** identifierType: ean | gtin | sku | supplier_ref | legacy_code | other */
export const materialIdentifiers = pgTable('material_identifiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  materialId: uuid('material_id').notNull().references(() => materials.id, { onDelete: 'cascade' }),
  identifierType: varchar('identifier_type', { length: 30 }).notNull(),
  identifierValue: varchar('identifier_value', { length: 255 }).notNull(),
  supplierId: uuid('supplier_id').references(() => suppliers.id),
  /** official | supplier | import */
  source: varchar('source', { length: 50 }).notNull().default('official'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uqMaterialIdentifier: uniqueIndex('uq_material_identifier').on(table.identifierType, table.identifierValue, table.materialId),
  idxMaterialIdentifiersMaterial: index('idx_material_identifiers_material').on(table.materialId),
  idxMaterialIdentifiersValue: index('idx_material_identifiers_value').on(table.identifierValue),
}));

/** Free-form, provenance-aware attribute rows (density, width, norm…). */
export const materialAttributes = pgTable('material_attributes', {
  id: uuid('id').primaryKey().defaultRandom(),
  materialId: uuid('material_id').notNull().references(() => materials.id, { onDelete: 'cascade' }),
  attributeKey: varchar('attribute_key', { length: 100 }).notNull(),
  attributeValue: text('attribute_value'),
  source: varchar('source', { length: 50 }).notNull().default('official'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxMaterialAttributesMaterial: index('idx_material_attributes_material').on(table.materialId, table.attributeKey),
}));

// ── Import / source provenance ───────────────────────────────────────────────
// Reuses the EXISTING supplier staging (supplier_catalog_imports) — no new
// staging system. One row per produced/updated entity per import.
export const importProvenance = pgTable('import_provenance', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** material | price | trade | devis | project … */
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: uuid('entity_id').notNull(),
  importId: uuid('import_id').references(() => supplierCatalogImports.id),
  /** supplier_catalog | csv | xlsx | manual | seed | api */
  sourceType: varchar('source_type', { length: 30 }).notNull().default('manual'),
  sourceRef: varchar('source_ref', { length: 255 }),
  createdByUserId: uuid('created_by_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxProvenanceEntity: index('idx_provenance_entity').on(table.entityType, table.entityId),
  idxProvenanceImport: index('idx_provenance_import').on(table.importId),
}));
