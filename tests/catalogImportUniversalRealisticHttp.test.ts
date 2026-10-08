/**
 * UNIVERSAL CATALOG IMPORT — REAL HTTP REGRESSION (browser → API → import).
 *
 * Exercises the ACTUAL HTTP pipeline the Admin UI calls
 * (POST /api/v1/catalog/preview then POST /api/v1/catalog/import) with the
 * EXACT reported failing file
 * `tests/fixtures/catalog/KONSTRIVO_Universal_Realistic_Test.csv`
 * (12 columns × 40 data rows) and with the Admin market/currency SELECTION set
 * to FR/EUR — the selection that produced the reported
 * « 0 importable / 40 rejected » (every row refused with
 * « Currency 'TND' does not match the import currency EUR. One currency per
 * file. »).
 *
 * Contract locked here (NOT unit-level — the real route, real multipart, real
 * mapping/validation, real transactional commit):
 *   1. /preview maps every meaningful column and reports 37 importable /
 *      3 rejected whatever the selection is, with the exact 3 file lines.
 *   2. `columnAssignments` accounts for EVERY source column: `name_en` is a
 *      designation FALLBACK, `product_group` is read but never used.
 *   3. /import runs the SAME mapping + validation: the 37 valid rows are
 *      written, the 3 invalid rows are reported — invalid rows never block
 *      valid ones.
 *   4. NO currency conversion: ELC-007 (USD in the file) is stored as USD and
 *      PLC-007 (market FR in the file) under FR, not the selected EUR/FR… i.e.
 *      the row's own values win; the selection is only a fallback.
 *   5. THE REPORTED FILE SHAPE (added 2026-09-26): when the only métier-ish
 *      columns are GROUPINGS (`department` = 'Building Materials',
 *      `product_group` = 'Cement & Binders'), `trade_code` stays unmapped —
 *      nothing is invented, no default is assumed — and the file is STILL
 *      37 importable / 3 rejected through the exact request the Admin UI sends
 *      (`?mapping={}` + multipart mapping part). The reported
 *      « 0 importable / 40 rejected » must never come back.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRequest } from './setup';
import { test, assertEq, ok, ctx } from './run';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_NAME = 'KONSTRIVO_Universal_Realistic_Test.csv';
const FIXTURE_CSV = fs.readFileSync(path.join(HERE, 'fixtures', 'catalog', FIXTURE_NAME), 'utf8');

// ── multipart helper (binary-safe, mirrors catalogImportPhaseC.test.ts) ─────
function multipartBody(parts: Array<{ name: string; filename?: string; contentType?: string; data: Buffer | string }>): { rawBody: Buffer; contentType: string } {
  const boundary = `----UniversalRealistic${Math.random().toString(36).slice(2)}`;
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

interface MarketSelection { countryCode: string; currencyCode: string }

/** The EXACT request the Admin UI makes: raw file + ?countryCode=&currencyCode=. */
function uploadFixture(pathname: string, sel: MarketSelection) {
  const { rawBody, contentType } = multipartBody([
    { name: 'file', filename: FIXTURE_NAME, contentType: 'text/csv', data: FIXTURE_CSV },
  ]);
  const query = `?countryCode=${encodeURIComponent(sel.countryCode)}&currencyCode=${encodeURIComponent(sel.currencyCode)}`;
  return apiRequest(ctx.server!.baseUrl, 'POST', `${pathname}${query}`, {
    token: ctx.adminToken!,
    rawBody,
    contentType,
  });
}

async function findMaterialIdByCode(code: string): Promise<string> {
  const res = await apiRequest(ctx.server!.baseUrl, 'GET', `/api/v1/materials?search=${encodeURIComponent(code)}&limit=100`);
  assertEq(res.status, 200);
  const found = (res.body.data || []).find((m: any) => m.code === code);
  return found ? found.id : '';
}

