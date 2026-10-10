// @ts-nocheck
/**
 * Phase 1.1 — Admin Bootstrap
 * 
 * Creates the first admin user from environment variables.
 * Safe to run on every startup - skips if admin already exists.
 * 
 * Required env vars:
 *   ADMIN_EMAIL     — admin email address
 *   ADMIN_PASSWORD  — admin password (min 8 chars)
 * 
 * Security:
 *   - Never logs the password
 *   - Only creates one admin (idempotent)
 *   - Only works when DATABASE_URL is configured
 */

import { loadConfig } from './config';
import { hashPassword } from './utils/crypto';
import { drizzleUserRepository } from './repositories/drizzleUserRepository';
import { drizzleCompanyRepository } from './repositories/drizzleCompanyRepository';
import { getDatabase } from './db/client';

/** Hosts that identify a LOCAL (development / test) database. */
const LOCAL_DB_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '::1', 'host.docker.internal'];

/** True when the given database URL points at a local machine. */
export function isLocalDatabaseUrl(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;

  // Parse the authority instead of substring-matching the whole URL. A remote
  // host such as `localhost.attacker.example` or a username containing
  // `127.0.0.1` must never be classified as a trusted local database.
  try {
    const parsed = new URL(databaseUrl);
    const hostname = parsed.hostname.toLowerCase().replace('[', '').replace(']', '');
    return LOCAL_DB_HOSTS.includes(hostname);
  } catch {
    // Malformed/driver-specific URLs fail closed: they are not assumed local.
    return false;
  }
}

export type BootstrapGuardInput = {
  /** The process was started by a test harness (tests/envGuard.ts sets this). */
  isHarness: boolean;
  /** The RESOLVED database target is a local machine. */
  isLocalDb: boolean;
  isProduction: boolean;
  adminPasswordLength: number;
  env: Record<string, string | undefined>;
};

export type BootstrapGuardReason =
  | 'ok' | 'test-harness' | 'remote-db-not-opted-in'
  | 'production-not-opted-in' | 'production-remote-not-forced' | 'weak-password';

/**
 * PURE decision function: may `bootstrapAdmin()` CREATE the admin user/company?
 *
 * WHY THIS EXISTS — the guards used to be wrapped in `if (cfg.isProduction)`,
 * which is a NODE_ENV check. ANY process that started with NODE_ENV undefined
 * or "development" (a test harness, a scratch script, an ad-hoc runner)
 * therefore skipped every guard and could create an admin against the
 * PRODUCTION database. The decision is now driven by the RESOLVED DATABASE
 * TARGET, which does not depend on NODE_ENV at all:
 *
 *  - a test harness never bootstraps (unless explicitly forced);
 *  - a NON-LOCAL database (Supabase, Neon, …) always requires ADMIN_BOOTSTRAP=1;
 *  - production additionally requires a strong password, and a non-local
 *    production database additionally requires ADMIN_BOOTSTRAP_FORCE=1.
 *
 * Production semantics are unchanged (they were already the strictest case),
 * while development keeps working whenever the admin already exists — the
 * existence check runs BEFORE this guard.
 */
export function evaluateBootstrapGuard(input: BootstrapGuardInput): {
  allowed: boolean;
  reason: BootstrapGuardReason;
} {
  const allow = input.env.ADMIN_BOOTSTRAP === '1';
  const force = input.env.ADMIN_BOOTSTRAP_FORCE === '1';

  if (input.isHarness && !force) return { allowed: false, reason: 'test-harness' };
  if (input.isProduction && !allow) return { allowed: false, reason: 'production-not-opted-in' };
  if (!input.isLocalDb && !allow) return { allowed: false, reason: 'remote-db-not-opted-in' };
  if (input.isProduction && !input.isLocalDb && !force) {
    return { allowed: false, reason: 'production-remote-not-forced' };
  }
  if (input.isProduction && input.adminPasswordLength < 16) {
    return { allowed: false, reason: 'weak-password' };
  }
  return { allowed: true, reason: 'ok' };
}

const GUARD_MESSAGES: Record<BootstrapGuardReason, string> = {
  'test-harness':
    'refused — this process is a TEST HARNESS. Test runs must never create accounts.',
  'production-not-opted-in': 'disabled in production unless ADMIN_BOOTSTRAP=1 is set',
  'remote-db-not-opted-in':
    'refusing to bootstrap against a NON-LOCAL database unless ADMIN_BOOTSTRAP=1 is set',
  'production-remote-not-forced':
    'refusing to bootstrap on a non-local production database. Set ADMIN_BOOTSTRAP_FORCE=1 to override.',
  'weak-password': 'ADMIN_PASSWORD must be at least 16 characters in production',
  ok: '',
};

export async function bootstrapAdmin(): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  // Skip if env vars not configured
  if (!adminEmail || !adminPassword) {
    console.log('[KONSTRIVO] Admin bootstrap: ADMIN_EMAIL/ADMIN_PASSWORD not set, skipping');
    return;
  }

  // Validate password length
  if (adminPassword.length < 8) {
    console.error('[KONSTRIVO] Admin bootstrap: ADMIN_PASSWORD must be at least 8 characters');
    return;
  }

  try {
    // Re-load configuration at call time so tests can simulate different
    // environments by mutating process.env before invoking this function.
    const cfg = loadConfig();
    const isHarness = process.env.KONSTRIVO_TEST_HARNESS === '1';
    const isLocalDb = isLocalDatabaseUrl(cfg.databaseUrl);

    // (1) A TEST HARNESS never bootstraps — refused before any database work.
    if (isHarness && process.env.ADMIN_BOOTSTRAP_FORCE !== '1') {
      console.warn(`[KONSTRIVO] Admin bootstrap: ${GUARD_MESSAGES['test-harness']}`);
      return;
    }

    const db = await getDatabase();
    if (!db) {
      console.warn('[KONSTRIVO] Admin bootstrap: PostgreSQL not available (set DATABASE_URL)');
      return;
    }

    // (2) READ-ONLY: when the admin already exists there is nothing to write,
    // so the current development behaviour is preserved exactly.
    const existingAdmin = await drizzleUserRepository.findByEmail(adminEmail);
    if (existingAdmin) {
      console.log(`[KONSTRIVO] Admin bootstrap: admin user already exists (${adminEmail})`);
      return;
    }

    // (3) Only now — immediately before the first WRITE — evaluate the guard.
    const guard = evaluateBootstrapGuard({
      isHarness,
      isLocalDb,
      isProduction: cfg.isProduction,
      adminPasswordLength: adminPassword.length,
      env: process.env,
    });
    if (!guard.allowed) {
      console.warn(`[KONSTRIVO] Admin bootstrap: ${GUARD_MESSAGES[guard.reason]}`);
      return;
    }

    // Create admin user
    const adminUser = await drizzleUserRepository.create({
      email: adminEmail.toLowerCase().trim(),
      fullName: 'System Administrator',
      phone: '',
      passwordHash: hashPassword(adminPassword),
      role: 'admin',
      status: 'active',
    });

    // Create admin company
    const adminCompany = await drizzleCompanyRepository.create({
      legalName: 'KONSTRIVO Admin',
      tradeName: 'Admin',
      status: 'active',
    });

    console.log(`[KONSTRIVO] ✅ Admin bootstrap: created admin user (${adminEmail})`);
    console.log(`[KONSTRIVO] Admin bootstrap: created admin company (${adminCompany.id})`);
  } catch (err) {
    console.error('[KONSTRIVO] Admin bootstrap failed:', err instanceof Error ? err.message : err);
  }
}