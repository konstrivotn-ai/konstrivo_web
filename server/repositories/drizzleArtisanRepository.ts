import { getDatabase } from '../db/client';
import { artisanProfiles } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { isValidUuid } from '../utils/validation';

export async function findArtisanById(id: string) {
  const db = await getDatabase();
  if (!db) return undefined;
  // See drizzleMaterialRepository — guard non-UUID input before PostgreSQL.
  if (!isValidUuid(id)) return undefined;
  const res = await db.select().from(artisanProfiles).where(eq(artisanProfiles.id, id)).limit(1);
  return res[0];
}

export async function listArtisans(filters: any) {
  const db = await getDatabase();
  if (!db) return { data: [], page: filters.page || 1, limit: filters.limit || 20, total: 0 };
  let q = db.select().from(artisanProfiles).where(eq(artisanProfiles.isDeleted, false));
  if (filters.trade) q = q.where(eq(artisanProfiles.trade, filters.trade));
  if (filters.governorate) q = q.where(sql`${artisanProfiles.region} ILIKE ${`%${filters.governorate}%`}`);
  if (filters.pro !== undefined) q = q.where(eq(artisanProfiles.isPro, !!filters.pro));
  if (filters.search) q = q.where(sql`${artisanProfiles.companyName} ILIKE ${`%${filters.search}%`}`);
  const all = await q;
  // sort by rating desc
  all.sort((a: any, b: any) => (b.rating || 0) - (a.rating || 0));
  const total = all.length;
  const page = filters.page || 1;
  const limit = filters.limit || 20;
  const start = (page - 1) * limit;
  const data = all.slice(start, start + limit);
  return { data, page, limit, total };
}
