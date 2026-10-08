/**
 * Phase E — Flouci webhook route (PUBLIC, no auth).
 *
 * Flouci webhooks are only a SIGNAL: the authoritative truth is the provider's
 * `verify_payment` (official Flouci recommendation). Therefore this route never
 * trusts the payload status — it passes the payload to
 * PaymentService.processWebhookSignal, which extracts the payment id, calls the
 * provider's verifyPayment, and only THEN (inside the service — with
 * idempotency + no-downgrade guards) may upgrade the subscription to PRO.
 * The route itself performs NO PRO activation and never touches subscriptions.
 *
 * Responses:
 * - 200: handled (incl. idempotent replays) — stops provider retries.
 * - 400: payload carried no payment id (malformed) — provider should retry.
 * - 502: verification transport/auth failure — retryable; PRO is never
 *        activated on this path.
 */
import { Router, type Request, type Response } from 'express';
import type { PaymentService } from '../../services/paymentService';
import { resolvePaymentService, type PaymentServiceProvider } from './payments';

export function createWebhooksRouter(paymentService: PaymentServiceProvider): Router {
  const router = Router();

  router.post('/flouci', async (req: Request, res: Response) => {
    try {
      const service = await resolvePaymentService(paymentService);
      const result = await service.processWebhookSignal(req.body ?? {});

      if (result.handled === false) {
        res.status(400).json({ received: false, reason: result.reason ?? 'UNHANDLED' });
        return;
      }
      res.status(200).json({
        received: true,
        paymentId: result.outcome?.payment?.id,
        status: result.outcome?.payment?.status,
      });
    } catch (err: any) {
      // Transport/auth verification failure — retryable.
      // PRO is NEVER activated here.
      res.status(502).json({ received: false, error: err?.code ?? 'VERIFY_FAILED' });
    }
  });

  return router;
}