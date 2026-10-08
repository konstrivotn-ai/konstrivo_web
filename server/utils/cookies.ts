/**
 * Phase 2 — Refresh-token cookie helpers (auth foundation, Phase 0–1)
 *
 * Security posture:
 *   - The refresh token is written by the SERVER via Set-Cookie and is NEVER
 *     readable from JavaScript (HttpOnly), so XSS cannot steal it.
 *   - It is scoped SameSite=Strict (mitigates CSRF for top-level navigations).
 *   - `secure` is only enabled in production (HTTPS). In local HTTP dev the
 *     browser will not send a Secure cookie over plain http://localhost, so we
 *     relax it there to keep development usable — production is always HTTPS.
 *   - The short-lived access token lives only in browser memory (see
 *     src/lib/api.ts) and is never persisted to localStorage/sessionStorage.
 */
import { Request, Response } from 'express';
import { config } from '../config';

export const REFRESH_COOKIE_NAME = 'konstrivo_refresh_token';

/** Read a named cookie from the request cookie header (server-side only). */
export function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers?.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const idx = trimmed.indexOf('=');
    if (idx > -1 && trimmed.slice(0, idx) === name) {
      const value = trimmed.slice(idx + 1);
      try { return decodeURIComponent(value); }
      catch { return value; }
    }
  }
  return undefined;
}

export function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: config.jwtRefreshExpiresInSeconds * 1000,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.cookie(REFRESH_COOKIE_NAME, '', {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
}
