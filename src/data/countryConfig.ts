import { CountryCode, CountryConfig, CurrencyCode, KnownCountryCode, KnownCurrencyCode } from '../types';
import type { ReferenceCountryRow, ReferenceCurrencyRow, ReferenceFxRateRow, ReferenceTaxRuleRow } from '../lib/api';
import { listReferenceCountries, listReferenceCurrencies, listReferenceFxRates, listReferenceTaxRules } from '../lib/api';

/**
 * LOCAL FALLBACK country profiles (never deleted — see the registry below).
 * The runtime registry starts from these values synchronously, then hydrates
 * from `GET /reference/countries` (API-first). This table is what renders —
 * and keeps rendering — whenever the reference API is unreachable.
 */
export const COUNTRIES_CONFIG: Record<KnownCountryCode, CountryConfig> = {
  TN: {
    code: 'TN',
    nameFr: 'Tunisie',
    nameAr: 'تونس',
    flag: '🇹🇳',
    defaultCurrency: 'TND',
    supportedCurrencies: ['TND', 'EUR', 'USD'],
    defaultVatRate: 19,
    vatRates: [
      { rate: 19, label: '19% (Taux Standard BTP Tunisie)' },
      { rate: 13, label: '13% (Taux Intermédiaire)' },
      { rate: 7, label: '7% (Régime Artisans & Patentes)' },
      { rate: 0, label: '0% (Exonéré / Net H.T)' }
    ],
    timbreFiscalDefault: 1.000,
    timbreLabel: '1.000 DT (Timbre Fiscal)',
    standardRetenueRate: 5,
    buildingCodes: 'DTU Tunisie / Normes NT 2026',
    unitSystem: 'metric'
  },
  FR: {
    code: 'FR',
    nameFr: 'France',
    nameAr: 'فرنسا',
    flag: '🇫🇷',
    defaultCurrency: 'EUR',
    supportedCurrencies: ['EUR', 'USD'],
    defaultVatRate: 20,
    vatRates: [
      { rate: 20, label: '20% (TVA Normal Travaux Neufs)' },
      { rate: 10, label: '10% (TVA Rénovation / Amélioration)' },
      { rate: 5.5, label: '5.5% (Rénovation Énergétique RGE)' },
      { rate: 0, label: '0% (Franchise en base / Auto-entrepreneur)' }
    ],
    timbreFiscalDefault: 0.0,
    timbreLabel: '0.00 € (Pas de timbre)',
    standardRetenueRate: 5,
    buildingCodes: 'NF DTU / Eurocodes / RE2020',
    unitSystem: 'metric'
  },
  DZ: {
    code: 'DZ',
    nameFr: 'Algérie',
    nameAr: 'الجزائر',
    flag: '🇩🇿',
    defaultCurrency: 'DZD',
    supportedCurrencies: ['DZD', 'EUR', 'USD'],
    defaultVatRate: 19,
    vatRates: [
      { rate: 19, label: '19% (TVA Standard BTP Algérie)' },
      { rate: 9, label: '9% (Taux Réduit Travaux Spéciaux)' },
      { rate: 0, label: '0% (Exonéré)' }
    ],
    timbreFiscalDefault: 100.0,
    timbreLabel: '100 DZD (Timbre de Quittance)',
    standardRetenueRate: 5,
    buildingCodes: 'DTR BTP Algérie / CNERIB',
    unitSystem: 'metric'
  },
  SA: {
    code: 'SA',
    nameFr: 'Arabie Saoudite',
    nameAr: 'المملكة العربية السعودية',
    flag: '🇸🇦',
    defaultCurrency: 'SAR',
    supportedCurrencies: ['SAR', 'USD'],
    defaultVatRate: 15,
    vatRates: [
      { rate: 15, label: '15% (ضريبة القيمة المضافة ZATCA VAT)' },
      { rate: 0, label: '0% (معفى / مسكن أول مدعوم)' }
    ],
    timbreFiscalDefault: 0.0,
    timbreLabel: '0.00 SAR',
    standardRetenueRate: 5,
    buildingCodes: 'كود البناء السعودي (SBC 2026)',
    unitSystem: 'metric'
  },
  AE: {
    code: 'AE',
    nameFr: 'Émirats Arabes Unis',
    nameAr: 'الإمارات العربية المتحدة',
    flag: '🇦🇪',
    defaultCurrency: 'AED',
    supportedCurrencies: ['AED', 'USD'],
    defaultVatRate: 5,
    vatRates: [
      { rate: 5, label: '5% (Standard UAE VAT FTA)' },
      { rate: 0, label: '0% (Designated Free Zones)' }
    ],
    timbreFiscalDefault: 0.0,
    timbreLabel: '0.00 AED',
    standardRetenueRate: 5,
    buildingCodes: 'Dubai Building Code / UAE Fire & Safety',
    unitSystem: 'metric'
  },
  US: {
    code: 'US',
    nameFr: 'États-Unis',
    nameAr: 'الولايات المتحدة',
    flag: '🇺🇸',
    defaultCurrency: 'USD',
    supportedCurrencies: ['USD', 'EUR'],
    defaultVatRate: 8.25,
    vatRates: [
      { rate: 8.25, label: '8.25% (State & Local Sales Tax)' },
      { rate: 6.0, label: '6.00% (Reduced Material Tax)' },
      { rate: 0, label: '0% (Contractor Direct Resale Exemption)' }
    ],
    timbreFiscalDefault: 0.0,
    timbreLabel: '$0.00',
    standardRetenueRate: 10,
    buildingCodes: 'IBC / IRC / ASTM / OSHA 1926',
    unitSystem: 'imperial'
  },
  GLOBAL: {
    code: 'GLOBAL',
    nameFr: 'International / Multi-Pays',
    nameAr: 'نظام عالمي موحد',
    flag: '🌍',
    defaultCurrency: 'USD',
    supportedCurrencies: ['USD', 'EUR', 'TND', 'SAR', 'AED', 'DZD'],
    defaultVatRate: 15,
    vatRates: [
      { rate: 20, label: '20% (Standard International VAT)' },
      { rate: 15, label: '15% (Standard Regional VAT)' },
      { rate: 10, label: '10% (Reduced Tax)' },
      { rate: 5, label: '5% (Low VAT)' },
      { rate: 0, label: '0% (Tax Exempt)' }
    ],
    timbreFiscalDefault: 0.0,
    timbreLabel: '0.00',
    standardRetenueRate: 5,
    buildingCodes: 'ISO 21542 / International Building Code',
    unitSystem: 'metric'
  }
};

