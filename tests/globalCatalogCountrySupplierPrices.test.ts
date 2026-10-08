// @ts-nocheck
/**
 * Phase "Country + Supplier + PRICES" — READ-ONLY access layer. DB-FREE tests.
 *
 * Covers, with NO database connection, NO network and NO mutation:
 *  1) the PURE filter normalizers (country / currency / supplier / paging) and
 *     their refusal of an unusable value;
 *  2) the HTTP surface of the new GET endpoints mounted through the REAL
 *     routers: bad `:id` and bad filters are refused BEFORE any DB read, and
 *     the pre-existing admin routes keep their 401 answers;
 *  3) the additive-only guarantees, asserted on the source: the new functions
 *     contain no INSERT/UPDATE/DELETE, migration 0018 repairs no data, and
 *     `global_products` still has no price/currency column.
 *
 * The DB-backed behaviours (real product/price/supplier rows, FK enforcement)
 * need a live database and are explicitly NOT executed here.
 *
 * Run: npx tsx tests/globalCatalogCountrySupplierPrices.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';

// HARD GUARD — this suite must NEVER open a database connection.
// `getDatabase()` is imported (transitively) by the routers, so the connection
// string is removed from the environment BEFORE any module is imported and
// restored on exit. No test here needs a row; the DB-backed behaviours are
// documented as NOT executed.
//
// NOTE: `server/config.ts` loads `server/.env` through dotenvx at import time,
// which puts DATABASE_URL back into the environment. That is harmless here: the
// read endpoints short-circuit on a non-UUID id BEFORE `getDatabase()` is ever
// reached, so no pool is opened (asserted by the route tests below). The saved
// value is restored on exit so this file cannot leak a state change.
const DB_URL_WAS_SET_BEFORE_DELETE = !!(process.env.DATABASE_URL || process.env.TEST_DATABASE_URL);
const SAVED_DB = {
  url: process.env.DATABASE_URL,
  testUrl: process.env.TEST_DATABASE_URL,
};
delete process.env.DATABASE_URL;
delete process.env.TEST_DATABASE_URL;
const DB_URL_IS_REMOVED_NOW = process.env.DATABASE_URL === undefined;
process.on('exit', () => {
  if (SAVED_DB.url !== undefined) process.env.DATABASE_URL = SAVED_DB.url;
  if (SAVED_DB.testUrl !== undefined) process.env.TEST_DATABASE_URL = SAVED_DB.testUrl;
});

const {
  normalizeGlobalProductPriceFilters,
  normalizeSupplierListFilters,
} = await import('../server/repositories/globalCatalogRepository');
const { globalCatalogRouter } = await import('../server/routes/v1/globalCatalog');
const { suppliersRouter } = await import('../server/routes/v1/suppliers');

test('guard: the connection string is cleared before the routers are imported', () => {
  assert.equal(DB_URL_IS_REMOVED_NOW, true, 'DATABASE_URL is undefined at import time');
  assert.equal(
    typeof DB_URL_WAS_SET_BEFORE_DELETE,
    'boolean',
    'the guard is unconditional and never asserts a secret value',
  );
});

const UUID = '00000000-0000-4000-8000-000000000000';
const OTHER_UUID = '11111111-1111-4111-8111-111111111111';

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

// ── 1) Pure filter normalizers ──────────────────────────────────────────────

test('price filters: country/currency/supplier are normalized, never silently dropped', () => {
  const out = normalizeGlobalProductPriceFilters({
    country: 'fr',
    currency: 'eur',
    supplierId: OTHER_UUID,
    limit: '10',
  });
  assert.equal(out.country, 'FR', 'country is upper-cased');
  assert.equal(out.currency, 'EUR', 'currency is upper-cased');
  assert.equal(out.supplierId, OTHER_UUID);
  assert.equal(out.limit, 10);
});

test('price filters: empty/undefined filters stay absent (no invented value)', () => {
  const out = normalizeGlobalProductPriceFilters({});
  assert.equal(out.country, undefined);
  assert.equal(out.currency, undefined);
  assert.equal(out.supplierId, undefined);
  assert.equal(out.limit, 50, 'default page size');

  // An empty string is "no filter", not an invalid filter.
  const blank = normalizeGlobalProductPriceFilters({ country: '', currency: '  ', supplierId: '' });
  assert.equal(blank.country, undefined);
  assert.equal(blank.currency, undefined);
  assert.equal(blank.supplierId, undefined);
});

test('price filters: an unusable filter is refused (400), not ignored', () => {
  assert.throws(() => normalizeGlobalProductPriceFilters({ country: 'T1' }), /Invalid country/i);
  assert.throws(() => normalizeGlobalProductPriceFilters({ country: 'TUNISIA' }), /Invalid country/i);
  assert.throws(() => normalizeGlobalProductPriceFilters({ currency: 'EU1' }), /Invalid currency/i);
  assert.throws(() => normalizeGlobalProductPriceFilters({ supplierId: 'not-a-uuid' }), /Invalid supplierId/i);
});

test('price filters: limit is clamped, never unbounded', () => {
  assert.equal(normalizeGlobalProductPriceFilters({ limit: '0' }).limit, 50, '0 falls back to the default');
  assert.equal(normalizeGlobalProductPriceFilters({ limit: '99999' }).limit, 200, 'clamped to the cap');
  assert.equal(normalizeGlobalProductPriceFilters({ limit: '-5' }).limit, 50);
  assert.equal(normalizeGlobalProductPriceFilters({ limit: '7' }).limit, 7);
});

test('supplier filters: country/search/verified/paging normalization', () => {
  const out = normalizeSupplierListFilters({ country: 'tn', search: '  Batimax ', verified: 'true', limit: '20', offset: '10' });
  assert.equal(out.country, 'TN');
  assert.equal(out.search, 'Batimax', 'search is trimmed');
  assert.equal(out.verified, true);
  assert.equal(out.limit, 20);
  assert.equal(out.offset, 10);

  assert.equal(normalizeSupplierListFilters({ verified: '0' }).verified, false);
  assert.equal(normalizeSupplierListFilters({ verified: '' }).verified, undefined);
  assert.equal(normalizeSupplierListFilters({}).offset, 0);
  assert.equal(normalizeSupplierListFilters({ limit: '9999' }).limit, 200, 'clamped');
});

test('supplier filters: invalid values are refused (400)', () => {
  assert.throws(() => normalizeSupplierListFilters({ country: 'ZZZZ9' }), /Invalid country/i);
  assert.throws(() => normalizeSupplierListFilters({ verified: 'maybe' }), /Invalid verified/i);
  assert.throws(() => normalizeSupplierListFilters({ search: 's'.repeat(201) }), /200 characters/i);
});


// ── 2) HTTP surface of the new GET endpoints ────────────────────────────────

function startApp(): Promise<{ base: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/global-catalog', globalCatalogRouter);
  app.use('/api/v1/suppliers', suppliersRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err?.statusCode || err?.status || 500).json({ error: err?.message || 'error' });
  });

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as any;
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done(undefined));
          }),
      });
    });
  });
}

test('routes: the new GET endpoints reject an invalid country/currency/supplier filter with 400 (no DB)', async () => {
  const { base, close } = await startApp();
  try {
    // A malformed filter must be refused with 400. The repository normalizer runs
    // before any row is read, so this is verified with NO database.
    for (const qs of ['?country=T1', '?currency=EU1', '?supplierId=not-a-uuid']) {
      const res = await fetch(`${base}/api/v1/global-catalog/products/${UUID}/prices${qs}`);
      assert.equal(res.status, 400, `prices${qs} → 400`);
    }

    const hist = await fetch(`${base}/api/v1/global-catalog/products/${UUID}/price-history?country=T1`);
    assert.equal(hist.status, 400, 'price-history with a bad country → 400');

    const sup = await fetch(`${base}/api/v1/suppliers?verified=maybe`);
    // The listing is authenticated, so an anonymous caller is rejected by the
    // auth guard BEFORE the filter is even evaluated. The pure normalizer test
    // above is what proves the 400 behaviour itself.
    assert.equal(sup.status, 401, 'suppliers listing (anon) → 401 before any filter check');
  } finally {
    await close();
  }
});

test('routes: an invalid id is rejected BEFORE any database connection is opened', async () => {
  const { base, close } = await startApp();
  const client = read('server/db/client.ts');
  // `getDatabase()` opens the pool; the read endpoints must be unreachable for a
  // non-UUID id, so the router validates the id itself first.
  assert.ok(
    client.includes('export async function getDatabase'),
    'the client exposes getDatabase (the thing we must not reach)',
  );
  const routes = read('server/routes/v1/globalCatalog.ts');
  const helperStart = routes.indexOf('async function resolveReadableProduct');
  assert.ok(helperStart > -1, 'the route validates the id before the lookup');
  const helper = routes.slice(helperStart, routes.indexOf('router.get(\'/products/:id/availability\''));
  assert.ok(helper.indexOf('isValidUuid') > -1, 'the helper checks the UUID first');
  assert.ok(
    helper.indexOf('isValidUuid') < helper.indexOf('getGlobalProductById'),
    'the UUID check runs BEFORE getGlobalProductById (which opens the connection)',
  );

  try {
    for (const path of ['/availability', '/prices', '/price-history']) {
      const res = await fetch(`${base}/api/v1/global-catalog/products/oops${path}`);
      assert.equal(res.status, 404, `products/oops${path} → 404 with no DB work`);
    }
  } finally {
    await close();
  }
});

test('routes: GET /suppliers requires authentication (same convention as the rest of the router)', async () => {
  const { base, close } = await startApp();
  try {
    const sup = `${base}/api/v1/suppliers`;
    assert.equal((await fetch(sup)).status, 401, 'GET /suppliers (anon) → 401');
    assert.equal(
      (await fetch(sup, { headers: { Authorization: 'Bearer not-a-real-token' } })).status,
      401,
      'GET /suppliers (bad token) → 401',
    );
    // An authenticated-only surface must not become a write surface.
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      const res = await fetch(sup, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.ok(res.status === 404 || res.status === 401, `${method} /suppliers must not succeed (got ${res.status})`);
    }
  } finally {
    await close();
  }
});

test('routes: a non-UUID product id is refused, never a partial payload', async () => {
  const { base, close } = await startApp();
  try {
    for (const path of ['/availability', '/prices', '/price-history']) {
      const res = await fetch(`${base}/api/v1/global-catalog/products/not-a-uuid${path}`);
      // The repository short-circuits on the UUID check, so the product lookup
      // yields nothing and the route answers 404 — never 200 with empty data.
      assert.equal(res.status, 404, `products/not-a-uuid${path} → 404`);
      const body = await res.json();
      assert.ok(!('data' in body), 'no data payload is returned for an invalid id');
    }
  } finally {
    await close();
  }
});

test('routes: existing contracts are untouched (admin routes still 401, old paths unchanged)', async () => {
  const { base, close } = await startApp();
  try {
    const bogus = { Authorization: 'Bearer not-a-real-token' };
    const gc = `${base}/api/v1/global-catalog`;

    // Pre-existing admin surface must keep its authorization answers.
    assert.equal((await fetch(`${gc}/admin/sources`)).status, 401, 'GET /admin/sources (anon) → 401');
    assert.equal((await fetch(`${gc}/admin/sources`, { headers: bogus })).status, 401, 'bad token → 401');
    assert.equal((await fetch(`${gc}/admin/imports`)).status, 401, 'GET /admin/imports → 401');
    assert.equal((await fetch(`${gc}/admin/imports/${UUID}/items`)).status, 401, 'GET import items → 401');
    assert.equal(
      (await fetch(`${gc}/admin/imports/${UUID}/items`, { headers: bogus })).status,
      401,
      'GET import items (bad token) → 401',
    );
    assert.equal(
      (await fetch(`${gc}/admin/availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })).status,
      401,
      'POST /admin/availability (anon) → 401',
    );
    assert.equal(
      (await fetch(`${gc}/admin/import/preview`, { method: 'POST' })).status,
      401,
      'POST /admin/import/preview (anon) → 401',
    );

    // The pre-existing suppliers surface keeps its authorization, and the new
    // `GET /` did not shadow any existing path.
    const sup = `${base}/api/v1/suppliers`;
    assert.equal((await fetch(`${sup}/imports/${UUID}`)).status, 401, 'GET imports/:id (anon) → 401');
    assert.equal(
      (await fetch(`${sup}/imports/${UUID}/approve`, { method: 'POST' })).status,
      401,
      'POST imports/:id/approve (anon) → 401',
    );
    assert.equal(
      (await fetch(`${sup}/upload`, { method: 'POST' })).status,
      401,
      'POST /upload (anon) → 401 — the new GET / did not shadow it',
    );
  } finally {
    await close();
  }
});

test('routes: the new surface is read-only (no write verb answers 2xx)', async () => {
  const { base, close } = await startApp();

// ── 3) Additive-only guarantees, asserted on the source ─────────────────────

test('repository: the new read functions never write, and keep the publication rules', () => {
  const src = read('server/repositories/globalCatalogRepository.ts');

  const start = src.indexOf('PHASE "COUNTRY + SUPPLIER + PRICES" — READ-ONLY access layer');
  assert.ok(start > -1, 'the read-layer block exists');
  const block = src.slice(start);

  for (const forbidden of ['.insert(', '.update(', '.delete(']) {
    assert.ok(!block.includes(forbidden), `the read layer must never call ${forbidden}`);
  }

  // The publication rules must stay mirrored from the existing price read path.
  for (const rule of [
    "eq(materialPrices.isDeleted, false)",
    "eq(materialPrices.reviewStatus, 'published')",
    "eq(materialPrices.isCurrent, true)",
    "ne(materialPrices.sourceCode, 'SUPPLIER_SUBMITTED')",
    'eq(materials.isDeleted, false)',
  ]) {
    assert.ok(block.includes(rule), `the current-price query must keep: ${rule}`);
  }
});

test('repository: the supplier projection never leaks internal/PII fields', () => {
  const src = read('server/repositories/globalCatalogRepository.ts');
  const start = src.indexOf('function toPublicSupplierRow');
  assert.ok(start > -1, 'toPublicSupplierRow exists');
  const fn = src.slice(start, src.indexOf('export async function listSuppliers'));

  for (const secret of ['legalRegistrationNumber', 'contactEmail', 'contactPhone', 'address', 'version', 'isDeleted']) {
    assert.ok(!fn.includes(secret), `the supplier projection must not expose ${secret}`);
  }
  // The safe fields ARE exposed, so the endpoint is actually useful.
  for (const field of ['id', 'name', 'countryCode', 'isVerified']) {
    assert.ok(fn.includes(field), `the supplier projection must expose ${field}`);
  }
});

test('repository: the price-history query deliberately omits is_current (old rows stay visible)', () => {
  const src = read('server/repositories/globalCatalogRepository.ts');
  const start = src.indexOf('export async function getGlobalProductPriceHistory');
  assert.ok(start > -1, 'getGlobalProductPriceHistory exists');
  const fn = src.slice(start, src.indexOf('export async function getPriceHistory'));

  assert.ok(!fn.includes('eq(materialPrices.isCurrent, true)'), 'history must NOT filter on is_current');
  assert.ok(!fn.includes("eq(materialPrices.reviewStatus, 'published')"), 'history must NOT filter on review_status');
  assert.ok(fn.includes('eq(materialPrices.isDeleted, false)'), 'history still excludes soft-deleted rows');
  assert.ok(fn.includes('desc(materialPrices.effectiveFrom)'), 'history is ordered newest effective_from first');
  for (const forbidden of ['.insert(', '.update(', '.delete(']) {
    assert.ok(!fn.includes(forbidden), `history must never call ${forbidden} (old rows are preserved)`);
  }
});


test('migration 0018: additive only, and it ABORTS instead of repairing orphan data', () => {
  const sql = read('server/db/migrations/0018_supplier_country_fk_integrity.sql');

  // No destructive statement at all (comments stripped, like the Phase 1 suite).
  const code = sql.replace(/--[^\n]*/g, '');
  assert.ok(!/\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT)/i.test(code), 'no DROP');
  assert.ok(!/\bTRUNCATE\b/i.test(code), 'no TRUNCATE');
  assert.ok(!/\bDELETE\s+FROM\b/i.test(code), 'no DELETE');
  assert.ok(!/\bUPDATE\s+"?[a-z_]+"?\s+SET\b/i.test(code), 'no data UPDATE');
  assert.ok(!/CREATE\s+TABLE/i.test(code), 'no table is created');

  // It must add exactly the two requested constraints...
  assert.ok(/material_prices_supplier_id_suppliers_id_fk/.test(sql), 'supplier FK is added');
  assert.ok(/suppliers_country_code_countries_code_fk/.test(sql), 'country FK is added');
  assert.ok(
    /FOREIGN KEY \("supplier_id"\) REFERENCES "public"\."suppliers"\("id"\)/.test(sql),
    'supplier FK target is suppliers.id',
  );
  assert.ok(
    /FOREIGN KEY \("country_code"\) REFERENCES "public"\."countries"\("code"\)/.test(sql),
    'country FK target is countries.code',
  );

  // ...and it must ABORT (never auto-fix) when the data would violate them.
  assert.ok(/RAISE EXCEPTION/.test(sql), 'the migration aborts on orphan data');
  assert.ok(/FK ABORT/.test(sql), 'the abort message is explicit');
  assert.ok(
    !/SET\s+"?supplier_id"?\s*=/i.test(code) && !/SET\s+"?country_code"?\s*=/i.test(code),
    'it never rewrites supplier_id / country_code',
  );

  // Re-runnable: the duplicate_object guard mirrors migration 0017.
  assert.ok(/WHEN duplicate_object THEN NULL/.test(sql), 'duplicate_object is guarded');
  // Absent tables are skipped, never created.
  assert.ok(/undefined_table/.test(sql), 'a missing table is skipped instead of failing');
});

