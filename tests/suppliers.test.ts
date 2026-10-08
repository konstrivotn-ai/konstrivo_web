/**
 * Phase 2 — Supplier Import Tests
 */
import { apiRequest } from './setup';
import { test, assertEq, ok, ctx } from './run';

let importId = '';
// F9 — supplier:products (scope='supplier') is now REALLY enforced on
// POST /api/v1/suppliers/upload, so the upload flow must run as a supplier
// (role 'fournisseur'); other roles are rejected with 403.
let supplierToken = '';

export async function runSupplierTests() {
  console.log('\n📥 Supplier Import Tests\n');

  await test('setup: register a supplier (fournisseur) for the upload flow', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/register', {
      body: {
        email: 'supplier.upload@test.tn',
        password: 'password123',
        fullName: 'Supplier Upload',
        phone: '+21611111111',
        companyName: 'Supplier Upload Co',
        role: 'fournisseur',
      },
    });
    assertEq(res.status, 201);
    ok(res.body.token, 'supplier registration must return a token');
    supplierToken = res.body.token;
  });

  await test('valid CSV upload creates import with SHA-256', async () => {
    const csvContent = 'Reference,Designation,Categorie,Unite,Prix_HT_TND\r\nPLA-TEST-001,Test Plaque,placo,unit,31.500\r\nPLA-TEST-002,Test Rail,placo,unit,7.800';
    const boundary = '----FormBoundary7MA4YWxkTrZu0gW';
    const rawBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="catalogue_test.csv"',
      'Content-Type: text/csv',
      '',
      csvContent,
      `--${boundary}--`,
    ].join('\r\n');

    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/suppliers/upload', {
      token: supplierToken,
      rawBody,
      contentType: `multipart/form-data; boundary=${boundary}`,
    });
    assertEq(res.status, 201);
    ok(res.body.data.id);
    ok(res.body.data.fileSha256, 'SHA-256 hash must be computed');
    assertEq(res.body.data.status, 'PENDING_APPROVAL');
    importId = res.body.data.id;
  });

  await test('F9: upload with a non-supplier role → 403 (supplier:products scope gate)', async () => {
    const csvContent = 'Reference,Designation,Categorie,Unite,Prix_HT_TND\r\nPLA-TEST-004,Test Plaque F9,placo,unit,32.000';
    const boundary = '----FormBoundaryF9ScopeGate42';
    const rawBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="scope_probe.csv"',
      'Content-Type: text/csv',
      '',
      csvContent,
      `--${boundary}--`,
    ].join('\r\n');
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/suppliers/upload', {
      token: ctx.proToken, // engineer role — NOT the supplier scope
      rawBody,
      contentType: `multipart/form-data; boundary=${boundary}`,
    });
    assertEq(res.status, 403, 'supplier:products must be enforced server-side for non-supplier roles');
  });

  await test('import status retrievable by owner', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', `/api/v1/suppliers/imports/${importId}`, {
      token: supplierToken,
    });
    assertEq(res.status, 200);
    ok(['UPLOADED', 'PARSED', 'PENDING_APPROVAL'].includes(res.body.data.status));
  });

  await test('non-admin without SUPPLIER_IMPORT_APPROVE blocked → 403', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', `/api/v1/suppliers/imports/${importId}/approve`, {
      token: ctx.freeToken,
    });
    assertEq(res.status, 403);
  });

  await test('approval by admin works and does NOT mutate official catalog', async () => {
    const materialsRes = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/materials?trade=placo&limit=1');
    const matId = materialsRes.body.data[0]?.id;
    const priceBefore = await apiRequest(
      ctx.server!.baseUrl, 'GET',
      `/api/v1/prices?materialId=${matId}&source=OFFICIAL_DEFAULT`
    );
    const beforePrice = priceBefore.body.data[0]?.price;

    const approveRes = await apiRequest(ctx.server!.baseUrl, 'POST', `/api/v1/suppliers/imports/${importId}/approve`, {
      token: ctx.adminToken,
    });
    assertEq(approveRes.status, 200);

    const priceAfter = await apiRequest(
      ctx.server!.baseUrl, 'GET',
      `/api/v1/prices?materialId=${matId}&source=OFFICIAL_DEFAULT`
    );
    assertEq(priceAfter.body.data[0]?.price, beforePrice, 'official price must be UNCHANGED');
  });

  await test('upload rejects non-multipart/non-csv content type → 415', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/suppliers/upload', {
      token: supplierToken,
      rawBody: 'not a csv file at all just text',
      contentType: 'application/octet-stream',
    });
    ok([400, 415].includes(res.status), `expected 400 or 415, got ${res.status}`);
  });
}
