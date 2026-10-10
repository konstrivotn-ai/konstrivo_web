import { MetreWorkflowTab } from './components/MetreWorkflowTab';
import { MetreDirectTab } from './components/MetreDirectTab';
import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { BottomNavBar } from './components/BottomNavBar';
import { HomeTab } from './components/HomeTab';
import { CalculatorTab } from './components/CalculatorTab';
import { ProjectsTab } from './components/ProjectsTab';
import { DirectoryMarketplaceTab } from './components/DirectoryMarketplaceTab';
import { MaintenanceTab } from './components/MaintenanceTab';
import { RatesTab } from './components/RatesTab';
import { DevisTab } from './components/DevisTab';
import { KnowledgeTab } from './components/KnowledgeTab';
import { AboutTab } from './components/AboutTab';
import { ContactTab } from './components/ContactTab';
import { AiAssistantTab } from './components/AiAssistantTab';
import { SettingsTab } from './components/SettingsTab';
import { ServicesTab } from './components/ServicesTab';
import { FloatingAiWidget } from './components/FloatingAiWidget';
import { ApiSyncModal } from './components/ApiSyncModal';
import { AccountModal } from './components/AccountModal';
import { AuthModal } from './components/AuthModal';
import { CatalogUploadModal } from './components/CatalogUploadModal';
import { SupplierDashboardModal } from './components/SupplierDashboardModal';
import { LivePriceIndexWidget } from './components/LivePriceIndexWidget';
import { AdminDashboardModal } from './components/AdminDashboardModal';
import { VisualDevisWizardModal } from './components/VisualDevisWizardModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { dirFor } from './i18n';

import { 
  Language, RegionTunisia, MaterialRate, DevisDocument, DevisItem,
  CountryCode, CurrencyCode, UnitSystem, ChantierProject, ArtisanDirectoryItem,
  MarketProduct, MaintenanceTicket, UserProfile
} from './types';
import { DEFAULT_MARKET_RATES } from './data/marketRates';
import { restoreSession, logout, listDevis, createDevis, updateDevis, deleteDevis, listPrices, createProject, listProjects } from './lib/api';
import { buildPriceMapWithTrade, mergeRates, ResolvedPrice } from './utils/priceLookup';
import {
  normalizeDevisFromServer, toServerDevisPayload, makeDevisReference,
  isDefaultCompanyName,
  DEFAULT_COMPANY_NAME, DEFAULT_COMPANY_PHONE, DEFAULT_COMPANY_MATRICULE, DEFAULT_COMPANY_ADDRESS,
} from './utils/devisFields';
import { toServerProjectPayload, hasPublishableProjectData } from './utils/projectFields';
import { getCountryConfig, findCountryConfig, ensureCountryReferenceLoaded, subscribeCountryRegistry } from './data/countryConfig';
import {
  applyCatalogTombstones,
  subscribeCatalogTombstones,
} from './data/catalogTombstones';
import {
  refreshInactiveCatalogRefs,
  refreshTradeRegistry,
  getActiveTradesSync,
  subscribeTradeRegistry,
} from './data/tradeRegistry';
import { 
  INITIAL_PROJECTS, INITIAL_ARTISANS, INITIAL_MARKETPLACE_PRODUCTS, 
  INITIAL_MAINTENANCE_TICKETS 
} from './data/mockSaaSData';

// Declare global window property for Mobile Sync integration
declare global {
  interface Window {
    KonstrivoState?: any;
  }
}

/** References already saved in the local Devis history — fed to
 *  makeDevisReference() so a NEW Devis never reuses one across reloads. */
function collectSavedDevisReferences(): string[] {
  try {
    const saved = localStorage.getItem('konstrivo_devis_history');
    if (!saved) return [];
    return (JSON.parse(saved) as any[])
      .map((d: any) => d?.reference)
      .filter((r: any): r is string => typeof r === 'string' && r.length > 0);
  } catch {
    return [];
  }
}

/** Today's calendar date in Tunisia (Africa/Tunis, UTC+1, no DST) as YYYY-MM-DD —
 *  used for every NEW Devis. Falls back to the device's UTC date if Intl is
 *  unavailable, so the field can never be empty. */
