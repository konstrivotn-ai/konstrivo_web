/**
 * Phase 3 — Drizzle Projects Repository
 * Production-ready PostgreSQL backend for Chantiers/Projects
 */
import { getDatabase } from '../db/client';
import { projects } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';

export async function generateProjectCode(db: any, companyId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PRJ-${year}-`;
  const rows = await db.select({ code: projects.code }).from(projects).where(
    sql`${projects.code} LIKE ${`${prefix}%`} AND ${projects.companyId} = ${companyId}`
  );
  let maxNum = 0;
  for (const r of rows) {
    const match = r.code?.match(/PRJ-\d{4}-(\d+)/);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
  }
  return `${prefix}${String(maxNum + 1).padStart(5, '0')}`;
}

export async function findProjectById(id: string) {
  const db = await getDatabase();
  if (!db) return undefined;
  const p = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!p || p.length === 0) return undefined;
  return p[0];
}

export async function listProjects(filters: any) {
  const db = await getDatabase();
  if (!db) return { data: [], page: filters.page || 1, limit: filters.limit || 20, total: 0 };

  let q = db.select().from(projects).where(eq(projects.isDeleted, false));

  if (filters.companyId) {
    q = q.where(eq(projects.companyId, filters.companyId));
  }
  if (filters.status) {
    q = q.where(eq(projects.status, filters.status));
  }
  if (filters.region) {
    q = q.where(sql`${projects.region} ILIKE ${`%${filters.region}%`}`);
  }
  if (filters.search) {
    q = q.where(
      sql`${projects.name} ILIKE ${`%${filters.search}%`} OR 
          ${projects.code} ILIKE ${`%${filters.search}%`} OR 
          ${projects.clientName} ILIKE ${`%${filters.search}%`}`
    );
  }

  const all = await q;
  all.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const total = all.length;
  const page = filters.page || 1;
  const limit = filters.limit || 20;
  const start = (page - 1) * limit;
  const data = all.slice(start, start + limit);

  return { data, page, limit, total };
}

export async function createProject(input: any) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');

  if (!input.companyId) throw new Error('companyId is required');
  if (!input.name) throw new Error('name is required');

  const code = await generateProjectCode(db, input.companyId);
  const now = new Date();

  const [inserted] = await db.insert(projects).values({
    companyId: input.companyId,
    managerUserId: input.managerUserId,
    code,
    name: input.name,
    clientName: input.clientName,
    clientPhone: input.clientPhone,
    address: input.address,
    region: input.region,
    country: input.country || 'TN',
    currency: input.currency || 'TND',
    type: input.type || 'residentiel',
    status: input.status || 'planification',
    progressPercent: input.progressPercent || 0,
    budgetTotalHt: input.budgetTotalHt,
    depensesActuellesHt: input.depensesActuellesHt || 0,
    startDate: input.startDate ? new Date(input.startDate) : null,
    targetEndDate: input.targetEndDate ? new Date(input.targetEndDate) : null,
    phases: input.phases ? JSON.stringify(input.phases) : '[]',
    logs: input.logs ? JSON.stringify(input.logs) : '[]',
    team: input.team ? JSON.stringify(input.team) : '[]',
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
    version: 1,
    isDeleted: false,
  }).returning();

  return findProjectById(inserted.id);
}

export async function updateProject(id: string, patch: any, expectedVersion?: number) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');

  const existing = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!existing || existing.length === 0) throw new Error('Project not found');

  const cur = existing[0];
  if (expectedVersion !== undefined && Number(expectedVersion) !== Number(cur.version)) {
    const err: any = new Error(`Version conflict: expected ${expectedVersion}, server has ${cur.version}`);
    err.statusCode = 409;
    err.code = 'CONFLICT';
    throw err;
  }

  const updateData: any = { ...patch, updatedAt: new Date(), version: (cur.version || 1) + 1 };

  // Convert arrays to JSON if provided
  if (updateData.phases) updateData.phases = JSON.stringify(updateData.phases);
  if (updateData.logs) updateData.logs = JSON.stringify(updateData.logs);
  if (updateData.team) updateData.team = JSON.stringify(updateData.team);

  const [updated] = await db.update(projects).set(updateData).where(eq(projects.id, id)).returning();
  return findProjectById(updated.id);
}

export async function softDeleteProject(id: string) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');
  await db.update(projects).set({
    isDeleted: true,
    deletedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(projects.id, id));
}
