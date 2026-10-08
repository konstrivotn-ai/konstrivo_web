/**
 * Admin → Métiers — Trades HTTP API tests (additive layer).
 *
 * Requires the shared test server (startTestServer in tests/setup.ts) and the
 * admin/free/pro tokens prepared by tests/auth.test.ts — therefore this suite
 * runs ONLY from tests/run.ts, never standalone.
 *
 * Contract under test (all additive on the EXISTING read-only registry):
 *   - PATCH/DELETE and the service endpoints are admin-only (FREE/PRO → 403).
 *   - PATCH: empty body → 400; invalid sortOrder → 400; unknown id → 404.
 *   - DELETE: official trades → 409 (never deletable); unknown id → 404;
 *     a non-official trade with no materials is deleted (204) and disappears
 *     from the public list.
 *   - includeInactive without an admin session keeps the active-only contract.
 *   - API discovery lists the new endpoints.
 */
import { apiRequest } from './setup';
import { test, assertEq, ok, ctx } from './run';
import { upsertTradeByCode } from '../server/repositories/tradeRepository';
import { memoryStore } from '../server/repositories/store';

export async function runTradeAdminApiTests() {
  console.log('\n🛠️  Admin → Métiers — HTTP API Tests\n');

  await test('API: PATCH /api/v1/trades/:id is admin-only (FREE/PRO → 403)', async () => {
    const listRes = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/trades');
    const trade = listRes.body.data[0];
    const patch = { labelFr: 'Hacked label' };
    assertEq((await apiRequest(ctx.server!.baseUrl, 'PATCH', `/api/v1/trades/${trade.id}`, { body: patch, token: ctx.freeToken })).status, 403);
    assertEq((await apiRequest(ctx.server!.baseUrl, 'PATCH', `/api/v1/trades/${trade.id}`, { body: patch, token: ctx.proToken })).status, 403);
  });

  await test('API: PATCH without body fields → 400 (nothing silently applied)', async () => {
    const listRes = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/trades');
    const trade = listRes.body.data[0];
    const res = await apiRequest(ctx.server!.baseUrl, 'PATCH', `/api/v1/trades/${trade.id}`, {
      body: {},
      token: ctx.adminToken,
    });
    assertEq(res.status, 400);
    ok(res.body.error, 'error object present');
  });

  await test('API: PATCH labelFr by admin → 200 (official protection preserved)', async () => {
    const listRes = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/trades');
    const trade = listRes.body.data.find((t: any) => t.code === 'placo');
    ok(trade, 'placo available');
    const original = trade.labelFr;
    const res = await apiRequest(ctx.server!.baseUrl, 'PATCH', `/api/v1/trades/${trade.id}`, {
      body: { labelFr: original },
      token: ctx.adminToken,
    });
    assertEq(res.status, 200);
    assertEq(res.body.data.labelFr, original, 'no-op label write is reflected verbatim');
    assertEq(res.body.data.isOfficial, true, 'official protection preserved');
  });

  await test('API: PATCH invalid sortOrder → 400, unknown id → 404', async () => {
    const listRes = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/trades');
    const trade = listRes.body.data[0];
    const bad = await apiRequest(ctx.server!.baseUrl, 'PATCH', `/api/v1/trades/${trade.id}`, {
      body: { sortOrder: -5 },
      token: ctx.adminToken,
    });
    assertEq(bad.status, 400);

    const unknown = await apiRequest(ctx.server!.baseUrl, 'PATCH', '/api/v1/trades/00000000-0000-0000-0000-000000000000', {
      body: { labelFr: 'Ghost' },
      token: ctx.adminToken,
    });
    assertEq(unknown.status, 404);
  });

  await test('API: DELETE official trade → 409 (never deletable)', async () => {
    const listRes = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/trades');
    const official = listRes.body.data.find((t: any) => t.isOfficial);
    ok(official, 'an official trade exists');
    const res = await apiRequest(ctx.server!.baseUrl, 'DELETE', `/api/v1/trades/${official.id}`, { token: ctx.adminToken });
    assertEq(res.status, 409);
    ok(res.body.error, 'conflict error object present');
  });

  await test('API: DELETE unknown id → 404, FREE → 403', async () => {
    assertEq(
      (await apiRequest(ctx.server!.baseUrl, 'DELETE', '/api/v1/trades/00000000-0000-0000-0000-000000000000', { token: ctx.adminToken })).status,
      404
    );
    const probe = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/trades');
    const anyTrade = probe.body.data[0];
    assertEq(
      (await apiRequest(ctx.server!.baseUrl, 'DELETE', `/api/v1/trades/${anyTrade.id}`, { token: ctx.freeToken })).status,
      403
    );
  });

  await test('API: non-official trade created then deleted by admin disappears from the registry', async () => {
    const created = await upsertTradeByCode(`admin_del_${Date.now().toString(36)}`, 'Admin Disposable');
    ok(created, 'dynamic trade created');

    const res = await apiRequest(ctx.server!.baseUrl, 'DELETE', `/api/v1/trades/${created!.id}`, { token: ctx.adminToken });
    assertEq(res.status, 204, 'non-official trade with no materials is deletable');

    const after = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/trades');
    ok(!after.body.data.some((t: any) => t.id === created!.id), 'deleted trade is gone from the public list');
  });

  await test('API: includeInactive without an admin session keeps the active-only contract', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/trades?includeInactive=true', { token: ctx.freeToken });
    assertEq(res.status, 200);
    for (const t of res.body.data) {
      ok(t.isActive === true, 'non-admin callers never receive deactivated trades');
    }
  });

  await test('API: trade service management is admin-only (FREE → 403, unknown trade → 404)', async () => {
    const free = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/trades/whatever/services', {
      body: { nameFr: 'X' },
      token: ctx.freeToken,
    });
    assertEq(free.status, 403);

    const unknown = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/trades/00000000-0000-0000-0000-000000000000/services', {
      body: { nameFr: 'X' },
      token: ctx.adminToken,
    });
    assertEq(unknown.status, 404);
  });

  await test('API discovery lists the Admin → Métiers endpoints', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1');
    assertEq(res.status, 200);
    const endpoints: string[] = Array.isArray(res.body.endpoints) ? res.body.endpoints : [];
    ok(endpoints.some((e) => e.startsWith('PATCH  /api/v1/trades/:id')), 'PATCH trade endpoint listed');
    ok(endpoints.some((e) => e.startsWith('DELETE /api/v1/trades/:id')), 'DELETE trade endpoint listed');
    ok(endpoints.some((e) => e.startsWith('POST   /api/v1/trades/:id/services')), 'trade services endpoint listed');
  });

  // Keep the shared store clean for the suites that run after this one.
  memoryStore.resetAll();
}
