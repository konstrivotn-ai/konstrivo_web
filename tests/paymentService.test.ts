import { strict as assert } from 'node:assert';

/**
 * Phase E — PaymentService unit tests (mocks ONLY: no Flouci, no DB).
 *
 * Verifies the service contract:
 * - uses the PaymentProvider abstraction (a mock provider is injected)
 * - price is server-side; client cannot influence it
 * - pending creation; verify → succeeded/failed
 * - idempotent on repeated provider_payment_id
 * - no downgrade from terminal states
 * - PRO subscription upgrade happens backend-only on success
 *
 * Run: npx tsx tests/paymentService.test.ts
 */
process.env.NODE_ENV = 'development';

type Json = Record<string, unknown>;

// ── Mock payments repository (in-memory, mirrors the DB-layer semantics) ────
function makePaymentsRepo() {
  const map = new Map<string, any>();
  let seq = 0;
  const calls = { create: [] as any[], updateStatus: [] as any[] };
  const TERMINAL = new Set(['succeeded', 'refunded', 'reversed']);
  return {
    map,
    calls,
    async create(input: any) {
      calls.create.push(input);
      const p: any = {
        id: 'pay_' + (++seq),
        companyId: input.companyId,
        provider: input.provider,
        providerPaymentId: input.providerPaymentId ?? '',
        amount: Number(input.amount ?? 0),
        currency: input.currency ?? 'TND',
        status: input.status,
        paymentType: input.paymentType,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
        subscriptionId: input.subscriptionId ?? undefined,
        invoiceNumber: input.invoiceNumber ?? undefined,
        metadata: input.metadata,
        retryCount: 0,
        lastError: input.lastError ?? undefined,
      };
      map.set(p.id, p);
      return p;
    },
    async findById(id: string) {
      return map.get(id);
    },
    async findByProviderPaymentId(provider: string, providerPaymentId: string) {
      for (const p of map.values()) {
        if (p.provider === provider && p.providerPaymentId === providerPaymentId) return p;
      }
      return undefined;
    },
    async findByInvoiceNumber(provider: string, invoiceNumber: string) {
      for (const p of map.values()) {
        if (p.provider === provider && p.invoiceNumber === invoiceNumber) return p;
      }
      return undefined;
    },
    async updateStatus(id: string, status: string, patch: any = {}) {
      calls.updateStatus.push({ id, status, patch });
      const cur = map.get(id);
      if (!cur) throw new Error('Payment not found');
      if (patch.expectedVersion !== undefined && Number(patch.expectedVersion) !== Number(cur.version)) {
        const e: any = new Error('Version conflict');
        e.statusCode = 409;
        throw e;
      }
      // DB-layer backstop: terminal states are immutable (no downgrade).
      if (TERMINAL.has(cur.status)) return cur;
      const updated: any = {
        ...cur,
        status,
        lastError: patch.lastError ?? cur.lastError,
        subscriptionId:
          patch.subscriptionId !== undefined ? patch.subscriptionId : cur.subscriptionId,
        providerPaymentId:
          patch.providerPaymentId !== undefined ? patch.providerPaymentId : cur.providerPaymentId,
        invoiceNumber: patch.invoiceNumber !== undefined ? patch.invoiceNumber : cur.invoiceNumber,
        metadata: patch.metadata !== undefined ? patch.metadata : cur.metadata,
        updatedAt: new Date().toISOString(),
        version: (cur.version || 1) + 1,
      };
      map.set(id, updated);
      return updated;
    },
  };
}

// ── Mock provider (implements the PaymentProvider abstraction) ──────────────
function makeProvider(opts: { id?: string } = {}) {
  const verifyQueue: any[] = [];
  const calls = {
    createCheckout: [] as any[],
    verify: [] as string[],
    webhook: [] as unknown[],
    refund: [] as string[],
  };
  const provider = {
    id: opts.id ?? 'flouci',
    async createCheckout(params: any) {
      calls.createCheckout.push(params);
      return {
        paymentId: 'PROV_' + calls.createCheckout.length,
        checkoutUrl: 'https://checkout.test/session/' + calls.createCheckout.length,
        developerTrackingId: params.developerTrackingId,
        raw: {},
      };
    },
    async verifyPayment(paymentId: string) {
      calls.verify.push(paymentId);
      const next = verifyQueue.shift();
      if (!next) throw new Error('test bug: no queued verify response for ' + paymentId);
      if (next instanceof Error) throw next;
      return next;
    },
    handleWebhook(payload: unknown) {
      calls.webhook.push(payload);
      const o = (payload && typeof payload === 'object' ? payload : {}) as Json;
      const paymentId = typeof o.payment_id === 'string' ? o.payment_id : undefined;
      return { paymentId, raw: payload };
    },
    async refund(paymentId: string) {
      calls.refund.push(paymentId);
      return { success: true, raw: {} };
    },
  };
  return { provider, calls, verifyQueue };
}

