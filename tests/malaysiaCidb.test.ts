import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { buildMalaysiaCidbPendingPlan, createMalaysiaCidbConnector, fetchMalaysiaCidbCandidates, getMalaysiaCidbSpec } from '../server/priceSources/malaysiaCidb';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve().then(async () => {
    try {
      await fn();
      passed++;
      console.log(`  PASS ${name}`);
    } catch (err: any) {
      failed++;
      const msg = `  FAIL ${name}\n       ${err?.message || err}`;
      failures.push(msg);
      console.log(msg);
    }
  });
}

async function startMockCidbServer(handler: (req: any, res: any) => void) {
  const server = createServer((req, res) => {
    handler(req, res);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as any;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())),
  };
}

function setCidbAuthEnv(email?: string, password?: string, token?: string) {
  const previous = {
    CIDB_API_EMAIL: process.env.CIDB_API_EMAIL,
    CIDB_API_PASSWORD: process.env.CIDB_API_PASSWORD,
    CIDB_API_TOKEN: process.env.CIDB_API_TOKEN,
  };

  if (typeof email === 'undefined') delete process.env.CIDB_API_EMAIL;
  else process.env.CIDB_API_EMAIL = email;

  if (typeof password === 'undefined') delete process.env.CIDB_API_PASSWORD;
  else process.env.CIDB_API_PASSWORD = password;

  if (typeof token === 'undefined') delete process.env.CIDB_API_TOKEN;
  else process.env.CIDB_API_TOKEN = token;

  return () => {
    if (previous.CIDB_API_EMAIL === undefined) delete process.env.CIDB_API_EMAIL;
    else process.env.CIDB_API_EMAIL = previous.CIDB_API_EMAIL;

    if (previous.CIDB_API_PASSWORD === undefined) delete process.env.CIDB_API_PASSWORD;
    else process.env.CIDB_API_PASSWORD = previous.CIDB_API_PASSWORD;

    if (previous.CIDB_API_TOKEN === undefined) delete process.env.CIDB_API_TOKEN;
    else process.env.CIDB_API_TOKEN = previous.CIDB_API_TOKEN;
  };
}