/** The persisted material row (trade code included) — or undefined. */
async function findMaterialByCode(code: string): Promise<any | undefined> {
  const res = await apiRequest(ctx.server!.baseUrl, 'GET', `/api/v1/materials?search=${encodeURIComponent(code)}&limit=100`);
  assertEq(res.status, 200);
  return (res.body.data || []).find((m: any) => m.code === code);
}

/** Trade codes registered in the catalogue registry (what Admin → Métiers lists). */
async function listTradeCodes(): Promise<string[]> {
  const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/trades');
  assertEq(res.status, 200);
  return (res.body.data || []).map((t: any) => String(t.code));
}

/** The persisted price row of a material (currency/market included).
 *  NOTE: imported rows keep their file `source_code` (BATIMAX, PHILIPS…), so the
 *  query must NOT filter on OFFICIAL_DEFAULT — it asserts what was stored. */
async function findOfficialPriceRow(materialId: string): Promise<any | undefined> {
  const res = await apiRequest(ctx.server!.baseUrl, 'GET', `/api/v1/prices?materialId=${materialId}&limit=50`);
  assertEq(res.status, 200);
  const rows = Array.isArray(res.body.data) ? res.body.data : [];
  return rows.find((r: any) => r.isCurrent) || rows[0];
}

const SELECTION_FR_EUR: MarketSelection = { countryCode: 'FR', currencyCode: 'EUR' };

/**
 * The WRITE verification uses a RUN-UNIQUE market selection.
 *
 * WHY: Phase 1 catalog versioning is keyed on (country, contentSha256) and an
 * IDENTICAL re-upload of the same market is an intentional
 * `idempotentReplay` → by design NO write happens (the existing snapshot is
 * counted, nothing is rewritten). The harness truncates materials/prices
 * between runs but NOT the versioning tables, so re-using FR across two runs
 * would make the second run a legitimate replay and the "written" assertions
 * would be unverifiable. A unique market guarantees a FRESH version, so the
 * real write path is what is asserted (the file's own row currencies/markets
 * are unaffected — they always win over the selection).
 */
const RUN_MARKET: string = Date.now()
  .toString(36)
  .split('')
  .map((c) => String.fromCharCode(65 + (parseInt(c, 36) % 26)))
  .join('')
  .slice(-3)
  .toUpperCase()
  .padStart(3, 'X');
const WRITE_SELECTION: MarketSelection = { countryCode: RUN_MARKET, currencyCode: 'TND' };

/**
 * THE EXACT REQUEST THE ADMIN UI MAKES — `src/lib/api.ts` → `catalogFileRequest`:
 * the file travels in the multipart body AND the current manual mapping travels
 * BOTH as `?mapping=` and as a multipart `mapping` part. The FIRST preview of a
 * freshly selected file sends `{}` (no manual delta yet), which must never
 * unmount the server's own suggestion. `uploadFixture` above omits `mapping`
 * entirely; this one reproduces the UI byte-for-byte.
 */
function uploadLikeAdminUi(
  pathname: string,
  sel: MarketSelection,
  csv: string,
  mapping: Record<string, string> = {}
) {
  const json = JSON.stringify(mapping);
  const { rawBody, contentType } = multipartBody([
    { name: 'file', filename: FIXTURE_NAME, contentType: 'text/csv', data: csv },
    { name: 'mapping', data: json },
  ]);
  const query =
    `?countryCode=${encodeURIComponent(sel.countryCode)}&currencyCode=${encodeURIComponent(sel.currencyCode)}` +
    `&mapping=${encodeURIComponent(json)}`;
  return apiRequest(ctx.server!.baseUrl, 'POST', `${pathname}${query}`, {
    token: ctx.adminToken!,
    rawBody,
    contentType,
  });
}

/**
 * THE REPORTED FILE SHAPE — the SAME 12 columns × 40 rows, but the two generic
 * grouping columns carry GROUPINGS instead of métier codes:
 *   `department`    = 'Building Materials'
 *   `product_group` = 'Cement & Binders'
 * (the exact values the report names). Every other cell — references,
 * designations, prices, units, per-row currency/market, sources, links — is
 * byte-identical to the fixture, so this IS the file the UI failed on and not a
 * new one: only its two grouping columns differ from the fixture.
 */
