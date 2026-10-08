require('dotenv/config');
const { execSync } = require('child_process');

if (!process.env.TEST_DATABASE_URL) {
  console.error('ERROR:TEST_DB_ENV_MISSING');
  process.exit(2);
}
process.env.TEST_DB_CONFIRM = '1';
// Do NOT set DATABASE_URL here; tests expect DATABASE_URL != TEST_DATABASE_URL.
// The server config selects TEST_DATABASE_URL when running the test runner.

try {
  execSync('npx tsx tests/runPhaseC.ts', { stdio: 'inherit', env: process.env });
} catch (e) {
  // propagate exit code
  process.exit(e.status || 1);
}
