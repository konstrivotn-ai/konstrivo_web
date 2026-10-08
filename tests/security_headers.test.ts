import { apiRequest, startTestServer } from './setup';
import { test, ok } from './run';

export async function runSecurityHeadersTests() {
  await test('Security headers present in dev (relaxed)', async () => {
    const prev = { NODE_ENV: process.env.NODE_ENV };
    process.env.NODE_ENV = 'test';
    const server = await startTestServer();
    try {
      const res = await apiRequest(server.baseUrl, 'GET', '/api/health');
      ok(res.headers['x-frame-options'] === 'DENY');
      ok(res.headers['x-content-type-options'] === 'nosniff');
      ok(res.headers['content-security-policy']);
    } finally {
      await server.close();
      process.env.NODE_ENV = prev.NODE_ENV || '';
    }
  });

  await test('Security headers in production include HSTS and strict CSP', async () => {
    const prev = { NODE_ENV: process.env.NODE_ENV, CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS };
    process.env.NODE_ENV = 'production';
    process.env.CORS_ALLOWED_ORIGINS = 'http://allowed.example';
    const server = await startTestServer();
    try {
      const res = await apiRequest(server.baseUrl, 'GET', '/api/health');
      ok(res.headers['strict-transport-security']?.includes('max-age'));
      const csp = res.headers['content-security-policy'];
      ok(csp && csp.includes("default-src 'self'"));
      ok(!csp?.includes('unsafe-eval'));
    } finally {
      await server.close();
      process.env.NODE_ENV = prev.NODE_ENV || '';
      process.env.CORS_ALLOWED_ORIGINS = prev.CORS_ALLOWED_ORIGINS;
    }
  });
}
