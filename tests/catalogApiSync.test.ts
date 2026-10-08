import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import {
  runCatalogApiSync,
  listCatalogApiSyncRuns,
  isCatalogApiSyncRunning,
  getCatalogApiSyncRunSummary,
} from '../server/services/catalogApiSync';

let sourceCounter = 0;

/**
 * A manually-controlled gate.
 *
 * `opened` resolves once the guarded code has actually reached the gate, and
 * `wait()` blocks until `release()` is called. Using this instead of a bare
 * `let release` avoids the race where the release function is read before the
 * async work that assigns it has run.
 */
function deferred() {
  let open!: () => void;
  let release!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  const closed = new Promise<void>((resolve) => { release = resolve; });
  return { opened, wait: () => closed, open, release };
}

function makeSource(overrides: any = {}) {
  sourceCounter += 1;
  return {
    id: `11111111-1111-4111-8111-${String(sourceCounter).padStart(12, '0')}`,
    sourceType: 'api',
    name: 'Demo API',
    countryCode: 'TN',
    status: 'active',
    configuration: {
      api: {
        baseUrl: 'https://example.com/products',
        authType: 'api_key',
        credentialRef: 'API_KEY',
        credentialLocation: 'header',
        credentialKey: 'X-API-Key',
        headerNames: ['X-Trace'],
        responseFormat: 'json',
        mapping: {
          root: '',
          collection: 'products',
          fields: {
            name: 'name',
            sku: 'sku',
            gtin: 'gtin',
          },
        },
      },
    },
    ...overrides,
  };
}

