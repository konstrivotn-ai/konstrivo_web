import { apiRequest, startTestServer } from './setup';
import { test, ok, assertEq } from './run';

export async function runCorsTests() {
  await test('CORS - production allows configured origin', async () => {
    const prevEnv = { NODE_ENV: process.env.NODE_ENV, CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS };
    process.env.NODE_ENV = 'production';
    process.env.CORS_ALLOWED_ORIGINS = 'http://allowed.example';

    const server = await startTestServer();
    try {
      const origin = 'http://allowed.example';
      const res = await apiRequest(server.baseUrl, 'OPTIONS', '/api/health', { headers: { Origin: origin } });
      // Access-Control-Allow-Origin should equal the allowed origin
      assertEq(res.headers['access-control-allow-origin'], origin, 'allowed origin should be reflected');
    } finally {
      await server.close();
      process.env.NODE_ENV = prevEnv.NODE_ENV || '';
      process.env.CORS_ALLOWED_ORIGINS = prevEnv.CORS_ALLOWED_ORIGINS;
    }
  });

  await test('CORS - production rejects non-configured origin', async () => {
    const prevEnv = { NODE_ENV: process.env.NODE_ENV, CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS };
    process.env.NODE_ENV = 'production';
    process.env.CORS_ALLOWED_ORIGINS = 'http://allowed.example';

    const server = await startTestServer();
    try {
      const origin = 'http://evil.example';
      const res = await apiRequest(server.baseUrl, 'OPTIONS', '/api/health', { headers: { Origin: origin } });
      // Disallowed origin should NOT get Access-Control-Allow-Origin
      ok(!res.headers['access-control-allow-origin'], 'disallowed origin must not receive AC-Allow-Origin');
    } finally {
      await server.close();
      process.env.NODE_ENV = prevEnv.NODE_ENV || '';
      process.env.CORS_ALLOWED_ORIGINS = prevEnv.CORS_ALLOWED_ORIGINS;
    }
  });

  await test('CORS - dev/test reflects origin and does not break tests', async () => {
    const prevEnv = { NODE_ENV: process.env.NODE_ENV };
    process.env.NODE_ENV = 'test';

    const server = await startTestServer();
    try {
      const origin = 'http://dev.example';
      const res = await apiRequest(server.baseUrl, 'OPTIONS', '/api/health', { headers: { Origin: origin } });
      assertEq(res.headers['access-control-allow-origin'], origin, 'dev should reflect origin');
    } finally {
      await server.close();
      process.env.NODE_ENV = prevEnv.NODE_ENV || '';
    }
  });
}
