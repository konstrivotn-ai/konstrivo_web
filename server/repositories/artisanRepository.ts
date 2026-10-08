/**
 * Phase 2 — Artisan Directory Repository
 *
 * Public read-only data. No private user information exposed.
 * Seeded from INITIAL_ARTISANS on first access.
 */
import { memoryStore } from './store';
import { config } from '../config';
import { ArtisanProfile, PaginatedResult } from '../types';
import { buildArtisansFromMock } from './seed';
import { isDatabaseAvailable } from '../db/client';
import * as drizzleRepo from './drizzleArtisanRepository';

const COLLECTION = 'artisans';

export interface ArtisanFilters {
  trade?: string;
  governorate?: string;  // maps to region
  pro?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}

export interface IArtisanRepository {
  ensureSeeded(): void | Promise<void>;
  findById(id: string): Promise<ArtisanProfile | undefined> | ArtisanProfile | undefined;
  list(filters: ArtisanFilters): Promise<PaginatedResult<ArtisanProfile>> | PaginatedResult<ArtisanProfile>;
}

class MemoryArtisanRepository implements IArtisanRepository {
  private get map() {
    return memoryStore.getCollection(COLLECTION, `server/data/${COLLECTION}.json`);
  }

  ensureSeeded(): void {
    if (config.isProduction) {
      throw new Error('[KONSTRIVO] Artisan repository: in-memory seeding is not allowed in production. Implement Drizzle/Postgres repository.');
    }
    if (this.map.size === 0) {
      for (const a of buildArtisansFromMock()) {
        this.map.set(a.id, a);
      }
      memoryStore.saveCollection(COLLECTION);
    }
  }

  findById(id: string): ArtisanProfile | undefined {
    this.ensureSeeded();
    const a = this.map.get(id);
    if (!a || (a as ArtisanProfile).isDeleted) return undefined;
    return a as ArtisanProfile;
  }

  list(filters: ArtisanFilters): PaginatedResult<ArtisanProfile> {
    this.ensureSeeded();
    const all = Array.from(this.map.values()) as ArtisanProfile[];
    let filtered = all.filter(a => !a.isDeleted);

    if (filters.trade) {
      filtered = filtered.filter(a => a.trade === filters.trade);
    }
    if (filters.governorate) {
      filtered = filtered.filter(a =>
        a.region.toLowerCase().includes(filters.governorate!.toLowerCase())
      );
    }
    if (filters.pro !== undefined) {
      filtered = filtered.filter(a => a.isPro === filters.pro);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      filtered = filtered.filter(a =>
        a.companyName.toLowerCase().includes(q) ||
        a.bio.toLowerCase().includes(q) ||
        a.services.some(s => s.toLowerCase().includes(q))
      );
    }

    // Sort by rating desc
    filtered.sort((a, b) => b.rating - a.rating);

    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const limit = filters.limit && filters.limit > 0 ? Math.min(filters.limit, 100) : 20;
    const total = filtered.length;
    const start = (page - 1) * limit;
    const data = filtered.slice(start, start + limit);

    return { data, page, limit, total };
  }
}

class HybridArtisanRepository implements IArtisanRepository {
  private memory = new MemoryArtisanRepository();
  async ensureSeeded() { return this.memory.ensureSeeded(); }
  async findById(id: string) { if (await isDatabaseAvailable()) return await drizzleRepo.findArtisanById(id); return this.memory.findById(id); }
  async list(filters: ArtisanFilters) { if (await isDatabaseAvailable()) return await drizzleRepo.listArtisans(filters); return this.memory.list(filters); }
}

export const artisanRepository: IArtisanRepository = new HybridArtisanRepository();