// Local fallback — 1 TND in other currencies (2026 economic conditions).
// Valid rows from `GET /reference/fx-rates?base=TND` override this at runtime;
// the table itself is kept as the offline/no-DB fallback (never deleted).
export const EXCHANGE_RATES_FROM_TND: Record<KnownCurrencyCode, number> = {
  TND: 1.0,
  EUR: 0.295,
  DZD: 43.80,
  SAR: 1.21,
  AED: 1.18,
  USD: 0.322
};

// Local fallback metas for the 6 legacy currencies — LOCAL-FIRST at runtime
// (TND must keep its 3 decimals); `/reference/currencies` only ADDS codes this
// table does not know.
export const CURRENCY_SYMBOLS: Record<KnownCurrencyCode, { symbol: string; label: string; decimals: number }> = {
  TND: { symbol: 'DT', label: 'Dinar Tunisien', decimals: 3 },
  EUR: { symbol: '€', label: 'Euro', decimals: 2 },
  DZD: { symbol: 'DA', label: 'Dinar Algérien', decimals: 2 },
  SAR: { symbol: 'SR', label: 'Riyal Saoudien', decimals: 2 },
  AED: { symbol: 'AED', label: 'Dirham Émirati', decimals: 2 },
  USD: { symbol: '$', label: 'US Dollar', decimals: 2 }
};

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — API-first country/currency registry (runtime, ADDITIVE)
//
// Contract:
//   • The registry is SEEDED synchronously from the local fallbacks above, so
//     the very first render — and every render while the API is down — is
//     byte-identical to today (TN behaviour preserved, offline included).
//   • ensureCountryReferenceLoaded() merges GET /reference/countries,
//     /currencies, /fx-rates?base=TND and /tax-rules (API-first): a NEW
//     country/currency/FX rate becomes usable with ZERO client code changes.
//   • Safety rules: fiscal fields (defaultVatRate/vatRates/timbre*/retenue) of
//     FALLBACK countries are never overridden (fiscal owner stays the local
//     fallback + user state — same contract as the Rules Bridge); legacy
//     currency metas are local-first (TND keeps 3 decimals); the country LIST
//     is a union (the API can ADD countries, a partial response can never hide
//     the current ones); junk FX rows are ignored and TND is pinned to 1.
//   • Merge is per-endpoint: a failed endpoint simply leaves its fallback.
// ─────────────────────────────────────────────────────────────────────────────

