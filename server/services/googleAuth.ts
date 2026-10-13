/**
 * Google sign-in — server-side ID token verification.
 *
 * SECURITY MODEL:
 * - The client only ever sends an ID token (obtained from Google Identity
 *   Services / Google Sign-In on the device). The server independently
 *   verifies the signature against Google's published JWKS, the issuer,
 *   the audience (a configured OAuth client ID), the expiry, and the
 *   `email_verified` claim. Nothing supplied by the client (email, name,
 *   role) is trusted on its own.
 * - Only Node.js built-ins are used (no new dependencies): RS256 signature
 *   verification via `crypto.verify` with JWK public keys.
 * - The JWKS fetcher and clock are injectable so the test suite can verify
 *   real signatures with a locally generated key pair without any network.
 */
import crypto from 'node:crypto';

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
export const GOOGLE_ISSUERS = new Set([
  'https://accounts.google.com',
  'accounts.google.com',
]);

/** Password-hash marker for accounts provisioned through Google sign-in.
 *  `comparePassword` fails closed on this value (it is not in the scrypt
 *  format), so password login is impossible for these accounts. The Google
 *  `sub` is bound here so a recycled email address can never take over an
 *  existing Google-provisioned account. */
export const GOOGLE_PASSWORD_MARKER_PREFIX = 'google-oauth:sub:';

export interface GoogleJwk {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
}

export interface GoogleJwks {
  keys: GoogleJwk[];
}

export interface GoogleIdTokenPayload {
  iss: string;
  sub: string;
  aud: string | string[];
  email: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

export type GoogleJwksFetcher = (url: string) => Promise<GoogleJwks>;

export interface GoogleVerifierOptions {
  clientIds: string[];
  fetchJwks?: GoogleJwksFetcher;
  jwksUrl?: string;
  nowSeconds?: () => number;
  leewaySeconds?: number;
}

export class GoogleTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleTokenError';
  }
}
async function resolveJwk(
  kid: string | undefined,
  url: string,
  fetchJwks: GoogleJwksFetcher,
  nowMs: number,
): Promise<GoogleJwk> {
  const cached = jwksCache.get(url);
  const findKey = (jwks: GoogleJwks): GoogleJwk | undefined => {
    if (!kid) return undefined;
    return jwks.keys.find((k) => k.kid === kid && k.kty === 'RSA');
  };

  if (cached && nowMs - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
    const hit = findKey(cached.jwks);
    if (hit) return hit;
  }

  // Unknown (or missing-from-cache) kid → refetch once, then look again.
  const fresh = await fetchJwks(url);
  jwksCache.set(url, { fetchedAt: nowMs, jwks: fresh });
  const key = findKey(fresh);
  if (!key) throw new GoogleTokenError('Signing key not found in Google JWKS');
  return key;
}

function safeEqualStrings(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) {
    // Still perform a comparison to keep timing uniform, then fail.
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Verifies a Google-issued ID token and returns its validated claims.
 * Throws [GoogleTokenError] with a safe, non-leaky message on any failure.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  options: GoogleVerifierOptions,
): Promise<GoogleIdTokenPayload> {
  const {
    clientIds,
    jwksUrl = GOOGLE_JWKS_URL,
    leewaySeconds = DEFAULT_LEEWAY_SECONDS,
  } = options;
  const fetchJwks = options.fetchJwks ?? jwksFetcherOverride ?? defaultFetchJwks;

  if (!Array.isArray(clientIds) || clientIds.length === 0) {
    throw new GoogleTokenError('Google sign-in is not configured');
  }
  if (typeof idToken !== 'string' || idToken.length === 0 || idToken.length > 8192) {
    throw new GoogleTokenError('ID token is missing or malformed');
  }

  const parts = idToken.split('.');
  if (parts.length !== 3) throw new GoogleTokenError('ID token is not a JWT');
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; kid?: string };
  let payload: GoogleIdTokenPayload;
  try {
    header = JSON.parse(base64UrlToBuffer(headerB64).toString('utf8'));
    payload = JSON.parse(base64UrlToBuffer(payloadB64).toString('utf8'));
  } catch {
    throw new GoogleTokenError('ID token segments are not valid JSON');
  }

  if (!header || header.alg !== 'RS256') {
    throw new GoogleTokenError('Unexpected token algorithm');
  }
  if (!payload || typeof payload !== 'object') {
    throw new GoogleTokenError('ID token payload is malformed');
  }

  const nowMs = Date.now();
  const jwk = await resolveJwk(header.kid, jwksUrl, fetchJwks, nowMs);
  if (!jwk.n || !jwk.e) throw new GoogleTokenError('Google JWKS key is incomplete');

  let publicKey: crypto.KeyObject;
  try {
    publicKey = crypto.createPublicKey({
      key: { kty: 'RSA', n: jwk.n, e: jwk.e } as crypto.JsonWebKey,
      format: 'jwk',
    });
  } catch {
    throw new GoogleTokenError('Google JWKS key could not be loaded');
  }

  const verified = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${headerB64}.${payloadB64}`, 'utf8'),
    publicKey,
    base64UrlToBuffer(signatureB64),
  );
  if (!verified) throw new GoogleTokenError('ID token signature is invalid');

  // Issuer: Google uses both spellings.
  if (typeof payload.iss !== 'string' || !GOOGLE_ISSUERS.has(payload.iss)) {
    throw new GoogleTokenError('ID token issuer is not trusted');
  }

  // Audience must match a configured OAuth client ID exactly.
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.some((aud) => typeof aud === 'string' && clientIds.includes(aud))) {
    throw new GoogleTokenError('ID token audience is not accepted');
  }

  // Expiry (with small leeway). Missing exp is rejected.
  if (typeof payload.exp !== 'number' || payload.exp + leewaySeconds <= Math.floor(nowMs / 1000)) {
    throw new GoogleTokenError('ID token has expired');
  }

  // Identity claims.
  if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 255) {
    throw new GoogleTokenError('ID token subject is missing');
  }
  if (typeof payload.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    throw new GoogleTokenError('ID token email claim is missing or malformed');
  }
  if (payload.email_verified !== true) {
    throw new GoogleTokenError('ID token email is not verified');
  }

  return payload;
}

/** Constant-time comparison for the Google `sub` bound to a provisioned account. */
export function googleSubMatches(storedSub: string, presentedSub: string): boolean {
  return safeEqualStrings(storedSub, presentedSub);
}


const DEFAULT_LEEWAY_SECONDS = 60;
const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;

interface JwksCacheEntry {
  fetchedAt: number;
  jwks: GoogleJwks;
}

const jwksCache = new Map<string, JwksCacheEntry>();

/** Test hook: clears the module-level JWKS cache between test cases. */
export function clearGoogleJwksCache(): void {
  jwksCache.clear();
}

let jwksFetcherOverride: GoogleJwksFetcher | undefined;

/** Test hook: replaces the network JWKS fetcher (pass undefined to restore). */
export function setGoogleJwksFetcherForTests(fetcher?: GoogleJwksFetcher): void {
  jwksFetcherOverride = fetcher;
}

async function defaultFetchJwks(url: string): Promise<GoogleJwks> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    // Bound the request so a hanging Google endpoint cannot stall auth.
    signal: AbortSignal.timeout(8000),
  } as RequestInit);
  if (!response.ok) {
    throw new GoogleTokenError(`JWKS fetch failed with HTTP ${response.status}`);
  }
  const body = (await response.json()) as GoogleJwks;
  if (!body || !Array.isArray(body.keys)) {
    throw new GoogleTokenError('JWKS response is malformed');
  }
  return body;
}

function base64UrlToBuffer(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
