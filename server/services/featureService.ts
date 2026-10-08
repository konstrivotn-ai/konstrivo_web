/**
 * Phase 4 — Feature Entitlement Service
 *
 * Centralized feature-access control for FREE/PRO gating.
 * Additive: does not modify existing RBAC, auth, or subscriptions.
 *
 * Plan resolution:
 * - User belongs to company with active PRO subscription → PRO
 * - User without company or without active subscription → FREE
 */

import { forbidden } from '../utils/errors';

// Tables live in the additive schema file (Phase 4) — never in identity.ts.
import {
  featureEntitlements,
  userFeatureUsage,
} from '../db/schema/features';

export interface FeatureEntitlement {
  id: string;
  featureKey: string;
  labelFr: string | null;
  labelAr: string | null;
  labelDerja: string | null;
  freeAccess: boolean;
  proAccess: boolean;
  usageLimit: number | null;
  scope: string;
  isActive: boolean;
}

export interface FeatureAccess {
  featureKey: string;
  canAccess: boolean;
  usageLimit: number | null;
  usageRemaining: number | null;
  reason?: string;
}

export const DEFAULT_ENTITLEMENTS: FeatureEntitlement[] = [
  // Canonical Phase C matrix (FREE useful / PRO valuable).
  // Scope rules (canonical role→scope aliases resolved by ROLE_SCOPE below):
  //  - 'all'             → every role may use it if plan + usage allow
  //  - 'client'          → client / particulier roles
  //  - 'artisan'         → artisan / contractor roles
  //  - 'supplier'        → fournisseur / vendor roles
  //  - 'engineer'        → ingenieur / engineer roles
  //
  // Rule: Devis PDF export is available to every role that can create devis.
  // devis:create is scope='all', so devis:export_pdf is also scope='all'
  // (not client-only). It remains PRO-only so it stays valuable.
  {
    id: 'default',
    featureKey: 'devis:create',
    labelFr: 'Création de devis',
    labelAr: 'إنشاء عرض سعر',
    labelDerja: 'إنشاء عرض السعر',
    freeAccess: true,
    proAccess: true,
    usageLimit: 3,
    scope: 'all',
    isActive: true,
  },
  {
    id: 'default',
    featureKey: 'devis:export_pdf',
    labelFr: 'Export PDF de devis',
    labelAr: 'تصدير عرض السعر PDF',
    labelDerja: 'تصدير عرض السعر PDF',
    freeAccess: false,
    proAccess: true,
    usageLimit: null,
    scope: 'all',
    isActive: true,
  },
  {
    id: 'default',
    featureKey: 'projects:save',
    labelFr: 'Enregistrement de projets',
    labelAr: 'حفظ المشاريع',
    labelDerja: 'حفظ المشاريع',
    freeAccess: true,
    proAccess: true,
    usageLimit: 5,
    scope: 'all',
    isActive: true,
  },
  {
    id: 'default',
    featureKey: 'projects:premium_formulas',
    labelFr: 'Formules projet avancées',
    labelAr: 'صيغ مشروع متقدمة',
    labelDerja: 'صيغ مشروع متقدمة',
    freeAccess: false,
    proAccess: true,
    usageLimit: null,
    scope: 'all',
    isActive: true,
  },
  {
    id: 'default',
    featureKey: 'supplier:products',
    labelFr: 'Gestion des produits fournisseur',
    labelAr: 'إدارة منتجات المورد',
    labelDerja: 'إدارة منتجات المؤيد',
    freeAccess: true,
    proAccess: true,
    usageLimit: 10,
    scope: 'supplier',
    isActive: true,
  },
  {
    id: 'default',
    featureKey: 'supplier:bulk_update',
    labelFr: 'Mise à jour groupée des prix',
    labelAr: 'تحديث أسعار جماعي',
    labelDerja: 'تحديث الأسعار الجماعي',
    freeAccess: false,
    proAccess: true,
    usageLimit: null,
    scope: 'supplier',
    isActive: true,
  },
  {
    id: 'default',
    featureKey: 'engineer:advanced_calc',
    labelFr: 'Calculs avancés ingénieur',
    labelAr: 'حسابات مهندس متقدمة',
    labelDerja: 'حسابات مهندس متقدمة',
    freeAccess: false,
    proAccess: true,
    usageLimit: null,
    scope: 'engineer',
    isActive: true,
  },
  {
    id: 'default',
    featureKey: 'engineer:multi_project',
    labelFr: 'Multi-projets ingénieur',
    labelAr: 'متعدد المشاريع للمهندس',
    labelDerja: 'متعدد مشاريع المهندس',
    freeAccess: false,
    proAccess: true,
    usageLimit: null,
    scope: 'engineer',
    isActive: true,
  },
  {
    id: 'default',
    featureKey: 'catalogue:browse',
    labelFr: 'Parcourir le catalogue',
    labelAr: 'تصفح الكتالوج',
    labelDerja: 'تصفح الكتالوج',
    freeAccess: true,
    proAccess: true,
    usageLimit: null,
    scope: 'all',
    isActive: true,
  },
  {
    id: 'default',
    featureKey: 'catalogue:export',
    labelFr: 'Export du catalogue',
    labelAr: 'تصدير الكتالوج',
    labelDerja: 'تصدير الكتالوج',
    freeAccess: false,
    proAccess: true,
    usageLimit: null,
    scope: 'all',
    isActive: true,
  },
  {
    id: 'default',
    featureKey: 'analytics:view',
    labelFr: 'Statistiques et analyses',
    labelAr: 'الإحصاء والتحليلات',
    labelDerja: 'الإحصائيات والتحليلات',
    freeAccess: false,
    proAccess: true,
    usageLimit: null,
    scope: 'all',
    isActive: true,
  },
];

