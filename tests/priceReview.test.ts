import { apiRequest } from './setup';
import { test, assertEq, ok, ctx } from './run';
import { upsertMaterialByCode } from '../server/repositories/drizzleMaterialRepository';
import { submitPendingPriceUpdate } from '../server/repositories/drizzlePriceRepository';

export async function runPriceReviewTests() {
  console.log('\n🔧 Price Review API Tests\n');

  let pendingId = '';

  await test('create pending price update via repository', async () => {
    // Ensure a material exists
    const mat = await upsertMaterialByCode({ code: 'test_review_material', trade: 'placo', category: 'placo', nameFr: 'Test Review Mat', baseUnit: 'unit' });
    ok(mat && mat.id);
    const p = await submitPendingPriceUpdate({ materialCode: 'test_review_material', price: 123.45, currencyCode: 'TND', countryCode: 'TN' });
    ok(p && p.id);
    pendingId = p.id;
  });

  await test('list pending price updates includes created row', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', `/api/v1/admin/prices/review?status=pending`, { token: ctx.adminToken });
    assertEq(res.status, 200);
    ok(Array.isArray(res.body.data));
    const found = res.body.data.find((r: any) => r.id === pendingId);
    ok(found, 'expected pending row in list');
  });

  await test('review pending update via API', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', `/api/v1/admin/prices/review/${pendingId}/review`, { token: ctx.adminToken });
    assertEq(res.status, 200);
    assertEq(res.body.data.reviewStatus, 'reviewed');
  });

  await test('publish reviewed update via API', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', `/api/v1/admin/prices/review/${pendingId}/publish`, { token: ctx.adminToken });
    assertEq(res.status, 200);
    assertEq(res.body.data.reviewStatus, 'published');
    assertEq(res.body.data.isCurrent, true);
  });

  await test('reject path via API', async () => {
    const mat = await upsertMaterialByCode({ code: 'test_review_material2', trade: 'placo', category: 'placo', nameFr: 'Test Review Mat 2', baseUnit: 'unit' });
    const p2 = await submitPendingPriceUpdate({ materialCode: 'test_review_material2', price: 10, currencyCode: 'TND', countryCode: 'TN' });
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', `/api/v1/admin/prices/review/${p2.id}/reject`, { token: ctx.adminToken, body: { reason: 'bad data' } });
    assertEq(res.status, 200);
    assertEq(res.body.data.reviewStatus, 'rejected');
  });

  // ── Phase 3C — manual Admin market update (POST /catalog/price-updates) ─────
  // Proves the manual_admin normalization: market/currency are stored UPPERCASE,
  // the TN/TND defaults are preserved, the created row stays `pending` and is
  // discoverable in the existing review queue, and invalid prices are rejected.

  await test('manual admin update stores lowercase country/currency as uppercase', async () => {
    const mat = await upsertMaterialByCode({ code: 'test_review_manual_lower', trade: 'placo', category: 'placo', nameFr: 'Test Review Manual Lower', baseUnit: 'unit' });
    ok(mat && mat.id);
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/catalog/price-updates', {
      token: ctx.adminToken,
      body: { materialCode: 'test_review_manual_lower', price: 12.5, countryCode: 'tn', currencyCode: 'tnd' },
    });
    assertEq(res.status, 201);
    assertEq(res.body.data.countryCode, 'TN');
    assertEq(res.body.data.currencyCode, 'TND');
  });

  await test('manual admin update defaults omitted country/currency to TN/TND', async () => {
    const mat = await upsertMaterialByCode({ code: 'test_review_manual_defaults', trade: 'placo', category: 'placo', nameFr: 'Test Review Manual Defaults', baseUnit: 'unit' });
    ok(mat && mat.id);
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/catalog/price-updates', {
      token: ctx.adminToken,
      body: { materialCode: 'test_review_manual_defaults', price: 7 },
    });
    assertEq(res.status, 201);
    assertEq(res.body.data.countryCode, 'TN');
    assertEq(res.body.data.currencyCode, 'TND');
  });

  await test('manual admin update stays pending and enters the existing review queue', async () => {
    const mat = await upsertMaterialByCode({ code: 'test_review_manual_pending', trade: 'placo', category: 'placo', nameFr: 'Test Review Manual Pending', baseUnit: 'unit' });
    ok(mat && mat.id);
    const created = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/catalog/price-updates', {
      token: ctx.adminToken,
      body: { materialCode: 'test_review_manual_pending', price: 33, countryCode: 'tn', currencyCode: 'tnd' },
    });
    assertEq(created.status, 201);
    assertEq(created.body.data.reviewStatus, 'pending');
    assertEq(created.body.data.isCurrent, false);

    // The queue's market filter is an exact match, so finding the row under 'TN'
    // proves the normalized (uppercase) market was persisted.
    const queue = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/admin/prices/review?status=pending&countryCode=TN', { token: ctx.adminToken });
    assertEq(queue.status, 200);
    ok(Array.isArray(queue.body.data));
    const found = queue.body.data.find((r: any) => r.id === created.body.data.id);
    ok(found, 'expected manually created pending row in the review queue');
    assertEq(found.reviewStatus, 'pending');
  });

  await test('manual admin update rejects negative price', async () => {
    const mat = await upsertMaterialByCode({ code: 'test_review_manual_negative', trade: 'placo', category: 'placo', nameFr: 'Test Review Manual Negative', baseUnit: 'unit' });
    ok(mat && mat.id);
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/catalog/price-updates', {
      token: ctx.adminToken,
      body: { materialCode: 'test_review_manual_negative', price: -5 },
    });
    assertEq(res.status, 422);
    ok(res.body.error, 'expected a validation error body');

    // A rejected price must never create a pending row.
    const queue = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/admin/prices/review?status=pending&countryCode=TN', { token: ctx.adminToken });
    ok(Array.isArray(queue.body.data));
    ok(!queue.body.data.some((r: any) => r.code === 'test_review_manual_negative'), 'rejected price must not create a pending row');
  });

  await test('manual admin update rejects non-numeric price', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/catalog/price-updates', {
      token: ctx.adminToken,
      body: { materialCode: 'test_review_manual_nonnumeric', price: 'not-a-number' },
    });
    assertEq(res.status, 422);
    ok(res.body.error, 'expected a validation error body');
  });
}