// ── Mock subscriptions repository ───────────────────────────────────────────
function makeSubsRepo() {
  const byCompany = new Map<string, any>();
  const calls = { create: [] as any[], update: [] as any[] };
  let seq = 0;
  return {
    byCompany,
    calls,
    async findSubscriptionByCompanyId(companyId: string) {
      return byCompany.get(companyId);
    },
    async createSubscription(companyId: string, tier: string) {
      calls.create.push({ companyId, tier });
      const s: any = {
        id: 'sub_' + (++seq),
        companyId,
        tier,
        status: 'active',
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 365 * 864e5).toISOString(),
        cancelAtPeriodEnd: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      };
      byCompany.set(companyId, s);
      return s;
    },
    async updateSubscription(id: string, patch: any, expectedVersion?: number) {
      calls.update.push({ id, patch, expectedVersion });
      for (const s of byCompany.values()) {
        if (s.id === id) {
          if (expectedVersion !== undefined && Number(expectedVersion) !== Number(s.version)) {
            const e: any = new Error('Version conflict');
            e.statusCode = 409;
            throw e;
          }
          const u: any = {
            ...s,
            ...patch,
            updatedAt: new Date().toISOString(),
            version: s.version + 1,
          };
          byCompany.set(s.companyId, u);
          return u;
        }
      }
      throw new Error('Subscription not found');
    },
  };
}

