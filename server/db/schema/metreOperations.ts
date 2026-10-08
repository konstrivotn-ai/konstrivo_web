// @ts-nocheck
import { pgTable, uuid, varchar, text, integer, timestamp, numeric, jsonb, index } from 'drizzle-orm/pg-core';
import { projects } from './operations';

export const projectZones = pgTable('project_zones', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 150 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxProject: index('idx_project_zones_project').on(table.projectId),
}));

export const projectOuvrages = pgTable('project_ouvrages', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  zoneId: uuid('zone_id').references(() => projectZones.id, { onDelete: 'set null' }),
  tradeCode: varchar('trade_code', { length: 50 }).notNull(),
  metreElementCode: varchar('metre_element_code', { length: 100 }).notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  specVersion: integer('spec_version').notNull().default(1),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxProject: index('idx_project_ouvrages_project').on(table.projectId),
  idxZone: index('idx_project_ouvrages_zone').on(table.zoneId),
}));

export const releves = pgTable('releves', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  zoneId: uuid('zone_id').references(() => projectZones.id, { onDelete: 'set null' }),
  ouvrageId: uuid('ouvrage_id').notNull().references(() => projectOuvrages.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 30 }).notNull().default('draft'),
  specVersion: integer('spec_version').notNull().default(1),
  wasteOverridePercent: numeric('waste_override_percent', { precision: 6, scale: 3 }),
  layersOverride: integer('layers_override'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxProject: index('idx_releves_project').on(table.projectId),
  idxOuvrage: index('idx_releves_ouvrage').on(table.ouvrageId),
}));

export const releveLines = pgTable('releve_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  releveId: uuid('releve_id').notNull().references(() => releves.id, { onDelete: 'cascade' }),
  lineNo: integer('line_no').notNull().default(0),
  dims: jsonb('dims').notNull().default('{}'),
  openings: jsonb('openings'),
  deductions: jsonb('deductions'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idxReleve: index('idx_releve_lines_releve').on(table.releveId),
}));
