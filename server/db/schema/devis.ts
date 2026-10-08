// @ts-nocheck
/**
 * Phase 3 — Drizzle Schema: devis & devis_items
 * DevisItem preserves a PRICE SNAPSHOT — future price changes never alter existing quotes.
 */
import { pgTable, uuid, varchar, text, boolean, integer, numeric, timestamp, date, index } from 'drizzle-orm/pg-core';
import { users, companies } from './identity';
import { materials } from './catalog';

export const devis = pgTable('devis', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id),
  devisNumber: varchar('devis_number', { length: 50 }).notNull(),
  reference: varchar('reference', { length: 50 }),
  date: date('date'),
  clientName: varchar('client_name', { length: 200 }),
  clientPhone: varchar('client_phone', { length: 20 }),
  clientAddress: text('client_address'),
  projectTitle: varchar('project_title', { length: 200 }),
  country: varchar('country', { length: 5 }).default('TN'),
  currency: varchar('currency', { length: 5 }).default('TND'),
  region: varchar('region', { length: 100 }),
  surfaceAreaM2: numeric('surface_area_m2', { precision: 12, scale: 3 }),
  perimeterLinearM: numeric('perimeter_linear_m', { precision: 12, scale: 3 }),
  wasteMarginPercent: numeric('waste_margin_percent', { precision: 5, scale: 2 }),
  totalMaterialsCostTnd: numeric('total_materials_cost_tnd', { precision: 12, scale: 3 }),
  totalLaborCostTnd: numeric('total_labor_cost_tnd', { precision: 12, scale: 3 }),
  subtotalBeforeTaxTnd: numeric('subtotal_before_tax_tnd', { precision: 12, scale: 3 }),
  taxRatePercent: numeric('tax_rate_percent', { precision: 5, scale: 2 }),
  taxAmountTnd: numeric('tax_amount_tnd', { precision: 12, scale: 3 }),
  grandTotalTnd: numeric('grand_total_tnd', { precision: 12, scale: 3 }),
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  syncState: varchar('sync_state', { length: 20 }).default('SYNCED'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
  isDeleted: boolean('is_deleted').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  idxCompanyStatus: index('idx_devis_company_status').on(table.companyId, table.status),
  idxDevisCreatedBy: index('idx_devis_created_by').on(table.createdByUserId),
}));

export const devisItems = pgTable('devis_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  devisId: uuid('devis_id').notNull().references(() => devis.id),
  lineNumber: integer('line_number').notNull().default(1),
  materialId: uuid('material_id').references(() => materials.id),
  trade: varchar('trade', { length: 50 }),
  title: text('title'),
  descriptionSnapshot: text('description_snapshot'),
  unit: varchar('unit', { length: 20 }),
  exactCalculatedQuantity: numeric('exact_calculated_quantity', { precision: 12, scale: 3 }).default('0'),
  wasteIncludedQuantity: numeric('waste_included_quantity', { precision: 12, scale: 3 }).default('0'),
  billableQuantity: numeric('billable_quantity', { precision: 12, scale: 3 }).default('0'),
  unitPriceAppliedTnd: numeric('unit_price_applied_tnd', { precision: 12, scale: 3 }).notNull().default('0'),
  totalPriceTnd: numeric('total_price_tnd', { precision: 12, scale: 3 }).notNull().default('0'),
  isCustomAdded: boolean('is_custom_added').notNull().default(false),
  packageDetailsSnapshot: text('package_details_snapshot'),
  supplierReference: varchar('supplier_reference', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
}, (table) => ({
  idxDevis: index('idx_devis_items_devis').on(table.devisId),
}));