async function main() {
  const svcMod = await import('../server/services/paymentService');
  const {
    createPaymentService,
    PaymentServiceError,
    resolveNextStatus,
    PRO_SUBSCRIPTION_PRICE_MILLIS,
  } = svcMod;

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  async function test(name: string, fn: () => void | Promise<void>) {
    try { await fn(); passed++; console.log('  PASS ' + name); }
    catch (e: unknown) {
      failed++;
      const m = '  FAIL ' + name + '\n       ' + (e instanceof Error ? e.message : String(e));
      failures.push(m);
      console.log(m);
    }
  }

  const LINKS = { successLink: 'https://app.test/pay/ok', failLink: 'https://app.test/pay/ko' };

  function build(overrides: {
    proPriceMillis?: number;
    currency?: string;
    verifyFirst?: any;
    providerId?: string;
  } = {}) {
    const paymentsRepo = makePaymentsRepo();
    const { provider, calls, verifyQueue } = makeProvider({ id: overrides.providerId });
    const subscriptionsRepo = makeSubsRepo();
    if (overrides.verifyFirst !== undefined) verifyQueue.push(overrides.verifyFirst);
    const service = createPaymentService({
      provider,
      paymentsRepo,
      subscriptionsRepo,
      proPriceMillis: overrides.proPriceMillis,
      currency: overrides.currency,
    });
    return { service, paymentsRepo, subscriptionsRepo, calls, verifyQueue };
  }

  // ── 1. Server-side price ────────────────────────────────────────────────────
  await test('createProCheckout: creates pending payment with SERVER-side price', async () => {
    const { service, paymentsRepo, calls } = build();
    const out = await service.createProCheckout({ companyId: 'c1', ...LINKS });
    assert.equal(out.payment.status, 'pending');
    assert.equal(out.payment.paymentType, 'subscription');
    assert.equal(out.payment.amount, PRO_SUBSCRIPTION_PRICE_MILLIS / 1000);
    assert.equal(out.payment.provider, 'flouci');
    // provider abstraction received exactly the server-side price
    assert.equal(calls.createCheckout.length, 1);
    assert.equal(calls.createCheckout[0].amountMillis, PRO_SUBSCRIPTION_PRICE_MILLIS);
    assert.equal(calls.createCheckout[0].developerTrackingId, out.payment.id);
    // provider payment id recorded on the row
    assert.equal(out.payment.providerPaymentId, 'PROV_1');
    assert.equal(out.payment.version, 2);
    assert.equal(paymentsRepo.calls.create.length, 1);
  });

  await test('createProCheckout: client-sent amount field cannot influence the charge', async () => {
    const { service } = build();
    const hostile: any = { companyId: 'c1', ...LINKS, amount: 0.01, amountMillis: 1, price: 1 };
    const out = await service.createProCheckout(hostile);
    assert.equal(out.payment.amount, PRO_SUBSCRIPTION_PRICE_MILLIS / 1000);
  });

  await test('createProCheckout: custom server-side price override is respected', async () => {
    const { service } = build({ proPriceMillis: 50_000 });
    const out = await service.createProCheckout({ companyId: 'c1', ...LINKS });
    assert.equal(out.payment.amount, 50);
  });

  await test('createProCheckout: idempotent replay for repeated referenceId (no 2nd checkout)', async () => {
    const { service, calls } = build();
    const first = await service.createProCheckout({ companyId: 'c1', ...LINKS, referenceId: 'REF-1' });
    const second = await service.createProCheckout({ companyId: 'c1', ...LINKS, referenceId: 'REF-1' });
    assert.equal(second.idempotentReplay, true);
    assert.equal(second.payment.id, first.payment.id);
    assert.equal(second.checkoutUrl, first.checkoutUrl);
    assert.equal(calls.createCheckout.length, 1, 'provider must be called only once');
  });

  await test('createProCheckout: missing company/links throw with stable codes', async () => {
    const { service } = build();
    await assert.rejects(() => service.createProCheckout({ ...LINKS } as any),
      (e: any) => e instanceof PaymentServiceError && e.code === 'COMPANY_REQUIRED');
    await assert.rejects(() => service.createProCheckout({ companyId: 'c1' } as any),
      (e: any) => e instanceof PaymentServiceError && e.code === 'LINKS_REQUIRED');
  });

  // ── 2. verify → succeeded/failed ───────────────────────────────────────────
  await test('verifyAndSettle: pending→succeeded upgrades subscription to PRO (backend only)', async () => {
    const { service, subscriptionsRepo } = build({
      verifyFirst: { success: true, status: 'SUCCESS', amountMillis: PRO_SUBSCRIPTION_PRICE_MILLIS },
    });
    const checkout = await service.createProCheckout({ companyId: 'c1', ...LINKS, referenceId: 'R1' });
    const settled = await service.verifyAndSettle({ providerPaymentId: checkout.providerPaymentId });
    assert.equal(settled.upgradedToPro, true);
    assert.equal(settled.payment.status, 'succeeded');
    assert.ok(settled.payment.subscriptionId, 'payment linked to subscription');
    const sub = subscriptionsRepo.byCompany.get('c1');
    assert.ok(sub, 'subscription exists');
    assert.equal(sub.tier, 'PRO');
    assert.equal(sub.status, 'active');
    assert.equal(sub.provider, 'flouci');
    assert.equal(sub.providerSubscriptionId, checkout.providerPaymentId);
    assert.equal(sub.amount, PRO_SUBSCRIPTION_PRICE_MILLIS / 1000);
    assert.equal(sub.renewalType, 'manual');
  });

  await test('verifyAndSettle: pending→failed with lastError, NO subscription side effect', async () => {
    const { service, subscriptionsRepo } = build({
      verifyFirst: { success: true, status: 'FAILURE' },
    });
    const checkout = await service.createProCheckout({ companyId: 'c1', ...LINKS });
    const settled = await service.verifyAndSettle({ providerPaymentId: checkout.providerPaymentId });
    assert.equal(settled.payment.status, 'failed');
    assert.ok(settled.payment.lastError && settled.payment.lastError.length > 0);
    assert.equal(settled.subscription, undefined);
    assert.equal(subscriptionsRepo.calls.create.length, 0, 'no PRO upgrade on failure');
    assert.equal(subscriptionsRepo.calls.update.length, 0, 'no PRO upgrade on failure');
  });

  await test('verifyAndSettle: provider PENDING keeps payment pending (replay)', async () => {
    const { service, subscriptionsRepo } = build({
      verifyFirst: { success: true, status: 'PENDING' },
    });
    const checkout = await service.createProCheckout({ companyId: 'c1', ...LINKS });
    const settled = await service.verifyAndSettle({ providerPaymentId: checkout.providerPaymentId });
    assert.equal(settled.payment.status, 'pending');
    assert.equal(settled.replay, true);
    assert.equal(subscriptionsRepo.calls.create.length, 0);
  });

  await test('verifyAndSettle: unknown providerPaymentId → PAYMENT_NOT_FOUND', async () => {
    const { service } = build();
    await assert.rejects(() => service.verifyAndSettle({ providerPaymentId: 'NOPE' }),
      (e: any) => e instanceof PaymentServiceError && e.code === 'PAYMENT_NOT_FOUND'
        && e.statusCode === 404);
  });

  await test('verifyAndSettle: provider/network error propagates; payment stays pending', async () => {
    const { service, paymentsRepo, subscriptionsRepo } = build({
      verifyFirst: new Error('socket hang up'),
    });
    const checkout = await service.createProCheckout({ companyId: 'c1', ...LINKS });
    await assert.rejects(() => service.verifyAndSettle({ providerPaymentId: checkout.providerPaymentId }),
      (e: any) => /socket hang up/.test(e.message));
    const stillPending = await paymentsRepo.findById(checkout.payment.id);
    assert.equal(stillPending?.status, 'pending');
    assert.equal(subscriptionsRepo.calls.create.length, 0);
  });

  // ── 3. Idempotency + no-downgrade ──────────────────────────────────────────
  await test('idempotent: repeated provider_payment_id upgrades subscription EXACTLY once', async () => {
    const { service, subscriptionsRepo } = build({
      verifyFirst: { success: true, status: 'SUCCESS' },
    });
    const checkout = await service.createProCheckout({ companyId: 'c1', ...LINKS });
    const first = await service.verifyAndSettle({ providerPaymentId: checkout.providerPaymentId });
    assert.equal(first.upgradedToPro, true);
    const second = await service.verifyAndSettle({ providerPaymentId: checkout.providerPaymentId });
    assert.equal(second.replay, true);
    assert.equal(second.upgradedToPro, false);
    assert.equal(subscriptionsRepo.calls.create.length, 1, 'exactly one create');
    assert.equal(subscriptionsRepo.calls.update.length, 1, 'exactly one update');
    const sub = subscriptionsRepo.byCompany.get('c1');
    assert.equal(sub.tier, 'PRO');
    assert.equal(sub.version, 2, 'subscription version incremented exactly once');
  });

  await test('no-downgrade: succeeded payment can NEVER flip back to failed/pending', async () => {
    const { service, paymentsRepo } = build({
      verifyFirst: { success: true, status: 'SUCCESS' },
    });
    const checkout = await service.createProCheckout({ companyId: 'c1', ...LINKS });
    await service.verifyAndSettle({ providerPaymentId: checkout.providerPaymentId });
    const before = await paymentsRepo.findById(checkout.payment.id);
    assert.equal(before?.status, 'succeeded');
    const replay = await service.verifyAndSettle({ providerPaymentId: checkout.providerPaymentId });
    assert.equal(replay.payment.status, 'succeeded');
    assert.equal(replay.replay, true);
    const after = await paymentsRepo.findById(checkout.payment.id);
    assert.equal(after?.status, 'succeeded', 'terminal state preserved');
    assert.equal(after?.version, before?.version, 'no write happened');
  });

  await test('upgrade allowed: failed→succeeded is an upgrade, never a downgrade', async () => {
    const paymentsRepo = makePaymentsRepo();
    const { provider, verifyQueue } = makeProvider();
    const subscriptionsRepo = makeSubsRepo();
    const service = createPaymentService({ provider, paymentsRepo, subscriptionsRepo });
    const checkout = await service.createProCheckout({ companyId: 'c1', ...LINKS });
    verifyQueue.push({ success: true, status: 'FAILURE' });
    const failed = await service.verifyAndSettle({ providerPaymentId: checkout.providerPaymentId });
    assert.equal(failed.payment.status, 'failed');
    verifyQueue.push({ success: true, status: 'SUCCESS' });
    const settled = await service.verifyAndSettle({ providerPaymentId: checkout.providerPaymentId });
    assert.equal(settled.payment.status, 'succeeded');
    assert.equal(settled.upgradedToPro, true);
    assert.equal(subscriptionsRepo.byCompany.get('c1')?.tier, 'PRO');
  });

  await test('resolveNextStatus: pure state-machine table', () => {
    const V = (success: boolean, status?: string) => ({ success, status, raw: {} } as any);
    // terminal immutability
    assert.deepEqual(resolveNextStatus('succeeded', V(false, 'FAILURE')), { status: 'succeeded', changed: false });
    assert.deepEqual(resolveNextStatus('refunded', V(true, 'SUCCESS')), { status: 'refunded', changed: false });
    assert.deepEqual(resolveNextStatus('reversed', V(true, 'SUCCESS')), { status: 'reversed', changed: false });
    // pending transitions
    assert.deepEqual(resolveNextStatus('pending', V(true, 'SUCCESS')), { status: 'succeeded', changed: true });
    assert.deepEqual(resolveNextStatus('pending', V(true, 'PREAUTH_SUCCESS')), { status: 'succeeded', changed: true });
    assert.deepEqual(resolveNextStatus('pending', V(true, 'FAILURE')), { status: 'failed', changed: true });
    assert.deepEqual(resolveNextStatus('pending', V(true, 'EXPIRED')), { status: 'failed', changed: true });
    assert.deepEqual(resolveNextStatus('pending', V(true, 'PENDING')), { status: 'pending', changed: false });
    assert.deepEqual(resolveNextStatus('pending', V(false)), { status: 'failed', changed: true });
    // failed: upgrade allowed, regress blocked
    assert.deepEqual(resolveNextStatus('failed', V(true, 'SUCCESS')), { status: 'succeeded', changed: true });
    assert.deepEqual(resolveNextStatus('failed', V(true, 'PENDING')), { status: 'failed', changed: false });
    assert.deepEqual(resolveNextStatus('failed', V(false)), { status: 'failed', changed: false });
  });

  // ── 4. Webhook signal (parse + settle via verify) ──────────────────────────
  await test('processWebhookSignal: extracts payment_id and settles via verify', async () => {
    const { service, calls, subscriptionsRepo } = build({
      verifyFirst: { success: true, status: 'SUCCESS' },
    });
    const checkout = await service.createProCheckout({ companyId: 'c1', ...LINKS });
    const res = await service.processWebhookSignal({ payment_id: checkout.providerPaymentId });
    assert.equal(res.handled, true);
    if (res.handled) {
      assert.equal(res.outcome.payment.status, 'succeeded');
      assert.equal(res.outcome.upgradedToPro, true);
    }
    assert.equal(calls.verify.length, 1, 'authoritative verify was called');
    assert.equal(subscriptionsRepo.byCompany.get('c1')?.tier, 'PRO');
  });

  await test('processWebhookSignal: malformed payload → handled:false, no verify', async () => {
    const { service, calls } = build();
    const res = await service.processWebhookSignal({ hello: 'world' });
    assert.equal(res.handled, false);
    if (!res.handled) assert.equal(res.reason, 'NO_PAYMENT_ID');
    assert.equal(calls.verify.length, 0, 'never verifies without a payment id');
  });

  await test('service construction: invalid price fails fast', () => {
    const paymentsRepo = makePaymentsRepo();
    const { provider } = makeProvider();
    const subscriptionsRepo = makeSubsRepo();
    assert.throws(
      () => createPaymentService({ provider, paymentsRepo, subscriptionsRepo, proPriceMillis: 0 }),
      (e: any) => e instanceof PaymentServiceError && e.code === 'INVALID_PRICE');
    assert.throws(
      () => createPaymentService({ provider, paymentsRepo, subscriptionsRepo, proPriceMillis: 10.5 }),
      (e: any) => e instanceof PaymentServiceError && e.code === 'INVALID_PRICE');
  });

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log(' RESULTS: ✅ ' + passed + ' passed | ❌ ' + failed + ' failed');
  console.log('═══════════════════════════════════════════');
  if (failures.length > 0) {
    console.log('FAILED TESTS:');
    failures.forEach((f) => console.log(f));
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error('[KONSTRIVO-TEST] payment service test crashed:', e);
  process.exit(1);
});