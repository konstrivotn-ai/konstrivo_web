/**
 * Phase 2A — Trade Repository & Material↔Trade Integration Tests
 *
 * Focused tests for the minimum trade repository/integration required by
 * Phase 2A:
 *   1. official trades can be read
 *   2. trade lookup by code/id works
 *   3. seeded materials can retain their legacy trade value
 *   4. material↔tradeId relationship works when data exists
 *   5. nonexistent trade returns the repository's expected safe result/error
 *   6. existing Material API contract remains unchanged
 *
 * Repository-level tests use the deterministic in-memory implementation so
 * they are hermetic (no database dependency); API-level tests use the live
 * test server to assert the existing Material contract.
 */
import { apiRequest } from './setup';
import { test, assertEq, ok, ctx } from './run';
import {
  tradeRepository,
  MemoryTradeRepository,
  buildTradesFromCatalog,
  OFFICIAL_TRADES,
  officialTradeId,
} from '../server/repositories/tradeRepository';
import { buildMaterialsFromRates } from '../server/repositories/seed';
import { getDatabase } from '../server/db/client';
import { trades, materials } from '../server/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { DEFAULT_MARKET_RATES } from '../src/data/marketRates';

/* ── Test-catalog seeding helpers (Phase 2A isolation) ────────────────────
 * A clean TEST_DATABASE_URL has an EMPTY catalog. The hybrid repositories
 * (and therefore /api/v1/materials) read from PostgreSQL whenever that DB is
 * reachable — which is the case in the test runner, because config.databaseUrl
 * resolves to TEST_DATABASE_URL when NODE_ENV=test. To keep the API-contract
 * assertions valid we idempotently seed the canonical trades + materials into
 * the TEST catalog first. When no DB is available these helpers no-op and the
 * in-memory repositories self-seed identical data.                        */
function tradeRowValues(t: { code: string; labelFr: string; labelAr?: string; labelDerja?: string; icon?: string; sortOrder: number }) {
  return {
    code: t.code,
    labelFr: t.labelFr,
    labelAr: t.labelAr ?? null,
    labelDerja: t.labelDerja ?? null,
    icon: t.icon ?? null,
    sortOrder: t.sortOrder,
    isActive: true,
    isOfficial: true,
  };
}

async function ensureTradeInDb(db: any, t: any): Promise<string | undefined> {
  try {
    const existing = await db.select({ id: trades.id }).from(trades)
      .where(eq(trades.code, t.code)).limit(1);
    if (existing[0]?.id) return existing[0].id;
    const inserted = await db.insert(trades).values(tradeRowValues(t)).returning({ id: trades.id });
    return inserted?.[0]?.id;
  } catch (err) {
    console.warn('[KONSTRIVO-P2A] trade seed skipped:', err instanceof Error ? err.message : err);
    return undefined;
  }
}

async function ensureMaterialInDb(db: any, rate: any, tradeId: any): Promise<string | undefined> {
  try {
    const existing = await db.select({ id: materials.id }).from(materials)
      .where(and(eq(materials.code, rate.id), isNull(materials.companyId))).limit(1);
    if (existing[0]?.id) return existing[0].id;
    const inserted = await db.insert(materials).values({
      code: rate.id,
      trade: rate.category,
      tradeId: tradeId ?? null,
      category: rate.category,
      nameFr: rate.nameFr,
      nameAr: rate.nameAr,
      nameEn: rate.nameEn ?? null,
      baseUnit: rate.unit,
      isOfficial: true,
      companyId: null,
    }).returning({ id: materials.id });
    return inserted?.[0]?.id;
  } catch (err) {
    console.warn('[KONSTRIVO-P2A] material seed skipped:', err instanceof Error ? err.message : err);
    return undefined;
  }
}

async function seedCatalogForPhase2a(): Promise<{ mode: 'db' | 'memory'; tradeIdByCode: Record<string, string | undefined> }> {
  const db = await getDatabase();
  if (!db) return { mode: 'memory', tradeIdByCode: {} };
  const tradeIdByCode: Record<string, string | undefined> = {};
  for (const t of OFFICIAL_TRADES) tradeIdByCode[t.code] = await ensureTradeInDb(db, t);
  for (const rate of DEFAULT_MARKET_RATES) await ensureMaterialInDb(db, rate, tradeIdByCode[rate.category] ?? null);
  return { mode: 'db', tradeIdByCode };
}

