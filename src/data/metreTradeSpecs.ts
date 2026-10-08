/**
 * PHASE 2.1 — EXTENSIBLE MÉTRÉ DATA CONTRACT (ADDITIVE ONLY, METADATA ONLY).
 *
 * `MetreTradeSpec` DESCRIBES a métier for the future direct UX:
 *   Métier → Type de travail → métier-specific form → MetreEngine → bindings.
 *
 * HARD CONTRACTS (proved by tests/metreTradeSpec.test.ts):
 *   - UI/DATA METADATA ONLY: this module NEVER imports `metreEngine` and the
 *     engine NEVER imports this module — no trade branch can reach the engine.
 *   - The engine's calculation for any element is byte-identical whether or
 *     not a trade spec / work-type descriptor exists (inert by construction).
 *   - `defaultWastePercent` / `defaultMethod` are DISPLAY-ONLY pre-fill hints
 *     for the UI; they are never fed into `evaluateElement`.
 *   - Work-type descriptors (`MetreWorkTypeSpec`, Phase 1 contract — NOT
 *     redesigned) are attached to EXISTING registry elements through a
 *     side-car lookup so `METRE_ELEMENTS` objects stay byte-identical and the
 *     Phase 1 regression suites remain unchanged.
 *   - Everything is fail-closed: an invalid descriptor resolves to `null`
 *     (never to a silent default, never to a calculation change).
 *
 * NOT in this phase: no new work types, no new calc operators, no UI, no DB
 * rows, no bindings data, no Direct UX (Phase 2.2+).
 */
import type { MetreMethod, MetreWorkTypeSpec } from './metreElements';
import {
  isValidMetreWorkTypeSpec,
  isMetreMethod,
  normalizeTradeKey,
} from './metreElements';

/**
 * Métier-level metadata (descriptive only). Everything except the identity
 * triple is optional — an absent field is always valid.
 */
export interface MetreTradeSpec {
  /** Stable métier code (matches the registry key, e.g. 'plomberie'). */
  code: string;
  labelFr: string;
  labelAr: string;
  /**
   * Display order of this métier's work types (element codes). Ordering only —
   * codes that do not exist in the registry are ignored by consumers.
   */
  workTypeOrder?: string[];
  /** DISPLAY-ONLY default waste % (UI pre-fill). Never read by the engine. */
  defaultWastePercent?: number;
  /** DISPLAY-ONLY default measurement method (UI pre-fill). Never read by the engine. */
  defaultMethod?: MetreMethod;
}

/**
 * Fail-closed validator: ABSENT = valid; a present spec must carry the
 * identity triple plus well-typed optional metadata. Never coerces.
 */
export function isValidMetreTradeSpec(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  if (typeof s.code !== 'string' || !s.code.trim()) return false;
  if (typeof s.labelFr !== 'string' || !s.labelFr.trim()) return false;
  if (typeof s.labelAr !== 'string') return false;
  if (s.workTypeOrder !== undefined && s.workTypeOrder !== null) {
    if (!Array.isArray(s.workTypeOrder)) return false;
    if (!s.workTypeOrder.every((c) => typeof c === 'string' && !!String(c).trim())) return false;
  }
  if (s.defaultWastePercent !== undefined && s.defaultWastePercent !== null) {
    const w = s.defaultWastePercent;
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) return false;
  }
  if (s.defaultMethod !== undefined && s.defaultMethod !== null && !isMetreMethod(s.defaultMethod)) {
    return false;
  }
  return true;
}

/**
 * Métier-level specs for the 3 proof trades of Phase 2.1 (existing trades,
 * existing elements only — no work type invented). Pure data.
 */
export const METRE_TRADE_SPECS: Readonly<Record<string, MetreTradeSpec>> = {
  placo: {
    code: 'placo',
    labelFr: 'PLACO / PLÂTRE',
    labelAr: 'جبس وبلاطور',
    workTypeOrder: ['panneau_ba13'],
    defaultMethod: 'surface',
  },
  plomberie: {
    code: 'plomberie',
    labelFr: 'PLOMBERIE',
    labelAr: 'سباكية',
    workTypeOrder: ['reseau_ppr'],
    defaultMethod: 'longueur',
  },
  aluminium: {
    code: 'aluminium',
    labelFr: 'Menuiserie Aluminium',
    labelAr: 'ألمنيوم',
    workTypeOrder: [
      'porte', 'fenetre', 'baie_vitree', 'coulissant', 'chassis',
      'profil', 'vitrage', 'corniere', 'joint', 'quincaillerie', 'consommable',
    ],
    defaultMethod: 'surface',
  },
};

