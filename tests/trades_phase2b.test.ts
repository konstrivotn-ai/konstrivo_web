/**
 * Phase 2B — Trade HTTP API Tests (/api/v1/trades)
 *
 * Focused API-level tests for the read-only exposure of the Phase 2A trade
 * registry:
 *   1. GET /api/v1/trades → 200 with the full official registry (≥ 12 trades)
 *   2. trade objects expose the required registry fields
 *   3. ?officialOnly=true → only official trades
 *   4. GET /api/v1/trades/:id → 200 for a valid id
 *   5. unknown/invalid ids → safe 404 in the standard error format
 *   6. API discovery lists the new trade endpoints
 *   7. the existing Material API contract remains unchanged
 *      (legacy `trade` preserved, no `tradeCode` field)
 *
 * Uses the live test server (hybrid repositories: PostgreSQL/Drizzle when
 * TEST_DATABASE_URL is reachable, deterministic in-memory data otherwise).
 * The Phase 2A suite runs first and idempotently ensures the test catalog.
 */
import { apiRequest } from './setup';
import { test, assertEq, ok, ctx } from './run';

export async function runTradePhase2bTests() {
  await test('GET /api/v1/trades returns 200 with the full official registry', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/trades');
    assertEq(res.status, 200);
    ok(Array.isArray(res.body.data), 'response shape is { data: [...] }');
    ok(res.body.data.length >= 12, 'at least the 12 canonical official trades are exposed');
  });

  await test('trade objects expose the required registry fields', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/trades');
    assertEq(res.status, 200);
    const t = res.body.data[0];
    ok(t && typeof t === 'object', 'trade object present');
    ok(typeof t.id === 'string' && t.id.length > 0, 'id present');
    ok(typeof t.code === 'string' && t.code.length > 0, 'code present');
    ok(typeof t.labelFr === 'string' && t.labelFr.length > 0, 'labelFr present');
    ok(typeof t.sortOrder === 'number', 'sortOrder present');
    ok(typeof t.isActive === 'boolean', 'isActive present');
    ok(typeof t.isOfficial === 'boolean', 'isOfficial present');
    const codes = res.body.data.map((x: any) => x.code);
    ok(codes.includes('placo'), 'canonical placo trade present');
  });

  await test('officialOnly=true returns only official trades', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/trades?officialOnly=true');
    assertEq(res.status, 200);
    ok(Array.isArray(res.body.data), 'response shape is { data: [...] }');
    ok(res.body.data.length >= 12, 'official registry fully exposed');
    for (const t of res.body.data) {
      ok(t.isOfficial === true, 'every listed trade is official');
    }
  });

  await test('GET /api/v1/trades/:id returns a single trade for a valid id', async () => {
    const listRes = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/trades');
    assertEq(listRes.status, 200);
    const trade = listRes.body.data[0];
    ok(trade, 'a trade is available for the by-id lookup');
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', `/api/v1/trades/${trade.id}`);
    assertEq(res.status, 200);
    ok(res.body.data && typeof res.body.data === 'object', 'trade object returned');
    assertEq(res.body.data.id, trade.id);
    assertEq(res.body.data.code, trade.code);
  });

  await test('unknown or invalid ids return a safe 404 in the standard error format', async () => {
    const unknown = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/trades/no_such_trade_id');
    assertEq(unknown.status, 404);
    ok(unknown.body.error, 'error object present');
    ok(unknown.body.error.code, 'error code present');
    ok(unknown.body.error.message, 'error message present');

    // A well-formed uuid that does not exist must also 404 safely (no 500),
    // covering both the memory path and the PostgreSQL/Drizzle path.
    const bogusUuid = await apiRequest(
      ctx.server!.baseUrl, 'GET', '/api/v1/trades/00000000-0000-0000-0000-000000000000'
    );
    assertEq(bogusUuid.status, 404);
    ok(bogusUuid.body.error, 'error object present for nonexistent uuid');
  });

  await test('API discovery lists the new trade endpoints', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1');
    assertEq(res.status, 200);
    const endpoints: string[] = Array.isArray(res.body.endpoints) ? res.body.endpoints : [];
    ok(endpoints.some((e) => e.trim().endsWith('/api/v1/trades')), 'discovery lists GET /api/v1/trades');
    ok(endpoints.some((e) => e.includes('/api/v1/trades/:id')), 'discovery lists GET /api/v1/trades/:id');
  });

  await test('existing Material API contract remains unchanged (legacy trade, no tradeCode)', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/materials?limit=5');
    assertEq(res.status, 200);
    ok(Array.isArray(res.body.data) && res.body.data.length > 0, 'materials still served');
    for (const m of res.body.data) {
      ok('trade' in m && typeof m.trade === 'string' && m.trade.length > 0, 'legacy material.trade preserved');
      ok(!('tradeCode' in m), 'no tradeCode field exposed on the Material API');
    }
  });
}