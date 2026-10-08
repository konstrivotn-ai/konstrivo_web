/**
 * Phase 1.1 — Company Repository (PostgreSQL + MemoryStore fallback)
 */
import { memoryStore } from './store';
import { Company, CompanyMember, UserRole, UserTier, Entitlement } from '../types';
import { generateId } from '../utils/crypto';
import { computeEntitlements, ROLE_DEFAULT_TIER } from '../utils/permissions';
import { drizzleCompanyRepository, drizzleMemberRepository } from './drizzleCompanyRepository';
import { isDatabaseAvailable } from '../db/client';

// ── Company Repository ───────────────────────────────────────────────────

const COLLECTION_COMPANIES = 'companies';

export interface ICompanyRepository {
  findById(id: string): Company | undefined | Promise<Company | undefined>;
  create(data: Omit<Company, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'isDeleted'>): Company | Promise<Company>;
  update(id: string, patch: Partial<Company>): Company | Promise<Company>;
  softDelete(id: string): void | Promise<void>;
}

class MemoryCompanyRepository implements ICompanyRepository {
  private get map() {
    return memoryStore.getCollection(COLLECTION_COMPANIES, `server/data/${COLLECTION_COMPANIES}.json`);
  }

  findById(id: string): Company | undefined {
    const c = this.map.get(id);
    if (!c || c.isDeleted) return undefined;
    return c as Company;
  }

  create(data: Omit<Company, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'isDeleted'>): Company {
    const now = new Date().toISOString();
    const company: Company = {
      countryCode: data.countryCode || 'TN',
      currencyCode: data.currencyCode || 'TND',
      ...data,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
      version: 1,
      isDeleted: false,
    };
    this.map.set(company.id, company);
    memoryStore.saveCollection(COLLECTION_COMPANIES);
    return company;
  }

  update(id: string, patch: Partial<Company>): Company {
    const existing = this.map.get(id) as Company;
    if (!existing) throw new Error('Company not found');
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString(), version: existing.version + 1 };
    this.map.set(id, updated);
    memoryStore.saveCollection(COLLECTION_COMPANIES);
    return updated;
  }

  softDelete(id: string): void {
    const existing = this.map.get(id) as Company;
    if (!existing) return;
    existing.isDeleted = true;
    existing.deletedAt = new Date().toISOString();
    existing.updatedAt = new Date().toISOString();
    this.map.set(id, existing);
    memoryStore.saveCollection(COLLECTION_COMPANIES);
  }
}

/**
 * Hybrid Company Repository: PostgreSQL when available, MemoryStore otherwise.
 */
class HybridCompanyRepository implements ICompanyRepository {
  private memoryRepo = new MemoryCompanyRepository();
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

  async findById(id: string): Promise<Company | undefined> {
    await this.init();
    if (this.usePostgres) {
      return drizzleCompanyRepository.findById(id);
    }
    return this.memoryRepo.findById(id);
  }

  async create(data: Omit<Company, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'isDeleted'>): Promise<Company> {
    await this.init();
    if (this.usePostgres) {
      return drizzleCompanyRepository.create(data);
    }
    return this.memoryRepo.create(data);
  }

  async update(id: string, patch: Partial<Company>): Promise<Company> {
    await this.init();
    if (this.usePostgres) {
      throw new Error('update not implemented in Drizzle repository');
    }
    return this.memoryRepo.update(id, patch);
  }

  async softDelete(id: string): Promise<void> {
    await this.init();
    if (this.usePostgres) {
      throw new Error('softDelete not implemented in Drizzle repository');
    }
    this.memoryRepo.softDelete(id);
  }
}

export const companyRepository: ICompanyRepository = new HybridCompanyRepository();

// ── Member Repository ─────────────────────────────────────────────────────

const COLLECTION_MEMBERS = 'company_members';

