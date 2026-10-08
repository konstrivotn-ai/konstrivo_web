/**
 * Canonical material units exposed by the v1 API.
 * Keep the existing legacy units below for local calculator compatibility.
 */
export const CANONICAL_MATERIAL_UNITS = [
  "unit",
  "ml",
  "m2",
  "kg",
  "box",
  "roll",
  "bag",
] as const;

export type MaterialUnit = (typeof CANONICAL_MATERIAL_UNITS)[number];

export const UNITS = [
  "piece",
  "m",
  "m2",
  "m3",
  "kg",
  "liter",
  "box",
  "bag",
  "roll",
  "cartouche",
  "unit",
] as const;

export type Unit = (typeof UNITS)[number];

export type Availability = "available" | "unavailable";

export type TradeCategory =
  | "placo"
  | "peinture"
  | "carrelage"
  | "maconnerie"
  | "electricite"
  | "plomberie"
  | "isolation"
  | "etancheite";

/**
 * A single line produced by a Calculation Strategy.
 * It contains ONLY materialId + quantity + unit.
 * It NEVER contains a price. Prices are resolved later by PriceRepository.
 */
export interface MaterialRequirement {
  materialId: string;
  quantity: number;
  unit: Unit;
  label?: string;
  note?: string;
}

/**
 * Canonical catalog identity.
 *
 * IMPORTANT: Material contains no price fields. Dynamic rates belong to
 * MaterialPrice in pricing.ts. The legacy display/search fields remain
 * optional so the existing UI and localStorage data keep working unchanged.
 */
export interface Material {
  id: string;
  code: string;
  trade: TradeCategory;
  category: string;
  nameFr: string;
  nameAr: string;
  nameDerja: string;
  baseUnit: MaterialUnit;
  isOfficial: boolean;

  technicalSpecs?: Record<string, unknown> | null;
  imageUrl?: string | null;
  standardNorm?: string | null;
  companyId?: string | null;

  createdAt?: string;
  updatedAt?: string;
  version?: number;
  isDeleted?: boolean;
  deletedAt?: string | null;

  /** Legacy compatibility: do not use for new API contracts. */
  name?: string;
  normalizedName: string;
  brand?: string | null;
  dimensions?: string | null;
  unit?: Unit;
  system?: string | null;
}

/** Static catalog metadata (no prices). Used by strategies + seed data. */
export interface MaterialCatalogEntry {
  code: string;
  name: string;
  unit: Unit;
  category?: string;
  brand?: string;
  dimensions?: string;
}