async function run() {
  await test('1 — valid CIDB response → candidate', async () => {
    const server = await startMockCidbServer((req, res) => {
      const auth = req.headers.authorization || '';
      if (!auth.startsWith('Bearer valid-token')) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      const body = {
        data: [
          { specificationName: 'Ordinary Portland Cement', unit: 'bag', price: 18.5, effectiveMonth: '2026-09', region: 'Selangor', currency: 'MYR' },
          { specificationName: 'Concrete Block 20x20x40', unit: 'piece', price: 4.25, effectiveMonth: '2026-09', region: 'Selangor', currency: 'MYR' },
        ],
      };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    });

    try {
      const rows = await fetchMalaysiaCidbCandidates({ baseUrl: server.url, token: 'valid-token' });
      assert.equal(rows.length, 2);
      assert.equal(rows[0].market, 'MY');
      assert.equal(rows[0].currency, 'MYR');
      assert.equal(rows[0].sourceCode, 'SOURCE_MY_CIDB');
      assert.equal(rows[0].materialCode, 'sac_ciment_50kg');
    } finally {
      await server.close();
    }
  });

  await test('2 — material mapping correct via materials.code', async () => {
    const server = await startMockCidbServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        data: [
          { specificationName: 'Concrete Block 20x20x40', unit: 'piece', price: 4.25, effectiveMonth: '2026-09', region: 'Johor', currency: 'MYR' },
        ],
      }));
    });

    try {
      const rows = await fetchMalaysiaCidbCandidates({ baseUrl: server.url, token: 'valid-token' });
      assert.equal(rows[0].materialCode, 'bloc_beton_20x20x40');
      assert.equal(rows[0].effectiveFrom, '2026-09-01');
    } finally {
      await server.close();
    }
  });

  await test('3 — MY/MYR isolation', async () => {
    const spec = getMalaysiaCidbSpec();
    assert.equal(spec.market, 'MY');
    assert.equal(spec.currency, 'MYR');
    assert.equal(spec.enabled, true);
    const plan = buildMalaysiaCidbPendingPlan([{ specificationName: 'Ordinary Portland Cement', unit: 'bag', price: 18.5, effectiveMonth: '2026-09', market: 'SG', currency: 'SGD' }]);
    assert.equal(plan.rejected.length, 1);
    assert.equal(plan.submissions.length, 0);
  });

  await test('4 — unknown specification rejected', async () => {
    const plan = buildMalaysiaCidbPendingPlan([{ specificationName: 'Unknown Limestone Panel', unit: 'piece', price: 50, effectiveMonth: '2026-09' }]);
    assert.equal(plan.submissions.length, 0);
    assert.equal(plan.rejected.length, 1);
    assert.match(plan.rejected[0].reason, /unmapped|unknown/i);
  });

  await test('5 — bad/missing token safe error', async () => {
    const server = await startMockCidbServer((req, res) => {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'Unauthorized' }));
    });

    try {
      await assert.rejects(() => fetchMalaysiaCidbCandidates({ baseUrl: server.url, token: '' }), /token|unauthorized|configured/i);
    } finally {
      await server.close();
    }
  });

  await test('6 — timeout/API failure → no candidates', async () => {
    const server = await startMockCidbServer((req, res) => {
      setTimeout(() => {
        res.end(JSON.stringify({ ok: true }));
      }, 200);
    });

    try {
      await assert.rejects(() => fetchMalaysiaCidbCandidates({ baseUrl: server.url, token: 'valid-token', timeoutMs: 50 }), /timed out|timeout|failed/i);
    } finally {
      await server.close();
    }
  });

  await test('7 — malformed price rejected', async () => {
    const plan = buildMalaysiaCidbPendingPlan([{ specificationName: 'Ordinary Portland Cement', unit: 'bag', price: 'NaN', effectiveMonth: '2026-09' }]);
    assert.equal(plan.submissions.length, 0);
    assert.equal(plan.rejected.length, 1);
  });

  await test('8 — candidate goes to Pending only', async () => {
    const plan = buildMalaysiaCidbPendingPlan([{ specificationName: 'Ordinary Portland Cement', unit: 'bag', price: 18.5, effectiveMonth: '2026-09' }]);
    assert.equal(plan.submissions[0].candidate.sourceCode, 'SOURCE_MY_CIDB');
    assert.equal(plan.submissions[0].countryCode, 'MY');
    assert.equal(plan.submissions[0].currencyCode, 'MYR');
    assert.ok(!('approve' in plan.submissions[0].candidate));
  });

  await test('9 — no direct approval', async () => {
    const connector = createMalaysiaCidbConnector({ baseUrl: 'http://example.invalid', token: 'token' });
    assert.equal(typeof (connector as any).approve, 'undefined');
    assert.equal(typeof (connector as any).writeOfficialPrice, 'undefined');
  });

  await test('10 — effective month → effectiveFrom', async () => {
    const plan = buildMalaysiaCidbPendingPlan([{ specificationName: 'Ordinary Portland Cement', unit: 'bag', price: 18.5, effectiveMonth: '2026-09' }]);
    assert.equal(plan.submissions[0].effectiveFrom, '2026-09-01');
  });

  await test('11 — duplicate fetch idempotent pending submission', async () => {
    const rows = [
      { specificationName: 'Ordinary Portland Cement', unit: 'bag', price: 18.5, effectiveMonth: '2026-09' },
      { specificationName: 'Ordinary Portland Cement', unit: 'bag', price: 18.5, effectiveMonth: '2026-09' },
    ];
    const plan = buildMalaysiaCidbPendingPlan(rows);
    assert.equal(plan.submissions.length, 1);
    assert.equal(plan.rejected.length, 0);
  });

  await test('12 — login fallback obtains bearer token and uses it for protected requests', async () => {
    const restore = setCidbAuthEnv('cidb-user@example.com', 'super-secret-password');
    const server = await startMockCidbServer((req, res) => {
      if (req.url === '/login') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const payload = JSON.parse(body || '{}');
          assert.equal(payload.email, 'cidb-user@example.com');
          assert.equal(payload.password, 'super-secret-password');
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ access_token: 'login-bearer-token', token_type: 'Bearer' }));
        });
        return;
      }

      const auth = req.headers.authorization || '';
      if (!auth.startsWith('Bearer login-bearer-token')) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        data: [{ specificationName: 'Ordinary Portland Cement', unit: 'bag', price: 18.5, effectiveMonth: '2026-09', market: 'MY', currency: 'MYR' }],
      }));
    });

    try {
      delete process.env.CIDB_API_TOKEN;
      const rows = await fetchMalaysiaCidbCandidates({ baseUrl: server.url });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].materialCode, 'sac_ciment_50kg');
      assert.equal(rows[0].market, 'MY');
    } finally {
      restore();
      await server.close();
    }
  });

  await test('13 — failed login fails safely without leaking credentials', async () => {
    const email = 'cidb-user@example.com';
    const password = 'super-secret-password';
    const restore = setCidbAuthEnv(email, password);
    const server = await startMockCidbServer((req, res) => {
      if (req.url === '/login') {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'invalid credentials' }));
        return;
      }
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'should not be reached' }));
    });

    try {
      delete process.env.CIDB_API_TOKEN;
      try {
        await assert.rejects(() => fetchMalaysiaCidbCandidates({ baseUrl: server.url }), /login|authentication|configured|token/i);
      } catch (err: any) {
        const text = String(err?.message || err);
        assert.ok(!text.includes(email));
        assert.ok(!text.includes(password));
        assert.ok(!text.includes('Authorization'));
        assert.ok(!text.includes('access_token'));
      }
    } finally {
      restore();
      await server.close();
    }
  });

  console.log(`\nMalaysia CIDB connector: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
}

run();
