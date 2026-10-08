/**
 * Phase 2 — Projects Repository (memory-backed)
 *
 * Minimal CRUD to unify frontend <-> backend for Projects/Chantiers
 * Stored in `server/data/projects.json` using the shared MemoryStore.
 */
import path from 'path';
import { memoryStore } from './store';
import { generateId } from '../utils/crypto';
import { PaginatedResult } from '../types';
import { config } from '../config';

const COLLECTION = 'projects';

export interface ProjectFilters {
  search?: string;
  region?: string;
  page?: number;
  limit?: number;
}

export interface IProjectsRepository {
  ensureReady(): void;
  list(filters: ProjectFilters): PaginatedResult<any>;
  findById(id: string): any | undefined;
  create(input: any): any;
  update(id: string, patch: any): any;
  softDelete(id: string): void;
}

class MemoryProjectsRepository implements IProjectsRepository {
  private get map() {
    return memoryStore.getCollection(COLLECTION, path.join(process.cwd(), 'server', 'data', `${COLLECTION}.json`));
  }

  ensureReady(): void {
    if (config.isProduction) {
      throw new Error('[KONSTRIVO] Projects repository: in-memory repository is not allowed in production. Implement Drizzle/Postgres repository.');
    }
    // no-op for now; collection is lazily loaded by memoryStore
    this.map;
  }

  list(filters: ProjectFilters): PaginatedResult<any> {
    this.ensureReady();
    const all = Array.from(this.map.values()) as any[];
    let filtered = all.filter(p => !p.isDeleted);

    if (filters.search) {
      const q = filters.search.toLowerCase();
      filtered = filtered.filter(p => (p.name || '').toLowerCase().includes(q) || (p.projectTitle || p.name || '').toLowerCase().includes(q));
    }
    if (filters.region) {
      filtered = filtered.filter(p => (p.region || '').toLowerCase().includes(filters.region!.toLowerCase()));
    }

    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const limit = filters.limit && filters.limit > 0 ? Math.min(filters.limit, 200) : 50;
    const total = filtered.length;
    const start = (page - 1) * limit;
    const data = filtered.slice(start, start + limit);

    return { data, page, limit, total };
  }

  findById(id: string): any | undefined {
    this.ensureReady();
    const p = this.map.get(id);
    if (!p || p.isDeleted) return undefined;
    return p;
  }

  create(input: any): any {
    this.ensureReady();
    const id = input.id || generateId();
    const now = new Date().toISOString();
    const obj = { ...input, id, createdAt: now, updatedAt: now, isDeleted: false };
    this.map.set(id, obj);
    memoryStore.saveCollection(COLLECTION);
    return obj;
  }

  update(id: string, patch: any): any {
    this.ensureReady();
    const existing = this.map.get(id);
    if (!existing) throw new Error('not found');
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.map.set(id, updated);
    memoryStore.saveCollection(COLLECTION);
    return updated;
  }

  softDelete(id: string): void {
    this.ensureReady();
    const existing = this.map.get(id);
    if (!existing) return;
    existing.isDeleted = true;
    existing.updatedAt = new Date().toISOString();
    this.map.set(id, existing);
    memoryStore.saveCollection(COLLECTION);
  }
}

export const projectsRepository: IProjectsRepository = new MemoryProjectsRepository();
