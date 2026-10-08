// @ts-nocheck
import { getDatabase } from '../db/client';
import { projectZones, projectOuvrages, releves, releveLines } from '../db/schema';
import { eq, and } from 'drizzle-orm';

export async function listProjectZones(projectId: string) {
  const db = await getDatabase();
  if (!db) return [];
  return await db.select().from(projectZones).where(eq(projectZones.projectId, projectId)).orderBy(projectZones.sortOrder);
}

export async function createProjectZone(input: any) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');
  const [row] = await db.insert(projectZones).values({
    projectId: input.projectId,
    name: input.name,
    sortOrder: input.sortOrder ?? 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning();
  return row;
}

export async function listProjectOuvrages(projectId: string, zoneId?: string | null) {
  const db = await getDatabase();
  if (!db) return [];
  const where = zoneId
    ? and(eq(projectOuvrages.projectId, projectId), eq(projectOuvrages.zoneId, zoneId))
    : eq(projectOuvrages.projectId, projectId);
  return await db.select().from(projectOuvrages).where(where).orderBy(projectOuvrages.createdAt);
}

export async function createProjectOuvrage(input: any) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');
  const [row] = await db.insert(projectOuvrages).values({
    projectId: input.projectId,
    zoneId: input.zoneId ?? null,
    tradeCode: input.tradeCode,
    metreElementCode: input.metreElementCode,
    title: input.title,
    specVersion: input.specVersion ?? 1,
    notes: input.notes ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning();
  return row;
}

export async function listRelevesForOuvrage(ouvrageId: string) {
  const db = await getDatabase();
  if (!db) return [];
  return await db.select().from(releves).where(eq(releves.ouvrageId, ouvrageId)).orderBy(releves.createdAt);
}

export async function createReleve(input: any) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');
  const [row] = await db.insert(releves).values({
    projectId: input.projectId,
    zoneId: input.zoneId ?? null,
    ouvrageId: input.ouvrageId,
    status: input.status ?? 'draft',
    specVersion: input.specVersion ?? 1,
    wasteOverridePercent: input.wasteOverridePercent ?? null,
    layersOverride: input.layersOverride ?? null,
    notes: input.notes ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning();
  return row;
}

export async function listReleveLines(releveId: string) {
  const db = await getDatabase();
  if (!db) return [];
  return await db.select().from(releveLines).where(eq(releveLines.releveId, releveId)).orderBy(releveLines.lineNo);
}

export async function addReleveLine(input: any) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');
  const [row] = await db.insert(releveLines).values({
    releveId: input.releveId,
    lineNo: input.lineNo ?? 0,
    dims: input.dims || {},
    openings: input.openings ?? null,
    deductions: input.deductions ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning();
  return row;
}
export async function findProjectOuvrage(ouvrageId: string) {
  const db = await getDatabase();
  if (!db) return undefined;
  const [row] = await db.select().from(projectOuvrages)
    .where(eq(projectOuvrages.id, ouvrageId))
    .limit(1);
  return row;
}

export async function findReleve(releveId: string) {
  const db = await getDatabase();
  if (!db) return undefined;
  const [row] = await db.select().from(releves)
    .where(eq(releves.id, releveId))
    .limit(1);
  return row;
}
