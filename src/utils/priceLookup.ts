import { MaterialRate } from '../types';
import { DEFAULT_MARKET_RATES } from '../data/marketRates';

/**
 * Unit-fidelity fix — the ONLY place a server/CSV unit is turned into a
 * `MaterialRate.unit`.
 *
 * THE BUG THIS REPLACES: the previous `toRateUnit()` accepted the closed
 * `MaterialRate['unit']` union by STRICT string equality and silently returned
 * `'unit'` for everything else. A CSV catalog using the real units
 * `m / m² / Unit / Kg / Litre / Set` therefore lost `m`, `Kg`, `Litre`, `Set`
 * (and every case variant) at the moment the server prices were merged, and
 * `calculateGeneric` then priced them as the neutral equipment quantity
 * `1 unit` — wrong unit AND wrong quantity in Outils.
 *
 * Units are now matched case-/accent-/separator-insensitively and the REAL
 * unit is preserved. `SERVER_UNIT_ALIASES` holds every spelling actually seen
 * in imports (plus the canonical DB forms); a string that matches nothing is
 * still mapped to the documented safe default `'unit'` (never a blind cast).
 * Alias keys are compared after `normalizeUnitKey()`:
 * BOM/zero-width stripped, accents removed, lower-cased, '.', '-' and runs of
 * spaces collapsed to a single '_'.
 */
