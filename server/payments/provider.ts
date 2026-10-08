/**
 * Phase E — Payment Provider abstraction (Flouci-first).
 *
 * This module is the ONLY seam the (future) paymentService/route layer may
 * talk to. It defines the provider contract, the shared value types and a
 * small provider resolver. It is deliberately independent of routes, services,
 * config wiring and the database.
 *
 * Field names and the amount unit (MILLIMES) strictly follow the official
 * Flouci Payment API documentation (https://docs.flouci.com).
 */

/** A checkout-creation request. `amountMillis` is in MILLIMES (Flouci's pricing unit: 1 TND = 1000). */
export interface CreateCheckoutParams {
  amountMillis: number;
  /** Merchant-supplied reference, echoed back by Flouci on verify/response. */
  developerTrackingId?: string;
  /** URL to redirect the user to after a successful payment (required by Flouci). */
  successLink: string;
  /** URL to redirect the user to after a failed payment (required by Flouci). */
  failLink: string;
  /** Server-to-server notification URL where Flouci POSTs the transaction outcome. */
  webhookUrl?: string;
  /** Whether to accept card payments on the hosted page (default: false). */
  acceptCard?: boolean;
  /** Hosted session timeout in seconds (default: 1200). */
  sessionTimeoutSecs?: number;
  /** Optional image shown on the payment page. */
  imageUrl?: string;
}

/** Result of creating a checkout. The user must be redirected to `checkoutUrl`. */
export interface CheckoutResult {
  paymentId: string;
  checkoutUrl: string;
  developerTrackingId?: string;
  raw: unknown;
}

/** Payment statuses returned by the Flouci v2 `verify_payment` endpoint (official). */
export type FlouciPaymentStatus =
  | 'SUCCESS'
  | 'PENDING'
  | 'EXPIRED'
  | 'FAILURE'
  | 'PREAUTH_SUCCESS'
  | 'SYSTEM_FAILURE';

export interface VerifiedPayment {
  /** true ONLY when the provider's success flag is true AND the payload parsed. */
  success: boolean;
  status?: FlouciPaymentStatus;
  /** `payment_id` the verification was performed against. */
  paymentId?: string;
  /** Payment method used: 'card' | 'wallet' | 'mpayment' | 'NA' (official). */
  type?: string;
  /** Amount paid in millimes (official integer field). */
  amountMillis?: number;
  developerTrackingId?: string | null;
  /** Settlement lifecycle: PROCESSING | AVAILABLE | IN_PAYOUT | PAID | NOT_APPLICABLE (official). */
  settlementStatus?: string;
  details?: Record<string, unknown>;
  /** Human-readable reason when success is false. */
  message?: string;
  raw: unknown;
}

export interface RefundResult {
  success: boolean;
  refundId?: string;
  paymentId?: string;
  amount?: string;
  status?: string;
  refundedAt?: string;
  message?: string;
  code?: string;
  raw: unknown;
}

/**
 * Minimal context extracted from a provider webhook notification.
 *
 * SECURITY POLICY — per the official Flouci documentation (verify-transaction):
 * a webhook is only a SIGNAL; its payload must NEVER be trusted as proof of a
 * payment. The docs explicitly advise calling `verify_payment` when a webhook
 * arrives. The future webhook route MUST do exactly that before any side
 * effect (upgrading a subscription, marking an invoice paid, etc.).
 */
export interface PaymentWebhookContext {
  paymentId?: string;
  developerTrackingId?: string;
  raw: unknown;
}

export interface PaymentProvider {
  readonly id: string;
  /** Create a payment and return the hosted checkout URL to redirect to. */
  createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult>;
  /** Authoritative status check for a previously created payment. */
  verifyPayment(paymentId: string): Promise<VerifiedPayment>;
  /** Parse-only webhook extraction. Callers must confirm via verifyPayment. */
  handleWebhook(payload: unknown): PaymentWebhookContext;
  /** Refund a completed payment. */
  refund(paymentId: string): Promise<RefundResult>;
}

/** Error thrown by provider adapters, with provider id + optional code/status. */
export class PaymentProviderError extends Error {
  readonly provider: string;
  readonly code?: string;
  readonly status?: number;

  constructor(
    message: string,
    options: { provider?: string; code?: string; status?: number } = {},
  ) {
    super(message);
    this.name = 'PaymentProviderError';
    this.provider = options.provider ?? 'unknown';
    this.code = options.code;
    this.status = options.status;
  }
}

/**
 * Lazy built-in provider loaders. `flouci` is loaded dynamically so this
 * module never creates a static circular dependency with the adapter file.
 */
const BUILTIN_PROVIDERS: Record<string, () => Promise<{ createPaymentProvider(options: unknown): PaymentProvider }>> = {
  flouci: () => import('./flouci'),
};

/**
 * Provider resolver / factory. Throws for unknown ids; hands the (provider
 * specific) options bag to the selected adapter factory.
 */
export async function resolvePaymentProvider(
  providerId: string,
  options: unknown,
): Promise<PaymentProvider> {
  const loader = BUILTIN_PROVIDERS[providerId];
  if (!loader) {
    throw new PaymentProviderError(
      `Unsupported payment provider "${providerId}". Available: ${Object.keys(BUILTIN_PROVIDERS).join(', ')}`,
      { provider: providerId },
    );
  }
  const mod = await loader();
  return mod.createPaymentProvider(options);
}