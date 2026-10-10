/**
 * KONSTRIVO — Display-only catalogue helpers (NO price, NO calculation, NO API/DB logic).
 *
 * The public lists (Outils → Tarifs, Outils → Calculatrice, Services) are fed by
 * three REAL sources only:
 *   1. the trade registry      → GET /api/v1/trades   (official + dynamic trades)
 *   2. the price catalogue     → `rates` (server prices merged with the CSV cache)
 *   3. the CSV/Excel import    → material categories stored in `rates[].category`
 *
 * Those sources may legitimately describe the SAME classification with different
 * spellings ("Aluminium" / "aluminium", "Profilés" / "profiles"), and one single
 * supplier import can register many trade codes that all carry the SAME métier
 * label (observed in production: 21 aluminium categories — profilés, fenêtres,
 * portes, joints, … — all labelled "Aluminium").
 *
 * Rendering that raw list verbatim repeats the same label many times in the UI.
 * These helpers group and de-duplicate FOR DISPLAY ONLY:
 *   - no price is ever created, changed or dropped,
 *   - no category/trade is renamed, deleted or written back anywhere,
 *   - no calculation input is modified.
 * Every original code stays reachable and is still passed unchanged to the
 * existing selection / navigation handlers.
 */

/**
 * Comparison key for a label or a category.
 * Trim + strip accents + lowercase + collapse separators/spaces, so
 * "Aluminium", " aluminium " and "ALUMINIUM" (and "Profilés" vs "profiles")
 * resolve to the same key.
 */
