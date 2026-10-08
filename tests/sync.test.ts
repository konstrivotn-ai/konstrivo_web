/**
 * Phase 2 — Sync Tests
 */
import { apiRequest } from './setup';
import { test, assertEq, ok, ctx } from './run';

export async function runSyncTests() {
  console.log('\n🔄 Sync Tests\n');

  await test('push operation applies successfully', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/sync/push', {
      token: ctx.freeToken,
      body: {
        clientId: 'test-client-1',
        operations: [{
          id: 'op_1',
          entityType: 'devis',
          entityId: 'local_devis_1',
          operationType: 'create',
          clientVersion: 1,
          clientTimestamp: new Date().toISOString(),
          payload: { clientName: 'Synced Devis' },
        }],
      },
    });
    assertEq(res.status, 200);
    assertEq(res.body.applied.length, 1);
    assertEq(res.body.conflicts.length, 0);
  });

  await test('duplicate push operation is idempotent', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/sync/push', {
      token: ctx.freeToken,
      body: {
        clientId: 'test-client-1',
        operations: [{
          id: 'op_1',
          entityType: 'devis',
          entityId: 'local_devis_1',
          operationType: 'create',
          clientVersion: 1,
          clientTimestamp: new Date().toISOString(),
          payload: { clientName: 'Synced Devis' },
        }],
      },
    });
    assertEq(res.status, 200);
    assertEq(res.body.applied.length, 1, 'should return existing applied op');
  });

  await test('stale version push → conflict reported', async () => {
    await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/sync/push', {
      token: ctx.freeToken,
      body: {
        clientId: 'test-client-1',
        operations: [{
          id: 'op_v2',
          entityType: 'devis',
          entityId: 'local_devis_conflict',
          operationType: 'update',
          clientVersion: 1,
          clientTimestamp: new Date().toISOString(),
          payload: { note: 'v2' },
        }],
      },
    });
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/sync/push', {
      token: ctx.freeToken,
      body: {
        clientId: 'test-client-2',
        operations: [{
          id: 'op_stale',
          entityType: 'devis',
          entityId: 'local_devis_conflict',
          operationType: 'update',
          clientVersion: 1,
          clientTimestamp: new Date().toISOString(),
          payload: { note: 'v1-stale' },
        }],
      },
    });
    assertEq(res.status, 200);
    assertEq(res.body.conflicts.length, 1, 'conflict must be detected');
  });

  await test('pull returns synced operations with serverTime', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/sync/pull', {
      token: ctx.freeToken,
      body: {},
    });
    assertEq(res.status, 200);
    ok(Array.isArray(res.body.data));
    ok(res.body.serverTime);
  });

  await test('sync requires authentication → 401', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/sync/pull', { body: {} });
    assertEq(res.status, 401);
  });
}
