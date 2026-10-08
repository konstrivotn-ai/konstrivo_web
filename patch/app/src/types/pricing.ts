import type { MaterialUnit, Unit } from "./materials";

export type PriceStatus = "draft" | "active" | "archived";

export type PriceSourceKind = "manual" | "import" | "migration" | "dealer";

/** Canonical source identifiers used by /api/v1/prices. */
export type CanonicalPriceSourceCode =
  | "OFFICIAL_KONSTRIVO_2026"
  | "SUPPLIER_IMPORT"
  | "ARTISAN_CUSTOM"
  | "REGIONAL_SURVEY"
  | string;

export interface PriceSource {
  id: string;
  code?: CanonicalPriceSourceCode;
  name: string;
  kind: PriceSourceKind;
  isVerified?: boolean;
  priorityWeight?: number;
  supplier?: string | null;
  note?: string | null;
  createdAt: string;
}

/**
 * Canonical dynamic pricing entity.
 * Material identity is deliberately kept separate from its rate.
 */
export interface MaterialPrice {
  id: string;
  materialId: string;
  sourceCode: CanonicalPriceSourceCode;
  countryCode: string;
  currencyCode: string;
  unitPrice: number;
  isCurrent: boolean;
  effectiveFrom: string;

  effectiveTo?: string | null;
  packageDefinitionId?: string | null;
  packagePrice?: number | null;
  supplierCatalogItemId?: string | null;
  companyId?: string | null;
  supplierId?: string | null;
  notes?: string | null;

  createdAt: string;
  updatedAt: string;
  version: number;
  isDeleted: boolean;
}

/**
 * Legacy local persistence shape.
 * Kept temporarily so existing repositories/calculation code can continue
 * to consume the localStorage/database representation during Phase 1.
 * New API code must use MaterialPrice.
 */
export interface Price {
  id: string;
  materialId: string;
  sourceId: string;
  priceHT: number;
  tvaRate: number;
  tvaAmount: number;
  priceTTC: number;
  currency: string;
  unit: Unit;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: PriceStatus;
  observedAt: string;
  createdAt: string;
  updatedAt?: string;
}

export interface EffectivePrice {
  materialId: string;
  sourceId: string;
  priceHT: number;
  tvaRate: number;
  tvaAmount: number;
  priceTTC: number;
  currency: string;
  unit: Unit;
}

export type PriceResolution =
  | { status: "available"; price: EffectivePrice }
  | { status: "unavailable"; materialId: string; reason: string };

export interface PriceRow {
  material_id: string;
  source_id: string;
  price_ht: string | number;
  tva_rate: string | number;
  tva_amount: string | number;
  price_ttc: string | number;
  currency: string;
  unit: string;
  status: string;
  effective_from: string | Date;
  effective_to: string | Date | null;
  observed_at: string | Date;
  updated_at?: string | Date;
}

/** Canonical API-facing price payload for a custom company override. */
export interface CustomMaterialPriceInput {
  materialId: string;
  customUnitPriceTnd: number;
  notes?: string;
  countryCode?: string;
  currencyCode?: string;
  effectiveFrom?: string;
}

export type CanonicalMaterialPriceUnit = MaterialUnit;
