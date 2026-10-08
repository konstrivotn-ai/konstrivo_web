// @ts-nocheck
import { eq, lt } from 'drizzle-orm';
import { memoryStore } from './store';
import { generateId } from '../utils/crypto';
import { getDatabase, isDatabaseAvailable } from '../db/client';
import { password_reset_tokens } from '../db/schema';

const COLLECTION = 'password_reset_tokens';

export interface PasswordResetRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string; // ISO
  createdAt: string; // ISO
  usedAt?: string | null; // ISO
}

export interface IPasswordResetRepository {
  create(data: { userId: string; tokenHash: string; expiresAt: string }): Promise<PasswordResetRecord>;
  findByTokenHash(tokenHash: string): Promise<PasswordResetRecord | undefined>;
  markUsed(id: string): Promise<void>;
  cleanupExpired(beforeIso: string): Promise<number>;
}

class MemoryPasswordResetRepository implements IPasswordResetRepository {
  private get map() {
    return memoryStore.getCollection(COLLECTION, `server/data/${COLLECTION}.json`);
  }

  async create(data: { userId: string; tokenHash: string; expiresAt: string }): Promise<PasswordResetRecord> {
    // enforce uniqueness in-memory to mirror DB unique constraint
    for (const v of this.map.values()) {
      if (v.tokenHash === data.tokenHash) throw new Error('Duplicate token_hash');
    }
    const id = generateId();
    const now = new Date().toISOString();
    const rec: PasswordResetRecord = {
      id,
      userId: data.userId,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      createdAt: now,
      usedAt: null,
    } as any;
    this.map.set(id, rec);
    memoryStore.saveCollection(COLLECTION);
    return rec;
  }

  async findByTokenHash(tokenHash: string): Promise<PasswordResetRecord | undefined> {
    for (const v of this.map.values()) {
      if (v.tokenHash === tokenHash) return v as PasswordResetRecord;
    }
    return undefined;
  }

  async markUsed(id: string): Promise<void> {
    const rec = this.map.get(id);
    if (!rec) throw new Error('Not found');
    rec.usedAt = new Date().toISOString();
    this.map.set(id, rec);
    memoryStore.saveCollection(COLLECTION);
  }

  async cleanupExpired(beforeIso: string): Promise<number> {
    const toDelete: string[] = [];
    for (const [k, v] of this.map.entries()) {
      if (v.expiresAt <= beforeIso) toDelete.push(k);
    }
    for (const k of toDelete) this.map.delete(k);
    if (toDelete.length > 0) memoryStore.saveCollection(COLLECTION);
    return toDelete.length;
  }
}

class DrizzlePasswordResetRepository implements IPasswordResetRepository {
  async create(data: { userId: string; tokenHash: string; expiresAt: string }): Promise<PasswordResetRecord> {
    const db = await getDatabase();
    if (!db) throw new Error('Postgres not available');
    const [row] = await db.insert(password_reset_tokens).values({
      userId: data.userId,
      tokenHash: data.tokenHash,
      expiresAt: new Date(data.expiresAt),
    }).returning();

    // Drizzle returns rows using the schema field names (camelCase). Map consistently.
    return {
      id: row?.id,
      userId: row?.userId || row?.user_id,
      tokenHash: row?.tokenHash || row?.token_hash,
      expiresAt: row?.expiresAt ? row.expiresAt.toISOString() : (row?.expires_at ? row.expires_at.toISOString() : undefined),
      createdAt: row?.createdAt ? row.createdAt.toISOString() : (row?.created_at ? row.created_at.toISOString() : undefined),
      usedAt: row?.usedAt ? row.usedAt.toISOString() : (row?.used_at ? row.used_at.toISOString() : null),
    } as PasswordResetRecord;
  }

  async findByTokenHash(tokenHash: string): Promise<PasswordResetRecord | undefined> {
    const db = await getDatabase();
    if (!db) throw new Error('Postgres not available');
    const rows = await db.select().from(password_reset_tokens).where(eq(password_reset_tokens.tokenHash, tokenHash)).limit(1);
    if (!rows[0]) return undefined;
    const r = rows[0];
    return {
      id: r.id,
      userId: r.userId || r.user_id,
      tokenHash: r.tokenHash || r.token_hash,
      expiresAt: r.expiresAt?.toISOString() || r.expires_at?.toISOString(),
      createdAt: r.createdAt?.toISOString() || r.created_at?.toISOString(),
      usedAt: r.usedAt ? r.usedAt.toISOString() : (r.used_at ? r.used_at.toISOString() : null),
    } as PasswordResetRecord;
  }

  async markUsed(id: string): Promise<void> {
    const db = await getDatabase();
    if (!db) throw new Error('Postgres not available');
    await db.update(password_reset_tokens).set({ usedAt: new Date() }).where(eq(password_reset_tokens.id, id));
  }

  async cleanupExpired(beforeIso: string): Promise<number> {
    const db = await getDatabase();
    if (!db) throw new Error('Postgres not available');
    const res = await db.delete(password_reset_tokens).where(lt(password_reset_tokens.expiresAt, new Date(beforeIso))).returning();
    return res.length || 0;
  }
}

class HybridPasswordResetRepository implements IPasswordResetRepository {
  private memory = new MemoryPasswordResetRepository();
  private usePostgres = false;
  private initialized = false;

  private async init() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      this.usePostgres = await isDatabaseAvailable();
    } catch {
      this.usePostgres = false;
    }
  }

  async create(data: { userId: string; tokenHash: string; expiresAt: string }) {
    await this.init();
    if (this.usePostgres) {
      const drizzleRepo = new DrizzlePasswordResetRepository();
      return drizzleRepo.create(data);
    }
    return this.memory.create(data);
  }

  async findByTokenHash(tokenHash: string) {
    await this.init();
    if (this.usePostgres) {
      const drizzleRepo = new DrizzlePasswordResetRepository();
      return drizzleRepo.findByTokenHash(tokenHash);
    }
    return this.memory.findByTokenHash(tokenHash);
  }

  async markUsed(id: string) {
    await this.init();
    if (this.usePostgres) {
      const drizzleRepo = new DrizzlePasswordResetRepository();
      return drizzleRepo.markUsed(id);
    }
    return this.memory.markUsed(id);
  }

  async cleanupExpired(beforeIso: string) {
    await this.init();
    if (this.usePostgres) {
      const drizzleRepo = new DrizzlePasswordResetRepository();
      return drizzleRepo.cleanupExpired(beforeIso);
    }
    return this.memory.cleanupExpired(beforeIso);
  }
}

export const passwordResetRepository: IPasswordResetRepository = new HybridPasswordResetRepository();
