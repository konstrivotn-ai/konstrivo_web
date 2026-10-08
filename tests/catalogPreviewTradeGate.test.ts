/**
 * P1 — Preview/Import determinism + explicit "Métier par défaut".
 *
 * Contract under test (revised 2026-09-26 after the real-UI report):
 *  1. `trade_code` is NEVER a blocking required field. A CSV whose only
 *     métier-ish columns are groupings (`department` = 'Building Materials',
 *     `product_group` = 'Cement & Binders') maps every other field, leaves
 *     `trade_code` unmapped (nothing invented, no default assumed) and reports
 *     canImport=true with its real rows importable — the previous contract
 *     (canImport=false + every row rejected) produced the reported
 *     « 0 importable / 40 rejected » on a perfectly valid file.
 *  2. The rows of such a file import under the documented `unmapped_review`
 *     review sentinel + its « Missing Categorie (trade) — requires review. »
 *     note — never an invented métier.
 *  3. An explicit admin "Métier par défaut" (defaultTrade) remains available as
 *     an OPTION: when provided, every trade-less row resolves to it and the
 *     review note discloses it (the sentinel is then never used).
 *  4. POST /catalog/import mirrors /preview EXACTLY (same mapping, same
 *     partition, same rows written).
 *  5. A mapped trade_code column WINS over defaultTrade (defaultTrade ignored).
 *  6. Blank/whitespace defaultTrade = absent; > 50 chars → 400.
 *  7. Phase A /catalog/import-csv keeps its exact contract (missing trade
 *     column → 400 mentioning trade_code; it never reads defaultTrade).
 *  8. Pure UI helpers (src/lib/importPreview.ts): the confirm gate builders.
 */
import { apiRequest } from './setup';
import { test, assertEq, ok, ctx } from './run';
import {
  buildImportBlockReason,
  visibleUnmappedRequired,
  isDefaultTradeRequired,
  effectiveDefaultTrade,
  CUSTOM_DEFAULT_TRADE,
} from '../src/lib/importPreview';

const RUN_TAG = `p1${Date.now().toString(36)}`;

// Audit CSV #1: code, description, price, unit — NO trade/category column.
const CSV1_HEADER = 'code,description,price,unit';
const csv1 = (tag: string) =>
  `${CSV1_HEADER}\r\n${tag}a,P1 Gate Mat A,3.500,ml\r\n${tag}b,P1 Gate Mat B,12,unit`;