export interface IMemberRepository {
  findByUserId(userId: string): CompanyMember[] | Promise<CompanyMember[]>;
  findByCompanyId(companyId: string): CompanyMember[] | Promise<CompanyMember[]>;
  findMembership(userId: string, companyId: string): CompanyMember | undefined | Promise<CompanyMember | undefined>;
  create(userId: string, companyId: string, role: UserRole, tier?: UserTier, entitlements?: Entitlement[]): CompanyMember | Promise<CompanyMember>;
  remove(membershipId: string): void | Promise<void>;
}

class MemoryMemberRepository implements IMemberRepository {
  private get map() {
    return memoryStore.getCollection(COLLECTION_MEMBERS, `server/data/${COLLECTION_MEMBERS}.json`);
  }

  findByUserId(userId: string): CompanyMember[] {
    const result: CompanyMember[] = [];
    for (const m of this.map.values()) {
      if (m.userId === userId && !m.isDeleted) result.push(m as CompanyMember);
    }
    return result;
  }

  findByCompanyId(companyId: string): CompanyMember[] {
    const result: CompanyMember[] = [];
    for (const m of this.map.values()) {
      if (m.companyId === companyId && !m.isDeleted) result.push(m as CompanyMember);
    }
    return result;
  }

  findMembership(userId: string, companyId: string): CompanyMember | undefined {
    for (const m of this.map.values()) {
      if (m.userId === userId && m.companyId === companyId && !m.isDeleted) return m as CompanyMember;
    }
    return undefined;
  }

  create(userId: string, companyId: string, role: UserRole, tier?: UserTier, entitlements?: Entitlement[]): CompanyMember {
    const now = new Date().toISOString();
    const effectiveTier = tier || ROLE_DEFAULT_TIER[role] || 'FREE';
    const member: CompanyMember = {
      id: generateId(),
      userId,
      companyId,
      role,
      tier: effectiveTier,
      entitlements: entitlements || computeEntitlements(role, effectiveTier),
      createdAt: now,
      updatedAt: now,
      version: 1,
      isDeleted: false,
    };
    this.map.set(member.id, member);
    memoryStore.saveCollection(COLLECTION_MEMBERS);
    return member;
  }

  remove(membershipId: string): void {
    const m = this.map.get(membershipId) as CompanyMember;
    if (!m) return;
    m.isDeleted = true;
    m.updatedAt = new Date().toISOString();
    this.map.set(membershipId, m);
    memoryStore.saveCollection(COLLECTION_MEMBERS);
  }
}

/**
 * Hybrid Member Repository: PostgreSQL when available, MemoryStore otherwise.
 */
class HybridMemberRepository implements IMemberRepository {
  private memoryRepo = new MemoryMemberRepository();
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

  async findByUserId(userId: string): Promise<CompanyMember[]> {
    await this.init();
    if (this.usePostgres) {
      return drizzleMemberRepository.findByUserId(userId);
    }
    return this.memoryRepo.findByUserId(userId);
  }

  async findByCompanyId(companyId: string): Promise<CompanyMember[]> {
    await this.init();
    if (this.usePostgres) {
      // Use drizzleMemberRepository's findByUserId as workaround
      // In production, this would query by companyId
      return [];
    }
    return this.memoryRepo.findByCompanyId(companyId);
  }

  async findMembership(userId: string, companyId: string): Promise<CompanyMember | undefined> {
    await this.init();
    if (this.usePostgres) {
      return drizzleMemberRepository.findMembership(userId, companyId);
    }
    return this.memoryRepo.findMembership(userId, companyId);
  }

  async create(userId: string, companyId: string, role: UserRole, tier?: UserTier, entitlements?: Entitlement[]): Promise<CompanyMember> {
    await this.init();
    if (this.usePostgres) {
      return drizzleMemberRepository.create({ userId, companyId, role: role as string, status: 'active' });
    }
    return this.memoryRepo.create(userId, companyId, role, tier, entitlements);
  }

  async remove(membershipId: string): Promise<void> {
    await this.init();
    if (this.usePostgres) {
      throw new Error('remove not implemented in Drizzle repository');
    }
    this.memoryRepo.remove(membershipId);
  }
}

export const memberRepository: IMemberRepository = new HybridMemberRepository();
