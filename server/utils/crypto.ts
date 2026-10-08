/**
 * Phase 2 + Phase 3 — Crypto Utilities
 *
 * Uses ONLY Node.js built-in `crypto` module.
 * No external JWT or bcrypt dependencies required.
 *
 * - JWT: HMAC-SHA256 (RFC 7519 profile)
 * - Password hashing: scrypt (NAGILENT / RFC 7914)
 * - SHA-256 file hashing
 * - UUID v4 generation
 */
import crypto from 'crypto';

// ── UUID ───────────────────────────────────────────────────────────────────

export function generateId(): string {
  return crypto.randomUUID();
}

// ── Password hashing (scrypt) ──────────────────────────────────────────────
// Format: scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>
// This is self-describing and verifiable.

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;
const DIGEST = 'sha256';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_LEN);
  const hash = crypto.scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function comparePassword(password: string, storedHash: string): boolean {
  try {
    const parts = storedHash.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = parseInt(parts[1], 10);
    const r = parseInt(parts[2], 10);
    const p = parseInt(parts[3], 10);
    const salt = Buffer.from(parts[4], 'hex');
    const expectedHash = Buffer.from(parts[5], 'hex');
    const hash = crypto.scryptSync(password, salt, expectedHash.length, {
      N, r, p,
    });
    return crypto.timingSafeEqual(hash, expectedHash);
  } catch {
    return false;
  }
}

// ── JWT (minimal HMAC-SHA256) ──────────────────────────────────────────────

function base64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlDecode(str: string): Buffer {
  const padded = str + '=='.slice(0, (4 - (str.length % 4)) % 4);
  const b64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

export interface JwtPayload {
  [key: string]: any;
}

export function signJWT(payload: JwtPayload, secret: string, expiresInSeconds: number): string {
  const header = base64urlEncode(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const payloadEncoded = base64urlEncode(Buffer.from(JSON.stringify(body)));
  const signingInput = `${header}.${payloadEncoded}`;
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest();
  const sigEncoded = base64urlEncode(signature);
  return `${signingInput}.${sigEncoded}`;
}

export function verifyJWT(token: string, secret: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;
    const expectedSig = crypto.createHmac('sha256', secret).update(signingInput).digest();
    const providedSig = base64urlDecode(sigB64);
    if (!crypto.timingSafeEqual(expectedSig, providedSig)) return null;

    const header = JSON.parse(base64urlDecode(headerB64).toString());
    if (header.alg !== 'HS256') return null;

    const payload = JSON.parse(base64urlDecode(payloadB64).toString());
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && now >= payload.exp) return null;
    if (payload.iat && now < payload.iat) return null;
    return payload;
  } catch {
    return null;
  }
}

export function decodeJWT(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(base64urlDecode(parts[1]).toString());
    return payload;
  } catch {
    return null;
  }
}

// ── SHA-256 ────────────────────────────────────────────────────────────────

export function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// ── Timing-safe string comparison ─────────────────────────────────────────

export function safeEqual(a: string, b: string): boolean {
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}
