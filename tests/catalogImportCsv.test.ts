/**
 * Phase A — Admin bulk CSV import tests (POST /api/v1/catalog/import-csv).
 *
 * Contract under test:
 *  - Admin + CATALOG_OFFICIAL_MANAGE only (PRO/FREE → 403).
 *  - Multi-row files are imported server-side inside ONE transaction.
 *  - Any invalid row (unknown trade, bad price, missing reference) aborts the
 *    whole import with 400 + per-row reasons, and NOTHING is written
 *    (all-or-nothing / full rollback).
 *  - Re-uploading the SAME file UPDATES rows in place (no duplicates).
 *  - Official prices of untouched materials stay identical; targeted
 *    materials get their official current price updated in place.
 *  - Company-specific (CUSTOM) prices are never touched.
 *  - Existing Devis documents keep their stored totals (price snapshots).
 *
 * NOTE: the test database does NOT truncate materials/material_prices between
 * runs, so every run uses run-unique code prefixes and relative before/after
 * assertions instead of absolute catalog state.
 */
import { apiRequest } from './setup';
import { test, assertEq, ok, ctx } from './run';

const RUN_TAG = `pa${Date.now().toString(36)}`;
const CSV_HEADER = 'Reference;Nom_Materiau;Categorie;Unite;Prix_TND_HT;Note_Technique;Nom_Arabe';

