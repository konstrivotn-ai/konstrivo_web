/**
 * P3 — Admin Plan administration (FREE/PRO).
 *
 * ADDITIVE, no schema change: a plan is stored on the EXISTING `subscriptions`
 * row of the company, written through the SAME repository the payment
 * webhook/PRO verification uses (`subscriptionRepositoryAsync` →
 * drizzleSubscriptionsRepository). Payment/PRO verification is untouched: a
 * successful settlement still upgrades the same row to PRO.
 *
 * Single plan rule: `planCodeFromSubscription()` in featureService is the ONLY
 * place that turns a subscription into a plan code, and `getUserPlan()` (which
 * `canAccessFeature()` uses) delegates to it — so the plan displayed in the
 * admin/user UI is exactly the plan used for access control.
 *
 * Roles are NOT changed here: role scoping stays the admin-managed
 * `feature_entitlements.scope` (managed through /api/v1/admin/features).
 */
import { badRequest, notFound } from '../utils/errors';
import { userRepository } from '../repositories/userRepository';
import { memberRepository } from '../repositories/companyRepository';
import { subscriptionRepositoryAsync } from '../repositories/subscriptionRepository';
import {
  DEFAULT_PLAN_CODE,
  getUserPlan,
  planCodeFromSubscription,
  isEntitlementEnforcementEnabled,
} from './featureService';
import type { Subscription, UserTier } from '../types';

export type PlanCode = 'free' | 'pro';

/** Plans an administrator may assign (no free-form tier strings). */
export const PLAN_CODES: readonly PlanCode[] = ['free', 'pro'] as const;

/** Target of a plan operation: exactly one of these must be provided. */
export interface PlanTarget {
  userId?: string;
  email?: string;
  companyId?: string;
}

/** Identifiers accepted by the admin plan endpoints. */
export type PlanTargetField = keyof PlanTarget;

/**
 * Pure: normalize/validate a plan value ('free' | 'pro', case-insensitive).
 * Returns null for anything else (the route maps that to a 400).
 */
export function normalizePlanCode(raw: unknown): PlanCode | null {
  const value = String(raw ?? '').trim().toLowerCase();
  return (PLAN_CODES as readonly string[]).includes(value) ? (value as PlanCode) : null;
}

/**
 * Pure: read a plan target from a request body/query object.
 * Empty/blank identifiers are ignored; at least one must remain, otherwise a
 * 400 (badRequest) is thrown. Never guesses a target.
 */
export function parsePlanTarget(raw: unknown): PlanTarget {
  const body = (raw ?? {}) as Record<string, unknown>;
  const pick = (key: PlanTargetField): string | undefined => {
    const value = body[key];
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed || undefined;
  };
  // Only defined identifiers are part of the target (never undefined keys),
  // so the object is predictable for callers and tests alike.
  const target: PlanTarget = {};
  const userId = pick('userId');
  const email = pick('email');
  const companyId = pick('companyId');
  if (userId) target.userId = userId;
  if (email) target.email = email.toLowerCase();
  if (companyId) target.companyId = companyId;
  if (!target.userId && !target.email && !target.companyId) {
    throw badRequest('userId, email or companyId is required');
  }
  return target;
}

/** Resolve the company a plan applies to (company > user id > email). */
export async function resolvePlanCompanyId(target: PlanTarget): Promise<string> {
  if (target.companyId) return target.companyId;
  const user = target.userId
    ? await userRepository.findById(target.userId)
    : await userRepository.findByEmail(String(target.email || ''));
  if (!user) throw notFound('User not found');
  const memberships = await memberRepository.findByUserId(user.id);
  const companyId = (memberships || []).map((m) => m.companyId).filter(Boolean)[0];
  if (!companyId) throw notFound('No company membership for this user');
  return companyId;
}

/** The plan of a company, derived with the SINGLE plan rule. */
export async function getCompanyPlan(companyId: string): Promise<{
  planCode: PlanCode;
  companyId: string;
  subscription: Subscription | null;
}> {
  const subscription = (await subscriptionRepositoryAsync.findByCompanyId(companyId)) || null;
  return {
    planCode: planCodeFromSubscription(subscription),
    companyId,
    subscription,
  };
}

/**
 * Grant/revoke a company plan through the EXISTING subscriptions repository
 * (the payment path's repository). `free` keeps the row active with tier FREE —
 * `planCodeFromSubscription()` then resolves the company back to FREE.
 */
export async function setCompanyPlan(
  companyId: string,
  plan: PlanCode
): Promise<{ planCode: PlanCode; companyId: string; subscription: Subscription | null }> {
  const existing = await subscriptionRepositoryAsync.findByCompanyId(companyId);
  const tier: UserTier = plan === 'pro' ? 'PRO' : 'FREE';
  if (!existing) {
    const created = await subscriptionRepositoryAsync.create(companyId, tier);
    return { planCode: planCodeFromSubscription(created), companyId, subscription: created || null };
  }
  const updated = await subscriptionRepositoryAsync.update(existing.id, { tier, status: 'active' });
  return { planCode: planCodeFromSubscription(updated), companyId, subscription: updated || null };
}

/**
 * Resolve the plan of a target using the SAME resolver access control uses:
 * a user target goes through `getUserPlan()` (company subscription → FREE/PRO),
 * a company target goes through the shared subscription rule.
 */
export async function resolveTargetPlan(target: PlanTarget): Promise<{
  planCode: PlanCode;
  companyId: string;
  subscription: Subscription | null;
  enforced: boolean;
  resolvedFrom: 'user_plan' | 'company_subscription';
}> {
  const companyId = await resolvePlanCompanyId(target);
  const enforced = isEntitlementEnforcementEnabled();
  if (target.userId) {
    return {
      planCode: (await getUserPlan(target.userId)) || DEFAULT_PLAN_CODE,
      companyId,
      subscription: (await subscriptionRepositoryAsync.findByCompanyId(companyId)) || null,
      enforced,
      resolvedFrom: 'user_plan',
    };
  }
  const companyPlan = await getCompanyPlan(companyId);
  return { ...companyPlan, enforced, resolvedFrom: 'company_subscription' };
}
