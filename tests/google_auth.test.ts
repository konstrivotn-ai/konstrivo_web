/**
 * Google sign-in API tests (DB-free compatible — runs in memory mode).
 *
 * Real RS256 signatures are produced with a locally generated RSA key pair;
 * the JWKS fetcher is injected so no network access is required. Coverage:
 * token validation (signature/iss/aud/exp/email_verified), safe provisioning,
 * repeat sign-in without duplicates, password-account conflict (no silent
 * merge), sub binding against recycled emails, role never elevated, and the
 * fail-closed 503 when Google auth is not configured.
 */
import crypto from 'node:crypto';
import { test, ok, assertEq, ctx } from './run';
import { apiRequest } from './setup';

const TEST_CLIENT_ID = 'konstrivo-test-client.apps.googleusercontent.com';
const TEST_KID = 'konstrivo-test-key';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' }) as crypto.JsonWebKey & { kty: string; n: string; e: string };
const TEST_JWKS = { keys: [{ ...jwk, kid: TEST_KID, alg: 'RS256', use: 'sig' }] };

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signGoogleToken(payload: Record<string, unknown>, headerOverride?: Record<string, unknown>): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: TEST_KID, ...(headerOverride || {}) })));
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${body}`), privateKey);
  return `${header}.${body}.${b64url(sig)}`;
}

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: 'https://accounts.google.com',
    sub: 'google-sub-1000000000000001',
    aud: TEST_CLIENT_ID,
    email: 'konstrivo.google.test.user@example.test',
    email_verified: true,
    name: 'Google Test User',
    iat: now - 60,
    exp: now + 600,
    ...overrides,
  };
}

export async function runGoogleAuthTests() {
  console.log('\n🔐 Google Auth Tests\n');
  const { setGoogleJwksFetcherForTests, clearGoogleJwksCache, GOOGLE_PASSWORD_MARKER_PREFIX } =
    await import('../server/services/googleAuth');

  setGoogleJwksFetcherForTests(async () => TEST_JWKS as any);
  const previousClientIds = process.env.GOOGLE_AUTH_CLIENT_IDS;
  process.env.GOOGLE_AUTH_CLIENT_IDS = TEST_CLIENT_ID;

  try {
    await test('google: unconfigured client IDs -> 503 fail-closed', async () => {
      delete process.env.GOOGLE_AUTH_CLIENT_IDS;
      try {
        const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/google', {
          body: { idToken: signGoogleToken(validClaims()) },
        });
        assertEq(res.status, 503);
        ok(JSON.stringify(res.body).includes('not configured'), 'message says not configured');
      } finally {
        process.env.GOOGLE_AUTH_CLIENT_IDS = TEST_CLIENT_ID;
      }
    });

    await test('google: missing idToken -> 400', async () => {
      const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/google', { body: {} });
      assertEq(res.status, 400);
    });

    await test('google: valid token provisions a NEW artisan account (never admin)', async () => {
      clearGoogleJwksCache();
      const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/google', {
        body: { idToken: signGoogleToken(validClaims()) },
      });
      assertEq(res.status, 201);
      ok(res.body.user, 'user returned');
      ok(res.body.token, 'access token returned');
      ok(res.body.refreshToken, 'refresh token returned');
      assertEq(res.body.user.email, 'konstrivo.google.test.user@example.test');
      assertEq(res.body.user.role, 'artisan', 'provisioned role is artisan');
      assertEq(res.body.user.fullName, 'Google Test User');
      ok(!('passwordHash' in res.body.user), 'password hash never exposed');

      // Backend-validated identity: /users/me with the returned token.
      const me = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/users/me', {
        headers: { Authorization: `Bearer ${res.body.token}` },
      });
      assertEq(me.status, 200);
      assertEq(me.body.user.role, 'artisan', 'role stays artisan after validation');

      // The stored credential is the unusable Google marker.
      const { userRepository } = await import('../server/repositories/userRepository');
      const stored = await userRepository.findByEmail('konstrivo.google.test.user@example.test');
      ok(stored && stored.passwordHash.startsWith(GOOGLE_PASSWORD_MARKER_PREFIX), 'marker stored');
    });

    await test('google: repeat sign-in returns SAME account (no duplicate)', async () => {
      const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/google', {
        body: { idToken: signGoogleToken(validClaims()) },
      });
      assertEq(res.status, 200, 'second sign-in is a login, not a re-provision');
      assertEq(res.body.user.email, 'konstrivo.google.test.user@example.test');

      const { userRepository } = await import('../server/repositories/userRepository');
      const stored = await userRepository.findByEmail('konstrivo.google.test.user@example.test');
      ok(stored, 'still exactly one account for the email');
    });

    await test('google: provisioned account cannot sign in with a password', async () => {
      const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/login', {
        body: { email: 'konstrivo.google.test.user@example.test', password: 'anypassword123' },
      });
      assertEq(res.status, 401, 'marker hash never verifies as a password');
    });

    await test('google: existing PASSWORD account -> 409, never silently merged', async () => {
      const email = 'konstrivo.password.account.test@example.test';
      const reg = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/register', {
        body: { email, password: 'password12345', fullName: 'Password Account' },
      });
      assertEq(reg.status, 201);

      const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/google', {
        body: { idToken: signGoogleToken(validClaims({ email, sub: 'google-sub-password-conflict' })) },
      });
      assertEq(res.status, 409, 'password accounts are never merged with Google');
    });

    await test('google: recycled email with different sub -> 403 (sub binding)', async () => {
      const email = 'konstrivo.recycled.email.test@example.test';
      const first = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/google', {
        body: { idToken: signGoogleToken(validClaims({ email, sub: 'google-sub-original-owner' })) },
      });
      assertEq(first.status, 201);

      const takeover = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/google', {
        body: { idToken: signGoogleToken(validClaims({ email, sub: 'google-sub-different-person' })) },
      });
      assertEq(takeover.status, 403, 'different Google sub can never take over the account');
    });

    await test('google: wrong audience -> 401', async () => {
      const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/google', {
        body: { idToken: signGoogleToken(validClaims({ aud: 'someone-elses-client.apps.googleusercontent.com' })) },
      });
      assertEq(res.status, 401);
    });

    await test('google: wrong issuer -> 401', async () => {
      const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/google', {
        body: { idToken: signGoogleToken(validClaims({ iss: 'https://evil.example.com' })) },
      });
      assertEq(res.status, 401);
    });

    await test('google: expired token -> 401', async () => {
      const now = Math.floor(Date.now() / 1000);
      const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/google', {
        body: { idToken: signGoogleToken(validClaims({ iat: now - 7200, exp: now - 3600 })) },
      });
      assertEq(res.status, 401);
    });

    await test('google: unverified email -> 401', async () => {
      const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/google', {
        body: { idToken: signGoogleToken(validClaims({ email: 'unverified.test@example.test', email_verified: false })) },
      });
      assertEq(res.status, 401);
    });

    await test('google: tampered payload (bad signature) -> 401', async () => {
      const token = signGoogleToken(validClaims());
      const [h, , s] = token.split('.');
      const tamperedPayload = b64url(Buffer.from(JSON.stringify({
        ...validClaims({ email: 'tampered.test@example.test' }),
      })));
      const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/google', {
        body: { idToken: `${h}.${tamperedPayload}.${s}` },
      });
      assertEq(res.status, 401);
    });

    await test('google: garbage token -> 401', async () => {
      const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/google', {
        body: { idToken: 'not-a-jwt' },
      });
      assertEq(res.status, 401);
    });

    await test('google: non-RS256 algorithm is rejected', async () => {
      const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/google', {
        body: { idToken: signGoogleToken(validClaims(), { alg: 'HS256' }) },
      });
      assertEq(res.status, 401);
    });

    await test('google: suspended account -> 403', async () => {
      const email = 'konstrivo.suspended.google.test@example.test';
      const first = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/google', {
        body: { idToken: signGoogleToken(validClaims({ email, sub: 'google-sub-suspended' })) },
      });
      assertEq(first.status, 201);
      const { userRepository } = await import('../server/repositories/userRepository');
      const user = await userRepository.findByEmail(email);
      await userRepository.setStatus(user!.id, 'suspended');
      const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/google', {
        body: { idToken: signGoogleToken(validClaims({ email, sub: 'google-sub-suspended' })) },
      });
      assertEq(res.status, 403);
    });
  } finally {
    setGoogleJwksFetcherForTests(undefined);
    if (previousClientIds !== undefined) process.env.GOOGLE_AUTH_CLIENT_IDS = previousClientIds;
    else delete process.env.GOOGLE_AUTH_CLIENT_IDS;
  }
}


