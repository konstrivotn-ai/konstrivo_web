/**
 * Global Catalog — FINAL INTEGRATION + SECURITY AUDIT (DB-free, no network).
 *
 * Run: npx tsx tests/globalCatalogFinalAudit.test.ts
 *
 * These tests assert the CONTRACTS of the completed chain rather than any one
 * implementation detail. They never reach a real API, a real DNS server or a
 * real database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { globalCatalogRouter } from '../server/routes/v1/globalCatalog';
import {
  normalizeCatalogSourceApiConfiguration,
  normalizeCatalogSourceApiMapping,
} from '../server/repositories/globalCatalogRepository';
import { STRONG_IDENTIFIER_TYPES } from '../server/services/globalCatalogValidation';
import { resolveApiResponse, getApiPathValue } from '../server/services/catalogApiResolver';
import { runCatalogApiSync, isCatalogApiSyncRunning } from '../server/services/catalogApiSync';

const read = (...p: string[]) => readFileSync(resolvePath(process.cwd(), ...p), 'utf8');

const SYNC = read('server', 'services', 'catalogApiSync.ts');
const RESOLVER = read('server', 'services', 'catalogApiResolver.ts');
const COMMIT = read('server', 'services', 'catalogApiImportCommit.ts');
const PREVIEW = read('server', 'services', 'catalogApiImportPreview.ts');
const TESTCONN = read('server', 'services', 'catalogSourceTestConnection.ts');
const ROUTE = read('server', 'routes', 'v1', 'globalCatalog.ts');
const REPO = read('server', 'repositories', 'globalCatalogRepository.ts');
const REVIEW = read('server', 'repositories', 'globalCatalogReviewRepository.ts');
const FILEIMPORT = read('server', 'services', 'globalCatalogImport.ts');
const SCHEMA = read('server', 'db', 'schema', 'globalCatalog.ts');
const PANEL = read('src', 'components', 'GlobalCatalogAdminPanel.tsx');
const CLIENT = read('src', 'lib', 'api.ts');

let n = 0;
const makeSource = (o: any = {}) => ({
  id: `11111111-1111-4111-8111-${String(++n).padStart(12, '0')}`,
  sourceType: 'api',
  name: 'Audit API',
  countryCode: 'TN',
  status: 'active',
  configuration: {
    api: {
      baseUrl: 'https://example.com/products',
      authType: 'api_key',
      credentialRef: 'API_KEY',
      credentialLocation: 'header',
      credentialKey: 'X-API-Key',
      responseFormat: 'json',
      mapping: { root: '', collection: 'products', fields: { name: 'name', gtin: 'gtin' } },
    },
  },
  ...o,
});

/** Boot the real router with NO database and issue one unauthenticated call. */
const anonymous = async (url: string, method: string): Promise<number> => {
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/v1/global-catalog', globalCatalogRouter);
  app.use((err: any, _q: any, res: any, _n: any) =>
    res.status(err?.statusCode || 500).json({ error: { message: err?.message || 'error' } }),
  );
  return new Promise<number>((resolve) => {
    const server = app.listen(0, async () => {
      const port = (server.address() as any).port;
      try {
        const r = await fetch(`http://127.0.0.1:${port}${url}`, { method });
        resolve(r.status);
      } catch {
        resolve(0);
      } finally {
        server.close();
      }
    });
  });
};


// ── 1) Authorization ─────────────────────────────────────────────────────────

test('security: every admin Global Catalog route is behind requireAdminWrite', () => {
  const adminRoutes = [...ROUTE.matchAll(/router\.(get|post|patch|put|delete)\(\s*'(\/admin[^']*)'/g)];
  assert.ok(adminRoutes.length >= 10, `admin routes found (${adminRoutes.length})`);

  for (const m of adminRoutes) {
    const start = m.index!;
    const guarded = ROUTE.slice(start, start + 400).includes('...requireAdminWrite');
    assert.ok(guarded, `admin route ${m[2]} must be guarded by requireAdminWrite`);
  }
});

test('security: unauthenticated admin calls are refused (401, no DB)', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const cases: Array<[string, string]> = [
    ['GET', '/api/v1/global-catalog/admin/sources'],
    ['GET', '/api/v1/global-catalog/admin/imports'],
    ['POST', '/api/v1/global-catalog/admin/sources'],
    ['POST', '/api/v1/global-catalog/admin/import/preview'],
    ['POST', '/api/v1/global-catalog/admin/import/commit'],
    ['POST', '/api/v1/global-catalog/admin/api-import/preview'],
    ['POST', '/api/v1/global-catalog/admin/api-import/commit'],
    ['POST', `/api/v1/global-catalog/admin/sources/${id}/sync`],
    ['POST', `/api/v1/global-catalog/admin/sources/${id}/test-connection`],
    ['POST', '/api/v1/global-catalog/admin/products'],
    ['POST', '/api/v1/global-catalog/admin/availability'],
    ['POST', `/api/v1/global-catalog/admin/import-items/${id}/approve`],
  ];
  for (const [method, url] of cases) {
    assert.equal(await anonymous(url, method), 401, `${method} ${url} must be 401`);
  }
});

