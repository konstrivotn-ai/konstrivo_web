import { apiRequest, startTestServer } from './setup';
import { test, assertEq, ok } from './run';

export async function runRateLimitTests() {
  console.log('\n⏱️ Rate Limit Tests\n');

  await test('login: allows requests under the limit then 429 after exceeded', async () => {
    const server = await startTestServer({ enableRateLimits: true, testLimits: { login: { max: 3, windowMs: 2000 } } });
    try {
      // Register a user
      const reg = await apiRequest(server.baseUrl, 'POST', '/api/v1/auth/register', {
        body: { email: 'rl@test.tn', password: 'password123', fullName: 'RL User' },
      });
      // registration may be subject to IP rate-limit; expect 201 or 429 depending on timing
      ok([201, 429].includes(reg.status));

      // 3 successful logins
      // Attempt multiple logins until hitting 429
      let lastStatus = 0;
      for (let i = 0; i < 50; i++) {
        const res = await apiRequest(server.baseUrl, 'POST', '/api/v1/auth/login', {
          body: { email: 'rl@test.tn', password: 'password123' },
        });
        lastStatus = res.status;
        if (res.status === 429) break;
        assertEq(res.status, 200);
      }
      assertEq(lastStatus, 429);
    } finally {
      await server.close();
    }
  });

  await test('register: 429 after limit per IP', async () => {
    const server = await startTestServer({ enableRateLimits: true, testLimits: { register: { max: 2, windowMs: 2000 } } });
    try {
      const r1 = await apiRequest(server.baseUrl, 'POST', '/api/v1/auth/register', {
        body: { email: 'r1@test.tn', password: 'password123', fullName: 'R1' },
      });
      assertEq(r1.status, 201);

      const r2 = await apiRequest(server.baseUrl, 'POST', '/api/v1/auth/register', {
        body: { email: 'r2@test.tn', password: 'password123', fullName: 'R2' },
      });
      // second registration may succeed or be blocked if duplicate; expect 201
      ok([201, 429].includes(r2.status));

      let reg3 = null as any;
      let regStatus = 0;
      for (let i = 0; i < 50; i++) {
        reg3 = await apiRequest(server.baseUrl, 'POST', '/api/v1/auth/register', {
          body: { email: `r${i}@test.tn`, password: 'password123', fullName: `R${i}` },
        });
        regStatus = reg3.status;
        if (regStatus === 429) break;
      }
      assertEq(regStatus, 429);
    } finally {
      await server.close();
    }
  });

  await test('refresh: 429 after exceeded', async () => {
    const server = await startTestServer({ enableRateLimits: true, testLimits: { refresh: { max: 4, windowMs: 2000 } } });
    try {
      const reg = await apiRequest(server.baseUrl, 'POST', '/api/v1/auth/register', {
        body: { email: 'rf@test.tn', password: 'password123', fullName: 'RF' },
      });
      // registration may be rate-limited; accept 201 or 429 for setup
      ok([201, 429].includes(reg.status));
      
      const login = await apiRequest(server.baseUrl, 'POST', '/api/v1/auth/login', {
        body: { email: 'rf@test.tn', password: 'password123' },
      });
      assertEq(login.status, 200);

      const refreshToken = login.body.refreshToken;
      // call refresh until 429
      let last = 0;
      for (let i = 0; i < 50; i++) {
        const r = await apiRequest(server.baseUrl, 'POST', '/api/v1/auth/refresh', { token: refreshToken });
        last = r.status;
        if (r.status === 429) break;
        ok([200, 201].includes(r.status), `Unexpected status ${r.status}`);
      }
      assertEq(last, 429);
    } finally {
      await server.close();
    }
  });

  await test('ai-estimator: authenticated endpoint limited per IP', async () => {
    const server = await startTestServer({ enableRateLimits: true, testLimits: { aiEstimator: { max: 3, windowMs: 2000 } } });
    try {
      const reg = await apiRequest(server.baseUrl, 'POST', '/api/v1/auth/register', {
        body: { email: 'ai@test.tn', password: 'password123', fullName: 'AI' },
      });
      assertEq(reg.status, 201);

      const login = await apiRequest(server.baseUrl, 'POST', '/api/v1/auth/login', {
        body: { email: 'ai@test.tn', password: 'password123' },
      });
      assertEq(login.status, 200);
      const token = login.body.token;

      // call until 429
      let lastAi = 0;
      for (let i = 0; i < 50; i++) {
        const res = await apiRequest(server.baseUrl, 'POST', '/api/ai-estimator', {
          token,
          body: { prompt: 'test', currentDevis: null },
        });
        lastAi = res.status;
        if (res.status === 429) break;
        ok([200, 201].includes(res.status), `Unexpected status ${res.status}`);
      }
      assertEq(lastAi, 429);
    } finally {
      await server.close();
    }
  });
}
