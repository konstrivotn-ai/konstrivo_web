// @ts-nocheck
/**
 * Phase 3 — Drizzle Schema: users & companies & memberships & subscriptions
 * Requires: npm install drizzle-orm postgres
 */
import { pgTable, uuid, varchar, text, boolean, integer, timestamp, jsonb, uniqueIndex, index, numeric } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 254 }).notNull().unique(),
  phone: varchar('phone', { length: 20 }),
  fullName: varchar('full_name', { length: 200 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  globalRole: varchar('global_role', { length: 30 }).notNull().default('artisan'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  avatarUrl: text('avatar_url'),
  preferredLang: varchar('preferred_lang', { length: 10 }).default('fr'),
  region: varchar('region', { length: 100 }),
  country: varchar('country', { length: 5 }).default('TN'),
  licenseNumber: varchar('license_number', { length: 50 }),
  matriculeFiscale: varchar('matricule_fiscale', { length: 30 }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
  isDeleted: boolean('is_deleted').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  idxUsersEmail: index('idx_users_email').on(table.email),
}));

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  legalName: varchar('legal_name', { length: 255 }).notNull(),
  tradeName: varchar('trade_name', { length: 255 }),
  countryCode: varchar('country_code', { length: 5 }).notNull().default('TN'),
  currencyCode: varchar('currency_code', { length: 5 }).notNull().default('TND'),
  taxId: varchar('tax_id_matricule_fiscal', { length: 50 }),
  commercialRegisterRc: varchar('commercial_register_rc', { length: 50 }),
  logoUrl: text('logo_url'),
  addressStreet: text('address_street'),
  addressCity: varchar('address_city', { length: 100 }),
  addressPostalCode: varchar('address_postal_code', { length: 10 }),
  bankRib: varchar('bank_rib', { length: 50 }),
  websiteUrl: text('website_url'),
  phone: varchar('phone', { length: 20 }),
  email: varchar('email', { length: 254 }),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
  isDeleted: boolean('is_deleted').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const companyMembers = pgTable('company_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  role: varchar('role', { length: 30 }).notNull().default('artisan'),
  tier: varchar('tier', { length: 20 }).notNull().default('FREE'),
  entitlements: jsonb('entitlements').notNull().default('[]'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
  isDeleted: boolean('is_deleted').notNull().default(false),
}, (table) => ({
  uqMember: uniqueIndex('uq_company_member').on(table.userId, table.companyId),
  idxMembersUser: index('idx_members_user').on(table.userId),
  idxMembersCompany: index('idx_members_company').on(table.companyId),
}));

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  tier: varchar('tier', { length: 20 }).notNull().default('FREE'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull().defaultNow(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  paymentMethodId: varchar('payment_method_id', { length: 100 }),
  discountCode: varchar('discount_code', { length: 50 }),
  provider: varchar('provider', { length: 50 }).notNull().default('manual'),
  providerSubscriptionId: varchar('provider_subscription_id', { length: 255 }),
  priceId: varchar('price_id', { length: 100 }),
  currency: varchar('currency', { length: 5 }).notNull().default('TND'),
  amount: numeric('amount', { precision: 12, scale: 2 }),
  renewalType: varchar('renewal_type', { length: 20 }).notNull().default('manual'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
}, (table) => ({
  idxSubscriptionsCompany: index('idx_subscriptions_company').on(table.companyId),
}));
