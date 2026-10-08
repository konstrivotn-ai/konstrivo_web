import { test, ok, assertEq } from './run';

export async function runTestDatabaseConfigTests() {
  console.log('\n🧪 Test database config guard tests\n');

  await test('test config accepts separate TEST_DATABASE_URL', async () => {
    const prevNode = process.env.NODE_ENV;
    const prevProd = process.env.DATABASE_URL;
    const prevTest = process.env.TEST_DATABASE_URL;

    try {
      process.env.NODE_ENV = 'test';
      process.env.DATABASE_URL = 'postgresql://prod.example/db';
      process.env.TEST_DATABASE_URL = 'postgresql://test.example/db';

      const { loadConfig } = await import('../server/config');
      const config = loadConfig();
      ok(config.databaseUrl === process.env.TEST_DATABASE_URL, 'test env should prefer TEST_DATABASE_URL');
      ok(config.testDatabaseUrl === process.env.TEST_DATABASE_URL, 'test config should expose TEST_DATABASE_URL');
    } finally {
      if (prevProd === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevProd;
      if (prevTest === undefined) delete process.env.TEST_DATABASE_URL; else process.env.TEST_DATABASE_URL = prevTest;
      process.env.NODE_ENV = prevNode || 'test';
    }
  });

  await test('test config rejects when TEST_DATABASE_URL matches DATABASE_URL', async () => {
    const prevNode = process.env.NODE_ENV;
    const prevProd = process.env.DATABASE_URL;
    const prevTest = process.env.TEST_DATABASE_URL;

    try {
      process.env.NODE_ENV = 'test';
      process.env.DATABASE_URL = 'postgresql://same.example/db';
      process.env.TEST_DATABASE_URL = 'postgresql://same.example/db';

      const { loadConfig } = await import('../server/config');
      let failed = false;
      try {
        loadConfig();
      } catch (err: any) {
        failed = true;
        ok(String(err.message).includes('must be different from DATABASE_URL'), 'same-value guard should trigger a clear error');
      }
      ok(failed, 'same-value guard should reject test config');
    } finally {
      if (prevProd === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevProd;
      if (prevTest === undefined) delete process.env.TEST_DATABASE_URL; else process.env.TEST_DATABASE_URL = prevTest;
      process.env.NODE_ENV = prevNode || 'test';
    }
  });

  await test('test config rejects absent TEST_DATABASE_URL', async () => {
    const prevNode = process.env.NODE_ENV;
    const prevProd = process.env.DATABASE_URL;
    const prevTest = process.env.TEST_DATABASE_URL;

    try {
      process.env.NODE_ENV = 'test';
      process.env.DATABASE_URL = 'postgresql://prod.example/db';
      delete process.env.TEST_DATABASE_URL;

      const { loadConfig } = await import('../server/config');
      let failed = false;
      try {
        loadConfig();
      } catch (err: any) {
        failed = true;
        ok(String(err.message).includes('TEST_DATABASE_URL is required'), 'missing TEST_DATABASE_URL should produce a clear error');
      }
      ok(failed, 'missing TEST_DATABASE_URL should reject test mode');
    } finally {
      if (prevProd === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevProd;
      if (prevTest === undefined) delete process.env.TEST_DATABASE_URL; else process.env.TEST_DATABASE_URL = prevTest;
      process.env.NODE_ENV = prevNode || 'test';
    }
  });

  await test('production still uses DATABASE_URL only', async () => {
    const prevNode = process.env.NODE_ENV;
    const prevProd = process.env.DATABASE_URL;
    const prevTest = process.env.TEST_DATABASE_URL;

    try {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://prod.example/db';
      process.env.TEST_DATABASE_URL = 'postgresql://test.example/db';

      const { loadConfig } = await import('../server/config');
      const config = loadConfig();
      ok(config.databaseUrl === process.env.DATABASE_URL, 'production config should stay on DATABASE_URL');
      ok(config.testDatabaseUrl === process.env.TEST_DATABASE_URL, 'test DB value may still be exposed in config but not used at runtime');
    } finally {
      if (prevProd === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevProd;
      if (prevTest === undefined) delete process.env.TEST_DATABASE_URL; else process.env.TEST_DATABASE_URL = prevTest;
      process.env.NODE_ENV = prevNode || 'test';
    }
  });
}
