/**
 * Phase 2 + Phase 3 — Canonical Domain Types
 *
 * These types define the API contracts for /api/v1.
 * They bridge the existing frontend types (src/types.ts) and the
 * Phase 3 PostgreSQL schema.
 */

// ── Re-export key frontend types so the backend stays aligned ──────────────
export type {
  TradeCategory,
  CountryCode,
  CurrencyCode,
  Trade,
} from '../src/types';

// ── User / Auth ─────────────────────────────────────────────────────────────

export type UserRole =
  | 'particulier' | 'artisan' | 'fournisseur' | 'ingenieur'
  | 'admin' | 'client' | 'contractor' | 'vendor' | 'engineer';

export type UserTier = 'FREE' | 'PRO' | 'ENTERPRISE';

export type UserStatus = 'active' | 'suspended' | 'inactive';

/**
 * Granular capabilities that can be granted to a user/company.
 * Server-side source-of-truth for authorization.
 */
export type Entitlement =
  | 'DEVIS_CREATE_BASIC'
  | 'DEVIS_CREATE_ADVANCED'
  | 'PRICES_CUSTOM_EDIT'
  | 'SUPPLIER_IMPORT_APPROVE'
  | 'CATALOG_OFFICIAL_MANAGE'
  | 'ARTISAN_DIRECTORY_MANAGE'
  | 'SYNC_FULL'
  | 'OFFLINE_MODE'
  | 'UNLIMITED_DEVIS'
  | 'MARKETPLACE_ACCESS'
  | 'REPORT_EXPORT';

/** Higher-level permission groups used by requirePermission middleware. */
export type Permission =
  | 'devis:create' | 'devis:read' | 'devis:update' | 'devis:delete'
  | 'prices:read' | 'prices:write'
  | 'materials:read'
  | 'catalog:manage'
  | 'suppliers:import' | 'suppliers:approve'
  | 'sync:pull' | 'sync:push'
  | 'admin:all';

export interface JwtClaims {
  uid: string;
  companyId: string;
  role: UserRole;
  tier: UserTier;
  entitlements: Entitlement[];
  iat: number;
  exp: number;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  passwordHash: string;
  role: UserRole;
  tier: UserTier;
  status: UserStatus;
  avatarUrl?: string;
  region?: string;
  country?: string;
  licenseNumber?: string;
  matriculeFiscale?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  isDeleted: boolean;
  deletedAt?: string;
}

export interface Company {
  id: string;
  legalName: string;
  tradeName?: string;
  countryCode: string;
  currencyCode: string;
  taxId?: string;
  address?: string;
  phone?: string;
  email?: string;
  status: 'active' | 'suspended';
  createdAt: string;
  updatedAt: string;
  version: number;
  isDeleted: boolean;
  deletedAt?: string;
}

export interface CompanyMember {
  id: string;
  userId: string;
  companyId: string;
  role: UserRole;
  tier: UserTier;
  entitlements: Entitlement[];
  createdAt: string;
  updatedAt: string;
  version: number;
  isDeleted: boolean;
}

export interface Subscription {
  id: string;
  companyId: string;
  tier: UserTier;
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trialEndsAt?: string;
  paymentMethodId?: string;
  discountCode?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  provider?: string;
  providerSubscriptionId?: string;
  priceId?: string;
  currency?: string;
  amount?: number;
  renewalType?: 'automatic' | 'manual';
}

export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'reversed' | 'refunded';
export type PaymentType = 'one_time' | 'subscription' | 'renewal' | 'voucher' | 'manual' | 'refund' | 'reversal';
export type PaymentProvider = 'stripe' | 'flouci' | 'manual' | 'voucher' | string;

export interface Payment {
  id: string;
  companyId: string;
  provider: string;
  providerPaymentId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paymentType: PaymentType;
  createdAt: string;
  updatedAt: string;
  version: number;
  subscriptionId?: string;
  invoiceNumber?: string;
  metadata?: Record<string, unknown>;
  retryCount?: number;
  lastError?: string;
}

export type PriceSource =
  | 'OFFICIAL_DEFAULT'
  | 'SUPPLIER_SUBMITTED'
  | 'SUPPLIER_APPROVED'
  | 'CUSTOM';

export interface PriceSourceDef {
  code: PriceSource;
  name: string;
  isVerified: boolean;
  priorityWeight: number;
}

export interface Material {
  id: string;
  code: string;
  trade: string;
  tradeId?: string | null;
  category: string;
  nameFr: string;
  nameAr: string;
  nameEn?: string | null;
  baseUnit: string;
  isOfficial: boolean;
  companyId: string | null;
  technicalSpecs?: string;
  imageUrl?: string;
  standardNorm?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  isDeleted: boolean;
  deletedAt?: string;
}

