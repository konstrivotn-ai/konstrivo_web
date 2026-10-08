/**
 * Phase 3 — Subscription Repository (Drizzle + MemoryStore fallback)
 *
 * Uses Drizzle/PostgreSQL when DATABASE_URL is configured.
 * Falls back to MemoryStore for development without database.
 */
import { memoryStore } from './store';
import { Subscription, UserTier } from '../types';
import { generateId } from '../utils/crypto';
import { config } from '../config';
import * as drizzleRepo from './drizzleSubscriptionsRepository';

const COLLECTION = 'subscriptions';

export interface ISubscriptionRepository {
  findByCompanyId(companyId: string): Subscription | undefined;
  findById(id: string): Subscription | undefined;
  create(companyId: string, tier: UserTier): Subscription;
  update(id: string, patch: Partial<Subscription>): Subscription;
}

class MemorySubscriptionRepository implements ISubscriptionRepository {
  private get map() {
    return memoryStore.getCollection(COLLECTION, `server/data/${COLLECTION}.json`);
  }

  findByCompanyId(companyId: string): Subscription | undefined {
    for (const s of this.map.values()) {
      if ((s as Subscription).companyId === companyId) return s as Subscription;
    }
    return undefined;
  }

  findById(id: string): Subscription | undefined {
    return this.map.get(id) as Subscription | undefined;
  }

  create(companyId: string, tier: UserTier): Subscription {
    const now = new Date();
    const periodEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const sub: Subscription = {
      id: generateId(),
      companyId,
      tier,
      status: 'active',
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: periodEnd.toISOString(),
      cancelAtPeriodEnd: false,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      version: 1,
    };
    // Replace existing subscription for this company
    for (const [key, val] of this.map.entries()) {
      if ((val as Subscription).companyId === companyId) {
        this.map.delete(key);
      }
    }
    this.map.set(sub.id, sub);
    memoryStore.saveCollection(COLLECTION);
    return sub;
  }

  update(id: string, patch: Partial<Subscription>): Subscription {
    const existing = this.map.get(id) as Subscription;
    if (!existing) throw new Error('Subscription not found');
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString(), version: existing.version + 1 };
    this.map.set(id, updated);
    memoryStore.saveCollection(COLLECTION);
    return updated;
  }
}

/**
 * Hybrid repository that uses PostgreSQL when available, MemoryStore otherwise.
 * NOTE: Memory-backed in production is not allowed. Use subscriptionRepositoryAsync for Drizzle access.
 */
export class HybridSubscriptionRepository implements ISubscriptionRepository {
  private memoryRepo = new MemorySubscriptionRepository();

  findByCompanyId(companyId: string): Subscription | undefined {
    if (config.databaseUrl && config.isProduction) {
      throw new Error('[KONSTRIVO] Subscription repository: in-memory repository is not allowed in production. Use subscriptionRepositoryAsync for Drizzle access.');
    }
    return this.memoryRepo.findByCompanyId(companyId);
  }

  findById(id: string): Subscription | undefined {
    if (config.databaseUrl && config.isProduction) {
      throw new Error('[KONSTRIVO] Subscription repository: in-memory repository is not allowed in production. Use subscriptionRepositoryAsync for Drizzle access.');
    }
    return this.memoryRepo.findById(id);
  }

  create(companyId: string, tier: UserTier): Subscription {
    if (config.databaseUrl && config.isProduction) {
      throw new Error('[KONSTRIVO] Subscription repository: in-memory repository is not allowed in production. Use subscriptionRepositoryAsync for Drizzle access.');
    }
    return this.memoryRepo.create(companyId, tier);
  }

  update(id: string, patch: Partial<Subscription>): Subscription {
    if (config.databaseUrl && config.isProduction) {
      throw new Error('[KONSTRIVO] Subscription repository: in-memory repository is not allowed in production. Use subscriptionRepositoryAsync for Drizzle access.');
    }
    return this.memoryRepo.update(id, patch);
  }
}

/**
 * Async variants for Drizzle usage in production.
 * Use these in middleware/routes where async is available.
 */
export const subscriptionRepositoryAsync = {
  findByCompanyId: drizzleRepo.findSubscriptionByCompanyId,
  findById: drizzleRepo.findSubscriptionById,
  create: drizzleRepo.createSubscription,
  update: drizzleRepo.updateSubscription,
};

export const subscriptionRepository: ISubscriptionRepository = new HybridSubscriptionRepository();
