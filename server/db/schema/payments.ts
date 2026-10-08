/** Phase E — Payment Transactions Schema
 * Transactions only; voucher redemption and provider-specific flows are
 * prepared in the payment service layer, not here.
 */
import { pgTable, uuid, varchar, numeric, integer, text, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies } from './identity';

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  provider: varchar('provider', { length: 50 }).notNull().default('manual'),
  providerPaymentId: varchar('provider_payment_id', { length: 255 }),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull().default('0'),
  currency: varchar('currency', { length: 5 }).notNull().default('TND'),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  paymentType: varchar('payment_type', { length: 30 }).notNull().default('manual'),
  subscriptionId: uuid('subscription_id'),
  invoiceNumber: varchar('invoice_number', { length: 50 }),
  metadata: jsonb('metadata').notNull().default(sql`'[]'::jsonb`),
  retryCount: integer('retry_count').notNull().default(0),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
}, (table) => ({
  idxPaymentsCompany: index('idx_payments_company').on(table.companyId),
  idxPaymentsProvider: index('idx_payments_provider').on(table.provider),
  uqProviderPaymentId: uniqueIndex('uq_payments_provider_payment_id').on(table.provider, table.providerPaymentId),
}));
