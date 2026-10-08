import { test, ok, assertEq, ctx } from './run';
import { apiRequest } from './setup';

export async function runBootstrapTests() {
  console.log('\n🔐 Bootstrap Safety Tests\n');

  await test('production without ADMIN_BOOTSTRAP should NOT create admin', async () => {
    // Simulate production environment without explicit bootstrap flag
    const prevNode = process.env.NODE_ENV;
    const prevJwt = process.env.JWT_SECRET;
    const prevAdminEmail = process.env.ADMIN_EMAIL;
    const prevAdminPass = process.env.ADMIN_PASSWORD;
    const prevBootstrap = process.env.ADMIN_BOOTSTRAP;
    const prevBootstrapForce = process.env.ADMIN_BOOTSTRAP_FORCE;

    try {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = process.env.JWT_SECRET || '0123456789abcdef0123456789abcdef';
      process.env.ADMIN_EMAIL = 'prod-no-bootstrap@test.tn';
      process.env.ADMIN_PASSWORD = 'prodbootstrappass';
      delete process.env.ADMIN_BOOTSTRAP;
      delete process.env.ADMIN_BOOTSTRAP_FORCE;

      // Clear cached modules so config is re-evaluated under new NODE_ENV
      try { delete require.cache[require.resolve('../server/bootstrap')]; } catch {}
      try { delete require.cache[require.resolve('../server/config')]; } catch {}

      const { bootstrapAdmin } = await import('../server/bootstrap');
      await bootstrapAdmin();

      // Attempt login - should fail because admin was not created
      const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/login', { body: { email: 'prod-no-bootstrap@test.tn', password: 'prodbootstrappass' } });
      // We expect 401 or 404 (not found) depending on implementation
      ok([401, 404, 400].includes(res.status), `expected login to fail when bootstrap disabled, got ${res.status}`);
    } finally {
      process.env.NODE_ENV = prevNode;
      process.env.JWT_SECRET = prevJwt;
      process.env.ADMIN_EMAIL = prevAdminEmail;
      process.env.ADMIN_PASSWORD = prevAdminPass;
      process.env.ADMIN_BOOTSTRAP = prevBootstrap;
      process.env.ADMIN_BOOTSTRAP_FORCE = prevBootstrapForce;
    }
  });

  await test('production + localhost DB + ADMIN_BOOTSTRAP=1 does NOT require ADMIN_BOOTSTRAP_FORCE', async () => {
    const prevs = {
      NODE_ENV: process.env.NODE_ENV,
      JWT_SECRET: process.env.JWT_SECRET,
      ADMIN_EMAIL: process.env.ADMIN_EMAIL,
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
      ADMIN_BOOTSTRAP: process.env.ADMIN_BOOTSTRAP,
      ADMIN_BOOTSTRAP_FORCE: process.env.ADMIN_BOOTSTRAP_FORCE,
      DATABASE_URL: process.env.DATABASE_URL,
    };
    try {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = process.env.JWT_SECRET || '0123456789abcdef0123456789abcdef';
      process.env.ADMIN_EMAIL = 'prod-local-db@test.tn';
      process.env.ADMIN_PASSWORD = 'longpasswordprod001'; // >=16
      process.env.ADMIN_BOOTSTRAP = '1';
      delete process.env.ADMIN_BOOTSTRAP_FORCE;
      process.env.DATABASE_URL = 'postgres://localhost:5432/testdb';

      try { delete require.cache[require.resolve('../server/bootstrap')]; } catch {}
      try { delete require.cache[require.resolve('../server/config')]; } catch {}

      const { bootstrapAdmin } = await import('../server/bootstrap');
      await bootstrapAdmin();

      const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/login', { body: { email: 'prod-local-db@test.tn', password: 'longpasswordprod001' } });
      ok([200].includes(res.status), `expected login to succeed for local DB bootstrap, got ${res.status}`);
    } finally {
      Object.entries(prevs).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v as string; });
    }
  });

  await test('production + remote DB + ADMIN_BOOTSTRAP=1 requires ADMIN_BOOTSTRAP_FORCE=1', async () => {
    const prevs = {
      NODE_ENV: process.env.NODE_ENV,
      JWT_SECRET: process.env.JWT_SECRET,
      ADMIN_EMAIL: process.env.ADMIN_EMAIL,
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
      ADMIN_BOOTSTRAP: process.env.ADMIN_BOOTSTRAP,
      ADMIN_BOOTSTRAP_FORCE: process.env.ADMIN_BOOTSTRAP_FORCE,
      DATABASE_URL: process.env.DATABASE_URL,
    };
    try {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = process.env.JWT_SECRET || '0123456789abcdef0123456789abcdef';
      process.env.ADMIN_EMAIL = 'prod-remote-db@test.tn';
      process.env.ADMIN_PASSWORD = 'longpasswordprod002'; // >=16
      process.env.ADMIN_BOOTSTRAP = '1';
      delete process.env.ADMIN_BOOTSTRAP_FORCE;
      process.env.DATABASE_URL = 'postgres://remote.example.com:5432/proddb';

      try { delete require.cache[require.resolve('../server/bootstrap')]; } catch {}
      try { delete require.cache[require.resolve('../server/config')]; } catch {}

      const { bootstrapAdmin } = await import('../server/bootstrap');
      await bootstrapAdmin();

      // Should NOT have created admin because FORCE is missing
      const res1 = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/login', { body: { email: 'prod-remote-db@test.tn', password: 'longpasswordprod002' } });
      ok([401, 404, 400].includes(res1.status), `expected login to fail without ADMIN_BOOTSTRAP_FORCE, got ${res1.status}`);

      // Now enable FORCE and retry
      process.env.ADMIN_BOOTSTRAP_FORCE = '1';
      try { delete require.cache[require.resolve('../server/bootstrap')]; } catch {}
      const { bootstrapAdmin: bootstrapAdmin2 } = await import('../server/bootstrap');
      await bootstrapAdmin2();
      const res2 = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/login', { body: { email: 'prod-remote-db@test.tn', password: 'longpasswordprod002' } });
      ok([200].includes(res2.status), `expected login to succeed after ADMIN_BOOTSTRAP_FORCE, got ${res2.status}`);
    } finally {
      Object.entries(prevs).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v as string; });
    }
  });

  await test('production + weak ADMIN_PASSWORD (<16) is rejected', async () => {
    const prevs = {
      NODE_ENV: process.env.NODE_ENV,
      JWT_SECRET: process.env.JWT_SECRET,
      ADMIN_EMAIL: process.env.ADMIN_EMAIL,
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
      ADMIN_BOOTSTRAP: process.env.ADMIN_BOOTSTRAP,
      ADMIN_BOOTSTRAP_FORCE: process.env.ADMIN_BOOTSTRAP_FORCE,
      DATABASE_URL: process.env.DATABASE_URL,
    };
    try {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = process.env.JWT_SECRET || '0123456789abcdef0123456789abcdef';
      process.env.ADMIN_EMAIL = 'prod-weak-pass@test.tn';
      process.env.ADMIN_PASSWORD = 'shortpass'; // <16
      process.env.ADMIN_BOOTSTRAP = '1';
      process.env.ADMIN_BOOTSTRAP_FORCE = '1';
      process.env.DATABASE_URL = 'postgres://localhost:5432/testdb';

      try { delete require.cache[require.resolve('../server/bootstrap')]; } catch {}
      try { delete require.cache[require.resolve('../server/config')]; } catch {}

      const { bootstrapAdmin } = await import('../server/bootstrap');
      await bootstrapAdmin();

      const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/login', { body: { email: 'prod-weak-pass@test.tn', password: 'shortpass' } });
      ok([401, 404, 400].includes(res.status), `expected login to fail for weak password, got ${res.status}`);
    } finally {
      Object.entries(prevs).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v as string; });
    }
  });

  await test('production + valid ADMIN_PASSWORD (>=16) accepted when flags present', async () => {
    const prevs = {
      NODE_ENV: process.env.NODE_ENV,
      JWT_SECRET: process.env.JWT_SECRET,
      ADMIN_EMAIL: process.env.ADMIN_EMAIL,
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
      ADMIN_BOOTSTRAP: process.env.ADMIN_BOOTSTRAP,
      ADMIN_BOOTSTRAP_FORCE: process.env.ADMIN_BOOTSTRAP_FORCE,
      DATABASE_URL: process.env.DATABASE_URL,
    };
    try {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = process.env.JWT_SECRET || '0123456789abcdef0123456789abcdef';
      process.env.ADMIN_EMAIL = 'prod-valid-pass@test.tn';
      process.env.ADMIN_PASSWORD = 'verylongsecurepassword01'; // >=16
      process.env.ADMIN_BOOTSTRAP = '1';
      process.env.ADMIN_BOOTSTRAP_FORCE = '1';
      process.env.DATABASE_URL = 'postgres://remote.example.com:5432/proddb';

      try { delete require.cache[require.resolve('../server/bootstrap')]; } catch {}
      try { delete require.cache[require.resolve('../server/config')]; } catch {}

      const { bootstrapAdmin } = await import('../server/bootstrap');
      await bootstrapAdmin();

      const res = await apiRequest(ctx.server!.baseUrl, 'POST', '/api/v1/auth/login', { body: { email: 'prod-valid-pass@test.tn', password: 'verylongsecurepassword01' } });
      ok([200].includes(res.status), `expected login to succeed for valid password with flags, got ${res.status}`);
    } finally {
      Object.entries(prevs).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v as string; });
    }
  });
  // (env restored inside individual tests)
}
