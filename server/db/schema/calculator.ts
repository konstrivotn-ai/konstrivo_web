// @ts-nocheck
/**
 * Phase 2 — Calculator integration layer (ADDITIVE ONLY)
 *
 * Independent from the current formula engine: this adds a rule/config layer
 * that can resolve imported canonical materials to calculator slots without
 * modifying any formula or labor/waste logic already in place.
 */
import { pgTable, uuid, varchar, text, boolean, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { materials } from './catalog';

export const calcSlots = pgTable('calc_slots', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 80 }).notNull(),
  label: varchar('label', { length: 120 }).notNull(),
  trade: varchar('trade', { length: 50 }).notNull(),
  materialKey: varchar('material_key', { length: 120 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uqCalcSlotCode: uniqueIndex('uq_calc_slot_code').on(table.code),
  idxCalcSlotsTrade: index('idx_calc_slots_trade').on(table.trade),
}));

export const calcRules = pgTable('calc_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 80 }).notNull(),
  slotCode: varchar('slot_code', { length: 80 }).notNull(),
  trade: varchar('trade', { length: 50 }).notNull(),
  legacyKey: varchar('legacy_key', { length: 120 }),
  materialCode: varchar('material_code', { length: 120 }),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uqCalcRuleCode: uniqueIndex('uq_calc_rule_code').on(table.code),
  idxCalcRulesTrade: index('idx_calc_rules_trade').on(table.trade),
  idxCalcRulesSlot: index('idx_calc_rules_slot').on(table.slotCode),
}));

export const materialCalcLinks = pgTable('material_calc_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  materialId: uuid('material_id').notNull().references(() => materials.id, { onDelete: 'cascade' }),
  slotCode: varchar('slot_code', { length: 80 }).notNull(),
  ruleCode: varchar('rule_code', { length: 80 }),
  matchKey: varchar('match_key', { length: 120 }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uqMaterialCalcLink: uniqueIndex('uq_material_calc_link').on(table.materialId, table.matchKey),
  idxMaterialCalcLinksSlot: index('idx_material_calc_links_slot').on(table.slotCode),
  idxMaterialCalcLinksRule: index('idx_material_calc_links_rule').on(table.ruleCode),
}));
