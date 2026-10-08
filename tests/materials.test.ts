/**
 * Phase 2 — Materials & Prices Tests
 */
import { apiRequest } from './setup';
import { test, assertEq, ok, ctx } from './run';

export async function runMaterialPriceTests() {
  console.log('\n📦 Materials & Prices Tests\n');

  await test('authorization: FREE user blocked from custom prices → 403', async () => {
    const materialsRes = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/materials?limit=1');
    const materialId = materialsRes.body.data[0]?.id;
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/prices/custom', {
      token: ctx.freeToken,
      body: { materialId, price: 42.5 },
    });
    assertEq(res.status, 403);
  });

  await test('materials list returns seeded data', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/materials?limit=5');
    assertEq(res.status, 200);
    ok(Array.isArray(res.body.data));
    ok(res.body.data.length > 0, 'should have seeded materials');
    ok(typeof res.body.total === 'number');
  });

  await test('materials filtering by trade=placo', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/materials?trade=placo&limit=100');
    assertEq(res.status, 200);
    ok(res.body.data.length > 0);
    for (const m of res.body.data) {
      assertEq(m.trade, 'placo');
    }
  });

  await test('materials search by name', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/materials?search=BA13&limit=10');
    assertEq(res.status, 200);
    ok(res.body.data.length > 0);
  });

  await test('materials pagination works', async () => {
    const page1 = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/materials?page=1&limit=3');
    const page2 = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/materials?page=2&limit=3');
    assertEq(page1.body.page, 1);
    assertEq(page2.body.page, 2);
    ok(page1.body.data.length <= 3);
    ok(page2.body.data.length <= 3);
    if (page1.body.total > 3) {
      ok(page1.body.data[0].id !== page2.body.data[0].id, 'pages should have different items');
    }
  });

  await test('single material by id', async () => {
    const listRes = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/materials?limit=1');
    const id = listRes.body.data[0].id;
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', `/api/v1/materials/${id}`);
    assertEq(res.status, 200);
    assertEq(res.body.data.id, id);
  });

  await test('nonexistent material → 404', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/materials/nonexistent_material_xyz');
    assertEq(res.status, 404);
  });

  await test('official prices readable with source filter', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/prices?source=OFFICIAL_DEFAULT&limit=5');
    assertEq(res.status, 200);
    ok(res.body.data.length > 0);
    for (const p of res.body.data) {
      assertEq(p.source, 'OFFICIAL_DEFAULT');
      ok(p.materialId, 'price must reference a material');
      ok(typeof p.price === 'number');
    }
  });

  await test('PRO user allowed to create custom prices → 201', async () => {
    const materialsRes = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/materials?limit=1');
    const materialId = materialsRes.body.data[0]?.id;
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/prices/custom', {
      token: ctx.proToken,
      body: { materialId, price: 42.5 },
    });
    assertEq(res.status, 201);
    assertEq(res.body.data.price, 42.5);
  });

  await test('custom price without token → 401', async () => {
    const materialsRes = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/materials?limit=1');
    const materialId = materialsRes.body.data[0]?.id;
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/prices/custom', {
      body: { materialId, price: 10 },
    });
    assertEq(res.status, 401);
  });

  await test('invalid price type → 400/422', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/prices/custom', {
      token: ctx.proToken,
      body: { materialId: 'some_id', price: 'not-a-number' },
    });
    ok([400, 422].includes(res.status), `expected 400 or 422, got ${res.status}`);
  });

  await test('custom price for nonexistent material → 404', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/prices/custom', {
      token: ctx.proToken,
      body: { materialId: 'nonexistent_xyz', price: 10 },
    });
    assertEq(res.status, 404);
  });
}
