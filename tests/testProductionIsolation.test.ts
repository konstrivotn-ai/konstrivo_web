/**
 * TEST / PRODUCTION ISOLATION — guards (DB-free, no connection is opened).
 *
 * Run: npx tsx tests/testProductionIsolation.test.ts
 *
 * Covers the fix for the documented incident where a test harness reached the
 * production Supabase database because the bootstrap guards were gated on
 * `cfg.isProduction` (a NODE_ENV check) instead of on the resolved DB target.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { evaluateBootstrapGuard, isLocalDatabaseUrl } from '../server/bootstrap';

const read = (...p: string[]) => readFileSync(resolvePath(process.cwd(), ...p), 'utf8');
const guard = (o: any) => evaluateBootstrapGuard({
  isHarness: false, isLocalDb: false, isProduction: false,
  adminPasswordLength: 20, env: {}, ...o,
});

// ── Local vs remote target detection ─────────────────────────────────────────

test('isolation: the resolved database target is classified as local or remote', () => {
  for (const u of ['postgresql://u:p@localhost:5432/k', 'postgresql://x@127.0.0.1:5432/db', 'postgresql://x@host.docker.internal/db']) {
    assert.equal(isLocalDatabaseUrl(u), true, `${u} must be local`);
  }
  for (const u of ['postgresql://u:p@db.abcdefg.supabase.co:5432/postgres', 'postgresql://x@db.neon.tech/db', undefined, '']) {
    assert.equal(isLocalDatabaseUrl(u as any), false, `${String(u)} must be remote`);
  }
});

// ── The regression: NODE_ENV must no longer be what protects production ──────

test('isolation: a test harness can NEVER bootstrap, whatever NODE_ENV says', () => {
  for (const isProduction of [false, true]) {
    for (const isLocalDb of [true, false]) {
      for (const env of [{}, { ADMIN_BOOTSTRAP: '1' }]) {
        const r = guard({ isHarness: true, isProduction, isLocalDb, env });
        assert.equal(r.allowed, false, `harness must be refused (prod=${isProduction} local=${isLocalDb})`);
        assert.equal(r.reason, 'test-harness');
      }
    }
  }
  assert.equal(guard({ isHarness: true, isLocalDb: true, env: { ADMIN_BOOTSTRAP_FORCE: '1' } }).allowed, true);
});

test('isolation: a REMOTE database requires an explicit opt-in even outside production', () => {
  // The exact hole: NODE_ENV undefined / "development" used to skip every
  // guard and could write to production.
  assert.equal(guard({ isLocalDb: false }).reason, 'remote-db-not-opted-in');
  assert.equal(guard({ isLocalDb: false, env: { NODE_ENV: 'development' } }).reason, 'remote-db-not-opted-in');
  assert.equal(guard({ isLocalDb: false, env: { NODE_ENV: 'test' } }).reason, 'remote-db-not-opted-in');
  assert.equal(guard({ isLocalDb: false, env: { ADMIN_BOOTSTRAP: '1' } }).allowed, true);
});


// ── Production semantics are unchanged ───────────────────────────────────────

test('isolation: production rules are preserved (opt-in, force, strong password)', () => {
  assert.equal(guard({ isLocalDb: true, isProduction: true }).reason, 'production-not-opted-in');
  assert.equal(guard({ isLocalDb: true, isProduction: true, env: { ADMIN_BOOTSTRAP: '1' } }).allowed, true);
  assert.equal(guard({ isLocalDb: false, isProduction: true, env: { ADMIN_BOOTSTRAP: '1' } }).reason, 'production-remote-not-forced');
  assert.equal(guard({ isLocalDb: false, isProduction: true, env: { ADMIN_BOOTSTRAP: '1', ADMIN_BOOTSTRAP_FORCE: '1' } }).allowed, true);
  assert.equal(
    guard({ isLocalDb: true, isProduction: true, env: { ADMIN_BOOTSTRAP: '1' }, adminPasswordLength: 8 }).reason,
    'weak-password',
  );
  assert.equal(guard({ isLocalDb: true, adminPasswordLength: 8 }).allowed, true, 'dev keeps the 8-char minimum');
});

// ── The marker cannot be faked by NODE_ENV ───────────────────────────────────

test('isolation: the harness marker is independent of NODE_ENV', () => {
  const g = read('tests', 'envGuard.ts');
  assert.ok(g.includes("process.env.KONSTRIVO_TEST_HARNESS = '1'"), 'the marker is set');
  assert.ok(!/DATABASE_URL\s*=/.test(g), 'the guard never rewrites DATABASE_URL');
  assert.ok(!/postgres|readFileSync/.test(g), 'the guard opens no connection and reads no file');

  const boot = read('server', 'bootstrap.ts');
  const client = read('server', 'db', 'client.ts');
  assert.ok(boot.includes("KONSTRIVO_TEST_HARNESS === '1'"), 'bootstrap keys off the marker, not NODE_ENV');
  assert.ok(client.includes("KONSTRIVO_TEST_HARNESS === '1'"), 'the db client keys off the marker');
});

// ── The connection-level guard is fail-closed ────────────────────────────────

test('isolation: a harness connection to a non-test database is refused', () => {
  const client = read('server', 'db', 'client.ts');
  assert.ok(client.includes('ABORTING: a test harness may not open a database connection'), 'the guard exists');
  assert.ok(client.includes('config.databaseUrl !== testDatabaseUrl'), 'it compares against the declared test URL');
  assert.ok(client.includes("KONSTRIVO_TEST_HARNESS === '1'"), 'it is harness-scoped so dev/prod are untouched');
});

// ── The marker is imported FIRST everywhere ──────────────────────────────────

test('isolation: every harness entry imports the guard before anything else', () => {
  for (const file of ['run.ts', 'setup.ts']) {
    const src = read('tests', file);
    // The FIRST real import STATEMENT (line-anchored), not the word "import"
    // inside a comment.
    const firstStatement = (src.match(/^import\s/m) || [])[0];
    assert.ok(firstStatement, `${file} has import statements`);
    const firstImportAt = src.search(/^import\s/m);
    const guardAt = src.search(/^import\s'\.\/envGuard';/m);
    assert.ok(guardAt > -1, `${file} imports ./envGuard`);
    assert.equal(guardAt, firstImportAt, `${file} must import ./envGuard FIRST (ESM order matters)`);
  }
});

// ── bootstrap no longer depends on NODE_ENV alone ────────────────────────────

test('isolation: bootstrap is no longer gated on cfg.isProduction alone', () => {
  const boot = read('server', 'bootstrap.ts');
  assert.ok(!/if \(cfg\.isProduction\) \{/.test(boot), 'no NODE_ENV-only gate remains');
  // Compare the CALL SITE inside bootstrapAdmin (not the exported definition).
  const existsAt = boot.indexOf('await drizzleUserRepository.findByEmail');
  const guardAt = boot.indexOf('const guard = evaluateBootstrapGuard(');
  assert.ok(existsAt > -1, 'the existence check exists');
  assert.ok(guardAt > existsAt, 'the read-only existence check precedes the write guard');
});

test('isolation: a LOCAL database keeps the previous development behaviour', () => {
  assert.equal(guard({ isLocalDb: true }).allowed, true, 'no new flag needed for local development');
  assert.equal(guard({ isLocalDb: true }).reason, 'ok');
});

test('isolation: local database detection requires an exact parsed hostname', () => {
  for (const u of [
    'postgresql://user:pass@localhost.attacker.example:5432/db',
    'postgresql://user:pass@notlocalhost:5432/db',
    'postgresql://127.0.0.1.attacker.example/db',
    'postgresql://127.0.0.1@remote.example/db',
    'not-a-database-url-localhost',
  ]) {
    assert.equal(isLocalDatabaseUrl(u), false, `${u} must not be trusted as local`);
  }
  for (const u of [
    'postgresql://user:pass@localhost:5432/db',
    'postgresql://user:pass@127.0.0.1:5432/db',
    'postgresql://user:pass@[::1]:5432/db',
    'postgresql://user:pass@host.docker.internal:5432/db',
  ]) {
    assert.equal(isLocalDatabaseUrl(u), true, `${u} must remain local`);
  }
});
