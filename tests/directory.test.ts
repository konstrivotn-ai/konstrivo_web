/**
 * Phase 2 — Artisan Directory, Subscription, and Error-Format Tests
 */
import { apiRequest } from './setup';
import { test, assertEq, ok, ctx } from './run';

export async function runDirectoryTests() {
  console.log('\n💳 Subscription Tests\n');

  await test('subscriptions/me returns subscription + server-calculated entitlements', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/subscriptions/me', {
      token: ctx.freeToken,
    });
    assertEq(res.status, 200);
    ok(res.body.data.subscription, 'subscription should be present');
    ok(Array.isArray(res.body.data.entitlements));
    assertEq(res.body.data.entitlements.includes('PRICES_CUSTOM_EDIT'), false,
      'FREE tier must NOT have PRICES_CUSTOM_EDIT');
  });

  await test('subscriptions/me requires authentication → 401', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/subscriptions/me');
    assertEq(res.status, 401);
  });

  console.log('\n👷 Artisan Directory Tests\n');

  await test('artisans list is public and paginated', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/artisans?limit=5');
    assertEq(res.status, 200);
    ok(res.body.data.length > 0);
    for (const a of res.body.data) {
      ok(!a.passwordHash, 'no private info leaked');
      ok(!('userId' in a), 'userId not exposed publicly');
    }
  });

  await test('artisan filtering by trade=plomberie', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/artisans?trade=plomberie');
    assertEq(res.status, 200);
    ok(res.body.data.length > 0);
    for (const a of res.body.data) {
      assertEq(a.trade, 'plomberie');
    }
  });

  await test('artisan pro=true filter works', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/artisans?pro=true');
    assertEq(res.status, 200);
    for (const a of res.body.data) {
      assertEq(a.isPro, true);
    }
  });

  await test('single artisan by id', async () => {
    const listRes = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/artisans?limit=1');
    const id = listRes.body.data[0].id;
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', `/api/v1/artisans/${id}`);
    assertEq(res.status, 200);
    assertEq(res.body.data.id, id);
  });

  await test('nonexistent artisan → 404', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/artisans/nonexistent_xyz');
    assertEq(res.status, 404);
  });

  console.log('\n⚠️ Error Format Tests\n');

  await test('errors use consistent format { error: { code, message } }', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/materials/nonexistent_for_error_format');
    assertEq(res.status, 404);
    ok(res.body.error, 'error object present');
    ok(res.body.error.code, 'error.code present');
    ok(res.body.error.message, 'error.message present');
  });

  await test('API discovery endpoint lists all endpoints', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/');
    assertEq(res.status, 200);
    ok(res.body.endpoints.length > 15, 'all endpoints listed');
  });
}
