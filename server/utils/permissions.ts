/**
 * Phase 2 — Role, Tier, and Entitlement Model
 *
 * Defines which capabilities each user tier receives.
 * This is the server-side source-of-truth for authorization.
 * The frontend must NEVER be trusted for role/tier values.
 */
import { UserRole, UserTier, Entitlement, Permission } from '../types';

/**
 * Maps each tier to its granted entitlements.
 * Admin role always gets all entitlements.
 */
export const TIER_ENTITLEMENTS: Record<UserTier, Entitlement[]> = {
  FREE: [
    'DEVIS_CREATE_BASIC',
    'OFFLINE_MODE',
  ],
  PRO: [
    'DEVIS_CREATE_BASIC',
    'PRICES_CUSTOM_EDIT',
    'SYNC_FULL',
    'UNLIMITED_DEVIS',
    'MARKETPLACE_ACCESS',
    'OFFLINE_MODE',
    'REPORT_EXPORT',
    'DEVIS_CREATE_ADVANCED',
  ],
  ENTERPRISE: [
    'DEVIS_CREATE_BASIC',
    'PRICES_CUSTOM_EDIT',
    'SYNC_FULL',
    'UNLIMITED_DEVIS',
    'MARKETPLACE_ACCESS',
    'OFFLINE_MODE',
    'REPORT_EXPORT',
    'DEVIS_CREATE_ADVANCED',
    'SUPPLIER_IMPORT_APPROVE',
    'CATALOG_OFFICIAL_MANAGE',
    'ARTISAN_DIRECTORY_MANAGE',
  ],
};

/** All entitlements a user can have (union, used for admin). */
export const ALL_ENTITLEMENTS: Entitlement[] = [
  'DEVIS_CREATE_BASIC',
  'DEVIS_CREATE_ADVANCED',
  'PRICES_CUSTOM_EDIT',
  'SUPPLIER_IMPORT_APPROVE',
  'CATALOG_OFFICIAL_MANAGE',
  'ARTISAN_DIRECTORY_MANAGE',
  'SYNC_FULL',
  'OFFLINE_MODE',
  'UNLIMITED_DEVIS',
  'MARKETPLACE_ACCESS',
  'REPORT_EXPORT',
];

/** Maps roles to a default tier for new registrations. */
// Role/Plan split (Phase F): the role defines WHO the user is (and its
// role-based RBAC/features), NOT the plan. New registrations ALWAYS start
// FREE — no public role grants PRO from the frontend. Engineers keep their
// `ingenieur`/`engineer` role (e.g. devis-creation + engineer-scoped feature
// scopes) but get the FREE tier until a paid subscription upgrades them.
// `admin` keeps ENTERPRISE (unreachable via public registration — blocked in
// auth, and bootstrapped only from env).
export const ROLE_DEFAULT_TIER: Record<UserRole, UserTier> = {
  particulier: 'FREE',
  client: 'FREE',
  artisan: 'FREE',
  contractor: 'FREE',
  fournisseur: 'FREE',
  vendor: 'FREE',
  ingenieur: 'FREE',
  engineer: 'FREE',
  admin: 'ENTERPRISE',
};

/** Maps entitlements to high-level permissions. */
export const ENTITLEMENT_PERMISSIONS: Record<Entitlement, Permission[]> = {
  DEVIS_CREATE_BASIC: ['devis:create'],
  DEVIS_CREATE_ADVANCED: ['devis:create'],
  PRICES_CUSTOM_EDIT: ['prices:write'],
  SUPPLIER_IMPORT_APPROVE: ['suppliers:approve'],
  CATALOG_OFFICIAL_MANAGE: ['catalog:manage'],
  ARTISAN_DIRECTORY_MANAGE: ['admin:all'],
  SYNC_FULL: ['sync:pull', 'sync:push'],
  OFFLINE_MODE: [],
  UNLIMITED_DEVIS: ['devis:create'],
  MARKETPLACE_ACCESS: ['materials:read', 'prices:read'],
  REPORT_EXPORT: [],
};

/**
 * Compute the full entitlement list for a user based on role + tier.
 * Admin always gets all entitlements.
 */
export function computeEntitlements(role: UserRole, tier: UserTier): Entitlement[] {
  if (role === 'admin') return [...ALL_ENTITLEMENTS];
  const tierEnts = TIER_ENTITLEMENTS[tier] || TIER_ENTITLEMENTS.FREE;
  return [...new Set([...tierEnts])];
}

/** Compute permissions from entitlements. */
export function computePermissions(entitlements: Entitlement[]): Set<Permission> {
  const perms = new Set<Permission>();
  for (const ent of entitlements) {
    const mapped = ENTITLEMENT_PERMISSIONS[ent];
    if (mapped) {
      for (const p of mapped) perms.add(p);
    }
  }
  // Read access is granted to many entitlements
  if (entitlements.length > 0) {
    perms.add('devis:read');
    perms.add('materials:read');
    perms.add('prices:read');
    perms.add('sync:pull');
  }
  return perms;
}

/**
 * Check if a user has a specific role.
 * For admin, always returns true regardless of role.
 */
export function hasRole(userRole: UserRole, required: UserRole | UserRole[]): boolean {
  const roles = Array.isArray(required) ? required : [required];
  if (userRole === 'admin') return true;
  return roles.includes(userRole);
}

/** Check if an entitlement is present. */
export function hasEntitlement(entitlements: Entitlement[], required: Entitlement): boolean {
  return entitlements.includes(required);
}

/** Check if a permission is present. */
export function hasPermission(perms: Set<Permission>, required: Permission): boolean {
  return perms.has(required);
}

/**
 * Determine if a tier upgrade is "pro" (for the artisan directory `pro` filter).
 */
export function isProTier(tier: UserTier): boolean {
  return tier === 'PRO' || tier === 'ENTERPRISE';
}
