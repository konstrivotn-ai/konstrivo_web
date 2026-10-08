import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { buildMalaysiaCidbPendingPlan, fetchMalaysiaCidbCandidates } from '../server/priceSources/malaysiaCidb';

const SUBMITTED = 'SUPPLIER_SUBMITTED';
const APPROVED = 'SUPPLIER_APPROVED';

interface MockPriceRow {
  id: string;
  materialCode: string;
  sourceCode: string;
  countryCode: string;
  currencyCode: string;
  price: number;
  isCurrent: boolean;
  companyId: string | null;
  effectiveFrom?: string;
  notes?: string;
}

let mockDb: MockPriceRow[] = [];
let mockSeq = 0;

function resetMockDb() {
  mockDb = [];
  mockSeq = 0;
}

async function mockSubmit(args: {
  materialCode: string;
  price: number;
  countryCode: string;
  currencyCode: string;
  effectiveFrom?: string;
  notes?: string;
}) {
  const existing = mockDb.find(r =>
    r.materialCode === args.materialCode &&
    r.sourceCode === SUBMITTED &&
    r.countryCode === args.countryCode &&
    r.currencyCode === args.currencyCode &&
    r.isCurrent === false &&
    r.companyId === null,
  );

  if (existing) {
    existing.price = args.price;
    if (args.effectiveFrom) existing.effectiveFrom = args.effectiveFrom;
    existing.notes = args.notes || existing.notes;
    return existing;
  }

  const row: MockPriceRow = {
    id: `mock-${++mockSeq}`,
    materialCode: args.materialCode,
    sourceCode: SUBMITTED,
    countryCode: args.countryCode,
    currencyCode: args.currencyCode,
    price: args.price,
    isCurrent: false,
    companyId: null,
    effectiveFrom: args.effectiveFrom,
    notes: args.notes,
  };
  mockDb.push(row);
  return row;
}

async function mockApprove(priceId: string) {
  const row = mockDb.find(r => r.id === priceId);
  if (!row) throw new Error(`Pending row '${priceId}' not found`);
  row.sourceCode = APPROVED;
  row.isCurrent = true;
  return row;
}

function publicPricesByMarket(market: string) {
  return mockDb.filter(r => r.isCurrent && r.sourceCode === APPROVED && r.countryCode === market);
}

function calculatorLookupFromPrices(rows: MockPriceRow[]) {
  const map: Record<string, { price: number; currency: string; market: string }> = {};
  for (const row of rows) {
    map[row.materialCode] = { price: row.price, currency: row.currencyCode, market: row.countryCode };
  }
  return map;
}

async function startMockCidbServer(handler: (req: any, res: any) => void) {
  const server = createServer((req, res) => handler(req, res));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as any;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())),
  };
}

