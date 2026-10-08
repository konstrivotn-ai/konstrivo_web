/**
 * Canonical Website domain type entry point.
 *
 * Phase 1 keeps the existing per-file imports working while providing a
 * single stable import surface for future /api/v1 integration.
 */
export type {
  Availability,
  Material,
  MaterialCatalogEntry,
  MaterialRequirement,
  MaterialUnit,
  TradeCategory,
  Unit,
} from "./materials";

export { CANONICAL_MATERIAL_UNITS, UNITS } from "./materials";

export type {
  CanonicalMaterialPriceUnit,
  CanonicalPriceSourceCode,
  CustomMaterialPriceInput,
  EffectivePrice,
  MaterialPrice,
  Price,
  PriceResolution,
  PriceRow,
  PriceSource,
  PriceSourceKind,
  PriceStatus,
} from "./pricing";