// ── 2) SSRF, redirects, secrets ─────────────────────────────────────────────

test('security: the sync reuses the SSRF guard and never follows redirects', () => {
  assert.ok(SYNC.includes('assertTestConnectionTargetAllowed'), 'SSRF guard reused');
  assert.ok(SYNC.includes("redirect: 'manual'"), 'redirects are never followed');
  assert.ok(SYNC.includes('redactTestConnectionUrl'), 'the URL is redacted to an origin');
  assert.ok(!/console\./.test(SYNC), 'the sync never logs');
  assert.ok(!/console\./.test(TESTCONN), 'the test-connection probe never logs');
});

test('security: a metadata/private target is refused before any request', async () => {
  let fetched = false;
  const result = await runCatalogApiSync(
    makeSource({
      configuration: {
        api: {
          baseUrl: 'http://169.254.169.254/latest/meta-data',
          authType: 'api_key',
          credentialRef: 'K',
          responseFormat: 'json',
          mapping: { root: '', collection: 'p', fields: { name: 'name' } },
        },
      },
    }),
    {
      env: { K: 'secret' },
      lookup: async () => ['169.254.169.254'],
      fetchImpl: async () => { fetched = true; return new Response('{}', { status: 200 }); },
    },
  );
  assert.equal(result.status, 'failed');
  assert.equal(fetched, false, 'no request may leave the process');
  assert.match(String(result.errorSummary), /priv|interne|locale|Cible/i);
});

test('security: a plaintext credential can never be stored in the source config', () => {
  const base = { baseUrl: 'https://a.tn', authType: 'api_key', credentialRef: 'K' };
  for (const leaked of ['apiKey', 'token', 'password', 'secret', 'authorization']) {
    assert.throws(
      () => normalizeCatalogSourceApiConfiguration({ ...base, [leaked]: 'sk-live-REAL' }),
      /Unknown API configuration field/,
      `${leaked} must be refused`,
    );
  }
});

test('security: a non-http(s) base URL is refused at configuration time', () => {
  for (const bad of ['ftp://a.tn', 'file:///etc/passwd', 'javascript:alert(1)', 'gopher://a.tn']) {
    assert.throws(
      () => normalizeCatalogSourceApiConfiguration({ baseUrl: bad, authType: 'none' }),
      /http/i,
      `${bad} must be refused`,
    );
  }
});


// ── 3) Mapping: traversal + prototype pollution ─────────────────────────────

test('security: dangerous mapping paths fail closed', () => {
  for (const seg of ['__proto__', 'constructor', 'prototype']) {
    assert.throws(() => getApiPathValue({ a: 1 }, `${seg}.x`), /forbidden/, `${seg} must be refused`);
  }
  assert.throws(
    () => resolveApiResponse({ products: [{ name: 'P' }] }, { root: '', collection: 'products', fields: { name: '__proto__.polluted' } }),
    /forbidden/,
  );
  assert.throws(
    () => normalizeCatalogSourceApiMapping({ root: '../../etc', collection: 'products', fields: { name: 'name' } }),
    /path|invalid/i,
  );
  assert.equal(({} as any).polluted, undefined, 'Object.prototype is untouched');
});

// ── 4) Matching: never by name; weak identifiers stay supplier-scoped ────────

test('security: matching is strong-identifier only, never by name', () => {
  // NOTE: deliberately NO call into a repository here — `getDatabase()` would
  // open the real connection. The contract is asserted on the source instead.
  assert.ok(REPO.includes('if (!supplierId) return null'), 'a weak identifier without a supplier is never matched');
  assert.ok(REPO.includes('unsafe to match weak IDs without scope'), 'the intent is documented');
  assert.ok(REPO.includes('Never merges by name similarity'), 'name merging is explicitly ruled out');
  for (const src of [COMMIT, PREVIEW, FILEIMPORT, SYNC]) {
    assert.ok(!/similarity|Levenshtein|fuzzyMatch|nameEquals/i.test(src), 'no name-similarity matching engine');
  }
  assert.equal(STRONG_IDENTIFIER_TYPES.has('sku'), false, 'sku is not a strong identifier');
  assert.equal(STRONG_IDENTIFIER_TYPES.has('gtin'), true);
});