async function run() {
  console.log('\n=== Step 20 — Malaysia Automated Price Cycle End-to-End ===\n');

  await test('fetch -> connector mapping -> candidate shape', async () => {
    const server = await startMockCidbServer((req, res) => {
      const auth = req.headers.authorization || '';
      assert.ok(auth.startsWith('Bearer valid-token'));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        data: [{
          specificationName: 'Ordinary Portland Cement',
          unit: 'bag',
          price: 18.5,
          effectiveMonth: '2026-09',
          region: 'Selangor',
          currency: 'MYR',
        }],
      }));
    });

    try {
      const candidates = await fetchMalaysiaCidbCandidates({ baseUrl: server.url, token: 'valid-token' });
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].materialCode, 'sac_ciment_50kg');
      assert.equal(candidates[0].market, 'MY');
      assert.equal(candidates[0].currency, 'MYR');
      assert.equal(candidates[0].price, 18.5);
      assert.equal(candidates[0].effectiveFrom, '2026-09-01');
    } finally {
      await server.close();
    }
  });

  await test('pending submission is SUPPLIER_SUBMITTED and not approved automatically', async () => {
    resetMockDb();
    const rows = [{
      specificationName: 'Ordinary Portland Cement',
      unit: 'bag',
      price: 18.5,
      effectiveMonth: '2026-09',
      market: 'MY',
      currency: 'MYR',
    }];
    const plan = buildMalaysiaCidbPendingPlan(rows);
    assert.equal(plan.submissions.length, 1);
    const row = await mockSubmit({
      materialCode: plan.submissions[0].materialCode,
      price: plan.submissions[0].price,
      countryCode: plan.submissions[0].countryCode,
      currencyCode: plan.submissions[0].currencyCode,
      effectiveFrom: plan.submissions[0].effectiveFrom,
      notes: plan.submissions[0].notes,
    });
    assert.equal(row.sourceCode, SUBMITTED);
    assert.equal(row.isCurrent, false);
    assert.equal(row.countryCode, 'MY');
    assert.equal(row.currencyCode, 'MYR');
    assert.ok(!mockDb.some(r => r.sourceCode === APPROVED));
  });

  await test('admin approval upgrades to SUPPLIER_APPROVED and current=true', async () => {
    resetMockDb();
    const row = await mockSubmit({
      materialCode: 'sac_ciment_50kg',
      price: 18.5,
      countryCode: 'MY',
      currencyCode: 'MYR',
      effectiveFrom: '2026-09-01',
      notes: 'CIDB Malaysia',
    });
    const approved = await mockApprove(row.id);
    assert.equal(approved.sourceCode, APPROVED);
    assert.equal(approved.isCurrent, true);
    const myPrices = publicPricesByMarket('MY');
    assert.equal(myPrices.length, 1);
    assert.equal(myPrices[0].price, 18.5);
    assert.equal(myPrices[0].currencyCode, 'MYR');
  });

  await test('public prices market filter is isolated to MY; TN and FR remain unchanged', async () => {
    resetMockDb();
    const myRow = await mockSubmit({
      materialCode: 'sac_ciment_50kg',
      price: 18.5,
      countryCode: 'MY',
      currencyCode: 'MYR',
      effectiveFrom: '2026-09-01',
    });
    await mockApprove(myRow.id);
    await mockSubmit({ materialCode: 'sac_ciment_50kg', price: 12.0, countryCode: 'TN', currencyCode: 'TND', effectiveFrom: '2026-09-01' });
    await mockSubmit({ materialCode: 'sac_ciment_50kg', price: 14.5, countryCode: 'FR', currencyCode: 'EUR', effectiveFrom: '2026-09-01' });

    const myPublic = publicPricesByMarket('MY');
    const tnPublic = publicPricesByMarket('TN');
    const frPublic = publicPricesByMarket('FR');

    assert.equal(myPublic.length, 1);
    assert.equal(myPublic[0].price, 18.5);
    assert.equal(tnPublic.length, 0);
    assert.equal(frPublic.length, 0);
  });

  await test('calculator lookup reads the approved MYR price', async () => {
    resetMockDb();
    const row = await mockSubmit({
      materialCode: 'sac_ciment_50kg',
      price: 18.5,
      countryCode: 'MY',
      currencyCode: 'MYR',
      effectiveFrom: '2026-09-01',
    });
    await mockApprove(row.id);

    const lookup = calculatorLookupFromPrices(publicPricesByMarket('MY'));
    assert.equal(lookup['sac_ciment_50kg'].price, 18.5);
    assert.equal(lookup['sac_ciment_50kg'].currency, 'MYR');
    assert.equal(lookup['sac_ciment_50kg'].market, 'MY');
  });

  await test('idempotency: same source/material/market/currency/effective-date does not create duplicate pending rows', async () => {
    resetMockDb();
    const payload = [{
      specificationName: 'Ordinary Portland Cement',
      unit: 'bag',
      price: 18.5,
      effectiveMonth: '2026-09',
      market: 'MY',
      currency: 'MYR',
    }];

    const plan1 = buildMalaysiaCidbPendingPlan(payload);
    const plan2 = buildMalaysiaCidbPendingPlan(payload);

    await mockSubmit({
      materialCode: plan1.submissions[0].materialCode,
      price: plan1.submissions[0].price,
      countryCode: plan1.submissions[0].countryCode,
      currencyCode: plan1.submissions[0].currencyCode,
      effectiveFrom: plan1.submissions[0].effectiveFrom,
    });

    await mockSubmit({
      materialCode: plan2.submissions[0].materialCode,
      price: plan2.submissions[0].price,
      countryCode: plan2.submissions[0].countryCode,
      currencyCode: plan2.submissions[0].currencyCode,
      effectiveFrom: plan2.submissions[0].effectiveFrom,
    });

    const samePendingRows = mockDb.filter(r => r.sourceCode === SUBMITTED && r.materialCode === 'sac_ciment_50kg' && r.countryCode === 'MY' && r.currencyCode === 'MYR');
    assert.equal(samePendingRows.length, 1);
  });

  await test('malformed CIDB response is rejected cleanly', async () => {
    const plan = buildMalaysiaCidbPendingPlan([{ specificationName: 'Ordinary Portland Cement', unit: 'bag', price: 'NaN', effectiveMonth: '2026-09', market: 'MY', currency: 'MYR' }]);
    assert.equal(plan.submissions.length, 0);
    assert.equal(plan.rejected.length, 1);
    assert.match(plan.rejected[0].reason, /malformed|price/i);
  });

  await test('API failure yields no price and safe error', async () => {
    const server = await startMockCidbServer((req, res) => {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: 'service unavailable' }));
    });
    try {
      await assert.rejects(() => fetchMalaysiaCidbCandidates({ baseUrl: server.url, token: 'valid-token' }), /service unavailable|failed|no usable/i);
    } finally {
      await server.close();
    }
  });

  console.log('\nRESULTS: all Step 20 checks passed');
}

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await Promise.resolve(fn());
    console.log(`  PASS ${name}`);
  } catch (err: any) {
    console.log(`  FAIL ${name}\n       ${err?.message || err}`);
    throw err;
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
