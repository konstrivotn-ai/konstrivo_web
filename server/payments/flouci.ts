/**
 * Phase E — Flouci payment provider adapter (Flouci Payment API v2).
 *
 * Implements the PaymentProvider contract against the OFFICIAL Flouci API:
 *
 *   base ......... https://developers.flouci.com/api/v2  (override via FLOUCI_BASE_URL)
 *   checkout ..... POST {base}/generate_payment
 *   verify ....... GET  {base}/verify_payment/:payment_id
 *   refund ....... POST {base}/refund_payment
 *   auth ......... Authorization: Bearer {PUBLIC_KEY}:{PRIVATE_KEY}
 *
 * Reference: official Flouci documentation (docs.flouci.com).
 */
import { PaymentProvider, PaymentProviderError } from './provider';
import type { CheckoutResult, CreateCheckoutParams } from './provider';
import type { PaymentWebhookContext, RefundResult, VerifiedPayment } from './provider';

export const FLOUCI_DEFAULT_BASE_URL = 'https://developers.flouci.com/api/v2';

export interface FlouciAdapterOptions {
  publicKey: string;
  secretKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

function isHttpUrl(v: string | undefined): v is string {
  if (!v || typeof v !== 'string') return false;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

function baseUrlOf(raw: string | undefined): string {
  const b = (raw ?? FLOUCI_DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  if (!isHttpUrl(b)) throw new PaymentProviderError(
    '[Flouci] Invalid base URL.', { provider: 'flouci', code: 'INVALID_BASE_URL' });
  return b;
}

function errMsg(j: unknown, fb: string): string {
  if (j && typeof j === 'object') {
    const o = j as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message) return o.message;
    const r = o.result as Record<string, unknown> | undefined;
    if (r && typeof r.message === 'string' && r.message) return r.message;
  }
  return fb;
}

function errCode(j: unknown): string | undefined {
  if (j && typeof j === 'object') {
    const o = j as Record<string, unknown>;
    if (typeof o.code === 'string') return o.code;
    const r = o.result as Record<string, unknown> | undefined;
    if (r && r.status !== undefined) return String(r.status);
  }
  return undefined;
}


class FlouciPaymentProvider implements PaymentProvider {
  readonly id = 'flouci';
  private readonly pk: string;
  private readonly sk: string;
  private readonly base: string;
  private readonly fx: FetchFn;

  constructor(o: FlouciAdapterOptions) {
    const pk = (o?.publicKey ?? '').trim();
    const sk = (o?.secretKey ?? '').trim();
    if (!pk || !sk) throw new PaymentProviderError(
      '[Flouci] Missing credentials: FLOUCI_PUBLIC_KEY/FLOUCI_SECRET_KEY required.',
      { provider: 'flouci', code: 'MISSING_CREDENTIALS' });
    this.pk = pk; this.sk = sk;
    this.base = baseUrlOf(o?.baseUrl);
    const impl = o?.fetchImpl ?? (globalThis.fetch as unknown as FetchFn | undefined);
    if (!impl) throw new PaymentProviderError(
      '[Flouci] No fetch implementation.', { provider: 'flouci', code: 'NO_FETCH' });
    this.fx = impl;
  }

  private auth(): string { return `Bearer ${this.pk}:${this.sk}`; }

  async createCheckout(p: CreateCheckoutParams): Promise<CheckoutResult> {
    if (!Number.isInteger(p?.amountMillis) || (p.amountMillis as number) <= 0)
      throw new PaymentProviderError('[Flouci] amountMillis must be a positive integer (millimes).',
        { provider: 'flouci', code: 'INVALID_AMOUNT' });
    if (!isHttpUrl(p?.successLink))
      throw new PaymentProviderError('[Flouci] successLink must be absolute http(s) URL (required).',
        { provider: 'flouci', code: 'INVALID_SUCCESS_LINK' });
    if (!isHttpUrl(p?.failLink))
      throw new PaymentProviderError('[Flouci] failLink must be absolute http(s) URL (required).',
        { provider: 'flouci', code: 'INVALID_FAIL_LINK' });
    if (p?.webhookUrl !== undefined && !isHttpUrl(p.webhookUrl))
      throw new PaymentProviderError('[Flouci] webhookUrl must be absolute http(s) URL.',
        { provider: 'flouci', code: 'INVALID_WEBHOOK_URL' });

    const body: Record<string, unknown> = {
      amount: String(p.amountMillis),
      success_link: p.successLink,
      fail_link: p.failLink,
    };
    if (p.developerTrackingId !== undefined) body.developer_tracking_id = p.developerTrackingId;
    if (p.acceptCard !== undefined) body.accept_card = p.acceptCard;
    if (p.sessionTimeoutSecs !== undefined) body.session_timeout_secs = p.sessionTimeoutSecs;
    if (p.webhookUrl !== undefined) body.webhook = p.webhookUrl;
    if (p.imageUrl !== undefined) body.image_url = p.imageUrl;

    let res: Response;
    try {
      res = await this.fx(`${this.base}/generate_payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: this.auth() },
        body: JSON.stringify(body),
      });
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      throw new PaymentProviderError(`[Flouci] generate_payment network error: ${m}`,
        { provider: 'flouci', code: 'NETWORK_ERROR' });
    }
    let j: unknown = null;
    try { j = await res.json(); } catch { j = null; }
    if (!res.ok) throw new PaymentProviderError(
      `[Flouci] generate_payment HTTP ${res.status}: ${errMsg(j, res.statusText)}`,
      { provider: 'flouci', code: errCode(j) ?? `HTTP_${res.status}`, status: res.status });
    const r = (j as Record<string, unknown> | null)?.result as Record<string, unknown> | undefined;
    const pid = r?.payment_id; const link = r?.link;
    if (r?.success !== true || typeof pid !== 'string' || !pid || typeof link !== 'string' || !link)
      throw new PaymentProviderError(
        `[Flouci] generate_payment unsuccessful: ${errMsg(j, 'unknown error')}`,
        { provider: 'flouci', code: errCode(j) ?? 'GENERATE_FAILED', status: res.status });
    const rtid = r?.developer_tracking_id;
    return { paymentId: pid, checkoutUrl: link,
      developerTrackingId: typeof rtid === 'string' ? rtid : undefined,
      raw: j };
  }

  async verifyPayment(paymentId: string): Promise<VerifiedPayment> {
    const id = (paymentId ?? '').trim();
    if (!id) throw new PaymentProviderError('[Flouci] paymentId must be non-empty.',
      { provider: 'flouci', code: 'INVALID_PAYMENT_ID' });
    let res: Response;
    try {
      res = await this.fx(`${this.base}/verify_payment/${encodeURIComponent(id)}`, {
        method: 'GET', headers: { Authorization: this.auth() },
      });
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      throw new PaymentProviderError(`[Flouci] verify_payment network error: ${m}`,
        { provider: 'flouci', code: 'NETWORK_ERROR' });
    }
    let j: unknown = null;
    try { j = await res.json(); } catch { j = null; }
    if (!res.ok) throw new PaymentProviderError(
      `[Flouci] verify_payment HTTP ${res.status}: ${errMsg(j, res.statusText)}`,
      { provider: 'flouci', code: errCode(j) ?? `HTTP_${res.status}`, status: res.status });
    const root = (j ?? {}) as Record<string, unknown>;
    const r = root.result as Record<string, unknown> | undefined;
    if (root.success !== true || !r || typeof r !== 'object') return {
      success: false, message: errMsg(j, 'Verification returned success=false.'), raw: j };
    const amt = r.amount;
    const det = r.details;
    const dtid2 = r.developer_tracking_id;
    const sstat = r.settlement_status;
    return {
      success: true,
      status: r.status as VerifiedPayment['status'],
      paymentId: id,
      type: typeof r.type === 'string' ? r.type : undefined,
      amountMillis: typeof amt === 'number' && Number.isInteger(amt) ? amt : undefined,
      developerTrackingId: (dtid2 as string | null | undefined) ?? undefined,
      settlementStatus: typeof sstat === 'string' ? sstat : undefined,
      details: (det as Record<string, unknown> | undefined) ?? undefined,
      raw: j,
    };
  }

  handleWebhook(payload: unknown): PaymentWebhookContext {
    if (!payload || typeof payload !== 'object') return { raw: payload };
    const o = payload as Record<string, unknown>;
    const pick = (...ks: string[]): string | undefined => {
      for (const k of ks) { const v = o[k]; if (typeof v === 'string' && v) return v; }
      return undefined;
    };
    return {
      paymentId: pick('payment_id', 'paymentId', 'paymentID', 'id'),
      developerTrackingId: pick('developer_tracking_id', 'developerTrackingId', 'tracking_id', 'trackingId'),
      raw: payload,
    };
  }

  async refund(paymentId: string): Promise<RefundResult> {
    const id = (paymentId ?? '').trim();
    if (!id) throw new PaymentProviderError('[Flouci] paymentId must be non-empty.',
      { provider: 'flouci', code: 'INVALID_PAYMENT_ID' });
    let res: Response;
    try {
      res = await this.fx(`${this.base}/refund_payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: this.auth() },
        body: JSON.stringify({ payment_id: id }),
      });
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      throw new PaymentProviderError(`[Flouci] refund_payment network error: ${m}`,
        { provider: 'flouci', code: 'NETWORK_ERROR' });
    }
    let j: unknown = null;
    try { j = await res.json(); } catch { j = null; }
    const root = (j ?? {}) as Record<string, unknown>;
    if (!res.ok || root.status === 'error') throw new PaymentProviderError(
      `[Flouci] refund_payment HTTP ${res.status}: ${errMsg(j, res.statusText)}`,
      { provider: 'flouci', code: (root.code as string | undefined) ?? errCode(j) ?? `HTTP_${res.status}`,
        status: res.status });
    const r = root.result as Record<string, unknown> | undefined;
    if (!r || typeof r !== 'object') throw new PaymentProviderError(
      '[Flouci] refund_payment returned no result object.',
      { provider: 'flouci', code: 'REFUND_FAILED', status: res.status });
    const rid = r.refund_id; const rpid = r.payment_id; const ramt = r.amount;
    const rstat = r.status; const rat = r.refunded_at;
    return {
      success: true,
      refundId: typeof rid === 'string' ? rid : undefined,
      paymentId: typeof rpid === 'string' ? rpid : id,
      amount: typeof ramt === 'string' ? ramt : undefined,
      status: typeof rstat === 'string' ? rstat : undefined,
      refundedAt: typeof rat === 'string' ? rat : undefined,
      raw: j,
    };
  }
}

export function createPaymentProvider(o: FlouciAdapterOptions): PaymentProvider {
  return new FlouciPaymentProvider(o ?? ({} as FlouciAdapterOptions));
}