test('catalog api sync: valid configuration + successful flow using fake fetch', async () => {
  const source = makeSource();

  const result = await runCatalogApiSync(source, {
    env: { API_KEY: 'secret-123' },
    lookup: async () => ['93.184.216.34'],
    fetchImpl: async (_url: string | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      assert.equal(headers?.['X-API-Key'], 'secret-123');
      return new Response(JSON.stringify({
        products: [{ name: 'Ciment', sku: 'SKU-1', gtin: '1234567890123' }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
    commitRows: async (items: any[]) => ({
      importId: 'sync-run-1',
      created: items.length,
      matched: 0,
      updated: 0,
      reviewRequired: 0,
      skipped: 0,
      invalid: 0,
      rejected: 0,
    }),
  });

  assert.equal(result.status, 'success');
  assert.equal(result.counts.created, 1);
  assert.equal(result.counts.total, 1);
  assert.equal(result.counts.valid, 1);
  assert.equal(result.errorSummary, null);
  assert.equal(isCatalogApiSyncRunning(source.id), false);
  assert.equal(listCatalogApiSyncRuns(source.id).length > 0, true);
});

test('catalog api sync: missing credential is failed before fetch', async () => {
  const source = makeSource();
  let called = false;

  const result = await runCatalogApiSync(source, {
    env: {},
    lookup: async () => ['93.184.216.34'],
    fetchImpl: async () => {
      called = true;
      return new Response('{}', { status: 200 });
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(called, false);
  assert.match(String(result.errorSummary || ''), /Secret|credential|environment/i);
});

test('catalog api sync: private URL is blocked by SSRF guard', async () => {
  const source = makeSource({
    configuration: {
      api: {
        ...makeSource().configuration.api,
        baseUrl: 'http://127.0.0.1:3000/products',
      },
    },
  });

  const result = await runCatalogApiSync(source, {
    env: { API_KEY: 'secret-123' },
    lookup: async () => ['127.0.0.1'],
    fetchImpl: async () => new Response('ok', { status: 200 }),
  });

  assert.equal(result.status, 'failed');
  assert.match(String(result.errorSummary || ''), /Cible refusée|interne|privée|locale/i);
});

test('catalog api sync: timeout returns failed status and no secret leakage', async () => {
  const source = makeSource();

  const result = await runCatalogApiSync(source, {
    env: { API_KEY: 'secret-123' },
    lookup: async () => ['93.184.216.34'],
    now: () => 0,
    fetchImpl: async (_url: string | URL, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      await new Promise<void>((resolve) => {
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      return new Response('ok', { status: 200 });
    },
    timeoutMs: 1,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.errorSummary?.includes('secret-123'), false);
});

test('catalog api sync: invalid response payload reuses resolver errors', async () => {
  const source = makeSource({
    configuration: {
      api: {
        ...makeSource().configuration.api,
        mapping: {
          root: '',
          collection: 'products',
          fields: {
            name: 'name',
          },
        },
      },
    },
  });

  const result = await runCatalogApiSync(source, {
    env: { API_KEY: 'secret-123' },
    lookup: async () => ['93.184.216.34'],
    fetchImpl: async () => new Response(JSON.stringify({ products: 'not-an-array' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    commitRows: async () => ({ importId: 'sync-run-2', created: 0, matched: 0, updated: 0, reviewRequired: 0, skipped: 0, invalid: 0, rejected: 0 }),
  });

  assert.equal(result.status, 'failed');
  assert.match(String(result.errorSummary || ''), /Resolver|collection|array/i);
});

test('catalog api sync: duplicate protection blocks concurrent runs for the same source', async () => {
  const source = makeSource();

  // The fetch is only reached after the async target check, so we must wait for
  // the fetch to actually start before releasing it — otherwise `release` is
  // still undefined and the run never settles.
  const gate = deferred();

  const firstPromise = runCatalogApiSync(source, {
    env: { API_KEY: 'secret-123' },
    lookup: async () => ['93.184.216.34'],
    fetchImpl: async () => {
      gate.open();
      await gate.wait();
      return new Response(JSON.stringify({ products: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    commitRows: async () => ({ importId: 'sync-dup-1', created: 0, matched: 0, updated: 0, reviewRequired: 0, skipped: 0, invalid: 0, rejected: 0 }),
  });

  await gate.opened;
  assert.equal(isCatalogApiSyncRunning(source.id), true, 'the first run holds the lock');

  const secondPromise = runCatalogApiSync(source, {
    env: { API_KEY: 'secret-123' },
    lookup: async () => ['93.184.216.34'],
    fetchImpl: async () => new Response(JSON.stringify({ products: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    commitRows: async () => ({ importId: 'sync-dup-2', created: 0, matched: 0, updated: 0, reviewRequired: 0, skipped: 0, invalid: 0, rejected: 0 }),
  }).catch((error) => error);

  gate.release();

  const first = await firstPromise;
  const second = await secondPromise;

  assert.equal(first.status, 'success');
  assert.ok(second instanceof Error && /already running/i.test(second.message));
  assert.equal(isCatalogApiSyncRunning(source.id), false, 'the lock is released');
});

test('catalog api sync: history summary exposes manual run status fields', async () => {
  const source = makeSource();
  const result = await runCatalogApiSync(source, {
    env: { API_KEY: 'secret-123' },
    lookup: async () => ['93.184.216.34'],
    fetchImpl: async () => new Response(JSON.stringify({ products: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    commitRows: async () => ({ importId: 'sync-hist-1', created: 0, matched: 0, updated: 0, reviewRequired: 0, skipped: 0, invalid: 0, rejected: 0 }),
  });

  const summary = getCatalogApiSyncRunSummary(source.id, result.runId || 'missing');
  assert.ok(summary);
  assert.equal(summary?.sourceId, source.id);
  assert.equal(summary?.status, 'success');
  assert.equal(summary?.counts.total, 0);
  assert.equal(summary?.triggeredBy, 'manual');
});


test('catalog api sync: no secret/raw payload is persisted in history or error summary', async () => {
  const source = makeSource();
  const result = await runCatalogApiSync(source, {
    env: { API_KEY: 'super-secret-value' },
    lookup: async () => ['93.184.216.34'],
    fetchImpl: async () => new Response(JSON.stringify({ products: [{ name: 'X', sku: '123' }] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    commitRows: async () => ({ importId: 'sync-secret', created: 1, matched: 0, updated: 0, reviewRequired: 0, skipped: 0, invalid: 0, rejected: 0 }),
  });

  assert.equal(result.errorSummary, null);
  const history = listCatalogApiSyncRuns(source.id);
  const serialized = JSON.stringify(history);
  assert.equal(serialized.includes('super-secret-value'), false);
  assert.equal(serialized.includes('X-API-Key'), false);
});

test('catalog api sync: an invalid credential reference is refused before fetch', async () => {
  // `credentialRef` that names nothing usable — the secret can never resolve.
  const source = makeSource({
    configuration: {
      api: { ...makeSource().configuration.api, credentialRef: '   ' },
    },
  });

  let called = false;
  await assert.rejects(
    () => runCatalogApiSync(source, {
      env: { API_KEY: 'secret-123' },
      lookup: async () => ['93.184.216.34'],
      fetchImpl: async () => { called = true; return new Response('{}', { status: 200 }); },
    }),
    /credentialRef|credential|environment|Secret/i,
    'an unusable credentialRef is a hard error, not a silent anonymous request',
  );
  assert.equal(called, false, 'no request is sent without a resolvable credential');
});

test('catalog api sync: a source without a mapping is refused (no invented values)', async () => {
  const source = makeSource({
    configuration: { api: { ...makeSource().configuration.api, mapping: null } },
  });

  let called = false;
  await assert.rejects(
    () => runCatalogApiSync(source, {
      env: { API_KEY: 'secret-123' },
      lookup: async () => ['93.184.216.34'],
      fetchImpl: async () => { called = true; return new Response('{}', { status: 200 }); },
    }),
    /mapping/i,
  );
  assert.equal(called, false);
});

test('catalog api sync: an oversized response FAILS instead of truncating', async () => {
  const source = makeSource();
  let committed = false;

  const result = await runCatalogApiSync(source, {
    env: { API_KEY: 'secret-123' },
    lookup: async () => ['93.184.216.34'],
    // A body far above the injected cap.
    fetchImpl: async () => new Response(
      JSON.stringify({ products: [{ name: 'x'.repeat(2000) }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
    maxResponseBytes: 1024,
    commitRows: async () => {
      committed = true;
      return { importId: 'nope', created: 1, matched: 0, updated: 0, reviewRequired: 0, skipped: 0, invalid: 0, rejected: 0 };
    },
  });

  assert.equal(result.status, 'failed');
  assert.match(String(result.errorSummary || ''), /maximum sync size/i);
  assert.equal(committed, false, 'a truncated read must never reach the commit path');
  assert.equal(result.counts.created, 0);
});

test('catalog api sync: a declared content-length above the cap is refused', async () => {
  const source = makeSource();

  const result = await runCatalogApiSync(source, {
    env: { API_KEY: 'secret-123' },
    lookup: async () => ['93.184.216.34'],
    fetchImpl: async () => new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-length': '99999999' },
    }),
    maxResponseBytes: 1024,
  });

  assert.equal(result.status, 'failed');
  assert.match(String(result.errorSummary || ''), /maximum sync size/i);
});

test('catalog api sync: a failed fetch (HTTP error) is reported, never committed', async () => {
  const source = makeSource();
  let committed = false;

  const result = await runCatalogApiSync(source, {
    env: { API_KEY: 'secret-123' },
    lookup: async () => ['93.184.216.34'],
    fetchImpl: async () => new Response('server exploded', { status: 503 }),
    commitRows: async () => { committed = true; return { importId: 'nope', created: 1, matched: 0, updated: 0, reviewRequired: 0, skipped: 0, invalid: 0, rejected: 0 }; },
  });

  assert.equal(result.status, 'failed');
  assert.match(String(result.errorSummary || ''), /503/);
  assert.equal(committed, false);
  // The response body must never leak into the summary.
  assert.equal(String(result.errorSummary || '').includes('server exploded'), false);
});

test('catalog api sync: a network error is sanitized and never leaks the URL', async () => {
  const source = makeSource();

  const result = await runCatalogApiSync(source, {
    env: { API_KEY: 'super-secret-value' },
    lookup: async () => ['93.184.216.34'],
    fetchImpl: async () => {
      throw new Error('request to https://example.com/products?api_key=super-secret-value failed');
    },
  });

  assert.equal(result.status, 'failed');
  const summary = String(result.errorSummary || '');
  assert.equal(summary.includes('super-secret-value'), false, 'the key is redacted');
  assert.equal(summary.includes('example.com'), false, 'the URL is redacted');
});

test('catalog api sync: a redirect is reported, never followed', async () => {
  const source = makeSource();

  const result = await runCatalogApiSync(source, {
    env: { API_KEY: 'secret-123' },
    lookup: async () => ['93.184.216.34'],
    fetchImpl: async () => new Response(null, {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data' },
    }),
  });

  assert.equal(result.status, 'failed');
  assert.match(String(result.errorSummary || ''), /redirect/i);
  assert.equal(String(result.errorSummary || '').includes('169.254.169.254'), false);
});

test('catalog api sync: a non-JSON body fails loudly', async () => {
  const source = makeSource();
  let committed = false;

  const result = await runCatalogApiSync(source, {
    env: { API_KEY: 'secret-123' },
    lookup: async () => ['93.184.216.34'],
    fetchImpl: async () => new Response('<html>oops</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
    commitRows: async () => { committed = true; return { importId: 'nope', created: 1, matched: 0, updated: 0, reviewRequired: 0, skipped: 0, invalid: 0, rejected: 0 }; },
  });

  assert.equal(result.status, 'failed');
  assert.match(String(result.errorSummary || ''), /JSON/i);
  assert.equal(committed, false);
});

test('catalog api sync: an empty collection never triggers a deletion', async () => {
  const source = makeSource();
  const commitArgs: any[] = [];

  // A well-formed but EMPTY collection must not be read as "the catalog is
  // gone": it commits an empty run and never issues a delete.
  const result = await runCatalogApiSync(source, {
    env: { API_KEY: 'secret-123' },
    lookup: async () => ['93.184.216.34'],
    fetchImpl: async () => new Response(JSON.stringify({ products: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
    commitRows: async (_items: any[], args: any) => {
      commitArgs.push(args);
      return { importId: 'sync-empty', created: 0, matched: 0, updated: 0, reviewRequired: 0, skipped: 0, invalid: 0, rejected: 0 };
    },
  });

  assert.equal(result.status, 'success');
  assert.equal(result.counts.created, 0);
  // The commit contract is create/patch only — there is no delete verb.
  assert.equal(commitArgs.length, 1);
  assert.equal('delete' in commitArgs[0], false);
  assert.equal('remove' in commitArgs[0], false);
});

test('catalog api sync: rows needing review make the run partial', async () => {
  const source = makeSource();

  const result = await runCatalogApiSync(source, {
    env: { API_KEY: 'secret-123' },
    lookup: async () => ['93.184.216.34'],
    // No strong identifier: the existing commit path stages it for review
    // instead of guessing a match.
    fetchImpl: async () => new Response(
      JSON.stringify({ products: [{ name: 'Produit sans identifiant' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
    commitRows: async () => ({ importId: 'sync-partial', created: 0, matched: 0, updated: 0, reviewRequired: 1, skipped: 0, invalid: 0, rejected: 0 }),
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.counts.reviewRequired, 1);
  assert.equal(result.finishedAt !== null, true);
});

test('catalog api sync: two different sources stay independent', async () => {
  const a = makeSource();
  const b = makeSource();

  const gate = deferred();

  const first = runCatalogApiSync(a, {
    env: { API_KEY: 'secret-123' },
    lookup: async () => ['93.184.216.34'],
    fetchImpl: async () => {
      gate.open();
      await gate.wait();
      return new Response(JSON.stringify({ products: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    commitRows: async () => ({ importId: 'a', created: 0, matched: 0, updated: 0, reviewRequired: 0, skipped: 0, invalid: 0, rejected: 0 }),
  });

  await gate.opened;
  assert.equal(isCatalogApiSyncRunning(a.id), true);

  // A DIFFERENT source is not blocked by the first one's lock.
  const other = await runCatalogApiSync(b, {
    env: { API_KEY: 'secret-123' },
    lookup: async () => ['93.184.216.34'],
    fetchImpl: async () => new Response(JSON.stringify({ products: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    commitRows: async () => ({ importId: 'b', created: 0, matched: 0, updated: 0, reviewRequired: 0, skipped: 0, invalid: 0, rejected: 0 }),
  });

  assert.equal(other.status, 'success');
  assert.equal(other.sourceId, b.id);

  gate.release();
  assert.equal((await first).status, 'success');
  assert.equal(isCatalogApiSyncRunning(a.id), false);
  assert.equal(isCatalogApiSyncRunning(b.id), false);
});

test('catalog api sync: a resolver cap breach stays visible (no silent truncation)', async () => {
  const source = makeSource();
  let committed = false;

  // Above the resolver's own 500-product cap: the resolver throws, and the
  // error must surface rather than committing the first 500 rows.
  const products = Array.from({ length: 501 }, (_, i) => ({ name: `P${i}`, sku: `S${i}` }));
  const result = await runCatalogApiSync(source, {
    env: { API_KEY: 'secret-123' },
    lookup: async () => ['93.184.216.34'],
    fetchImpl: async () => new Response(JSON.stringify({ products }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
    commitRows: async () => { committed = true; return { importId: 'nope', created: 501, matched: 0, updated: 0, reviewRequired: 0, skipped: 0, invalid: 0, rejected: 0 }; },
  });

  assert.equal(result.status, 'failed');
  assert.match(String(result.errorSummary || ''), /Resolver/);
  assert.equal(committed, false);
});

test('catalog api sync: the service never logs and never reads the body unbounded', async () => {
  const src = readFileSync(
    resolvePath(process.cwd(), 'server', 'services', 'catalogApiSync.ts'),
    'utf8',
  );

  assert.ok(!/console\./.test(src), 'no console output (secrets/payloads must not be logged)');
  assert.ok(!/response\.text\(\)/.test(src), 'the body is read through the capped reader');
  assert.ok(!/setInterval|node-cron|later\.schedule/.test(src), 'no scheduler/cron');
  assert.ok(src.includes("redirect: 'manual'"), 'redirects are never followed');
  assert.ok(src.includes('assertTestConnectionTargetAllowed'), 'the SSRF guard is reused');
  assert.ok(!/supplier_products/i.test(src), 'no supplier_products table');
});

test('catalog api sync: a non-API source is refused outright', async () => {
  const source = makeSource({ sourceType: 'csv' });

  await assert.rejects(
    () => runCatalogApiSync(source, { env: { API_KEY: 'x' } }),
    /API sources/i,
  );
  assert.equal(listCatalogApiSyncRuns(source.id).length, 0, 'a refusal creates no run');
});
