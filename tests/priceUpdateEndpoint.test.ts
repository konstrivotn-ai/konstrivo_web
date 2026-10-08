import { strict as assert } from 'node:assert';
import express from 'express';
import http from 'http';
import { signJWT } from '../server/utils/crypto';
import { getPriceSourceSpec } from '../server/priceSources/connector';
import { setupV1Router } from '../server/routes/v1';

let passed = 0, failed = 0;
const failures: string[] = [];
function test(name: string, fn: () => Promise<void> | void): Promise<void> | void {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result
        .then(() => { passed++; console.log('  PASS ' + name); })
        .catch((err: any) => { failed++; const msg = '  FAIL ' + name + '\n       ' + (err?.message || err); failures.push(msg); console.log(msg); });
    }
    passed++; console.log('  PASS ' + name);
  } catch (err: any) {
    failed++; const msg = '  FAIL ' + name + '\n       ' + (err?.message || err); failures.push(msg); console.log(msg);
  }
}

const VALID_SECRET = 'test-secret-123';
const VALID_MACHINE_SECRET = 'machine-secret-456';
process.env.PRICE_UPDATE_CRON_SECRET = VALID_SECRET;
process.env.PRICE_UPDATE_MACHINE_SECRET = VALID_MACHINE_SECRET;
process.env.JWT_SECRET = process.env.JWT_SECRET || '0123456789abcdef0123456789abcdef';
const VALID_AUTH_TOKEN = signJWT({
  uid: 'admin-1',
  role: 'admin',
  tier: 'enterprise',
  entitlements: ['CATALOG_OFFICIAL_MANAGE'],
}, process.env.JWT_SECRET!, 3600);

let server: http.Server | undefined;
let baseUrl = '';

