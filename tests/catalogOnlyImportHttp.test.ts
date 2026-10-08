/**
 * CATALOG-ONLY IMPORT — REAL HTTP REGRESSION (preview/import on the TEST DB).
 *
 * Exercises the ACTUAL pipeline the Admin UI calls (POST /api/v1/catalog/preview
 * then POST /api/v1/catalog/import) with the real fixture
 * `tests/fixtures/catalog/KONSTRIVO_MASTER_CATALOG_FINAL.csv`
 * (170 data rows, NO price_ht column) and asserts:
 *   1. /preview → 200, canImport=true, validCount=170, rejectedCount=0,
 *      unmappedRequired does NOT contain price_ht (never presented blocking).
 *   2. /import → 170 materials written, ZERO new `material_prices` rows
 *      (total price count before == after; sample fixture codes price-less),
 *      i.e. no price is invented (never 0) and no current price changes.
 *   3. Re-import → no duplicates (imported=0/updated=170, still 1 row per
 *      code, still zero prices).
 *   4. A CSV WITH price_ht → the exact legacy behaviour (rows written WITH
 *      their prices, empty price cell still rejected per row).
 *
 * TEST DB ONLY: run through tests/runPhaseC.ts (NODE_ENV=test,
 * TEST_DB_CONFIRM=1); the harness fail-closed refuses any non-test database.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRequest } from './setup';
import { test, assertEq, ok, ctx } from './run';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_NAME = 'KONSTRIVO_MASTER_CATALOG_FINAL.csv';
const FIXTURE_CSV = fs.readFileSync(path.join(HERE, 'fixtures', 'catalog', FIXTURE_NAME), 'utf8');
const RUN_TAG = `co${Date.now().toString(36)}`;

// ── multipart helper (binary-safe, mirrors catalogImportPhaseC.test.ts) ─────
function multipartBody(parts: Array<{ name: string; filename?: string; contentType?: string; data: Buffer | string }>): { rawBody: Buffer; contentType: string } {
  const boundary = `----CatalogOnly${Math.random().toString(36).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`;
    if (part.filename) head += `; filename="${part.filename}"`;
    head += '\r\n';
    if (part.contentType) head += `Content-Type: ${part.contentType}\r\n`;
    head += '\r\n';
    chunks.push(Buffer.from(head, 'utf8'));
    chunks.push(Buffer.isBuffer(part.data) ? part.data : Buffer.from(String(part.data), 'utf8'));
    chunks.push(Buffer.from('\r\n', 'utf8'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return { rawBody: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function upload(p: string, file: { data: Buffer | string; filename: string; contentType: string }) {
  const { rawBody, contentType } = multipartBody([
    { name: 'file', filename: file.filename, contentType: file.contentType, data: file.data },
  ]);
  return apiRequest(ctx.server!.baseUrl, 'POST', p, { token: ctx.adminToken!, rawBody, contentType });
}

/** Direct read-only count on the TEST DB (same helper style as the audit probe). */
async function dbCount(raw: string): Promise<number> {
  const { getDatabase } = await import('../server/db/client');
  const { sql } = await import('drizzle-orm');
  const db = await getDatabase();
  if (!db) throw new Error('no database connection');
  const r: any = await db.execute(sql.raw(raw));
  const rows: any[] = r?.rows ?? r ?? [];
  return Number(rows[0]?.n ?? 0);
}

// First + last material_code of the real 170-row fixture.
const SAMPLE_CODES = `'GBS-001','SEC-010'`;