interface CurrencyMeta { symbol: string; label: string; decimals: number; }

type RegistryListener = () => void;
const registryListeners = new Set<RegistryListener>();
let registryVersion = 0;

/** Runtime maps — shallow-seeded from the local fallbacks (value objects shared). */
const runtimeCountries: Record<string, CountryConfig> = { ...COUNTRIES_CONFIG };
const runtimeExchangeRates: Record<string, number> = { ...EXCHANGE_RATES_FROM_TND };
const runtimeCurrencyMeta: Record<string, CurrencyMeta> = { ...CURRENCY_SYMBOLS };

function notifyRegistry(): void {
  registryVersion++;
  registryListeners.forEach(listener => listener());
}

/** Subscribe to registry hydration (App re-renders the tree when data lands). */
export function subscribeCountryRegistry(listener: RegistryListener): () => void {
  registryListeners.add(listener);
  return () => { registryListeners.delete(listener); };
}

export function getCountryRegistryVersion(): number { return registryVersion; }

/** Exact lookup — same semantics as the old `COUNTRIES_CONFIG[code]` (may be undefined). */
export function findCountryConfig(code: CountryCode): CountryConfig | undefined {
  return runtimeCountries[String(code)];
}

/** Unified accessor with the historical `|| TN` fallback semantics. */
export function getCountryConfig(code: CountryCode): CountryConfig {
  return runtimeCountries[String(code)] || COUNTRIES_CONFIG.TN;
}

/** Selector options: fallback order first, API-only countries appended (union). */
export function listCountryOptions(): CountryConfig[] {
  return Object.values(runtimeCountries);
}

/** Currency meta with the old `|| { symbol, decimals: 2 }` semantics (+ label). */
export function getCurrencyMeta(currency: CurrencyCode): CurrencyMeta {
  const code = String(currency);
  return runtimeCurrencyMeta[code] || { symbol: code, label: code, decimals: 2 };
}

/** Live TND-base rate: valid DB row when merged, else local fallback; TND → 1. */
export function getExchangeRateFromTnd(currency: CurrencyCode): number {
  const code = String(currency);
  if (code === 'TND') return 1.0; // base identity — never taken from data
  return runtimeExchangeRates[code] || 1.0;
}

export function convertFromTnd(amountInTnd: number, targetCurrency: CurrencyCode): number {
  // Method unchanged (amount × TND-base rate, unknown → 1.0); the RATE is now
  // read from the registry (DB `/reference/fx-rates` when available, else local).
  return amountInTnd * getExchangeRateFromTnd(targetCurrency);
}

export function formatPrice(amount: number, currency: CurrencyCode, country?: CountryCode): string {
  // Signature/behaviour unchanged; the meta now resolves through the registry.
  const meta = getCurrencyMeta(currency);
  return `${amount.toFixed(meta.decimals)} ${meta.symbol}`;
}

// ── Reference merge (pure data-in → registry-out; NO formulas touched) ──────

const VALID_COUNTRY_CODE = /^[A-Z]{2,5}$/;
const VALID_CURRENCY_CODE = /^[A-Z]{3,5}$/;

function toFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeCurrencyCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toUpperCase();
  return VALID_CURRENCY_CODE.test(v) ? v : undefined;
}

function text(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/** Valid entries of `supported_currencies` (jsonb array or JSON string). */
function parseSupportedCurrencies(raw: unknown): CurrencyCode[] | undefined {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch { /* invalid jsonb → ignore */ }
  }
  const out: CurrencyCode[] = [];
  for (const item of list) {
    const code = normalizeCurrencyCode(item);
    if (code && out.indexOf(code) === -1) out.push(code);
  }
  return out.length > 0 ? out : undefined;
}

function flagFor(code: string, apiFlag: unknown): string {
  const explicit = text(apiFlag);
  if (explicit) return explicit;
  if (/^[A-Z]{2}$/.test(code)) {
    return String.fromCodePoint(0x1f1e6 + (code.charCodeAt(0) - 65), 0x1f1e6 + (code.charCodeAt(1) - 65));
  }
  return '🌍';
}

