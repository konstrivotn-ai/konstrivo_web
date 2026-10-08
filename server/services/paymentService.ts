/**
 * Phase E — Payment Service (provider-agnostic orchestration)
 *
 * RESPONSIBILITIES / SAFETY:
 * - Talks ONLY to the PaymentProvider abstraction (`../payments/provider`);
 *   it never imports a concrete adapter (Flouci lives behind the seam).
 * - The amount is ALWAYS resolved SERVER-SIDE (`PRO_SUBSCRIPTION_PRICE_MILLIS`).
 *   `CreateProCheckoutInput` has NO amount field by design — a client cannot
 *   influence what it is charged, even by sending extra fields.
 * - Creates payments in `pending` state.
 * - `verifyAndSettle` implements pending→succeeded / pending→failed via the
 *   provider's authoritative `verifyPayment`.
 * - IDEMPOTENT on repeated `provider_payment_id`: an already-terminal payment
 *   is returned as a replay without any side effect.
 * - NO-DOWNGRADE: terminal statuses (succeeded/refunded/reversed) are immutable;
 *   a later FAILURE verification can never flip a succeeded payment.
 * - On success the Subscription is upgraded to PRO — BACKEND ONLY (tier is never
 *   accepted from client input).
 * - Does NOT touch Feature/RBAC/Calculator logic.
 */
import type { Payment, PaymentStatus, Subscription, UserTier } from '../types';
import type { PaymentProvider, VerifiedPayment } from '../payments/provider';
import type {
  CreatePaymentInput,
  PaymentTransitionPatch,
} from '../repositories/drizzlePaymentsRepository';

/**
 * Server-side PRO subscription price in MILLIMES (1 TND = 1000 millimes).
 * 25 000 millimes = 25.00 TND. Overridable per-instance via deps (tests);
 * NEVER overridable per-request (that would let a client pick its own price).
 */
export const PRO_SUBSCRIPTION_PRICE_MILLIS = 25_000;

/** Terminal statuses — once reached, a payment can never change again. */
export const TERMINAL_PAYMENT_STATUSES: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  'succeeded',
  'refunded',
  'reversed',
]);

/** Service-level error with a stable machine code for future route mapping. */
export class PaymentServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = 'PaymentServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/** Repository contract for payments (implemented by drizzlePaymentsRepository). */
export interface PaymentsRepositoryLike {
  create(input: CreatePaymentInput): Promise<Payment>;
  findById(id: string): Promise<Payment | undefined>;
  findByProviderPaymentId(provider: string, providerPaymentId: string): Promise<Payment | undefined>;
  findByInvoiceNumber(provider: string, invoiceNumber: string): Promise<Payment | undefined>;
  updateStatus(id: string, status: PaymentStatus, patch?: PaymentTransitionPatch): Promise<Payment>;
}

/** Repository contract for subscriptions (async/Drizzle variants only). */
export interface SubscriptionsRepositoryLike {
  findSubscriptionByCompanyId(companyId: string): Promise<Subscription | undefined>;
  createSubscription(companyId: string, tier: UserTier): Promise<Subscription>;
  updateSubscription(
    id: string,
    patch: Partial<Subscription>,
    expectedVersion?: number,
  ): Promise<Subscription>;
}