export interface MaterialPrice {
  id: string;
  materialId: string;
  /**
   * Unit fidelity — the REAL unit the price is quoted in (`materials.base_unit`).
   *
   * Read-path enrichment, NOT a database column: the Drizzle/production path
   * fills it from the `materials` JOIN (`normalizePriceRow` →
   * `unit: row.baseUnit ?? row.unit`) and the in-memory path fills it from the
   * linked material row (see `resolvePriceUnit` in priceRepository.ts), so
   * `GET /api/v1/prices` returns the SAME `unit` in local development and in
   * production. Never a hardcoded fallback: when the material defines no unit
   * the field stays `undefined` and the existing consumer fallbacks apply.
   */
  unit?: string;
  price: number;
  currency: string;
  source: PriceSource;
  market: string;
  countryCode: string;
  supplierId?: string;
  companyId?: string;
  isCurrent: boolean;
  effectiveFrom: string;
  effectiveTo?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  isDeleted: boolean;
}

export interface PackageDefinition {
  id: string;
  materialId: string;
  packageType: 'unit' | 'bundle' | 'box' | 'roll' | 'sac' | 'tube';
  unitsPerPackage: number;
  allowPartial: boolean;
  barcode?: string;
  packageDimensions?: string;
    packageWeightKg?: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export type DevisStatus = 'draft' | 'sent' | 'validated' | 'cancelled';
export type SyncState = 'LOCAL_DIRTY' | 'SYNCED' | 'CONFLICTED';

export interface DevisItem {
  id: string;
  devisId: string;
  lineNumber: number;
  materialId?: string;
  trade: string;
  title: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  total: number;
  unitPriceTnd?: number;
  totalTnd?: number;
  isCustomAdded: boolean;
  supplierReference?: string;
  packageDetailsSnapshot?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface Devis {
  id: string;
  companyId: string;
  createdByUserId: string;
  devisNumber: string;
  reference: string;
  date: string;
  clientName: string;
  clientPhone: string;
  clientAddress: string;
  projectTitle: string;
  country: string;
  currency: string;
  region: string;
  items: DevisItem[];
  subtotalMaterials: number;
  subtotalLabor: number;
  discount: number;
  tvaPercent: number;
  timbreFiscal: number;
  retenueGarantiePercent: number;
  total: number;
  status: DevisStatus;
  syncState: SyncState;
  createdAt: string;
  updatedAt: string;
  version: number;
  isDeleted: boolean;
  deletedAt?: string;
}

export type ImportStatus =
  | 'UPLOADED' | 'PARSED' | 'PENDING_APPROVAL'
  | 'APPROVED' | 'PUBLISHED' | 'REJECTED';

export interface SupplierImport {
  id: string;
  supplierId?: string;
  supplierName?: string;
  fileName: string;
  fileSizeBytes: number;
  fileSha256: string;
  fileMimeType: string;
  status: ImportStatus;
  itemsCount: number;
  parsedAt?: string;
  approvedAt?: string;
  approvedByUserId?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  isDeleted: boolean;
  items: SupplierCatalogItem[];
}

export interface SupplierCatalogItem {
  id: string;
  importId: string;
  materialCode?: string;
  nameFr: string;
  category: string;
  unit: string;
  priceTnd: number;
  tvaIncluded: boolean;
  matchedMaterialId?: string;
  matchedRateId?: string;
  status: 'pending' | 'matched' | 'unmatched' | 'rejected';
  createdAt: string;
  updatedAt: string;
}

export interface ArtisanProfile {
  id: string;
  userId?: string;
  companyName: string;
  trade: string;
  region: string;
  rating: number;
  isVerified: boolean;
  isPro: boolean;
  phone: string;
  whatsapp?: string;
  hourlyRateTnd: number;
  squareMeterRateTnd: number;
  services: string[];
  badges: string[];
  bio: string;
  avatarUrl?: string;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export type EntityType = 'devis' | 'material' | 'price' | 'company';
export type OperationType = 'create' | 'update' | 'delete';
export type SyncStatus = 'pending' | 'applied' | 'conflict' | 'failed';

export interface SyncEntry {
  id: string;
  entityType: EntityType;
  entityId: string;
  operationType: OperationType;
  clientVersion: number;
  serverVersion: number;
  clientTimestamp: string;
  serverTimestamp: string;
  syncStatus: SyncStatus;
  payload: string;
  isDeleted: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

