import { metreRouter } from './metre';
/**
 * Phase 2 — /api/v1 Router
 *
 * Mounts all Phase 2 sub-routers under /api/v1.
 */
import { Router } from 'express';
import { authRouter, meRouter } from './auth';
import { materialsRouter } from './materials';
import { tradesRouter } from './trades';
import { pricesRouter } from './prices';
import { catalogRouter } from './catalog';
import { globalCatalogRouter } from './globalCatalog';
import { machineRouter } from './machine';
import { devisRouter } from './devis';
import { suppliersRouter } from './suppliers';
import { artisansRouter } from './artisans';
import { projectsRouter } from './projects';
import { subscriptionsRouter } from './subscriptions';
import { syncRouter } from './sync';
import { featuresRouter } from './features';
import { adminFeaturesRouter } from './adminFeatures';
import { adminPlansRouter } from './adminPlans';
import { referenceRouter } from './reference';
import { priceReviewRouter } from './priceReview';
import { createPaymentsRouter } from './payments';
import { createWebhooksRouter } from './webhooks';
import { createDefaultPaymentService, type PaymentService } from '../../services/paymentService';
import { errorHandler } from '../../middleware/errorHandler';
import { config } from '../../config';

// Lazy, cached PaymentService singleton for the Web API.
// createDefaultPaymentService() fails CLOSED without Flouci credentials —
// checkout/webhook then error out while the rest of the API keeps working.
// On failure the cache is cleared so a later request can retry.
let paymentServicePromise: Promise<PaymentService> | undefined;
function getPaymentService(): Promise<PaymentService> {
  if (!paymentServicePromise) {
    paymentServicePromise = createDefaultPaymentService().catch((err) => {
      paymentServicePromise = undefined;
      throw err;
    });
  }
  return paymentServicePromise;
}

export function setupV1Router(): Router {
  const router = Router();

  // API metadata / discovery
  router.get('/', (_req, res) => {
    res.json({
      name: 'KONSTRIVO API',
      version: 'v1',
      phase: 2,
      environment: config.nodeEnv,
      database: config.databaseUrl ? 'postgresql' : 'in-memory',
      endpoints: [
        'POST   /api/v1/auth/register',
        'POST   /api/v1/auth/login',
        'POST   /api/v1/auth/refresh',
        'POST   /api/v1/auth/logout',
        'GET    /api/v1/users/me',
        'GET    /api/v1/materials',
        'GET    /api/v1/materials/:id',
        'DELETE /api/v1/materials/:id',
        'GET    /api/v1/trades',
        'GET    /api/v1/trades/:id',
        'GET    /api/v1/trades/:id/services',
        'PATCH  /api/v1/trades/:id',
        'DELETE /api/v1/trades/:id',
        'POST   /api/v1/trades/:id/services',
        'PATCH  /api/v1/trades/:id/services/:serviceId',
        'GET    /api/v1/prices',
        'GET    /api/v1/prices/sources',
        'POST   /api/v1/prices/custom',
        'GET    /api/v1/devis',
        'POST   /api/v1/devis',
        'GET    /api/v1/devis/:id',
        'PUT    /api/v1/devis/:id',
        'DELETE /api/v1/devis/:id',
        'POST   /api/v1/suppliers/upload',
        'GET    /api/v1/suppliers/imports/:id',
        'POST   /api/v1/suppliers/imports/:id/approve',
        'GET    /api/v1/artisans',
        'GET    /api/v1/projects',
        'GET    /api/v1/projects/:id',
        'GET    /api/v1/artisans/:id',
        'GET    /api/v1/subscriptions/me',
        'POST   /api/v1/payments/checkout',
        'POST   /api/v1/webhooks/flouci',
        'POST   /api/v1/sync/pull',
        'POST   /api/v1/sync/push',
        'GET    /api/v1/features',
        'GET    /api/v1/features/:key',
        'POST   /api/v1/features/usage',
        'GET    /api/v1/admin/features',
        'GET    /api/v1/admin/features/usage',
        'POST   /api/v1/admin/features',
        'DELETE /api/v1/admin/features/:key',
        // P3 — Admin Plans (FREE/PRO of a company/user; admin-only)
        'GET    /api/v1/admin/plans',
        'POST   /api/v1/admin/plans',
      ],
    });
  });

  // Mount sub-routers
  router.use('/auth', authRouter);
  router.use('/users', meRouter);
  router.use('/materials', materialsRouter);
  router.use('/trades', tradesRouter);
  router.use('/prices', pricesRouter);
  router.use('/catalog', catalogRouter);
  router.use('/global-catalog', globalCatalogRouter);
  // Admin price review/publish endpoints (Phase 3)
  router.use('/admin/prices', priceReviewRouter);
  router.use('/machine', machineRouter);
  router.use('/devis', devisRouter);
  router.use('/suppliers', suppliersRouter);
  router.use('/artisans', artisansRouter);
  router.use('/projects', projectsRouter);
  router.use('/subscriptions', subscriptionsRouter);
  router.use('/payments', createPaymentsRouter(getPaymentService));
  router.use('/webhooks', createWebhooksRouter(getPaymentService));
  router.use('/sync', syncRouter);
  router.use('/features', featuresRouter);
  router.use('/admin/features', adminFeaturesRouter);
  // P3 — Admin plan management (FREE/PRO) on the existing subscriptions row
  router.use('/admin/plans', adminPlansRouter);
  // Phase 1 Foundation — additive read-only international reference API
  router.use('/reference', referenceRouter);

  // Métré workflow API
  router.use('/metre', metreRouter);

  // Central error handler for /api/v1
  router.use(errorHandler);

  return router;
}