// ── multipart helper (binary-safe, mirrors catalogImportPhaseC.test.ts) ─────
function multipartBody(parts: Array<{ name: string; filename?: string; contentType?: string; data: Buffer | string }>): { rawBody: Buffer; contentType: string } {
  const boundary = `----P1Boundary${Math.random().toString(36).slice(2)}`;
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

async function uploadTo(
  path: string,
  token: string,
  file: { data: Buffer | string; filename: string; contentType: string },
  mapping?: Record<string, string>,
  defaultTrade?: string
) {
  const parts: Array<{ name: string; filename?: string; contentType?: string; data: Buffer | string }> = [
    { name: 'file', filename: file.filename, contentType: file.contentType, data: file.data },
  ];
  if (mapping) parts.push({ name: 'mapping', data: JSON.stringify(mapping) });
  if (defaultTrade !== undefined) parts.push({ name: 'defaultTrade', data: defaultTrade });
  const { rawBody, contentType } = multipartBody(parts);
  return apiRequest(ctx.server!.baseUrl, 'POST', path, { token, rawBody, contentType });
}

const preview1 = (defaultTrade?: string) =>
  uploadTo('/api/v1/catalog/preview', ctx.adminToken!, { data: csv1(RUN_TAG), filename: 'csv1_no_trade.csv', contentType: 'text/csv' }, undefined, defaultTrade);
const csv1File = (tag: string) => ({ data: csv1(tag), filename: 'csv1_no_trade.csv', contentType: 'text/csv' });

/** P1 — same lookup pattern as tests/catalogImportPhaseC.test.ts, but returns
 * the FULL material row (or undefined): the call sites below assert `mat.id` /
 * `mat.trade` and use `ok(!ghost)` for the not-found case. */
async function findMaterialByCode(code: string): Promise<any> {
  const res = await apiRequest(ctx.server!.baseUrl, 'GET', `/api/v1/materials?search=${encodeURIComponent(code)}&limit=100`);
  assertEq(res.status, 200);
  return (res.body.data || []).find((m: any) => m.code === code);
}

export async function runCatalogPreviewTradeGateTests() {
  console.log('\n🚦 P1 — Preview/Import determinism gate + Métier par défaut\n');

  // ── 0) Pure UI helpers (no server, no DB) ─────────────────────────────────
  await test('P1 helpers: isDefaultTradeRequired', async () => {
    assertEq(isDefaultTradeRequired(null), false);
    assertEq(isDefaultTradeRequired({ appliedMapping: { trade_code: 'Categorie' } }), false);
    assertEq(isDefaultTradeRequired({ appliedMapping: {} }), true);
    assertEq(isDefaultTradeRequired({}), true);
  });

  await test('P1 helpers: effectiveDefaultTrade + visibleUnmappedRequired', async () => {
    assertEq(effectiveDefaultTrade('plomberie', ''), 'plomberie');
    assertEq(effectiveDefaultTrade(CUSTOM_DEFAULT_TRADE, ' Hvac '), 'Hvac', 'trim only — the server owns lowercasing');
    assertEq(effectiveDefaultTrade('', ''), '');
    // `trade_code` is published by the server but NEVER blocks: only the
    // data-bearing required fields can gate the confirm button.
    assertEq(visibleUnmappedRequired({ unmappedRequired: ['trade_code', 'material_name'] }, '').join(','), 'material_name');
    assertEq(visibleUnmappedRequired({ unmappedRequired: ['trade_code', 'material_name'] }, 'plomberie').join(','), 'material_name');
    assertEq(visibleUnmappedRequired({ unmappedRequired: ['trade_code'], defaultTrade: 'plomberie' }, '').join(','), '', 'never a blocking field');
    assertEq(visibleUnmappedRequired({ unmappedRequired: ['price_ht'] }, '').join(','), 'price_ht', 'a real data field still blocks');
  });

  await test('P1 helpers: buildImportBlockReason (never silent, never misleading)', async () => {
    assertEq(buildImportBlockReason({ canImport: true }, ''), null, 'importable → no reason');
    const noPreview = buildImportBlockReason(null, '');
    ok(noPreview !== null && noPreview.includes('Aucun aperçu'), 'missing preview explains itself');
    // `trade_code` alone never blocks, so even a stale canImport=false report
    // must NOT present it as a blocker.
    const blocked = buildImportBlockReason({ canImport: false, unmappedRequired: ['trade_code'] }, '');
    ok(blocked !== null, 'stale preview still explains itself');
    ok(!(blocked || '').includes('trade_code'), 'trade_code is never presented as a blocker');
    const blockedPrice = buildImportBlockReason({ canImport: false, unmappedRequired: ['trade_code', 'price_ht'] }, '');
    ok(blockedPrice !== null && blockedPrice.includes('price_ht'), 'a genuinely missing data field IS named');
    const rejected = buildImportBlockReason(
      { canImport: false, unmappedRequired: [], rejectedCount: 2, rejected: [{ row: 2, reason: 'Invalid price x' }] },
      ''
    );
    ok(rejected !== null && rejected.includes('2 ligne(s) rejetée(s)') && rejected.includes('Invalid price'), 'rejected rows explained');
  });

  // ── 1) The core contract: a trade-less file stays importable ─────────────
  await test('P1: CSV without trade column → still importable (trade_code is a display-only gap)', async () => {
    const res = await preview1();
    assertEq(res.status, 200);
    assertEq(res.body.data.canImport, true, 'no métier column ⇒ nothing invented, the rows still import');
    ok(res.body.data.unmappedRequired.includes('trade_code'), 'trade_code is reported as unmapped (truth)');
    assertEq(res.body.data.appliedMapping.trade_code, undefined, 'no métier is ever invented');
    assertEq(res.body.data.defaultTrade, null, 'no default echoed / no default assumed');
    assertEq(res.body.data.validCount, 2, 'the valid rows are importable');
    assertEq(res.body.data.rejectedCount, 0, 'no row is rejected for the missing métier');
    // The review sentinel travels WITH the row (visible in the preview table and
    // in reviewWarnings) so the Admin sees the gap without a blocked import.
    assertEq(res.body.data.sampleRows[0].trade_code, 'unmapped_review', 'documented review sentinel');
    ok(
      (res.body.data.reviewWarnings || []).some((w: any) =>
        (w.reasons || []).some((r: string) => r.includes('Missing Categorie'))
      ),
      'the missing métier is disclosed, never hidden'
    );
  });

  await test('P1: explicit defaultTrade → canImport=true, every row resolved to it', async () => {
    const res = await preview1('plomberie');
    assertEq(res.status, 200);
    assertEq(res.body.data.canImport, true, 'explicit Métier par défaut unlocks the import');
    assertEq(res.body.data.defaultTrade, 'plomberie');
    assertEq(res.body.data.sampleRows[0].trade_code, 'plomberie');
    assertEq(res.body.data.sampleRows[1].trade_code, 'plomberie');
    ok(
      (res.body.data.reviewWarnings || []).some((w: any) => (w.reasons || []).some((r: string) => r.includes('Métier par défaut'))),
      'informational review note (not the blocking sentinel)'
    );
  });

  await test('P1: blank/whitespace defaultTrade is treated as absent', async () => {
    const res = await preview1('   ');
    assertEq(res.status, 200);
    assertEq(res.body.data.canImport, true, 'absent default ⇒ the review sentinel path, still importable');
    assertEq(res.body.data.defaultTrade, null);
    assertEq(res.body.data.sampleRows[0].trade_code, 'unmapped_review', 'no default was assumed');
  });

  await test('P1: defaultTrade longer than 50 chars → 400', async () => {
    const res = await preview1('x'.repeat(51));
    assertEq(res.status, 400);
    ok(String(res.body.error?.message || '').includes('defaultTrade'));
  });

  // ── 2) Import side mirrors the gate exactly ────────────────────────────────
  await test('P1: import without defaultTrade → commits the rows (preview == import)', async () => {
    const res = await uploadTo('/api/v1/catalog/import', ctx.adminToken!, csv1File(RUN_TAG));
    assertEq(res.status, 200, 'the same 2 importable rows the preview reported');
    assertEq(res.body.data.committed, true);
    assertEq(res.body.data.imported, 2);
    assertEq(res.body.data.rejectedCount, 0);
    const mat = await findMaterialByCode(`${RUN_TAG}a`);
    ok(mat, 'the row was written — a missing métier never blocks the import');
    assertEq(mat.trade, 'unmapped_review', 'review sentinel — no métier invented');
  });

  await test('P1: import WITH defaultTrade commits every row under the default trade', async () => {
    const res = await uploadTo('/api/v1/catalog/import', ctx.adminToken!, csv1File(`${RUN_TAG}imp`), undefined, 'plomberie');
    assertEq(res.status, 200);
    assertEq(res.body.data.committed, true);
    assertEq(res.body.data.imported, 2);
    const mat = await findMaterialByCode(`${RUN_TAG}impa`);
    ok(mat, 'material persisted');
    assertEq(mat.trade, 'plomberie', 'default trade applied to every row');
    const mat2 = await findMaterialByCode(`${RUN_TAG}impb`);
    assertEq(mat2.trade, 'plomberie');
  });

  await test('P1: defaultTrade with a NEW code registers a dynamic trade (Phase B preserved)', async () => {
    const res = await uploadTo('/api/v1/catalog/import', ctx.adminToken!, csv1File(`${RUN_TAG}dyn`), undefined, `${RUN_TAG}gate`);
    assertEq(res.status, 200);
    assertEq(res.body.data.committed, true);
    const trades = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/trades');
    assertEq(trades.status, 200);
    const t = (trades.body.data || []).find((x: any) => x.code === `${RUN_TAG}gate`);
    ok(t, 'dynamic default trade registered');
    assertEq(t.isOfficial, false, 'dynamic trade, never official');
  });

  await test('P1: mapped trade column WINS over defaultTrade', async () => {
    const csv = `code,description,category,unit,price\r\n${RUN_TAG}col,P1 Col Mat,peinture,l,7.5`;
    const file = { data: csv, filename: 'csv_col.csv', contentType: 'text/csv' };
    const p = await uploadTo('/api/v1/catalog/preview', ctx.adminToken!, file, undefined, 'plomberie');
    assertEq(p.status, 200);
    assertEq(p.body.data.canImport, true);
    assertEq(p.body.data.sampleRows[0].trade_code, 'peinture', 'the mapped column beats the default');
    const res = await uploadTo('/api/v1/catalog/import', ctx.adminToken!, file, undefined, 'plomberie');
    assertEq(res.status, 200);
    assertEq(res.body.data.committed, true);
    const mat = await findMaterialByCode(`${RUN_TAG}col`);
    ok(mat, 'material persisted');
    assertEq(mat.trade, 'peinture');
  });

  // ── 3) Phase A regression: /import-csv contract is untouched ───────────────
  await test('P1: Phase A /import-csv keeps its contract (never reads defaultTrade)', async () => {
    const res = await uploadTo('/api/v1/catalog/import-csv', ctx.adminToken!, csv1File(`${RUN_TAG}pa`));
    assertEq(res.status, 400, 'missing required columns still refuses Phase A');
    ok(String(res.body.error?.message || '').includes('trade_code'), 'message names trade_code');
    // Even WITH a defaultTrade sent to Phase A, the missing-column 400 stands.
    const res2 = await uploadTo('/api/v1/catalog/import-csv', ctx.adminToken!, csv1File(`${RUN_TAG}pad`), undefined, 'plomberie');
    assertEq(res2.status, 400);
    const ghost = await findMaterialByCode(`${RUN_TAG}paa`);
    ok(!ghost, 'nothing written on the Phase A path');
  });
}