function normalizeUnitKey(raw: string | null | undefined): string {
  return String(raw ?? '')
    .replace(/^[\uFEFF\u200B\u200C\u200D]+/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[\s.\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Canonical unit ← every real spelling of it (keys are `normalizeUnitKey()`-ed). */
const SERVER_UNIT_ALIASES: Record<string, MaterialRate['unit']> = (() => {
  const map: Record<string, MaterialRate['unit']> = {};
  const add = (unit: MaterialRate['unit'], aliases: string[] = []) => {
    map[normalizeUnitKey(unit)] = unit;
    for (const a of aliases) {
      const key = normalizeUnitKey(a);
      if (!(key in map)) map[key] = unit;
    }
  };
  // Count / non-surface piece and set (equipment, kit, assembly)
  add('unit', ['u', 'pcs', 'piece', 'pieces', 'pce', 'each', 'unite', 'unite_mesure', 'unite_vente']);
  add('set', ['sets', 'kit', 'kits', 'lot', 'lots']);
  // Surface
  add('m²', ['m2', 'metre_carre', 'metre2', 'sqm', 'sq_m']);
  // Volume
  add('m³', ['m3', 'metre_cube', 'metre3', 'cubic_meter']);
  // Length — 'm' is kept verbatim, 'metre'/'metre_' map to the accented union form
  add('m', []);
  add('mètre', ['metre', 'meter', 'meters', 'metres', 'longueur']);
  add('ml', ['mlg', 'metre_lineaire', 'linear_meter', 'lm']);
  // Mass
  add('kg', ['kgs', 'kilogramme', 'kilogrammes', 'kilo', 'kilos']);
  add('litre', ['litres', 'liter', 'liters', 'l', 'lt']);
  // Packaging / pieces
  add('sac', ['sacs', 'bag', 'bags', 'sack']);
  add('boite', ['boites', 'box', 'carton', 'paquet', 'boite_de_500']);
  add('boite_1000', ['boite_de_1000', 'box_1000', 'boite_1000_pcs']);
  add('rouleau', ['rouleaux', 'roll', 'rolls']);
  add('tube', ['tubes', 'cartouche', 'cartouches']);
  add('point', ['points', 'pt', 'pts']);
  add('panneau', ['panneaux', 'panel', 'panels']);
  return map;
})();

/**
 * Preserve the REAL server/CSV unit as a `MaterialRate.unit`.
 * Returns the documented safe default `'unit'` only when the string matches no
 * known unit (and for null/undefined/empty).
 */
export function normalizeRateUnit(unit: string | null | undefined): MaterialRate['unit'] {
  const key = normalizeUnitKey(unit);
  if (key === '') return 'unit';
  return SERVER_UNIT_ALIASES[key] ?? 'unit';
}

/**
 * Step 5 — Material ID bridge.
 *
 * The Calculator looks up prices by the LEGACY slug (e.g. `plaque_ba13_standard`)
 * that it hardcodes. PostgreSQL stores that slug in `materials.code` while
 * `materials.id` is a UUID. The prices API now returns `code` alongside each
 * price (server-side JOIN), so the lookup key is `code` when present.
 *
 * `priceKey` falls back to `materialId` so the SAME logic also works against
 * the in-memory repository (dev mode), where `materialId` IS the legacy slug
 * and no `code` field exists. One function, both paths.
 */
export function priceKey(p: { code?: string | null; materialId?: string | null }): string {
  return p.code ?? p.materialId ?? '';
}
/**
 * Step 5b — Canonical catalog code ↔ calculator business ID (PLACO / PLÂTRE ONLY).
 *
 * The production PostgreSQL price catalog identifies PLACO materials with
 * canonical hyphenated `materials.code` values (e.g. `plaque-ba13-standard-3m`,
 * `fourrure-f47`), while the Calculator and DEFAULT_MARKET_RATES look prices up
 * by the legacy underscore business IDs (e.g. `plaque_ba13_standard`,
 * `fourrure`). The prices API returns the canonical `code` verbatim, so
 * `buildPriceMap` expands every canonical code into the business id(s) the
 * calculator actually resolves (`priceKeysFor`).
 *
 * STRICT SCOPE:
 *  - This table maps IDENTIFIERS ONLY — it never carries or invents prices.
 *  - Codes WITHOUT an alias keep their raw key: every other trade (carrelage,
 *    peinture, ...), every other market (FR, MY, SA, ...) and the memory/dev
 *    path (where `materialId` already IS the legacy slug) are untouched.
 *  - No DB schema, API contract, auth or calculation-formula change.
 */
export const CANONICAL_PLACO_CODE_ALIASES: Record<string, string | string[]> = {
  // ── Plaques de plâtre / ciment ────────────────────────────────────────────
  'plaque-ba13-standard-3m': 'plaque_ba13_standard',   // BA13 1.20×3.00m
  'plaque-ba13-standard-2m5': 'plaque_ba13_standard',  // BA13 1.20×2.50m (single BA13 rate; plate size is a calculator input, not a separate rate)
  'plaque-ba13-hydro': 'plaque_ba13_hydrofuge',
  'plaque-ba13-coupe-feu': 'plaque_ba13_coupe_feu',
  'plaque-ciment': ['plaque_aquapanel_ciment', 'plaque_aquapanel_exterieur'], // outdoor cement board slots (NOT the distinct interior tile-backer rate)
  // ── Ossature métallique ───────────────────────────────────────────────────
  'rail-48': 'rail_48',
  'rail-70': 'rail_70',
  'montant-48': 'montant_48',
  'montant-70': 'montant_70',
  'fourrure-f47': 'fourrure',
  'corniere-3m': ['corniere_rive_L', 'corniere_angle'], // same 3m L-profile slot in plafond démontable / faux plafond / caisson
  // ── Grille plafond démontable ─────────────────────────────────────────────
  'porteur-t24': 'porteur_3600',
  'entretoise-t24-1.20': 'entretoise_1200',
  'entretoise-t24-0.60': 'entretoise_600',
  'dalle-60x60': 'dalle_vinyl_60x60',
  // ── Finition / fixations / isolation ──────────────────────────────────────
  'bande-joint': 'bande_a_joint_90m',
  'bande-arm': 'bande_a_joint_90m',                    // joint tape slot (paper / armée share the single calculator slot)
  'enduit-25kg': 'enduit_joint_25kg',
  'enduit-colle-25': 'colle_gypse_25kg',
  'vis-placo-1000': 'vis_placo_25',
  'vis-trpf-1000': 'vis_trpf',
  'vis-ciment-1000': 'vis_aquapanel',
  'laine-verre-12': 'laine_de_verre_50mm',
};

// Additional, minimal non-PLACO aliases discovered during audit.
// These map a canonical hyphenated `materials.code` to the legacy calculator
// id the calculators actually look up. Only add explicit mappings where a
// semantic & dimensional match exists (no price invention).
export const CANONICAL_ADDITIONAL_ALIASES: Record<string, string | string[]> = {
  // Plinthes used by the Carrelage calculator map to the canonical MDF plinthes
  // row (2.4m pieces) in DEFAULT_MARKET_RATES.
  'plinthes-mdf-decor-2-4m': 'plinthes_carrelage',
};

/**
 * Expand a server-side price key into the business id(s) the Calculator looks
 * up. Keys without a canonical alias pass through unchanged.
 */
export function priceKeysFor(key: string): string[] {
  const alias = CANONICAL_PLACO_CODE_ALIASES[key];
  if (alias) return Array.isArray(alias) ? alias : [alias];
  const alias2 = CANONICAL_ADDITIONAL_ALIASES[key];
  if (alias2) return Array.isArray(alias2) ? alias2 : [alias2];

  // Generic, safe fallback for non-PLACO trades:
  // Only transform hyphenated canonical keys to underscores when the
  // resulting legacy slug exists in the in-code catalog or appears as a
  // target alias for PLACO. This avoids converting unrelated hyphenated
  // identifiers (UUIDs, opaque external ids, etc.).
  if (key.includes('-')) {
    const candidate = key.replace(/-/g, '_');
    const knownIds = new Set(DEFAULT_MARKET_RATES.map(r => r.id));
    // collect alias targets from the explicit PLACO alias table
    const aliasTargets = new Set<string>();
    for (const v of Object.values(CANONICAL_PLACO_CODE_ALIASES)) {
      if (Array.isArray(v)) for (const s of v) aliasTargets.add(s);
      else aliasTargets.add(v);
    }
    if (knownIds.has(candidate) || aliasTargets.has(candidate)) return [candidate];
  }

  return [key];
}

/**
 * Price + trade info resolved from the normalized server price list.
 *
 * Phase D — carries the authoritative trade relationship (tradeId + trade code)
 * so the frontend can resolve dynamic-trade materials correctly instead of
 * hardcoding `category: 'placo'`.
 */
export interface ResolvedPrice {
  price: number;
  trade: string | null;
  tradeId: string | null;
  /** Real material data from the server price row (materials JOIN). Optional:
   *  memory-only / legacy rows don't carry them — callers keep their fallbacks. */
  nameFr?: string | null;
  nameAr?: string | null;
  nameEn?: string | null;
  unit?: string | null;
  category?: string | null;
}

/**
 * Build a `Map<legacySlug, number>` from the normalized server price list.
 *
 * Selection rules (unchanged business logic, just keyed by legacy slug):
 *  - candidates: `isCurrent === true` OR effective window covers `now`
 *  - tiebreak: newest `updatedAt`, then highest `version`
 *
 * Pure function — no React, no DB — so it is unit-testable in isolation.
 *
 * NOTE: This is the backward-compatible form. Use `buildPriceMapWithTrade` when
 * you also need the authoritative trade relationship (Phase D dynamic trades).
 */
export function buildPriceMap(serverPrices: any[]): Map<string, number> {
  // Backward-compatible form: strip trade info, keep only price.
  const withTrade = buildPriceMapWithTrade(serverPrices);
  const result = new Map<string, number>();
  for (const [key, resolved] of withTrade.entries()) {
    result.set(key, resolved.price);
  }
  return result;
}

/**
 * Phase D — build a `Map<legacySlug, ResolvedPrice>` from the normalized
 * server price list. Carries the authoritative trade relationship so
 * `mergeRates` can assign the correct category to dynamic-trade materials.
 *
 * Selection rules are identical to `buildPriceMap`.
 */
export function buildPriceMapWithTrade(
  serverPrices: any[],
  /**
   * P2 — optional market currency preference. One market may legally hold
   * several currency rows for the same material (e.g. TN: TND + EUR); when the
   * caller pins the market's official currency, a candidate quoted in that
   * currency wins over a newer one quoted in another currency. Omitted →
   * previous behaviour unchanged.
   */
  preferredCurrency?: string | null
): Map<string, ResolvedPrice> {
  const preferred = preferredCurrency ? String(preferredCurrency).trim().toUpperCase() : '';
  const now = Date.now();
  const byKey = new Map<string, any[]>();
  for (const p of serverPrices) {
    if (!p) continue;
    const key = priceKey(p);
    if (!key) continue;
    // Step 5b — canonical PLACO catalog codes expand to the calculator's
    // business id(s); everything else keeps its raw key (unchanged behavior).
    for (const k of priceKeysFor(key)) {
      const arr = byKey.get(k) || [];
      arr.push(p);
      byKey.set(k, arr);
    }
  }

  const priceMap = new Map<string, ResolvedPrice>();
  for (const [key, entries] of byKey.entries()) {
    const candidates = entries.filter((p: any) => {
      if (p.isCurrent) return true;
      try {
        const from = p.effectiveFrom ? Date.parse(p.effectiveFrom) : NaN;
        const to = p.effectiveTo ? Date.parse(p.effectiveTo) : NaN;
        if (!isNaN(from) && (isNaN(to) || now <= to) && now >= from) return true;
      } catch {}
      return false;
    });
    if (candidates.length === 0) continue;
    candidates.sort((a: any, b: any) => {
      // P2 — currency preference first (only when a preferred currency was
      // requested), then the unchanged newest-updatedAt / version tiebreak.
      if (preferred) {
        const am = String(a.currency || '').toUpperCase() === preferred ? 1 : 0;
        const bm = String(b.currency || '').toUpperCase() === preferred ? 1 : 0;
        if (am !== bm) return bm - am;
      }
      const ta = a.updatedAt ? Date.parse(a.updatedAt) : (a.createdAt ? Date.parse(a.createdAt) : 0);
      const tb = b.updatedAt ? Date.parse(b.updatedAt) : (b.createdAt ? Date.parse(b.createdAt) : 0);
      if (ta !== tb) return tb - ta;
      const va = typeof a.version === 'number' ? a.version : parseInt(a.version || '0', 10) || 0;
      const vb = typeof b.version === 'number' ? b.version : parseInt(b.version || '0', 10) || 0;
      return vb - va;
    });
    const chosen = candidates[0];
    if (chosen && typeof chosen.price === 'number') {
      priceMap.set(key, {
        price: chosen.price,
        trade: chosen.trade ?? null,
        tradeId: chosen.tradeId ?? null,
        // Carry the real material identity (CSV data imported in the DB) so
        // `mergeRates` never has to invent "Server price (...)" placeholders.
        nameFr: chosen.nameFr,
        nameAr: chosen.nameAr,
        nameEn: chosen.nameEn,
        unit: chosen.unit ?? chosen.baseUnit,
        category: chosen.category,
      });
    }
  }
  return priceMap;
}

/**
 * Identity of a material across BOTH live paths — case, spaces, '-' and '_' are
 * the only differences they may legitimately carry (see `mergeRates`).
 * Applied to ids only; it NEVER rewrites an id, a price or a unit.
 */
function rateIdentityKey(id: string | null | undefined): string {
  return String(id ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/**
 * Merge a server price map into the local `rates` array (Step 3 priority:
 * a valid server price for a slug ALWAYS wins over the cached value for the
 * same slug; server-only slugs are appended so they stay visible).
 *
 * Phase D — server-only materials now receive their ACTUAL trade (from the
 * `ResolvedPrice.trade` / `tradeId`) instead of a hardcoded `category: 'placo'`.
 * This fixes the critical bug where database-sourced dynamic-trade materials
 * were mis-categorized and invisible to the generic calculator.
 *
 * Pure function — unit-testable.
 */
export function mergeRates(prev: MaterialRate[], priceMap: Map<string, ResolvedPrice>): MaterialRate[] {
  if (priceMap.size === 0) return prev;
  const prevById = new Map(prev.map(r => [r.id, r]));
  // Identity bridge — the two live paths name the SAME material differently:
  //   • hardware/DB path: the price key is `materials.code` VERBATIM
  //     (e.g. `ALU-001`, `profil-aluminium-3m`), because `priceKeysFor()` keeps
  //     the raw key for every code that is not one of the hardcoded PLACO
  //     canonical aliases;
  //   • calculator/cache path: the rate id is `slugifyMaterialId(code)`
  //     (lower-cased, separators → `_`, e.g. `alu_001`, `profil_aluminium_3m`).
  // The historical strict `priceMap.has(r.id)` therefore NEVER matched an
  // imported dynamic material: the cached rate was left untouched (keeping its
  // old — possibly wrong — `unit`, e.g. `unit` instead of `m`) and the server
  // row was appended as a SECOND duplicate line. The normalized identity below
  // links them without renaming any id, rewriting any cache or touching the DB.
  const priceByIdentity = new Map<string, ResolvedPrice>();
  for (const [key, resolved] of priceMap.entries()) {
    const identity = rateIdentityKey(key);
    if (!priceByIdentity.has(identity)) priceByIdentity.set(identity, resolved);
  }
  const consumedIdentities = new Set<string>();
  const updated: MaterialRate[] = [];
  for (const r of prev) {
    const identity = rateIdentityKey(r.id);
    // Tier 1a — exact id (legacy behaviour, server price priority, unchanged).
    // Tier 1b — the SAME material under the other id spelling (ALU-001 ↔ alu_001).
    const resolved = priceMap.get(r.id) ?? priceByIdentity.get(identity);
    if (resolved) {
      consumedIdentities.add(identity);
      const next: MaterialRate = { ...r, unitPriceTnd: resolved.price };
      // Enrich identity with REAL server/CSV data when present. Identity is
      // only ever replaced by real data — never by a placeholder — so cached
      // barème names are preserved whenever the server row has none.
      if (resolved.nameFr) {
        next.nameFr = r.nameFr || resolved.nameFr;
        next.nameAr = r.nameAr || resolved.nameAr || '';
        next.nameEn = r.nameEn || resolved.nameEn || null;
      }
      if (resolved.unit) next.unit = normalizeRateUnit(resolved.unit);
      if (resolved.category) next.category = resolved.category;
      updated.push(next);
    } else {
      updated.push(r);
    }
  }
  for (const [key, resolved] of priceMap.entries()) {
    // Skip anything already reached through the identity bridge — otherwise the
    // same material would appear twice (cached line + server line).
    if (!prevById.has(key) && !consumedIdentities.has(rateIdentityKey(key))) {
      // Phase D — use the authoritative trade/category from the server price
      // row. Falls back to the legacy `trade` code, then to a neutral
      // 'dynamic' category only if no trade info is available at all.
      // P2 — an EMPTY category must never win over the trade code: an imported
      // row may store category as '' (or as a supplier family label) while the
      // authoritative trade code lives in `trade`. The trade code is kept on the
      // entry so the generic calculator (calculateGeneric) can always resolve the
      // imported material for its trade instead of showing the "Matériau <trade>"
      // placeholder.
      const tradeCategory = (resolved.category || resolved.trade || 'dynamic');
      const tradeCode = (resolved.trade || resolved.category || '').trim();
      updated.push({
        id: key,
        category: tradeCategory,
        trade: tradeCode || undefined,
        // Real CSV/DB material data when available — no invented placeholders.
        nameFr: resolved.nameFr || `Server price (${tradeCategory})`,
        nameAr: resolved.nameAr || '',
        nameEn: resolved.nameEn || null,
        unit: normalizeRateUnit(resolved.unit),
        unitPriceTnd: resolved.price,
        defaultPriceTnd: resolved.price,
      });
    }
  }
  return updated;
}