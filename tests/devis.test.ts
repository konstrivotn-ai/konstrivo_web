/**
 * Phase 2 — Devis Tests
 */
import { apiRequest } from './setup';
import { test, assertEq, ok, ctx } from './run';

let devisId = '';
let createdDevisVersion = 1;

export async function runDevisTests() {
  console.log('\n📄 Devis Tests\n');

  await test('create devis → 201', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/devis', {
      token: ctx.freeToken,
      body: {
        clientName: 'Test Client',
        projectTitle: 'Faux Plafond BA13',
        items: [
          { title: 'Plaque BA13', quantity: 10, unitPrice: 30.0, unit: 'unit' },
          { title: "Main d'œuvre", quantity: 1, unitPrice: 150.0, unit: 'forfait' },
        ],
      },
    });
    assertEq(res.status, 201);
    ok(res.body.data.id);
    devisId = res.body.data.id;
    createdDevisVersion = res.body.data.version;
    assertEq(createdDevisVersion, 1);
    ok(res.body.data.devisNumber.startsWith('DEV-'), 'devisNumber format');
    ok(typeof res.body.data.total === 'number');
    // Labor/materials classification must match the frontend convention
    // ("Main d'œuvre" with ligature → labor; Plaque BA13 → materials)
    assertEq(res.body.data.subtotalLabor, 150, "labor line must be classified as labor");
    assertEq(res.body.data.subtotalMaterials, 300, "material line must be classified as materials");
  });

  await test('list devis is company-scoped and paginated', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/devis?limit=5', {
      token: ctx.freeToken,
    });
    assertEq(res.status, 200);
    ok(Array.isArray(res.body.data));
    ok(res.body.data.length >= 1);
  });

  await test('company isolation: other company cannot read devis → 403', async () => {
    const readRes = await apiRequest(ctx.server!.baseUrl, 'GET', `/api/v1/devis/${devisId}`, {
      token: ctx.proToken,
    });
    assertEq(readRes.status, 403);

    const ownReadRes = await apiRequest(ctx.server!.baseUrl, 'GET', `/api/v1/devis/${devisId}`, {
      token: ctx.freeToken,
    });
    assertEq(ownReadRes.status, 200);
  });

  await test('update with correct version succeeds (optimistic)', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'PUT', `/api/v1/devis/${devisId}`, {
      token: ctx.freeToken,
      body: { version: createdDevisVersion, clientName: 'Updated Client' },
    });
    assertEq(res.status, 200);
    assertEq(res.body.data.version, createdDevisVersion + 1);
  });

  await test('stale version update → 409 conflict', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'PUT', `/api/v1/devis/${devisId}`, {
      token: ctx.freeToken,
      body: { version: createdDevisVersion, clientName: 'Stale Update' }, // old version
    });
    assertEq(res.status, 409);
  });

  await test('update without version → 400', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'PUT', `/api/v1/devis/${devisId}`, {
      token: ctx.freeToken,
      body: { clientName: 'No Version' },
    });
    assertEq(res.status, 400);
  });

  await test('idempotent create with Idempotency-Key does not duplicate', async () => {
    const key = `test-key-${Date.now()}`;
    const first = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/devis', {
      token: ctx.freeToken,
      body: { clientName: 'Idempotent Client' },
      idempotencyKey: key,
    });
    assertEq(first.status, 201);
    const second = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/devis', {
      token: ctx.freeToken,
      body: { clientName: 'Idempotent Client' },
      idempotencyKey: key,
    });
    assertEq(second.status, 200);
    assertEq(second.body.data.id, first.body.data.id, 'must return the SAME devis');
    ok(second.body.idempotentReplay === true);
  });

  await test('soft delete → 204; subsequent GET → 404 (not physically deleted)', async () => {
    const delRes = await apiRequest(ctx.server!.baseUrl, 'DELETE', `/api/v1/devis/${devisId}`, {
      token: ctx.freeToken,
    });
    assertEq(delRes.status, 204);
    const readRes = await apiRequest(ctx.server!.baseUrl, 'GET', `/api/v1/devis/${devisId}`, {
      token: ctx.freeToken,
    });
    assertEq(readRes.status, 404);
  });

  await test('nonexistent devis → 404', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/devis/nonexistent-id', {
      token: ctx.freeToken,
    });
    assertEq(res.status, 404);
  });
}