export async function runCatalogOnlyImportTests() {
  console.log('\n🧭 CATALOG-ONLY IMPORT — REAL HTTP (Master Catalog 170 rows, no price_ht)\n');

  await test('C1. preview: 200 → 170 importables / 0 rejetées, price_ht not blocking', async () => {
    const res = await upload('/api/v1/catalog/preview', { data: FIXTURE_CSV, filename: FIXTURE_NAME, contentType: 'text/csv' });
    assertEq(res.status, 200);
    const d = res.body.data;
    assertEq(d.totalRows, 170, `totalRows=${d.totalRows}`);
    assertEq(d.validCount, 170, `validCount=${d.validCount}`);
    assertEq(d.rejectedCount, 0, JSON.stringify((d.rejected || []).slice(0, 3)));
    assertEq(d.canImport, true, 'a Master Catalog without prices must be importable');
    ok(!Array.isArray(d.unmappedRequired) || !d.unmappedRequired.includes('price_ht'),
      `unmappedRequired must not block price_ht (got ${JSON.stringify(d.unmappedRequired)})`);
    assertEq(d.appliedMapping.price_ht, undefined, 'no price column can be mapped');
    assertEq(d.sampleRows[0].price_ht, undefined, 'no price shown — none is invented');
  });

  await test('C2. import: 170 materials written, ZERO material_prices created, existing prices untouched', async () => {
    const pricesBefore = await dbCount('SELECT count(*) AS n FROM material_prices');
    const res = await upload('/api/v1/catalog/import', { data: FIXTURE_CSV, filename: FIXTURE_NAME, contentType: 'text/csv' });
    assertEq(res.status, 200);
    const d = res.body.data;
    assertEq(d.committed, true);
    assertEq(d.rejectedCount, 0, 'preview == import: no row rejected');
    assertEq(d.rowsImported, 170, `rowsImported=${d.rowsImported}`);
    assertEq((d.imported ?? 0) + (d.updated ?? 0), 170, 'imported+updated = 170');
    // The fixture's materials really landed…
    const mats = await dbCount(`SELECT count(*) AS n FROM materials WHERE code IN (${SAMPLE_CODES})`);
    assertEq(mats, 2, `sample fixture materials in DB=${mats}`);
    // …but NOT ONE price row was created for them (no 0, no invented value)…
    const samplePrices = await dbCount(
      `SELECT count(*) AS n FROM material_prices mp JOIN materials m ON m.id = mp.material_id WHERE m.code IN (${SAMPLE_CODES})`
    );
    assertEq(samplePrices, 0, `material_prices for fixture codes=${samplePrices}`);
    // …and the TOTAL price count is unchanged → no current price was touched.
    const pricesAfter = await dbCount('SELECT count(*) AS n FROM material_prices');
    assertEq(pricesAfter, pricesBefore, `total material_prices ${pricesBefore} → ${pricesAfter} (must be identical)`);
  });

  await test('C3. re-import the same file → no duplicates, still zero prices', async () => {
    const pricesBefore = await dbCount('SELECT count(*) AS n FROM material_prices');
    const res = await upload('/api/v1/catalog/import', { data: FIXTURE_CSV, filename: FIXTURE_NAME, contentType: 'text/csv' });
    assertEq(res.status, 200);
    const d = res.body.data;
    assertEq(d.committed, true);
    assertEq(d.imported, 0, 'no NEW material may be created on re-import');
    assertEq(d.updated, 170, 'every existing material is updated in place');
    const mats = await dbCount(`SELECT count(*) AS n FROM materials WHERE code IN (${SAMPLE_CODES})`);
    assertEq(mats, 2, `sample fixture materials after re-import=${mats} (must stay 2 = 1 per code)`);
    const samplePrices = await dbCount(
      `SELECT count(*) AS n FROM material_prices mp JOIN materials m ON m.id = mp.material_id WHERE m.code IN (${SAMPLE_CODES})`
    );
    assertEq(samplePrices, 0, `material_prices after re-import=${samplePrices}`);
    const pricesAfter = await dbCount('SELECT count(*) AS n FROM material_prices');
    assertEq(pricesAfter, pricesBefore, 'total material_prices unchanged after re-import');
  });

  await test('C4. CSV WITH price_ht → legacy behaviour intact (prices written, empty cell rejected)', async () => {
    const csv = [
      'material_code,material_name,trade_code,price_ht,category,unit',
      `${RUN_TAG}b1,Co Priced A ${RUN_TAG},placo,31.5,planches,unit`,
      `${RUN_TAG}b2,Co Priced B ${RUN_TAG},carrelage,12.5,colles,kg`,
      `${RUN_TAG}b3,Co Priced Empty ${RUN_TAG},carrelage,,colles,kg`,
    ].join('\r\n');
    const pricesBefore = await dbCount('SELECT count(*) AS n FROM material_prices');

    const p = await upload('/api/v1/catalog/preview', { data: csv, filename: 'priced.csv', contentType: 'text/csv' });
    assertEq(p.status, 200);
    assertEq(p.body.data.canImport, true);
    assertEq(p.body.data.validCount, 2, 'the 2 priced rows are importable');
    assertEq(p.body.data.rejectedCount, 1, 'the empty price cell is still rejected');
    ok(String(p.body.data.rejected?.[0]?.reason || '').includes('Prix vide'), p.body.data.rejected?.[0]?.reason);
    assertEq(p.body.data.appliedMapping.price_ht, 'price_ht', 'price_ht maps exactly as before');
    assertEq((p.body.data.unmappedRequired || []).length, 0, 'nothing blocking on a priced file');

    const res = await upload('/api/v1/catalog/import', { data: csv, filename: 'priced.csv', contentType: 'text/csv' });
    assertEq(res.status, 200);
    assertEq(res.body.data.committed, true);
    assertEq(res.body.data.rowsImported, 2, 'preview == import');
    assertEq(res.body.data.rejectedCount, 1, 'the empty-price row is NOT written');
    // Both priced materials now carry THEIR prices (nothing invented).
    const priced = await dbCount(
      `SELECT count(*) AS n FROM material_prices mp JOIN materials m ON m.id = mp.material_id ` +
      `WHERE m.code IN ('${RUN_TAG}b1','${RUN_TAG}b2') AND mp.is_current = true AND mp.is_deleted = false ` +
      `AND ((m.code = '${RUN_TAG}b1' AND mp.unit_price = 31.5) OR (m.code = '${RUN_TAG}b2' AND mp.unit_price = 12.5))`
    );
    assertEq(priced, 2, `priced rows with their exact price=${priced}`);
    const pricesAfter = await dbCount('SELECT count(*) AS n FROM material_prices');
    assertEq(pricesAfter - pricesBefore, 2, `exactly +2 material_prices rows, got ${pricesAfter - pricesBefore}`);
    const rejected = await dbCount(
      `SELECT count(*) AS n FROM materials WHERE code = '${RUN_TAG}b3'`
    );
    assertEq(rejected, 0, 'the rejected row wrote NOTHING');
  });
}

