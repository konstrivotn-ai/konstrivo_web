/**
 * KONSTRIVO PRO — Cloudflare Containers entry (ADAPTER LAYER ONLY).
 *
 * Architecture (Containers migration stage — Vercel stays as fallback):
 *   /api/*        → forwarded to `KonstrivoContainer` (full Linux + Node 22 running the
 *                   UNCHANGED Express app `dist/server.cjs`).
 *   anything else → Cloudflare Static Assets (`assets.directory: "./dist"` +
 *                   `not_found_handling: "single-page-application"` in wrangler.jsonc).
 *
 * WHY CONTAINERS: Workers-pure cannot host the current Express dependency graph without
 * an open-ended Node-compat treadmill (iconv-lite disabled stubs, no `require` in Workers
 * ESM, `stream.Stream` missing, in-memory state per isolate, Hyperdrive 6-connection cap,
 * 10 ms CPU budget for `scrypt`). Containers are documented for exactly this: "run code
 * written in any programming language… full filesystem, specific runtime, or Linux-like
 * environment".
 *
 * What this file does NOT do (scope lock):
 *   - No routes, services, repositories, DB schema, features, auth or payments changes.
 *   - No Supabase changes: the container talks to Supabase DIRECTLY over TCP with its own
 *     `DATABASE_URL` (Hyperdrive is a Workers-runtime binding, not usable inside a container).
 *   - `vercel-entry.ts` + `api/index.cjs` + `vercel.json` stay untouched (Vercel = fallback).
 */
// Runtime-provided modules: they only exist inside workerd (Cloudflare Workers) and
// there are no local type declarations for them in this repo (`@cloudflare/workers-types`
// is intentionally NOT added — this change is adapter-only and must not touch other files).
// @ts-ignore -- provided by the `@cloudflare/containers` package
import { Container, getContainer } from '@cloudflare/containers';

/**
 * Env keys the container's Express app reads via `process.env`
 * (server/config.ts, routes, services). Forwarded verbatim from the Worker's
 * own env/secrets at container start — values are never logged here.
 *
 * Deliberately EXCLUDED:
 *   - TEST_DATABASE_URL (enables test guards — must never reach production).
 *   - PORT / NODE_ENV (owned by the image: Dockerfile sets PORT=8080 + NODE_ENV=production).
 */
const CONTAINER_ENV_KEYS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'JWT_REFRESH_EXPIRES_IN',
  'CORS_ALLOWED_ORIGINS',
  'PUBLIC_APP_URL',
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD',
  'ADMIN_BOOTSTRAP',
  'ADMIN_BOOTSTRAP_FORCE',
  'EMAILJS_SERVICE_ID',
  'EMAILJS_TEMPLATE_ID',
  'EMAILJS_PUBLIC_KEY',
  'EMAILJS_PRIVATE_KEY',
  'GEMINI_API_KEY',
  'FLOUCI_PUBLIC_KEY',
  'FLOUCI_SECRET_KEY',
  'FLOUCI_BASE_URL',
  'PRICE_UPDATE_CRON_SECRET',
  'PRICE_UPDATE_MACHINE_SECRET',
  'CIDB_API_TOKEN',
  'CIDB_API_EMAIL',
  'CIDB_API_PASSWORD',
  'CIDB_API_BASE_URL',
  'RATE_LIMIT_MAX',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_LOGIN_MAX',
  'RATE_LIMIT_LOGIN_WINDOW_MS',
  'RATE_LIMIT_REGISTER_MAX',
  'RATE_LIMIT_REGISTER_WINDOW_MS',
  'RATE_LIMIT_REFRESH_MAX',
  'RATE_LIMIT_REFRESH_WINDOW_MS',
  'RATE_LIMIT_AI_MAX',
  'RATE_LIMIT_AI_WINDOW_MS',
  'MAX_UPLOAD_BYTES',
] as const;

type ContainerEnvKey = (typeof CONTAINER_ENV_KEYS)[number];

/** Bindings consumed by the router (additive only — no app logic here). */
type WorkerBindings = {
  /** Durable Object binding that backs the Container class (declared in wrangler.jsonc). */
  KONSTRIVO_CONTAINER: DurableObjectNamespace;
  /** Static Assets binding that serves the built SPA (`assets.directory: "./dist"`). */
  ASSETS: Fetcher;
} & Partial<Record<ContainerEnvKey, string>>;

/** Routing id for the single shared stateless Express instance. */
const CONTAINER_ID = 'konstrivo-api';

/**
 * The container image runs the existing Express server UNCHANGED
 * (`node dist/server.cjs`). Everything below is configuration only:
 *  - `defaultPort`      → port Express listens on inside the container.
 *  - `sleepAfter`       → scale-to-zero after 10 idle minutes (billing stops with it).
 *  - `startupTimeoutMs` → allowance for the first boot of the image.
 *  - `envVars`          → built per-instance from the Worker's own env/secrets
 *                         (constructor below). This is the ONLY way secrets reach
 *                         `dist/server.cjs`: the runtime passes `this.envVars`
 *                         as `startConfig.env` at container start
 *                         (`options?.envVars ?? this.envVars`).
 */
export class KonstrivoContainer extends Container<WorkerBindings> {
  defaultPort = 8080;
  sleepAfter = '10m';
  startupTimeoutMs = 30_000;

  constructor(...args: ConstructorParameters<typeof Container<WorkerBindings>>) {
    super(...args);
    const env = args[1];
    // Forward only set, non-empty values; unset secrets stay unset inside
    // the container so fail-CLOSED guards keep working. Values never logged.
    const forwarded: Record<string, string> = {};
    for (const key of CONTAINER_ENV_KEYS) {
      const value = env[key];
      if (typeof value === 'string' && value.length > 0) forwarded[key] = value;
    }
    this.envVars = forwarded;
  }
}

export default {
  async fetch(request: Request, env: WorkerBindings): Promise<Response> {
    const url = new URL(request.url);

    // ── API: forwarded verbatim (same-origin path, method, headers and body preserved).
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const container = getContainer(env.KONSTRIVO_CONTAINER, CONTAINER_ID);
      return container.fetch(request);
    }

    // ── Anything else is served by Static Assets (SPA fallback is handled by wrangler.jsonc).
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<WorkerBindings>;
