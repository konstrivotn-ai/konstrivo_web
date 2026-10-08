// @ts-nocheck
/**
 * Phase 3 — Drizzle Schema: suppliers, supplier_imports, artisans, sync, idempotency
 */
import { pgTable, uuid, varchar, text, boolean, integer, numeric, timestamp, bigint, jsonb, index } from 'drizzle-orm/pg-core';
import { users, companies } from './identity';
import { materials } from './catalog';

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  legalRegistrationNumber: varchar('legal_registration_number', { length: 50 }),
  countryCode: varchar('country_code', { length: 5 }).default('TN'),
  contactEmail: varchar('contact_email', { length: 254 }),
  contactPhone: varchar('contact_phone', { length: 20 }),
  isVerified: boolean('is_verified').default(false),
  verificationStatus: varchar('verification_status', { length: 20 }).default('pending'),
  logoUrl: text('logo_url'),
  regionGovernorate: varchar('region_governorate', { length: 100 }),
  address: text('address'),
  websiteUrl: text('website_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
  isDeleted: boolean('is_deleted').notNull().default(false),
});

export const supplierCatalogImports = pgTable('supplier_catalog_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  supplierId: uuid('supplier_id').references(() => suppliers.id),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull().default(0),
  fileSha256: varchar('file_sha256', { length: 64 }),
  fileMimeType: varchar('file_mime_type', { length: 100 }),
  importStatus: varchar('import_status', { length: 30 }).notNull().default('UPLOADED'),
  itemsCount: integer('items_count').default(0),
  parsedAt: timestamp('parsed_at', { withTimezone: true }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedByUserId: uuid('approved_by_user_id').references(() => users.id),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
  isDeleted: boolean('is_deleted').notNull().default(false),
}, (table) => ({
  idxSupplier: index('idx_imports_supplier').on(table.supplierId),
  idxStatus: index('idx_imports_status').on(table.importStatus),
}));

export const supplierCatalogItems = pgTable('supplier_catalog_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  importId: uuid('import_id').notNull().references(() => supplierCatalogImports.id),
  materialCode: varchar('material_code', { length: 100 }),
  nameFr: text('name_fr'),
  category: varchar('category', { length: 50 }),
  unit: varchar('unit', { length: 20 }),
  priceTnd: numeric('price_tnd', { precision: 12, scale: 3 }),
  tvaIncluded: boolean('tva_included').default(false),
  matchedMaterialId: uuid('matched_material_id').references(() => materials.id),
  status: varchar('status', { length: 20 }).default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxCatalogItemsImport: index('idx_catalog_items_import').on(table.importId),
}));

export const artisanProfiles = pgTable('artisan_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  companyName: varchar('company_name', { length: 255 }),
  trade: varchar('trade', { length: 50 }).notNull(),
  region: varchar('region', { length: 100 }),
  rating: numeric('rating', { precision: 3, scale: 2 }),
  isVerified: boolean('is_verified').default(false),
  isPro: boolean('is_pro').default(false),
  phone: varchar('phone', { length: 20 }),
  whatsapp: varchar('whatsapp', { length: 20 }),
  hourlyRateTnd: numeric('hourly_rate_tnd', { precision: 12, scale: 3 }),
  squareMeterRateTnd: numeric('square_meter_rate_tnd', { precision: 12, scale: 3 }),
  services: jsonb('services').default('[]'),
  badges: jsonb('badges').default('[]'),
  bio: text('bio'),
  avatarUrl: text('avatar_url'),
  isDeleted: boolean('is_deleted').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const syncOperations = pgTable('sync_operations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  clientId: varchar('client_id', { length: 100 }),
  entityType: varchar('entity_type', { length: 30 }).notNull(),
  entityId: varchar('entity_id', { length: 100 }).notNull(),
  operationType: varchar('operation_type', { length: 20 }).notNull(),
  clientVersion: integer('client_version'),
  serverVersion: integer('server_version'),
  clientTimestamp: timestamp('client_timestamp', { withTimezone: true }),
  serverTimestamp: timestamp('server_timestamp', { withTimezone: true }).defaultNow(),
  syncStatus: varchar('sync_status', { length: 20 }).default('pending'),
  payload: jsonb('payload'),
}, (table) => ({
  idxUser: index('idx_sync_user').on(table.userId),
  idxEntity: index('idx_sync_entity').on(table.entityType, table.entityId),
}));

export const idempotencyKeys = pgTable('idempotency_keys', {
  key: varchar('key', { length: 255 }).primaryKey(),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: uuid('entity_id').notNull(),
  responseSnapshot: jsonb('response_snapshot'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * projects (Chantiers) — construction/renovation projects
 * Links to company and manager (user).
 * phases, logs, team stored as JSONB snapshots.
 */
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  managerUserId: uuid('manager_user_id').references(() => users.id),
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  clientName: varchar('client_name', { length: 200 }),
  clientPhone: varchar('client_phone', { length: 20 }),
  address: text('address'),
  region: varchar('region', { length: 100 }),
  country: varchar('country', { length: 5 }).notNull().default('TN'),
  currency: varchar('currency', { length: 5 }).notNull().default('TND'),
  type: varchar('type', { length: 30 }).notNull().default('residentiel'),
  status: varchar('status', { length: 30 }).notNull().default('planification'),
  progressPercent: numeric('progress_percent', { precision: 5, scale: 2 }).notNull().default('0'),
  budgetTotalHt: numeric('budget_total_ht', { precision: 15, scale: 3 }),
  depensesActuellesHt: numeric('depenses_actuelles_ht', { precision: 15, scale: 3 }).notNull().default('0'),
  startDate: timestamp('start_date', { withTimezone: true }),
  targetEndDate: timestamp('target_end_date', { withTimezone: true }),
  phases: jsonb('phases').notNull().default('[]'),
  logs: jsonb('logs').notNull().default('[]'),
  team: jsonb('team').notNull().default('[]'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
  isDeleted: boolean('is_deleted').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  idxCompany: index('idx_projects_company').on(table.companyId),
  idxManager: index('idx_projects_manager').on(table.managerUserId),
  idxStatus: index('idx_projects_status').on(table.status),
  idxDeleted: index('idx_projects_deleted').on(table.isDeleted),
}));
