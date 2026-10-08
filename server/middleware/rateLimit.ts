import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config';

export interface LimiterOptions {
  max: number;
  windowMs: number;
  message?: any;
}

// No-op middleware for test environment unless explicitly forced.
function noop(req: Request, res: Response, next: NextFunction) {
  return next();
}

/**
 * Create a rate limiter middleware. In `test` NODE_ENV the limiter is disabled
 * unless `force` is true. Accepts overrides so tests can use small windows.
 */
export function createLimiter(name: string, opts?: Partial<LimiterOptions>, force = false): RateLimitRequestHandler | ((req: Request, res: Response, next: NextFunction) => void) {
  // Always construct the underlying limiter, but wrap it so tests can
  // dynamically bypass rate limiting at request time by not setting
  // `TEST_ENABLE_RATE_LIMITS=1`. The `force` flag forces the limiter
  // even in test mode.

  // We'll compute chosen values lazily to pick up any environment overrides
  // applied by the test harness before the first request.
  // Lazily initialize the underlying limiter on first request so tests
  // can set RATE_LIMIT_* env vars before the limiter is constructed.
  let lazyLimiter: RateLimitRequestHandler | null = null;

  return function wrappedLimiter(req: Request, res: Response, next: NextFunction) {
    if (!force && process.env.TEST_ENABLE_RATE_LIMITS !== '1') {
      return noop(req, res, next);
    }

    if (!lazyLimiter) {
      // Compute chosen values from environment or sensible defaults
      const chosenNow: LimiterOptions = (() => {
        const defaultsNow: Record<string, LimiterOptions> = {
          default: { max: config.rateLimitMax, windowMs: config.rateLimitWindowMs },
          login: { max: Number(process.env.RATE_LIMIT_LOGIN_MAX || 10), windowMs: Number(process.env.RATE_LIMIT_LOGIN_WINDOW_MS || 15 * 60 * 1000) },
          register: { max: Number(process.env.RATE_LIMIT_REGISTER_MAX || 5), windowMs: Number(process.env.RATE_LIMIT_REGISTER_WINDOW_MS || 60 * 60 * 1000) },
          refresh: { max: Number(process.env.RATE_LIMIT_REFRESH_MAX || 60), windowMs: Number(process.env.RATE_LIMIT_REFRESH_WINDOW_MS || 15 * 60 * 1000) },
          aiEstimator: { max: Number(process.env.RATE_LIMIT_AI_MAX || 20), windowMs: Number(process.env.RATE_LIMIT_AI_WINDOW_MS || 15 * 60 * 1000) },
        };
        return Object.assign({}, defaultsNow[name] || defaultsNow.default, opts || {});
      })();

      // no diagnostic logs

      lazyLimiter = rateLimit({
        windowMs: chosenNow.windowMs,
        max: chosenNow.max,
        keyGenerator: (r: Request) => {
          // Compute raw client identifier from ip or X-Forwarded-For header
          const forwarded = (r.headers['x-forwarded-for'] as string) || '';
          // Prefer X-Forwarded-For when present (test harness will set it),
          // otherwise fall back to r.ip
          const raw = forwarded ? forwarded.split(',')[0].trim() : (r.ip || '');

          // Normalize common local IPv6/IPv4-mapped forms to a canonical IPv4 for stable keys
          const normalizeIp = (addr: string) => {
            if (!addr) return '';
            if (addr === '::1') return '127.0.0.1';
            if (addr.startsWith('::ffff:')) return addr.replace('::ffff:', '');
            return addr;
          };

          let base = normalizeIp(raw);

          // Prefer authenticated user id when available (ai-estimator runs authenticate before limiter)
          try {
            const maybeUser = (r as any).user;
            if (maybeUser && maybeUser.uid) {
              base = `user:${maybeUser.uid}`;
            } else {
              // If an Authorization Bearer token is present (e.g., refresh token),
              // incorporate a short fingerprint of the token so repeated requests
              // with the same token count against the same key without logging the token.
              const auth = (r.headers['authorization'] as string) || '';
              if (auth && auth.startsWith('Bearer ')) {
                const tok = auth.substring(7);
                const fp = crypto.createHash('sha256').update(tok).digest('hex').slice(0, 8);
                base = base ? `${base}|tok:${fp}` : `tok:${fp}`;
              }
            }
          } catch (err) {
            // best-effort fingerprinting; fall back to base
          }
          try {
            const port = process.env.TEST_SERVER_PORT || ((r.socket && (r.socket as any).localPort) || '');
            const key = `${base}|${port}`;
            return key;
          } catch { return base; }
          return base;
        },
        standardHeaders: true,
        legacyHeaders: false,
        handler: (rq: Request, rs: Response) => {
          const retryAfter = Math.ceil((chosenNow.windowMs) / 1000);
          rs.setHeader('Retry-After', String(retryAfter));
          rs.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, please try again later.' } });
        },
      });
    }

    return lazyLimiter(req, res, next as any);
  } as RateLimitRequestHandler;
}