/** Métier-level spec lookup — fail-closed (invalid entry resolves to null). */
export function getMetreTradeSpec(tradeCode: string | null | undefined): MetreTradeSpec | null {
  const key = normalizeTradeKey(tradeCode);
  const spec = key ? METRE_TRADE_SPECS[key] : undefined;
  if (!spec) return null;
  return isValidMetreTradeSpec(spec) ? spec : null;
}
// ════════════════════════════════════════════════════════════════════════════
// PHASE 2.1 — WORK-TYPE DESCRIPTORS for EXISTING elements (Phase 1 contract,
// attached side-car so `METRE_ELEMENTS` objects stay byte-identical).
// Only 3 existing elements carry a descriptor: placo/panneau_ba13,
// plomberie/reseau_ppr, aluminium/porte. Metadata only — never evaluated.
// ════════════════════════════════════════════════════════════════════════════

export const METRE_WORK_TYPE_SPECS: Readonly<Record<string, Readonly<Record<string, MetreWorkTypeSpec>>>> = {
  placo: {
    panneau_ba13: {
      code: 'panneau_ba13',
      labelFr: 'Panneau BA13 — pose',
      labelAr: 'لوح جبس 13 مم — تركيب',
      measurementMethod: 'surface',
      methodology: 'Mesurer la surface nette de chaque baie (Largeur × Hauteur × Nb). Les ouvertures, déductions, couches, couverture et chute suivent la chaîne existante du moteur.',
      norms: ['NF EN 520', 'DTU 58.1'],
      validationHints: ['Contrôler l’épaisseur de la plaque (12.5 mm par défaut)', 'Confirmer l’entraxe des montants avant relevé'],
      durationHint: { value: 0.15, unit: 'h/m²' },
    },
  },
  plomberie: {
    reseau_ppr: {
      code: 'reseau_ppr',
      labelFr: 'Réseau PPR',
      labelAr: 'شبكة PPR',
      measurementMethod: 'longueur',
      methodology: 'Relevé des longueurs de tube PPR par tronçon en mètres linéaires (ml). Points d’eau et appareils comptés séparément.',
      norms: ['NF EN 15874', 'DTU 60.11'],
      validationHints: ['Indiquer le diamètre du tube avant relevé', 'Signaler les traversées de mur et les saignées'],
      durationHint: { value: 0.3, unit: 'h/ml' },
    },
    // B7-BATCH1 — descriptors (metadata only, never evaluated). No norms.
    evacuation_pvc: {
      code: 'evacuation_pvc',
      labelFr: 'Évacuation PVC',
      labelAr: 'صرف PVC',
      measurementMethod: 'longueur',
      methodology: 'Relevé des longueurs de tube PVC par tronçon en mètres linéaires (ml).',
      validationHints: ['Indiquer le diamètre du tube avant relevé', 'Signaler les traversées et les chutes'],
    },
    point_eau: {
      code: 'point_eau',
      labelFr: "Point d'eau",
      labelAr: 'نقطة ماء',
      measurementMethod: 'unite',
      methodology: 'Comptage des points d’eau (arrivées/évacuations) à l’unité.',
      validationHints: ['Compter chaque point d’eau séparément', 'Préciser appareil sanitaire desservi'],
    },
  },
  aluminium: {
    porte: {
      code: 'porte',
      labelFr: 'Porte aluminium',
      labelAr: 'باب ألمنيوم',
      measurementMethod: 'surface',
      methodology: 'Surface = Largeur × Hauteur × Nombre, par bloc porte (m²).',
      norms: ['EN 14351-1', 'NF P 34-300'],
      validationHints: ['Relevé par baie, cadre compris', 'Saisir le nombre de blocs identiques dans Nb'],
      durationHint: { value: 1.5, unit: 'h/unité' },
    },
  },
  // B7.1 — PEINTURE descriptor (metadata only, never evaluated). No norms:
  // DTU 59.1 / NF EN 13300 exist only in test fixtures, not production.
  peinture: {
    mur_interieur: {
      code: 'mur_interieur',
      labelFr: 'Mur intérieur — peinture',
      labelAr: 'جدار داخلي — دهان',
      measurementMethod: 'surface',
      methodology: 'Mesurer la largeur et la hauteur de chaque pan de mur et le nombre de pans identiques, puis calculer la surface en m² (Largeur × Hauteur × Nb).',
      validationHints: ['Relevé par pan de mur, hors plinthes si non peintes', 'Déduire les portes et fenêtres au relevé'],
    },
  },
  // B7-BATCH1 — descriptors (metadata only, never evaluated). Practical
  // methodology + hints only. No norms: none verified in project source.
  carrelage: {
    sol_carrelage: {
      code: 'sol_carrelage',
      labelFr: 'Sol carrelage',
      labelAr: 'أرضية مبلطة',
      measurementMethod: 'surface',
      methodology: 'Mesurer la longueur et la largeur de chaque surface de sol et le nombre de surfaces identiques, puis calculer la surface en m² (Longueur × Largeur × Nb).',
      validationHints: ['Relevé par pièce, hors plinthes', 'Déduire les seuils non carrelés au relevé'],
    },
  },
  etancheite: {
    terrasse_membrane: {
      code: 'terrasse_membrane',
      labelFr: 'Terrasse — membrane',
      labelAr: 'شرفة — غشاء عازل',
      measurementMethod: 'surface',
      methodology: 'Mesurer la longueur et la largeur de chaque terrasse et le nombre de surfaces identiques, puis calculer la surface en m² (Longueur × Largeur × Nb).',
      validationHints: ['Relevé par pan de terrasse', 'Signaler les relevés verticaux et les évacuations'],
    },
  },
  isolation: {
    mur_laine: {
      code: 'mur_laine',
      labelFr: 'Mur — laine de verre',
      labelAr: 'جدار — صوف زجاجي',
      measurementMethod: 'surface',
      methodology: 'Mesurer la largeur et la hauteur de chaque pan de mur et le nombre de pans identiques, puis calculer la surface en m² (Largeur × Hauteur × Nb).',
      validationHints: ['Relevé par pan de mur', 'Déduire les ouvertures au relevé'],
    },
  },
  sols: {
    parquet_piece: {
      code: 'parquet_piece',
      labelFr: 'Pièce — parquet',
      labelAr: 'غرفة — باركيه',
      measurementMethod: 'surface',
      methodology: 'Mesurer la longueur et la largeur de chaque pièce et le nombre de pièces identiques, puis calculer la surface en m² (Longueur × Largeur × Nb).',
      validationHints: ['Relevé par pièce, hors plinthes', 'Déduire les seuils au relevé'],
    },
  },
  demolition: {
    demolition_cloison: {
      code: 'demolition_cloison',
      labelFr: 'Cloison — démolition',
      labelAr: 'جدار — هدم',
      measurementMethod: 'surface',
      methodology: 'Mesurer la largeur et la hauteur de chaque cloison à démolir et le nombre de cloisons identiques, puis calculer la surface en m² (Largeur × Hauteur × Nb).',
      validationHints: ['Relevé par cloison, hors éléments conservés', 'Signaler les réseaux encastrés avant démolition'],
    },
  },
  electricite: {
    prise_16a: {
      code: 'prise_16a',
      labelFr: 'Prise 16A',
      labelAr: 'مقبس 16 أمبير',
      measurementMethod: 'unite',
      methodology: 'Comptage des prises 16A à l’unité.',
      validationHints: ['Compter chaque prise séparément', 'Préciser encastrée ou apparente'],
    },
  },
  maconnerie: {
    mur_brique: {
      code: 'mur_brique',
      labelFr: 'Mur brique',
      labelAr: 'جدار آجر',
      measurementMethod: 'surface',
      methodology: 'Mesurer la largeur et la hauteur de chaque pan de mur et le nombre de pans identiques, puis calculer la surface en m² (Largeur × Hauteur × Nb). Quantité de briques non calculée ici.',
      validationHints: ['Relevé par pan de mur', 'Déduire les ouvertures au relevé'],
    },
  },
};