// ── P3 (2026-09-20): REAL FREE/PRO entitlement enforcement ──────────────────
// P3 makes the admin-managed entitlement matrix the ACTUAL access control.
// The single decision point stays canAccessFeature(), which now really reads:
//   - the feature_entitlements row (freeAccess / proAccess / scope / usageLimit)
//   - the user's plan resolved from the company subscription (getUserPlan)
//   - the monthly usage counters (user_feature_usage)
//
// Enforcement is the DEFAULT (fail-safe for the product: plan/scope/usage
// gating is REALLY applied). The legacy Phase-1 "everything is free" mode is
// still available as an explicit, opt-in operator switch:
//
//   ALL_FEATURES_FREE=1            (preferred)
//   PHASE1_ALL_FEATURES_FREE=1     (legacy alias, same behaviour)
//
// Truthy values: 1 / true / yes / on (case-insensitive). Anything else
// (unset, '', 0, false, off, …) keeps REAL enforcement ON.
export const ALL_FEATURES_FREE_SWITCH = 'ALL_FEATURES_FREE';

/** Pure: reads the opt-in "all features free" switch from an env object. */
export function resolveAllFeaturesFree(
  env: Record<string, string | undefined> = process.env
): boolean {
  const read = (key: string) => String(env?.[key] ?? '').trim().toLowerCase();
  const raw = read(ALL_FEATURES_FREE_SWITCH) || read('PHASE1_ALL_FEATURES_FREE');
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/** Resolved once at import: enforcement ON unless explicitly opted out. */
export const ALL_FEATURES_FREE: boolean = resolveAllFeaturesFree();

/** Back-compat alias (same value) for existing call sites/tests/reports. */
export const PHASE1_ALL_FEATURES_FREE: boolean = ALL_FEATURES_FREE;

/** True when plan/scope/usage gating is really applied (P3 default). */
export function isEntitlementEnforcementEnabled(): boolean {
  return !ALL_FEATURES_FREE;
}

/** The plan every account starts on (registration creates no PRO row). */
export const DEFAULT_PLAN_CODE: 'free' | 'pro' = 'free';

/**
 * P3 — SINGLE plan rule used by access control, the /features API, the admin
 * plan tools and /subscriptions/me: a subscription grants PRO only when it is
 * tier PRO **and** active; everything else is FREE (new users default FREE).
 * Pure so the rule can never diverge between surfaces.
 */
export function planCodeFromSubscription(
  subscription: { tier?: string | null; status?: string | null } | null | undefined
): 'free' | 'pro' {
  if (!subscription) return DEFAULT_PLAN_CODE;
  const tier = String(subscription.tier ?? '').trim().toUpperCase();
  const status = String(subscription.status ?? '').trim().toLowerCase();
  if (tier === 'PRO' && status === 'active') return 'pro';
  return DEFAULT_PLAN_CODE;
}

export async function getUserPlan(userId: string): Promise<'free' | 'pro'> {
  try {
    const { getDatabase } = await import('../db/client');
    const db = await getDatabase();
    if (!db) return DEFAULT_PLAN_CODE;
    const { companyMembers, subscriptions } = await import('../db/schema/identity');
    const { eq, and } = await import('drizzle-orm');
    const memberships = await db.select().from(companyMembers).where(eq(companyMembers.userId, userId));
    if (memberships.length === 0) return DEFAULT_PLAN_CODE;
    const companyId = memberships[0].companyId;
    if (!companyId) return DEFAULT_PLAN_CODE;
    const subs = await db.select().from(subscriptions).where(
      and(eq(subscriptions.companyId, companyId), eq(subscriptions.status, 'active'))
    );
    // Same rule as planCodeFromSubscription (no divergent plan semantics).
    return subs.some(s => planCodeFromSubscription(s) === 'pro') ? 'pro' : DEFAULT_PLAN_CODE;
  } catch {
    return DEFAULT_PLAN_CODE;
  }
}

export async function getEntitlement(featureKey: string): Promise<FeatureEntitlement | null> {
  try {
    const { getDatabase } = await import('../db/client');
    const db = await getDatabase();
    if (!db) return DEFAULT_ENTITLEMENTS.find(e => e.featureKey === featureKey) || null;
    const { featureEntitlements } = await import('../db/schema/features');
    const { eq } = await import('drizzle-orm');
    const rows = await db.select().from(featureEntitlements).where(eq(featureEntitlements.featureKey, featureKey));
    // F12: a missing DB row falls back to the shipped default for this key.
    // Partial seeds must never turn a KNOWN feature into "unmanaged"/open —
    // DEFAULT_ENTITLEMENTS stay the baseline; a real row (when present) is the
    // only thing allowed to override it. Unknown keys still resolve to null.
    if (rows.length === 0) {
      return DEFAULT_ENTITLEMENTS.find(e => e.featureKey === featureKey) || null;
    }
    const row = rows[0];
    // Audit fix (31 FAIL): legacy DB seeds stored devis:create with scope='client'
    // (see 0004 migration + 0005 repair). Artisans are first-class devis
    // creators in this product (all test users register as 'artisan'), so a
    // persisted 'client'-only scope would 403 them with SCOPE_MISMATCH even
    // though FREE/PRO access is granted. Normalize ONLY this known key to
    // 'all' at read time (no migration, no Phase change); every other feature
    // keeps its exact persisted scope. A forward migration + updated seed keep
    // new environments consistent.
    const scope = row.featureKey === 'devis:create' && row.scope === 'client' ? 'all' : row.scope;
    return {
      id: row.id, featureKey: row.featureKey, labelFr: row.labelFr, labelAr: row.labelAr,
      labelDerja: row.labelDerja, freeAccess: row.freeAccess, proAccess: row.proAccess,
      usageLimit: row.usageLimit, scope, isActive: row.isActive,
    };
  } catch {
    return DEFAULT_ENTITLEMENTS.find(e => e.featureKey === featureKey) || null;
  }
}

export async function getCurrentUsage(userId: string, featureKey: string): Promise<number> {
  try {
    const { getDatabase } = await import('../db/client');
    const db = await getDatabase();
    if (!db) return 0;
    const { userFeatureUsage } = await import('../db/schema/features');
    const { eq, and } = await import('drizzle-orm');
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const rows = await db.select().from(userFeatureUsage).where(
      and(eq(userFeatureUsage.userId, userId), eq(userFeatureUsage.featureKey, featureKey),
        eq(userFeatureUsage.periodStart, periodStart))
    );
    return rows.length > 0 ? rows[0].usageCount : 0;
  } catch {
    return 0;
  }
}

export async function incrementUsage(userId: string, featureKey: string): Promise<void> {
  try {
    const { getDatabase } = await import('../db/client');
    const db = await getDatabase();
    if (!db) return;
    const { userFeatureUsage } = await import('../db/schema/features');
    const { eq, and } = await import('drizzle-orm');
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
    // F10 — ATOMIC increment: one statement, no check-then-act race. The
    // conflict target is the existing unique index
    // uq_user_feature_usage_period (user_id, feature_key, period_start), and
    // usage_count is incremented BY THE DATABASE so concurrent requests can
    // never lose an increment. Monthly semantics (one row per user + feature
    // + calendar month) and the period columns are unchanged.
    try {
      const { sql } = await import('drizzle-orm');
      await db.insert(userFeatureUsage)
        .values({ userId, featureKey, usageCount: 1, periodStart, periodEnd })
        .onConflictDoUpdate({
          target: [
            userFeatureUsage.userId,
            userFeatureUsage.featureKey,
            userFeatureUsage.periodStart,
          ],
          set: {
            usageCount: sql`${userFeatureUsage.usageCount} + 1`,
            updatedAt: new Date(),
          },
        });
    } catch {
      // Smallest safe repository-level fallback (same convention as
      // calcRepository.onConflictDoUpdate): if the driver rejects ON CONFLICT,
      // keep the legacy two-step path so usage tracking still works — never
      // worse than pre-F10. The outer catch keeps tracking NON-BLOCKING.
      const rows = await db.select().from(userFeatureUsage).where(
        and(eq(userFeatureUsage.userId, userId), eq(userFeatureUsage.featureKey, featureKey),
          eq(userFeatureUsage.periodStart, periodStart))
      );
      if (rows.length > 0) {
        await db.update(userFeatureUsage)
          .set({ usageCount: rows[0].usageCount + 1, updatedAt: new Date() })
          .where(eq(userFeatureUsage.id, rows[0].id));
      } else {
        await db.insert(userFeatureUsage).values({
          userId, featureKey, usageCount: 1, periodStart, periodEnd,
        });
      }
    }
  } catch {
    /* silent: usage tracking never blocks the request */
  }
}

// ── Phase 2 — Admin Usage Analytics (read-only aggregation) ────────────────
// Reads the EXISTING user_feature_usage table. No new table, no writes, no
// tracking changes — getCurrentUsage/incrementUsage are untouched. When the
// database is unavailable the aggregation returns EMPTY stats (real data
// only; nothing is invented).
export interface FeatureUsageRow {
  userId: string;
  featureKey: string;
  usageCount: number;
  periodStart: string;
  updatedAt?: Date | string | null;
}

export interface FeatureUsageStat {
  featureKey: string;
  /** Sum of usageCount across ALL recorded periods. */
  totalUsage: number;
  /** Distinct users that have ever used the feature. */
  uniqueUsers: number;
  /** Sum of usageCount for the current monthly period only. */
  currentMonthUsage: number;
  /** Most recent updatedAt across rows (ISO string), null when unknown. */
  lastActivityAt: string | null;
  /** Optional (Phase 3, admin-only): top users inside this feature. */
  topUsers?: UsageTopUser[];
}

export interface UsageTopUser {
  userId: string;
  totalUsage: number;
}

export interface UsagePeriodPoint {
  periodStart: string;
  totalUsage: number;
  /** Distinct users with usage inside this period ("active users"). */
  activeUsers: number;
}

export interface UsageRoleStat {
  role: string;
  totalUsage: number;
  uniqueUsers: number;
}

export interface FeatureUsageStats {
  /** Current monthly period start (YYYY-MM-DD), same rule as incrementUsage. */
  periodStart: string;
  /** Sum of totalUsage across all features (within the selected range). */
  totalUsage: number;
  generatedAt: string;
  /** Sorted by usage desc — the top-used features come first. */
  features: FeatureUsageStat[];
  /** Phase 3 — optional selected range (echoed when ?from/?to provided). */
  from?: string;
  to?: string;
  /** Phase 3 — distinct users with usage inside the selected range. */
  activeUsersInRange: number;
  /** Phase 3 — per-period series (ascending), within the selected range. */
  series: UsagePeriodPoint[];
  /** Phase 3 — usage per role (read-only join with users.global_role). */
  roleBreakdown: UsageRoleStat[];
}

/** Pure aggregation — unit-testable without a database. */
export function aggregateFeatureUsageRows(
  rows: FeatureUsageRow[],
  periodStart: string
): FeatureUsageStat[] {
  const byKey = new Map<string, {
    totalUsage: number;
    users: Set<string>;
    currentMonthUsage: number;
    lastActivityAt: string | null;
  }>();
  for (const row of rows || []) {
    const key = String(row.featureKey || '');
    if (!key) continue;
    let agg = byKey.get(key);
    if (!agg) {
      agg = { totalUsage: 0, users: new Set<string>(), currentMonthUsage: 0, lastActivityAt: null };
      byKey.set(key, agg);
    }
    const count = Number(row.usageCount) || 0;
    agg.totalUsage += count;
    if (row.userId) agg.users.add(String(row.userId));
    if (row.periodStart === periodStart) agg.currentMonthUsage += count;
    const rawUpdated = row.updatedAt;
    const iso = rawUpdated instanceof Date
      ? rawUpdated.toISOString()
      : (typeof rawUpdated === 'string' && rawUpdated ? rawUpdated : null);
    if (iso && (!agg.lastActivityAt || iso > agg.lastActivityAt)) agg.lastActivityAt = iso;
  }
  return Array.from(byKey.entries())
    .map(([featureKey, agg]) => ({
      featureKey,
      totalUsage: agg.totalUsage,
      uniqueUsers: agg.users.size,
      currentMonthUsage: agg.currentMonthUsage,
      lastActivityAt: agg.lastActivityAt,
    }))
    .sort((a, b) => (b.totalUsage - a.totalUsage) || a.featureKey.localeCompare(b.featureKey));
}

// ── Phase 3 — Usage Analytics: periods, active users, roles, top users ─────
// Still READ-ONLY over the existing user_feature_usage table. The role
// breakdown performs a READ-ONLY join with users.global_role (no schema,
// tracking, or entitlement change). All helpers below are pure and
// unit-testable; empty input yields empty stats (no invented data).

/** Rows kept whose periodStart lies within [from, to] (inclusive, optional). */
export function filterUsageRowsByRange(
  rows: FeatureUsageRow[],
  from?: string,
  to?: string
): FeatureUsageRow[] {
  return (rows || []).filter((r) => {
    const p = String(r.periodStart || '');
    if (from && p < from) return false;
    if (to && p > to) return false;
    return true;
  });
}

/** Per-period series (ascending) with active users per period. */
export function buildUsagePeriodSeries(rows: FeatureUsageRow[]): UsagePeriodPoint[] {
  const byPeriod = new Map<string, { totalUsage: number; users: Set<string> }>();
  for (const row of rows || []) {
    const p = String(row.periodStart || '');
    if (!p) continue;
    let agg = byPeriod.get(p);
    if (!agg) {
      agg = { totalUsage: 0, users: new Set<string>() };
      byPeriod.set(p, agg);
    }
    agg.totalUsage += Number(row.usageCount) || 0;
    if (row.userId) agg.users.add(String(row.userId));
  }
  return Array.from(byPeriod.entries())
    .map(([periodStart, agg]) => ({ periodStart, totalUsage: agg.totalUsage, activeUsers: agg.users.size }))
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
}

/** Role breakdown. Users missing from the map land in the 'unknown' bucket. */
export function aggregateUsageByRole(
  rows: FeatureUsageRow[],
  rolesByUserId: Record<string, string>
): UsageRoleStat[] {
  const byRole = new Map<string, { totalUsage: number; users: Set<string> }>();
  for (const row of rows || []) {
    const role = String((row.userId && rolesByUserId[String(row.userId)]) || 'unknown');
    let agg = byRole.get(role);
    if (!agg) {
      agg = { totalUsage: 0, users: new Set<string>() };
      byRole.set(role, agg);
    }
    agg.totalUsage += Number(row.usageCount) || 0;
    if (row.userId) agg.users.add(String(row.userId));
  }
  return Array.from(byRole.entries())
    .map(([role, agg]) => ({ role, totalUsage: agg.totalUsage, uniqueUsers: agg.users.size }))
    .sort((a, b) => (b.totalUsage - a.totalUsage) || a.role.localeCompare(b.role));
}

/** Top N users per feature (usage desc, userId asc tie-break). */
export function computeTopUsersPerFeature(
  rows: FeatureUsageRow[],
  limit = 5
): Record<string, UsageTopUser[]> {
  const byFeature = new Map<string, Map<string, number>>();
  for (const row of rows || []) {
    const key = String(row.featureKey || '');
    const uid = String(row.userId || '');
    if (!key || !uid) continue;
    let users = byFeature.get(key);
    if (!users) {
      users = new Map<string, number>();
      byFeature.set(key, users);
    }
    users.set(uid, (users.get(uid) || 0) + (Number(row.usageCount) || 0));
  }
  const out: Record<string, UsageTopUser[]> = {};
  for (const [featureKey, users] of byFeature.entries()) {
    out[featureKey] = Array.from(users.entries())
      .map(([userId, totalUsage]) => ({ userId, totalUsage }))
      .sort((a, b) => (b.totalUsage - a.totalUsage) || a.userId.localeCompare(b.userId))
      .slice(0, Math.max(1, limit));
  }
  return out;
}

export interface FeatureUsageStatsOptions {
  from?: string;
  to?: string;
  includeTopUsers?: boolean;
}

/** Admin Usage Analytics: aggregate the real user_feature_usage rows. */
export async function getFeatureUsageStats(options: FeatureUsageStatsOptions = {}): Promise<FeatureUsageStats> {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const stats: FeatureUsageStats = {
    periodStart,
    totalUsage: 0,
    generatedAt: now.toISOString(),
    features: [],
    activeUsersInRange: 0,
    series: [],
    roleBreakdown: [],
  };
  if (options.from) stats.from = options.from;
  if (options.to) stats.to = options.to;
  try {
    const { getDatabase } = await import('../db/client');
    const db = await getDatabase();
    if (!db) return stats;
    const { userFeatureUsage } = await import('../db/schema/features');
    const allRows = (await db.select().from(userFeatureUsage)) as unknown as FeatureUsageRow[];
    const rows = filterUsageRowsByRange(allRows, options.from, options.to);
    stats.features = aggregateFeatureUsageRows(rows, periodStart);
    stats.totalUsage = stats.features.reduce((sum, f) => sum + f.totalUsage, 0);
    stats.activeUsersInRange = new Set(rows.map((r) => String(r.userId)).filter(Boolean)).size;
    stats.series = buildUsagePeriodSeries(rows);
    // Role breakdown — READ-ONLY join with users.global_role (no schema change).
    let rolesByUserId: Record<string, string> = {};
    try {
      const userIds = Array.from(new Set(rows.map((r) => String(r.userId)).filter(Boolean)));
      if (userIds.length > 0) {
        const { users } = await import('../db/schema/identity');
        const { inArray } = await import('drizzle-orm');
        const userRows = (await db
          .select({ id: users.id, role: users.globalRole })
          .from(users)
          .where(inArray(users.id, userIds))) as Array<{ id: string; role: string }>;
        rolesByUserId = Object.fromEntries(userRows.map((u) => [u.id, u.role || 'unknown']));
      }
    } catch {
      rolesByUserId = {}; // graceful degradation: rows land in the 'unknown' bucket
    }
    stats.roleBreakdown = aggregateUsageByRole(rows, rolesByUserId);
    if (options.includeTopUsers) {
      const topByFeature = computeTopUsersPerFeature(rows, 5);
      stats.features = stats.features.map((f) => ({ ...f, topUsers: topByFeature[f.featureKey] || [] }));
    }
    return stats;
  } catch {
    /* real data only: return empty stats instead of inventing numbers */
    return stats;
  }
}

// ── F8 (Phase 3 audit fix): canonical server-side role → feature-scope mapping ─
// The feature_entitlements `scope` column stores a CANONICAL scope name
// ('all' | 'client' | 'artisan' | 'supplier' | 'engineer' — see migration
// 0004_feature_entitlements.sql), while users carry a UserRole that may be a
// French or English alias of the same identity (see server/types.ts). The
// pre-F8 scope gate compared the raw strings, so valid roles were rejected:
//   supplier scope ← fournisseur / vendor    (no role is literally 'supplier')
//   engineer scope ← ingenieur   / engineer
//   client   scope ← client      / particulier
//   artisan  scope ← artisan     / contractor
// This is the SINGLE canonical mapping used by the gate below. It does NOT
// introduce a second role system — it only translates the EXISTING UserRole
// aliases onto the EXISTING canonical scopes. `admin` is intentionally omitted:
// requireFeature()/requireEntitlement() already bypass admins before this gate,
// and decideFeatureAccess() must keep its exact pre-F8 behaviour for admin.
export const ROLE_SCOPE: Readonly<Record<string, string>> = Object.freeze({
  client: 'client',
  particulier: 'client',
  artisan: 'artisan',
  contractor: 'artisan',
  fournisseur: 'supplier',
  vendor: 'supplier',
  engineer: 'engineer',
  ingenieur: 'engineer',
});

/**
 * Canonical role → scope match used by the ROLE gate in decideFeatureAccess().
 * - scope 'all'        → everyone passes (preserved)
 * - no role provided   → gate skipped (preserved)
 * - known UserRole     → compare its canonical scope to the entitlement scope
 * - unknown/legacy str → fall back to the pre-F8 direct comparison (no regression)
 */
export function roleMatchesScope(userRole: string | undefined, scope: string): boolean {
  if (scope === 'all') return true;
  if (!userRole) return true;
  const mapped = ROLE_SCOPE[userRole];
  if (mapped !== undefined) return mapped === scope;
  // Legacy / unknown value (e.g. a raw scope string passed as a role before
  // F8): preserve the exact pre-F8 comparison so nothing regresses.
  return userRole === scope;
}

/**
 * P3 — pure FREE/PRO access decision (NO database access).
 *
 * `canAccessFeature()` below only performs the reads (entitlement row, plan,
 * monthly usage) and delegates EVERY rule to this function, so the whole
 * FREE/PRO matrix (plan access, role scope, usage limit, legacy devis scope
 * repair, opt-in "all free" mode) is exhaustively testable without a DB.
 * Defaults preserve the pre-P3 behaviour of canAccessFeature exactly.
 */
export function decideFeatureAccess(
  entitlement: FeatureEntitlement | null | undefined,
  plan: 'free' | 'pro',
  usageCount: number,
  userRole?: string,
  policy: { allFeaturesFree: boolean } = { allFeaturesFree: ALL_FEATURES_FREE }
): FeatureAccess {
  const featureKey = String(entitlement?.featureKey ?? '');

  // Unknown feature (never configured on either side) → unmanaged: never
  // block on missing config (unchanged contract for unrecognized keys).
  if (!entitlement) {
    return { featureKey, canAccess: true, usageLimit: null, usageRemaining: null, reason: 'unmanaged' };
  }

  // F11 — a KNOWN feature with a deactivated entitlement is DISABLED, not
  // open. Deactivation is an explicit admin kill switch and must never
  // degrade into unmanaged/open access; it also wins over the opt-in
  // all-free policy below (checked first, exactly where !isActive was
  // checked before). Admins still bypass this gate earlier, in
  // requireFeature() — this decision point never sees admin requests.
  if (!entitlement.isActive) {
    return {
      featureKey,
      canAccess: false,
      usageLimit: entitlement.usageLimit,
      usageRemaining: 0,
      reason: 'FEATURE_DISABLED',
    };
  }

  // Explicit opt-in operator switch: everything free (legacy Phase 1 mode).
  if (policy.allFeaturesFree) {
    return { featureKey, canAccess: true, usageLimit: null, usageRemaining: null, reason: 'PHASE1_ALL_FREE' };
  }

  // 1) PLAN gate — admin-managed freeAccess / proAccess really gate here.
  const planAllows = plan === 'pro' ? entitlement.proAccess : entitlement.freeAccess;
  if (!planAllows) {
    return {
      featureKey,
      canAccess: false,
      usageLimit: entitlement.usageLimit,
      usageRemaining: 0,
      reason: plan === 'pro' ? 'PLAN_DENIED' : 'PRO_REQUIRED',
    };
  }

  // 2) Legacy devis:create scope repair (unchanged since the 31-FAIL audit):
  // a stale non-'all' scope must not lock out the primary devis creators; the
  // admin-managed usage limit (if any) still applies.
  if (featureKey === 'devis:create' && entitlement.scope !== 'all') {
    return applyUsageLimit(featureKey, entitlement.usageLimit, usageCount);
  }

  // 3) ROLE gate — admin-managed `scope` really gates here (F8: alias-aware).
  // `scope` holds a canonical scope name while `userRole` may be a French or
  // English alias of the same identity; roleMatchesScope() translates the
  // existing UserRole aliases onto the existing canonical scopes instead of
  // comparing the raw strings.
  if (!roleMatchesScope(userRole, entitlement.scope)) {
    return {
      featureKey,
      canAccess: false,
      usageLimit: entitlement.usageLimit,
      usageRemaining: 0,
      reason: 'SCOPE_MISMATCH',
    };
  }

  // 4) USAGE gate — admin-managed monthly limit really gates here.
  return applyUsageLimit(featureKey, entitlement.usageLimit, usageCount);
}

/** Shared usage-limit rule (NULL = unlimited). */
function applyUsageLimit(
  featureKey: string,
  usageLimit: number | null,
  usageCount: number
): FeatureAccess {
  if (usageLimit === null) {
    return { featureKey, canAccess: true, usageLimit: null, usageRemaining: null };
  }
  const remaining = Math.max(0, usageLimit - usageCount);
  return {
    featureKey,
    canAccess: remaining > 0,
    usageLimit,
    usageRemaining: remaining,
    reason: remaining > 0 ? undefined : 'USAGE_EXHAUSTED',
  };
}

/** Resolve a user's effective access to a feature (plan + role + usage). */
export async function canAccessFeature(
  userId: string,
  featureKey: string,
  userRole?: string
): Promise<FeatureAccess> {
  const ent = await getEntitlement(featureKey);
  if (!ent || !ent.isActive) return decideFeatureAccess(ent, DEFAULT_PLAN_CODE, 0, userRole);
  // Opt-in "all features free" mode short-circuits BEFORE any plan/usage read.
  if (ALL_FEATURES_FREE) return decideFeatureAccess(ent, DEFAULT_PLAN_CODE, 0, userRole);

  const plan = await getUserPlan(userId);
  const planAllows = plan === 'pro' ? ent.proAccess : ent.freeAccess;
  // Usage is only read when a limit exists AND the plan allows the feature
  // (same reads as before P3 — no extra work on the deny paths).
  const usage = planAllows && ent.usageLimit !== null
    ? await getCurrentUsage(userId, featureKey)
    : 0;
  return decideFeatureAccess(ent, plan, usage, userRole);
}

// ── Admin CRUD (admin-only — wired in adminFeatures routes) ──────────────────

/**
 * F12 — the SINGLE effective-matrix rule: DEFAULT_ENTITLEMENTS remain the
 * baseline for every known feature key; existing DB rows override their own
 * key only; missing DB rows keep their shipped default (never "unmanaged");
 * extra DB rows (not in the shipped matrix) are preserved. Pure, so
 * listEntitlements(), the /features API and tests all share one rule.
 */
export function mergeEffectiveEntitlements(
  dbRows: FeatureEntitlement[] | null | undefined
): FeatureEntitlement[] {
  const byKey = new Map<string, FeatureEntitlement>();
  for (const def of DEFAULT_ENTITLEMENTS) byKey.set(def.featureKey, def);
  for (const row of dbRows || []) {
    if (row && row.featureKey) byKey.set(row.featureKey, row);
  }
  return Array.from(byKey.values());
}

export async function listEntitlements(): Promise<FeatureEntitlement[]> {
  try {
    const { getDatabase } = await import('../db/client');
    const db = await getDatabase();
    if (!db) return DEFAULT_ENTITLEMENTS;
    const rows = await db.select().from(featureEntitlements);
    // An empty table (seed never ran) must NOT surface as "0/0" with dead
    // actions: fall back to the shipped matrix for display, exactly like the
    // no-DB path. Admin edits upsert real rows through the same backend.
    if (!rows || rows.length === 0) return DEFAULT_ENTITLEMENTS;
    // F12: partial rows must not make defaults disappear — merge so DB rows
    // override their own key while every other default stays visible/enforced.
    return mergeEffectiveEntitlements(rows.map(row => mapRow(row)));
  } catch {
    return DEFAULT_ENTITLEMENTS;
  }
}

export async function upsertEntitlement(ent: Partial<FeatureEntitlement> & { featureKey: string }): Promise<FeatureEntitlement> {
  const { getDatabase } = await import('../db/client');
  const db = await getDatabase();
  if (!db) throw forbidden('Database not available');
  const { featureEntitlements } = await import('../db/schema/features');
  const { eq } = await import('drizzle-orm');
  const existing = await db.select().from(featureEntitlements).where(eq(featureEntitlements.featureKey, ent.featureKey));
  // F13 (service half): a PARTIAL payload must NOT clobber omitted fields.
  // Precedence per field: provided value → existing DB row → shipped default
  // for known keys → the historical insert fallback. Only `undefined`
  // (field omitted) falls through — an explicit null (e.g. usageLimit: null =
  // unlimited, labels cleared) is honored and written as-is.
  const base: Partial<FeatureEntitlement> | undefined =
    existing.length > 0 ? mapRow(existing[0])
      : DEFAULT_ENTITLEMENTS.find(d => d.featureKey === ent.featureKey);
  const keep = <T>(provided: T | undefined, current: T | null | undefined, whenMissing: T): T =>
    provided !== undefined ? provided : ((current ?? whenMissing) as T);
  const values = {
    featureKey: ent.featureKey,
    labelFr: keep(ent.labelFr, base?.labelFr, null),
    labelAr: keep(ent.labelAr, base?.labelAr, null),
    labelDerja: keep(ent.labelDerja, base?.labelDerja, null),
    freeAccess: keep(ent.freeAccess, base?.freeAccess, true),
    proAccess: keep(ent.proAccess, base?.proAccess, true),
    usageLimit: keep(ent.usageLimit, base?.usageLimit, null),
    scope: keep(ent.scope, base?.scope, 'all'),
    isActive: keep(ent.isActive, base?.isActive, true),
    updatedAt: new Date(),
  };
  if (existing.length > 0) {
    const [updated] = await db.update(featureEntitlements).set(values)
      .where(eq(featureEntitlements.featureKey, ent.featureKey)).returning();
    return mapRow(updated);
  }
  const [inserted] = await db.insert(featureEntitlements).values(values).returning();
  return mapRow(inserted);
}

export async function deactivateEntitlement(featureKey: string): Promise<void> {
  const { getDatabase } = await import('../db/client');
  const db = await getDatabase();
  if (!db) return;
  const { featureEntitlements } = await import('../db/schema/features');
  const { eq } = await import('drizzle-orm');
  await db.update(featureEntitlements).set({ isActive: false, updatedAt: new Date() })
    .where(eq(featureEntitlements.featureKey, featureKey));
}

function mapRow(row: any): FeatureEntitlement {
  return {
    id: row.id, featureKey: row.featureKey, labelFr: row.labelFr, labelAr: row.labelAr,
    labelDerja: row.labelDerja, freeAccess: row.freeAccess, proAccess: row.proAccess,
    usageLimit: row.usageLimit, scope: row.scope, isActive: row.isActive,
  };
}
export const DEFAULT_FEATURE_KEYS: string[] = DEFAULT_ENTITLEMENTS.map(e => e.featureKey);

/**
 * Parity helper: every key in the authoritative default matrix must be known to
 * the frontend feature contract. Used by tests and typecheck guards so feature
 * keys cannot silently diverge between backend and frontend.
 */
export function assertFeatureParity(
  frontendKeys: ReadonlyArray<string>
): string[] {
  const missing = DEFAULT_FEATURE_KEYS.filter(key => !frontendKeys.includes(key));
  return missing;
}

