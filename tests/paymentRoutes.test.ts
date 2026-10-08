/**
 * Phase E — Payment Routes + Flouci Webhook (mocks ONLY).
 *
 * Boots the actual express routers with a MOCK PaymentService — no network,
 * no Flouci, no DB. Verifies the security contract AT THE BOUNDARY:
 * - companyId comes ONLY from the authenticated JWT, never from req.body.
 * - amount/price/tier are never forwarded to the service.
 * - the webhook goes through PaymentService.processWebhookSignal (i.e. the
 *   provider verify happens BEFORE any PRO activation) and the route itself
 *   never activates PRO / never touches subscriptions.
 * - idempotency + no-downgrade live in PaymentService (asserted here by strict
 *   delegation, not re-implemented).
 *
 * Run: npx tsx tests/paymentRoutes.test.ts
 */
process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = 'test-jwt-secret-for-payment-routes';

import { strict as assert } from 'node:assert';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

type Json = Record<string, unknown>;
type MockCall = { kind: 'checkout' | 'webhook'; input?: Json; payload?: unknown; at: number };

function makeMockService(): { service: unknown; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const service = {
    createProCheckout: async (input: Json) => {
      calls.push({ kind: 'checkout', input, at: calls.length });
      return {
        payment: { id: 'pay_pending_1', status: 'pending' },
        checkoutUrl: 'https://checkout.flouci.test/m/PRO-1',
        providerPaymentId: 'pp_pro_1',
        idempotentReplay: false,
      };
    },
    verifyAndSettle: async () => {
      throw new Error('route must NOT call verifyAndSettle directly');
    },
    processWebhookSignal: async (payload: unknown) => {
      calls.push({ kind: 'webhook', payload, at: calls.length });
      const o = (payload ?? {}) as Json;
      const pid = (o.payment_id ?? o.paymentId ?? o.id) as string | undefined;
      if (!pid) return { handled: false, reason: 'NO_PAYMENT_ID' };
      return { handled: true, outcome: { payment: { id: 'pay_pending_1', status: 'succeeded' } } };
    },
  };
  return { service, calls };
}

function makeFailingWebhookService(err: unknown): { service: unknown; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const service = {
    createProCheckout: async () => { throw new Error('checkout must not be called'); },
    processWebhookSignal: async (payload: unknown) => {
      calls.push({ kind: 'webhook', payload, at: calls.length });
      throw err;
    },
  };
  return { service, calls };
}

