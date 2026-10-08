/**
 * Phase D — Data-driven trade ↔ service association.
 *
 * Services are associated with trades through configuration, NOT hardcoded in
 * calculation logic. Adding a new trade's services = adding an entry here.
 * No new source code, no new strategy class, no new if/branch required.
 *
 * This map is the single source of truth for which services a trade exposes
 * (e.g. in the calculator UI, devis line suggestions, or service discovery).
 * It can later be replaced/augmented by a DB column without changing consumers.
 */

export interface TradeServiceConfig {
  /** Service label shown to the user (French). */
  labelFr: string;
  /** Service label shown to the user (Arabic). */
  labelAr: string;
  /** Optional default unit for pricing this service. */
  defaultUnit?: 'm²' | 'ml' | 'unit' | 'forfait' | 'point';
  /** Optional suggested labor rate (DT/unit) — purely a UI default. */
  suggestedRateTnd?: number;
}

/** Canonical services per trade. Official trades + any dynamic trade entry. */
export const TRADE_SERVICES: Record<string, TradeServiceConfig[]> = {
  placo: [
    { labelFr: 'Pose de cloisons sèches', labelAr: 'تركيب جدران جافة', defaultUnit: 'm²', suggestedRateTnd: 18 },
    { labelFr: 'Faux plafonds BA13', labelAr: 'أسقف صناعية جبس', defaultUnit: 'm²', suggestedRateTnd: 20 },
    { labelFr: 'Doublage mural collé', labelAr: 'عزل جدار لاصق', defaultUnit: 'm²', suggestedRateTnd: 16 },
    { labelFr: 'Caisson retombée', labelAr: 'إضاءة مخفية', defaultUnit: 'ml', suggestedRateTnd: 25 },
  ],
  peinture: [
    { labelFr: 'Préparation de surface', labelAr: 'تحضير السطح', defaultUnit: 'm²', suggestedRateTnd: 5 },
    { labelFr: 'Peinture acrylique intérieure', labelAr: 'دهان أكريليك داخلي', defaultUnit: 'm²', suggestedRateTnd: 8 },
    { labelFr: 'Peinture satinée', labelAr: 'دهان ساتان', defaultUnit: 'm²', suggestedRateTnd: 10 },
    { labelFr: 'Enduit décoratif', labelAr: 'جص ديكوري', defaultUnit: 'm²', suggestedRateTnd: 15 },
  ],
  carrelage: [
    { labelFr: 'Pose droite carrelage', labelAr: 'تبليط مستقيم', defaultUnit: 'm²', suggestedRateTnd: 22 },
    { labelFr: 'Pose diagonale', labelAr: 'تبليط قطري', defaultUnit: 'm²', suggestedRateTnd: 28 },
    { labelFr: 'Jointoiement', labelAr: 'حشو الفواصل', defaultUnit: 'm²', suggestedRateTnd: 4 },
  ],
  maconnerie: [
    { labelFr: 'Maçonnerie brique', labelAr: 'بناء بالطوب', defaultUnit: 'm²', suggestedRateTnd: 15 },
    { labelFr: 'Maçonnerie bloc béton', labelAr: 'بناء بالبلوك', defaultUnit: 'm²', suggestedRateTnd: 18 },
    { labelFr: 'Enduit ciment', labelAr: 'جص إسمنتي', defaultUnit: 'm²', suggestedRateTnd: 12 },
  ],
  plomberie: [
    { labelFr: 'Réseau PPR', labelAr: 'شبكة PPR', defaultUnit: 'point', suggestedRateTnd: 45 },
    { labelFr: 'Évacuation PVC', labelAr: 'صرف PVC', defaultUnit: 'ml', suggestedRateTnd: 20 },
    { labelFr: 'Robinetterie', labelAr: 'سباكة وتركيب', defaultUnit: 'unit', suggestedRateTnd: 35 },
  ],
  electricite: [
    { labelFr: 'Câblage éclairage', labelAr: 'أسلاك الإنارة', defaultUnit: 'point', suggestedRateTnd: 25 },
    { labelFr: 'Prises de courant', labelAr: 'مآخذ كهرباء', defaultUnit: 'point', suggestedRateTnd: 20 },
    { labelFr: 'Tableau électrique', labelAr: 'لوحة كهربائية', defaultUnit: 'unit', suggestedRateTnd: 150 },
  ],
  etancheite: [
    { labelFr: 'Membrane bitumineuse', labelAr: 'غشاء بيتوميني', defaultUnit: 'm²', suggestedRateTnd: 18 },
    { labelFr: 'Résine liquide', labelAr: 'راتنج سائل', defaultUnit: 'm²', suggestedRateTnd: 22 },
  ],
  isolation: [
    { labelFr: 'Isolation thermique laine de verre', labelAr: 'عزل حراري صوف زجاجي', defaultUnit: 'm²', suggestedRateTnd: 14 },
    { labelFr: 'Polystyrène expansé', labelAr: 'بولسترين ممدد', defaultUnit: 'm²', suggestedRateTnd: 12 },
  ],
  menuiserie: [
    { labelFr: 'Pose de portes', labelAr: 'تركيب أبواب', defaultUnit: 'unit', suggestedRateTnd: 60 },
    { labelFr: 'Pose de fenêtres', labelAr: 'تركيب نوافذ', defaultUnit: 'unit', suggestedRateTnd: 80 },
  ],
  sols: [
    { labelFr: 'Pose parquet stratifié', labelAr: 'تركيب باركيه', defaultUnit: 'm²', suggestedRateTnd: 12 },
    { labelFr: 'Béton ciré', labelAr: 'إسمنت مصقول', defaultUnit: 'm²', suggestedRateTnd: 35 },
  ],
  facade: [
    { labelFr: 'Enduit monocouche', labelAr: 'جص أحادي الطبقة', defaultUnit: 'm²', suggestedRateTnd: 18 },
    { labelFr: 'Peinture façade', labelAr: 'دهان واجهة', defaultUnit: 'm²', suggestedRateTnd: 12 },
  ],
  demolition: [
    { labelFr: 'Démolition cloisons', labelAr: 'هدم جدران', defaultUnit: 'm²', suggestedRateTnd: 8 },
    { labelFr: 'Évacuation gravats', labelAr: 'نقل الأنقاض', defaultUnit: 'm²', suggestedRateTnd: 6 },
  ],
  // Dynamic trades can be added here without any code change elsewhere.
  gypsum: [
    { labelFr: 'Installation plaques de plâtre', labelAr: 'تركيب ألواح الجبس', defaultUnit: 'm²', suggestedRateTnd: 16 },
    { labelFr: 'Jointage et finition', labelAr: 'حشو وتشطيب', defaultUnit: 'm²', suggestedRateTnd: 10 },
    { labelFr: 'Sanding / Ponçage', labelAr: 'صنفرة', defaultUnit: 'm²', suggestedRateTnd: 6 },
  ],
};