export function catalogKey(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-_./\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when two labels/categories describe the same classification. */
export function sameCatalogKey(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = catalogKey(a);
  return ka !== '' && ka === catalogKey(b);
}

/**
 * Distinct values compared with `catalogKey`, first occurrence wins (data order
 * preserved). Used for the category sections / trade codes so a classification
 * that appears twice with a different spelling yields ONE section.
 */
export function uniqueCatalogValues(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = (raw || '').trim();
    if (!value) continue;
    const key = catalogKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Legible label for a raw trade/category code ("profilés dormants" → "Profilés Dormants"). */
export function prettyCatalogCode(code: string | null | undefined): string {
  // Unicode-aware capitalisation: JavaScript `\b\w` treats "é" as a word
  // boundary ("profilés" → "ProfiléS"), so capitalise the first LETTER of each
  // token with a \S anchor instead.
  return (code || '')
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/(^|\s)(\S)/gu, (_match, separator: string, firstChar: string) => separator + firstChar.toLocaleUpperCase('fr-FR'))
    .trim();
}

export interface CatalogEntry {
  /** Raw trade/category code — passed unchanged to the existing handlers. */
  code: string;
  /** Display label of the métier this code belongs to. */
  label: string;
  /** Optional subtitle already provided by the UI metadata. */
  sub?: string;
  /** Official trades are preferred as the group representative. */
  official?: boolean;
}

/**
 * Display-excluded trade code: the `unmapped_review` import sentinel.
 *
 * A file imported without a métier column files its rows under this review
 * bucket (35 real materials in production). Those rows MUST stay queryable and
 * resolvable — the sentinel is a DATA identity, not a métier — but it must
 * never be offered as a selectable profession in any user-facing trade list
 * (Outils/Calculator, Services, Tarifs sections, Devis trade pickers).
 *
 * Centralised here so every list uses ONE exclusion rule. The registry row,
 * the materials, their prices and the import pipeline are untouched by it.
 */
export const EXCLUDED_SENTINEL_TRADE_CODES: ReadonlySet<string> = new Set(['unmapped_review']);

/** True when a raw trade/category code is a display-excluded sentinel. */
export function isExcludedSentinelTradeCode(code: string | null | undefined): boolean {
  return !!code && EXCLUDED_SENTINEL_TRADE_CODES.has(code.trim().toLowerCase());
}

/**
 * Human métier label test.
 *
 * A registry row is user-meaningful only when `labelFr` is a real métier name
 * DISTINCT from its own machine code. `catalogKey` normalises accents/separators
 * so the comparison is fair (« Aluminium » vs `aluminium`, « Chauffage_Clim »
 * vs `chauffage_clim`). An empty label, or a label that IS the code
 * (`labelFr === code`), is the trace of an import/administration
 * `upsertTradeByCode(code, <no name>)` artefact.
 */
export function hasHumanTradeLabel(
  label: string | null | undefined,
  code: string | null | undefined,
): boolean {
  const labelKey = catalogKey(label);
  if (labelKey === '') return false;
  return labelKey !== catalogKey(code);
}

/**
 * Public catalogue showcase (`Services → « Métiers du catalogue »`) — display-only.
 *
 * That section advertises the ADDITIONAL métiers a supplier catalogue / import
 * brings, so it must render ONLY a trade that is BOTH:
 *   • non-official — the official registry trades (placo, carrelage,
 *     maconnerie, plomberie, electricite, etancheite, isolation, menuiserie,
 *     sols, facade, demolition, peinture) are ALREADY served by the Calculator
 *     and « Nos services »; listing them again here is a duplicate; AND
 *   • human-labelled — `labelFr` carries a readable métier name distinct from
 *     the code. A row whose only identity is its own machine identifier
 *     (`chauffage_climatisation`, `piscine_paysagisme`, `hvac systems`,
 *     `electrical equipment`, `plumbing supplies`, `construction materials`, …)
 *     is an import/administration artefact, not a profession to advertise.
 *
 * Display-only: the registry row, its materials and their prices are never
 * created, renamed, deactivated or written back anywhere — this only decides
 * what the section renders. The official rows therefore stay untouched in the
 * Registry / DB and keep working everywhere else.
 */
const EXCLUDED_PUBLIC_TRADE_LABELS: ReadonlySet<string> = new Set([
  'chauffage climatisation',
  'chauffage clim',
  'chauffage climatisation btp',
  'ferronnerie metallerie',
  'ferronnerie metallerie btp',
  'piscine paysagisme',
  'platre traditionnel staff',
]);

/**
 * User-requested public-display exclusions. This is deliberately a UI-only
 * filter: it does not mutate the registry, catalogue rows, prices, or DB.
 * Both human labels and machine codes are checked because imports can expose
 * the same trade through either field.
 */
export function isExcludedPublicTradeLabel(
  label: string | null | undefined,
  code?: string | null,
): boolean {
  const normalize = (value: string | null | undefined) => catalogKey(value)
    .replace(/&/g, ' ')
    .replace(/\bet\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [label, code].some((value) => {
    const key = normalize(value);
    if (!key) return false;
    if (EXCLUDED_PUBLIC_TRADE_LABELS.has(key)) return true;
    return [...EXCLUDED_PUBLIC_TRADE_LABELS].some((excluded) => key.includes(excluded));
  });
}

export function isDisplayableCatalogueTrade(trade: {
  code: string;
  labelFr?: string | null;
  isOfficial?: boolean;
}): boolean {
  if (trade.isOfficial) return false;
  if (isExcludedPublicTradeLabel(trade.labelFr, trade.code)) return false;
  return hasHumanTradeLabel(trade.labelFr, trade.code);
}

export interface CatalogGroup {
  /** Normalised métier key (group identity). */
  key: string;
  /** Métier label — rendered exactly ONCE per group. */
  label: string;
  sub?: string;
  /** Every code belonging to this métier, in data order. */
  codes: string[];
  /** Code that represents the group (best match for the label, official first). */
  primaryCode: string;
}

/**
 * Group entries that share the same métier label into a single section.
 *
 * Group order follows first appearance; codes keep their original order and are
 * never rewritten. A group with a single code behaves exactly like the previous
 * one-card-per-code rendering.
 */
export function groupCatalogEntries(entries: CatalogEntry[]): CatalogGroup[] {
  const groups = new Map<string, CatalogGroup>();
  const order: string[] = [];
  const byCode = new Map<string, CatalogEntry>();

  for (const entry of entries) {
    const code = (entry.code || '').trim();
    if (!code) continue;
    if (!byCode.has(code)) byCode.set(code, { ...entry, code });
    const label = (entry.label || '').trim() || code;
    const key = catalogKey(label) || catalogKey(code);
    let group = groups.get(key);
    if (!group) {
      group = { key, label, sub: entry.sub, codes: [], primaryCode: code };
      groups.set(key, group);
      order.push(key);
    }
    if (!group.codes.includes(code)) group.codes.push(code);
    if (!group.sub && entry.sub) group.sub = entry.sub;
  }

  for (const key of order) {
    const group = groups.get(key)!;
    const members = group.codes.map((code) => byCode.get(code)!).filter(Boolean);
    // Representative: the métier's OWN code (label == code) when it exists,
    // official first; then any official code; then the first code.
    group.primaryCode =
      members.find((e) => e.official && sameCatalogKey(e.code, key))?.code ??
      members.find((e) => sameCatalogKey(e.code, key))?.code ??
      members.find((e) => e.official)?.code ??
      group.codes[0];
  }

  return order.map((key) => groups.get(key)!);
}
