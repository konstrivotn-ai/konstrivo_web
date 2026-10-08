// @ts-nocheck
/**
 * Global Catalog — Sources Management (Admin) — SAFE, DB-FREE tests.
 *
 * Covers:
 *  1) the PURE payload/identity helpers used to validate country/type/status and
 *     to prevent duplicates (no DB, no network);
 *  2) the HTTP surface of `GET/POST/PATCH /api/v1/global-catalog/admin/sources`
 *     mounted through the REAL router: the admin guard answers 401 before any
 *     handler runs, so NOTHING touches the database.
 *
 * No test data is created, no DB connection is opened, no mutation, no migration.
 * The DB-backed behaviours (insert / duplicate 409 / FK 400) need a real database
 * and are documented as NOT executed here.
 *
 * Run: npx tsx tests/globalCatalogSources.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';

import {
  API_MAPPING_FIELDS,
  API_MAPPING_FIELD_KEYS,
  API_MAPPING_REQUIRED_FIELDS,
  CATALOG_SOURCE_API_AUTH_TYPES,
  CATALOG_SOURCE_API_RESPONSE_FORMATS,
  CATALOG_SOURCE_STATUSES,
  CATALOG_SOURCE_TYPES,
  catalogSourceIdentity,
  describeApiMappingPath,
  isValidApiMappingPath,
  normalizeCatalogSourceApiConfiguration,
  normalizeCatalogSourceApiMapping,
  normalizeCatalogSourceInput,
} from '../server/repositories/globalCatalogRepository';
import { globalCatalogRouter } from '../server/routes/v1/globalCatalog';
import {
  TEST_CONNECTION_MAX_RESPONSE_BYTES,
  TEST_CONNECTION_TIMEOUT_MS,
  assertTestConnectionTargetAllowed,
  buildCatalogSourceConnectionPlan,
  detectResponseFormat,
  isBlockedTestConnectionHostname,
  isPrivateOrReservedAddress,
  redactTestConnectionUrl,
  resolveCatalogSourceSecret,
  runCatalogSourceTestConnection,
} from '../server/services/catalogSourceTestConnection';

// ── 1) Pure helpers ────────────────────────────────────────────────────────

test('sources: POST payload requires name + sourceType and trims/validates them', () => {
  const out = normalizeCatalogSourceInput({ name: '  Acme TN  ', sourceType: 'CSV' }, true);
  assert.equal(out.name, 'Acme TN', 'name is trimmed');
  assert.equal(out.sourceType, 'csv', 'type is normalized to lower-case');

  assert.throws(() => normalizeCatalogSourceInput({ sourceType: 'csv' }, true), /name is required/i);
  assert.throws(() => normalizeCatalogSourceInput({ name: 'Acme' }, true), /type is required/i);
  assert.throws(
    () => normalizeCatalogSourceInput({ name: 'Acme', sourceType: 'ftp' }, true),
    /Unsupported source type/i,
  );
  assert.throws(
    () => normalizeCatalogSourceInput({ name: 'x'.repeat(201), sourceType: 'csv' }, true),
    /at most 200/i,
  );
});

test('sources: PATCH payload only exposes the provided fields (partial update)', () => {
  const out = normalizeCatalogSourceInput({ status: 'INACTIVE' });
  assert.deepEqual(Object.keys(out), ['status'], 'only the provided field is returned');
  assert.equal(out.status, 'inactive');

  assert.deepEqual(normalizeCatalogSourceInput({}), {}, 'empty patch stays empty');
  assert.throws(() => normalizeCatalogSourceInput({ status: 'deleted' }), /Invalid source status/i);
});

test('sources: country / url / provider / frequency validation', () => {
  assert.equal(normalizeCatalogSourceInput({ countryCode: 'tn' }).countryCode, 'TN', 'country upper-cased');
  assert.equal(normalizeCatalogSourceInput({ countryCode: '' }).countryCode, null, 'empty country → null');
  assert.equal(normalizeCatalogSourceInput({ countryCode: null }).countryCode, null, 'null country → null');
  assert.throws(() => normalizeCatalogSourceInput({ countryCode: 'TUNISIA' }), /Invalid country code/i);
  assert.throws(() => normalizeCatalogSourceInput({ countryCode: 'T1' }), /Invalid country code/i);

  assert.equal(
    normalizeCatalogSourceInput({ url: 'https://acme.tn/catalog.csv' }).url,
    'https://acme.tn/catalog.csv',
  );
  assert.equal(normalizeCatalogSourceInput({ url: '' }).url, null);
  assert.throws(() => normalizeCatalogSourceInput({ url: 'acme.tn/file.csv' }), /http:\/\/ or https:\/\//i);

  assert.equal(normalizeCatalogSourceInput({ provider: '  ' }).provider, null);
  assert.throws(() => normalizeCatalogSourceInput({ provider: 'p'.repeat(201) }), /at most 200/i);
  assert.throws(() => normalizeCatalogSourceInput({ updateFrequency: 'f'.repeat(41) }), /at most 40/i);

  assert.deepEqual(normalizeCatalogSourceInput({ configuration: null }).configuration, {});
  assert.throws(() => normalizeCatalogSourceInput({ configuration: ['a'] }), /JSON object/i);
});

test('sources: accepted type/status sets match the documented column values', () => {
  for (const type of ['api', 'csv', 'xlsx']) {
    assert.equal(
      normalizeCatalogSourceInput({ name: 'S', sourceType: type }, true).sourceType,
      type,
      `${type} must be supported`,
    );
  }
  assert.deepEqual(CATALOG_SOURCE_STATUSES, ['active', 'inactive']);
  assert.ok(CATALOG_SOURCE_TYPES.includes('csv') && CATALOG_SOURCE_TYPES.includes('api'));
});

test('sources: duplicate identity mirrors ensureCatalogSource (name + type + country)', () => {
  const a = catalogSourceIdentity({ name: 'Acme', sourceType: 'csv', countryCode: 'tn' });
  const b = catalogSourceIdentity({ name: ' Acme ', sourceType: 'csv', countryCode: 'TN' });
  assert.equal(a, b, 'same identity after trim + upper-case country');

  assert.notEqual(
    a,
    catalogSourceIdentity({ name: 'Acme', sourceType: 'csv', countryCode: null }),
    'a country-less source is a different identity',
  );
  assert.notEqual(
    a,
    catalogSourceIdentity({ name: 'Acme', sourceType: 'xlsx', countryCode: 'TN' }),
    'a different type is a different identity',
  );
  assert.notEqual(
    a,
    catalogSourceIdentity({ name: 'Acme 2', sourceType: 'csv', countryCode: 'TN' }),
    'a different name is a different identity',
  );
});

// ── 2) HTTP surface (route mounted, guard enforced, zero DB access) ─────────

function startApp(): Promise<{ port: number; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/global-catalog', globalCatalogRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    // ApiError carries `statusCode` (server/utils/errors.ts).
    res
      .status(err?.statusCode || err?.status || 500)
      .json({ error: err?.message || 'error' });
  });

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as any;
      resolve({
        port: address.port,
        close: () =>
          new Promise((done) => {
            // undici keeps sockets alive: force-close them or server.close() hangs.
            server.closeAllConnections?.();
            server.close(() => done(undefined));
          }),
      });
    });
  });
}

test('GET/POST/PATCH /admin/sources + /admin/imports are mounted and admin-guarded', async () => {
  const { port, close } = await startApp();
  try {
    const base = `http://127.0.0.1:${port}/api/v1/global-catalog`;
    const bogus = { Authorization: 'Bearer not-a-real-token' };
    const json = { 'Content-Type': 'application/json' };

    assert.equal((await fetch(`${base}/admin/sources`)).status, 401, 'GET sources (anon) → 401');
    assert.equal(
      (await fetch(`${base}/admin/sources`, { headers: bogus })).status,
      401,
      'GET sources (bad token) → 401',
    );

    assert.equal(
      (await fetch(`${base}/admin/sources`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: 'X', sourceType: 'csv' }),
      })).status,
      401,
      'POST sources (anon) → 401',
    );

    assert.equal(
      (await fetch(`${base}/admin/sources/00000000-0000-0000-0000-000000000000`, {
        method: 'PATCH',
        headers: json,
        body: JSON.stringify({ status: 'inactive' }),
      })).status,
      401,
      'PATCH sources (anon) → 401',
    );

    // Previous phases must keep their registration.
    assert.equal((await fetch(`${base}/admin/imports`)).status, 401, 'GET imports still guarded');
    assert.equal(
      (await fetch(`${base}/admin/imports/00000000-0000-0000-0000-000000000000/items`)).status,
      401,
      'GET import items still guarded',
    );
    assert.equal((await fetch(`${base}/admin/sources/unknown`)).status, 404, 'unknown path still 404');

    console.log(
      '   [DB-free] sources GET/POST/PATCH anon+bad-token = 401 | imports still 401 | unknown = 404',
    );
  } finally {
    await close();
  }
});

// ── 3) Phase 1 — API Source Configuration (`configuration.api`) ──────────────
// Pure only: no DB, no network, NO request to the source, NO Test Connection.

test('api config: minimal payload normalizes with the documented defaults', () => {
  const out = normalizeCatalogSourceApiConfiguration({ baseUrl: '  https://api.acme.tn/v1/produits  ' });

  assert.equal(out.baseUrl, 'https://api.acme.tn/v1/produits', 'baseUrl is trimmed');
  assert.equal(out.authType, 'none', 'authType defaults to none');
  assert.deepEqual(out.headerNames, [], 'no header by default');
  assert.equal(out.credentialRef, null, 'no credential reference without authentication');
  assert.equal(out.responseFormat, 'json', 'responseFormat defaults to json');
  assert.equal(out.username, null, 'no username outside basic_auth');
  assert.equal(out.credentialLocation, 'header', 'default credential location');
  assert.equal(out.credentialKey, 'X-API-Key', 'default credential key');
});

test('api config: api_key / bearer / basic each require a valid credential REFERENCE', () => {
  const base = { baseUrl: 'https://api.acme.tn/v1' };

  const apiKey = normalizeCatalogSourceApiConfiguration({
    ...base,
    authType: 'API_KEY',
    credentialRef: 'SOURCE_ACME_API_KEY',
    credentialLocation: 'query',
    credentialKey: 'key',
  });
  assert.equal(apiKey.authType, 'api_key', 'authType is lower-cased');
  assert.equal(apiKey.credentialRef, 'SOURCE_ACME_API_KEY', 'reference kept verbatim');
  assert.equal(apiKey.credentialLocation, 'query');
  assert.equal(apiKey.credentialKey, 'key');

  const bearer = normalizeCatalogSourceApiConfiguration({
    ...base,
    authType: 'bearer_token',
    credentialRef: 'SOURCE_ACME_TOKEN',
  });
  assert.equal(bearer.credentialKey, 'Authorization', 'bearer uses the Authorization header');

  const basic = normalizeCatalogSourceApiConfiguration({
    ...base,
    authType: 'basic_auth',
    credentialRef: 'SOURCE_ACME_PASSWORD',
    username: 'sync-user',
  });
  assert.equal(basic.username, 'sync-user', 'basic_auth keeps the (non-secret) username');

  // A reference is mandatory as soon as authentication is enabled.
  assert.throws(() => normalizeCatalogSourceApiConfiguration({ ...base, authType: 'api_key' }), /credential reference/i);
  assert.throws(() => normalizeCatalogSourceApiConfiguration({ ...base, authType: 'bearer_token' }), /credential reference/i);
  // ...and basic_auth also needs the account name.
  assert.throws(
    () => normalizeCatalogSourceApiConfiguration({ ...base, authType: 'basic_auth', credentialRef: 'PW' }),
    /username is required/i,
  );
});

test('api config: a plaintext secret can NEVER be stored (key allow-list + patterns)', () => {
  const base = { baseUrl: 'https://api.acme.tn/v1', authType: 'none' };

  // 1. Unknown keys are rejected, so no secret field can be smuggled in.
  for (const secretKey of ['apiKey', 'api_key', 'token', 'password', 'secret', 'authorization']) {
    assert.throws(
      () => normalizeCatalogSourceApiConfiguration({ ...base, [secretKey]: 'sk-live-00000000' }),
      /Unknown API configuration field/i,
      `${secretKey} must be refused`,
    );
  }

  // 2. A credential-looking VALUE is refused where a reference/name is expected.
  assert.throws(
    () =>
      normalizeCatalogSourceApiConfiguration({
        baseUrl: base.baseUrl,
        authType: 'api_key',
        credentialRef: 'sk-live-abc123',
      }),
    /environment variable name/i,
  );
  assert.throws(
    () =>
      normalizeCatalogSourceApiConfiguration({
        baseUrl: base.baseUrl,
        authType: 'bearer_token',
        credentialRef: 'Bearer abc.def',
      }),
    /environment variable name/i,
  );

  // 3. Header VALUES cannot be smuggled in through `headerNames`.
  assert.throws(
    () => normalizeCatalogSourceApiConfiguration({ ...base, headerNames: ['Authorization: Bearer abc'] }),
    /header NAME/i,
  );
  assert.throws(
    () => normalizeCatalogSourceApiConfiguration({ ...base, headerNames: ['X-Api-Key=12345'] }),
    /header NAME/i,
  );
});

test('api config: base URL, auth type, header names and response format are validated', () => {
  assert.throws(() => normalizeCatalogSourceApiConfiguration({}), /baseUrl/i);
  assert.throws(() => normalizeCatalogSourceApiConfiguration({ baseUrl: 'ftp://acme.tn' }), /http/i);
  assert.throws(() => normalizeCatalogSourceApiConfiguration({ baseUrl: 'a'.repeat(2001) }), /2000/);
  assert.throws(
    () => normalizeCatalogSourceApiConfiguration({ baseUrl: 'https://a.tn', authType: 'digest' }),
    /invalid authType/i,
  );
  assert.throws(
    () => normalizeCatalogSourceApiConfiguration({ baseUrl: 'https://a.tn', responseFormat: 'yaml' }),
    /invalid responseFormat/i,
  );
  assert.throws(
    () => normalizeCatalogSourceApiConfiguration({ baseUrl: 'https://a.tn', headerNames: 'X-Api-Version' }),
    /must be an array/i,
  );
  assert.throws(
    () => normalizeCatalogSourceApiConfiguration({ baseUrl: 'https://a.tn', headerNames: new Array(21).fill('X') }),
    /at most 20/i,
  );
  assert.throws(() => normalizeCatalogSourceApiConfiguration(['https://a.tn']), /JSON object/i);
  assert.throws(() => normalizeCatalogSourceApiConfiguration(null), /JSON object/i);

  // Header names are de-duplicated case-insensitively, order preserved.
  const cfg = normalizeCatalogSourceApiConfiguration({
    baseUrl: 'https://a.tn',
    headerNames: ['X-Api-Version', 'x-api-version', 'Accept-Language'],
  });
  assert.deepEqual(cfg.headerNames, ['X-Api-Version', 'Accept-Language']);

  assert.deepEqual(CATALOG_SOURCE_API_AUTH_TYPES, ['none', 'api_key', 'bearer_token', 'basic_auth']);
  assert.deepEqual(CATALOG_SOURCE_API_RESPONSE_FORMATS, ['json', 'xml', 'csv']);
});

test('api config: configuration.api is accepted for type=api and refused for CSV/XLSX', () => {
  const apiConfig = { baseUrl: 'https://api.acme.tn/v1', authType: 'none' };

  const forApi = normalizeCatalogSourceInput(
    { name: 'Acme API', sourceType: 'API', configuration: { api: apiConfig } },
    true,
  );
  assert.equal((forApi.configuration as any).api.baseUrl, 'https://api.acme.tn/v1', 'validated block stored');

  for (const type of ['csv', 'xlsx', 'pdf', 'manual']) {
    assert.throws(
      () => normalizeCatalogSourceInput({ name: 'Acme', sourceType: type, configuration: { api: apiConfig } }, true),
      /only allowed when the source type is "api"/i,
      `${type} must not accept an API block`,
    );
  }

  // A PATCH without `sourceType` keeps whatever the row already stores.
  const patch = normalizeCatalogSourceInput({ configuration: { api: apiConfig } });
  assert.equal((patch.configuration as any).api.baseUrl, 'https://api.acme.tn/v1');

  // `configuration.api: null` simply drops the block (clear action).
  assert.deepEqual(
    normalizeCatalogSourceInput({ sourceType: 'api', configuration: { api: null } }).configuration,
    {},
    'null api block is removed',
  );
});

test('api config: non-API configuration and CSV/XLSX payloads are untouched', () => {
  // Existing behaviour (CSV/XLSX) must stay byte-identical.
  assert.deepEqual(normalizeCatalogSourceInput({ configuration: null }).configuration, {});
  assert.throws(() => normalizeCatalogSourceInput({ configuration: ['a'] }), /JSON object/i);

  // Unknown/legacy keys are preserved verbatim (no data loss on edit).
  const legacy = { foo: 'bar', nested: { a: 1 }, flag: true };
  assert.deepEqual(
    normalizeCatalogSourceInput({ sourceType: 'csv', configuration: legacy }).configuration,
    legacy,
    'legacy configuration round-trips unchanged',
  );

  // A CSV payload WITHOUT any configuration still produces none (as before).
  assert.equal(normalizeCatalogSourceInput({ name: 'Acme', sourceType: 'csv' }, true).configuration, undefined);

  // The API block is a shallow COPY, the caller's object is never mutated.
  const input = { sourceType: 'api', configuration: { api: { baseUrl: 'https://a.tn' }, keep: 1 } as any };
  normalizeCatalogSourceInput(input);
  assert.deepEqual(input.configuration.api, { baseUrl: 'https://a.tn' }, 'input left untouched');
});

// ── 4) Sources UI contract (source scan — no DOM, no DB) ────────────────────

test('sources UI: API fields are rendered only for type=api; no Test Connection / sync', () => {
  // Run from the project root (same convention as tests/p3.test.ts).
  const src = readFileSync(
    resolve(process.cwd(), 'src', 'components', 'GlobalCatalogAdminPanel.tsx'),
    'utf8',
  );

  assert.ok(
    src.includes("sourceForm.sourceType === 'api' && ("),
    'the API block must be gated on sourceType === "api"',
  );
  assert.ok(src.includes('configuration.api'), 'the block documents configuration.api');
  assert.ok(src.includes('sourceApiFormToConfiguration'), 'save() builds configuration.api');
  // CSV/XLSX saves must NOT rewrite the configuration column at all.
  assert.ok(
    src.includes('hadApiBlock'),
    'save() must omit `configuration` unless there is an API block to write or clear',
  );
  // Out-of-scope features were NOT added. (Phase 2 legitimately adds the
  // « Tester la connexion » button — its own test below proves it is gated on
  // `sourceType === 'api'` and triggers no import/sync.)
  assert.ok(!/scheduleSync|syncScheduler/i.test(src), 'no scheduler hook');
  assert.ok(!/importFromApi|syncFromApi/i.test(src), 'no API import/sync trigger');
});

// ── 5) Phase 2 — Test Connection (DB-free, NO request to any real API) ──────

test('test-connection: SSRF guard refuses local / internal hostnames', () => {
  const blocked = [
    'localhost',
    'LOCALHOST',
    'foo.localhost',
    'db.internal',
    'nas.lan',
    'printer.local',
    'router.corp',
    'svc.intranet',
    '0.0.0.0',
    '::1',
    'host.docker.internal',
    'metadata.google.internal',
    'example.test',
    'dev.example',
    'my.machine.invalid',
    '',
    '   ',
  ];
  for (const host of blocked) {
    assert.equal(isBlockedTestConnectionHostname(host), true, `must block: ${host || '<empty>'}`);
  }

  for (const host of ['api.acme.tn', 'catalog.supplier.com', 'api2.example-org.net']) {
    assert.equal(isBlockedTestConnectionHostname(host), false, `must allow: ${host}`);
  }
});

test('test-connection: private/reserved addresses are refused (IPv4 + IPv6), fail closed', () => {
  const blocked = [
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.5',
    '172.16.9.9',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1',
    '0.0.0.0',
    '255.255.255.255',
    '224.0.0.1',
    '240.0.0.1',
    '198.18.0.1',
    '203.0.113.7',
    '::1',
    '::',
    'fc00::1',
    'fd12::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:192.168.0.1',
    'not-an-ip',
    '',
  ];
  for (const ip of blocked) {
    assert.equal(isPrivateOrReservedAddress(ip), true, `must block: ${ip || '<empty>'}`);
  }

  for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) {
    assert.equal(isPrivateOrReservedAddress(ip), false, `must allow: ${ip}`);
  }
});

test('test-connection: target check blocks BEFORE any request (injected DNS, no network)', async () => {
  const cases: Array<[string, RegExp]> = [
    ['http://127.0.0.1:8080/x', /locale, privée/i],
    ['http://localhost/api', /locale, privée/i],
    ['http://169.254.169.254/latest/meta-data/', /locale, privée/i],
    ['ftp://api.acme.tn/x', /http/i],
    ['not a url', /invalide/i],
  ];
  for (const [url, pattern] of cases) {
    await assert.rejects(() => assertTestConnectionTargetAllowed(url), pattern, url);
  }

  // A hostname that RESOLVES to a private address is refused (injected DNS).
  await assert.rejects(
    () => assertTestConnectionTargetAllowed('https://evil.acme.tn/x', async () => ['10.0.0.7']),
    /locale, privée/i,
  );
  // Unresolvable host → clear error, and still no request is ever made.
  await assert.rejects(
    () =>
      assertTestConnectionTargetAllowed('https://nowhere.acme.tn/x', async () => {
        throw new Error('ENOTFOUND');
      }),
    /introuvable/i,
  );

  // A public answer passes — purely in-memory, NO real DNS, NO HTTP request.
  await assertTestConnectionTargetAllowed(
    'https://api.acme.tn/x',
    async () => ['93.184.216.34'],
  );
});

test('test-connection: a missing secret is a clear error, never an empty credential', () => {
  const api = {
    baseUrl: 'https://api.acme.tn/v1',
    authType: 'api_key',
    credentialRef: 'ACME_TEST_KEY_REF',
  };

  // Present but blank, or entirely absent → both resolve to "no secret".
  assert.equal(resolveCatalogSourceSecret('ACME_TEST_KEY_REF', { ACME_TEST_KEY_REF: '   ' }), null);
  assert.equal(resolveCatalogSourceSecret('ACME_TEST_KEY_REF', {}), null);
  assert.equal(resolveCatalogSourceSecret('', { X: 'y' }), null);
  assert.equal(resolveCatalogSourceSecret(null, { X: 'y' }), null);
  assert.equal(resolveCatalogSourceSecret('ACME_TEST_KEY_REF', { ACME_TEST_KEY_REF: ' v ' }), 'v');

  // The plan is refused with an explicit, credential-free message.
  for (const env of [{}, { ACME_TEST_KEY_REF: '' }, { ACME_TEST_KEY_REF: '  ' }]) {
    assert.throws(
      () => buildCatalogSourceConnectionPlan(api, env as any),
      (err: any) => {
        assert.equal(err.statusCode, 400, 'refusal is a 400');
        assert.match(err.message, /Secret introuvable/i);
        assert.match(err.message, /Aucune requête/i);
        return true;
      },
    );
  }

  // `authType: none` needs no secret at all.
  assert.equal(
    buildCatalogSourceConnectionPlan({ baseUrl: 'https://api.acme.tn/v1', authType: 'none' }, {})
      .headers.Authorization,
    undefined,
    'no Authorization header when authentication is disabled',
  );
});

test('test-connection: all four auth types are built from credentialRef only', () => {
  const env = {
    ACME_KEY: 'TOP-SECRET-VALUE',
    ACME_TOKEN: 'TOKEN-VALUE',
    ACME_PW: 'PW-VALUE',
  };
  const base = 'https://api.acme.tn/v1';

  const apiKey = buildCatalogSourceConnectionPlan(
    {
      baseUrl: base,
      authType: 'api_key',
      credentialRef: 'ACME_KEY',
      credentialLocation: 'header',
      credentialKey: 'X-Api-Key',
      // Names only: Phase 1 deliberately stores no header VALUE, so nothing
      // is sent for them — they can never leak a credential.
      headerNames: ['X-Api-Version', 'X-Tenant'],
    },
    env,
  );
  assert.equal(apiKey.headers['X-Api-Key'], 'TOP-SECRET-VALUE');
  assert.equal(apiKey.headers['X-Api-Version'], undefined, 'configured header names are not sent');
  assert.equal(apiKey.headers['Authorization'], undefined, 'api_key never also sets Authorization');

  const inQuery = buildCatalogSourceConnectionPlan(
    {
      baseUrl: base,
      authType: 'api_key',
      credentialRef: 'ACME_KEY',
      credentialLocation: 'query',
      credentialKey: 'key',
    },
    env,
  );
  assert.ok(inQuery.url.includes('TOP-SECRET-VALUE'), 'the key is placed where the config asks');
  // …and therefore the URL must never be exposed as-is.
  assert.equal(redactTestConnectionUrl(inQuery.url), 'https://api.acme.tn');

  const bearer = buildCatalogSourceConnectionPlan(
    { baseUrl: base, authType: 'bearer_token', credentialRef: 'ACME_TOKEN' },
    env,
  );
  assert.equal(bearer.headers.Authorization, 'Bearer TOKEN-VALUE');

  const basic = buildCatalogSourceConnectionPlan(
    { baseUrl: base, authType: 'basic_auth', credentialRef: 'ACME_PW', username: 'sync-user' },
    env,
  );
  assert.equal(
    basic.headers.Authorization,
    `Basic ${Buffer.from('sync-user:PW-VALUE', 'utf8').toString('base64')}`,
  );
});

test('test-connection: a URL carrying a credential in its query is never exposed', () => {
  assert.equal(
    redactTestConnectionUrl('https://api.acme.tn/v1/prod?api_key=SECRET&x=1'),
    'https://api.acme.tn',
    'query and path are dropped',
  );
  assert.equal(redactTestConnectionUrl('https://api.acme.tn:8443/#tok=SECRET'), 'https://api.acme.tn:8443');
  assert.equal(redactTestConnectionUrl('nonsense'), 'invalid-url');
  assert.ok(!redactTestConnectionUrl('https://a.tn/?token=SECRET').includes('SECRET'));
});

test('test-connection: response format is detected best-effort (Content-Type, then sniff)', () => {
  assert.equal(detectResponseFormat('application/json; charset=utf-8'), 'json');
  assert.equal(detectResponseFormat('application/vnd.api+json'), 'json');
  assert.equal(detectResponseFormat('text/xml; charset=utf-8'), 'xml');
  assert.equal(detectResponseFormat('application/atom+xml'), 'xml');
  assert.equal(detectResponseFormat('text/csv'), 'csv');
  assert.equal(detectResponseFormat('text/html; charset=utf-8'), 'html');
  assert.equal(detectResponseFormat('text/plain'), 'text');
  assert.equal(detectResponseFormat('application/octet-stream'), 'application/octet-stream');
  // No header at all → peek at the (already byte-capped) body prefix.
  assert.equal(detectResponseFormat('', '  {"a":1}'), 'json');
  assert.equal(detectResponseFormat('', '[1,2,3]'), 'json');
  assert.equal(detectResponseFormat('', '<!doctype html>'), 'html');
  assert.equal(detectResponseFormat(''), null);
  assert.equal(detectResponseFormat('', 'plain words'), null);
});

test('test-connection: probe hardening with an INJECTED fetch (no real API, no DNS)', async () => {
  const source = {
    sourceType: 'api',
    configuration: { api: { baseUrl: 'https://api.acme.tn/v1', authType: 'none' } },
  };
  const lookup = async () => ['93.184.216.34'];

  let seen: any = null;
  const okFetch = (async (_url: string, init: any) => {
    seen = init;
    return new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as any;

  const ok = await runCatalogSourceTestConnection(source, { fetchImpl: okFetch, lookup });
  assert.equal(ok.success, true, '2xx is a success');
  assert.equal(ok.status, 200);
  assert.equal(ok.format, 'json');
  assert.equal(ok.target, 'https://api.acme.tn', 'only the origin is exposed');
  assert.equal(ok.message, 'Connexion réussie.');
  assert.equal(typeof ok.durationMs, 'number');
  assert.equal(seen.redirect, 'manual', 'redirects are never followed');
  assert.ok(seen.signal, 'an AbortSignal (timeout) is always attached');

  // 4xx/5xx → `success:false` but the status is still reported.
  const ko = await runCatalogSourceTestConnection(source, {
    lookup,
    fetchImpl: (async () => new Response('boom', { status: 500 })) as any,
  });
  assert.equal(ko.success, false);
  assert.equal(ko.status, 500);
  assert.match(ko.message, /500/);

  // A redirect is REPORTED, not followed — and its target is never exposed.
  const redirected = await runCatalogSourceTestConnection(source, {
    lookup,
    fetchImpl: (async () =>
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/steal' } })) as any,
  });
  assert.equal(redirected.success, false);
  assert.equal(redirected.status, 302);
  assert.match(redirected.message, /Redirection/);
  assert.ok(!redirected.target!.includes('127.0.0.1'), 'the redirect target is never exposed');
});

test('test-connection: refusals happen BEFORE any request (type, config, secret, SSRF)', async () => {
  const lookup = async () => ['93.184.216.34'];
  let called = 0;
  const boom = (async () => {
    called += 1;
    return new Response('{}', { status: 200 });
  }) as any;

  // Non-API source → refused.
  await assert.rejects(
    () => runCatalogSourceTestConnection({ sourceType: 'csv', configuration: {} }, { lookup, fetchImpl: boom }),
    /type « api »/i,
  );

  // API source without `configuration.api` → refused.
  await assert.rejects(
    () => runCatalogSourceTestConnection({ sourceType: 'api', configuration: {} }, { lookup, fetchImpl: boom }),
    /configuration API/i,
  );

  // Missing secret → refused, and an EMPTY credential is never sent.
  await assert.rejects(
    () =>
      runCatalogSourceTestConnection(
        {
          sourceType: 'api',
          configuration: {
            api: {
              baseUrl: 'https://api.acme.tn/v1',
              authType: 'bearer_token',
              credentialRef: 'NO_SUCH_ENV_VAR_PHASE2',
            },
          },
        },
        { lookup, fetchImpl: boom, env: {} },
      ),
    /Secret introuvable/i,
  );

  // Private target → refused before the socket is ever opened.
  await assert.rejects(
    () =>
      runCatalogSourceTestConnection(
        {
          sourceType: 'api',
          configuration: { api: { baseUrl: 'http://127.0.0.1:5432/secret', authType: 'none' } },
        },
        { lookup, fetchImpl: boom },
      ),
    /locale, privée/i,
  );

  assert.equal(called, 0, 'fetch was NEVER invoked for any refusal');
});

test('test-connection: a network failure never echoes the URL or the credential', async () => {
  const source = {
    sourceType: 'api',
    configuration: {
      api: { baseUrl: 'https://api.acme.tn/v1?api_key=LEAKED-SECRET', authType: 'none' },
    },
  };

  const result = await runCatalogSourceTestConnection(source, {
    lookup: async () => ['93.184.216.34'],
    fetchImpl: (async () => {
      // Simulates undici surfacing the full URL (query included) in the error.
      throw new Error('connect ECONNREFUSED https://api.acme.tn/v1?api_key=LEAKED-SECRET');
    }) as any,
  });

  assert.equal(result.success, false);
  assert.equal(result.status, null);
  assert.equal(result.target, 'https://api.acme.tn', 'target carries no query');
  assert.ok(!result.message.includes('LEAKED-SECRET'), 'the raw fetch error is discarded');
  assert.ok(!result.message.includes('api.acme.tn'), 'no URL fragment in the message');
  assert.ok(!JSON.stringify(result).includes('LEAKED-SECRET'), 'nothing in the payload leaks');
});

test('test-connection: timeouts and body cap are short and hard-coded', () => {
  assert.equal(TEST_CONNECTION_TIMEOUT_MS, 5000, 'fixed 5s timeout');
  assert.ok(TEST_CONNECTION_TIMEOUT_MS <= 10_000, 'never a long-running request');
  assert.equal(TEST_CONNECTION_MAX_RESPONSE_BYTES, 64 * 1024, '64 KiB body cap');
  assert.ok(TEST_CONNECTION_MAX_RESPONSE_BYTES <= 256 * 1024, 'cap stays small');
});

test('test-connection: POST /admin/sources/:id/test-connection is admin-guarded (no DB)', async () => {
  const { port, close } = await startApp();
  try {
    const base = `http://127.0.0.1:${port}/api/v1/global-catalog`;
    const url = `${base}/admin/sources/00000000-0000-0000-0000-000000000000/test-connection`;
    const json = { 'Content-Type': 'application/json' };
    const bogus = { Authorization: 'Bearer not-a-real-token' };

    // The guard answers 401 before the handler runs, so NOTHING touches the
    // database and NO outbound request is ever made from this test.
    assert.equal(
      (await fetch(url, { method: 'POST', headers: json })).status,
      401,
      'POST test-connection (anon) → 401',
    );
    assert.equal(
      (await fetch(url, { method: 'POST', headers: { ...json, ...bogus } })).status,
      401,
      'POST test-connection (bad token) → 401',
    );
    // The endpoint exists for POST only.
    assert.equal(
      (await fetch(url, { method: 'GET', headers: json })).status,
      404,
      'GET on the same path → 404 (POST-only route)',
    );
    // Phase 1 registrations are still intact.
    assert.equal((await fetch(`${base}/admin/sources`)).status, 401, 'GET sources still guarded');
    assert.equal((await fetch(`${base}/admin/imports`)).status, 401, 'GET imports still guarded');

    console.log(
      '   [DB-free] test-connection POST anon+bad-token = 401 | GET = 404 | sources+imports still 401',
    );
  } finally {
    await close();
  }
});

test('test-connection: route is admin-gated; the probe writes nothing and logs nothing', () => {
  const routeSrc = readFileSync(
    resolve(process.cwd(), 'server', 'routes', 'v1', 'globalCatalog.ts'),
    'utf8',
  );
  const start = routeSrc.indexOf("router.post('/admin/sources/:id/test-connection'");
  assert.ok(start > -1, 'the route is registered');
  const end = routeSrc.indexOf('const source = await getCatalogSourceById(id);', start);
  assert.ok(end > start, 'the handler is present');
  assert.ok(
    routeSrc.slice(start, end).includes('...requireAdminWrite'),
    'the route sits behind requireAdminWrite (authenticate + entitlement + admin role)',
  );

  const svc = readFileSync(
    resolve(process.cwd(), 'server', 'services', 'catalogSourceTestConnection.ts'),
    'utf8',
  );
  // No secret, credential, URL or header may ever reach the logs.
  assert.ok(!/console\.(log|info|warn|error|debug)/.test(svc), 'the probe logs nothing');
  // Nothing is persisted: no response body, no row update, no import run.
  assert.ok(!/\binsert\s*\(|\bupdate\s*\(|\bdelete\s*\(/.test(svc), 'no DB write');
  assert.ok(!/catalog_imports|last_successful_sync_at/.test(svc), 'never touches sync/import columns');
  // Hardening is present and hard-coded.
  assert.ok(svc.includes("redirect: 'manual'"), 'redirects are never followed');
  assert.ok(svc.includes('TEST_CONNECTION_TIMEOUT_MS'), 'the fixed timeout is used');
  assert.ok(svc.includes('TEST_CONNECTION_MAX_RESPONSE_BYTES'), 'the response body is capped');
  assert.ok(!svc.includes('setInterval'), 'no recurring job / scheduler');
  assert.ok(!/node-cron|later\.schedule/i.test(svc), 'no cron library');
  // No secrets manager is invented in this phase.
  assert.ok(!/secretsManager|createCipheriv/i.test(svc), 'no new secrets system');
});

test('test-connection UI: button only for `api` sources, and it never mutates the source', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'src', 'components', 'GlobalCatalogAdminPanel.tsx'),
    'utf8',
  );

  assert.ok(src.includes('Tester la connexion'), 'the button label exists');
  assert.ok(src.includes('testGlobalCatalogSourceConnection'), 'the button calls the endpoint');
  assert.ok(
    src.includes("source.sourceType === 'api' && ("),
    'the button is rendered only when sourceType === "api"',
  );

  const start = src.indexOf('const testSourceConnection = async (source: GlobalCatalogSource)');
  assert.ok(start > -1, 'the handler exists');
  const end = src.indexOf('const runImportPreview', start);
  assert.ok(end > start, 'the handler is bounded');
  const handler = src.slice(start, end);

  assert.ok(
    handler.includes("source.sourceType !== 'api'"),
    'a runtime guard re-checks the type before probing',
  );
  assert.ok(!handler.includes('loadSources'), 'the list is NOT reloaded → row state untouched');
  assert.ok(!handler.includes('adminUpdateGlobalCatalogSource'), 'the source row is never written');
  assert.ok(!handler.includes('adminCreateGlobalCatalogSource'), 'no source is created');
  assert.ok(!handler.includes('commitGlobalCatalogImport'), 'no import is started');
  assert.ok(!handler.includes('adminApproveGlobalCatalogImportItem'), 'no review action');
});

// ── 6) Phase 3 — API Response Mapping (`configuration.api.mapping`) ─────────
// Pure validation only: no DB, no network, no real API, no migration.

test('mapping: exactly the 12 basic Global Catalog fields, only `name` required', () => {
  assert.deepEqual(
    API_MAPPING_FIELD_KEYS,
    [
      'name',
      'sku',
      'gtin',
      'brand',
      'manufacturer',
      'category',
      'subcategory',
      'unit',
      'description',
      'price',
      'currency',
      'availability',
    ],
    'the registry must be exactly the phase-spec field list, in that order',
  );
  assert.equal(API_MAPPING_FIELDS.length, 12);
  assert.deepEqual(API_MAPPING_REQUIRED_FIELDS, ['name']);
  assert.equal(API_MAPPING_FIELDS[0].required, true, 'product name is the required one');
  for (const field of API_MAPPING_FIELDS) {
    assert.ok(field.label && field.label.length > 0, `${field.key} needs a label`);
  }
  // Derived, not declared twice.
  assert.deepEqual(
    API_MAPPING_FIELDS.map((f) => f.key),
    API_MAPPING_FIELD_KEYS,
  );
});

test('mapping: paths are validated (empty / whitespace / traversal refused)', () => {
  for (const good of [
    'name',
    'pricing.current',
    'items[0].name',
    'data.products[2].sku',
    'نص',
    'a-b_c$d',
  ]) {
    assert.equal(isValidApiMappingPath(good), true, `must accept: ${good}`);
  }

  for (const bad of [
    '',
    '   ',
    'name with space',
    '.name',
    'name.',
    'a..b',
    '..',
    "name'",
    'na"me',
    'na\\me',
    'items[].name',
    'items[x].name',
    '[0].name',
    'x'.repeat(201),
  ]) {
    assert.equal(isValidApiMappingPath(bad), false, `must refuse: ${JSON.stringify(bad)}`);
  }
});

test('mapping: the absolute address is composed as <root>.<collection>[].<field>', () => {
  assert.equal(describeApiMappingPath('', 'products', 'name'), 'products[].name');
  assert.equal(describeApiMappingPath('data', 'products', 'pricing.current'), 'data.products[].pricing.current');
  assert.equal(describeApiMappingPath('data', '', 'name'), 'data[].name');
  assert.equal(describeApiMappingPath('', '', 'name'), 'name');
});

test('mapping: normalizes rows / object into one canonical, de-duplicated shape', () => {
  const fromRows = normalizeCatalogSourceApiMapping({
    root: ' data ',
    collection: ' products ',
    fields: [
      { field: 'name', path: ' name ' },
      { field: 'SKU', path: 'sku' },
      { field: 'price', path: 'pricing.current' },
      { field: 'gtin', path: 'identifiers[0].value' },
    ],
  });

  assert.equal(fromRows.root, 'data', 'root is trimmed');
  assert.equal(fromRows.collection, 'products', 'collection is trimmed');
  assert.deepEqual(fromRows.fields, {
    name: 'name',
    sku: 'sku',
    price: 'pricing.current',
    gtin: 'identifiers[0].value',
  }, 'keys are lower-cased, paths trimmed, order irrelevant');

  // The SAME mapping expressed as an object map normalizes identically.
  const fromObject = normalizeCatalogSourceApiMapping({
    root: 'data',
    collection: 'products',
    fields: { name: 'name', sku: 'sku', price: 'pricing.current', gtin: 'identifiers[0].value' },
  });
  assert.deepEqual(fromObject, fromRows, 'both input forms converge');

  // An ABSOLUTE address is accepted on input and stored in the relative form.
  const absolute = normalizeCatalogSourceApiMapping({
    collection: 'products',
    fields: [{ field: 'name', path: 'products[].name' }],
  });
  assert.deepEqual(absolute.fields, { name: 'name' }, 'collection prefix stripped');
  assert.equal(
    describeApiMappingPath(absolute.root, absolute.collection, absolute.fields.name),
    'products[].name',
    'the composed address round-trips to the literal example',
  );

  // `root` + absolute form strips both segments.
  const nested = normalizeCatalogSourceApiMapping({
    root: 'data',
    collection: 'items',
    fields: { name: 'data.items[].title' },
  });
  assert.deepEqual(nested.fields, { name: 'title' });
});

test('mapping: duplicate Global Catalog fields are refused', () => {
  const dup = /duplicate Global Catalog field/i;

  assert.throws(
    () =>
      normalizeCatalogSourceApiMapping({
        collection: 'products',
        fields: [
          { field: 'name', path: 'name' },
          { field: 'name', path: 'title' },
        ],
      }),
    dup,
  );
  // Case variants are the SAME Global Catalog field.
  assert.throws(
    () =>
      normalizeCatalogSourceApiMapping({
        collection: 'products',
        fields: [
          { field: 'name', path: 'name' },
          { field: '  NAME ', path: 'title' },
        ],
      }),
    dup,
  );
  assert.throws(
    () =>
      normalizeCatalogSourceApiMapping({
        collection: 'products',
        fields: { name: 'name', Name: 'title' },
      }),
    dup,
  );
});

test('mapping: empty and invalid paths are refused', () => {
  const base = { collection: 'products' };

  assert.throws(
    () => normalizeCatalogSourceApiMapping({ ...base, fields: [{ field: 'name', path: '   ' }] }),
    /response path is required/i,
  );
  assert.throws(
    () => normalizeCatalogSourceApiMapping({ ...base, fields: [{ field: 'name' }] }),
    /response path is required/i,
  );
  assert.throws(
    () => normalizeCatalogSourceApiMapping({ ...base, fields: [{ field: 'name', path: '.name' }] }),
    /invalid response path/i,
  );
  assert.throws(
    () =>
      normalizeCatalogSourceApiMapping({ ...base, fields: [{ field: 'name', path: 'a..b' }] }),
    /invalid response path/i,
  );
  assert.throws(
    () =>
      normalizeCatalogSourceApiMapping({ root: '..data', fields: [{ field: 'name', path: 'name' }] }),
    /invalid root path/i,
  );
  assert.throws(
    () =>
      normalizeCatalogSourceApiMapping({ collection: 'my products', fields: [{ field: 'name', path: 'name' }] }),
    /invalid collection path/i,
  );
  // A row with no field at all.
  assert.throws(
    () => normalizeCatalogSourceApiMapping({ fields: [{ field: '', path: 'name' }] }),
    /field is required/i,
  );
});

test('mapping: unsupported fields / keys are refused, and `name` is mandatory', () => {
  const allowed = /unsupported field/i;

  // Only the 12 basic fields — nothing else can be mapped.
  for (const field of ['specification', 'media', 'extra', 'model', 'status', 'id', 'password']) {
    assert.throws(
      () =>
        normalizeCatalogSourceApiMapping({
          collection: 'products',
          fields: [{ field: 'name', path: 'name' }, { field, path: 'x' }],
        }),
      allowed,
      `${field} must not be mappable`,
    );
  }

  // Unknown keys on the mapping object itself.
  for (const key of ['sample', 'response', 'credential', 'headers']) {
    assert.throws(
      () =>
        normalizeCatalogSourceApiMapping({
          collection: 'products',
          fields: [{ field: 'name', path: 'name' }],
          [key]: 'x',
        }),
      /Mapping: unknown field/i,
      `${key} must not be accepted`,
    );
  }

  // The required product name cannot be omitted.
  assert.throws(
    () =>
      normalizeCatalogSourceApiMapping({
        collection: 'products',
        fields: [{ field: 'sku', path: 'sku' }],
      }),
    /the "name" field is required/i,
  );
  assert.throws(
    () => normalizeCatalogSourceApiMapping({ collection: 'products', fields: [] }),
    /at least one field/i,
  );
  assert.throws(
    () => normalizeCatalogSourceApiMapping({ collection: 'products' }),
    /"fields" is required/i,
  );
  assert.throws(() => normalizeCatalogSourceApiMapping(null), /JSON object/i);
  assert.throws(() => normalizeCatalogSourceApiMapping([{ field: 'name' }]), /JSON object/i);
  assert.throws(
    () =>
      normalizeCatalogSourceApiMapping({
        collection: 'products',
        fields: 'name=products[].name',
      }),
    /object or an array/i,
  );
});

test('api config: `mapping` is optional — Phase 1 rows and `mapping: null` stay safe', () => {
  const phase1 = normalizeCatalogSourceApiConfiguration({
    baseUrl: 'https://api.acme.tn/v1',
    authType: 'none',
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(phase1, 'mapping'),
    false,
    'a Phase 1 configuration has NO mapping key (backward compatible)',
  );

  // A mapping rides along inside `configuration.api`, validated in one pass.
  const withMapping = normalizeCatalogSourceApiConfiguration({
    baseUrl: 'https://api.acme.tn/v1',
    authType: 'none',
    mapping: { collection: 'products', fields: [{ field: 'name', path: 'name' }] },
  });
  assert.deepEqual(withMapping.mapping, {
    root: '',
    collection: 'products',
    fields: { name: 'name' },
  });

  // An invalid mapping is refused by the SAME call.
  assert.throws(
    () =>
      normalizeCatalogSourceApiConfiguration({
        baseUrl: 'https://api.acme.tn/v1',
        authType: 'none',
        mapping: { collection: 'products', fields: [{ field: 'sku', path: 'sku' }] },
      }),
    /the "name" field is required/i,
  );

  // `mapping: null` removes it safely (clear action)…
  const cleared = normalizeCatalogSourceApiConfiguration({
    baseUrl: 'https://api.acme.tn/v1',
    authType: 'none',
    mapping: null,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(cleared, 'mapping'), false, 'null clears it');

  // …while every OTHER key is still refused by the Phase 1 allow-list.
  assert.throws(
    () =>
      normalizeCatalogSourceApiConfiguration({
        baseUrl: 'https://api.acme.tn/v1',
        authType: 'none',
        mapping2: null,
      } as any),
    /Unknown API configuration field/i,
  );

  // And the whole thing still round-trips through the source payload normalizer.
  const source = normalizeCatalogSourceInput(
    {
      name: 'Acme API',
      sourceType: 'api',
      configuration: {
        api: {
          baseUrl: 'https://api.acme.tn/v1',
          authType: 'none',
          mapping: { collection: 'products', fields: { name: 'name' } },
        },
      },
    },
    true,
  );
  assert.deepEqual(
    (source.configuration as any).api.mapping.fields,
    { name: 'name' },
    'the mapping survives the source-level normalization',
  );
});

test('mapping: CSV/XLSX payloads are untouched by Phase 3', () => {
  // A CSV source still cannot carry an API block at all.
  assert.throws(
    () =>
      normalizeCatalogSourceInput(
        {
          name: 'Acme',
          sourceType: 'csv',
          configuration: {
            api: { baseUrl: 'https://api.acme.tn/v1', mapping: { fields: { name: 'n' } } },
          },
        },
        true,
      ),
    /only allowed when the source type is "api"/i,
  );

  // Plain CSV configuration round-trips byte-identically.
  const legacy = { foo: 'bar', nested: { a: 1 } };
  assert.deepEqual(
    normalizeCatalogSourceInput({ sourceType: 'csv', configuration: legacy }).configuration,
    legacy,
    'CSV/XLSX configuration is unchanged',
  );
  assert.equal(
    normalizeCatalogSourceInput({ name: 'Acme', sourceType: 'xlsx' }, true).configuration,
    undefined,
    'no configuration key is invented for XLSX',
  );
});

test('mapping: saving it triggers NO request, NO import, NO sync', async () => {
  // 1) The Phase 3 block is pure — no network, no DB, no scheduler, no logging.
  const repoSrc = readFileSync(
    resolve(process.cwd(), 'server', 'repositories', 'globalCatalogRepository.ts'),
    'utf8',
  );
  const start = repoSrc.indexOf('// Phase 3 — API Response Mapping');
  const end = repoSrc.indexOf('/**\n * Normalize + validate `configuration.api`.', start);
  assert.ok(start > -1 && end > start, 'the Phase 3 block is isolated in the source');
  const mappingBlock = repoSrc.slice(start, end);
  for (const forbidden of [
    'fetch(',
    'http.request',
    'getDatabase',
    'insert(',
    'update(',
    'setInterval',
    'console.',
  ]) {
    assert.ok(
      !mappingBlock.includes(forbidden),
      `the mapping validator must not contain "${forbidden}"`,
    );
  }

  // 2) A mapping never reaches the network: the connection plan is IDENTICAL
  //    with and without one, and the Phase 2 probe still issues exactly one
  //    request and reports exactly as before.
  const env = {};
  const plain = buildCatalogSourceConnectionPlan(
    { baseUrl: 'https://api.acme.tn/v1', authType: 'none' },
    env,
  );
  const withMapping = buildCatalogSourceConnectionPlan(
    {
      baseUrl: 'https://api.acme.tn/v1',
      authType: 'none',
      mapping: { collection: 'products', fields: { name: 'name' } },
    },
    env,
  );
  assert.deepEqual(withMapping.headers, plain.headers, 'the mapping adds no header');
  assert.equal(withMapping.url, plain.url, 'the mapping changes no URL');

  const probed = await runCatalogSourceTestConnection(
    {
      sourceType: 'api',
      configuration: {
        api: {
          baseUrl: 'https://api.acme.tn/v1',
          authType: 'none',
          mapping: { collection: 'products', fields: { name: 'name' } },
        },
      },
    },
    {
      lookup: async () => ['93.184.216.34'],
      fetchImpl: (async () =>
        new Response('{"ok":true}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as any,
    },
  );
  assert.equal(probed.success, true, 'Test Connection is unchanged by the mapping');
  assert.equal(probed.status, 200);
  assert.equal(probed.format, 'json');
  assert.equal(probed.target, 'https://api.acme.tn');
});

test('mapping: Test Connection and the Sources endpoints were not rewired', () => {
  // 1) The Phase 2 probe knows nothing about the mapping.
  const serviceSrc = readFileSync(
    resolve(process.cwd(), 'server', 'services', 'catalogSourceTestConnection.ts'),
    'utf8',
  );
  assert.ok(
    !serviceSrc.includes('normalizeCatalogSourceApiMapping'),
    'Test Connection never reads the mapping',
  );
  assert.ok(
    !serviceSrc.includes('API_MAPPING'),
    'Test Connection never reads the mapping registry',
  );
  assert.ok(
    !serviceSrc.includes('describeApiMappingPath'),
    'Test Connection never composes a mapping path',
  );

  // 2) No endpoint was added for the mapping, and every Sources + Test
  //    Connection route that already existed is still registered unchanged.
  const routeSrc = readFileSync(
    resolve(process.cwd(), 'server', 'routes', 'v1', 'globalCatalog.ts'),
    'utf8',
  );
  assert.ok(
    !/router\.(get|post|patch|put|delete)\s*\(\s*'[^']*mapping/i.test(routeSrc),
    'no mapping endpoint exists',
  );
  assert.ok(!routeSrc.includes('normalizeCatalogSourceApiMapping'), 'the router does not import it');
  assert.ok(routeSrc.includes("router.get('/admin/sources'"), 'GET /admin/sources unchanged');
  assert.ok(routeSrc.includes("router.post('/admin/sources'"), 'POST /admin/sources unchanged');
  assert.ok(
    routeSrc.includes("router.patch('/admin/sources/:id'"),
    'PATCH /admin/sources/:id unchanged',
  );
  assert.ok(
    routeSrc.includes("router.post('/admin/sources/:id/test-connection'"),
    'the Test Connection endpoint is unchanged',
  );

  // 3) The UI mapping helpers are PURE: no API call, no import, no sync.
  const componentSrc = readFileSync(
    resolve(process.cwd(), 'src', 'components', 'GlobalCatalogAdminPanel.tsx'),
    'utf8',
  );
  const helperStart = componentSrc.indexOf('type SourceMappingState');
  const helperEnd = componentSrc.indexOf('/** `configuration` → objet JS', helperStart);
  assert.ok(helperStart > -1 && helperEnd > helperStart, 'the mapping helpers are isolated');
  const helpers = componentSrc.slice(helperStart, helperEnd);
  for (const forbidden of [
    'adminCreateGlobalCatalogSource',
    'adminUpdateGlobalCatalogSource',
    'testGlobalCatalogSourceConnection',
    'commitGlobalCatalogImport',
    'listGlobalCatalogSources',
    'fetch(',
  ]) {
    assert.ok(!helpers.includes(forbidden), `the mapping helpers must not call ${forbidden}`);
  }
});

test('mapping: the client registry is LOCKED to the server registry', () => {
  // The two lists can never be imported from one another (the server module
  // pulls in Drizzle/Postgres), so they are mirrored — and pinned here.
  const apiSrc = readFileSync(resolve(process.cwd(), 'src', 'lib', 'api.ts'), 'utf8');
  const apiStart = apiSrc.indexOf('export const GLOBAL_CATALOG_API_MAPPING_FIELDS');
  assert.ok(apiStart > -1, 'the client registry exists');
  const apiArrayStart = apiSrc.indexOf('= [', apiStart);
  const apiArrayEnd = apiSrc.indexOf('\n];', apiArrayStart);
  assert.ok(
    apiArrayStart > -1 && apiArrayEnd > apiArrayStart,
    'the client registry array is well formed',
  );
  const clientKeys = Array.from(
    apiSrc.slice(apiArrayStart, apiArrayEnd).matchAll(/key:\s*'([a-z_]+)'/g),
  ).map((m) => m[1]);

  const repoSrc = readFileSync(
    resolve(process.cwd(), 'server', 'repositories', 'globalCatalogRepository.ts'),
    'utf8',
  );
  const repoStart = repoSrc.indexOf('export const API_MAPPING_FIELDS');
  assert.ok(repoStart > -1, 'the server registry exists');
  const repoArrayStart = repoSrc.indexOf('= [', repoStart);
  const repoArrayEnd = repoSrc.indexOf('\n];', repoArrayStart);
  assert.ok(
    repoArrayStart > -1 && repoArrayEnd > repoArrayStart,
    'the server registry array is well formed',
  );
  const serverKeys = Array.from(
    repoSrc.slice(repoArrayStart, repoArrayEnd).matchAll(/key:\s*'([a-z_]+)'/g),
  ).map((m) => m[1]);

  assert.deepEqual(
    clientKeys,
    serverKeys,
    'the browser registry must mirror the server registry exactly (order included)',
  );
  assert.deepEqual(serverKeys, API_MAPPING_FIELD_KEYS, 'and match the exported server list');
  assert.equal(serverKeys.length, 12, 'the 12 basic fields and nothing else');
  assert.equal(API_MAPPING_REQUIRED_FIELDS.join(','), 'name', 'only the name is mandatory');
  assert.deepEqual(
    API_MAPPING_FIELDS.map((f) => f.key),
    serverKeys,
    'the typed registry and the keys agree',
  );
});

test('mapping UI: the Mapping section renders only for `api` sources', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'src', 'components', 'GlobalCatalogAdminPanel.tsx'),
    'utf8',
  );

  assert.ok(src.includes('Mapping de la réponse'), 'the Mapping section exists');
  assert.ok(src.includes('buildSourceApiMapping'), 'save() builds the mapping');
  assert.ok(src.includes('mappingToState'), 'Edit prefills the mapping');
  assert.ok(src.includes('Ajouter un champ'), 'rows can be added');
  assert.ok(src.includes('removeMappingRow'), 'rows can be removed');
  assert.ok(src.includes('champ Global Catalog dupliqué'), 'duplicates are refused client-side');
  assert.ok(
    src.includes('GLOBAL_CATALOG_API_MAPPING_FIELDS'),
    'the field selector is registry-driven (no second list)',
  );

  // The section lives INSIDE the `sourceType === 'api'` block, so it can never
  // render for CSV/XLSX. Anchors verified against the component source.
  const apiBlockStart = src.indexOf("sourceForm.sourceType === 'api' && (");
  assert.ok(apiBlockStart > -1, 'the API-only gate exists');
  const mappingSection = src.indexOf('Mapping de la réponse', apiBlockStart);
  assert.ok(
    mappingSection > apiBlockStart,
    'the Mapping section is inside the API-only block',
  );
  const apiBlockEnd = src.indexOf('{editingSource && (', mappingSection);
  assert.ok(
    apiBlockEnd > mappingSection,
    'the Mapping section closes before the API-only block ends',
  );

  // The mapping is written under `configuration.api` only, and only when set.
  const saveStart = src.indexOf('const saveSource = async ()');
  const saveEnd = src.indexOf('const toggleSourceStatus', saveStart);
  assert.ok(saveStart > -1 && saveEnd > saveStart, 'saveSource is isolated');
  const save = src.slice(saveStart, saveEnd);
  assert.ok(save.includes('configuration.api = apiConfiguration'), 'saved under configuration.api');
  assert.ok(
    save.includes('if (mapping) apiConfiguration.mapping = mapping'),
    'only attached when a mapping exists',
  );
  assert.ok(!save.includes('configuration.mapping'), 'never written outside configuration.api');
  assert.ok(save.includes('hadApiBlock'), 'CSV/XLSX still skips the configuration rewrite');
});