function csvMultipart(csvContent: string): { rawBody: string; contentType: string } {
  const boundary = `----PhaseABoundary${Math.random().toString(36).slice(2)}`;
  const rawBody = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="catalogue_import.csv"',
    'Content-Type: text/csv',
    '',
    csvContent,
    `--${boundary}--`,
  ].join('\r\n');
  return { rawBody, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function importCsv(csvContent: string, token: string) {
  const { rawBody, contentType } = csvMultipart(csvContent);
  return apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/catalog/import-csv', { token, rawBody, contentType });
}

async function getOfficialPrice(materialId: string): Promise<number | undefined> {
  const res = await apiRequest(ctx.server!.baseUrl, 'GET', `/api/v1/prices?materialId=${materialId}&source=OFFICIAL_DEFAULT`);
  return res.body.data[0]?.price;
}

async function countMaterialsByName(search: string): Promise<number> {
  const res = await apiRequest(ctx.server!.baseUrl, 'GET', `/api/v1/materials?search=${encodeURIComponent(search)}&limit=100`);
  assertEq(res.status, 200);
  return (res.body.data || []).length;
}

async function findMaterialIdByCode(code: string): Promise<string> {
  const res = await apiRequest(ctx.server!.baseUrl, 'GET', `/api/v1/materials?search=${encodeURIComponent(code)}&limit=100`);
  assertEq(res.status, 200);
  const found = (res.body.data || []).find((m: any) => m.code === code);
  return found ? found.id : '';
}

export async function runCatalogImportCsvTests() {
  console.log('\n📥 Phase A — Admin CSV Bulk Import (transactional) Tests\n');

  await test('FREE token blocked → 403', async () => {
    const res = await importCsv(`${CSV_HEADER}\r\n${RUN_TAG}_x1;PhaseA X1;placo;unit;1;;`, ctx.freeToken!);
    assertEq(res.status, 403);
  });
  await test('PRO token blocked → 403 (PRO tier lacks CATALOG_OFFICIAL_MANAGE)', async () => {
    const res = await importCsv(`${CSV_HEADER}\r\n${RUN_TAG}_x2;PhaseA X2;placo;unit;1;;`, ctx.proToken!);
    assertEq(res.status, 403);
  });

  await test('multi-row valid CSV → 200, committed, imported=3 (placo + sols)', async () => {
    const csv = [
      CSV_HEADER,
      `${RUN_TAG}_plq;PhaseA Plaque Test;placo;unit;31.500;Plaque de test;بلاك`,
      `${RUN_TAG}_rail;PhaseA Rail Test;placo;unit;7.800;;`,
      `${RUN_TAG}_parquet;PhaseA Parquet Test;sols;m²;34.000;;`,
    ].join('\r\n');
    const res = await importCsv(csv, ctx.adminToken!);
    assertEq(res.status, 200);
    assertEq(res.body.data.committed, true);
    assertEq(res.body.data.imported, 3, 'three new materials imported');
    assertEq(res.body.data.updated, 0);
    assertEq(res.body.data.failed.length, 0);
    assertEq(res.body.data.totalRows, 3);
    ok(res.body.data.countryCode === 'TN' && res.body.data.currencyCode === 'TND', 'TN/TND default market');
    // Imported rows must be readable through the standard catalog API.
    const list = await apiRequest(ctx.server!.baseUrl, 'GET', `/api/v1/materials?search=${encodeURIComponent('PhaseA')}&limit=100`);
    assertEq(list.status, 200);
    const codes = (list.body.data || []).map((m: any) => m.code);
    ok(codes.includes(`${RUN_TAG}_plq`) && codes.includes(`${RUN_TAG}_rail`) && codes.includes(`${RUN_TAG}_parquet`),
      'all three imported materials must be visible via GET /materials');
  });

  await test('re-uploading the SAME file → NO duplicates (updated=3, imported=0)', async () => {
    const csv = [
      CSV_HEADER,
      `${RUN_TAG}_plq;PhaseA Plaque Test;placo;unit;31.500;Plaque de test;بلاك`,
      `${RUN_TAG}_rail;PhaseA Rail Test;placo;unit;7.800;;`,
      `${RUN_TAG}_parquet;PhaseA Parquet Test;sols;m²;34.000;;`,
    ].join('\r\n');
    const before = await countMaterialsByName('PhaseA');
    const res = await importCsv(csv, ctx.adminToken!);
    assertEq(res.status, 200);
    assertEq(res.body.data.imported, 0, 'no duplicate materials created');
    assertEq(res.body.data.updated, 3, 'existing rows updated in place');
    const after = await countMaterialsByName('PhaseA');
    assertEq(after, before, 'material count unchanged after re-import');
  });

  await test('raw text/csv body (no multipart) also works', async () => {
    const csv = `${CSV_HEADER}\r\n${RUN_TAG}_raw;PhaseA Raw Body Test;plomberie;ml;3.5;;`;
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/catalog/import-csv', {
      token: ctx.adminToken!,
      rawBody: csv,
      contentType: 'text/csv',
    });
    assertEq(res.status, 200);
    assertEq(res.body.data.imported, 1);
  });
  await test('unknown trade (gypsum) → 400 + FULL rollback, nothing written', async () => {
    const csv = [
      CSV_HEADER,
      `${RUN_TAG}rb_ok;PhaseA Rollback OK;placo;unit;10;;`,
      `${RUN_TAG}rb_bad;PhaseA Rollback Bad;gypsum;unit;5;;`,
    ].join('\r\n');
    const res = await importCsv(csv, ctx.adminToken!);
    assertEq(res.status, 400);
    assertEq(res.body.data.committed, false);
    ok(res.body.data.failed.length >= 1, 'per-row failure report');
    ok(String(res.body.data.failed[0].reason).includes('gypsum'), 'reason must name the refused trade');
    ok(String(res.body.data.failed[0].reason).includes('Phase B'), 'reason must point to Phase B');
    // Full rollback: NEITHER row may exist (the valid row must not leak).
    const leaked = await countMaterialsByName('PhaseA Rollback');
    assertEq(leaked, 0, 'valid row must NOT be written when another row fails');
  });

  await test('invalid price → 400 rollback with clear reason', async () => {
    const csv = `${CSV_HEADER}\r\n${RUN_TAG}badprice;PhaseA Bad Price;placo;unit;abc;;`;
    const res = await importCsv(csv, ctx.adminToken!);
    assertEq(res.status, 400);
    ok(String(res.body.data.failed[0].reason).includes('Invalid price'));
    assertEq(await countMaterialsByName('PhaseA Bad Price'), 0);
  });

  await test('missing reference → 400 rollback with clear reason', async () => {
    const csv = `${CSV_HEADER}\r\n;PhaseA NoRef;placo;unit;5;;`;
    const res = await importCsv(csv, ctx.adminToken!);
    assertEq(res.status, 400);
    ok(String(res.body.data.failed[0].reason).includes('Reference'));
    assertEq(await countMaterialsByName('PhaseA NoRef'), 0);
  });

  await test('bad header (missing required columns) → 400', async () => {
    const res = await importCsv('Foo;Bar\r\n1;2', ctx.adminToken!);
    assertEq(res.status, 400);
    ok(String(res.body.error?.message || '').includes('required column'), 'error names the missing columns');
  });

  // Anchor material created via the EXISTING Step 5 endpoint — used to prove
  // the import updates official prices in place while touching nothing else.
  await test('setup anchor material via /catalog/upsert (existing Step 5 path)', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/catalog/upsert', {
      token: ctx.adminToken!,
      body: {
        code: `${RUN_TAG}_anchor`,
        price: 30,
        nameFr: `PhaseA Anchor ${RUN_TAG}`,
        trade: 'placo',
        category: 'placo',
        unit: 'unit',
      },
    });
    assertEq(res.status, 200);
    ok(res.body.data.material?.id, 'anchor material id');
  });
  await test('official price of UNTOUCHED material unchanged; targeted material updated in place', async () => {
    const anchorId = await findMaterialIdByCode(`${RUN_TAG}_anchor`);
    ok(anchorId, 'anchor material found');
    assertEq(await getOfficialPrice(anchorId), 30, 'anchor official price before import');

    // Untouched material from the first import keeps its exact price.
    const plaqueId = await findMaterialIdByCode(`${RUN_TAG}_plq`);
    ok(plaqueId, 'plaque material found');
    assertEq(await getOfficialPrice(plaqueId), 31.5, 'untouched official price stays 31.5');

    // Import that updates ONLY the anchor's official price.
    const csv = `${CSV_HEADER}\r\n${RUN_TAG}_anchor;PhaseA Anchor;placo;unit;33;;`;
    const res = await importCsv(csv, ctx.adminToken!);
    assertEq(res.status, 200);
    assertEq(res.body.data.updated, 1);
    assertEq(res.body.data.imported, 0);
    assertEq(await getOfficialPrice(anchorId), 33, 'official price updated in place by the import');
  });

  await test('company-specific CUSTOM price is NEVER touched by the import', async () => {
    const anchorId = await findMaterialIdByCode(`${RUN_TAG}_anchor`);
    ok(anchorId, 'anchor material found');

    // PRO tier has PRICES_CUSTOM_EDIT → company-scoped CUSTOM price.
    const custom = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/prices/custom', {
      token: ctx.proToken!,
      body: { materialId: anchorId, price: 99, currency: 'TND', market: 'tn' },
    });
    assertEq(custom.status, 201, 'company price created');

    // The import updates the OFFICIAL price of the same material…
    const csv = `${CSV_HEADER}\r\n${RUN_TAG}_anchor;PhaseA Anchor;placo;unit;36;;`;
    const res = await importCsv(csv, ctx.adminToken!);
    assertEq(res.status, 200);

    // …while the company-specific CUSTOM row stays byte-identical.
    const customAfter = await apiRequest(ctx.server!.baseUrl, 'GET', `/api/v1/prices?materialId=${anchorId}&source=CUSTOM`);
    assertEq(customAfter.status, 200);
    assertEq(customAfter.body.data[0]?.price, 99, 'company price untouched');
    assertEq(await getOfficialPrice(anchorId), 36, 'official price updated');
  });

  await test('existing Devis totals unchanged after imports (price snapshots)', async () => {
    const create = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/devis', {
      token: ctx.freeToken!,
      body: {
        clientName: `PhaseA Client ${RUN_TAG}`,
        projectTitle: 'PhaseA Snapshot',
        items: [{ title: 'Plaque BA13', quantity: 2, unitPrice: 30.0, unit: 'unit' }],
      },
    });
    assertEq(create.status, 201);
    const devisId = create.body.data.id;
    const totalBefore = create.body.data.total;

    const csv = `${CSV_HEADER}\r\n${RUN_TAG}_post;PhaseA Post Devis Import;peinture;l;12;;`;
    const res = await importCsv(csv, ctx.adminToken!);
    assertEq(res.status, 200);

    const read = await apiRequest(ctx.server!.baseUrl, 'GET', `/api/v1/devis/${devisId}`, { token: ctx.freeToken! });
    assertEq(read.status, 200);
    assertEq(read.body.data.total, totalBefore, 'devis total must remain identical');
  });
}