async function boot(service: unknown): Promise<{ base: string; close: () => Promise<void> }> {
  const express = (await import('express')).default;
  const { createPaymentsRouter } = await import('../server/routes/v1/payments');
  const { createWebhooksRouter } = await import('../server/routes/v1/webhooks');

  const app = express();
  app.use(express.json());
  app.use('/api/v1/payments', createPaymentsRouter(service as never));
  app.use('/api/v1/webhooks', createWebhooksRouter(service as never));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const close = () => new Promise<void>((r) => server.close(() => r()));
  return { base: `http://127.0.0.1:${port}`, close };
}
async function main() {
  const { signJWT } = await import('../server/utils/crypto');
  const { PaymentServiceError } = await import('../server/services/paymentService');

  const jwt = (uid: string, companyId: string): string => {
    const claims = {
      uid,
      companyId,
      role: 'owner' as const,
      tier: 'free' as const,
      entitlements: [] as string[],
    };
    return signJWT(claims as never, process.env.JWT_SECRET as string, 3600);
  };

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      passed++;
      console.log(`  PASS ${name}`);
    } catch (e: any) {
      failed++;
      failures.push(`  FAIL ${name}\n       ${e?.message || e}`);
      console.log(failures[failures.length - 1]);
    }
  }

  const post = (base: string, path: string, body: Json, token?: string) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  // ── checkout ─────────────────────────────────────────────────────────
  await test('checkout: unauthenticated → 401', async () => {
    const { service } = makeMockService();
    const { base, close } = await boot(service);
    try {
      const res = await post(base, '/api/v1/payments/checkout', {});
      assert.equal(res.status, 401);
    } finally {
      await close();
    }
  });

  await test('checkout: authenticated without companyId → 400 COMPANY_REQUIRED', async () => {
    const { service } = makeMockService();
    const { base, close } = await boot(service);
    try {
      const tok = jwt('u1', '');
      const res = await post(base, '/api/v1/payments/checkout', { companyId: 'c_evil' }, tok);
      assert.equal(res.status, 400);
      const json = (await res.json()) as Json;
      assert.equal(json.error, 'COMPANY_REQUIRED');
    } finally {
      await close();
    }
  });

  await test('checkout: companyId from JWT ONLY — body.companyId/amount/tier ignored', async () => {
    const { service, calls } = makeMockService();
    const { base, close } = await boot(service);
    try {
      const tok = jwt('u1', 'c_auth');
      const res = await post(
        base,
        '/api/v1/payments/checkout',
        { companyId: 'c_evil', amount: 1, price: 999, tier: 'PRO', successLink: 'https://app.test/s', failLink: 'https://app.test/f' },
        tok,
      );
      assert.equal(res.status, 201);
      const json = (await res.json()) as Json;
      assert.equal(json.paymentId, 'pp_pro_1');
      assert.equal(json.checkoutUrl, 'https://checkout.flouci.test/m/PRO-1');

      assert.equal(calls.length, 1);
      assert.equal(calls[0].kind, 'checkout');
      const input = calls[0].input as Json;
      assert.equal(input.companyId, 'c_auth');
      assert.equal(input.amount, undefined);
      assert.equal(input.price, undefined);
      assert.equal(input.tier, undefined);
    } finally {
      await close();
    }
  });

  // ── webhook ──────────────────────────────────────────────────────────
  await test('webhook: payload without payment id → 400', async () => {
    const { service, calls } = makeMockService();
    const { base, close } = await boot(service);
    try {
      const res = await post(base, '/api/v1/webhooks/flouci', { event: 'unknown' });
      assert.equal(res.status, 400);
      const json = (await res.json()) as Json;
      assert.equal(json.received, false);
      assert.equal(json.reason, 'NO_PAYMENT_ID');
      assert.equal(calls.length, 1);
    } finally {
      await close();
    }
  });

  await test('webhook: handled via processWebhookSignal only — no direct activation', async () => {
    const { service, calls } = makeMockService();
    const { base, close } = await boot(service);
    try {
      const res = await post(base, '/api/v1/webhooks/flouci', { payment_id: 'pp_pro_1', developer_tracking_id: 't1' });
      assert.equal(res.status, 200);
      const json = (await res.json()) as Json;
      assert.deepEqual(json, { received: true, paymentId: 'pay_pending_1', status: 'succeeded' });
      // Exactly one external touch, and it is the service (verify-before-activate).
      assert.equal(calls.length, 1);
      assert.equal(calls[0].kind, 'webhook');
      assert.deepEqual(calls[0].payload, { payment_id: 'pp_pro_1', developer_tracking_id: 't1' });
    } finally {
      await close();
    }
  });

  await test('webhook: verification failure → 502, retryable, PRO never activated', async () => {
    const err = new PaymentServiceError('VERIFY_NETWORK', 'flouci unreachable');
    const { service, calls } = makeFailingWebhookService(err);
    const { base, close } = await boot(service);
    try {
      const res = await post(base, '/api/v1/webhooks/flouci', { payment_id: 'pp_pro_1' });
      assert.equal(res.status, 502);
      const json = (await res.json()) as Json;
      assert.equal(json.received, false);
      assert.equal(json.error, 'VERIFY_NETWORK');
      assert.equal(calls.length, 1);
    } finally {
      await close();
    }
  });

  await test('webhook: repeated delivery → service called twice, same id (idempotency preserved)', async () => {
    const { service, calls } = makeMockService();
    const { base, close } = await boot(service);
    try {
      const body = { payment_id: 'pp_pro_1' };
      const first = await post(base, '/api/v1/webhooks/flouci', body);
      const second = await post(base, '/api/v1/webhooks/flouci', body);
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(calls.length, 2);
      assert.equal(calls[0].kind, 'webhook');
      assert.equal(calls[1].kind, 'webhook');
      const p0 = calls[0].payload as Json;
      const p1 = calls[1].payload as Json;
      assert.equal(p0.payment_id, 'pp_pro_1');
      assert.equal(p1.payment_id, 'pp_pro_1');
    } finally {
      await close();
    }
  });

  await test('webhook: public route — no auth required, still delegates (verify-then-activate)', async () => {
    const { service } = makeMockService();
    const { base, close } = await boot(service);
    try {
      const res = await post(base, '/api/v1/webhooks/flouci', { paymentId: 'pp_pro_1' });
      assert.equal(res.status, 200); // no 401 — Flouci cannot send a JWT
    } finally {
      await close();
    }
  });

  console.log('\n═══════════════════════════════════════════');
  console.log(` RESULTS: ✅ ${passed} passed | ❌ ${failed} failed`);
  console.log('═══════════════════════════════════════════');
  if (failures.length > 0) {
    console.log('FAILED TESTS:');
    failures.forEach((f) => console.log(f));
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('[KONSTRIVO-TEST] paymentRoutes test crashed:', e);
  process.exit(1);
});