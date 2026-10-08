/**
 * Vercel serverless entry — the single source for the deployed function.
 *
 * `npm run build` bundles this file (via esbuild) into `api/index.cjs`
 * (CommonJS). Deploying a pre-bundled `.cjs` function avoids the ESM /
 * extensionless-import failures the Vercel Node runtime hits when it tries
 * to compile `api/index.ts` with `../server.js`-style specifiers.
 *
 * This file is never executed directly: it only exists as a bundle input.
 */
import { createApp } from './server';
import { bootstrapAdmin } from './server/bootstrap';

// Cache the app across invocations (serverless warm reuse).
let cachedApp: any = null;
let bootstrapPromise: Promise<void> | null = null;

const ensureApp = async () => {
  if (!cachedApp) {
    cachedApp = await createApp();
    // Ensure the admin user exists on the first (cold) invocation.
    // Idempotent: skips if admin already present. Safe for every cold start.
    if (!bootstrapPromise) bootstrapPromise = bootstrapAdmin().catch(err => {
      console.error('[KONSTRIVO] bootstrapAdmin failed:', err?.message || err);
    });
    await bootstrapPromise;
  }
  return cachedApp;
};

export default async function handler(req: any, res: any) {
  const app = await ensureApp();
  return app(req, res);
}