/** `tax_rules` rows of ONE country → fiscal CONFIG for a NEW country only. */
function summarizeTaxRules(rows: ReferenceTaxRuleRow[] | undefined, currency: string) {
  const vatRates: Array<{ rate: number; label: string }> = [];
  let defaultVatRate: number | undefined;
  let timbre: { value: number; label: string } | undefined;
  let retenue: number | undefined;
  for (const row of rows || []) {
    const rate = toFiniteNumber(row?.rate);
    if (rate === undefined) continue;
    const type = String(row?.taxType || '').toUpperCase();
    if (type.includes('VAT') || type.includes('TVA')) {
      vatRates.push({ rate, label: text(row?.labelFr) || `${rate}%` });
      if (row?.isDefault) defaultVatRate = rate;
    } else if (type.includes('TIMBRE')) {
      timbre = { value: rate, label: text(row?.labelFr) || `${rate} ${currency}` };
    } else if (type.includes('RETENUE')) {
      retenue = rate;
    }
  }
  vatRates.sort((a, b) => b.rate - a.rate);
  return {
    vatRates,
    defaultVatRate: defaultVatRate !== undefined
      ? defaultVatRate
      : (vatRates[0] !== undefined ? vatRates[0].rate : undefined),
    timbre,
    retenue,
  };
}

function mergeCountryRows(rows: ReferenceCountryRow[], taxByCountry: Record<string, ReferenceTaxRuleRow[]>): boolean {
  let changed = false;
  for (const row of rows) {
    if (!row) continue;
    const code = text(row.code).toUpperCase();
    if (!VALID_COUNTRY_CODE.test(code)) continue;
    const fb = code in COUNTRIES_CONFIG ? COUNTRIES_CONFIG[code as KnownCountryCode] : undefined;
    const defCur = normalizeCurrencyCode(row.defaultCurrency) || fb?.defaultCurrency || 'TND';
    const apiSupported = parseSupportedCurrencies(row.supportedCurrencies);
    const nameFr = text(row.nameFr) || fb?.nameFr || code;
    const nameAr = text(row.nameAr) || text(row.nameFr) || fb?.nameAr || code;
    const flag = text(row.flag) || (fb ? fb.flag : flagFor(code, undefined));
    const buildingCodes = text(row.buildingCodes) || fb?.buildingCodes || '';
    const unitSystem = row.unitSystem === 'imperial'
      ? 'imperial'
      : row.unitSystem === 'metric' ? 'metric' : (fb?.unitSystem || 'metric');

    if (fb) {
      // KNOWN country — the API may refresh descriptive fields (name/flag/
      // currencies/units/codes), but FISCAL POLICY IS FROZEN on the local
      // fallback: defaultVatRate / vatRates / timbre* / standardRetenueRate
      // never change here (TN behaviour + req "no fiscal change").
      const supported = apiSupported ? [...apiSupported] : [...fb.supportedCurrencies];
      if (supported.indexOf(defCur) === -1) supported.unshift(defCur);
      const existing = runtimeCountries[code];
      const unchanged = existing !== undefined
        && existing.nameFr === nameFr && existing.nameAr === nameAr && existing.flag === flag
        && existing.defaultCurrency === defCur && existing.buildingCodes === buildingCodes
        && existing.unitSystem === unitSystem
        && existing.supportedCurrencies.join('|') === supported.join('|');
      if (!unchanged && existing) {
        runtimeCountries[code] = {
          ...existing,
          nameFr, nameAr, flag,
          defaultCurrency: defCur,
          supportedCurrencies: supported,
          buildingCodes,
          unitSystem,
        };
        changed = true;
      }
    } else {
      // NEW country — fully data-driven: API row + tax_rules for the fiscal
      // config (options list only; Devis/Calculator formulas are untouched).
      const tax = summarizeTaxRules(taxByCountry[code], defCur);
      const defaultVatRate = tax.defaultVatRate ?? toFiniteNumber(row.defaultVatRate) ?? 0;
      const timbreValue = tax.timbre?.value ?? toFiniteNumber(row.timbreFiscalDefault) ?? 0;
      runtimeCountries[code] = {
        code,
        nameFr, nameAr, flag,
        defaultCurrency: defCur,
        supportedCurrencies: apiSupported ? apiSupported : [defCur],
        defaultVatRate,
        vatRates: tax.vatRates.length > 0 ? tax.vatRates : [{ rate: defaultVatRate, label: `${defaultVatRate}%` }],
        timbreFiscalDefault: timbreValue,
        timbreLabel: tax.timbre?.label || `${timbreValue} ${defCur}`,
        standardRetenueRate: tax.retenue ?? toFiniteNumber(row.standardRetenueRate) ?? 0,
        buildingCodes,
        unitSystem,
      };
      changed = true;
    }
  }
  return changed;
}

