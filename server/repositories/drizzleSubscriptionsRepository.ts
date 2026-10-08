/**
 * Phase 3 — Drizzle Subscriptions Repository
 * Production-ready PostgreSQL backend for subscriptions
 */
import { getDatabase } from '../db/client';
import { subscriptions } from '../db/schema';
import { eq } from 'drizzle-orm';
import { Subscription, UserTier } from '../types';

export async function findSubscriptionById(id: string): Promise<Subscription | undefined> {
  const db = await getDatabase();
  if (!db) return undefined;
  const s = await db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
  if (!s || s.length === 0) return undefined;
  return s[0] as Subscription;
}

export async function findSubscriptionByCompanyId(companyId: string): Promise<Subscription | undefined> {
  const db = await getDatabase();
  if (!db) return undefined;
  const s = await db.select().from(subscriptions).where(eq(subscriptions.companyId, companyId)).limit(1);
  if (!s || s.length === 0) return undefined;
  return s[0] as Subscription;
}

export async function createSubscription(
  companyId: string,
  tier: UserTier
): Promise<Subscription> {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');

  const now = new Date();
  const periodEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  const [inserted] = await db.insert(subscriptions).values({
    companyId,
    tier,
    status: 'active',
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: false,
    createdAt: now,
    updatedAt: now,
    version: 1,
  }).returning();

  return inserted as Subscription;
}

export async function updateSubscription(
  id: string,
  patch: Partial<Subscription>,
  expectedVersion?: number
): Promise<Subscription> {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');

  const existing = await db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
  if (!existing || existing.length === 0) throw new Error('Subscription not found');

  const cur = existing[0];
  if (expectedVersion !== undefined && Number(expectedVersion) !== Number(cur.version)) {
    const err: any = new Error(`Version conflict: expected ${expectedVersion}, server has ${cur.version}`);
    err.statusCode = 409;
    err.code = 'CONFLICT';
    throw err;
  }

  const [updated] = await db.update(subscriptions)
    .set({
      ...patch,
      updatedAt: new Date(),
      version: (cur.version || 1) + 1,
    })
    .where(eq(subscriptions.id, id))
    .returning();

  return updated as Subscription;
}