/**
 * Resolve services for a trade from the local configuration map.
 * Synchronous — used for immediate rendering. For DB-backed resolution,
 * use `loadServicesForTrade` instead.
 */
export function getServicesForTrade(tradeCode: string): TradeServiceConfig[] {
  const key = (tradeCode || '').toLowerCase();
  if (TRADE_SERVICES[key]) return TRADE_SERVICES[key];
  // Generic fallback: one installation + one finishing service, derived from the code.
  // This is a UI safety net ONLY — the primary source is the DB (see loadServicesForTrade).
  return [
    { labelFr: `Installation ${tradeCode}`, labelAr: `تركيب ${tradeCode}`, defaultUnit: 'm²', suggestedRateTnd: 15 },
    { labelFr: `Finition ${tradeCode}`, labelAr: `تشطيب ${tradeCode}`, defaultUnit: 'm²', suggestedRateTnd: 10 },
  ];
}

/**
 * Phase D — resolve services for a trade from ALL sources, with the database
 * as the authoritative source for dynamic trades.
 *
 * Resolution order:
 *   1. Database (trade_services table) — authoritative for dynamic trades
 *   2. Local config map (TRADE_SERVICES) — for official trades / overrides
 *   3. Generic fallback — UI safety net only
 *
 * Returns null when the database is unavailable (caller should use
 * getServicesForTrade as a synchronous fallback).
 */
export async function loadServicesForTrade(
  tradeId: string | null | undefined,
  tradeCode: string,
): Promise<TradeServiceConfig[] | null> {
  // 1. Try database first (authoritative for dynamic trades)
  if (tradeId) {
    try {
      const { listTradeServices } = await import('../lib/api');
      const dbServices = await listTradeServices(tradeId);
      if (dbServices && dbServices.length > 0) {
        return dbServices.map((s: any) => ({
          labelFr: s.nameFr,
          labelAr: s.nameAr || '',
          defaultUnit: s.defaultUnit || 'm²',
          suggestedRateTnd: s.suggestedRateTnd ?? undefined,
        }));
      }
    } catch {
      // DB unavailable — fall through to config map
    }
  }
  // 2. Fall back to local config map (which also has its own generic fallback)
  return getServicesForTrade(tradeCode);
}
