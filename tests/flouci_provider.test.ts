import { strict as assert } from 'node:assert';

/**
 * Phase E — Flouci provider layer unit tests (mocks ONLY, no DB, no network).
 * Run: npx tsx tests/flouci_provider.test.ts
 */
process.env.NODE_ENV = 'development';

type Json = Record<string, unknown>;

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = handler(url, init);
    return {
      ok: (body as Json).__httpOk !== false,
      status: ((body as Json).__httpStatus as number) ?? 200,
      statusText: 'statusText',
      json: async () => {
        const c = { ...(body as Json) };
        delete c.__httpOk; delete c.__httpStatus;
        return c;
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function authed(url: string, init?: RequestInit): Json {
  const h = new Headers(init?.headers as HeadersInit | undefined);
  let parsed: unknown = undefined;
  if (typeof init?.body === 'string') { try { parsed = JSON.parse(init.body); } catch { parsed = undefined; } }
  return { url, method: init?.method, auth: h.get('authorization'),
    ctype: h.get('content-type'), body: parsed };
}

async function main() {
  const providerMod = await import('../server/payments/provider');
  const { resolvePaymentProvider, PaymentProviderError } = providerMod;
  const flouciMod = await import('../server/payments/flouci');
  const { createPaymentProvider } = flouciMod;

  let passed = 0; let failed = 0; const failures: string[] = [];
  const OPTS = { successLink: 'https://x.test/s', failLink: 'https://x.test/f' };
  async function test(name: string, fn: () => void | Promise<void>) {
    try { await fn(); passed++; console.log('  PASS ' + name); }
    catch (e: unknown) { failed++; const m = '  FAIL ' + name + '\n       ' + (e instanceof Error ? e.message : String(e));
      failures.push(m); console.log(m); }
  }
  await test('fail closed: empty keys throw MISSING_CREDENTIALS', () => {
    assert.throws(() => createPaymentProvider({ publicKey: '', secretKey: '' }),
      (e: unknown) => (e as { code?: string }).code === 'MISSING_CREDENTIALS');
    assert.throws(() => createPaymentProvider({ publicKey: 'p', secretKey: '   ' }),
      (e: unknown) => (e as { code?: string }).code === 'MISSING_CREDENTIALS');
  });

  await test('fail closed: invalid baseUrl throws INVALID_BASE_URL', () => {
    assert.throws(() => createPaymentProvider({ publicKey: 'p', secretKey: 's', baseUrl: 'notaurl' }),
      (e: unknown) => (e as { code?: string }).code === 'INVALID_BASE_URL');
  });

  await test('createCheckout: official URL/auth/fields + success mapping', async () => {
    const m = mockFetch(() => ({ result: { success: true,
      payment_id: 'PAY1', link: 'https://checkout.flouci.com/m/PAY1',
      developer_tracking_id: 'T1' }, name: 'developers', code: 0, version: 'v2' }));
    const p = createPaymentProvider({ publicKey: 'PUB', secretKey: 'SEC', fetchImpl: m.fn });
    const r = await p.createCheckout({ amountMillis: 40300, developerTrackingId: 'T1',
      acceptCard: true, sessionTimeoutSecs: 1200, webhookUrl: 'https://x.test/wh',
      successLink: OPTS.successLink, failLink: OPTS.failLink });
    assert.equal(m.calls.length, 1);
    const c = authed(m.calls[0].url, m.calls[0].init);
    assert.equal(c.url, 'https://developers.flouci.com/api/v2/generate_payment');
    assert.equal(c.method, 'POST');
    assert.equal(c.auth, 'Bearer PUB:SEC');
    assert.equal(c.ctype, 'application/json');
    assert.deepEqual(c.body, { amount: '40300', developer_tracking_id: 'T1',
      accept_card: true, session_timeout_secs: 1200, success_link: OPTS.successLink,
      fail_link: OPTS.failLink, webhook: 'https://x.test/wh' });
    assert.equal(r.paymentId, 'PAY1');
    assert.equal(r.checkoutUrl, 'https://checkout.flouci.com/m/PAY1');
    assert.equal(r.developerTrackingId, 'T1');
  });

  await test('createCheckout: rejects bad amount/links before any fetch', async () => {
    let fetched = false;
    const m = mockFetch(() => { fetched = true; return {}; });
    const p = createPaymentProvider({ publicKey: 'P', secretKey: 'S', fetchImpl: m.fn });
    await assert.rejects(() => p.createCheckout({ amountMillis: 0, ...OPTS }),
      (e: unknown) => (e as { code?: string }).code === 'INVALID_AMOUNT');
    await assert.rejects(() => p.createCheckout({ amountMillis: 10.5, ...OPTS }),
      (e: unknown) => (e as { code?: string }).code === 'INVALID_AMOUNT');
    await assert.rejects(() => p.createCheckout({ amountMillis: 1000,
      successLink: 'notaurl', failLink: OPTS.failLink }),
      (e: unknown) => (e as { code?: string }).code === 'INVALID_SUCCESS_LINK');
    await assert.rejects(() => p.createCheckout({ amountMillis: 1000,
      successLink: OPTS.successLink, failLink: '/rel' }),
      (e: unknown) => (e as { code?: string }).code === 'INVALID_FAIL_LINK');
    assert.equal(fetched, false);
  });

  await test('createCheckout: HTTP error maps message+code', async () => {
    const m = mockFetch(() => ({ __httpOk: false, __httpStatus: 400,
      result: { status: 400, message: 'Bad Request' } }));
    const p = createPaymentProvider({ publicKey: 'P', secretKey: 'S', fetchImpl: m.fn });
    await assert.rejects(() => p.createCheckout({ amountMillis: 1000, ...OPTS }),
      (e: unknown) => e instanceof PaymentProviderError && e.status === 400 && /Bad Request/.test(e.message));
  });

  await test('verifyPayment: GET official path, full field mapping', async () => {
    const m = mockFetch(() => ({ success: true, result: { type: 'wallet',
      amount: 1250, status: 'SUCCESS', details: { order_number: 'O1' },
      developer_tracking_id: 'T9', settlement_status: 'AVAILABLE' },
      status_code: 200, name: 'developers', code: 0, version: '2.0.0' }));
    const p = createPaymentProvider({ publicKey: 'P', secretKey: 'S', fetchImpl: m.fn });
    const v = await p.verifyPayment('PAYX');
    assert.equal(m.calls.length, 1);
    const c = authed(m.calls[0].url, m.calls[0].init);
    assert.equal(c.url, 'https://developers.flouci.com/api/v2/verify_payment/PAYX');
    assert.equal(c.method, 'GET');
    assert.equal(c.auth, 'Bearer P:S');
    assert.equal(v.success, true);
    assert.equal(v.status, 'SUCCESS');
    assert.equal(v.amountMillis, 1250);
    assert.equal(v.type, 'wallet');
    assert.equal(v.settlementStatus, 'AVAILABLE');
    assert.equal(v.developerTrackingId, 'T9');
    assert.deepEqual(v.details, { order_number: 'O1' });
  });

  await test('verifyPayment: success=false never throws, returns success:false', async () => {
    const m = mockFetch(() => ({ success: false,
      result: { status: 404, message: 'Payment not found' } }));
    const p = createPaymentProvider({ publicKey: 'P', secretKey: 'S', fetchImpl: m.fn });
    const v = await p.verifyPayment('NOPE');
    assert.equal(v.success, false);
    assert.match(v.message || '', /Payment not found/);
  });

  await test('handleWebhook: parse-only, never throws, never fetches', () => {
    const m = mockFetch(() => { throw new Error('must not fetch'); });
    const p = createPaymentProvider({ publicKey: 'P', secretKey: 'S', fetchImpl: m.fn });
    const w = p.handleWebhook({ payment_id: 'PAYW', developer_tracking_id: 'TW', extra: 1 });
    assert.equal(w.paymentId, 'PAYW');
    assert.equal(w.developerTrackingId, 'TW');
    assert.deepEqual((w.raw as Json).extra, 1);
    const empty = p.handleWebhook(null);
    assert.equal(empty.paymentId, undefined);
    assert.equal(empty.raw, null);
  });

  await test('refund: POST official path with payment_id, result mapping', async () => {
    const m = mockFetch(() => ({ result: { refund_id: 'ref_1',
      payment_id: 'PAYR', amount: '10000', status: 'success',
      refunded_at: '2025-01-15T10:30:00Z' }, status: 'success' }));
    const p = createPaymentProvider({ publicKey: 'P', secretKey: 'S', fetchImpl: m.fn });
    const r = await p.refund('PAYR');
    const c = authed(m.calls[0].url, m.calls[0].init);
    assert.equal(c.url, 'https://developers.flouci.com/api/v2/refund_payment');
    assert.deepEqual(c.body, { payment_id: 'PAYR' });
    assert.equal(r.success, true);
    assert.equal(r.refundId, 'ref_1');
    assert.equal(r.amount, '10000');
    assert.equal(r.status, 'success');
    assert.equal(r.refundedAt, '2025-01-15T10:30:00Z');
  });

  await test('refund: status=error throws with provider code', async () => {
    const m = mockFetch(() => ({ status: 'error',
      message: 'Payment cannot be refunded', code: 'REFUND_NOT_ALLOWED' }));
    const p = createPaymentProvider({ publicKey: 'P', secretKey: 'S', fetchImpl: m.fn });
    await assert.rejects(() => p.refund('PAYR'),
      (e: unknown) => (e as { code?: string }).code === 'REFUND_NOT_ALLOWED'
        && /cannot be refunded/.test((e as Error).message));
  });

  await test('resolver: flouci resolves, unknown id throws', async () => {
    const m = mockFetch(() => ({}));
    const p = await resolvePaymentProvider('flouci',
      { publicKey: 'P', secretKey: 'S', fetchImpl: m.fn });
    assert.equal(p.id, 'flouci');
    await assert.rejects(() => resolvePaymentProvider('stripe', {}),
      (e: unknown) => e instanceof PaymentProviderError && /Unsupported payment provider/.test((e as Error).message));
  });

  await test('network failure maps to NETWORK_ERROR without secret leak', async () => {
    const boom = (async () => { throw new Error('socket hangup'); }) as unknown as typeof fetch;
    const p = createPaymentProvider({ publicKey: 'P', secretKey: 'S', fetchImpl: boom });
    await assert.rejects(() => p.createCheckout({ amountMillis: 1000, ...OPTS }),
      (e: unknown) => (e as { code?: string }).code === 'NETWORK_ERROR'
        && /socket hangup/.test((e as Error).message)
        && !/PRIVATE|SECRET/.test((e as Error).message));
  });

  console.log('');
  console.log('RESULTS: passed=' + passed + ' failed=' + failed);
  if (failures.length > 0) { console.log('FAILED TESTS:'); failures.forEach((f) => console.log(f)); }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e: unknown) => { console.error('flouci provider test crashed:', e); process.exit(1); });