function todayLocalIso(): string {
  try {
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Tunis',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return f.format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Build a fresh blank Devis document — used for BOTH the initial document and
 * every "Nouveau Devis". Only reference + date are regenerated on each call:
 *  - reference: makeDevisReference() guarantees a NEW DEV-<year>-XXXX that
 *    never reuses a reference already saved in the local history nor one
 *    issued earlier in this session;
 *  - date: today's local (Tunisia) calendar date as YYYY-MM-DD.
 * Every other field matches the original initializer exactly.
 */
function createBlankDevis(): DevisDocument {
  // NOTE: the Phase-1 registry hydration/subscription hooks live at the TOP
  // LEVEL of App — hooks are illegal here (this runs inside a useState
  // initializer and event handlers; keeping them here changes App's hook
  // order and crashes the render). Only the pure accessor is used below.
  const countryCfg = getCountryConfig('TN');
  return {
    id: `dev-${Date.now()}`,
    reference: makeDevisReference(collectSavedDevisReferences()),
    date: todayLocalIso(),
    clientName: '',
    clientPhone: '',
    clientAddress: '',
    projectTitle: '',
    region: 'Tunis Grand',
    country: 'TN',
    currency: 'TND',
    // company defaults (may be overridden when currentUser is available)
    companyName: DEFAULT_COMPANY_NAME,
    companyPhone: DEFAULT_COMPANY_PHONE,
    companyMatricule: DEFAULT_COMPANY_MATRICULE,
    companyAddress: DEFAULT_COMPANY_ADDRESS,
    items: [],
    subtotalMaterials: 0,
    subtotalLabor: 0,
    discount: 0,
    subtotalMaterialsTnd: 0,
    subtotalLaborTnd: 0,
    discountTnd: 0,
    tvaPercent: countryCfg.defaultVatRate,
    timbreFiscalTnd: countryCfg.timbreFiscalDefault,
    retenueGarantiePercent: 0,
    timbreFiscal: countryCfg.timbreFiscalDefault,
    totalTnd: 0,
    total: 0,
    notes: 'Devis valable 30 jours. Conditions: 50% acompte à la commande, solde à la livraison.',
    status: 'brouillon'
  } as DevisDocument;
}

/**
 * P2 — Country/Pricing: the localStorage rates entry is the LAST SYNCHRONIZED
 * price cache (written by the persistence effect in App). Those values belong to
 * the market that was active when they were written, so they may only be used as
 * a merge BASE for that SAME market. For any other market the local barème
 * (dev defaults; empty in production) is the base and every price comes from the
 * server for the selected market. Nothing is ever deleted or rewritten here —
 * the cache is only read.
 */
function readLocalRatesBase(market: CountryCode): MaterialRate[] {
  const isProd = !!((import.meta as any).env && (import.meta as any).env.PROD);
  const fallback = isProd ? [] : DEFAULT_MARKET_RATES;
  try {
    const cachedMarket = localStorage.getItem('konstrivo_rates_market');
    if (cachedMarket && cachedMarket !== market) return applyCatalogTombstones(fallback);
    const saved = localStorage.getItem('konstrivo_rates_2026');
    if (!saved) return applyCatalogTombstones(fallback);
    const parsed = JSON.parse(saved);
    return applyCatalogTombstones(Array.isArray(parsed) ? parsed : fallback);
  } catch {
    return applyCatalogTombstones(fallback);
  }
}

/**
 * READ-PATH IDENTITY (métier → materials) — publish the authoritative `trade`
 * and `tradeId` carried by the API price rows onto the merged rates.
 *
 * `mergeRates` (src/utils/priceLookup.ts — FROZEN, not modified here) already
 * keeps `ResolvedPrice.trade` for server-only appended rows, but a rate that
 * was matched against the local cache (Tier-1 / identity bridge) keeps its
 * possibly stale/absent `trade` and never receives `tradeId`. This read-path
 * step applies the documented server-priority rule ONE level up: when a valid
 * server row exists for a rate (same id, or the other id spelling the CSV
 * importer produces — `ALU-001` ↔ `alu_001`), the API's `trade`/`tradeId`
 * identity is published on it; a server row without identity never erases a
 * real existing value. Ids are never renamed, no price/unit/category value is
 * touched, and no DB/CSV write happens — pure input to the existing state.
 * Exported (like `applyParsedCatalog`) so the regression suite can exercise
 * the exact runtime step DB-free.
 */
export function publishServerTradeIdentity(
  rates: MaterialRate[],
  priceMap: Map<string, ResolvedPrice>
): MaterialRate[] {
  if (priceMap.size === 0) return rates;
  // Same normalization as priceLookup's identity bridge (trim + lowercase +
  // whitespace/hyphen → underscore) so a rate reached through `ALU-001` ↔
  // `alu_001` is found here too. Mirrors, does not modify, priceLookup.
  const identityOf = (id: string | null | undefined): string =>
    String(id ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const byIdentity = new Map<string, ResolvedPrice>();
  for (const [key, resolved] of priceMap.entries()) {
    const identity = identityOf(key);
    if (!byIdentity.has(identity)) byIdentity.set(identity, resolved);
  }
  return rates.map(r => {
    const resolved = priceMap.get(r.id) ?? byIdentity.get(identityOf(r.id));
    if (!resolved) return r;
    const trade = (resolved.trade || '').trim();
    const tradeId = (resolved.tradeId || '').trim();
    if (!trade && !tradeId) return r;
    const next: MaterialRate = { ...r };
    // Server priority for the IDENTITY fields only (same rule as the price):
    // the API is the source of truth; an absent server value keeps the
    // cached one. `trade` participates in métier → materials matching.
    if (trade) next.trade = trade;
    if (tradeId) next.tradeId = tradeId;
    return next;
  });
}

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('home');
  const [initialTradeCode, setInitialTradeCode] = useState<string | undefined>(undefined);
  // PHASE 2.3-B1 — Métré Pro view mode: Direct (default) or the existing
  // Project → Zone → Ouvrage → Relevé workflow. Local UI state only.
  const [metreMode, setMetreMode] = useState<'direct' | 'workflow'>('direct');
  // Language is FR / AR / EN only (Derja was removed from the product).
  // Default is FR: an unknown/legacy persisted value (e.g. the old 'derja')
  // falls back to French instead of leaving the app in a removed locale.
  const [lang, setLang] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('konstrivo-lang');
      return saved === 'fr' || saved === 'ar' || saved === 'en' ? saved : 'fr';
    } catch { return 'fr'; }
  });

  // i18n — persist selection + mirror the selected UI language onto the document.
  // AR renders RTL (layout direction); FR and EN render LTR. Assistive tech gets
  // the matching locale (Arabic uses the Tunisian locale).
  useEffect(() => {
    try { localStorage.setItem('konstrivo-lang', lang); } catch { /* private mode */ }
    document.documentElement.dir = dirFor(lang);
    document.documentElement.lang = lang === 'ar' ? 'ar-TN' : lang;
  }, [lang]);
  const [region, setRegion] = useState<RegionTunisia>('Tunis Grand');
  const [wasteMarginDefault, setWasteMarginDefault] = useState<number>(10);

  // Global Localization States
  const [country, setCountry] = useState<CountryCode>(() => {
    return (localStorage.getItem('konstrivo_country') as CountryCode) || 'TN';
  });

  const [currency, setCurrency] = useState<CurrencyCode>(() => {
    return (localStorage.getItem('konstrivo_currency') as CurrencyCode) || 'TND';
  });

  const [unitSystem, setUnitSystem] = useState<UnitSystem>(() => {
    return (localStorage.getItem('konstrivo_unit_system') as UnitSystem) || 'metric';
  });

  const [isOffline, setIsOffline] = useState<boolean>(false);
  const [showSyncModal, setShowSyncModal] = useState<boolean>(false);
  const [showAuthModal, setShowAuthModal] = useState<boolean>(() => {
    // AUTH PHASE 2A STEP 5 — after a successful password reset the user is
    // sent back to the app with ?connexion=1 so the EXISTING login modal
    // (AuthModal, default login mode) opens automatically. The flag is
    // stripped from the URL; no token is ever part of any URL.
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('connexion') === '1') {
        window.history.replaceState(null, '', window.location.pathname);
        return true;
      }
    } catch { /* ignore */ }
    return false;
  });
  const [showCatalogModal, setShowCatalogModal] = useState<boolean>(false);
  const [showSupplierModal, setShowSupplierModal] = useState<boolean>(false);
  const [showAdminModal, setShowAdminModal] = useState<boolean>(false);
  const [showWizardModal, setShowWizardModal] = useState<boolean>(false);

  // User Profile State — initialized empty; hydrated securely from the server
  // session via restoreSession() (HttpOnly refresh cookie). The profile is
  // NEVER persisted to localStorage (no konstrivo_user_profile key).
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);

  // Account modal state (Phase D)
  const [showAccountModal, setShowAccountModal] = useState<boolean>(false);

  // Which tab the AuthModal must open on. Kept separate from the boolean above
  // so the header's "S'inscrire" button opens the EXISTING register tab
  // directly, without touching Mon Compte (AccountModal) at all.
  const [authInitialMode, setAuthInitialMode] = useState<'login' | 'register'>('login');

  // SaaS Data Collections
  const [trades, setTrades] = useState<Trade[]>(() => getActiveTradesSync());

  const [projects, setProjects] = useState<ChantierProject[]>(() => {
    const saved = localStorage.getItem('konstrivo_projects');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return INITIAL_PROJECTS;
  });

  // Server project -> UI project mapper.
  // IMPORTANT: keep the real Supabase UUID as id so Métré can use it.
  const mapServerProjectToUi = (row: any): ChantierProject => ({
    id: String(row?.id ?? ''),
    code: String(row?.code ?? ''),
    name: String(row?.name ?? ''),
    clientName: String(row?.clientName ?? ''),
    clientPhone: String(row?.clientPhone ?? ''),
    address: String(row?.address ?? ''),
    region: String(row?.region ?? ''),
    country: (row?.country ?? 'TN') as CountryCode,
    currency: (row?.currency ?? 'TND') as CurrencyCode,
    type: row?.type ?? 'residentiel',
    status: row?.status ?? 'planification',
    progressPercent: Number(row?.progressPercent ?? 0) || 0,
    budgetTotalHt: Number(row?.budgetTotalHt ?? 0) || 0,
    depensesActuellesHt: Number(row?.depensesActuellesHt ?? 0) || 0,
    startDate: row?.startDate ? String(row.startDate).slice(0, 10) : '',
    targetEndDate: row?.targetEndDate ? String(row.targetEndDate).slice(0, 10) : '',
    managerName: '',
    phases: Array.isArray(row?.phases) ? row.phases : [],
    logs: Array.isArray(row?.logs) ? row.logs : [],
    team: Array.isArray(row?.team) ? row.team : [],
    notes: String(row?.notes ?? ''),
  });

  const [artisans, setArtisans] = useState<ArtisanDirectoryItem[]>(() => {
    const saved = localStorage.getItem('konstrivo_artisans');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return INITIAL_ARTISANS;
  });

  const [marketplaceProducts, setMarketplaceProducts] = useState<MarketProduct[]>(() => {
    const saved = localStorage.getItem('konstrivo_marketplace');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return INITIAL_MARKETPLACE_PRODUCTS;
  });

  const [maintenanceTickets, setMaintenanceTickets] = useState<MaintenanceTicket[]>(() => {
    const saved = localStorage.getItem('konstrivo_maintenance_tickets');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return INITIAL_MAINTENANCE_TICKETS;
  });

  // Load custom rates or default rates
  // Production: do NOT treat DEFAULT_MARKET_RATES as real market prices.
  // - If cache exists, restore it.
  // - In production with no cache, initialize empty to indicate "no synchronized prices yet".
  const [rates, setRates] = useState<MaterialRate[]>(() => {
    const saved = localStorage.getItem('konstrivo_rates_2026');
    if (saved) {
      try {
        // CACHE-PROOF: a material archived in the DB must not come back from the
        // local barème cache after a Refresh / app reopen.
        return applyCatalogTombstones(JSON.parse(saved) as MaterialRate[]);
      } catch (e) {}
    }
    // In production we must not fall back to the dev DEFAULT_MARKET_RATES
    if ((import.meta as any).env && (import.meta as any).env.PROD) return [];
    return applyCatalogTombstones(DEFAULT_MARKET_RATES);
  });

  // P2 — Country/Pricing: the LOCAL base every market's server prices are merged
  // onto. Lazy-initialized ONCE from the market-scoped cache (see
  // readLocalRatesBase) so switching country/currency replaces the previous
  // market's server layer instead of keeping stale foreign prices for every
  // material the new market does not quote. Explicit user edits update the base
  // (see the rate handlers below) so a manual price change is never lost.
  const localRatesBaseRef = useRef<MaterialRate[] | null>(null);
  if (localRatesBaseRef.current === null) {
    localRatesBaseRef.current = readLocalRatesBase(country);
  }

  // Step 3 — Server-price priority plumbing:
  // - ratesSyncNonce: bumping it re-runs the EXISTING backend sync effect so a
  //   valid server price is re-applied on top of local/default rates right
  //   away (e.g. after "Reset rates") instead of waiting for a page reload.
  // - skipRatesPersistRef: after a reset, skip ONE write of the persistence
  //   effect so DEFAULT_MARKET_RATES are NOT re-seeded into localStorage as if
  //   they were synchronized server data (localStorage must never shadow the
  //   PostgreSQL prices).
  const [ratesSyncNonce, setRatesSyncNonce] = useState(0);
  const skipRatesPersistRef = useRef(false);

  // PHASE 1 — API-first country registry: hydrate from /reference/* (falls back
  // silently to COUNTRIES_CONFIG) and re-render merged consumers on change.
  // Top-level of App, unconditional, stable hook order — must NEVER live inside
  // createBlankDevis (that runs from a useState initializer / event handler and
  // shifted App's hook count → crash at the next useState).
  const [countryRegistryTick, setCountryRegistryTick] = useState<number>(0);
  useEffect(() => { ensureCountryReferenceLoaded(); }, []);
  useEffect(() => subscribeCountryRegistry(() => setCountryRegistryTick((t) => t + 1)), []);
  void countryRegistryTick; // registry merge → setState → App re-render

  // Métré / Trade Registry — hydrate authoritative active trades once and stay subscribed.
  useEffect(() => {
    setTrades(getActiveTradesSync());
    const unsubscribe = subscribeTradeRegistry(() => {
      setTrades(getActiveTradesSync());
    });
    void refreshTradeRegistry();
    return unsubscribe;
  }, []);
  // Active Devis — built by createBlankDevis() so the very first document and
  // every "Nouveau Devis" share the exact same shape (fresh reference + today's
  // local Tunisia date). Modify/load/add-item paths never touch reference/date.
  const [currentDevis, setCurrentDevis] = useState<DevisDocument>(() => createBlankDevis());

  // When a user session is restored and contains company info, apply it to the
  // current Devis ONLY when the Devis fields are truly empty (no user data).
  // User's existing Devis data has priority — defaults are NOT placeholders
  // to be overwritten; they remain fallback only when no data exists.
  useEffect(() => {
    if (!currentUser) return;
    setCurrentDevis(prev => {
      const next = { ...prev } as any;
      // Fill from currentUser when the field is empty OR still holds the
      // built-in default (defaults are fallback, not user data) — never
      // overwrite values the user typed or loaded themselves.
      if (isDefaultCompanyName(prev.companyName)) {
        next.companyName = currentUser.companyName || currentUser.company || prev.companyName;
      }
      if (!prev.companyPhone || prev.companyPhone === DEFAULT_COMPANY_PHONE) {
        next.companyPhone = currentUser.phone || prev.companyPhone;
      }
      if (!prev.companyMatricule || prev.companyMatricule === DEFAULT_COMPANY_MATRICULE) {
        next.companyMatricule = currentUser.matriculeFiscale || currentUser.taxNumber || prev.companyMatricule;
      }
      if (!prev.companyAddress || prev.companyAddress === DEFAULT_COMPANY_ADDRESS) {
        next.companyAddress = currentUser.company || currentUser.region || prev.companyAddress;
      }
      return next as DevisDocument;
    });
  }, [currentUser]);

  // Devis History
  const [devisHistory, setDevisHistory] = useState<DevisDocument[]>(() => {
    const saved = localStorage.getItem('konstrivo_devis_history');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [];
  });

  // Save persistent configs
  useEffect(() => {
    localStorage.setItem('konstrivo_country', country);
  }, [country]);

  useEffect(() => {
    localStorage.setItem('konstrivo_currency', currency);
  }, [currency]);

  useEffect(() => {
    localStorage.setItem('konstrivo_unit_system', unitSystem);
  }, [unitSystem]);

  // Clear the initial trade context when navigating away from the calculator tab
  // so that header navigation to "Outils" always starts without a pre-selected trade.
  useEffect(() => {
    if (activeTab !== 'calculator' && initialTradeCode !== undefined) {
      setInitialTradeCode(undefined);
    }
  }, [activeTab]);

  // Step 3 — persist rates, EXCEPT the single write right after a reset:
  // "Reset rates" clears the cache; re-persisting the dev defaults immediately
  // would recreate a fake "synchronized" cache that shadows real server prices.
  useEffect(() => {
    if (skipRatesPersistRef.current) {
      skipRatesPersistRef.current = false;
      return;
    }
    localStorage.setItem('konstrivo_rates_2026', JSON.stringify(rates));
  }, [rates]);

  // Sync market prices from backend when online.
  // Selection rules:
  // - Consider entries with `isCurrent === true` OR whose effectiveFrom/effectiveTo cover now.
  // - If multiple candidates for the same materialId, pick the one with the latest `updatedAt`,
  //   then highest `version` as tiebreaker.
  // - In production, do not synthesize prices from DEFAULT_MARKET_RATES when no cache exists.
  // Step 3 — SERVER PRICE PRIORITY: when a valid server price exists for a
  // material, it ALWAYS wins over the localStorage-cached value for the same
  // id (see merge below). The backend is the source of truth; localStorage is
  // only an offline / last-known cache. `ratesSyncNonce` re-runs this sync
  // (e.g. after "Reset rates") so server prices are re-applied immediately.
  useEffect(() => {
    let active = true;
    if (isOffline) return;
    (async () => {
      try {
        const res = await listPrices({ market: country.toLowerCase(), limit: 1000 });
        const serverPrices = (res && (res as any).data) || [];
        if (!active) return;

        // Step 5 — build the price map keyed by LEGACY slug (materials.code),
        // falling back to materialId so the same path also works in-memory.
        // Phase D — use buildPriceMapWithTrade to preserve the authoritative
        // trade relationship for dynamic-trade material resolution.
        // P2 — the market's OFFICIAL currency is preferred when one material is
        // quoted in several currencies for the same market (no FX maths, no
        // change to the TND-based calculator).
        const priceMap = buildPriceMapWithTrade(serverPrices, findCountryConfig(country)?.defaultCurrency);

        // Step 3 — SERVER PRICE PRIORITY merge (fallback preserved):
        //   Tier 1: a valid server price for a legacy slug ALWAYS wins over the
        //           local base value with the same slug.
        //   Tier 2: no valid server price for this market (offline, failed,
        //           filtered, absent) → the LOCAL base value is kept as-is.
        //   Tier 3: server-only slugs are appended so they stay visible.
        // P2 — Country/Pricing: the merge ALWAYS starts from the local base of the
        // CURRENT market (never from the previously merged array), so changing the
        // country/currency replaces the previous market's server layer instead of
        // keeping its prices for every material the new market does not quote.
        // If production and no cache and no server prices, leave rates empty to
        // indicate "no synchronized prices yet".
        const base = localRatesBaseRef.current ?? [];
        if (((import.meta as any).env && (import.meta as any).env.PROD) && (!localStorage.getItem('konstrivo_rates_2026')) && priceMap.size === 0) {
          setRates([]);
          return;
        }
        // P2 — tag the cache with the market it was synchronized for, so a cache
        // written for another market is never reused as this market's base
        // (readLocalRatesBase). Additive key; no stored price is modified.
        try { localStorage.setItem('konstrivo_rates_market', country); } catch { /* private mode */ }
        // READ-PATH IDENTITY — publish the API's authoritative trade/tradeId
        // onto the merged rates (priceLookup stays frozen; see the helper).
        // CACHE-PROOF — then drop anything the DB reports as archived. `priceMap`
        // keys are the refs the SERVER just served, so a material that is alive
        // again (e.g. re-imported after an archive) is automatically un-suppressed.
        setRates(applyCatalogTombstones(
          publishServerTradeIdentity(mergeRates(base, priceMap), priceMap),
          priceMap.keys(),
        ));
      } catch (err) {
        // silent: keep local cache
      }
    })();
    return () => { active = false; };
  }, [isOffline, country, ratesSyncNonce]);

  // CATALOG STATE — DB TRUTH ON MOUNT (source of truth for what is published).
  // `GET /catalog/inactive-refs` reports the archived materials and deactivated
  // trades the DB no longer serves, so a Refresh / app reopen can never revive
  // them from the local barème cache. Fail-safe: if the endpoint is unreachable
  // the persisted suppression list is kept as-is (nothing is cleared).
  useEffect(() => {
    let active = true;
    (async () => {
      const answered = await refreshInactiveCatalogRefs();
      if (!active || !answered) return;
      // The server may have published a material again (re-import): re-apply the
      // reconciled suppression list to the state + merge base.
      setRates(prev => {
        const next = applyCatalogTombstones(prev);
        if (next !== prev) localRatesBaseRef.current = applyCatalogTombstones(localRatesBaseRef.current ?? []);
        return next;
      });
    })();
    return () => { active = false; };
  }, []);

  // Keep every consumer of `rates` aligned whenever the suppression list changes
  // (a confirmed Admin archive, or the DB list arriving after the first render).
  useEffect(() => subscribeCatalogTombstones(() => {
    setRates(prev => {
      const next = applyCatalogTombstones(prev);
      if (next === prev) return prev;
      localRatesBaseRef.current = applyCatalogTombstones(localRatesBaseRef.current ?? []);
      return next;
    });
  }), []);

  useEffect(() => {
    localStorage.setItem('konstrivo_devis_history', JSON.stringify(devisHistory));
  }, [devisHistory]);

  // Save SaaS modules
  useEffect(() => {
    localStorage.setItem('konstrivo_projects', JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    localStorage.setItem('konstrivo_artisans', JSON.stringify(artisans));
  }, [artisans]);

  useEffect(() => {
    localStorage.setItem('konstrivo_marketplace', JSON.stringify(marketplaceProducts));
  }, [marketplaceProducts]);

  useEffect(() => {
    localStorage.setItem('konstrivo_maintenance_tickets', JSON.stringify(maintenanceTickets));
  }, [maintenanceTickets]);

  // Restore the authenticated session on first mount using the HttpOnly
  // refresh cookie (server-validated via /users/me). The profile is never
  // persisted client-side — no konstrivo_user_profile localStorage key.
  useEffect(() => {
    let active = true;
    restoreSession()
      .then(profile => {
        if (active) setCurrentUser(profile);
      })
      .catch(() => {
        if (active) setCurrentUser(null);
      });
    return () => { active = false; };
  }, []);

  // Real logout: calls the backend /auth/logout endpoint and clears the
  // in-memory access token held by the API client, then drops the profile.
  const handleLogout = async () => {
    await logout();
    setCurrentUser(null);
  };

  // Defend the Admin dashboard client-side: only an authenticated admin
  // (currentUser?.role === 'admin') may open the Admin dashboard modal.
  // Allow opening the Admin modal so an unauthenticated admin can log in
  // The AdminDashboardModal itself gates privileged UI based on
  // `currentUser?.role === 'admin'` and shows a login form when needed.
  const openAdminModal = () => {
    setShowAdminModal(true);
  };

  // Split entry points for the EXISTING login/register UI (AuthModal):
  //  - openLogin()    → header "Se connecter" opens AuthModal on the login tab.
  //  - openRegister() → header "S'inscrire" opens AuthModal on the EXISTING
  //    "Créer un compte" register tab (umbrella role picker + register call).
  // Mon Compte (showAccountModal / AccountModal) stays untouched and is still
  // reached from the account button of a signed-in user.
  const openLogin = () => {
    setAuthInitialMode('login');
    setShowAuthModal(true);
  };

  const openRegister = () => {
    setAuthInitialMode('register');
    setShowAuthModal(true);
  };

  // Expose global state for Flutter / React Native mobile sync & REST mock
  useEffect(() => {
    window.KonstrivoState = {
      version: '2026.5.0',
      user: currentUser,
      country,
      currency,
      unitSystem,
      isOffline,
      lang,
      region,
      currentDevis,
      devisHistory,
      projects,
      artisans,
      marketplaceProducts,
      maintenanceTickets,
      ratesCount: rates.length,
      activeTab
    };
  }, [currentUser, country, currency, unitSystem, isOffline, lang, region, currentDevis, devisHistory, projects, artisans, marketplaceProducts, maintenanceTickets, rates, activeTab]);

  const handleUpdateRate = (id: string, newPrice: number) => {
    setRates(prev => {
      const next = prev.map(r => r.id === id ? { ...r, unitPriceTnd: newPrice } : r);
      // P2 — the edited list is what the admin now considers correct: it becomes
      // the merge base for the NEXT market sync (otherwise a later country
      // change would silently drop the edit).
      localRatesBaseRef.current = next;
      return next;
    });
  };

  const handleBulkUpdateRates = (updatedRates: MaterialRate[]) => {
    // CACHE-PROOF: whatever the caller sends (Admin save / delete / import), a
    // DB-archived material never re-enters the state or the merge base.
    const next = applyCatalogTombstones(updatedRates);
    localRatesBaseRef.current = next;
    setRates(next);
  };

  // Step 3 — "Reset rates" restores the hardcoded dev barème in memory ONLY:
  //  - skipRatesPersistRef prevents the persistence effect from immediately
  //    re-seeding localStorage with DEFAULT_MARKET_RATES (a fake cache that
  //    would shadow real server prices).
  //  - ratesSyncNonce re-runs the backend sync NOW so valid server prices are
  //    re-applied on top of the defaults instead of waiting for a page reload.
  const handleResetRates = () => {
    skipRatesPersistRef.current = true;
    // P2 — the reset also resets the merge base (the dev barème in memory).
    // CACHE-PROOF — the reset may not revive a material the DB archived.
    const resetBase = applyCatalogTombstones(DEFAULT_MARKET_RATES);
    localRatesBaseRef.current = resetBase;
    setRates(resetBase);
    localStorage.removeItem('konstrivo_rates_2026');
    setRatesSyncNonce(n => n + 1);
  };

  /** Create a brand-new empty Devis: fresh reference + today's local (Tunisia)
   *  date, then jump straight to the Devis view. */
  const handleNewDevis = () => {
    setCurrentDevis(createBlankDevis());
    setActiveTab('devis');
  };

  const handleAddToDevis = (item: DevisItem) => {
    setCurrentDevis(prev => ({
      ...prev,
      items: [...prev.items, item]
    }));
  };

  const handleAddMultipleToDevis = (items: DevisItem[]) => {
    setCurrentDevis(prev => ({
      ...prev,
      items: [...prev.items, ...items]
    }));
  };

  const handleSaveDevisHistory = async (devisToSave: DevisDocument) => {
    // If authenticated and online, try to persist to API. Fall back to localStorage on error.
    if (currentUser && !isOffline) {
      try {
        // Local-created IDs start with 'dev-'; use them as idempotency keys when creating.
        if (devisToSave.id && devisToSave.id.startsWith('dev-')) {
          // Phase 1 — explicit client→server payload mapping (reference, date,
          // status enum, numeric totals) so no user-visible field is dropped.
          const created = await createDevis(toServerDevisPayload(devisToSave) as any, devisToSave.id);
          const normalizedCreated = normalizeDevisFromServer(created, currentUser);
          setDevisHistory(prev => {
            const filtered = prev.filter(d => d.id !== devisToSave.id);
            return [normalizedCreated, ...filtered];
          });
          setCurrentDevis(normalizedCreated);
          return;
        }

        // Otherwise assume this maps to a server-side record and perform optimistic update.
        // Phase 1 — same mapping for the update path (plus the optimistic version).
        const payload = {
          ...toServerDevisPayload(devisToSave),
          version: devisToSave.version ?? (devisToSave as any).expectedVersion,
        };
        const updated = await updateDevis(devisToSave.id, payload);
        const normalizedUpdated = normalizeDevisFromServer(updated, currentUser);
        setDevisHistory(prev => prev.map(d => d.id === (normalizedUpdated as any).id ? normalizedUpdated : d));
        setCurrentDevis(normalizedUpdated as DevisDocument);
        return;
      } catch (err) {
        // sync failed — continue to save locally
        // eslint-disable-next-line no-console
        console.warn('Devis sync failed, falling back to local save', err);
      }
    }

    // Local-only fallback (unchanged behavior)
    setDevisHistory(prev => {
      const existsIndex = prev.findIndex(d => d.id === devisToSave.id);
      if (existsIndex >= 0) {
        const copy = [...prev];
        copy[existsIndex] = devisToSave;
        return copy;
      }
      return [devisToSave, ...prev];
    });
  };

  const handleLoadFromHistory = (dh: DevisDocument) => {
    // Phase 1 — normalize on load: YYYY-MM-DD date, reference fallback,
    // company fields (currentUser → defaults), numeric coercion of totals.
    setCurrentDevis(normalizeDevisFromServer(dh as any, currentUser));
    setActiveTab('devis');
  };

  const handleDeleteFromHistory = async (id: string) => {
    if (currentUser && !isOffline) {
      try {
        await deleteDevis(id);
        setDevisHistory(prev => prev.filter(d => d.id !== id));
        return;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('Failed to delete remote devis, falling back to local delete', err);
      }
    }
    setDevisHistory(prev => prev.filter(d => d.id !== id));
  };

  // Phase 1 — persist a published project through the EXISTING authenticated
  // endpoint (POST /api/v1/projects, guarded server-side by
  // requireFeature('projects:save')). Mirrors the Devis flow: call the API when
  // authenticated and online; otherwise the local state + localStorage save
  // (unchanged behavior) stays the only persistence, so FREE/offline works.
  const handleSaveProject = async (project: ChantierProject) => {
    if (!currentUser || isOffline) return;
    // The endpoint rejects an empty `name` with 400 — the UI treats an empty
    // title as "nothing to publish", so skip the call instead of provoking it.
    if (!hasPublishableProjectData(project)) return;
    try {
      await createProject(toServerProjectPayload(project));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Project sync failed, keeping local project', err);
    }
  };

  // When authenticated and online, hydrate the project list from Supabase.
  // This replaces local/demo IDs such as proj_1 with real server UUIDs.
  useEffect(() => {
    if (!currentUser || isOffline) return;

    let cancelled = false;

    void listProjects({ page: 1, limit: 50 })
      .then((result: any) => {
        if (cancelled) return;

        const rows = Array.isArray(result?.data)
          ? result.data
          : Array.isArray(result)
            ? result
            : [];

        const remoteProjects = rows
          .map(mapServerProjectToUi)
          .filter((project: ChantierProject) => project.id && project.name);

        if (remoteProjects.length > 0) {
          setProjects(remoteProjects);
          localStorage.setItem('konstrivo_projects', JSON.stringify(remoteProjects));
        }
      })
      .catch((err) => {
        // Keep existing local/offline projects if server hydration fails.
        console.warn('Project hydration failed; keeping local projects', err);
      });

    return () => {
      cancelled = true;
    };
  }, [currentUser, isOffline]);

  // When a user is authenticated and not in offline mode, pull remote Devis and merge
  useEffect(() => {
    let active = true;
    if (!currentUser || isOffline) return;
    (async () => {
      try {
        const res = await listDevis({ limit: 200 });
        const serverDevis = (res && (res as any).data) || [];
        if (!active) return;
        setDevisHistory(prev => {
          const map = new Map<string, any>(prev.map(d => [d.id, d]));
          // Phase 1 — normalize each server Devis (items attached, numeric
          // totals, reference fallback, YYYY-MM-DD date, client status enum,
          // company fields) before it enters the shared history.
          for (const s of serverDevis) map.set(s.id, normalizeDevisFromServer(s, currentUser));
          return Array.from(map.values()).sort((a: any, b: any) => new Date(b.createdAt || b.date).getTime() - new Date(a.createdAt || a.date).getTime());
        });
      } catch (err) {
        // Ignore sync failure — keep local history
      }
    })();
    return () => { active = false; };
  }, [currentUser, isOffline]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-amber-500 selection:text-slate-950">
      
      {/* Top Universal Sticky Main Navigation Bar */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        lang={lang}
        setLang={setLang}
        region={region}
        setRegion={setRegion}
        country={country}
        setCountry={setCountry}
        currency={currency}
        setCurrency={setCurrency}
        unitSystem={unitSystem}
        setUnitSystem={setUnitSystem}
        devisCount={currentDevis.items.length}
        onOpenSyncModal={() => setShowSyncModal(true)}
        onOpenAuthModal={openLogin}
        onOpenRegisterModal={openRegister}
        onOpenAccountModal={() => setShowAccountModal(true)}
        onOpenAdminModal={openAdminModal}
        onOpenWizardModal={() => setShowWizardModal(true)}
        onOpenSupplierModal={() => setShowSupplierModal(true)}
        currentUser={currentUser}
        isOffline={isOffline}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-24">
        {/* Crash guard scoped per tab: a failing section can no longer blank
            out the whole app (key resets the boundary when switching tabs). */}
        <ErrorBoundary key={activeTab} sectionName={`tab:${activeTab}`}>
        
        {/* 🏠 Accueil (Home) */}
        {activeTab === 'home' && (
          <HomeTab
            onNavigate={(t) => setActiveTab(t)}
            lang={lang}
            country={country}
            currency={currency}
            onOpenAuth={() => setShowAuthModal(true)}
          />
        )}

        {/* 🧮 Calculateur & Outils */}
        {activeTab === 'calculator' && (
          <CalculatorTab
            rates={rates}
            lang={lang}
            country={country}
            currency={currency}
            unitSystem={unitSystem}
            onAddToDevis={handleAddToDevis}
            onAddMultipleToDevis={handleAddMultipleToDevis}
            wasteMarginDefault={wasteMarginDefault}
            initialTradeCode={initialTradeCode}
            onOpenCatalogUpload={() => setShowCatalogModal(true)}
          />
        )}

        {/* 📐 Métré Workflow */}
        {activeTab === 'metre_workflow' && (
          <div className="space-y-3">
            {/* PHASE 2.3-B1 — Direct / Workflow mode selector (default: Direct).
                Presentation only: no engine call, no DB, no navigation change. */}
            <div className="flex gap-2 px-4 sm:px-6 pt-4">
              <button
                type="button"
                onClick={() => setMetreMode('direct')}
                className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
                  metreMode === 'direct'
                    ? 'bg-amber-400 text-slate-950'
                    : 'bg-slate-900 border border-slate-700 text-slate-300 hover:text-white'
                }`}
              >
                Direct
              </button>
              <button
                type="button"
                onClick={() => setMetreMode('workflow')}
                className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
                  metreMode === 'workflow'
                    ? 'bg-amber-400 text-slate-950'
                    : 'bg-slate-900 border border-slate-700 text-slate-300 hover:text-white'
                }`}
              >
                Workflow
              </button>
            </div>
            {metreMode === 'direct' ? (
              <MetreDirectTab
                trades={trades}
                lang={lang}
                country={country}
                currency={currency}
                rates={rates as any}
                onAddToDevis={handleAddToDevis}
                onAddMultipleToDevis={handleAddMultipleToDevis}
              />
            ) : (
              <MetreWorkflowTab
            projects={projects as any}
            rates={rates as any}
            trades={trades}
            lang={lang}
            country={country}
            currency={currency}
          />
        )}
        {/* 🏗️ Projets & Chantiers */}
          </div>
        )}
        {activeTab === 'projects' && (
          <ProjectsTab
            projects={projects}
            onUpdateProjects={setProjects}
            onSaveProject={handleSaveProject}
            lang={lang}
            country={country}
            currency={currency}
          />
        )}

        {/* 👷 Professionnels & Marché */}
        {activeTab === 'directory_market' && (
          <DirectoryMarketplaceTab
            artisans={artisans}
            products={marketplaceProducts}
            lang={lang}
            country={country}
            currency={currency}
          />
        )}

        {/* 🛠️ Services & Dépannage */}
        {activeTab === 'services' && (
          <ServicesTab
            onNavigate={(tab, opts) => {
              if (opts?.tradeCode) {
                setInitialTradeCode(opts.tradeCode);
                setActiveTab(tab);
              } else {
                setInitialTradeCode(undefined);
                setActiveTab(tab);
              }
            }}
            rates={rates}
            onSelectService={(ctx) => {
              setInitialTradeCode(ctx.tradeCode);
              setActiveTab('calculator');
            }}
            lang={lang}
          />
        )}

        {activeTab === 'maintenance' && (
          <MaintenanceTab
            tickets={maintenanceTickets}
            onUpdateTickets={setMaintenanceTickets}
            lang={lang}
            country={country}
            currency={currency}
          />
        )}

        {/* 🏷️ Tarifs Marché */}
        {activeTab === 'rates' && (
          <div className="space-y-6">
            <LivePriceIndexWidget
              lang={lang}
              country={country}
              currency={currency}
              onOpenSupplierDashboard={() => setShowSupplierModal(true)}
            />

            <RatesTab
              rates={rates}
              onUpdateRate={handleUpdateRate}
              onBulkUpdateRates={handleBulkUpdateRates}
              onResetRates={handleResetRates}
              onOpenCatalogUpload={() => setShowCatalogModal(true)}
              lang={lang}
              country={country}
              currency={currency}
            />
          </div>
        )}

        {/* 📄 Devis & Factures */}
        {activeTab === 'devis' && (
          <DevisTab
            devis={currentDevis}
            setDevis={setCurrentDevis}
            devisHistory={devisHistory}
            onNewDevis={handleNewDevis}
            onSaveDevisHistory={handleSaveDevisHistory}
            onLoadFromHistory={handleLoadFromHistory}
            onDeleteFromHistory={handleDeleteFromHistory}
            lang={lang}
            region={region}
            country={country}
            currency={currency}
            unitSystem={unitSystem}
          />
        )}

        {/* ℹ️ À Propos */}
        {activeTab === 'about' && (
          <AboutTab
            lang={lang}
            onNavigate={(t) => setActiveTab(t)}
          />
        )}

        {/* 📞 Contact & Support */}
        {activeTab === 'contact' && (
          <ContactTab lang={lang} />
        )}

        {/* 📚 Guide DTU */}
        {activeTab === 'knowledge' && (
          <KnowledgeTab lang={lang} />
        )}

        {/* 🤖 Assistant AI */}
        {activeTab === 'assistant' && (
          <AiAssistantTab
            currentDevis={currentDevis}
            region={region}
            lang={lang}
          />
        )}

        {/* ⚙️ Réglages */}
        {activeTab === 'settings' && (
          <SettingsTab
            lang={lang}
            setLang={setLang}
            region={region}
            setRegion={setRegion}
            country={country}
            setCountry={setCountry}
            currency={currency}
            setCurrency={setCurrency}
            unitSystem={unitSystem}
            setUnitSystem={setUnitSystem}
            wasteMarginDefault={wasteMarginDefault}
            setWasteMarginDefault={setWasteMarginDefault}
            onResetRates={handleResetRates}
            isOffline={isOffline}
            setIsOffline={setIsOffline}
            onOpenSyncModal={() => setShowSyncModal(true)}
          />
        )}
        </ErrorBoundary>
      </main>

      {/* Sync API Modal */}
      {showSyncModal && (
        <ApiSyncModal
          isOpen={showSyncModal}
          onClose={() => setShowSyncModal(false)}
          currentDevis={currentDevis}
          rates={rates}
          devisHistory={devisHistory}
          country={country}
          currency={currency}
          unitSystem={unitSystem}
        />
      )}

      {/* User Login / Register Modal */}
      {showAuthModal && (
        <AuthModal
          isOpen={showAuthModal}
          onClose={() => setShowAuthModal(false)}
                    currentUser={currentUser}
          onLogin={(usr) => setCurrentUser(usr)}
          onLogout={handleLogout}
          lang={lang}
          initialMode={authInitialMode}
          onOpenAdminModal={openAdminModal}
        />
      )}

      {/* Account Modal (Phase D) */}
      {showAccountModal && (
        <AccountModal
          isOpen={showAccountModal}
          onClose={() => setShowAccountModal(false)}
          currentUser={currentUser}
          onLogout={handleLogout}
          lang={lang}
        />
      )}

      {/* Supplier Catalog File Upload Modal */}
      {showCatalogModal && (
        <CatalogUploadModal
          isOpen={showCatalogModal}
          onClose={() => setShowCatalogModal(false)}
          rates={rates}
          onApplyCatalog={handleBulkUpdateRates}
          lang={lang}
        />
      )}

      {/* Supplier Wholesaler Dashboard Modal */}
      {showSupplierModal && (
        <SupplierDashboardModal
          isOpen={showSupplierModal}
          onClose={() => setShowSupplierModal(false)}
          rates={rates}
          onApplyCatalog={handleBulkUpdateRates}
          lang={lang}
          country={country}
          currency={currency}
        />
      )}

      {/* Visual Multi-Step Request Wizard Modal */}
      {showWizardModal && (
        <VisualDevisWizardModal
          isOpen={showWizardModal}
          onClose={() => setShowWizardModal(false)}
          lang={lang}
          country={country}
          currency={currency}
          userRegion={region}
        />
      )}

      {/* Admin Dashboard Control Panel Modal */}
      {showAdminModal && (
        <AdminDashboardModal
          isOpen={showAdminModal}
          onClose={() => setShowAdminModal(false)}
                    currentUser={currentUser}
          onLogin={(usr) => setCurrentUser(usr)}
          onLogout={handleLogout}
          devisHistory={devisHistory}
          artisans={artisans}
          onUpdateArtisans={setArtisans}
          rates={rates}
          onBulkUpdateRates={handleBulkUpdateRates}
          onImportCompleted={() => {
            // A successful import publishes a NEW catalog version: re-read the DB
            // truth (a re-imported code is resurrected server-side, so its local
            // suppression must be dropped) and re-apply the server prices.
            void refreshInactiveCatalogRefs();
            setRatesSyncNonce(n => n + 1);
          }}
          lang={lang}
          country={country}
          currency={currency}
        />
      )}

      {/* Persistent Footer (Desktop) */}
      <footer className="bg-slate-900 border-t border-slate-800/80 py-8 text-xs text-slate-400 print:hidden mb-14 md:mb-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
            
            <div className="space-y-2">
              <span className="font-mono font-black text-amber-400 text-sm block">KONSTRIVO BTP</span>
              <p className="text-slate-400 text-[11px] leading-relaxed">
                Plateforme SaaS dédiée à l'estimation de métré, aux devis basés sur des références DTU et à la gestion de chantiers en Tunisie et à l'international.
              </p>
            </div>

            <div>
              <span className="font-bold text-white text-xs block mb-2">Navigation Rapide</span>
              <ul className="space-y-1 text-[11px]">
                <li><button onClick={() => setActiveTab('home')} className="hover:text-amber-400">Accueil</button></li>
                <li><button onClick={() => setActiveTab('calculator')} className="hover:text-amber-400">Calculateur Métré</button></li>
                <li><button onClick={() => setActiveTab('maintenance')} className="hover:text-amber-400">Dépannage Express</button></li>
                <li><button onClick={() => setActiveTab('rates')} className="hover:text-amber-400">Tarifs Matériaux 2026</button></li>
              </ul>
            </div>

            <div>
              <span className="font-bold text-white text-xs block mb-2">Espace Entreprise</span>
              <ul className="space-y-1 text-[11px]">
                <li><button onClick={() => setActiveTab('projects')} className="hover:text-amber-400">Gestion de Chantiers</button></li>
                <li><button onClick={() => setActiveTab('directory_market')} className="hover:text-amber-400">Annuaire des Artisans</button></li>
                <li><button onClick={() => setShowCatalogModal(true)} className="hover:text-amber-400">Import Barème Fournisseur</button></li>
                <li><button onClick={() => setActiveTab('about')} className="hover:text-amber-400">Normes DTU & Mentions Légales</button></li>
                {currentUser?.role === 'admin' && (
                  <li>
                    <button
                      onClick={openAdminModal}
                      className="text-amber-400/80 hover:text-amber-300 font-mono text-[11px] font-bold flex items-center gap-1 mt-1 cursor-pointer"
                    >
                      🛡️ Espace Administration
                    </button>
                  </li>
                )}
              </ul>
            </div>

            <div className="space-y-2">
              <span className="font-bold text-white text-xs block">Contact & Support</span>
                <p className="text-[11px] text-slate-400">
                Centre Urbain Nord, Tunis<br />
                WhatsApp Direct : +216 50 772 371<br />
                Email : konstrivo.tn@gmail.com
              </p>
              <button
                onClick={() => setShowAuthModal(true)}
                className="mt-2 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-lg text-[11px] font-bold transition-all"
              >
                {currentUser ? 'Mon Compte Pro' : 'Connexion / Inscription'}
              </button>
            </div>

          </div>

          <div className="pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-500">
            <span>© 2026 KONSTRIVO. Tous droits réservés. Références DTU 25.41 • Barèmes actualisés.</span>
            <span>Édition 2026.5.0 • Barèmes actualisés en temps réel</span>
          </div>
        </div>
      </footer>

      {/* Mobile Bottom Navigation Bar */}
      <BottomNavBar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        lang={lang}
        devisCount={currentDevis.items.length}
      />

      {/* Floating AI Assistant Widget (Access KONSTRIVO AI from any screen) */}
      <FloatingAiWidget
        onOpenFullAssistant={() => setActiveTab('assistant')}
        lang={lang}
        region={region}
        currentDevis={currentDevis}
      />
    </div>
  );
}