test('security: ambiguous or duplicated rows are staged for review, never auto-merged', () => {
  for (const src of [COMMIT, FILEIMPORT]) {
    assert.ok(src.includes('No strong identifier; review required'), 'the review gate is explicit');
  }
  assert.ok(COMMIT.includes('Duplicate identifier in payload'), 'payload duplicates are not merged');
  assert.ok(COMMIT.includes("matchStatus: 'review_required'"), 'ambiguous rows are staged for review');
});

// ── 5) No deletion when an API item disappears ──────────────────────────────

test('security: the import/commit pipeline contains no delete', () => {
  // Scoped to the DATABASE delete verbs. `Map.delete()` on the in-memory sync
  // lock/history is not a data deletion and must not be flagged.
  for (const [name, src] of [['commit', COMMIT], ['file import', FILEIMPORT], ['sync', SYNC]] as const) {
    assert.ok(!/DELETE\s+FROM/i.test(src), `${name} must never run DELETE FROM`);
    assert.ok(!/\.delete\s*\(\s*(global|import|catalog|supplier|material)/i.test(src), `${name} must never delete a domain row`);
    assert.ok(!/\.delete\s*\(\s*\)/.test(src.replace(/Map|runningSyncsBySource|syncHistoryBySource/g, '')), `${name} must never issue a blanket delete`);
  }
  assert.ok(SYNC.includes('readBodyStrictly'), 'an oversized body fails instead of committing a partial catalog');
});

// ── 6) Price / availability isolation ───────────────────────────────────────

test('security: country availability and supplier prices stay scoped', () => {
  assert.ok(REPO.includes("eq(materialGlobalProductLinks.status, 'approved')"), 'only approved links are joined');
  assert.ok(REPO.includes("eq(materialPrices.reviewStatus, 'published')"), 'only published prices');
  assert.ok(REPO.includes("ne(materialPrices.sourceCode, 'SUPPLIER_SUBMITTED')"), 'supplier drafts excluded');

  const gp = SCHEMA.slice(SCHEMA.indexOf("pgTable('global_products'"), SCHEMA.indexOf('globalProductIdentifiers'));
  for (const forbidden of ['unitPrice', 'currency', 'isAvailable', 'supplierId']) {
    assert.ok(!gp.includes(forbidden), `global_products must not carry ${forbidden}`);
  }

  const proj = REPO.slice(REPO.indexOf('function toPublicSupplierRow'), REPO.indexOf('export async function listSuppliers'));
  for (const secret of ['legalRegistrationNumber', 'contactEmail', 'contactPhone', 'address']) {
    assert.ok(!proj.includes(secret), `the supplier projection must not expose ${secret}`);
  }
});

// ── 7) Validation before commit ──────────────────────────────────────────────

test('security: every write path validates ids before writing', () => {
  // Each guard must appear in the function BODY (between its declaration and
  // the next top-level `export`), not merely somewhere in the file.
  const bodies: Array<[string, string]> = [
    ['upsertGlobalIdentifier', 'export async function upsertGlobalIdentifier'],
    ['linkMaterialToGlobalProduct', 'export async function linkMaterialToGlobalProduct'],
    ['safePatchGlobalProduct', 'export async function safePatchGlobalProduct'],
    ['setGlobalProductAvailability', 'export async function setGlobalProductAvailability'],
  ];
  for (const [name, decl] of bodies) {
    const start = REPO.indexOf(decl);
    assert.ok(start > -1, `${name} exists`);
    const next = REPO.indexOf('\nexport ', start + decl.length);
    const body = REPO.slice(start, next > -1 ? next : start + 3000);
    assert.ok(/isValidUuid\(/.test(body), `${name} validates a UUID before writing`);
  }
  assert.ok(REVIEW.includes('Invalid globalProductId'), 'the review approve path validates the target product');
  assert.ok(REVIEW.includes('Invalid itemId'), 'the review path validates the item id');
  assert.ok(REPO.includes('Identifier already linked to another global product'), 'a bound identifier is never re-pointed');
});

// ── 8) The chain is really wired end to end ─────────────────────────────────

test('integration: API Sync reuses the existing resolver, preview and commit', () => {
  assert.ok(SYNC.includes("from './catalogApiResolver'"), 'the existing resolver is imported');
  assert.ok(SYNC.includes("from './catalogApiImportPreview'"), 'the existing preview is imported');
  assert.ok(SYNC.includes("from './catalogApiImportCommit'"), 'the existing commit is imported');
  assert.ok(SYNC.includes('resolveApiResponse(document'), 'the saved mapping is resolved');
  assert.ok(SYNC.includes('previewApiImportRows'), 'rows go through the existing preview');
  assert.ok(SYNC.includes('commitApiImportRows'), 'rows go through the existing commit');
  assert.ok(!/function .*matchByName|function .*autoMerge/i.test(SYNC), 'no second matching engine');
});

test('integration: CSV/XLSX import stays independent of the API pipeline', () => {
  assert.ok(FILEIMPORT.includes('commitGlobalCatalogImport'), 'the file commit is untouched');
  assert.ok(FILEIMPORT.includes('previewGlobalCatalogImport'), 'the file preview is untouched');
  assert.ok(!/catalogApiSync|catalogApiResolver/.test(FILEIMPORT), 'the file import does not depend on the API chain');
  // The sync reaches the EXISTING commit engine on purpose (that is the whole
  // point of the phase); what it must not do is import the FILE-import service.
  assert.ok(
    !/services\/globalCatalogImport|commitGlobalCatalogImport|previewGlobalCatalogImport/.test(SYNC),
    'the sync must not depend on the CSV/XLSX file-import service',
  );
});

test('integration: the review gate is reachable and admin-only', () => {
  assert.ok(ROUTE.includes("/admin/import-items/:itemId/approve"), 'the approve route exists');
  assert.ok(ROUTE.includes("/admin/import-items/:itemId/reject"), 'the reject route exists');
  assert.ok(COMMIT.includes("matchStatus: 'review_required'"), 'the commit stages ambiguous rows for review');
});

test('integration: the manual sync action is reachable from the admin UI', () => {
  assert.ok(CLIENT.includes('syncGlobalCatalogSource'), 'the client exposes the sync call');
  assert.ok(PANEL.includes('runSourceSync'), 'the panel has a sync handler');
  assert.ok(PANEL.includes('Synchroniser'), 'the panel has a visible button');

  const idx = PANEL.indexOf('Synchroniser');
  const window = PANEL.slice(Math.max(0, idx - 1200), idx);
  assert.ok(window.includes("source.sourceType === 'api'"), 'the sync button is API-only');

  const handler = PANEL.slice(PANEL.indexOf('const runSourceSync'), PANEL.indexOf('const runImportPreview'));
  assert.ok(!handler.includes('loadSources('), 'the handler does not reload the source list');
  assert.ok(!handler.includes('adminUpdateGlobalCatalogSource'), 'the handler never writes the source');
});

// ── 9) No secret or raw payload in what the API returns ──────────────────────

test('security: the sync result carries no credential and no raw payload', async () => {
  const result = await runCatalogApiSync(makeSource(), {
    env: { API_KEY: 'TOP-SECRET-VALUE' },
    lookup: async () => ['93.184.216.34'],
    fetchImpl: async () =>
      new Response(JSON.stringify({ products: [{ name: 'P', gtin: '1234567890123' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    commitRows: async (items: any[]) => ({
      importId: 'audit', created: items.length, matched: 0, updated: 0,
      reviewRequired: 0, skipped: 0, invalid: 0, rejected: 0,
    }),
  });

  const json = JSON.stringify(result);
  assert.equal(json.includes('TOP-SECRET-VALUE'), false, 'no credential');
  assert.equal(json.includes('X-API-Key'), false, 'no header name carrying a value');
  assert.equal(json.includes('products'), false, 'no raw payload');
  assert.equal(result.target, 'https://example.com', 'only the origin is exposed');
  assert.equal(isCatalogApiSyncRunning(makeSource().id), false);
});

// ── 10) No production test-data path ─────────────────────────────────────────

test('security: no test or audit entity is hard-coded into a service', () => {
  for (const src of [SYNC, RESOLVER, COMMIT, PREVIEW]) {
    assert.ok(!/TEST_|audit_|demo_|sample_/i.test(src), 'no fixture is hard-coded into a service');
  }
  assert.ok(SYNC.includes('Only API sources can be synchronized'), 'the sync is API-source only');
});
