import { getDatabase } from '../db/client';
import { syncOperations } from '../db/schema';
import { eq, sql } from 'drizzle-orm';

// Audit fix (31 FAIL): postgres-js returns `timestamptz` columns as Date
// objects while the old code treated them as ISO strings
// (`a.serverTimestamp.localeCompare(...)` → TypeError → 500).
// These helpers compare/serialize timestamps safely for both shapes.
function tsOf(value: any): number {
  if (value === undefined || value === null) return 0;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function isoOf(value: any): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export async function pullSync(filter: any) {
  const db = await getDatabase();
  if (!db) return [];
  let rows = await db.select().from(syncOperations);
  rows = rows.filter((r: any) => r.syncStatus !== 'deleted');
  // Audit fix: `serverTimestamp` may be a Date (postgres-js timestamptz),
  // so compare via numeric epoch instead of string `localeCompare`.
  if (filter.since) {
    const sinceTs = tsOf(filter.since);
    rows = rows.filter((r: any) => tsOf(r.serverTimestamp) > sinceTs);
  }
  if (filter.entityTypes && filter.entityTypes.length > 0) rows = rows.filter((r: any) => filter.entityTypes.includes(r.entityType));
  return rows.sort((a: any, b: any) => tsOf(a.serverTimestamp) - tsOf(b.serverTimestamp));
}

export async function pushSync(userId: string, clientId: string, ops: any[]) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');
  const applied: any[] = [];
  const conflicts: any[] = [];
  const now = new Date().toISOString();

  for (const op of ops) {
    const existingAll = await db.select().from(syncOperations).where(sql`${syncOperations.entityType} = ${op.entityType} AND ${syncOperations.entityId} = ${op.entityId}`);
    // Audit fix: idempotency (mirrors the in-memory repository, which keys by
    // op.id). `sync_operations.id` is a `uuid` column so the client op id
    // ('op_1', …) can NEVER be stored/queried there (22P02 → 500). A repeated
    // push is therefore recognised by its full natural key
    // (client + entity + operation + version): same client re-pushing the same
    // operation returns the already-applied row; a DIFFERENT client (or a
    // different operation) with a stale version falls through to the conflict
    // path below.
    const replay = existingAll.find((r: any) =>
      r.clientId === clientId &&
      r.operationType === op.operationType &&
      Number(r.clientVersion) === Number(op.clientVersion)
    );
    if (replay) {
      applied.push({ id: replay.id, entityId: replay.entityId, serverVersion: replay.serverVersion, serverTimestamp: isoOf(replay.serverTimestamp) ?? replay.serverTimestamp });
      continue;
    }
    // Audit fix: `serverTimestamp` may be a Date — sort by epoch, not localeCompare.
    let cur = existingAll.length > 0 ? existingAll.sort((a: any, b: any) => tsOf(b.serverTimestamp) - tsOf(a.serverTimestamp))[0] : null;
    if (cur && cur.serverVersion > op.clientVersion) {
      conflicts.push({ id: cur.id, entityId: op.entityId, clientVersion: op.clientVersion, serverVersion: cur.serverVersion, serverTimestamp: isoOf(cur.serverTimestamp) ?? cur.serverTimestamp });
      continue;
    }

    // Audit fix: pass Date objects (not ISO strings) to the timestamptz
    // columns — the postgres-js serializer calls `.toISOString()` on the
    // value, which throws for arbitrary non-date strings. An invalid
    // clientTimestamp is omitted so the column default applies.
    const clientDate = op.clientTimestamp instanceof Date
      ? op.clientTimestamp
      : (typeof op.clientTimestamp === 'string' && !Number.isNaN(new Date(op.clientTimestamp).getTime())
          ? new Date(op.clientTimestamp)
          : undefined);
    const [inserted] = await db.insert(syncOperations).values({
      userId,
      clientId,
      entityType: op.entityType,
      entityId: op.entityId,
      operationType: op.operationType,
      clientVersion: op.clientVersion,
      serverVersion: (op.clientVersion || 0) + 1,
      ...(clientDate ? { clientTimestamp: clientDate } : {}),
      serverTimestamp: new Date(),
      syncStatus: 'applied',
      payload: JSON.stringify(op.payload),
    }).returning();

    applied.push({ id: inserted.id, entityId: inserted.entityId, serverVersion: inserted.serverVersion, serverTimestamp: isoOf(inserted.serverTimestamp) ?? inserted.serverTimestamp });
  }

  return { applied, conflicts };
}

export async function findSyncByEntity(entityType: string, entityId: string) {
  const db = await getDatabase();
  if (!db) return undefined;
  const rows = await db.select().from(syncOperations).where(sql`${syncOperations.entityType} = ${entityType} AND ${syncOperations.entityId} = ${entityId}`);
  // Audit fix: `serverTimestamp` may be a Date — sort by epoch, not localeCompare.
  const sorted = rows.sort((a: any, b: any) => tsOf(b.serverTimestamp) - tsOf(a.serverTimestamp));
  return sorted[0];
}