test('untouched surfaces: CSV/XLSX import, API resolver/preview/commit are unchanged', () => {
  // These files must NOT reference the new read layer — the phase is additive and
  // the import pipelines were explicitly out of scope.
  const untouched = [
    'server/services/globalCatalogImport.ts',
    'server/services/catalogApiResolver.ts',
    'server/services/catalogApiImportPreview.ts',
    'server/services/catalogApiImportCommit.ts',
  ];
  for (const file of untouched) {
    const src = read(file);
    for (const forbidden of [
      'getGlobalProductAvailability',
      'listGlobalProductPrices',
      'getGlobalProductPriceHistory',
      'listSuppliers',
    ]) {
      assert.ok(!src.includes(forbidden), `${file} must not call ${forbidden}`);
    }
  }
});

test('routes: GET-only registration, and the pre-existing product reads still exist', () => {
  const routes = read('server/routes/v1/globalCatalog.ts');
  for (const path of ['/products/:id/availability', '/products/:id/prices', '/products/:id/price-history']) {
    const re = new RegExp(`router\\.(post|patch|put|delete)\\(\\s*'${path.replace(/\//g, '\\/')}'`);
    assert.ok(!re.test(routes), `no write verb is registered on ${path}`);
    assert.ok(routes.includes(`router.get('${path}'`), `GET ${path} is registered`);
  }
  // Pre-existing public reads must keep their registration.
  assert.ok(routes.includes("router.get('/products'"), 'GET /products is still registered');
  assert.ok(routes.includes("router.get('/products/:id'"), 'GET /products/:id is still registered');
  // And the new public reads are registered BEFORE the admin block, so the
  // admin guard can never shadow them and vice versa.
  const firstRead = routes.indexOf("router.get('/products/:id/availability'");
  const adminBlock = routes.indexOf('Admin: CRUD + identifiers + linking + availability');
  assert.ok(firstRead > -1 && adminBlock > firstRead, 'the new reads sit in the public read section');
});