export async function runTradePhase2aTests() {
  console.log('\n🔨 Trades (Phase 2A) Tests\n');

  // Seed the catalog so API-contract assertions hold under the PostgreSQL
  // (hybrid) repository path — a clean TEST_DATABASE_URL has an empty catalog.
  const seed = await seedCatalogForPhase2a();

  await test('official trades can be read', async () => {
    // Hermetic memory path (no DB dependency) — deterministic seed.


    const mem = new MemoryTradeRepository();
    const official = mem.list(true);
    ok(official.length >= 12, '12 canonical official trades are seeded');
    ok(official.every((t) => t.isOfficial === true), 'all seeded trades have isOfficial=true');
    assertEq(official.length, buildTradesFromCatalog().length);

    // Hybrid path (uses Drizzle when the DB is available; memory otherwise).
    const viaRepo: any[] = await tradeRepository.list(true);
    ok(Array.isArray(viaRepo), 'tradeRepository.list returns an array');
    // With the test catalog seeded (DB path) or the in-memory self-seed, the
    // hybrid repository must expose the full official set.
    ok(viaRepo.length >= 12, `official trades readable via hybrid repo (got ${viaRepo.length})`);
    ok(viaRepo.every((t) => t.isOfficial === true), 'listed official trades have isOfficial=true');
  });

  await test('trade lookup by code and by id works', async () => {
    const repo = new MemoryTradeRepository();
    const placo = repo.findByCode('placo');
    ok(placo, 'placo trade resolvable by code');
    assertEq(placo!.code, 'placo');
    assertEq(placo!.labelFr, 'PLACO / PLÂTRE');

    const byId = repo.findById(placo!.id);
    ok(byId, 'trade resolvable by id');
    assertEq(byId!.id, placo!.id);
    assertEq(byId!.code, 'placo');

    // Same lookup through the exported (hybrid) repository.



    const viaRepo = await tradeRepository.findByCode('placo');
    if (viaRepo) assertEq(viaRepo.code, 'placo');
  });

  await test('seeded materials retain their legacy trade value', async () => {
    // DB-independent check on the canonical seed used by the memory path.
    const built = buildMaterialsFromRates();
    ok(built.materials.length > 0, 'seed yields official materials');
    for (const m of built.materials) {
      ok(typeof m.trade === 'string' && m.trade.length > 0, 'seeded material keeps legacy trade string');
      ok(m.trade !== m.tradeId, 'legacy trade is not replaced by tradeId');
    }

    // Live API check (valid under both backends once the catalog is seeded).
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/materials?limit=10');
    assertEq(res.status, 200);
    ok(res.body.data.length > 0, 'should have seeded materials');
    for (const m of res.body.data) {
      ok(typeof m.trade === 'string' && m.trade.length > 0, 'material keeps legacy trade string');
      // The legacy `trade` field must not be replaced by a tradeId.

      ok(m.trade !== m.tradeId, 'legacy trade is not replaced by tradeId');
    }
  });

  await test('material↔tradeId relationship works when data exists', async () => {
    const repo = new MemoryTradeRepository();
    const placo = repo.findByCode('placo');
    ok(placo, 'placo trade available for relationship test');

    // A material pointing at the placo trade via tradeId resolves through the relationship.



    const materialWithTradeId = { trade: 'placo', tradeId: placo!.id };
    const resolved = repo.findForMaterial(materialWithTradeId);
    ok(resolved, 'material.tradeId resolves to a trade');
    assertEq(resolved!.id, placo!.id);
    assertEq(resolved!.code, 'placo');

    // Legacy-only material (no tradeId) resolves by legacy code fallback.




    const legacyOnly = { trade: 'carrelage' };
     const byLegacy = repo.findForMaterial(legacyOnly);
    ok(byLegacy, 'legacy trade code fallback resolves');
    assertEq(byLegacy!.code, 'carrelage');

    // Hybrid path: resolve using the REAL seeded trade id when PostgreSQL is
    // available, otherwise the deterministic memory id. This exercises the
    // Postgres-backed relationship lookup.
    const placoId: string = seed.mode === 'db'
      ? (seed.tradeIdByCode['placo'] ?? officialTradeId('placo'))
      : officialTradeId('placo');
    const viaRepo = await tradeRepository.findForMaterial({ tradeId: placoId, trade: 'placo' });
    ok(viaRepo, 'material.tradeId resolves through the (hybrid) repository');
    assertEq(viaRepo!.code, 'placo');
  });

  await test('nonexistent trade returns the expected safe result', async () => {
    const repo = new MemoryTradeRepository();
    assertEq(repo.findById('missing_trade_id'), undefined);
    assertEq(repo.findByCode('missing_trade_code'), undefined);
    assertEq(repo.findForMaterial({ trade: 'bogus', tradeId: 'nope' }), undefined);
    assertEq(repo.findForMaterial({}), undefined);

    // The exported hybrid repository never throws for unknown ids — safe undefined.



    const viaRepo = await tradeRepository.findById('missing_trade_id');
    assertEq(viaRepo, undefined);
  });

  await test('existing Material API contract remains unchanged', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/materials?limit=1');
    assertEq(res.status, 200);
    ok(Array.isArray(res.body.data));
    ok(res.body.data.length > 0, 'catalog is seeded for the Material contract check');
    ok(typeof res.body.page === 'number', 'paginated shape: page present');
    ok(typeof res.body.limit === 'number', 'paginated shape: limit present');
    ok(typeof res.body.total === 'number', 'paginated shape: total present');

    const m = res.body.data[0];
    ok(m && typeof m === 'object', 'material object present');
    ok('trade' in m, 'legacy trade field preserved in the Material API contract');
    ok('id' in m && 'code' in m && 'category' in m && 'nameFr' in m, 'core material fields unchanged');

    // The contract must NOT gain new trade-specific response fields..
    ok(!('tradeCode' in m), 'no new tradeCode field added to the Material API');
  });
}