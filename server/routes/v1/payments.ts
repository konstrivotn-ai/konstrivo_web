/**
 * Phase E — Payment checkout routes (Web).
 *
 * Security posture:
 * - Authenticated ONLY. companyId comes EXCLUSIVELY from the server-signed JWT
 *   (req.user.companyId) — never from req.body, never trusted from the client.
 * - This route never sees an amount/price/tier: PaymentService resolves the PRO
 *   price SERVER-SIDE and creates the payment in `pending` state.
 * - No direct subscription/DB access here — full delegation to PaymentService.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticate, type AuthenticatedRequest } from '../../middleware/auth';
import type { PaymentService } from '../../services/paymentService';

/** A live service instance (tests) or a lazy async resolver (production wiring). */
export type PaymentServiceProvider = PaymentService | (() => Promise<PaymentService>);

export function resolvePaymentService(p: PaymentServiceProvider): Promise<PaymentService> {
  return typeof p === 'function' ? p() : Promise.resolve(p);
}

export function createPaymentsRouter(paymentService: PaymentServiceProvider): Router {
  const router = Router();

  // POST /api/v1/payments/checkout — create a PRO checkout session.
  router.post(
    '/checkout',
    authenticate,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const companyId = req.user?.companyId;
        if (!companyId) {
          res.status(400).json({ error: 'COMPANY_REQUIRED' });
          return;
        }
        // NOTE: req.body.companyId / amount / tier are deliberately IGNORED.
        // Only non-monetary redirect URLs + an optional idempotency key pass.
        const service = await resolvePaymentService(paymentService);
        const outcome = await service.createProCheckout({
          companyId,
          successLink: req.body?.successLink,
          failLink: req.body?.failLink,
          referenceId: req.body?.referenceId,
        });
        res.status(201).json({
          paymentId: outcome.providerPaymentId,
          checkoutUrl: outcome.checkoutUrl,
          replay: outcome.idempotentReplay,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}