/**
 * Fail-closed resolver: raw descriptor → valid `MetreWorkTypeSpec` or null.
 *
 * RESOLVE semantics (≠ the Phase 1 shape validator): a descriptor must be
 * PRESENT **and** valid. The Phase 1 validator legitimately answers
 * "absent = valid" (it validates an optional attachment), so presence is
 * checked explicitly here — undefined/null/missing entries resolve to `null`,
 * NEVER to `undefined` and never to a silent default.
 */
export function resolveWorkTypeSpec(raw: unknown): MetreWorkTypeSpec | null {
  if (raw === undefined || raw === null) return null;
  if (!isValidMetreWorkTypeSpec(raw)) return null;
  return raw as MetreWorkTypeSpec;
}

/**
 * Descriptor of a work type (element) for a métier — validates on read, so a
 * malformed entry degrades to `null` (the UI then renders the element without
 * descriptor metadata; the calculation is untouched either way).
 */
export function getWorkTypeSpec(
  tradeCode: string | null | undefined,
  elementCode: string | null | undefined,
): MetreWorkTypeSpec | null {
  const key = normalizeTradeKey(tradeCode);
  const code = String(elementCode ?? '').trim();
  if (!key || !code) return null;
  const byElement = METRE_WORK_TYPE_SPECS[key];
  if (!byElement) return null;
  return resolveWorkTypeSpec(byElement[code]);
}

