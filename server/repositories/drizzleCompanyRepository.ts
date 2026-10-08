// @ts-nocheck
/**
 * Phase 1.1 — Drizzle PostgreSQL Company Repository
 * 
 * Real PostgreSQL persistence for Companies and Members.
 * Uses the same interfaces for compatibility.
 */
import { eq, and, isNull } from 'drizzle-orm';
import { getDatabase } from '../db/client';
import { companies, companyMembers } from '../db/schema/identity';
import { ICompanyRepository, IMemberRepository, Company, CompanyMember } from './companyRepository';

export class DrizzleCompanyRepository implements ICompanyRepository {
  private async db() {
    const database = await getDatabase();
    if (!database) throw new Error('PostgreSQL not available');
    return database;
  }

  async create(data: Omit<Company, 'id' | 'createdAt' | 'updatedAt' | 'version'>): Promise<Company> {
    const db = await this.db();
    const result = await db.insert(companies).values({
      legalName: data.legalName,
      tradeName: data.tradeName || null,
      taxId: data.taxId || null,
      address: data.address || null,
      region: data.region || null,
      tier: data.tier || 'FREE',
      status: data.status || 'active',
    }).returning();
    
    const row = result[0];
    return this.mapRowToCompany(row);
  }

  async findById(id: string): Promise<Company | undefined> {
    const db = await this.db();
    const result = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
    return result[0] ? this.mapRowToCompany(result[0]) : undefined;
  }

  async findByUserId(userId: string): Promise<Company[]> {
    const memberRepo = new DrizzleMemberRepository();
    const memberships = await memberRepo.findByUserId(userId);
    const result: Company[] = [];
    for (const m of memberships) {
      const company = await this.findById(m.companyId);
      if (company) result.push(company);
    }
    return result;
  }

  private mapRowToCompany(row: any): Company {
    return {
      id: row.id,
      legalName: row.legalName,
      tradeName: row.tradeName || '',
      taxId: row.taxId || '',
      address: row.address || '',
      region: row.region || '',
      tier: row.tier || 'FREE',
      status: row.status || 'active',
      createdAt: row.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: row.updatedAt?.toISOString() || new Date().toISOString(),
      version: row.version || 1,
    };
  }
}

export class DrizzleMemberRepository implements IMemberRepository {
  private async db() {
    const database = await getDatabase();
    if (!database) throw new Error('PostgreSQL not available');
    return database;
  }

  async create(data: Omit<CompanyMember, 'id' | 'createdAt' | 'updatedAt'>): Promise<CompanyMember> {
    const db = await this.db();
    const result = await db.insert(companyMembers).values({
      companyId: data.companyId,
      userId: data.userId,
      role: data.role || 'owner',
      status: data.status || 'active',
    }).returning();
    
    const row = result[0];
    return this.mapRowToMember(row);
  }

  async findByUserId(userId: string): Promise<CompanyMember[]> {
    const db = await this.db();
    const result = await db.select().from(companyMembers).where(eq(companyMembers.userId, userId));
    return result.map((row: any) => this.mapRowToMember(row));
  }

  async findMembership(userId: string, companyId: string): Promise<CompanyMember | undefined> {
    const db = await this.db();
    const result = await db.select().from(companyMembers).where(
      and(eq(companyMembers.userId, userId), eq(companyMembers.companyId, companyId))
    ).limit(1);
    return result[0] ? this.mapRowToMember(result[0]) : undefined;
  }

  private mapRowToMember(row: any): CompanyMember {
    return {
      id: row.id,
      companyId: row.companyId,
      userId: row.userId,
      role: row.role || 'owner',
      status: row.status || 'active',
      createdAt: row.createdAt?.toISOString() || new Date().toISOString(),
      updatedAt: row.updatedAt?.toISOString() || new Date().toISOString(),
    };
  }
}

export const drizzleCompanyRepository = new DrizzleCompanyRepository();
export const drizzleMemberRepository = new DrizzleMemberRepository();
