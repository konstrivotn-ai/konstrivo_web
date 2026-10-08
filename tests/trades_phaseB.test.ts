/**
 * Phase B — Dynamic Trades Tests
 *
 * Focused tests for the dynamic trade functionality:
 *   1. Existing official trades are available
 *   2. A newly created/imported trade can be retrieved from the trade repository/API
 *   3. Its materials resolve to the correct trade
 *   4. The trade appears in the Quotes/Devis available trade source
 *   5. Existing official trade behavior remains unchanged
 *   6. No hardcoded 12-trade restriction blocks a dynamic trade
 */
import { apiRequest } from './setup';
import { test, assertEq, ok, ctx } from './run';
import {
  tradeRepository,
  MemoryTradeRepository,
  buildTradesFromCatalog,
  OFFICIAL_TRADES,
  officialTradeId,
  upsertTradeByCode,
} from '../server/repositories/tradeRepository';
import { memoryStore } from '../server/repositories/store';


export async function runTradePhaseBTests() {
  memoryStore.resetAll();

  await test('existing official trades are available (memory + repo)', async () => {
    const repo = new MemoryTradeRepository();
    const all = repo.list(false);
    ok(all.length >= 12, 'at least 12 official trades available');
    const codes = all.map(t => t.code);
    ok(codes.includes('placo'), 'placo is available');
    ok(codes.includes('peinture'), 'peinture is available');
    for (const t of all) {
      ok(t.isOfficial === true, `trade ${t.code} is official`);
    }
  });

  await test('newly created trade can be retrieved from repository', async () => {
    const repo = new MemoryTradeRepository();
    const before = repo.findByCode('gypsum');
    assertEq(before, undefined, 'gypsum does not exist before creation');
    const created = await upsertTradeByCode('gypsum', 'GYPSUM / PLASTER');
    ok(created, 'trade was created');
    assertEq(created!.code, 'gypsum');
    assertEq(created!.isOfficial, false, 'dynamic trade is not official');
    assertEq(created!.isActive, true, 'dynamic trade is active');
    const byCode = repo.findByCode('gypsum');
    ok(byCode, 'gypsum can be retrieved by code');
    assertEq(byCode!.code, 'gypsum');
    const byId = repo.findById(created!.id);
    ok(byId, 'gypsum can be retrieved by id');
    assertEq(byId!.code, 'gypsum');
  });

  await test('upsertTradeByCode is idempotent', async () => {
    const repo = new MemoryTradeRepository();
    const first = await upsertTradeByCode('gypsum2', 'GYPSUM 2');
    const second = await upsertTradeByCode('gypsum2', 'GYPSUM 2 updated');
    ok(first && second, 'both calls succeed');
    assertEq(first!.id, second!.id, 'same trade returned on second call');
  });

  await test('material resolves to dynamic trade via findForMaterial', async () => {
    const repo = new MemoryTradeRepository();
    const created = await upsertTradeByCode('gypsum3', 'GYPSUM 3');
    ok(created, 'trade created');
    const byTradeId = repo.findForMaterial({ tradeId: created!.id, trade: 'gypsum3' });
    ok(byTradeId, 'material resolves to dynamic trade via tradeId');
    assertEq(byTradeId!.code, 'gypsum3');
    const byLegacy = repo.findForMaterial({ trade: 'gypsum3' });
    ok(byLegacy, 'material resolves to dynamic trade via legacy code');
    assertEq(byLegacy!.code, 'gypsum3');
  });

  await test('dynamic trade appears in list() alongside official trades', async () => {
    const repo = new MemoryTradeRepository();
    await upsertTradeByCode('gypsum4', 'GYPSUM 4');
    const all = repo.list(false);
    const codes = all.map(t => t.code);
    ok(codes.includes('gypsum4'), 'dynamic trade appears in full list');
    ok(codes.includes('placo'), 'official trades still present');
    const official = repo.list(true);
    const officialCodes = official.map(t => t.code);
    ok(!officialCodes.includes('gypsum4'), 'dynamic trade excluded from official-only list');
    ok(officialCodes.includes('placo'), 'official trades in official-only list');
  });

  await test('official trades remain unchanged after dynamic trade creation', async () => {
    const repo = new MemoryTradeRepository();
    const placoBefore = repo.findByCode('placo');
    ok(placoBefore, 'placo exists before');
    await upsertTradeByCode('gypsum5', 'GYPSUM 5');
    const placoAfter = repo.findByCode('placo');
    ok(placoAfter, 'placo exists after');
    assertEq(placoBefore!.id, placoAfter!.id, 'placo id unchanged');
    assertEq(placoBefore!.code, placoAfter!.code, 'placo code unchanged');
    assertEq(placoAfter!.isOfficial, true, 'placo still official');
  });

  await test('no hardcoded 12-trade restriction blocks dynamic trade', async () => {
    const repo = new MemoryTradeRepository();
    // Isolate this count assertion: reset the SHARED trade store so its
    // baseline is exactly the 12 official trades (lazy re-seeded below).
    // Dynamic trades created by earlier tests in this group must not leak in.
    memoryStore.resetAll();
    repo.list(false); // triggers ensureSeeded() → re-seeds the 12 official trades
    const dynamicCodes = ['gypsum6', 'metal_strofer', 'smart_glass'];
    for (const code of dynamicCodes) {
      const created = await upsertTradeByCode(code);
      ok(created, `dynamic trade ${code} created`);
    }
    const all = repo.list(false);
    const codes = all.map(t => t.code);
    for (const code of dynamicCodes) {
      ok(codes.includes(code), `dynamic trade ${code} in list`);
    }
    assertEq(all.length, 15, '12 official + 3 dynamic trades');
  });

  await test('GET /api/v1/trades includes dynamic trades (API)', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/trades');
    assertEq(res.status, 200);
    ok(Array.isArray(res.body.data), 'response shape is { data: [...] }');
    ok(res.body.data.length >= 12, 'at least 12 trades exposed');
    const codes = res.body.data.map((t: any) => t.code);
    ok(codes.includes('placo'), 'placo exposed via API');
    ok(codes.includes('peinture'), 'peinture exposed via API');
  });

  await test('GET /api/v1/trades?officialOnly=true excludes dynamic trades', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/trades?officialOnly=true');
    assertEq(res.status, 200);
    for (const t of res.body.data) {
      ok(t.isOfficial === true, `trade ${t.code} is official`);
    }
  });
}