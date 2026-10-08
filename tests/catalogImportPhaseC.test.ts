/**
 * Phase C — Excel/XLSX + Smart Mapping import tests
 * (POST /api/v1/catalog/preview + POST /api/v1/catalog/import).
 *
 * Contract under test:
 *  1.  XLSX files parse successfully (same pipeline as CSV).
 *  2.  CSV keeps working through the Smart Mapping flow.
 *  3.  Supplier-style headers (Référence/Désignation/Unité/Prix HT/TVA/…)
 *      are detected and suggested automatically (generic mapping).
 *  4.  Smart mapping produces correct canonical fields (material_code,
 *      material_name, trade_code, price_ht, unit, tva_rate…).
 *  5.  A missing required mapping BLOCKS the import (nothing written).
 *  6.  Invalid prices are rejected before any database write.
 *  7.  Invalid XLSX payloads are rejected safely (400, no crash, no leak).
 *  8.  Preview NEVER writes to the database.
 *  9.  A valid preview→import creates/updates the expected catalog records.
 *  10. Dynamic trades (Phase B) still work with a mapped import
 *      (created with is_official=false).
 *  11. Official trades remain untouched by imports.
 *  12. The Phase A CSV endpoint (/catalog/import-csv) keeps its behavior.
 *  13. Catalog VERSIONING: a valid new file creates a NEW catalog version, an
 *      identical re-upload is an idempotent replay, and a refresh
 *      (GET /reference/catalog-active) serves the new ACTIVE version while
 *      previous versions and their materials are kept (no deletion).
 */
import ExcelJS from 'exceljs';
import { apiRequest } from './setup';
import { test, assertEq, ok, ctx } from './run';

const RUN_TAG = `pc${Date.now().toString(36)}`;
const PHASE_A_HEADER = 'Reference;Nom_Materiau;Categorie;Unite;Prix_TND_HT;Note_Technique;Nom_Arabe';