function startServer(app: any): Promise<void> {
  return new Promise((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server?.address();
      if (!addr || typeof addr === 'string') return reject(new Error('test server failed to start'));
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
}

async function httpRequest(method: string, path: string, opts: any = {}): Promise<any> {
  const bodyStr = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  return new Promise((resolve, reject) => {
    const req = http.request(`${baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(bodyStr !== undefined ? { 'content-length': String(Buffer.byteLength(bodyStr)) } : {}),
        ...(opts.headers || {}),
      },
    }, (res: any) => {
      let body = '';
      res.on('data', (chunk: any) => { body += chunk; });
      res.on('end', () => {
        let parsedBody: any = body;
        try { parsedBody = JSON.parse(body); } catch { /* non-JSON */ }
        resolve({ statusCode: res.statusCode, body: parsedBody });
      });
    });
    req.on('error', reject);
    if (bodyStr !== undefined) req.write(bodyStr);
    req.end();
  });
}

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', setupV1Router());
  return app;
}

async function runTests() {
  console.log('\n=== Step 16B: Real Price Update Endpoint Tests ===\n');

  await test('E1 - missing token returns 403', async () => {
    const res = await httpRequest('POST', '/api/v1/catalog/admin/price-update/run', {
      headers: { Authorization: `Bearer ${VALID_AUTH_TOKEN}` },
      body: { sourceCode: 'SOURCE_SA_GASTAT' },
    });
    assert.equal(res.statusCode, 403);
  });

  await test('E2 - wrong token returns 403', async () => {
    const res = await httpRequest('POST', '/api/v1/catalog/admin/price-update/run', {
      headers: {
        Authorization: `Bearer ${VALID_AUTH_TOKEN}`,
        'x-price-update-token': 'wrong',
      },
      body: { sourceCode: 'SOURCE_SA_GASTAT' },
    });
    assert.equal(res.statusCode, 403);
  });

  await test('E3 - unauthorized rejected', async () => {
    const res = await httpRequest('POST', '/api/v1/catalog/admin/price-update/run', {
      headers: { 'x-price-update-token': VALID_SECRET },
      body: { sourceCode: 'SOURCE_SA_GASTAT' },
    });
    assert.equal(res.statusCode, 401);
  });

  await test('E4 - invalid sourceCode returns 400', async () => {
    const res = await httpRequest('POST', '/api/v1/catalog/admin/price-update/run', {
      headers: {
        Authorization: `Bearer ${VALID_AUTH_TOKEN}`,
        'x-price-update-token': VALID_SECRET,
      },
      body: {},
    });
    assert.equal(res.statusCode, 400);
  });

  await test('E5 - unknown sourceCode returns 501', async () => {
    const res = await httpRequest('POST', '/api/v1/catalog/admin/price-update/run', {
      headers: {
        Authorization: `Bearer ${VALID_AUTH_TOKEN}`,
        'x-price-update-token': VALID_SECRET,
      },
      body: { sourceCode: 'SOURCE_UNKNOWN' },
    });
    assert.equal(res.statusCode, 501);
  });

  await test('E6 - valid SOURCE_SA_GASTAT reaches pipeline', async () => {
    const res = await httpRequest('POST', '/api/v1/catalog/admin/price-update/run', {
      headers: {
        Authorization: `Bearer ${VALID_AUTH_TOKEN}`,
        'x-price-update-token': VALID_SECRET,
      },
      body: { sourceCode: 'SOURCE_SA_GASTAT' },
    });
    assert.equal(res.statusCode, 501);
    assert.ok(Array.isArray(res.body.errors));
    assert.ok(String(JSON.stringify(res.body)).toLowerCase().includes('gastat'));
  });

  await test('E7 - SA/SAR in response', async () => {
    const res = await httpRequest('POST', '/api/v1/catalog/admin/price-update/run', {
      headers: {
        Authorization: `Bearer ${VALID_AUTH_TOKEN}`,
        'x-price-update-token': VALID_SECRET,
      },
      body: { sourceCode: 'SOURCE_SA_GASTAT' },
    });
    assert.equal(res.body.market, 'SA');
    assert.equal(res.body.currency, 'SAR');
  });

  await test('E8 - no approve', async () => {
    const res = await httpRequest('POST', '/api/v1/catalog/admin/price-update/run', {
      headers: {
        Authorization: `Bearer ${VALID_AUTH_TOKEN}`,
        'x-price-update-token': VALID_SECRET,
      },
      body: { sourceCode: 'SOURCE_SA_GASTAT' },
    });
    assert.equal(res.body.submitted, 0);
    assert.equal(res.body.rejected, 0);
  });

  await test('E9 - no secret leakage', async () => {
    const res = await httpRequest('POST', '/api/v1/catalog/admin/price-update/run', {
      headers: {
        Authorization: `Bearer ${VALID_AUTH_TOKEN}`,
        'x-price-update-token': VALID_SECRET,
      },
      body: { sourceCode: 'SOURCE_SA_GASTAT' },
    });
    const bodyText = JSON.stringify(res.body);
    assert.ok(!bodyText.includes(VALID_SECRET));
  });

  await test('E10 - valid source spec passes validation', () => {
    const spec = getPriceSourceSpec('SOURCE_SA_GASTAT');
    assert.ok(spec);
    assert.equal(spec.market, 'SA');
    assert.equal(spec.currency, 'SAR');
    assert.equal(spec.enabled, true);
  });

  await test('M1 - valid machine secret accepted', async () => {
    const res = await httpRequest('POST', '/api/v1/machine/price-update', {
      headers: { 'x-price-update-token': VALID_MACHINE_SECRET },
      body: { sourceCode: 'SOURCE_SA_GASTAT' },
    });
    assert.equal(res.statusCode, 501);
    assert.ok(String(JSON.stringify(res.body)).toLowerCase().includes('gastat'));
  });

  await test('M2 - missing machine secret rejected', async () => {
    const res = await httpRequest('POST', '/api/v1/machine/price-update', {
      body: { sourceCode: 'SOURCE_SA_GASTAT' },
    });
    assert.equal(res.statusCode, 403);
  });

  await test('M3 - wrong machine secret rejected', async () => {
    const res = await httpRequest('POST', '/api/v1/machine/price-update', {
      headers: { 'x-price-update-token': 'nope' },
      body: { sourceCode: 'SOURCE_SA_GASTAT' },
    });
    assert.equal(res.statusCode, 403);
  });

  await test('M4 - normal user JWT cannot act as machine secret', async () => {
    const res = await httpRequest('POST', '/api/v1/machine/price-update', {
      headers: {
        Authorization: `Bearer ${VALID_AUTH_TOKEN}`,
        'x-price-update-token': VALID_MACHINE_SECRET,
      },
      body: { sourceCode: 'SOURCE_SA_GASTAT' },
    });
    assert.equal(res.statusCode, 501);
  });

  await test('M5 - machine endpoint rejects unknown source', async () => {
    const res = await httpRequest('POST', '/api/v1/machine/price-update', {
      headers: { 'x-price-update-token': VALID_MACHINE_SECRET },
      body: { sourceCode: 'SOURCE_UNKNOWN' },
    });
    assert.equal(res.statusCode, 501);
  });

  await test('M6 - machine endpoint safe response preserves SA/SAR', async () => {
    const res = await httpRequest('POST', '/api/v1/machine/price-update', {
      headers: { 'x-price-update-token': VALID_MACHINE_SECRET },
      body: { sourceCode: 'SOURCE_SA_GASTAT' },
    });
    assert.equal(res.body.market, 'SA');
    assert.equal(res.body.currency, 'SAR');
  });

  await test('M7 - machine endpoint does not leak secret', async () => {
    const res = await httpRequest('POST', '/api/v1/machine/price-update', {
      headers: { 'x-price-update-token': VALID_MACHINE_SECRET },
      body: { sourceCode: 'SOURCE_SA_GASTAT' },
    });
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes(VALID_MACHINE_SECRET));
  });

  await test('M8 - machine endpoint handles Malaysia CIDB source', async () => {
    const res = await httpRequest('POST', '/api/v1/machine/price-update', {
      headers: { 'x-price-update-token': VALID_MACHINE_SECRET },
      body: { sourceCode: 'SOURCE_MY_CIDB' },
    });
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.market, 'MY');
    assert.equal(res.body.currency, 'MYR');
  });

  console.log('\n=== Results ===');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(f));
    process.exit(1);
  }
}

async function main() {
  const app = createTestApp();
  await startServer(app);
  try {
    await runTests();
  } finally {
    server?.closeIdleConnections?.();
    server?.close();
  }
}

main();