function mergeCurrencyRows(rows: ReferenceCurrencyRow[]): boolean {
  let changed = false;
  for (const row of rows) {
    if (!row) continue;
    const code = text(row.code).toUpperCase();
    if (!VALID_CURRENCY_CODE.test(code)) continue;
    // Legacy metas are LOCAL-FIRST (TND must keep its 3 decimals) — the API
    // only ADDS currencies the fallback table does not know.
    if (code in CURRENCY_SYMBOLS) continue;
    const current = runtimeCurrencyMeta[code];
    const decimalsRaw = toFiniteNumber(row.decimals);
    const decimals = decimalsRaw !== undefined && decimalsRaw >= 0 && decimalsRaw <= 6
      ? Math.round(decimalsRaw)
      : (current ? current.decimals : 2);
    const next: CurrencyMeta = {
      symbol: text(row.symbol) || (current ? current.symbol : code),
      label: text(row.label) || (current ? current.label : code),
      decimals,
    };
    if (!current || current.symbol !== next.symbol || current.label !== next.label || current.decimals !== next.decimals) {
      runtimeCurrencyMeta[code] = next;
      changed = true;
    }
  }
  return changed;
}

function mergeFxRows(rows: ReferenceFxRateRow[]): boolean {
  let changed = false;
  for (const row of rows) {
    if (!row) continue;
    if (text(row.baseCurrency).toUpperCase() !== 'TND') continue; // convertFromTnd is TND-based
    const quote = normalizeCurrencyCode(row.quoteCurrency);
    if (!quote || quote === 'TND') continue;
    const rate = toFiniteNumber(row.rate);
    if (rate === undefined || rate <= 0) continue; // never accept (nor invent) junk
    if (runtimeExchangeRates[quote] !== rate) {
      runtimeExchangeRates[quote] = rate; // valid DB row wins over the local fallback
      changed = true;
    }
  }
  if (runtimeExchangeRates.TND !== 1.0) {
    runtimeExchangeRates.TND = 1.0;
    changed = true;
  }
  return changed;
}

export interface CountryReferencePayload {
  countries?: ReferenceCountryRow[] | null;
  currencies?: ReferenceCurrencyRow[] | null;
  fxRates?: ReferenceFxRateRow[] | null;
  taxRules?: ReferenceTaxRuleRow[] | null;
}

/**
 * Merge one batch of `/reference/*` payloads into the registry (idempotent).
 * NULL/undefined endpoint results leave that domain on its local fallback.
 * Returns true when something changed (subscribers are then notified).
 */
export function applyCountryReference(payload: CountryReferencePayload): boolean {
  const taxByCountry: Record<string, ReferenceTaxRuleRow[]> = {};
  for (const row of payload.taxRules || []) {
    const cc = text(row?.countryCode).toUpperCase();
    if (VALID_COUNTRY_CODE.test(cc)) (taxByCountry[cc] = taxByCountry[cc] || []).push(row);
  }
  let changed = false;
  if (Array.isArray(payload.countries)) changed = mergeCountryRows(payload.countries, taxByCountry) || changed;
  if (Array.isArray(payload.currencies)) changed = mergeCurrencyRows(payload.currencies) || changed;
  if (Array.isArray(payload.fxRates)) changed = mergeFxRows(payload.fxRates) || changed;
  if (changed) notifyRegistry();
  return changed;
}

let referenceLoad: Promise<void> | null = null;

/**
 * Hydrate the registry from GET /reference/{countries,currencies,fx-rates,tax-rules}.
 * Never rejects. On TOTAL failure the promise resets so a later call (back
 * online, Settings mount) starts a fresh attempt; partial success is cached
 * for the session (reference data is not expected to change mid-session).
 */
export function ensureCountryReferenceLoaded(): Promise<void> {
  if (referenceLoad) return referenceLoad;
  referenceLoad = (async () => {
    const [countries, currencies, fxRates, taxRules] = await Promise.all([
      listReferenceCountries(),
      listReferenceCurrencies(),
      listReferenceFxRates('TND'),
      listReferenceTaxRules(),
    ]);
    const anySuccess = countries !== null || currencies !== null || fxRates !== null || taxRules !== null;
    applyCountryReference({ countries, currencies, fxRates, taxRules });
    if (!anySuccess) referenceLoad = null; // total failure → retryable
  })().catch(() => { referenceLoad = null; });
  return referenceLoad;
}