// ── multipart helper (binary-safe) ───────────────────────────────────────────
function multipartBody(parts: Array<{ name: string; filename?: string; contentType?: string; data: Buffer | string }>): { rawBody: Buffer; contentType: string } {
  const boundary = `----PhaseCBoundary${Math.random().toString(36).slice(2)}`;
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

/** Build a real in-memory .xlsx workbook (single sheet). */
async function buildXlsx(rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Catalogue');
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function uploadTo(
  path: string,
  token: string,
  file: { data: Buffer | string; filename: string; contentType: string },
  mapping?: Record<string, string>
) {
  const parts: Array<{ name: string; filename?: string; contentType?: string; data: Buffer | string }> = [
    { name: 'file', filename: file.filename, contentType: file.contentType, data: file.data },
  ];
  if (mapping) parts.push({ name: 'mapping', data: JSON.stringify(mapping) });
  const { rawBody, contentType } = multipartBody(parts);
  return apiRequest(ctx.server!.baseUrl, 'POST', path, { token, rawBody, contentType });
}

const preview = (token: string, file: any, mapping?: Record<string, string>) =>
  uploadTo('/api/v1/catalog/preview', token, file, mapping);
const doImport = (token: string, file: any, mapping?: Record<string, string>) =>
  uploadTo('/api/v1/catalog/import', token, file, mapping);

async function findMaterialIdByCode(code: string): Promise<string> {
  const res = await apiRequest(ctx.server!.baseUrl, 'GET', `/api/v1/materials?search=${encodeURIComponent(code)}&limit=100`);
  assertEq(res.status, 200);
  const found = (res.body.data || []).find((m: any) => m.code === code);
  return found ? found.id : '';
}

async function getOfficialPrice(materialId: string): Promise<number | undefined> {
  const res = await apiRequest(ctx.server!.baseUrl, 'GET', `/api/v1/prices?materialId=${materialId}&source=OFFICIAL_DEFAULT`);
  return res.body.data[0]?.price;
}

async function listOfficialTradeCodes(): Promise<string[]> {
  const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/trades?officialOnly=true');
  assertEq(res.status, 200);
  return (res.body.data || []).map((t: any) => String(t.code));
}

export async function runCatalogImportPhaseCTests() {
  console.log('\n📊 Phase C — Excel + Smart Mapping Import Tests\n');

  // ── Security: entitlement guard on the new endpoints ──────────────────────
  await test('FREE token blocked on /preview and /import → 403', async () => {
    const csv = `${PHASE_A_HEADER}\r\n${RUN_TAG}_g1;PhaseC Ghost;placo;unit;1;;`;
    const file = { data: csv, filename: 'catalogue.csv', contentType: 'text/csv' };
    assertEq((await preview(ctx.freeToken!, file)).status, 403);
    assertEq((await doImport(ctx.freeToken!, file)).status, 403);
  });
  await test('PRO token blocked on /import → 403', async () => {
    const csv = `${PHASE_A_HEADER}\r\n${RUN_TAG}_g2;PhaseC Ghost;placo;unit;1;;`;
    assertEq((await doImport(ctx.proToken!, { data: csv, filename: 'catalogue.csv', contentType: 'text/csv' })).status, 403);
  });

  // ── 1) XLSX parses successfully (Konstrivo headers, no mapping needed) ────
  const xlsxFile = {
    data: await buildXlsx([
      ['Reference', 'Nom_Materiau', 'Categorie', 'Unite', 'Prix_TND_HT'],
      [`${RUN_TAG}_xa`, 'PhaseC Plaque XLSX', 'placo', 'unit', '31.500'],
      [`${RUN_TAG}_xb`, 'PhaseC Peinture XLSX', 'peinture', 'l', '12,5'],
    ]),
    filename: 'catalogue.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };

  await test('XLSX file parses successfully → preview 200, sheet detected, canImport', async () => {
    const res = await preview(ctx.adminToken!, xlsxFile);
    assertEq(res.status, 200);
    assertEq(res.body.data.fileType, 'xlsx');
    assertEq(res.body.data.sheetName, 'Catalogue');
    assertEq(res.body.data.totalRows, 2);
    assertEq(res.body.data.canImport, true);
    assertEq(res.body.data.unmappedRequired.length, 0, 'no unmapped required field');
    assertEq(res.body.data.appliedMapping.material_code, 'Reference');
    assertEq(res.body.data.appliedMapping.price_ht, 'Prix_TND_HT');
  });

  // ── 2) CSV keeps working through the Smart Mapping flow ───────────────────
  const konstrivoCsv = `${PHASE_A_HEADER}\r\n${RUN_TAG}_csv;PhaseC CSV Direct;plomberie;ml;3.5;;`;
  await test('CSV still works through preview + import (no mapping override needed)', async () => {
    const file = { data: konstrivoCsv, filename: 'catalogue.csv', contentType: 'text/csv' };
    const p = await preview(ctx.adminToken!, file);
    assertEq(p.status, 200);
    assertEq(p.body.data.fileType, 'csv');
    assertEq(p.body.data.canImport, true);
    const res = await doImport(ctx.adminToken!, file);
    assertEq(res.status, 200);
    assertEq(res.body.data.committed, true);
    assertEq(res.body.data.imported, 1);
  });

  // ── 3) + 4) Supplier-style headers detected; canonical fields correct ─────
  const supplierCsv = [
    'Référence;Désignation;Unité;Prix HT;TVA;Devise;Métier',
    `${RUN_TAG}_sup1;Plaque Supplier Test;unit;"1 500,25";19;TND;placo`,
    `${RUN_TAG}_sup2;Peinture Supplier Test;l;45,9;7;TND;peinture`,
  ].join('\r\n');
  const supplierFile = { data: supplierCsv, filename: 'supplier_fournisseur.csv', contentType: 'text/csv' };

  await test('supplier-style headers detected and mapped automatically (generic)', async () => {
    const res = await preview(ctx.adminToken!, supplierFile);
    assertEq(res.status, 200);
    const m = res.body.data.appliedMapping;
    assertEq(m.material_code, 'Référence');
    assertEq(m.material_name, 'Désignation');
    assertEq(m.unit, 'Unité');
    assertEq(m.price_ht, 'Prix HT');
    assertEq(m.tva_rate, 'TVA');
    assertEq(m.currency, 'Devise');
    assertEq(m.trade_code, 'Métier');
    assertEq(res.body.data.unmappedRequired.length, 0);
    assertEq(res.body.data.canImport, true);
  });

  await test('smart mapping produces correct canonical fields (price/tva/unit normalization)', async () => {
    const res = await preview(ctx.adminToken!, supplierFile);
    assertEq(res.status, 200);
    const rows = res.body.data.sampleRows;
    assertEq(rows.length, 2);
    assertEq(rows[0].material_code, `${RUN_TAG}_sup1`);
    assertEq(rows[0].material_name, 'Plaque Supplier Test');
    assertEq(rows[0].trade_code, 'placo');
    assertEq(rows[0].unit, 'unit');
    assertEq(rows[0].price_ht, 1500.25, '"1 500,25" normalized to 1500.25');
    assertEq(rows[0].tva_rate, 19);
    assertEq(rows[0].currency, 'TND');
    assertEq(rows[0].market, 'TN');
    assertEq(rows[0].source, 'OFFICIAL_DEFAULT');
    assertEq(rows[1].price_ht, 45.9);
    assertEq(rows[1].tva_rate, 7);
  });

  // ── 5) Missing required mapping is REJECTED (import blocked) ──────────────
  const partialCsv = `Ref;Price\r\n${RUN_TAG}_part;5`;
  await test('missing required mapping → preview canImport=false + import blocked (400, nothing written)', async () => {
    const file = { data: partialCsv, filename: 'partial.csv', contentType: 'text/csv' };
    const p = await preview(ctx.adminToken!, file);
    assertEq(p.status, 200);
    assertEq(p.body.data.canImport, false, 'preview refuses to enable import');
    ok(p.body.data.unmappedRequired.includes('material_name'), 'material_name is unmapped');
    ok(p.body.data.unmappedRequired.includes('trade_code'), 'trade_code is unmapped');
    const res = await doImport(ctx.adminToken!, file);
    assertEq(res.status, 400);
    ok(String(res.body.error?.message || '').includes('not mapped'), 'error names the unmapped fields');
    const ghost = await findMaterialIdByCode(`${RUN_TAG}_part`);
    assertEq(ghost, '', 'nothing was written for the blocked import');
  });

  await test('explicit mapping pointing to an unknown column → 400 with mapping error', async () => {
    const file = { data: partialCsv, filename: 'partial.csv', contentType: 'text/csv' };
    const res = await preview(ctx.adminToken!, file, { price_ht: 'NoSuchColumn' });
    assertEq(res.status, 400);
    ok(String(res.body.error?.message || '').includes('NoSuchColumn'), 'error names the bad column');
  });

  // ── 6) Invalid price is rejected before any write (NO valid row → 400) ────
  await test('invalid price → preview reports rejection; import 400 ONLY because no row is importable', async () => {
    const csv = `${PHASE_A_HEADER}\r\n${RUN_TAG}_badprice;PhaseC Bad Price;placo;unit;abc;;`;
    const file = { data: csv, filename: 'badprice.csv', contentType: 'text/csv' };
    const p = await preview(ctx.adminToken!, file);
    assertEq(p.status, 200);
    assertEq(p.body.data.rejectedCount, 1);
    assertEq(p.body.data.rejected[0].row, 2, 'row numbering is 1-based incl. header');
    ok(String(p.body.data.rejected[0].reason).includes('Invalid price'));
    assertEq(p.body.data.canImport, false, '0 importable rows → blocked');
    const res = await doImport(ctx.adminToken!, file);
    assertEq(res.status, 400);
    assertEq(res.body.data.committed, false);
    const ghost = await findMaterialIdByCode(`${RUN_TAG}_badprice`);
    assertEq(ghost, '', 'invalid price row was NOT written');
  });

  // ── 6b) PER-ROW import — rejected rows NEVER block the valid ones ─────────
  await test('mixed file → import writes ONLY the valid rows; rejected reported, never written; correction re-imports all', async () => {
    const good1 = `${RUN_TAG}_mx1`;
    const good2 = `${RUN_TAG}_mx2`;
    const bad = `${RUN_TAG}_mxbad`;
    const csv = [
      PHASE_A_HEADER,
      `${good1};PhaseC Mixed One;placo;unit;11,5;;`,
      `${bad};PhaseC Mixed Bad;placo;unit;abc;;`,
      `${good2};PhaseC Mixed Two;placo;unit;22,5;;`,
    ].join('\r\n');
    const file = { data: csv, filename: 'mixed.csv', contentType: 'text/csv' };

    const p = await preview(ctx.adminToken!, file);
    assertEq(p.status, 200);
    assertEq(p.body.data.totalRows, 3);
    assertEq(p.body.data.validCount, 2, 'the two valid rows stay importable');
    assertEq(p.body.data.rejectedCount, 1);
    assertEq(p.body.data.rejected[0].row, 3, 'the bad row is identified by its file line');
    ok(String(p.body.data.rejected[0].reason).includes('Invalid price'));
    assertEq(p.body.data.canImport, true, 'a rejected row NEVER blocks the valid ones');

    const res = await doImport(ctx.adminToken!, file);
    assertEq(res.status, 200, 'per-row import succeeds with the valid rows only');
    assertEq(res.body.data.committed, true);
    assertEq(res.body.data.imported, 2);
    assertEq(res.body.data.rejectedCount, 1);
    assertEq(res.body.data.rejected[0].row, 3);
    ok(await findMaterialIdByCode(good1), 'valid row 1 written');
    ok(await findMaterialIdByCode(good2), 'valid row 2 written');
    assertEq(await findMaterialIdByCode(bad), '', 'rejected row NOT written');

    // Correction puis ré-import : the SAME file with the bad price fixed → 3 valid.
    const fixedCsv = csv.replace(';abc;', ';9,9;');
    const p2 = await preview(ctx.adminToken!, { data: fixedCsv, filename: 'mixed.csv', contentType: 'text/csv' });
    assertEq(p2.body.data.validCount, 3, 're-analyzed from scratch — no stored rejection');
    assertEq(p2.body.data.rejectedCount, 0);
    const res2 = await doImport(ctx.adminToken!, { data: fixedCsv, filename: 'mixed.csv', contentType: 'text/csv' });
    assertEq(res2.status, 200);
    assertEq(res2.body.data.committed, true);
    assertEq(res2.body.data.rejectedCount ?? 0, 0);
    assertEq(res2.body.data.imported + res2.body.data.updated, 3, '2 updated + 1 newly imported');
    ok(await findMaterialIdByCode(bad), 'fixed row now written');
  });

  // ── 7) Invalid XLSX is rejected SAFELY ────────────────────────────────────
  await test('invalid XLSX payload → safe 400 (no 500, no internals leaked)', async () => {
    const junk = Buffer.from('this is definitively NOT a zip/xlsx payload');
    const res = await preview(ctx.adminToken!, { data: junk, filename: 'broken.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    assertEq(res.status, 400);
    const msg = String(res.body.error?.message || '');
    ok(msg.length > 0 && msg.length < 200, 'a short, safe message is returned');
    ok(!/at [A-Za-z]+ \(/.test(msg), 'no stack trace leaked');
    // A ZIP magic prefix that is not a real workbook must ALSO fail safely.
    const fakeZip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('corrupted archive body')]);
    const res2 = await preview(ctx.adminToken!, { data: fakeZip, filename: 'fake.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    assertEq(res2.status, 400);
  });

  await test('legacy .xls is rejected with a clear message', async () => {
    const res = await preview(ctx.adminToken!, { data: Buffer.from('biff'), filename: 'old.xls', contentType: 'application/vnd.ms-excel' });
    assertEq(res.status, 415);
    ok(String(res.body.error?.message || '').includes('.xls'), 'error mentions the legacy format');
  });

  // ── 8) Preview does NOT write to the database ─────────────────────────────
  await test('preview NEVER writes to the database', async () => {
    const csv = `${PHASE_A_HEADER}\r\n${RUN_TAG}_ghost;PhaseC Ghost Material;placo;unit;9;;`;
    const file = { data: csv, filename: 'ghost.csv', contentType: 'text/csv' };
    const p = await preview(ctx.adminToken!, file);
    assertEq(p.status, 200);
    assertEq(p.body.data.canImport, true);
    const ghostId = await findMaterialIdByCode(`${RUN_TAG}_ghost`);
    assertEq(ghostId, '', 'previewed material must NOT exist after a preview-only call');
  });

  // ── 9) Valid preview → import creates/updates expected catalog records ────
  await test('valid import creates the material + official price, re-import updates in place', async () => {
    const file = { data: xlsxFile.data as Buffer, filename: xlsxFile.filename, contentType: xlsxFile.contentType };
    const res = await doImport(ctx.adminToken!, file);
    assertEq(res.status, 200);
    assertEq(res.body.data.committed, true);
    assertEq(res.body.data.imported, 2);

    const plaqueId = await findMaterialIdByCode(`${RUN_TAG}_xa`);
    ok(plaqueId, 'xlsx material created');
    assertEq(await getOfficialPrice(plaqueId), 31.5, 'official price from xlsx');

    // Re-import the same file → rows UPDATED in place (idempotent upsert).
    const res2 = await doImport(ctx.adminToken!, file);
    assertEq(res2.status, 200);
    assertEq(res2.body.data.updated, 2);
    assertEq(res2.body.data.imported, 0);
    assertEq(await getOfficialPrice(plaqueId), 31.5, 'price unchanged on identical re-import');
  });

  // ── 10) Dynamic trades still work with a mapped import ────────────────────
  await test('mapped import of an unknown trade creates a dynamic (non-official) trade', async () => {
    const tradeCode = `${RUN_TAG}dyn`;
    const csv = [
      'Référence;Désignation;Unité;Prix HT;TVA;Devise;Métier',
      `${RUN_TAG}_dyn1;Matériau Métier Dynamique;unit;22,5;19;TND;${tradeCode}`,
    ].join('\r\n');
    const file = { data: csv, filename: 'dynamic_trade.csv', contentType: 'text/csv' };
    const res = await doImport(ctx.adminToken!, file, {});
    assertEq(res.status, 200);
    assertEq(res.body.data.committed, true);

    const tradesRes = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/trades');
    assertEq(tradesRes.status, 200);
    const dyn = (tradesRes.body.data || []).find((t: any) => t.code === tradeCode);
    ok(dyn, 'dynamic trade exposed by the trades API');
    assertEq(dyn.isOfficial, false, 'dynamic trade keeps is_official=false');

    const matId = await findMaterialIdByCode(`${RUN_TAG}_dyn1`);
    ok(matId, 'material of the dynamic trade created');
  });

  // ── 11) Official trades remain unchanged ──────────────────────────────────
  await test('official trades remain unchanged after all Phase C imports', async () => {
    const codes = await listOfficialTradeCodes();
    ok(codes.includes('placo'), 'placo still official');
    ok(codes.includes('peinture'), 'peinture still official');
    for (const code of codes) {
      ok(!code.includes(RUN_TAG), `no Phase C dynamic trade (${code}) became official`);
    }
    ok(codes.length >= 12, 'all 12 canonical official trades still present');
  });

  // ── 12) The Phase A CSV endpoint keeps its exact behavior ─────────────────
  await test('POST /catalog/import-csv (Phase A endpoint) still works unchanged', async () => {
    const csv = `${PHASE_A_HEADER}\r\n${RUN_TAG}_phasea;PhaseC PhaseA Regression;peinture;l;8;;`;
    const { rawBody, contentType } = multipartBody([
      { name: 'file', filename: 'catalogue.csv', contentType: 'text/csv', data: csv },
    ]);
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/catalog/import-csv', { token: ctx.adminToken!, rawBody, contentType });
    assertEq(res.status, 200);
    assertEq(res.body.data.committed, true);
    assertEq(res.body.data.imported, 1);
    assertEq(res.body.data.fileType, undefined, 'Phase A response shape unchanged (no fileType field)');
  });

  // ── 13) PHASE 1 — Catalog VERSIONING: a new file ⇒ a new version, and a
  //      refresh serves exactly that version (history kept, nothing deleted).
  //      Requires country_catalogs / country_catalog_items
  //      (server/scripts/apply_catalog_versioning_to_test_db.cjs, TEST DB only);
  //      skips itself loudly when the tables are missing rather than faking a pass.
  await test('catalog versioning: new file ⇒ new Catalog version, refresh serves it, history kept', async () => {
    const header = 'Reference;Nom_Materiau;Categorie;Unite;Prix_TND_HT';
    const a1 = `${RUN_TAG}_ver_a1`;
    const a2 = `${RUN_TAG}_ver_a2`;
    const b1 = `${RUN_TAG}_ver_b1`;
    const csvA = [header, `${a1};Version A - Plaque;placo;unit;41,50`, `${a2};Version A - Fourrure;placo;m;14,75`].join('\r\n');
    const csvB = [header, `${a1};Version B - Plaque;placo;unit;44,00`, `${b1};Version B - Nouvelle reference;placo;unit;9,90`].join('\r\n');
    const fileA = { data: csvA, filename: 'versioning_a.csv', contentType: 'text/csv' };
    const fileB = { data: csvB, filename: 'versioning_b.csv', contentType: 'text/csv' };

    // 1) First import of new content ⇒ an ACTIVE version is created.
    const resA = await doImport(ctx.adminToken!, fileA);
    assertEq(resA.status, 200);
    assertEq(resA.body.data.committed, true);
    const catA = resA.body.data.catalog;
    if (!catA || !catA.id) {
      console.log('   ⚠️  SKIPPED — country_catalogs tables missing. Run: node server/scripts/apply_catalog_versioning_to_test_db.cjs');
      return;
    }
    ok(Number(catA.version) >= 1, `import reports a Catalog version (got ${catA.version})`);
    assertEq(catA.idempotentReplay, false, 'first import of new content is NOT a replay');
    assertEq(String(catA.countryCode).toUpperCase(), 'TN');

    // 2) Re-importing the SAME bytes ⇒ replay: same version, zero duplicates.
    const resA2 = await doImport(ctx.adminToken!, fileA);
    assertEq(resA2.status, 200);
    assertEq(resA2.body.data.catalog.idempotentReplay, true, 'identical content replays the ACTIVE version');
    assertEq(resA2.body.data.catalog.version, catA.version, 'a replay never creates a new version');
    assertEq(resA2.body.data.catalog.id, catA.id, 'a replay returns the same catalog row');

    // 3) A DIFFERENT valid file ⇒ a strictly NEW version (history not edited).
    const resB = await doImport(ctx.adminToken!, fileB);
    assertEq(resB.status, 200);
    assertEq(resB.body.data.committed, true);
    const catB = resB.body.data.catalog;
    assertEq(catB.idempotentReplay, false, 'changed content is a new version, not a replay');
    assertEq(Number(catB.version), Number(catA.version) + 1, `version increments monotonically (${catA.version} → ${catB.version})`);
    ok(catB.id !== catA.id, 'the new version is a new catalog row (previous versions are not modified in place)');

    // 4) REFRESH — the app/calculators read the ACTIVE catalog: it must be B.
    const activeRes = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/reference/catalog-active?country=TN');
    assertEq(activeRes.status, 200);
    ok(activeRes.body.data && activeRes.body.data.catalog, 'an ACTIVE catalog is served after the refresh');
    assertEq(Number(activeRes.body.data.catalog.version), Number(catB.version), 'the refresh serves the NEW version');
    assertEq(activeRes.body.data.catalog.id, catB.id, 'exactly one ACTIVE version (the previous one was deactivated, not deleted)');
    const codes = (activeRes.body.data.items || []).map((i: any) => String(i.materialCode));
    ok(codes.includes(a1), 'the ACTIVE version contains the updated shared reference');
    ok(codes.includes(b1), 'the ACTIVE version contains the new reference of file B');
    ok(!codes.includes(a2), "file B's version does not mix in rows that only existed in version A");
    const shared = (activeRes.body.data.items || []).find((i: any) => i.materialCode === a1);
    ok(Math.abs(Number(shared.priceHt) - 44) < 0.001, `the ACTIVE snapshot carries file B's price for ${a1} (got ${shared?.priceHt})`);

    // 5) Nothing is destroyed: version A's material still exists after the new version.
    ok(await findMaterialIdByCode(a2), 'the material from the previous version still exists (no deletion)');
    ok(await findMaterialIdByCode(a1), 'the updated material keeps existing under the new version');
  });
}