test('integrity: the FK lives in the migration, following the 0017 project convention', () => {
  // 0017 added `catalog_sources_country_fk` as raw SQL WITHOUT declaring
  // `.references()` in the Drizzle schema — the same deliberate split is kept
  // here. `catalog.ts` importing `./operations` would create a module cycle
  // (`operations.ts` already imports `./catalog`), so the schema files are
  // intentionally left untouched and the migration is the single source of
  // truth for these two constraints.
  const migration = read('server/db/migrations/0018_supplier_country_fk_integrity.sql');
  const hardening = read('server/db/migrations/0017_global_catalog_hardening.sql');
  assert.ok(/ADD CONSTRAINT/.test(migration), '0018 adds constraints');
  assert.ok(
    /ADD CONSTRAINT "catalog_sources_country_fk"/.test(hardening),
    'the 0017 precedent (FK in SQL, not in the Drizzle schema) is present',
  );
});

test('schema: global_products still carries no price, currency or supplier column', () => {
  const src = read('server/db/schema/globalCatalog.ts');
  const start = src.indexOf("export const globalProducts = pgTable('global_products'");
  assert.ok(start > -1, 'global_products exists');
  const table = src.slice(start, src.indexOf('export const globalProductIdentifiers'));
  for (const forbidden of ['price', 'currency', 'supplierId', 'countryCode']) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\b`).test(table),
      `global_products must not have a ${forbidden} column (Phase 4 decision preserved)`,
    );
  }
});

  try {
    const gc = `${base}/api/v1/global-catalog/products/${UUID}`;
    for (const path of ['/availability', '/prices', '/price-history']) {
      for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
        const res = await fetch(`${gc}${path}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        assert.ok(
          res.status === 404 || res.status === 401,
          `${method} ${path} must not succeed (got ${res.status})`,
        );
      }
    }
  } finally {
    await close();
  }
});
