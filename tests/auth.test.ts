/**
 * Phase 2 — Authentication Tests
 */
import { apiRequest } from './setup';
import { test, assertEq, ok, ctx } from './run';

export async function runAuthTests() {
  console.log('🔐 Authentication Tests\n');

  await test('register creates user + company + token', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/register', {
      body: {
        email: 'free@test.tn',
        password: 'password123',
        fullName: 'Free User',
        phone: '+21600000001',
        companyName: 'Free Co',
        role: 'artisan',
      },
    });
    assertEq(res.status, 201);
    ok(res.body.user, 'user should exist in response');
    ok(res.body.company, 'company should exist in response');
    ok(res.body.token, 'token should be returned');
    ok(!res.body.user.passwordHash, 'passwordHash must NOT be exposed');
    ctx.freeToken = res.body.token;
    ctx.freeCompanyId = res.body.company.id;
  });

  await test('duplicate email registration → 409 (case-insensitive)', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/register', {
      body: { email: 'FREE@TEST.TN', password: 'password123', fullName: 'Dup' },
    });
    assertEq(res.status, 409);
  });

  await test('register with invalid password → 400/422', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/register', {
      body: { email: 'short@test.tn', password: '123', fullName: 'Shorty' },
    });
    ok([400, 422].includes(res.status), `expected 400 or 422, got ${res.status}`);
  });

  await test('login success returns token', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/login', {
      body: { email: 'free@test.tn', password: 'password123' },
    });
    assertEq(res.status, 200);
    ok(res.body.token);
  });

  await test('login invalid password → 401', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/login', {
      body: { email: 'free@test.tn', password: 'WRONG_PASSWORD' },
    });
    assertEq(res.status, 401);
  });

  await test('suspended user cannot login → 403', async () => {
    const regRes = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/register', {
      body: { email: 'suspended@test.tn', password: 'password123', fullName: 'Suspended User' },
    });
    ok(regRes.status === 201 || regRes.status === 200);

    const { userRepository } = await import('../server/repositories/userRepository');
    const user = (await userRepository.findByEmail('suspended@test.tn'))!;
    await userRepository.setStatus(user.id, 'suspended');

    const loginRes = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/login', {
      body: { email: 'suspended@test.tn', password: 'password123' },
    });
    assertEq(loginRes.status, 403);
  });

  await test('/users/me with valid token works', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/users/me', {
      token: ctx.freeToken,
    });
    assertEq(res.status, 200);
    ok(res.body.user.email === 'free@test.tn');
    ok(Array.isArray(res.body.entitlements));
  });

  await test('/users/me with invalid token → 401', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/users/me', {
      token: 'invalid.jwt.token',
    });
    assertEq(res.status, 401);
  });

  await test('/users/me without token → 401', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/users/me');
    assertEq(res.status, 401);
  });

  await test('auth refresh rotates token', async () => {
    const loginRes = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/login', {
      body: { email: 'free@test.tn', password: 'password123' },
    });
    ok(loginRes.body.refreshToken);
    const refreshRes = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/refresh', {
      token: loginRes.body.refreshToken,
    });
    assertEq(refreshRes.status, 200);
    ok(refreshRes.body.token, 'new token should be returned');
  });

  await test('setup: engineer role starts FREE (role ≠ plan); PRO comes from subscription only', async () => {
    const regRes = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/register', {
      body: {
        email: 'pro@test.tn',
        password: 'password123',
        fullName: 'Pro User',
        role: 'ingenieur',
        companyName: 'Pro Engineering',
      },
    });
    assertEq(regRes.status, 201);

    // Phase F role/plan split: registering as engineer must NOT grant PRO —
    // the account and its token start FREE. Role keeps engineer RBAC only.
    const { decodeJWT } = await import('../server/utils/crypto');
    const regClaims = decodeJWT(regRes.body.token) as any;
    assertEq(regClaims.tier, 'FREE');
    assertEq(regClaims.role, 'ingenieur');

    const companyId = regRes.body.company.id;
    // Real PRO = active PRO subscription (PostgreSQL — same repo PaymentService
    // writes to), NOT a registration role.
    const { subscriptionRepositoryAsync } = await import('../server/repositories/subscriptionRepository');
    await subscriptionRepositoryAsync.create(companyId, 'PRO');

    // Issue a PRO token the exact same way the server issues tokens (signed
    // with the configured JWT secret + PRO claims), representing the user with
    // an active PRO subscription. Downstream PRO-gated tests keep their meaning.
    const { config } = await import('../server/config');
    const { signJWT } = await import('../server/utils/crypto');
    const { computeEntitlements } = await import('../server/utils/permissions');
    ctx.proToken = signJWT(
      {
        uid: regRes.body.user.id,
        companyId,
        role: regRes.body.user.role,
        tier: 'PRO',
        entitlements: computeEntitlements(regRes.body.user.role, 'PRO'),
      } as never,
      config.jwtSecret,
      config.jwtExpiresInSeconds,
    );
    ctx.proCompanyId = companyId;
  });

  await test('register with role=admin → 400/422 (admin registration blocked)', async () => {
    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/register', {
      body: {
        email: 'admin@test.tn',
        password: 'password123',
        fullName: 'Admin User',
        role: 'admin',
        companyName: 'Admin HQ',
      },
    });
    ok([400, 422].includes(res.status), `expected 400 or 422 for admin registration, got ${res.status}`);
  });

  // ── Phase 1.1: real PostgreSQL admin via secure bootstrap ────────────────

  await test('Phase 1.1: admin bootstrap from env → login as real admin', async () => {
    // Test-only credentials supplied via env vars — exactly how production
    // bootstrap works (no hardcoded admin secrets in source code).
    process.env.ADMIN_EMAIL = 'admin@test.tn';
    process.env.ADMIN_PASSWORD = 'bootstrap-admin-pass-2026';
    // This suite runs inside the guarded test harness, so explicitly opt in to
    // the test-only bootstrap path against TEST_DATABASE_URL.
    process.env.ADMIN_BOOTSTRAP_FORCE = '1';
    const { bootstrapAdmin } = await import('../server/bootstrap');
    await bootstrapAdmin();

    const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/login', {
      body: { email: 'admin@test.tn', password: 'bootstrap-admin-pass-2026' },
    });
    assertEq(res.status, 200);
    assertEq(res.body.user.role, 'admin');
    ctx.adminToken = res.body.token;

    // /users/me must return the real admin from PostgreSQL
    const meRes = await apiRequest(ctx.server!.baseUrl, 'GET', '/api/v1/users/me', {
      token: res.body.token,
    });
    assertEq(meRes.status, 200);
    assertEq(meRes.body.user.role, 'admin');
  });

  await test('Phase 1.1: admin bootstrap is idempotent → no duplicate admin', async () => {
    const { bootstrapAdmin } = await import('../server/bootstrap');
    await bootstrapAdmin(); // second call must be a safe no-op
    const { userRepository } = await import('../server/repositories/userRepository');
    const admin = await userRepository.findByEmail('admin@test.tn');
    ok(!!admin, 'admin must still exist after repeated bootstrap');
    assertEq(admin!.role, 'admin');
  });
}
