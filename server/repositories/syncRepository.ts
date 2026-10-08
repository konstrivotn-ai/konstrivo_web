/**
 * Phase 2 — Sync Repository
 *
 * Foundation for pull/push synchronization.
 * Push is idempotent; stale versions return conflict.
 */
import { memoryStore } from './store';
import { SyncEntry, EntityType, OperationType } from '../types';
import { generateId } from '../utils/crypto';
import { config } from '../config';
import { isDatabaseAvailable } from '../db/client';
import * as drizzleRepo from './drizzleSyncRepository';

const COLLECTION = 'sync_operations';

export interface PushOperation {
  id: string;
  entityType: EntityType;
  entityId: string;
  operationType: OperationType;
  clientVersion: number;
  clientTimestamp: string;
  payload: any;
}

export interface PullFilter {
  since?: string;
  entityTypes?: EntityType[];
}

export interface ISyncRepository {
  /** Idempotent push: same operation id returns the stored result. */
  push(userId: string, clientId: string, ops: PushOperation[]): Promise<{ applied: SyncEntry[]; conflicts: SyncEntry[] }>|{ applied: SyncEntry[]; conflicts: SyncEntry[] };
  pull(filter: PullFilter): Promise<SyncEntry[]>|SyncEntry[];
  findByEntity(entityType: EntityType, entityId: string): Promise<SyncEntry | undefined>|SyncEntry | undefined;
}

class MemorySyncRepository implements ISyncRepository {
  private get map() {
    return memoryStore.getCollection(COLLECTION, `server/data/${COLLECTION}.json`);
  }

  /**
   * Push operations. Idempotent by operation id:
   * if an op with the same id exists and was already applied, skip it.
   */
  push(userId: string, _clientId: string, ops: PushOperation[]) {
    if (config.isProduction) {
      throw new Error('[KONSTRIVO] Sync repository: in-memory sync is not allowed in production. Implement Drizzle/Postgres-backed sync.');
    }
    const applied: SyncEntry[] = [];
    const conflicts: SyncEntry[] = [];
    const now = new Date().toISOString();

    for (const op of ops) {
      // Check idempotency: does this operation already exist?
      const existingOpKey = `op_${op.id}`;
      const existing = this.map.get(existingOpKey);
      if (existing && !(existing as SyncEntry).isDeleted) {
        // Already applied — return as-is (idempotency)
        applied.push(existing as SyncEntry);
        continue;
      }

      // Check version conflict
      const currentEntity = this.findByEntity(op.entityType, op.entityId);
      if (currentEntity && currentEntity.serverVersion > op.clientVersion) {
        // Stale version → conflict
        const conflictEntry: SyncEntry = {
          id: existingOpKey,
          entityType: op.entityType,
          entityId: op.entityId,
          operationType: op.operationType,
          clientVersion: op.clientVersion,
          serverVersion: currentEntity.serverVersion,
          clientTimestamp: op.clientTimestamp,
          serverTimestamp: now,
          syncStatus: 'conflict',
          payload: JSON.stringify(op.payload),
          isDeleted: false,
        };
        this.map.set(existingOpKey, conflictEntry);
        conflicts.push(conflictEntry);
        continue;
      }

      const entry: SyncEntry = {
        id: existingOpKey,
        entityType: op.entityType,
        entityId: op.entityId,
        operationType: op.operationType,
        clientVersion: op.clientVersion,
        serverVersion: op.clientVersion + 1,
        clientTimestamp: op.clientTimestamp,
        serverTimestamp: now,
        syncStatus: 'applied',
        payload: JSON.stringify(op.payload),
        isDeleted: false,
      };
      this.map.set(existingOpKey, entry);
      applied.push(entry);
    }

    memoryStore.saveCollection(COLLECTION);
    return { applied, conflicts };
  }

  pull(filter: PullFilter): SyncEntry[] {
    const all = Array.from(this.map.values()) as SyncEntry[];
    let filtered = all.filter(s => !s.isDeleted);

    if (filter.since) {
      filtered = filtered.filter(s => s.serverTimestamp > filter.since!);
    }
    if (filter.entityTypes && filter.entityTypes.length > 0) {
      filtered = filtered.filter(s => filter.entityTypes!.includes(s.entityType));
    }

    return filtered.sort((a, b) => a.serverTimestamp.localeCompare(b.serverTimestamp));
  }

  findByEntity(entityType: EntityType, entityId: string): SyncEntry | undefined {
    let latest: SyncEntry | undefined;
    for (const s of this.map.values()) {
      const entry = s as SyncEntry;
      if (entry.entityType === entityType && entry.entityId === entityId && !entry.isDeleted) {
        if (!latest || entry.serverTimestamp > latest.serverTimestamp) {
          latest = entry;
        }
      }
    }
    return latest;
  }
}

class HybridSyncRepository implements ISyncRepository {
  private memory = new MemorySyncRepository();
  async push(userId: string, clientId: string, ops: PushOperation[]) { if (await isDatabaseAvailable()) return await drizzleRepo.pushSync(userId, clientId, ops); return this.memory.push(userId, clientId, ops); }
  async pull(filter: PullFilter) { if (await isDatabaseAvailable()) return await drizzleRepo.pullSync(filter); return this.memory.pull(filter); }
  async findByEntity(entityType: EntityType, entityId: string) { if (await isDatabaseAvailable()) return await drizzleRepo.findSyncByEntity(entityType, entityId); return this.memory.findByEntity(entityType, entityId); }
}

export const syncRepository: ISyncRepository = new HybridSyncRepository();