export interface PaymentServiceDeps {
  /** The provider abstraction — the ONLY payment seam this service may use. */
  provider: PaymentProvider;
  paymentsRepo: PaymentsRepositoryLike;
  subscriptionsRepo: SubscriptionsRepositoryLike;
  /** Server-side PRO price override (millimes). Defaults to PRO_SUBSCRIPTION_PRICE_MILLIS. */
  proPriceMillis?: number;
  /** Checkout currency. Defaults to 'TND'. */
  currency?: string;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

export interface CreateProCheckoutInput {
  companyId: string;
  /** Absolute URL the user is redirected to after a successful payment. */
  successLink: string;
  /** Absolute URL the user is redirected to after a failed payment. */
  failLink: string;
  /** Optional server-to-server notification URL. */
  webhookUrl?: string;
  /**
   * OPTIONAL server-issued reference that makes checkout creation idempotent.
   * This is NOT an amount and carries no pricing semantics.
   */
  referenceId?: string;
}

export interface CheckoutOutcome {
  payment: Payment;
  checkoutUrl: string;
  providerPaymentId: string;
  idempotentReplay: boolean;
}

export interface SettleOutcome {
  payment: Payment;
  /** The (upgraded) subscription when this call upgraded to PRO. */
  subscription: Subscription | undefined;
  /** true when nothing changed (terminal replay / no-op transition). */
  replay: boolean;
  /** true when THIS call performed the PRO upgrade. */
  upgradedToPro: boolean;
}

/** Normalises jsonb metadata to a plain object (DB default is the array '[]'). */
function asObjectMeta(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

/**
 * Pure state-machine resolver: maps a provider verification result onto the
 * next payment status for the CURRENT status.
 *
 * Rules:
 * - Terminal current status (succeeded/refunded/reversed) → unchanged, forever.
 * - `verified.success === false` → pending becomes failed; non-pending stays.
 * - SUCCESS / PREAUTH_SUCCESS → succeeded (allowed from pending AND failed:
 *   failed→succeeded is an upgrade, never a downgrade).
 * - PENDING → never regresses a resolved payment (failed stays failed).
 * - FAILURE / SYSTEM_FAILURE / EXPIRED → pending becomes failed.
 */
export function resolveNextStatus(
  current: PaymentStatus,
  verified: VerifiedPayment,
): { status: PaymentStatus; changed: boolean } {
  if (TERMINAL_PAYMENT_STATUSES.has(current)) {
    return { status: current, changed: false };
  }
  if (!verified.success) {
    return current === 'pending'
      ? { status: 'failed', changed: true }
      : { status: current, changed: false };
  }
  const s = verified.status;
  if (s === 'SUCCESS' || s === 'PREAUTH_SUCCESS') {
    return { status: 'succeeded', changed: current !== 'succeeded' };
  }
  if (s === 'PENDING') {
    return { status: current, changed: false };
  }
  return current === 'pending'
    ? { status: 'failed', changed: true }
    : { status: current, changed: false };
}

export class PaymentService {
  readonly providerId: string;
  readonly proPriceMillis: number;
  readonly currency: string;
  private readonly provider: PaymentProvider;
  private readonly paymentsRepo: PaymentsRepositoryLike;
  private readonly subscriptionsRepo: SubscriptionsRepositoryLike;
  private readonly now: () => Date;

  constructor(deps: PaymentServiceDeps) {
    if (!deps?.provider) throw new PaymentServiceError('PROVIDER_REQUIRED', 'provider is required');
    if (!deps?.paymentsRepo) {
      throw new PaymentServiceError('PAYMENTS_REPO_REQUIRED', 'paymentsRepo is required');
    }
    if (!deps?.subscriptionsRepo) {
      throw new PaymentServiceError('SUBSCRIPTIONS_REPO_REQUIRED', 'subscriptionsRepo is required');
    }
    this.provider = deps.provider;
    this.providerId = deps.provider.id;
    this.paymentsRepo = deps.paymentsRepo;
    this.subscriptionsRepo = deps.subscriptionsRepo;
    this.proPriceMillis = deps.proPriceMillis ?? PRO_SUBSCRIPTION_PRICE_MILLIS;
    if (!Number.isInteger(this.proPriceMillis) || this.proPriceMillis <= 0) {
      throw new PaymentServiceError(
        'INVALID_PRICE',
        'proPriceMillis must be a positive integer (millimes).',
      );
    }
    this.currency = deps.currency ?? 'TND';
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Create a PRO subscription checkout.
   *
   * PRICE: taken exclusively from the server-side `proPriceMillis` — the input
   * type has no amount field, so no client can influence the charge.
   * IDEMPOTENT: with a `referenceId`, a repeated call returns the original
   * payment and its stored checkout URL without creating a second session.
   */
  async createProCheckout(input: CreateProCheckoutInput): Promise<CheckoutOutcome> {
    if (!input?.companyId) {
      throw new PaymentServiceError('COMPANY_REQUIRED', 'companyId is required');
    }
    if (!input?.successLink || !input?.failLink) {
      throw new PaymentServiceError('LINKS_REQUIRED', 'successLink and failLink are required');
    }

    if (input.referenceId) {
      const existing = await this.paymentsRepo.findByInvoiceNumber(
        this.providerId,
        input.referenceId,
      );
      if (existing) {
        const meta = asObjectMeta(existing.metadata);
        return {
          payment: existing,
          checkoutUrl: typeof meta.checkoutUrl === 'string' ? meta.checkoutUrl : '',
          providerPaymentId: existing.providerPaymentId,
          idempotentReplay: true,
        };
      }
    }

    // SERVER-SIDE price — never from the client.
    const priceMillis = this.proPriceMillis;
    const payment = await this.paymentsRepo.create({
      companyId: input.companyId,
      provider: this.providerId,
      amount: Number((priceMillis / 1000).toFixed(2)),
      currency: this.currency,
      status: 'pending',
      paymentType: 'subscription',
      invoiceNumber: input.referenceId ?? null,
      metadata: {
        plan: 'PRO',
        priceMillis,
        currency: this.currency,
        createdAt: this.now().toISOString(),
      },
    });

    const checkout = await this.provider.createCheckout({
      amountMillis: priceMillis,
      developerTrackingId: payment.id,
      successLink: input.successLink,
      failLink: input.failLink,
      webhookUrl: input.webhookUrl,
    });

    const updated = await this.paymentsRepo.updateStatus(payment.id, 'pending', {
      providerPaymentId: checkout.paymentId,
      metadata: {
        ...asObjectMeta(payment.metadata),
        plan: 'PRO',
        priceMillis,
        currency: this.currency,
        checkoutUrl: checkout.checkoutUrl,
      },
      expectedVersion: payment.version,
    });

    return {
      payment: updated,
      checkoutUrl: checkout.checkoutUrl,
      providerPaymentId: checkout.paymentId,
      idempotentReplay: false,
    };
  }

  /**
   * Authoritative settlement: verify with the provider, then transition
   * pending→succeeded / pending→failed.
   *
   * IDEMPOTENCY + NO-DOWNGRADE:
   * - An unknown `providerPaymentId` throws PAYMENT_NOT_FOUND.
   * - A payment already in a terminal status is returned as a replay WITHOUT
   *   contacting the provider again and WITHOUT any subscription side effect.
   * - On SUCCESS the subscription is upgraded to PRO (backend only) and the
   *   payment is linked to it.
   */
  async verifyAndSettle(input: { providerPaymentId: string }): Promise<SettleOutcome> {
    const providerPaymentId = (input?.providerPaymentId ?? '').trim();
    if (!providerPaymentId) {
      throw new PaymentServiceError(
        'PROVIDER_PAYMENT_ID_REQUIRED',
        'providerPaymentId is required',
      );
    }

    const existing = await this.paymentsRepo.findByProviderPaymentId(
      this.providerId,
      providerPaymentId,
    );
    if (!existing) {
      throw new PaymentServiceError(
        'PAYMENT_NOT_FOUND',
        `No payment for provider_payment_id "${providerPaymentId}"`,
        404,
      );
    }

    // Terminal states are final — replay, no provider call, no side effects.
    if (TERMINAL_PAYMENT_STATUSES.has(existing.status)) {
      return { payment: existing, subscription: undefined, replay: true, upgradedToPro: false };
    }

    const verified = await this.provider.verifyPayment(providerPaymentId);
    const next = resolveNextStatus(existing.status, verified);

    if (!next.changed) {
      // e.g. still PENDING at the provider, or a failed payment still failed.
      return { payment: existing, subscription: undefined, replay: true, upgradedToPro: false };
    }

    if (next.status === 'succeeded') {
      const subscription = await this.ensureProSubscription(existing, providerPaymentId);
      const meta = asObjectMeta(existing.metadata);
      const updated = await this.paymentsRepo.updateStatus(existing.id, 'succeeded', {
        subscriptionId: subscription.id,
        expectedVersion: existing.version,
        metadata: {
          ...meta,
          plan: 'PRO',
          priceMillis: this.proPriceMillis,
          currency: this.currency,
          providerStatus: verified.status ?? undefined,
          settlementStatus: verified.settlementStatus ?? undefined,
          verifiedAt: this.now().toISOString(),
        },
      });
      return { payment: updated, subscription, replay: false, upgradedToPro: true };
    }

    // failed
    const updated = await this.paymentsRepo.updateStatus(existing.id, 'failed', {
      lastError: verified.message || `provider status: ${verified.status ?? 'unknown'}`,
      expectedVersion: existing.version,
    });
    return { payment: updated, subscription: undefined, replay: false, upgradedToPro: false };
  }

  /**
   * Convenience wrapper for a webhook signal. Per the provider documentation,
   * a webhook is ONLY a signal: the actual settlement always goes through the
   * authoritative verify path above. Returns a soft-fail for malformed
   * payloads so a webhook route can 200 them safely.
   */
  async processWebhookSignal(payload: unknown): Promise<
    | { handled: false; reason: 'NO_PAYMENT_ID' }
    | { handled: true; outcome: SettleOutcome }
  > {
    const ctx = this.provider.handleWebhook(payload);
    if (!ctx.paymentId) return { handled: false, reason: 'NO_PAYMENT_ID' };
    const outcome = await this.verifyAndSettle({ providerPaymentId: ctx.paymentId });
    return { handled: true, outcome };
  }

  /**
   * BACKEND-ONLY PRO upgrade. The tier is NEVER taken from client input —
   * it is hardcoded here on a successful settlement.
   */
  private async ensureProSubscription(
    payment: Payment,
    providerPaymentId: string,
  ): Promise<Subscription> {
    let sub = await this.subscriptionsRepo.findSubscriptionByCompanyId(payment.companyId);
    if (!sub) {
      sub = await this.subscriptionsRepo.createSubscription(payment.companyId, 'PRO');
    }
    const now = this.now();
    const periodEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const tndAmount = Number((this.proPriceMillis / 1000).toFixed(2));
    const patch = {
      tier: 'PRO',
      status: 'active',
      provider: this.providerId,
      providerSubscriptionId: providerPaymentId,
      currency: this.currency,
      amount: tndAmount,
      renewalType: 'manual',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
    } as unknown as Partial<Subscription>;
    return this.subscriptionsRepo.updateSubscription(sub.id, patch, sub.version);
  }
}

/** Factory with explicit deps (used by tests and production wiring). */
export function createPaymentService(deps: PaymentServiceDeps): PaymentService {
  return new PaymentService(deps);
}

/**
 * Production default: real Drizzle repositories + provider resolved from
 * config through the abstraction. Loaded lazily so importing this module
 * never touches the database or requires credentials.
 */
export async function createDefaultPaymentService(): Promise<PaymentService> {
  const [configMod, providerMod, paymentsRepoMod, subsRepoMod] = await Promise.all([
    import('../config'),
    import('../payments/provider'),
    import('../repositories/drizzlePaymentsRepository'),
    import('../repositories/drizzleSubscriptionsRepository'),
  ]);
  const provider = await providerMod.resolvePaymentProvider('flouci', {
    publicKey: configMod.config.flouciPublicKey,
    secretKey: configMod.config.flouciSecretKey,
    baseUrl: configMod.config.flouciBaseUrl || undefined,
  });
  return createPaymentService({
    provider,
    paymentsRepo: {
      create: paymentsRepoMod.createPayment,
      findById: paymentsRepoMod.findPaymentById,
      findByProviderPaymentId: paymentsRepoMod.findPaymentByProviderPaymentId,
      findByInvoiceNumber: paymentsRepoMod.findPaymentByInvoiceNumber,
      updateStatus: paymentsRepoMod.updatePaymentStatus,
    },
    subscriptionsRepo: {
      findSubscriptionByCompanyId: subsRepoMod.findSubscriptionByCompanyId,
      createSubscription: subsRepoMod.createSubscription,
      updateSubscription: subsRepoMod.updateSubscription,
    },
  });
}