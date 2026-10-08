/**
 * Phase 1.1 — User Repository (PostgreSQL + MemoryStore fallback)
 * 
 * Uses Drizzle/PostgreSQL when DATABASE_URL is configured.
 * Falls back to MemoryStore for development without database.
 */
import { memoryStore } from './store';
import { User, UserStatus } from '../types';
import { generateId } from '../utils/crypto';
import { drizzleUserRepository } from './drizzleUserRepository';
import { isDatabaseAvailable } from '../db/client';

const COLLECTION = 'users';

export interface IUserRepository {
  findByEmail(email: string): User | undefined | Promise<User | undefined>;
  findById(id: string): User | undefined | Promise<User | undefined>;
  findByEmailIncludingDeleted(email: string): User | undefined | Promise<User | undefined>;
  create(data: Omit<User, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'isDeleted'>): User | Promise<User>;
  update(id: string, patch: Partial<User>): User | Promise<User>;
  softDelete(id: string): void | Promise<void>;
  setStatus(id: string, status: UserStatus): void | Promise<void>;
}

class MemoryUserRepository implements IUserRepository {
  private get map() {
    return memoryStore.getCollection(COLLECTION, `server/data/${COLLECTION}.json`);
  }

  findByEmail(email: string): User | undefined {
    const normalized = email.toLowerCase().trim();
    for (const u of this.map.values()) {
      if (u.email === normalized && !u.isDeleted) return u as User;
    }
    return undefined;
  }

  findByEmailIncludingDeleted(email: string): User | undefined {
    const normalized = email.toLowerCase().trim();
    for (const u of this.map.values()) {
      if (u.email === normalized) return u as User;
    }
    return undefined;
  }

  findById(id: string): User | undefined {
    const u = this.map.get(id);
    if (!u || u.isDeleted) return undefined;
    return u as User;
  }

  create(data: Omit<User, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'isDeleted'>): User {
    const now = new Date().toISOString();
    const user: User = {
      ...data,
      email: data.email.toLowerCase().trim(),
      id: generateId(),
      createdAt: now,
      updatedAt: now,
      version: 1,
      isDeleted: false,
    };
    this.map.set(user.id, user);
    memoryStore.saveCollection(COLLECTION);
    return user;
  }

  update(id: string, patch: Partial<User>): User {
    const existing = this.map.get(id) as User;
    if (!existing) throw new Error('User not found');
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString(), version: existing.version + 1 };
    this.map.set(id, updated);
    memoryStore.saveCollection(COLLECTION);
    return updated;
  }

  softDelete(id: string): void {
    const existing = this.map.get(id) as User;
    if (!existing) return;
    existing.isDeleted = true;
    existing.deletedAt = new Date().toISOString();
    existing.updatedAt = new Date().toISOString();
    this.map.set(id, existing);
    memoryStore.saveCollection(COLLECTION);
  }

  setStatus(id: string, status: UserStatus): void {
    const existing = this.map.get(id) as User;
    if (!existing) return;
    existing.status = status;
    existing.updatedAt = new Date().toISOString();
    this.map.set(id, existing);
    memoryStore.saveCollection(COLLECTION);
  }
}

/**
 * Hybrid repository that uses PostgreSQL when available, MemoryStore otherwise.
 * All methods are async-compatible to support both backends.
 */
class HybridUserRepository implements IUserRepository {
  private memoryRepo = new MemoryUserRepository();
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

  async findByEmail(email: string): Promise<User | undefined> {
    await this.init();
    if (this.usePostgres) {
      return drizzleUserRepository.findByEmail(email);
    }
    return this.memoryRepo.findByEmail(email);
  }

  async findById(id: string): Promise<User | undefined> {
    await this.init();
    if (this.usePostgres) {
      return drizzleUserRepository.findById(id);
    }
    return this.memoryRepo.findById(id);
  }

  async findByEmailIncludingDeleted(email: string): Promise<User | undefined> {
    await this.init();
    if (this.usePostgres) {
      return drizzleUserRepository.findByEmailIncludingDeleted(email);
    }
    return this.memoryRepo.findByEmailIncludingDeleted(email);
  }

  async create(data: Omit<User, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'isDeleted'>): Promise<User> {
    await this.init();
    if (this.usePostgres) {
      return drizzleUserRepository.create(data);
    }
    return this.memoryRepo.create(data);
  }

  async update(id: string, patch: Partial<User>): Promise<User> {
    await this.init();
    if (this.usePostgres) {
      return drizzleUserRepository.update(id, patch);
    }
    return this.memoryRepo.update(id, patch);
  }

  async softDelete(id: string): Promise<void> {
    await this.init();
    if (this.usePostgres) {
      return drizzleUserRepository.softDelete(id);
    }
    this.memoryRepo.softDelete(id);
  }

  async setStatus(id: string, status: UserStatus): Promise<void> {
    await this.init();
    if (this.usePostgres) {
      return drizzleUserRepository.setStatus(id, status);
    }
    this.memoryRepo.setStatus(id, status);
  }
}

export const userRepository: IUserRepository = new HybridUserRepository();