const GROUPED_CSV = FIXTURE_CSV.replace(
  /,(PLOMBERIE|PEINTURE|ELECTRICITE|PLACO|CARRELAGE),[^,\r\n]*,/g,
  ',Building Materials,Cement & Binders,'
);

/** Same market as the write test but a DIFFERENT currency ⇒ a distinct content
 *  hash, so the grouped upload is a REAL commit (never the idempotent replay). */
const GROUPED_WRITE_SELECTION: MarketSelection = { countryCode: RUN_MARKET, currencyCode: 'EUR' };

export async function runCatalogImportUniversalRealisticHttpTests() {
  console.log('\n📥 Universal realistic file — REAL HTTP (preview + import)\n');

  // ── 1) PREVIEW — the exact reported condition ─────────────────────────────
  await test('HTTP preview with the reported FR/EUR selection → 37 importable, 3 rejected (never 0/40)', async () => {
    const res = await uploadFixture('/api/v1/catalog/preview', SELECTION_FR_EUR);
    assertEq(res.status, 200);
    const d = res.body.data;

    assertEq(d.totalRows, 40, 'all 40 data rows are detected');
    assertEq(d.validCount, 37, 'the 37 healthy rows stay importable');
    assertEq(d.rejectedCount, 3, 'exactly the 3 genuinely invalid rows are rejected');
    assertEq(d.canImport, true);
    assertEq(d.unmappedRequired.length, 0, 'no required field shows « Non mappé »');

    // The detected mappings the requirement names, exactly.
    assertEq(d.appliedMapping.material_code, 'item_ref');
    assertEq(d.appliedMapping.material_name, 'nom_fr');
    assertEq(d.appliedMapping.trade_code, 'department', 'the registry-proven department column IS the métier');
    assertEq(d.appliedMapping.price_ht, 'current_cost');
    assertEq(d.appliedMapping.unit, 'selling_unit');
    assertEq(d.appliedMapping.currency, 'currency_code');
    assertEq(d.appliedMapping.market, 'market');
    assertEq(d.appliedMapping.name_ar, 'name_ar');
    assertEq(d.appliedMapping.source, 'data_source');
    assertEq(d.appliedMapping.source_url, 'product_page');
    assertEq(d.appliedMapping.category ?? '', '', 'the generic grouping column is NEVER the category');
    ok(!Object.values(d.appliedMapping).includes('product_group'), 'product_group is never mapped to a trade/category');

    // Every source column is accounted for (the « Non mappé » complaint).
    assertEq((d.columnAssignments || []).length, 12, 'one explicit line per detected column');
    const byCol = new Map<string, any>((d.columnAssignments || []).map((a: any) => [a.source, a]));
    assertEq(byCol.get('name_en').role, 'name_fallback', 'name_en is displayed as the designation fallback');
    assertEq(byCol.get('product_group').role, 'unmapped', 'product_group is displayed as read-but-unused');
    assertEq(byCol.get('product_page').key, 'source_url');
    assertEq(byCol.get('department').key, 'trade_code');

    // Rejections: the exact file lines + actionable reasons.
    assertEq(d.rejected.map((r: any) => r.row).join(','), '7,14,37', 'the rejected FILE lines');
    const reason = (row: number) => String(d.rejected.find((r: any) => r.row === row)?.reason || '');
    ok(/Prix vide/.test(reason(7)), 'blank price cell named');
    ok(/Invalid price 'sur devis'/.test(reason(14)), 'the prose price is named, never invented');
    ok(/Price must be >= 0/.test(reason(37)), 'the negative price is refused');
    ok(
      !d.rejected.some((r: any) => /does not match the import (currency|market)/.test(String(r.reason))),
      'NO row is rejected for carrying its own valid currency/market'
    );
    // The first importable rows expose their file values in the preview table.
    const plb1 = (d.sampleRows || []).find((r: any) => r.material_code === 'PLB-001');
    ok(plb1, 'sample rows are published');
    assertEq(plb1.trade_code, 'plomberie');
    assertEq(plb1.currency, 'TND');
    assertEq(plb1.market, 'TN');
  });

  // ── 2) IMPORT — identical mapping/validation, per-row verdicts ────────────
  await test('HTTP import (same file) writes the 37 valid rows and reports the 3 rejected', async () => {
    const res = await uploadFixture('/api/v1/catalog/import', WRITE_SELECTION);
    assertEq(res.status, 200, 'invalid rows never block the valid ones');
    const d = res.body.data;
    assertEq(d.committed, true);
    assertEq(d.catalog?.idempotentReplay ?? false, false, 'a fresh version is committed (real writes)');
    assertEq((d.imported ?? 0) + (d.updated ?? 0), 37, 'the 37 valid rows were written');
    assertEq(d.rejectedCount, 3);
    assertEq(d.rejected.map((r: any) => r.row).join(','), '7,14,37', 'preview == import determinism');

    ok(await findMaterialIdByCode('PLB-001'), 'a valid row landed in the catalog');
    assertEq(await findMaterialIdByCode('PLB-006'), '', 'the blank-price row was NOT written');
    assertEq(await findMaterialIdByCode('PNT-006'), '', 'the prose-price row was NOT written');
    assertEq(await findMaterialIdByCode('PLB-008'), '', 'the negative-price row was NOT written');
  });

  // ── 3) NO CURRENCY CONVERSION — the row's own currency/market is stored ───
  await test('HTTP: ELC-007 is stored as USD and PLC-007 under FR (no silent conversion)', async () => {
    const usdId = await findMaterialIdByCode('ELC-007');
    ok(usdId, 'the USD row was imported');
    const usdPrice = await findOfficialPriceRow(usdId);
    ok(usdPrice, 'its official price row exists');
    assertEq(String(usdPrice.currency).toUpperCase(), 'USD', 'the file currency is preserved (NOT converted to EUR)');

    const frId = await findMaterialIdByCode('PLC-007');
    ok(frId, 'the FR row was imported');
    const frPrice = await findOfficialPriceRow(frId);
    ok(frPrice, 'its official price row exists');
    assertEq(String(frPrice.market).toUpperCase(), 'FR', 'the file market is preserved');
    assertEq(String(frPrice.currency).toUpperCase(), 'TND');

    const tnId = await findMaterialIdByCode('PLB-001');
    const tnPrice = await findOfficialPriceRow(tnId);
    ok(tnPrice);
    assertEq(String(tnPrice.currency).toUpperCase(), 'TND');
    assertEq(String(tnPrice.market).toUpperCase(), 'TN');
  });

  // ── 4) A DIFFERENT selection cannot change the verdict either ─────────────
  await test('HTTP preview with the TN/TND selection → the SAME 37/3 verdict (selection is not a filter)', async () => {
    const res = await uploadFixture('/api/v1/catalog/preview', { countryCode: 'TN', currencyCode: 'TND' });
    assertEq(res.status, 200);
    assertEq(res.body.data.validCount, 37);
    assertEq(res.body.data.rejectedCount, 3);
    assertEq(res.body.data.rejected.map((r: any) => r.row).join(','), '7,14,37');
    assertEq(res.body.data.canImport, true);
  });

  // ── 5) THE REPORTED FAILURE — grouping values in the métier-ish columns ───
  // `department` = 'Building Materials' and `product_group` = 'Cement & Binders'
  // are GROUPINGS: they must never become a métier, and their presence must not
  // turn a valid file into « 0 importable / 40 rejected ».
  await test('HTTP (UI request): department="Building Materials" + product_group="Cement & Binders" → 37 importable / 3 rejected (never 0/40)', async () => {
    const res = await uploadLikeAdminUi('/api/v1/catalog/preview', SELECTION_FR_EUR, GROUPED_CSV);
    assertEq(res.status, 200);
    const d = res.body.data;
    assertEq(d.totalRows, 40, 'the same 40 data rows');
    // NOTHING IS INVENTED — a grouping is not a trade, in the suggestion OR in
    // the applied mapping the pipeline really uses.
    assertEq(d.suggestedMapping.trade_code, undefined, "'Building Materials' is never suggested as a métier");
    assertEq(d.appliedMapping.trade_code, undefined, 'trade_code stays unmapped (a display-only gap)');
    ok(!Object.values(d.appliedMapping).includes('department'), 'department is never forced into a field');
    ok(!Object.values(d.appliedMapping).includes('product_group'), 'product_group is never used (not even as a métier)');
    // …while every OTHER meaningful column IS really mapped — the same request
    // the Admin UI sends (`?mapping={}` + multipart mapping part).
    assertEq(d.appliedMapping.material_code, 'item_ref');
    assertEq(d.appliedMapping.material_name, 'nom_fr');
    assertEq(d.appliedMapping.price_ht, 'current_cost');
    assertEq(d.appliedMapping.unit, 'selling_unit');
    assertEq(d.appliedMapping.currency, 'currency_code');
    assertEq(d.appliedMapping.market, 'market');
    assertEq(d.appliedMapping.source, 'data_source');
    assertEq(d.appliedMapping.source_url, 'product_page');
    const byCol = new Map<string, any>((d.columnAssignments || []).map((a: any) => [a.source, a]));
    assertEq((d.columnAssignments || []).length, 12, 'one explicit line per source column');
    assertEq(byCol.get('department').role, 'unmapped', 'the grouping column is read but not used');
    assertEq(byCol.get('product_group').role, 'unmapped', 'the product grouping is read but not used');
    // The ONLY required field without a column is trade_code, and it does NOT
    // block: the rows import under the documented review sentinel.
    assertEq(d.unmappedRequired.join(','), 'trade_code', 'truthful « Non mappé » on Métier (code) only');
    assertEq(d.canImport, true, 'the reported 0 importable was a blocker, not a data problem');
    assertEq(d.validCount, 37, 'the 37 healthy rows');
    assertEq(d.rejectedCount, 3, 'only the 3 genuinely invalid prices');
    assertEq(d.rejected.map((r: any) => r.row).join(','), '7,14,37');
    assertEq(d.sampleRows[0].trade_code, 'unmapped_review', 'review sentinel — no métier invented');
    ok(
      (d.reviewWarnings || []).some((w: any) => (w.reasons || []).some((r: string) => r.includes('Missing Categorie'))),
      'the missing métier is disclosed per row, never hidden'
    );
  });

  await test('HTTP (UI request): the SAME grouped file imports exactly the 37 previewed rows (no preview/import divergence)', async () => {
    const tradesBefore = await listTradeCodes();
    const res = await uploadLikeAdminUi('/api/v1/catalog/import', GROUPED_WRITE_SELECTION, GROUPED_CSV);
    assertEq(res.status, 200, 'a missing métier column never blocks the import');
    const d = res.body.data;
    assertEq(d.committed, true);
    assertEq((d.imported ?? 0) + (d.updated ?? 0), 37, 'the previewed rows are the written rows');
    assertEq(d.rejectedCount, 3);
    assertEq(d.rejected.map((r: any) => r.row).join(','), '7,14,37', 'preview == import determinism');
    const landed = await findMaterialByCode('PLB-001');
    ok(landed, 'a valid row landed (the file is importable, as reported)');
    assertEq(await findMaterialIdByCode('PLB-006'), '', 'the blank-price row still is not written');
    // The row keeps the review sentinel (honest placeholder, no invented métier)…
    assertEq(String(landed.trade), 'unmapped_review');
    // …but the sentinel is NEVER registered as a real métier in the catalogue.
    const tradesAfter = await listTradeCodes();
    ok(
      !(tradesAfter.includes('unmapped_review') && !tradesBefore.includes('unmapped_review')),
      'unmapped_review is never created as a trade (no fake métier in the catalog)'
    );
  });
}
