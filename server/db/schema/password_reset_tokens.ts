// @ts-nocheck
import { pgTable, uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './identity';

export const password_reset_tokens = pgTable('password_reset_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  usedAt: timestamp('used_at', { withTimezone: true }),
}, (table) => ({
  uqTokenHash: uniqueIndex('uq_password_reset_tokens_token_hash').on(table.tokenHash),
  idxUser: index('idx_password_reset_tokens_user_id').on(table.userId),
  idxExpires: index('idx_password_reset_tokens_expires_at').on(table.expiresAt),
}));
