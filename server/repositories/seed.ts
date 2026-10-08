/**
 * Phase 2 — Seed Data
 *
 * Converts existing frontend data (DEFAULT_MARKET_RATES, INITIAL_ARTISANS,
 * INITIAL_MARKETPLACE_PRODUCTS) into Phase 2 API entities.
 * Material identity and pricing remain SEPARATE.
 */
import { DEFAULT_MARKET_RATES } from '../../src/data/marketRates';
import { INITIAL_ARTISANS, INITIAL_MARKETPLACE_PRODUCTS } from '../../src/data/mockSaaSData';
import { config } from '../config';
import { Material, MaterialPrice, PriceSourceDef, ArtisanProfile } from '../types';
import { generateId } from '../utils/crypto';

const now = () => new Date().toISOString();

/** Official price sources (canonical). */
export const PRICE_SOURCES: PriceSourceDef[] = [
  { code: 'OFFICIAL_DEFAULT', name: 'KONSTRIVO Official Barème 2026', isVerified: true, priorityWeight: 100 },
  { code: 'SUPPLIER_SUBMITTED', name: 'Supplier Submitted (pending approval)', isVerified: false, priorityWeight: 50 },
  { code: 'SUPPLIER_APPROVED', name: 'Supplier Approved', isVerified: true, priorityWeight: 80 },
  { code: 'CUSTOM', name: 'Company Custom Price', isVerified: false, priorityWeight: 10 },
];

/**
 * Seed Materials + MaterialPrices from DEFAULT_MARKET_RATES.
 * Material identity and pricing are kept separate.
 */
export function buildMaterialsFromRates(): { materials: Material[]; prices: MaterialPrice[] } {
  // In production we must NOT seed materials/prices from frontend defaults.
  // Return empty arrays so that production relies on PostgreSQL canonical data.
  if (config.isProduction) {
    return { materials: [], prices: [] };
  }
  const materials: Material[] = [];
  const prices: MaterialPrice[] = [];
  const timestamp = now();

  for (const rate of DEFAULT_MARKET_RATES) {
    const material: Material = {
      id: rate.id,
      code: rate.id,
      trade: rate.category,
      category: rate.category,
      nameFr: rate.nameFr,
      nameAr: rate.nameAr,
      nameEn: rate.nameEn ?? null,
      baseUnit: rate.unit,
      isOfficial: true,
      companyId: null,
      technicalSpecs: rate.note,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      isDeleted: false,
    };
    materials.push(material);

    const price: MaterialPrice = {
      id: `price_${rate.id}`,
      materialId: rate.id,
      // Unit fidelity — a price is ALWAYS quoted in its material's base unit.
      // Carrying `material.baseUnit` here (instead of leaving the row unit-less)
      // is what makes the in-memory `/api/v1/prices` payload equivalent to the
      // Drizzle path, which fills `unit` from the `materials.base_unit` JOIN.
      // Generic by construction: the value comes from the material itself, never
      // from a hardcoded/unit-per-trade table.
      unit: material.baseUnit,
      price: rate.unitPriceTnd,
      currency: 'TND',
      source: 'OFFICIAL_DEFAULT',
      market: 'tn',
      countryCode: 'TN',
      isCurrent: true,
      effectiveFrom: '2026-01-01',
      notes: rate.defaultPriceTnd !== rate.unitPriceTnd
        ? `Default: ${rate.defaultPriceTnd} TND`
        : undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      isDeleted: false,
    };
    prices.push(price);
  }

  return { materials, prices };
}

/**
 * Seed Artisan Profiles from INITIAL_ARTISANS.
 * Strips private user info (email, etc.) for public API exposure.
 */
export function buildArtisansFromMock(): ArtisanProfile[] {
  // Do not expose mocked artisans in production — return empty.
  if (config.isProduction) return [];
  const timestamp = now();
  return INITIAL_ARTISANS.map(a => ({
    id: a.id,
    userId: undefined, // not linked to an authenticated user in Phase 2
    companyName: a.company,
    trade: a.trade,
    region: a.region,
    rating: a.rating,
    isVerified: a.isVerified,
    isPro: a.isPro2026,
    phone: a.phone,
    whatsapp: a.whatsapp,
    hourlyRateTnd: a.hourlyRateTnd,
    squareMeterRateTnd: a.squareMeterRateTnd,
    services: [...a.services],
    badges: [...a.badges],
    bio: a.bio,
    avatarUrl: a.avatar,
    isDeleted: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}

/**
 * Build a Supplier entity from a MarketProduct (for supplier imports context).
 */
export function buildSuppliersFromProducts() {
  return INITIAL_MARKETPLACE_PRODUCTS.map(p => ({
    id: `sup_${p.id}`,
    name: p.supplierName,
    legalRegistrationNumber: '',
    countryCode: 'TN',
    contactPhone: p.supplierPhone,
    isVerified: true,
    verificationStatus: 'verified',
    region: p.supplierLocation,
    address: p.supplierLocation,
  }));
}
