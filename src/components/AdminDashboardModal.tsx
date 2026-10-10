import React, { useState, useEffect, useRef } from 'react';
import { 
  X, ShieldCheck, ShieldAlert, Lock, UserCheck, Users, FileText, 
  TrendingUp, DollarSign, Search, Filter, CheckCircle2, Trash2, 
  PlusCircle, Edit3, RefreshCw, KeyRound, Sparkles, Building2, Phone, Star, AlertCircle, LogOut,
  BarChart3, PieChart, ArrowRight, Eye, Calendar, MapPin, HardHat, ExternalLink,
  Coins, Percent, Receipt, Plus, Calculator, Settings, Layers,
  Upload, FileSpreadsheet, Download, ListChecks, CheckSquare, Square, Award, Check, Clock, Globe
} from 'lucide-react';
import { ArtisanDirectoryItem, MaterialRate, DevisDocument, Language, CountryCode, CurrencyCode, TradeCategory, UserProfile } from '../types';
import { listCountryOptions, findCountryConfig, formatPrice } from '../data/countryConfig';
import { login, upsertCatalogItem, listPendingPriceUpdates, approvePendingPriceUpdate, previewCatalogImport, importCatalogFile, listAdminFeatures, upsertAdminFeature, deactivateAdminFeature, getFeatureUsageStats, getAdminPlan, setAdminPlan, archiveCatalogMaterial } from '../lib/api';
import { markCatalogTombstoned } from '../data/catalogTombstones';
import { buildImportBlockReason, visibleUnmappedRequired, isDefaultTradeRequired, effectiveDefaultTrade, CUSTOM_DEFAULT_TRADE } from '../lib/importPreview';
import {
  resolvePendingReviewView,
  isApprovePendingBlocked,
  pendingReviewErrorMessage,
  type PendingReviewLoadState,
} from '../lib/priceReview';
import { AdminTradesPanel } from './AdminTradesPanel';
import { useFeatures } from '../hooks/useFeatures';
import { trackFeatureUsage } from '../utils/featureUsage';
import { GlobalCatalogAdminPanel } from './GlobalCatalogAdminPanel';
import { FeatureGate } from './FeatureGate';
import type { AdminFeatureUsageStats, AdminPlanView } from '../lib/api';
import { usageRangeToParams, type UsageRangePreset } from '../lib/usageRange';
import {
  AdminFeatureEntitlement,
  AdminFeaturePatch,
  FEATURE_SCOPES,
  applyPatch as applyFeaturePatch,
  buildUpsertPayload,
  buildFeatureCreatePayload,
  EMPTY_FEATURE_CREATE_DRAFT,
  sortEntitlements,
  sortEntitlementsByMode,
  matchesFeatureSearch,
  computeFeatureSummary,
  validateLabel,
  FEATURE_SORT_MODES,
  type FeatureSortMode,
  type FeatureFilterField,
  type AdminFeatureCreateDraft,
} from '../lib/adminFeatures';
// P3 — admin plan helpers (pure) + the plan view type from the API client.
import {
  parseAdminPlanTarget,
  enforcementStatusLabel,
  adminPlanLabel,
  type AdminPlanTarget,
} from '../lib/adminPlans';

// Security Helper: Sanitize user input to prevent XSS vulnerabilities
export const sanitizeInput = (text: string): string => {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
};

interface AdminDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile | null;
  onLogin: (user: UserProfile) => void;
  onLogout: () => void;
  devisHistory: DevisDocument[];
  artisans: ArtisanDirectoryItem[];
  onUpdateArtisans: (artisans: ArtisanDirectoryItem[]) => void;
  rates: MaterialRate[];
  onBulkUpdateRates: (rates: MaterialRate[]) => void;
  /** Phase A — called after a successful transactional CSV import so App can re-sync server prices immediately. */
  onImportCompleted?: () => void;
  lang: Language;
  country: CountryCode;
  currency: CurrencyCode;
}

export const TUNISIAN_GOVERNORATES_LIST = [
  'Tunis Grand', 'Ariana', 'Ben Arous', 'Manouba',
  'Nabeul / Cap Bon', 'Bizerte', 'Sousse / Sahel', 'Monastir',
  'Mahdia', 'Sfax', 'Kairouan', 'Gabès', 'Médenine / Djerba',
  'Béja', 'Jendouba', 'Le Kef', 'Siliana', 'Kasserine',
  'Sidi Bouzid', 'Gafsa', 'Tozeur', 'Kebili', 'Tataouine', 'Zaghouan'
];

export const AdminDashboardModal: React.FC<AdminDashboardModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onLogin,
  onLogout,
  devisHistory = [],
  artisans = [],
  onUpdateArtisans,
  rates = [],
  onBulkUpdateRates,
  onImportCompleted,
  lang,
  country,
  currency
}) => {
    // ── Defensive security guard ──────────────────────────────────────────────
  // AdminDashboardModal exposes privileged management UI (artisan moderation,
  // rate edition, pro-offer & commission configuration). It MUST only render
  // that UI for a server-validated admin session. isCurrentlyAdmin is the
  // single authoritative check (currentUser?.role === 'admin'); the dashboard
  // branch below is gated exclusively on it, so a non-admin session always
  // falls back to the real backend admin login form (handleAdminLogin) and
  // never to the management UI.
  const isCurrentlyAdmin = currentUser?.role === 'admin';

  // Authentication & Security State
  const [adminEmail, setAdminEmail] = useState<string>('');
  const [adminPassword, setAdminPassword] = useState<string>('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [showDeveloperApiStatus, setShowDeveloperApiStatus] = useState<boolean>(false);

  // Admin Tab Navigation State: 'artisans' | 'prices' | 'trades' | 'add_artisan' | 'commissions' | 'pro_offers' | 'stats'
  const [activeAdminTab, setActiveAdminTab] = useState<'artisans' | 'prices' | 'trades' | 'add_artisan' | 'commissions' | 'pro_offers' | 'stats' | 'global_catalog'>('artisans');
  const [artisanSearch, setArtisanSearch] = useState<string>('');
  const [artisanFilterStatus, setArtisanFilterStatus] = useState<'all' | 'free' | 'pro'>('all');
  const [notification, setNotification] = useState<string | null>(null);

  // CSV File Input Ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Phase C — Smart Mapping import state (upload → detect → map → preview → import)
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any | null>(null);
  const [importMapping, setImportMapping] = useState<Record<string, string>>({});
  const [importStep, setImportStep] = useState<'idle' | 'mapping' | 'importing'>('idle');
  // P1 — explicit "Métier par défaut" (files without a trade column) + the
  // persistent reason shown whenever "Confirmer l'import" is blocked. The
  // confirm handler must NEVER return silently on a blocked preview.
  const [importDefaultTradeChoice, setImportDefaultTradeChoice] = useState<string>('');
  const [importDefaultTradeCustom, setImportDefaultTradeCustom] = useState<string>('');
  const [importBlockReason, setImportBlockReason] = useState<string | null>(null);

  // Price Editing Local State
  const [editableRates, setEditableRates] = useState<MaterialRate[]>(rates);

  // Step 7 — Multi-Market: target market (country + currency) that persisted
  // official prices are saved under. Defaults to the currently selected UI
  // country/currency. Extensible from COUNTRIES_CONFIG (no TN-only hardcoding).
  const [selectedCountry, setSelectedCountry] = useState<CountryCode>(country);
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode>(currency);

  // Step 8 — Price Update Foundation: pending (unapproved) price updates for
  // admin review. Minimal UI — a list + an Approve button per row.
  // P2 — the review panel now tracks its own load state: a FAILED load (expired
  // admin session, DB unavailable, 5xx…) is surfaced with the real reason plus a
  // working "Actualiser" instead of being rendered as an empty queue, and a row
  // already being approved cannot be clicked twice (double publish). A
  // successful approve also re-syncs the app prices immediately
  // (onImportCompleted) so the new official price reaches the calculator/devis
  // without a page reload.
  const [pendingUpdates, setPendingUpdates] = useState<any[]>([]);
  const [pendingLoadState, setPendingLoadState] = useState<PendingReviewLoadState>('idle');
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [approvingIds, setApprovingIds] = useState<string[]>([]);
  const loadPendingUpdates = async () => {
    if (!isCurrentlyAdmin) return;
    setPendingLoadState('loading');
    setPendingError(null);
    try {
      const rows = await listPendingPriceUpdates();
      setPendingUpdates(Array.isArray(rows) ? rows : []);
      setPendingLoadState('loaded');
    } catch (err: any) {
      // P2 — never fail silently: the panel stays visible with the real reason.
      setPendingUpdates([]);
      setPendingError(pendingReviewErrorMessage(err));
      setPendingLoadState('error');
    }
  };
  const handleApprovePending = async (id: string) => {
    if (isApprovePendingBlocked(approvingIds, id)) return;
    setApprovingIds(prev => [...prev, id]);
    try {
      await approvePendingPriceUpdate(id);
      await loadPendingUpdates();
      // P2 — the approved row is now the official current price of its market:
      // re-run the existing price sync so the calculator/devis use it at once.
      if (typeof onImportCompleted === 'function') onImportCompleted();
      setNotification('✓ Prix approuvé : il devient le prix officiel courant de son marché.');
      setTimeout(() => setNotification(null), 3500);
    } catch (err: any) {
      setNotification(`âš  ${pendingReviewErrorMessage(err, "Impossible d'approuver ce prix.")}`);
      setTimeout(() => setNotification(null), 5000);
    } finally {
      setApprovingIds(prev => prev.filter(x => x !== id));
    }
  };

  // P2 — single source of truth for what the review panel renders.
  const pendingReviewView = resolvePendingReviewView({
    isAdmin: isCurrentlyAdmin,
    isPricesTab: activeAdminTab === 'prices',
    state: pendingLoadState,
    rowCount: pendingUpdates.length,
    error: pendingError,
  });

  // Load pending price updates whenever the admin opens the prices tab.
  useEffect(() => {
    if (activeAdminTab === 'prices') loadPendingUpdates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAdminTab, isCurrentlyAdmin]);

  // Dynamic Material Addition Form State
  const [showAddMaterialForm, setShowAddMaterialForm] = useState<boolean>(false);
  const [newMaterial, setNewMaterial] = useState<{
    nameFr: string;
    nameAr: string;
    nameEn: string;
    category: TradeCategory;
    unit: MaterialRate['unit'];
    unitPriceTnd: number;
    note: string;
  }>({
    nameFr: '',
    nameAr: '',
    nameEn: '',
    category: 'placo',
    unit: 'unit',
    unitPriceTnd: 15,
    note: ''
  });

  // Real server feature/plan view (company subscription → FREE/PRO).
  // This is the authoritative frontend view of /api/v1/features and replaces any
  // stale dependency on a non-existent /api/v1/pro-features contract.
  // P3: `enforced` comes from the server too — the UI never decides on its own
  // whether FREE/PRO gating is active.
  const {
    planCode: featurePlan,
    features: featureAccess,
    loading: featureLoading,
    enforced: featureEnforced,
    refresh: refreshFeaturePlan,
  } = useFeatures();

  // Phase 2 — Server-backed Feature Entitlement management (/api/v1/admin/features).
  // Replaces the former localStorage('konstrivo_pro_features') marketing store:
  // this tab now edits the REAL Feature Entitlement system the backend enforces.
  // P3: these settings ARE the live access control (freeAccess / proAccess /
  // role `scope` / usageLimit) — an admin change takes effect on the next check.
  const [serverFeatures, setServerFeatures] = useState<AdminFeatureEntitlement[]>([]);
  const [featuresLoadState, setFeaturesLoadState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [featuresLoadError, setFeaturesLoadError] = useState<string | null>(null);
  const [featureActionError, setFeatureActionError] = useState<string | null>(null);
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({});
  // usageLimit inputs are committed on blur (one POST per committed change).
  const [usageLimitDrafts, setUsageLimitDrafts] = useState<Record<string, string>>({});
  // Phase 3 — control-center view options (client-side only; the backend model
  // has no persistent ordering column, so display order is never persisted).
  const [featureSearch, setFeatureSearch] = useState('');
  const [featureSearchField, setFeatureSearchField] = useState<FeatureFilterField>('all');
  const [featureSortMode, setFeatureSortMode] = useState<FeatureSortMode>('key');

  const loadAdminFeatures = async () => {
    if (!isCurrentlyAdmin) return;
    setFeaturesLoadState('loading');
    setFeaturesLoadError(null);
    try {
      const rows = await listAdminFeatures();
      setServerFeatures(sortEntitlements(rows));
      setFeaturesLoadState('loaded');
    } catch (err: any) {
      setServerFeatures([]);
      setFeaturesLoadError(err?.message || 'Impossible de charger les entitlements.');
      setFeaturesLoadState('error');
    }
  };

  // Load the entitlement matrix whenever the admin opens the Pro Offers tab
  // (same pattern as pending price updates on the prices tab).
  useEffect(() => {
    if (activeAdminTab === 'pro_offers') loadAdminFeatures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAdminTab, isCurrentlyAdmin]);

  // The "Gestion Offres Pro (x/y)" tab label counts the SAME serverFeatures
  // rows: preload them as soon as an admin opens the dashboard so the label
  // never stays "0/0" while the existing FREE/PRO plans are on the server.
  // Read-only GET on the existing P3 backend; no second plan system.
  useEffect(() => {
    if (isOpen && isCurrentlyAdmin && featuresLoadState === 'idle') loadAdminFeatures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isCurrentlyAdmin]);

  // Phase 2/3 — Admin Usage Analytics: real DB aggregation only
  // (GET /api/v1/admin/features/usage?from&to&topUsers → user_feature_usage; no sample data).
  const [usageStats, setUsageStats] = useState<AdminFeatureUsageStats | null>(null);
  const [usageStatsError, setUsageStatsError] = useState<string | null>(null);
  const [usageStatsLoading, setUsageStatsLoading] = useState(false);
  const [usagePreset, setUsagePreset] = useState<UsageRangePreset>('this_month');
  const [usageShowTopUsers, setUsageShowTopUsers] = useState(false);

  const loadUsageStats = async (
    preset: UsageRangePreset = usagePreset,
    withTopUsers: boolean = usageShowTopUsers
  ) => {
    setUsageStatsLoading(true);
    setUsageStatsError(null);
    try {
      const range = usageRangeToParams(preset);
      const stats = await getFeatureUsageStats({ from: range.from, to: range.to, topUsers: withTopUsers });
      setUsageStats(stats);
    } catch (err: any) {
      setUsageStats(null);
      setUsageStatsError(err?.message || "Impossible de charger les statistiques d'usage.");
    } finally {
      setUsageStatsLoading(false);
    }
  };

  useEffect(() => {
    if (activeAdminTab === 'pro_offers' && isCurrentlyAdmin) loadUsageStats(usagePreset, usageShowTopUsers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAdminTab, isCurrentlyAdmin, usagePreset, usageShowTopUsers]);

  // ── P3 — Admin plan management (FREE/PRO) ──────────────────────────────────
  // Admin-only endpoints on the EXISTING subscriptions row (the row the Flouci
  // payment webhook/PRO verification also writes to). The plan returned here is
  // resolved by the SAME rule access control uses (getUserPlan /
  // planCodeFromSubscription), so the status displayed to the admin and the
  // status enforced for the user can never disagree.
  const [planTargetInput, setPlanTargetInput] = useState('');
  const [planView, setPlanView] = useState<AdminPlanView | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planBusy, setPlanBusy] = useState(false);

  const resolvePlanTargetOrError = (): AdminPlanTarget | null => {
    const parsed = parseAdminPlanTarget(planTargetInput);
    if (parsed.error || !parsed.target) {
      setPlanError(parsed.error || 'Cible invalide.');
      setPlanView(null);
      return null;
    }
    return parsed.target;
  };

  const handlePlanCheck = async () => {
    const target = resolvePlanTargetOrError();
    if (!target) return;
    setPlanBusy(true);
    setPlanError(null);
    try {
      setPlanView(await getAdminPlan(target));
    } catch (err: any) {
      setPlanView(null);
      setPlanError(err?.message || 'Impossible de résoudre le plan.');
    } finally {
      setPlanBusy(false);
    }
  };

  const handlePlanGrant = async (plan: 'free' | 'pro') => {
    const target = resolvePlanTargetOrError();
    if (!target) return;
    setPlanBusy(true);
    setPlanError(null);
    try {
      const view = await setAdminPlan({ ...target, plan });
      setPlanView(view);
      // Same entitlement source → refresh so the FREE/PRO badge of the current
      // session immediately matches what the backend now enforces.
      await refreshFeaturePlan();
      setNotification(`✓ Plan ${adminPlanLabel(view.planCode)} appliqué (entreprise ${view.companyId}).`);
      setTimeout(() => setNotification(null), 3500);
    } catch (err: any) {
      setPlanError(err?.message || 'Impossible de modifier le plan.');
    } finally {
      setPlanBusy(false);
    }
  };

  // Phase 3 — control-center derivations: overview counters + filtered/sorted
  // display list. Both are pure client-side views of `serverFeatures`; the
  // stored server order (GET /admin/features) is never mutated by them.
  const featureSummary = computeFeatureSummary(serverFeatures);
  const visibleFeatures = sortEntitlementsByMode(
    serverFeatures.filter((f) => matchesFeatureSearch(f, featureSearch, featureSearchField)),
    featureSortMode
  );

  // Commission & Fees Config State
  const [commissionType, setCommissionType] = useState<'percent' | 'flat' | 'hybrid'>('percent');
  const [commissionPercent, setCommissionPercent] = useState<number>(3.5);
  const [flatFeePerDevis, setFlatFeePerDevis] = useState<number>(15);
  const [proMonthlySubPrice, setProMonthlySubPrice] = useState<number>(49);
  const [retentionTaxPercent, setRetentionTaxPercent] = useState<number>(1.5);

  // New Artisan Form Local State
  const [newArtisan, setNewArtisan] = useState<{
    name: string;
    company: string;
    trade: TradeCategory;
    region: string;
    phone: string;
    whatsapp: string;
    hourlyRateTnd: number;
    squareMeterRateTnd: number;
    isPro2026: boolean;
    bio: string;
  }>({
    name: '',
    company: '',
    trade: 'placo',
    region: 'Tunis Grand',
    phone: '+216 ',
    whatsapp: '216',
    hourlyRateTnd: 20,
    squareMeterRateTnd: 18,
    isPro2026: true,
    bio: ''
  });

  // Sync rates prop if updated externally
  useEffect(() => {
    setEditableRates(rates);
  }, [rates]);

  if (!isOpen) return null;

  // Handle Admin Login inside Modal - MUST use real backend API only
  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    const cleanEmail = adminEmail.trim().toLowerCase();

    try {
      const adminProfile = await login({ email: cleanEmail, password: adminPassword });
      
      // Verify the returned profile has admin role
      if (adminProfile.role !== 'admin') {
        setAuthError('Accès refusé. Ce compte n\'a pas les permissions administrateur.');
        return;
      }

      onLogin(adminProfile);
      setNotification('✓ Connexion Administrateur réussie.');
      setTimeout(() => setNotification(null), 3000);
    } catch (err: any) {
      setAuthError(err?.message || 'Échec de la connexion. Vérifiez vos identifiants.');
    }
  };

  // Logout Handler
  const handleAdminLogout = () => {
    onLogout();
    setNotification('Déconnexion Administrateur effectuée.');
    setTimeout(() => {
      setNotification(null);
      onClose();
    }, 400);
  };

  // Toggle Pro status for an artisan
  const handleToggleProStatus = (artisanId: string) => {
    const updated = artisans.map(a => {
      if (a.id === artisanId) {
        const nextStatus = !a.isPro2026;
        return {
          ...a,
          isPro2026: nextStatus,
          // Rule 7 (Phase 2 fix F1): verification is independent of the
          // PRO/subscription status — never derive isVerified from the toggle.
          badges: nextStatus 
            ? Array.from(new Set([...a.badges, 'Certifié KONSTRIVO PRO 2026']))
            : a.badges.filter(b => !b.includes('PRO'))
        };
      }
      return a;
    });

    onUpdateArtisans(updated);
    setNotification('✓ Statut PRO de l\'artisan mis à jour avec succès.');
    setTimeout(() => setNotification(null), 3000);
  };

  // Delete an artisan
  const handleDeleteArtisan = (artisanId: string, artisanName: string) => {
    if (window.confirm(`Êtes-vous sûr de vouloir supprimer définitivement l'artisan "${artisanName}" de l'annuaire ?`)) {
      const updated = artisans.filter(a => a.id !== artisanId);
      onUpdateArtisans(updated);
      setNotification(`✓ Artisan "${artisanName}" supprimé de l'annuaire.`);
      setTimeout(() => setNotification(null), 3000);
    }
  };

  // Save modified base prices — persist EACH rate to PostgreSQL (official catalog)
  const handleSavePrices = async () => {
    onBulkUpdateRates(editableRates);
    if (!isCurrentlyAdmin) {
      setNotification('✓ Tous les barèmes de prix ont été enregistrés et appliqués en direct.');
      setTimeout(() => setNotification(null), 3000);
      return;
    }
    try {
      let saved = 0;
      for (const r of editableRates) {
        try {
          await upsertCatalogItem({
            code: r.id,
            price: r.unitPriceTnd,
            nameFr: r.nameFr,
            nameAr: r.nameAr || undefined,
            nameEn: r.nameEn || undefined,
            trade: r.category,
            category: r.category,
            unit: r.unit,
            currencyCode: selectedCurrency,
            countryCode: selectedCountry,
            technicalSpecs: r.note || undefined,
          });
          saved++;
        } catch (e) {
          // skip individual failures; UI still reflects local edit
        }
      }
      setNotification(`✓ Barèmes enregistrés : ${saved}/${editableRates.length} matériaux sauvegardés dans la base de données.`);
    } catch (e) {
      setNotification('✓ Barèmes appliqués en local (sauvegarde serveur partielle).');
    }
    setTimeout(() => setNotification(null), 3500);
  };

  // Single Rate Change in Local State
  const handleRatePriceChange = (id: string, newPrice: number) => {
    setEditableRates(prev => prev.map(r => r.id === id ? { ...r, unitPriceTnd: newPrice } : r));
  };

  // Add New Material Handler
  const handleCreateMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMaterial.nameFr || newMaterial.unitPriceTnd <= 0) {
      alert('Veuillez fournir un nom de matériau et un prix unitaire supérieur à 0.');
      return;
    }

    const createdId = `mat_custom_${Date.now()}`;
    const cleanNameFr = sanitizeInput(newMaterial.nameFr);
    const cleanNameAr = sanitizeInput(newMaterial.nameAr) || cleanNameFr;
    const cleanNameEn = sanitizeInput(newMaterial.nameEn) || '';
    const cleanNote = sanitizeInput(newMaterial.note) || 'Matériau personnalisé ajouté via Administration BTP';

    const newMaterialRate: MaterialRate = {
      id: createdId,
      category: newMaterial.category,
      nameFr: cleanNameFr,
      nameAr: cleanNameAr,
      nameEn: cleanNameEn || null,
      unit: newMaterial.unit,
      unitPriceTnd: Number(newMaterial.unitPriceTnd),
      defaultPriceTnd: Number(newMaterial.unitPriceTnd),
      note: cleanNote
    };

    const updatedRates = [newMaterialRate, ...editableRates];
    setEditableRates(updatedRates);
    onBulkUpdateRates(updatedRates);

    // Step 5 — persist the new official material + price to PostgreSQL
    if (isCurrentlyAdmin) {
      try {
        await upsertCatalogItem({
          code: createdId,
          price: Number(newMaterial.unitPriceTnd),
          nameFr: cleanNameFr,
          nameAr: cleanNameAr || undefined,
          nameEn: cleanNameEn || undefined,
          trade: newMaterial.category,
          category: newMaterial.category,
          unit: newMaterial.unit,
          currencyCode: selectedCurrency,
          countryCode: selectedCountry,
          technicalSpecs: cleanNote || undefined,
        });
      } catch (e) {
        // local add already reflected in UI; server save is best-effort here
      }
    }

    setNotification(`✓ Nouveau matériau "${cleanNameFr}" (${newMaterial.unitPriceTnd} DT/${newMaterial.unit}) ajouté aux barèmes BTP et calculateurs !`);
    
    // Reset Form
    setNewMaterial({
      nameFr: '',
      nameAr: '',
      nameEn: '',
      category: 'placo',
      unit: 'unit',
      unitPriceTnd: 15,
      note: ''
    });
    setShowAddMaterialForm(false);
    setTimeout(() => setNotification(null), 3500);
  };

  // Archive Material Handler — DATABASE-FIRST (DB = source of truth).
  //
  // The active catalog state lives in PostgreSQL (`materials.is_deleted`), so the
  // Admin action goes to `DELETE /api/v1/materials/:id` FIRST and the local barème
  // is only updated AFTER the server confirms (HTTP 2xx). The material is then
  // suppressed locally (`catalogTombstones`) so no cache — localStorage barème,
  // dev defaults, merge base — can revive it after a Refresh / app reopen.
  //
  // Nothing is hard-deleted and no history is rewritten: the material row keeps
  // its code and price rows, and Devis/project snapshots, users and projects are
  // never touched. A later import of the same code publishes it again (the
  // server's upsert resurrects the row and the material drops out of the
  // suppression list automatically).
  const handleDeleteMaterial = async (rate: MaterialRate) => {
    const label = rate.nameFr || rate.id;
    const confirmed = window.confirm(
      `Archiver le matériau "${label}" ?\n\n` +
      '• retiré des barèmes (Tarifs / Outils / Services) et ne reviendra pas après un Refresh ;\n' +
      '• conservé dans la base de données (prix, historique et Devis existants intacts) ;\n' +
      '• un nouvel import du même code le republiera.'
    );
    if (!confirmed) return;

    // The rate id IS the calculator's spelling of `materials.code`; the server
    // resolves it (plus an optional explicit code) without guessing.
    const reference = String((rate as any).code || rate.id || '').trim();
    if (reference === '') {
      setNotification('✗ Référence matériau illisible — rien n\'a été modifié.');
      setTimeout(() => setNotification(null), 4000);
      return;
    }

    let archivedInDb = false;
    if (isCurrentlyAdmin) {
      try {
        await archiveCatalogMaterial(reference);
        archivedInDb = true;
      } catch (err: any) {
        if (Number(err?.status) === 404) {
          // No row in the database (local-only barème entry): the local removal is
          // legitimate, but it is reported EXACTLY for what it is.
          archivedInDb = false;
        } else {
          // Real server refusal (403/409/500…): NOTHING changes locally and no
          // success is claimed — the Admin sees the server's own reason.
          setNotification(`✗ Archivage refusé (${label}) : ${err?.message || 'erreur serveur'} — aucun changement appliqué.`);
          setTimeout(() => setNotification(null), 6000);
          return;
        }
      }
    }

    // Local suppression ONLY for a confirmed DB archive or a local-only entry
    // (a non-admin session never writes the DB, so it also never tombstone).
    if (isCurrentlyAdmin) markCatalogTombstoned(rate.id, reference);

    const updatedRates = editableRates.filter(r => r.id !== rate.id);
    setEditableRates(updatedRates);
    onBulkUpdateRates(updatedRates);
    setNotification(
      archivedInDb
        ? `✓ Matériau "${label}" archivé dans la base de données, retiré des barèmes (historique conservé).`
        : `✓ Matériau "${label}" retiré des barèmes (absent de la base de données).`
    );
    setTimeout(() => setNotification(null), 4000);
  };

  // Phase C — Smart Mapping Catalog Import Handlers
  // The browser only TRANSMITS the raw file (.csv or .xlsx). ALL parsing,
  // column detection, smart mapping, validation and persistence happen
  // server-side:
  //   1. POST /api/v1/catalog/preview  → detected columns + suggested mapping
  //      + sample normalized rows + validation report (NO database write).
  //   2. The Admin reviews/adjusts the mapping (unmapped required fields
  //      block the import) — every change re-previews for live validation.
  //   3. POST /api/v1/catalog/import   → transactional commit through the
  //      EXISTING Phase A mechanism (dynamic trades + ONE transaction).
  const resetImportFlow = () => {
    setImportFile(null);
    setImportPreview(null);
    setImportMapping({});
    setImportStep('idle');
    // P1 — clear the default-trade choice and the block reason with the flow.
    setImportDefaultTradeChoice('');
    setImportDefaultTradeCustom('');
    setImportBlockReason(null);
  };

  // P1 — effective "Métier par défaut" (select choice + optional custom code).
  const importDefaultTrade = effectiveDefaultTrade(importDefaultTradeChoice, importDefaultTradeCustom);
  // Known trade categories from the local barème — used as the explicit
  // "Métier par défaut" options. No new API call, no hardcoded trade list.
  const knownTradeCategories = Array.from(new Set(
    editableRates.map((r) => (r.category || '').trim()).filter((c) => c.length > 0)
  )).sort();

  const requestImportPreview = async (file: File, mapping: Record<string, string>, defaultTrade: string = importDefaultTrade) => {
    const payload: any = await previewCatalogImport(file, {
      mapping,
      countryCode: selectedCountry,
      currencyCode: selectedCurrency,
      defaultTrade: defaultTrade.trim() !== '' ? defaultTrade.trim() : undefined,
    });
    setImportPreview(payload?.data || null);
    // A successful preview replaces any stale block reason.
    setImportBlockReason(null);
  };

  // P1 — explicit default-trade selection (files without a trade column).
  const handleDefaultTradeChoiceChange = async (choice: string) => {
    if (!importFile) return;
    setImportDefaultTradeChoice(choice);
    try {
      // Re-preview with the NEW effective choice ('' while "custom" is being
      // typed — the confirm gate stays blocked until the code is committed).
      await requestImportPreview(importFile, importMapping, choice === CUSTOM_DEFAULT_TRADE ? '' : choice);
    } catch (err: any) {
      setImportBlockReason(`Aperçu impossible après le choix du métier par défaut : ${err?.message || 'erreur serveur'}. L'import reste bloqué.`);
    }
  };

  // P1 — commit the custom default-trade code (blur / Enter — never per keystroke).
  const handleDefaultTradeCustomCommit = async () => {
    if (!importFile) return;
    if (importDefaultTradeChoice !== CUSTOM_DEFAULT_TRADE) return;
    const value = importDefaultTradeCustom.trim();
    try {
      await requestImportPreview(importFile, importMapping, value);
    } catch (err: any) {
      setImportBlockReason(`Aperçu impossible pour le métier « ${value || '(vide)'} » : ${err?.message || 'erreur serveur'}. L'import reste bloqué.`);
    }
  };

  const handleCatalogFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (event.target) event.target.value = '';
    if (!file) return;
    if (importStep !== 'idle') return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.csv') && !lower.endsWith('.xlsx')) {
      setNotification('✗ Format non supporté. Utilisez un fichier .csv ou .xlsx.');
      setTimeout(() => setNotification(null), 6000);
      return;
    }
    setImportStep('mapping');
    setImportFile(file);
    // New file → reset manual mapping deltas so the previous file's columns
    // can never shadow the new server suggestion (manual mapping is preserved
    // per-file via handleMappingChange; P1 defaultTrade flow untouched).
    setImportMapping({});
    setImportDefaultTradeChoice('');
    setImportDefaultTradeCustom('');
    setImportBlockReason(null);
    try {
      // No mapping yet — the server returns its suggestion first.
      await requestImportPreview(file, {});
    } catch (err: any) {
      setNotification(`✗ Import annulé — fichier rejeté : ${err?.message || 'Erreur serveur.'}`);
      setTimeout(() => setNotification(null), 8000);
      resetImportFlow();
    }
  };

  const handleMappingChange = async (fieldKey: string, sourceColumn: string) => {
    if (!importFile) return;
    const next = { ...importMapping };
    // Preserve manual mapping exactly: '' = explicit "Non mappé" (server
    // validates required-unmap as an error, optional-unmap as a delete).
    // Deleting the key would silently re-apply the server suggestion and make
    // a manual "Non mappé" choice impossible to keep.
    next[fieldKey] = sourceColumn || '';
    setImportMapping(next);
    try {
      // Re-preview for live validation of the new mapping (no DB write).
      await requestImportPreview(importFile, next);
    } catch (err: any) {
      // P1 — re-preview failures are surfaced, never swallowed: the previous
      // preview stays on screen but the persistent reason makes the block
      // explicit (the confirm gate consumes this state).
      setImportBlockReason(
        `Aperçu impossible après le changement de mapping : ${err?.message || 'erreur serveur'}. L'import reste bloqué tant qu'aucun aperçu valide n'est obtenu.`
      );
    }
  };

  const handleConfirmImport = async () => {
    if (!importFile) return;
    // Intentional double-submit guard only — every OTHER early return must
    // explain itself (P1: no silent no-op on a blocked preview).
    if (importStep === 'importing') return;
    if (!importPreview?.canImport) {
      setImportBlockReason(buildImportBlockReason(importPreview, importDefaultTrade));
      return;
    }
    setImportBlockReason(null);
    setImportStep('importing');
    try {
      const payload: any = await importCatalogFile(importFile, {
        mapping: importMapping,
        countryCode: selectedCountry,
        currencyCode: selectedCurrency,
        defaultTrade: importDefaultTrade.trim() !== '' ? importDefaultTrade.trim() : undefined,
      });
      const report = payload?.data || {};
      const rejectedNotif = (report.rejectedCount ?? 0) > 0
        ? ` · ${report.rejectedCount} ligne(s) rejetée(s) non écrite(s)`
        : '';
      setNotification(
        `✓ Import catalogue réussi : ${report.imported ?? 0} créé(s), ${report.updated ?? 0} mis à jour ` +
        `(${report.totalRows ?? 0} lignes, marché ${report.countryCode ?? selectedCountry}/${report.currencyCode ?? selectedCurrency})` +
        rejectedNotif +
        (importDefaultTrade.trim() !== '' ? ` — métier par défaut « ${importDefaultTrade.trim()} ».` : '.')
      );
      if (typeof onImportCompleted === 'function') onImportCompleted();
      setTimeout(() => setNotification(null), 6000);
      resetImportFlow();
    } catch (err: any) {
      const failedRows: any[] = Array.isArray(err?.report?.rejected) ? err.report.rejected
        : (Array.isArray(err?.report?.failed) ? err.report.failed : []);
      const reasons = failedRows
        .slice(0, 3)
        .map((f: any) => `ligne ${f.row}${f.reference ? ` (${f.reference})` : ''} : ${f.reason}`)
        .join(' | ');
      // The failure MUST describe itself truthfully: a server/transaction error
      // (500) is NOT « aucune ligne importable » — the preview proved otherwise.
      // The real server message is never hidden behind a generic label.
      const isServerError = err?.status === 500;
      setNotification(
        isServerError
          ? `✗ Import échoué — la transaction a été annulée, aucune donnée écrite. ${err?.message || 'Erreur serveur.'}${reasons ? ` | ${reasons}` : ''}`
          : `✗ Import annulé — aucune donnée écrite (aucune ligne importable). ${reasons || err?.message || 'Erreur serveur.'}`
      );
      setTimeout(() => setNotification(null), 8000);
      // Stay on the mapping step so the Admin can fix the reported rows.
      setImportStep('mapping');
    }
  };
  // (Phase A — the legacy browser-side CSV parsing and the N×upsertCatalogItem
  // persist loop were fully removed; import is now one transactional server call.)

  // Sample CSV Download Template — the Reference column is REQUIRED: it is the
  // stable material code (materials.code) that makes re-imports idempotent
  // (re-uploading the same file UPDATES rows in place, never duplicates).
  // The server-side Phase A import expects exactly these headers.
  const handleDownloadCsvSample = () => {
    const sampleCsvContent = 
`Reference;Nom_Materiau;Categorie;Unite;Prix_TND_HT;Note_Technique;Nom_Arabe
plaque_ba13_standard;Plaque BA13 Standard 3m2;placo;unit;30;Plaque plâtre NF 1.2x2.5m;بلاك با13 عادي
plaque_ba13_hydrofuge;Plaque BA13 Hydrofuge Vert;placo;unit;46;Plaque hydrofuge pièces humides;بلاك با13 مائي
laine_de_roche_50mm;Laine de Roche 50mm 7.2m2;isolation;boite;90;Isolation thermique et phonique;ØµÙˆÙ ØµØ®Ø±ÙŠ 50Ù…Ù…
enduit_de_joint_interieur_25kg;Enduit de Joint 25kg;peinture;sac;42;Séchage rapide pour calicot;معجون فاصل 25كغ
carreau_gres_cerame_60x60;Carreau Grès Cérame 60x60;carrelage;m²;38;Antidérapant R11 grand passage;زليج غرانيت 60*60
tube_pex_sanitaire_20mm;Tube PEX Sanitaire 20mm;plomberie;ml;3.5;Gainé rouge/bleu 50m;أنبوب صحي 20مم
parquet_stratifie_8mm_m2;Parquet Stratifié HDF 8mm AC4;sols;m²;34;Haute résistance aux passages;باركيه 8مم
camion_evacuation_gravats_6m3;Camion Évacuation Gravats 6m3;demolition;unit;160;Transport agréé vers décharge publique;نقل الأنقاض`;

    const blob = new Blob([sampleCsvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'modele_import_catalogue_konstrivo.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    // Phase 1 Feature Usage Analytics — the catalogue CSV export succeeded; fire-and-forget.
    trackFeatureUsage('catalogue:export');
  };

  // ── Phase 2: persist entitlement edits via POST/DELETE /api/v1/admin/features ──
  const patchFeatureOnServer = async (
    ent: AdminFeatureEntitlement,
    patch: AdminFeaturePatch,
    successMsg: string
  ): Promise<void> => {
    const { payload, error } = buildUpsertPayload(ent, patch);
    if (error || !payload) {
      setFeatureActionError(`${ent.featureKey} : ${error}`);
      return;
    }
    const previousRows = serverFeatures;
    // Optimistic update — rolled back if the server rejects the change.
    setServerFeatures(rows => sortEntitlements(rows.map(r => (r.featureKey === ent.featureKey ? applyFeaturePatch(r, patch) : r))));
    setSavingKeys(prev => ({ ...prev, [ent.featureKey]: true }));
    try {
      const saved = await upsertAdminFeature(payload);
      setServerFeatures(rows => sortEntitlements(rows.map(r => (r.featureKey === ent.featureKey ? saved : r))));
      setUsageLimitDrafts(prev => {
        const next = { ...prev };
        delete next[ent.featureKey];
        return next;
      });
      setFeatureActionError(null);
      setNotification(successMsg);
      setTimeout(() => setNotification(null), 3500);
    } catch (err: any) {
      setServerFeatures(previousRows);
      setFeatureActionError(`Échec de l'enregistrement (${ent.featureKey}) : ${err?.message || 'erreur serveur'}`);
    } finally {
      setSavingKeys(prev => ({ ...prev, [ent.featureKey]: false }));
    }
  };

  const toggleFeatureFlag = (ent: AdminFeatureEntitlement, field: 'freeAccess' | 'proAccess' | 'isActive'): void => {
    const label = ent.labelFr || ent.featureKey;
    void patchFeatureOnServer(
      ent,
      { [field]: !ent[field] } as AdminFeaturePatch,
      `✓ "${label}" enregistré côté serveur (${field} → ${!ent[field] ? 'oui' : 'non'}).`
    );
  };

  const commitLabelFr = (ent: AdminFeatureEntitlement, value: string): void => {
    const next = value.trim();
    if ((ent.labelFr ?? '') === next) return;
    void patchFeatureOnServer(
      ent,
      { labelFr: next === '' ? null : next },
      `✓ Libellé de "${ent.featureKey}" enregistré côté serveur.`
    );
  };

  // Phase 3 — shared label commit for labelFr / labelAr / labelDerja
  // (the model's text columns are varchar(200) — validated client-side too).
  const commitLabel = (
    ent: AdminFeatureEntitlement,
    field: 'labelFr' | 'labelAr' | 'labelDerja',
    value: string
  ): void => {
    const validationError = validateLabel(value);
    if (validationError) {
      setFeatureActionError(`${ent.featureKey} : ${validationError}`);
      return;
    }
    const next = value.trim();
    if ((ent[field] ?? '') === next) return;
    void patchFeatureOnServer(
      ent,
      { [field]: next === '' ? null : next } as AdminFeaturePatch,
      `✓ Libellé de "${ent.featureKey}" enregistré côté serveur.`
    );
  };
  const commitUsageLimit = (ent: AdminFeatureEntitlement): void => {
    const raw = (usageLimitDrafts[ent.featureKey] ?? '').trim();
    if (raw === '') {
      if (ent.usageLimit === null) return;
      void patchFeatureOnServer(ent, { usageLimit: null }, `✓ "${ent.labelFr || ent.featureKey}" : limite retirée (illimité) — enregistré côté serveur.`);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      setFeatureActionError(`Limite invalide pour ${ent.featureKey} : entier >= 1, ou vide pour "illimité".`);
      return;
    }
    if (parsed === ent.usageLimit) return;
    void patchFeatureOnServer(ent, { usageLimit: parsed }, `✓ "${ent.labelFr || ent.featureKey}" : limite mensuelle = ${parsed} — enregistré côté serveur.`);
  };

  const handleDeactivateFeature = async (ent: AdminFeatureEntitlement): Promise<void> => {
    if (!window.confirm(`Désactiver (soft-delete) "${ent.labelFr || ent.featureKey}" côté serveur ?`)) return;
    const previousRows = serverFeatures;
    setServerFeatures(rows => sortEntitlements(rows.map(r => (r.featureKey === ent.featureKey ? { ...r, isActive: false } : r))));
    setSavingKeys(prev => ({ ...prev, [ent.featureKey]: true }));
    try {
      await deactivateAdminFeature(ent.featureKey);
      setFeatureActionError(null);
      setNotification(`✓ Fonctionnalité "${ent.labelFr || ent.featureKey}" désactivée côté serveur.`);
      setTimeout(() => setNotification(null), 3500);
    } catch (err: any) {
      setServerFeatures(previousRows);
      setFeatureActionError(`Échec de la désactivation (${ent.featureKey}) : ${err?.message || 'erreur serveur'}`);
    } finally {
      setSavingKeys(prev => ({ ...prev, [ent.featureKey]: false }));
    }
  };

  // ── "+ Ajouter une fonctionnalité" — create a new Feature Entitlement ──────
  // Persists through the SAME single system (POST /api/v1/admin/features →
  // feature_entitlements); the returned server row is inserted immediately.
  // P3: the new row is a REAL entitlement — it is applied by the backend on
  // the next access check (no separate paywall switch to flip).
  const [showCreateFeatureForm, setShowCreateFeatureForm] = useState(false);
  const [featureCreateDraft, setFeatureCreateDraft] = useState<AdminFeatureCreateDraft>(EMPTY_FEATURE_CREATE_DRAFT);
  const [featureCreateError, setFeatureCreateError] = useState<string | null>(null);
  const [featureCreateSaving, setFeatureCreateSaving] = useState(false);

  const handleCreateFeature = async (): Promise<void> => {
    const { payload, error } = buildFeatureCreatePayload(
      featureCreateDraft,
      serverFeatures.map((r) => r.featureKey)
    );
    if (error || !payload) {
      setFeatureCreateError(error || 'Données invalides.');
      return;
    }
    setFeatureCreateSaving(true);
    setFeatureCreateError(null);
    try {
      const saved = await upsertAdminFeature(payload);
      // Immediate appearance: insert the returned server row (already mapped).
      setServerFeatures((rows) => sortEntitlements([...rows, saved]));
      setFeatureCreateDraft(EMPTY_FEATURE_CREATE_DRAFT);
      setShowCreateFeatureForm(false);
      setFeatureActionError(null);
      setNotification(`✓ Fonctionnalité "${saved.labelFr || saved.featureKey}" créée côté serveur.`);
      setTimeout(() => setNotification(null), 3500);
    } catch (err: any) {
      setFeatureCreateError(
        `Échec de la création (${payload.featureKey}) : ${err?.message || 'erreur serveur'}`
      );
    } finally {
      setFeatureCreateSaving(false);
    }
  };

  // Save Commission Configuration Handler
  const handleSaveCommissions = (e: React.FormEvent) => {
    e.preventDefault();
    setNotification('✓ Paramètres des commissions et grille tarifaire KONSTRIVO 2026 enregistrés avec succès !');
    setTimeout(() => setNotification(null), 3500);
  };

  // Add new Artisan Handler
  const handleCreateArtisan = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newArtisan.name || !newArtisan.phone) {
      alert('Veuillez remplir au moins le nom et le numéro de téléphone.');
      return;
    }

    const cleanName = sanitizeInput(newArtisan.name);
    const cleanCompany = sanitizeInput(newArtisan.company || newArtisan.name);
    const cleanPhone = sanitizeInput(newArtisan.phone);
    const cleanWhatsapp = sanitizeInput(newArtisan.whatsapp || newArtisan.phone.replace(/[^0-9]/g, ''));
    const cleanBio = sanitizeInput(newArtisan.bio) || 'Prestataire spécialisé certifié sur la plateforme KONSTRIVO BTP.';

    const createdItem: ArtisanDirectoryItem = {
      id: `art_admin_${Date.now()}`,
      name: cleanName,
      company: cleanCompany,
      trade: newArtisan.trade,
      secondaryTrades: [],
      region: newArtisan.region,
      rating: 5.0,
      reviewsCount: 1,
      // Rule 7 (Phase 2 fix F1): verification is independent of PRO — a newly
      // admin-registered artisan starts UNVERIFIED (set only by a real
      // verification flow, never from the PRO flag).
      isVerified: false,
      isPro2026: newArtisan.isPro2026,
      phone: cleanPhone,
      whatsapp: cleanWhatsapp,
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      bio: cleanBio,
      hourlyRateTnd: Number(newArtisan.hourlyRateTnd) || 20,
      squareMeterRateTnd: Number(newArtisan.squareMeterRateTnd) || 18,
      services: ['Ouvrages Placo BA13', 'Aménagement & Finitions'],
      badges: newArtisan.isPro2026 ? ['Certifié KONSTRIVO PRO 2026', 'Inscrit par Administrateur'] : ['Inscrit par Administrateur']
    };

    onUpdateArtisans([createdItem, ...artisans]);
    setNotification(`✓ Nouvel artisan "${cleanName}" ajouté avec succès à l'annuaire !`);
    
    // Reset Form
    setNewArtisan({
      name: '',
      company: '',
      trade: 'placo',
      region: 'Tunis Grand',
      phone: '+216 ',
      whatsapp: '216',
      hourlyRateTnd: 20,
      squareMeterRateTnd: 18,
      isPro2026: true,
      bio: ''
    });

    setActiveAdminTab('artisans');
    setTimeout(() => setNotification(null), 3500);
  };

  // Filter Artisans List
  const filteredArtisans = artisans.filter(artisan => {
    const matchesSearch = artisan.name.toLowerCase().includes(artisanSearch.toLowerCase()) ||
                          artisan.company.toLowerCase().includes(artisanSearch.toLowerCase()) ||
                          artisan.region.toLowerCase().includes(artisanSearch.toLowerCase()) ||
                          artisan.trade.toLowerCase().includes(artisanSearch.toLowerCase());

    if (artisanFilterStatus === 'pro') return matchesSearch && (artisan.isPro2026 || artisan.isVerified);
    if (artisanFilterStatus === 'free') return matchesSearch && !artisan.isPro2026 && !artisan.isVerified;
    return matchesSearch;
  });

  // Calculate Metrics
  const totalDevisCount = devisHistory.length || 28;
  const totalDevisVolumeTnd = devisHistory.reduce((acc, d) => acc + (d.totalTnd || d.total || 0), 0) || 185400;
  const proArtisansCount = artisans.filter(a => a.isPro2026 || a.isVerified).length;
  const freeArtisansCount = artisans.length - proArtisansCount;
  const avgDevisTnd = totalDevisCount > 0 ? Math.round(totalDevisVolumeTnd / totalDevisCount) : 6620;

  // Sample fallback devis list for stats display if devisHistory is empty
  interface AdminStatsDevis {
    id: string;
    clientName: string;
    projectTitle: string;
    surfaceArea: number;
    totalTnd: number;
    date: string;
    status: string;
  }

  const sampleDevisList: AdminStatsDevis[] = devisHistory.length > 0 
    ? devisHistory.map(d => ({
        id: d.id || d.reference || 'DEV-2026',
        clientName: d.clientName || 'Client Particulier',
        projectTitle: d.projectTitle || (d.items && d.items[0] ? d.items[0].title : 'Travaux Placo & Aménagement'),
        surfaceArea: d.items && d.items[0] ? d.items[0].quantity : 120,
        totalTnd: d.totalTnd || d.total || 0,
        date: d.date || new Date().toISOString().split('T')[0],
        status: d.status || 'valide'
      }))
    : [
        {
          id: 'DEV-2026-081',
          clientName: 'Sami Mansour',
          projectTitle: 'Faux Plafond BA13 + Caisson LED',
          surfaceArea: 145,
          totalTnd: 8420,
          date: '2026-08-20',
          status: 'valide'
        },
        {
          id: 'DEV-2026-080',
          clientName: 'Résidence Ennasr 2',
          projectTitle: 'Cloison Séparation Double BA13',
          surfaceArea: 210,
          totalTnd: 14200,
          date: '2026-08-19',
          status: 'en_attente'
        },
        {
          id: 'DEV-2026-079',
          clientName: 'Boutique Lac 2',
          projectTitle: 'Plafond Démontable 60x60 Vinyl',
          surfaceArea: 95,
          totalTnd: 5180,
          date: '2026-08-18',
          status: 'valide'
        },
        {
          id: 'DEV-2026-078',
          clientName: 'Villa Hammamet Nord',
          projectTitle: 'Habillage Extérieur Aquapanel Ciment',
          surfaceArea: 180,
          totalTnd: 22400,
          date: '2026-08-16',
          status: 'valide'
        }
      ];

  // C1 fix: scroll container â‰  centering container. m-auto centers the dialog
  // when it fits and degrades to top-aligned when it overflows, so the header,
  // tabs and close button can never be clipped above the scrollable top.
  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-4 bg-black/90 backdrop-blur-sm md:backdrop-blur-md overflow-y-auto overscroll-contain">
      <div className="relative w-full max-w-5xl max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100vh-2rem)] bg-[#0b0f17] border border-amber-500/30 rounded-3xl shadow-2xl overflow-y-auto overscroll-contain m-auto text-white">
        
        {/* Top Header */}
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-amber-950/50 p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 bg-amber-500/20 border border-amber-500/40 rounded-2xl text-amber-400 shadow-md shadow-amber-500/10">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-white flex items-center gap-2 flex-wrap">
                <span>Espace Administration Général KONSTRIVO</span>
                {isCurrentlyAdmin && (
                  <span className="px-2.5 py-0.5 text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full font-mono flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Owner Admin
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-400">
                Panneau propriétaire : gestion globale des artisans, tarifs barèmes et devis calculés
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isCurrentlyAdmin && (
              <button
                onClick={handleAdminLogout}
                className="px-3.5 py-2 bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-500/40 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                title="Se déconnecter de l'administration"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Déconnexion Admin</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2.5 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

                {/* Defend admin-only UI: privileged dashboard renders ONLY when isCurrentlyAdmin is true (defensive guard) */}
        {/* NOT AUTHENTICATED: ADMIN LOGIN FORM */}
        {!isCurrentlyAdmin ? (
          <div className="p-6 sm:p-10 space-y-6">
            <div className="max-w-md mx-auto space-y-6 bg-slate-950 p-6 sm:p-8 rounded-3xl border border-slate-800 shadow-2xl">
              
              <div className="text-center space-y-2">
                <div className="inline-flex p-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-400 mb-1">
                  <KeyRound className="w-8 h-8" />
                </div>
                <h4 className="text-lg font-black text-white">Authentification Propriétaire</h4>
                <p className="text-xs text-slate-400">
                  Veuillez saisir vos identifiants administrateur pour accéder à l'Espace Administration Général.
                </p>
              </div>

              {authError && (
                <div className="p-3 bg-rose-950/60 border border-rose-500/40 rounded-xl text-xs text-rose-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{authError}</span>
                </div>
              )}

              <form onSubmit={handleAdminLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Email Administrateur</label>
                  <input
                    type="email"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    placeholder="admin@entreprise.tn"
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Mot de Passe</label>
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black rounded-xl shadow-lg shadow-amber-500/20 transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>Se Connecter au Dashboard Admin</span>
                  </button>
                </div>
              </form>

            </div>
          </div>
        ) : (
          /* AUTHENTICATED: OWNER ADMIN DASHBOARD */
          <div className="p-5 sm:p-6 space-y-6">
            
            {/* Notification Banner */}
            {notification && (
              <div className="p-3.5 bg-emerald-950/80 border border-emerald-500/50 rounded-2xl text-xs text-emerald-300 flex items-center gap-2 animate-in fade-in">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="font-semibold">{notification}</span>
              </div>
            )}

            {/* Developer API Sync Status Indicator */}
            <div className="bg-slate-950 p-3.5 sm:p-4 rounded-2xl border border-amber-500/30 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl shrink-0">
                  <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin-slow" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-white">Bridge REST API & Mobile Sync</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase font-mono">
                      Prêt (Flutter / React Native)
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Schémas JSON synchronisés pour l'application Mobile & Web. Jetons JWT & Hachage SHA-256 actifs.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowDeveloperApiStatus(!showDeveloperApiStatus)}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-850 text-amber-400 hover:text-amber-300 border border-slate-800 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>{showDeveloperApiStatus ? 'Masquer Détails API' : 'Inspecter Endpoints REST'}</span>
                </button>
              </div>
            </div>

            {/* Expanded API Schema Status Modal/Panel */}
            {showDeveloperApiStatus && (
              <div className="bg-slate-900/90 p-4 rounded-2xl border border-amber-500/40 space-y-3 animate-in fade-in">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <h5 className="text-xs font-bold text-amber-400 flex items-center gap-2 font-mono">
                    <KeyRound className="w-4 h-4" />
                    <span>CONTRATS D'ENDPOINTS API REST V1 (MOBILE & WEB SYNC)</span>
                  </h5>
                  <span className="text-[10px] text-slate-400 font-mono">Protocole: HTTPS / Bearer JWT</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs font-mono">
                  <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800">
                    <div className="text-[10px] text-emerald-400 font-bold">GET /api/v1/rates</div>
                    <div className="text-slate-300 text-[11px] mt-0.5">Payload: {editableRates.length} Matériaux BTP</div>
                    <div className="text-[10px] text-slate-500 mt-1">Format: MaterialRate[] JSON</div>
                  </div>

                  <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800">
                    <div className="text-[10px] text-emerald-400 font-bold">GET /api/v1/artisans</div>
                    <div className="text-slate-300 text-[11px] mt-0.5">Payload: {artisans.length} Artisans qualifiés</div>
                    <div className="text-[10px] text-slate-500 mt-1">Format: ArtisanDirectoryItem[] JSON</div>
                  </div>

                  <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800">
                    <div className="text-[10px] text-emerald-400 font-bold">POST /api/v1/devis</div>
                    <div className="text-slate-300 text-[11px] mt-0.5">Payload: {devisHistory.length} Devis chantiers</div>
                    <div className="text-[10px] text-slate-500 mt-1">Format: DevisDocument[] JSON</div>
                  </div>

                  <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800">
                    <div className="text-[10px] text-emerald-400 font-bold">GET /api/v1/features</div>
                    <div className="text-slate-300 text-[11px] mt-0.5">
                      {featureLoading ? 'Plan: loading…' : `Plan: ${featurePlan} · Fonctions: ${featureAccess.length}`}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">
                      Format: { 'planCode: free|pro, features: FeatureAccess[]' }
                    </div>
                  </div>

                  <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800">
                    <div className="text-[10px] text-sky-400 font-bold">DATABASE COMPATIBILITY</div>
                    <div className="text-slate-300 text-[11px] mt-0.5">Firebase / PostgreSQL</div>
                    <div className="text-[10px] text-slate-500 mt-1">Dual-Driver Ready for Mobile</div>
                  </div>
                </div>
              </div>
            )}

            {/* METRICS BAR: Clickable Top Stat Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Card 1: Inscrits Totaux -> Switches to Artisans tab (All) */}
              <button
                type="button"
                onClick={() => {
                  setActiveAdminTab('artisans');
                  setArtisanFilterStatus('all');
                }}
                className={`text-left p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group ${
                  activeAdminTab === 'artisans' && artisanFilterStatus === 'all'
                    ? 'bg-gradient-to-br from-amber-500/20 via-slate-950 to-slate-950 border-amber-400 ring-2 ring-amber-400/30'
                    : 'bg-slate-950 border-slate-800 hover:border-amber-500/50 hover:bg-slate-900/90'
                }`}
              >
                <div className="flex items-center justify-between text-slate-400 text-[10px] font-bold uppercase">
                  <span>Inscrits Totaux</span>
                  <Users className="w-3.5 h-3.5 text-amber-400" />
                </div>
                <div className="text-xl font-black text-white font-mono mt-1">{artisans.length}</div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-slate-400 block">{proArtisansCount} Pro / {freeArtisansCount} Gratuit</span>
                  <span className="text-[10px] text-amber-400 font-bold opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                    Voir <ArrowRight className="w-2.5 h-2.5" />
                  </span>
                </div>
              </button>

              {/* Card 2: Artisans PRO -> Switches to Artisans tab (Pro Filter) */}
              <button
                type="button"
                onClick={() => {
                  setActiveAdminTab('artisans');
                  setArtisanFilterStatus('pro');
                }}
                className={`text-left p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group ${
                  activeAdminTab === 'artisans' && artisanFilterStatus === 'pro'
                    ? 'bg-gradient-to-br from-emerald-500/20 via-slate-950 to-slate-950 border-emerald-400 ring-2 ring-emerald-400/30'
                    : 'bg-slate-950 border-slate-800 hover:border-emerald-500/50 hover:bg-slate-900/90'
                }`}
              >
                <div className="flex items-center justify-between text-slate-400 text-[10px] font-bold uppercase">
                  <span>Artisans PRO</span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <div className="text-xl font-black text-emerald-400 font-mono mt-1">{proArtisansCount}</div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-emerald-400/90 block font-semibold">✓ Badges Vérifiés</span>
                  <span className="text-[10px] text-emerald-400 font-bold opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                    Voir <ArrowRight className="w-2.5 h-2.5" />
                  </span>
                </div>
              </button>

              {/* Card 3: Devis Calculés -> Switches to Stats & Devis tab */}
              <button
                type="button"
                onClick={() => setActiveAdminTab('stats')}
                className={`text-left p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group ${
                  activeAdminTab === 'stats'
                    ? 'bg-gradient-to-br from-amber-500/20 via-slate-950 to-slate-950 border-amber-400 ring-2 ring-amber-400/30'
                    : 'bg-slate-950 border-slate-800 hover:border-amber-500/50 hover:bg-slate-900/90'
                }`}
              >
                <div className="flex items-center justify-between text-slate-400 text-[10px] font-bold uppercase">
                  <span>Devis Calculés</span>
                  <FileText className="w-3.5 h-3.5 text-amber-400" />
                </div>
                <div className="text-xl font-black text-amber-400 font-mono mt-1">{totalDevisCount}</div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-slate-400 block font-mono">Vol: {totalDevisVolumeTnd.toLocaleString('fr-TN')} DT</span>
                  <span className="text-[10px] text-amber-400 font-bold opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                    Détails <ArrowRight className="w-2.5 h-2.5" />
                  </span>
                </div>
              </button>

              {/* Card 4: Base Matériaux -> Switches to Prices tab */}
              <button
                type="button"
                onClick={() => setActiveAdminTab('prices')}
                className={`text-left p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden group ${
                  activeAdminTab === 'prices'
                    ? 'bg-gradient-to-br from-sky-500/20 via-slate-950 to-slate-950 border-sky-400 ring-2 ring-sky-400/30'
                    : 'bg-slate-950 border-slate-800 hover:border-sky-500/50 hover:bg-slate-900/90'
                }`}
              >
                <div className="flex items-center justify-between text-slate-400 text-[10px] font-bold uppercase">
                  <span>Base Matériaux</span>
                  <DollarSign className="w-3.5 h-3.5 text-sky-400" />
                </div>
                <div className="text-xl font-black text-sky-400 font-mono mt-1">{rates.length}</div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-slate-400 block">Tarifs 2026 Actifs</span>
                  <span className="text-[10px] text-sky-400 font-bold opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                    Éditer <ArrowRight className="w-2.5 h-2.5" />
                  </span>
                </div>
              </button>
            </div>

            {/* Admin Top Navigation Tabs Selector */}
            {/* M2 fix: relative wrapper holds a mobile-only fade hinting that
                more tabs are available to the right (scroll stays functional). */}
            <div className="relative">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3 overflow-x-auto scrollbar-none">
              
              {/* Tab 1: Gestion des Artisans */}
              <button
                type="button"
                onClick={() => setActiveAdminTab('artisans')}
                className={`px-4 py-3 sm:py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                  activeAdminTab === 'artisans'
                    ? 'bg-amber-400 text-slate-950 font-black shadow-lg shadow-amber-500/20 border border-amber-400'
                    : 'bg-[#111827] text-slate-300 hover:text-white border border-slate-800 hover:bg-slate-800'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Gestion des Artisans ({artisans.length})</span>
              </button>

              {/* Tab 2: Barèmes de Prix BTP */}
              <button
                type="button"
                onClick={() => setActiveAdminTab('prices')}
                className={`px-4 py-3 sm:py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                  activeAdminTab === 'prices'
                    ? 'bg-amber-400 text-slate-950 font-black shadow-lg shadow-amber-500/20 border border-amber-400'
                    : 'bg-[#111827] text-slate-300 hover:text-white border border-slate-800 hover:bg-slate-800'
                }`}
              >
                <DollarSign className="w-4 h-4" />
                <span>Barèmes de Prix BTP ({rates.length})</span>
              </button>

              {/* Tab 2b: Métiers / Trades (Admin → Métiers) */}
              <button
                type="button"
                onClick={() => setActiveAdminTab('trades')}
                className={`px-4 py-3 sm:py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                  activeAdminTab === 'trades'
                    ? 'bg-amber-400 text-slate-950 font-black shadow-lg shadow-amber-500/20 border border-amber-400'
                    : 'bg-[#111827] text-slate-300 hover:text-white border border-slate-800 hover:bg-slate-800'
                }`}
              >
                <Layers className="w-4 h-4" />
                <span>Métiers (Outils &amp; Services)</span>
              </button>

              {/* Tab 3: Nouveau Profil Artisan */}
              <button
                type="button"
                onClick={() => setActiveAdminTab('add_artisan')}
                className={`px-4 py-3 sm:py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                  activeAdminTab === 'add_artisan'
                    ? 'bg-amber-400 text-slate-950 font-black shadow-lg shadow-amber-500/20 border border-amber-400'
                    : 'bg-[#111827] text-slate-300 hover:text-white border border-slate-800 hover:bg-slate-800'
                }`}
              >
                <PlusCircle className="w-4 h-4" />
                <span>Nouveau Profil Artisan</span>
              </button>

              {/* Tab 4: Commissions & Frais */}
              <button
                type="button"
                onClick={() => setActiveAdminTab('commissions')}
                className={`px-4 py-3 sm:py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                  activeAdminTab === 'commissions'
                    ? 'bg-amber-400 text-slate-950 font-black shadow-lg shadow-amber-500/20 border border-amber-400'
                    : 'bg-[#111827] text-slate-300 hover:text-white border border-slate-800 hover:bg-slate-800'
                }`}
              >
                <Coins className="w-4 h-4" />
                <span>Commissions & Frais</span>
              </button>

              {/* Tab 5: Offres Pro (SaaS) */}
              <button
                type="button"
                onClick={() => setActiveAdminTab('pro_offers')}
                className={`px-4 py-3 sm:py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                  activeAdminTab === 'pro_offers'
                    ? 'bg-amber-400 text-slate-950 font-black shadow-lg shadow-amber-500/20 border border-amber-400'
                    : 'bg-[#111827] text-slate-300 hover:text-white border border-slate-800 hover:bg-slate-800'
                }`}
              >
                <ListChecks className="w-4 h-4" />
                <span>Gestion Offres Pro ({serverFeatures.filter(f => f.isActive).length}/{serverFeatures.length})</span>
              </button>

              {/* Tab 6: Statistiques & Devis */}
              <button
                type="button"
                onClick={() => setActiveAdminTab('stats')}
                className={`px-4 py-3 sm:py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer ${
                  activeAdminTab === 'stats'
                    ? 'bg-amber-400 text-slate-950 font-black shadow-lg shadow-amber-500/20 border border-amber-400'
                    : 'bg-[#111827] text-slate-300 hover:text-white border border-slate-800 hover:bg-slate-800'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                <span>Statistiques & Devis ({totalDevisCount})</span>
              </button>

              {/* Tab 7: Global Catalog */}
              <button
                type="button"
                onClick={() => setActiveAdminTab('global_catalog')}
                className={`px-4 py-3 sm:py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer
${
                  activeAdminTab === 'global_catalog'
                    ? 'bg-amber-400 text-slate-950 font-black shadow-lg shadow-amber-500/20 border border-amber-400'
                    : 'bg-[#111827] text-slate-300 hover:text-white border border-slate-800 hover:bg-slate-800'
                }`}
              >
                <Globe className="w-4 h-4" />
                <span>Global Catalog</span>
              </button>
            </div>
              {/* Mobile-only right-edge fade (desktop untouched) */}
              <div className="sm:hidden absolute top-0 right-0 bottom-3 w-10 bg-gradient-to-l from-[#0b0f17] via-[#0b0f17]/70 to-transparent pointer-events-none" aria-hidden="true"></div>
            </div>

            {/* TAB 1: ARTISAN MANAGEMENT TABLE */}
            {activeAdminTab === 'artisans' && (
              <div className="space-y-4">
                
                {/* Search & Status Filters */}
                <div className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center">
                  <div className="relative w-full sm:w-80">
                    <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={artisanSearch}
                      onChange={(e) => setArtisanSearch(e.target.value)}
                      placeholder="Rechercher nom, ville, spécialité..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:border-amber-400 focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
                    <button
                      type="button"
                      onClick={() => setArtisanFilterStatus('all')}
                      className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                        artisanFilterStatus === 'all' ? 'bg-amber-400 text-slate-950 font-black' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Tous ({artisans.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setArtisanFilterStatus('pro')}
                      className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                        artisanFilterStatus === 'pro' ? 'bg-emerald-500 text-slate-950 font-black' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      PRO Verified ({proArtisansCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setArtisanFilterStatus('free')}
                      className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                        artisanFilterStatus === 'free' ? 'bg-slate-800 text-white font-bold' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Gratuit ({freeArtisansCount})
                    </button>
                  </div>
                </div>

                {/* Artisan Management Table */}
                <div className="max-h-96 overflow-y-auto border border-slate-800 rounded-2xl bg-slate-950">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900 text-slate-400 sticky top-0 border-b border-slate-800 z-10">
                      <tr>
                        <th className="p-3">Artisan / Entreprise</th>
                        <th className="p-3">Ville / Gouvernorat</th>
                        <th className="p-3">Téléphone</th>
                        <th className="p-3">Abonnement / Plan</th>
                        <th className="p-3 text-right">Actions Administrateur</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {filteredArtisans.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-8 text-center text-slate-500">
                            Aucun artisan ne correspond à votre recherche.
                          </td>
                        </tr>
                      ) : (
                        filteredArtisans.map((artisan) => (
                          <tr key={artisan.id} className="hover:bg-slate-900/60 transition-colors">
                            <td className="p-3 font-semibold text-white">
                              <div className="flex items-center gap-2.5">
                                <img src={artisan.avatar} alt={artisan.name} className="w-8 h-8 rounded-full object-cover shrink-0 border border-slate-700" />
                                <div>
                                  <div className="font-bold text-white flex items-center gap-1.5">
                                    <span>{artisan.name}</span>
                                    {artisan.isPro2026 && (
                                      <span className="px-1.5 py-0.2 text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded font-mono font-black">PRO</span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-slate-400">{artisan.company}</div>
                                </div>
                              </div>
                            </td>

                            <td className="p-3 font-medium text-slate-300">
                              <div className="flex items-center gap-1">
                                <MapPin className="w-3 h-3 text-amber-400 shrink-0" />
                                <span>{artisan.region}</span>
                              </div>
                            </td>

                            <td className="p-3 font-mono text-slate-300">{artisan.phone}</td>

                            <td className="p-3">
                              {artisan.isPro2026 || artisan.isVerified ? (
                                <span className="px-2.5 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full inline-flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3" />
                                  Plan PRO Verified
                                </span>
                              ) : (
                                <span className="px-2.5 py-0.5 text-[10px] font-bold bg-slate-800 text-slate-400 rounded-full">
                                  Plan Gratuit
                                </span>
                              )}
                            </td>

                            <td className="p-3 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleToggleProStatus(artisan.id)}
                                  className={`px-3 py-1 text-[10px] font-black rounded-lg border transition-all cursor-pointer ${
                                    artisan.isPro2026
                                      ? 'bg-slate-900 text-amber-400 border-slate-700 hover:bg-slate-800'
                                      : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 border-emerald-400 shadow-md shadow-emerald-500/20'
                                  }`}
                                >
                                  {artisan.isPro2026 ? 'Rétrograder' : 'Activate PRO'}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleDeleteArtisan(artisan.id, artisan.name)}
                                  className="p-1.5 text-rose-400 hover:text-white bg-slate-900 hover:bg-rose-950/80 border border-slate-800 rounded-lg transition-all cursor-pointer"
                                  title="Supprimer l'artisan"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

              </div>
            )}

            {/* TAB 2: GLOBAL PRICE MANAGER */}
            {activeAdminTab === 'prices' && (
              <div className="space-y-4">
                
                {/* Hidden File Input for CSV/XLSX Catalogue Import (Phase C Smart Mapping) */}
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleCatalogFileSelected}
                  accept=".csv,.txt,.xlsx"
                  className="hidden"
                />

                {/* Phase C — Smart Mapping panel: detect columns → map fields →
                    preview → validate → import. Rendered between the upload
                    button click and the transactional import. */}
                {importStep !== 'idle' && importPreview && (
                  <div className="bg-slate-950 p-4 rounded-2xl border border-emerald-500/30 space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <div>
                        <h4 className="text-xs font-bold text-emerald-400 flex items-center gap-2">
                          <FileSpreadsheet className="w-4 h-4" />
                          <span>Import intelligent — correspondance des colonnes</span>
                        </h4>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {String(importPreview.fileName || '')} Â· {importPreview.fileType === 'xlsx' ? 'Excel (xlsx)' : 'CSV'}
                          {importPreview.sheetName ? ` Â· feuille Â« ${importPreview.sheetName} Â»` : ''}
                          {' '}· {importPreview.totalRows ?? 0} ligne(s) détectée(s)
                          {' '}· marché {importPreview.countryCode || selectedCountry}/{importPreview.currencyCode || selectedCurrency}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={resetImportFlow}
                        className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 text-[11px] font-bold border border-slate-800 rounded-lg transition-all cursor-pointer"
                      >
                        Annuler
                      </button>
                    </div>

                    {visibleUnmappedRequired(importPreview, importDefaultTrade).length > 0 && (
                      <div className="text-[11px] text-rose-300 bg-rose-950/40 border border-rose-500/30 rounded-xl px-3 py-2">
                        ✗ Champs obligatoires non mappés : {visibleUnmappedRequired(importPreview, importDefaultTrade).join(', ')} — l'import est bloqué jusqu'à leur correspondance.
                      </div>
                    )}
                    {(importPreview.mappingErrors || []).length > 0 && (
                      <div className="text-[11px] text-rose-300 bg-rose-950/40 border border-rose-500/30 rounded-xl px-3 py-2">
                        âœ— {(importPreview.mappingErrors || []).join(' | ')}
                      </div>
                    )}
                    {(importPreview.rejected || []).length > 0 && (
                      <div className="text-[11px] text-amber-300 bg-amber-950/30 border border-amber-500/30 rounded-xl px-3 py-2">
                        {(importPreview.validCount ?? 0) > 0 ? (
                          <>⚠ {importPreview.rejectedCount} ligne(s) rejetée(s) — non écrites ; les {importPreview.validCount} ligne(s) importable(s) ci-dessous seront importées :</>
                        ) : (
                          <>✗ {importPreview.rejectedCount} ligne(s) rejetée(s) — aucune ligne importable, l'import reste bloqué :</>
                        )}
                        {(importPreview.rejected || []).slice(0, 10).map((f: any, i: number) => (
                          <div key={i} className="mt-0.5">ligne {f.row}{f.reference ? ` (${f.reference})` : ''} : {f.reason}</div>
                        ))}
                        {(importPreview.rejectedCount ?? 0) > (importPreview.rejected || []).length && (
                          <div className="mt-0.5 text-slate-400">… et {(importPreview.rejectedCount ?? 0) - (importPreview.rejected || []).length} autre(s) (rapport complet à l'import).</div>
                        )}
                      </div>
                    )}

                    {/* Mapping selectors — DISPLAY ONLY, generic, driven by the
                        server field registry. The value shown is EXACTLY the
                        mapping the pipeline applied (`appliedMapping` returned by
                        POST /catalog/preview — the very object /catalog/import
                        consumes), with the Admin's manual deltas (importMapping)
                        layered on top. The mapped source column is also printed
                        next to the field label AND summarised above the grid, so a
                        field the server mapped can never look « — Non mappé — ». */}
                    {(Object.keys(importPreview.appliedMapping || {}).length > 0) && (
                      <div className="bg-slate-950 border border-emerald-500/20 rounded-xl px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">
                          Mapping appliqué par le serveur (celui utilisé par l'import) â€” {Object.keys(importPreview.appliedMapping || {}).length} champ(s)
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          {(Object.entries(importPreview.appliedMapping || {}) as Array<[string, any]>).map(([key, src]) => (
                            <span key={key} className="text-[10px] font-mono">
                              <span className="text-slate-300">
                                {(importPreview.fields || []).find((f: any) => f.key === key)?.label || key}
                              </span>
                              <span className="text-slate-500"> ← </span>
                              <span className="text-emerald-300">{String(src)}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {(importPreview.fields || []).map((field: any) => {
                        const detectedColumns: any[] = importPreview.detectedColumns || [];
                        // SERVER TRUTH FIRST: `appliedMapping` is what the engine
                        // really mapped. `importMapping` only holds manual deltas.
                        const serverValue: string = importPreview.appliedMapping?.[field.key] || '';
                        const hasManualDelta = Object.prototype.hasOwnProperty.call(importMapping, field.key);
                        const current: string = hasManualDelta ? (importMapping[field.key] || '') : serverValue;
                        // The server value MUST have a matching <option>: a controlled
                        // <select> whose value matches no option falls back to its
                        // FIRST option (« — Non mappé — »), which is how a mapped
                        // field could LOOK unmapped. The mapped column is therefore
                        // always selectable, even if it is missing from the detected
                        // column list (BOM / whitespace / case drift).
                        const hasMatchingOption = detectedColumns.some((col: any) => String(col.source) === current);
                        // GUARANTEE — a field the server mapped is NEVER displayed as
                        // « — Non mappé — »: whenever a NON-EMPTY value is selected
                        // (the SERVER's `appliedMapping` or an Admin manual choice)
                        // the <select> MUST own an exact option for it. Otherwise the
                        // browser silently falls back to its FIRST option — the
                        // « — Non mappé — » placeholder — and a mapped field LOOKS
                        // unmapped. The server-mapped column therefore gets its own
                        // option ONLY when `detectedColumns` does not already carry
                        // it, and « — Non mappé — » survives for EMPTY values only.
                        const serverMappedOptionRequired = current !== '' && !hasMatchingOption;
                        return (
                          <div key={field.key} className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5">
                            <span className={`text-[11px] font-bold w-40 shrink-0 break-words ${field.required ? 'text-emerald-300' : 'text-slate-400'}`}>
                              {field.label}{field.required ? ' *' : ''}
                              {/* The ACTUAL detected mapping, visible as text —
                                  a âœ“ makes "detected by the engine" impossible to
                                  confuse with an empty « — Non mappé — » choice. */}
                              {current !== '' && (
                                <span className="text-emerald-400 font-mono" title={`Â« ${current} Â» â†’ ${field.label}`}> ✓ {current}</span>
                              )}
                            </span>
                            <select
                              value={current}
                              onChange={(e) => handleMappingChange(field.key, e.target.value)}
                              disabled={importStep === 'importing'}
                              className="flex-1 bg-slate-900 text-slate-100 text-[11px] font-mono border border-slate-700 rounded-lg px-1.5 py-1 outline-none cursor-pointer disabled:opacity-60"
                            >
                              <option value="">— Non mappé —</option>
                              {serverMappedOptionRequired && (
                                <option value={current}>{current} (mapping serveur)</option>
                              )}
                              {detectedColumns.map((col: any) => (
                                <option key={col.source} value={col.source}>
                                  {col.source}{col.sample ? ` (ex: ${col.sample})` : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                      <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5">
                        <span className="text-[11px] font-bold text-slate-400 w-40 shrink-0">Source</span>
                        <span className="text-[11px] font-mono text-sky-300">OFFICIAL_DEFAULT (fixe)</span>
                      </div>
                    </div>

                    {/* Detected correspondence — one explicit line per SOURCE
                        column of the file (server `columnAssignments`): the
                        canonical field it feeds, or its role (designation
                        fallback / read-but-unused). Nothing detected is left
                        looking like an unexplained « — Non mappé — ». */}
                    {(importPreview.columnAssignments || []).length > 0 && (
                      <div className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">
                          Correspondances détectées (colonne du fichier → champ)
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          {(importPreview.columnAssignments || []).map((a: any) => {
                            const label = a.role === 'field'
                              ? ((importPreview.fields || []).find((f: any) => f.key === a.key)?.label || a.key)
                              : a.role === 'name_fallback'
                                ? 'Désignation (secours si la colonne principale est vide)'
                                : '— lu, non utilisé (aucun champ canonique) —';
                            return (
                              <span key={a.source} className="text-[10px] font-mono">
                                <span className="text-slate-300">{a.source}</span>
                                <span className="text-slate-500"> → </span>
                                <span className={a.role === 'field' ? 'text-emerald-300' : a.role === 'name_fallback' ? 'text-sky-300' : 'text-slate-500'}>{label}</span>
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* "Métier par défaut" — an OPTION for the rows whose file
                        has no trade column (a grouping such as
                        `department` = 'Building Materials' is never turned into
                        a métier). The import is NOT blocked without it: those
                        rows are imported without a métier and reported for
                        review. Never auto-selected — explicit admin choice only. */}
                    {isDefaultTradeRequired(importPreview) && (
                      <div className="flex flex-wrap items-center gap-2 bg-amber-950/20 border border-amber-500/30 rounded-xl px-2.5 py-2">
                        <span className="text-[11px] font-bold text-amber-300">
                          Métier par défaut — optionnel <span className="text-amber-500/80">(lignes sans colonne de métier : importées sans métier et signalées « à vérifier »)</span>
                        </span>
                        <select
                          value={importDefaultTradeChoice}
                          onChange={(e) => void handleDefaultTradeChoiceChange(e.target.value)}
                          disabled={importStep === 'importing'}
                          className="bg-slate-900 text-amber-100 text-[11px] font-mono border border-amber-700/60 rounded-lg px-1.5 py-1 outline-none cursor-pointer disabled:opacity-60"
                        >
                          <option value="">— Choisir le métier des lignes sans « Categorie » —</option>
                          {knownTradeCategories.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                          <option value={CUSTOM_DEFAULT_TRADE}>Autre (code personnalisé)…</option>
                        </select>
                        {importDefaultTradeChoice === CUSTOM_DEFAULT_TRADE && (
                          <input
                            type="text"
                            value={importDefaultTradeCustom}
                            onChange={(e) => setImportDefaultTradeCustom(e.target.value)}
                            onBlur={() => void handleDefaultTradeCustomCommit()}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleDefaultTradeCustomCommit(); } }}
                            placeholder="ex: hvac"
                            maxLength={50}
                            disabled={importStep === 'importing'}
                            className="bg-slate-900 text-amber-100 text-[11px] font-mono border border-amber-700/60 rounded-lg px-2 py-1 outline-none disabled:opacity-60"
                          />
                        )}
                      </div>
                    )}

                    {/* P1 — persistent block reason: a blocked "Confirmer l'import"
                        NEVER fails silently; the exact server-deterministic
                        reason is displayed until a valid preview replaces it. */}
                    {importBlockReason && (
                      <div className="text-[11px] text-rose-200 bg-rose-950/50 border border-rose-500/40 rounded-xl px-3 py-2">
                        âœ— {importBlockReason}
                      </div>
                    )}

                    {/* Sample normalized rows (first 5) */}
                    <div className="overflow-x-auto border border-slate-800 rounded-xl">
                      <table className="w-full text-left text-[10px]">
                        <thead className="bg-slate-900 text-slate-400">
                          <tr>
                            <th className="px-2 py-1.5">Ligne</th>
                            <th className="px-2 py-1.5">material_code</th>
                            <th className="px-2 py-1.5">material_name</th>
                            <th className="px-2 py-1.5">trade_code</th>
                            <th className="px-2 py-1.5">unit</th>
                            <th className="px-2 py-1.5">price_ht</th>
                            <th className="px-2 py-1.5">currency / market</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {(importPreview.sampleRows || []).map((r: any) => (
                            <tr key={r.row} className="text-slate-200">
                              <td className="px-2 py-1 font-mono">{r.row}</td>
                              <td className="px-2 py-1 font-mono">{r.material_code}</td>
                              <td className="px-2 py-1">{r.material_name}</td>
                              <td className="px-2 py-1 font-mono">{r.trade_code}</td>
                              <td className="px-2 py-1 font-mono">{r.unit}</td>
                              <td className="px-2 py-1 font-mono">{r.price_ht}</td>
                              <td className="px-2 py-1 font-mono">{r.currency}/{r.market}</td>
                            </tr>
                          ))}
                          {(!importPreview.sampleRows || importPreview.sampleRows.length === 0) && (
                            <tr><td className="px-2 py-2 text-slate-500" colSpan={7}>Aucune ligne valide à prévisualiser.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] text-slate-400">
                        ✅ {importPreview.validCount ?? 0} ligne(s) importable(s) · ⚠️ {importPreview.rejectedCount ?? 0} rejetée(s) ·
                        {' '}seules les lignes valides seront écrites (une seule transaction — rien n'est écrit sans confirmation).
                      </p>
                      <button
                        type="button"
                        onClick={handleConfirmImport}
                        disabled={importStep === 'importing'}
                        title="Import transactionnel côté serveur : seules les lignes valides sont écrites (une transaction), les lignes rejetées sont signalées avec leur raison et jamais écrites. Si l'aperçu bloque l'import, la raison exacte s'affiche au-dessus."
                        className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black rounded-xl shadow-lg shadow-emerald-500/20 transition-all cursor-pointer flex items-center gap-1.5 border border-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>{importStep === 'importing' ? 'Import en cours…' : `Importer les lignes valides (${importPreview.validCount ?? 0} lignes)`}</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-col lg:flex-row gap-3 justify-between items-start lg:items-center bg-slate-950 p-4 rounded-2xl border border-slate-800">
                  <div>
                    <h4 className="text-xs font-bold text-white flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                      <span>Éditeur & Importation Catalogue Matériaux BTP 2026</span>
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      Gérez vos tarifs unitaires ou importez un catalogue CSV complet pour mettre à jour les calculateurs en direct.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Step 7 — Multi-Market selector: target Country + Currency
                        for persisted official prices. Driven by the API-first
                        country registry (local COUNTRIES_CONFIG fallback), so a
                        new market added as a DB row needs no schema/code change. */}
                    <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-700 rounded-xl px-2 py-1.5">
                      <MapPin className="w-3.5 h-3.5 text-sky-400" />
                      <select
                        value={selectedCountry}
                        onChange={(e) => {
                          const cCode = e.target.value as CountryCode;
                          setSelectedCountry(cCode);
                          // auto-align currency to the selected country's default
                          const cfg = findCountryConfig(cCode);
                          if (cfg) setSelectedCurrency(cfg.defaultCurrency);
                        }}
                        title="Marché cible (pays)"
                        className="bg-slate-900 text-slate-100 text-xs font-mono border border-slate-700 rounded-lg px-1.5 py-1 outline-none cursor-pointer"
                      >
                        {listCountryOptions().map((cfg) => (
                          <option key={cfg.code} value={cfg.code}>
                            {cfg.flag} {cfg.code} Â· {cfg.nameFr}
                          </option>
                        ))}
                      </select>
                      <select
                        value={selectedCurrency}
                        onChange={(e) => setSelectedCurrency(e.target.value as CurrencyCode)}
                        title="Devise du prix"
                        className="bg-slate-900 text-slate-100 text-xs font-mono border border-slate-700 rounded-lg px-1.5 py-1 outline-none cursor-pointer"
                      >
                        {(findCountryConfig(selectedCountry)?.supportedCurrencies || [selectedCurrency]).map((cur) => (
                          <option key={cur} value={cur}>{cur}</option>
                        ))}
                      </select>
                    </div>

                    {/* CSV Sample Download Template — Phase 1: gated by the
                        catalogue:export entitlement (free today because
                        PHASE1_ALL_FEATURES_FREE=true server-side). */}
                    <FeatureGate feature="catalogue:export">
                      <button
                        type="button"
                        onClick={handleDownloadCsvSample}
                        title="Télécharger un modèle CSV d'exemple pour le catalogue"
                        className="px-3 py-2 bg-slate-900 hover:bg-slate-850 text-slate-300 hover:text-white border border-slate-800 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5 text-sky-400" />
                        <span>Modèle CSV</span>
                      </button>
                    </FeatureGate>

                    {/* Bulk Import Button — Phase C: upload → smart mapping → preview → transactional import (CSV + XLSX) */}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={importStep !== 'idle'}
                      title="Import transactionnel côté serveur : tout-ou-rien, aucune écriture partielle. CSV et Excel (.xlsx) acceptés."
                      className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black rounded-xl shadow-lg shadow-emerald-500/20 transition-all cursor-pointer flex items-center gap-1.5 border border-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <Upload className="w-4 h-4" />
                      <span>{importStep !== 'idle' ? 'Import en cours…' : 'Importer Catalogue (CSV / Excel)'}</span>
                    </button>

                    {/* Manual Add Material Form Toggle */}
                    <button
                      type="button"
                      onClick={() => setShowAddMaterialForm(!showAddMaterialForm)}
                      className={`px-3.5 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 border ${
                        showAddMaterialForm
                          ? 'bg-slate-800 text-amber-400 border-amber-500/40'
                          : 'bg-slate-900 hover:bg-slate-800 text-amber-400 border-slate-700 font-bold'
                      }`}
                    >
                      <Plus className="w-4 h-4" />
                      <span>{showAddMaterialForm ? 'Fermer Formulaire' : 'Ajouter un Matériau'}</span>
                    </button>

                    {/* Save All Rates */}
                    <button
                      type="button"
                      onClick={handleSavePrices}
                      className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-black rounded-xl shadow-lg shadow-amber-500/20 transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>✓ Enregistrer les Barèmes</span>
                    </button>
                  </div>
                </div>

                {/* Step 8 — Pending Price Updates (Admin Review)
                    P2 — rendered from the explicit review view state so a failed
                    load shows the real reason + Â« Actualiser Â» instead of an
                    empty (« Aucune mise à jour ») queue. */}
                {pendingReviewView !== 'hidden' && (
                  <div className="bg-slate-950 p-4 rounded-2xl border border-sky-500/30">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                      <h4 className="text-xs font-bold text-sky-400 flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        <span>Mises à jour de prix en attente d'approbation</span>
                      </h4>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-400 font-mono">{pendingUpdates.length} en attente</span>
                        <button
                          type="button"
                          onClick={() => void loadPendingUpdates()}
                          disabled={pendingLoadState === 'loading'}
                          title="Recharger la file de révision"
                          className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-slate-300 text-[10px] font-bold border border-slate-800 rounded-lg transition-all cursor-pointer flex items-center gap-1"
                        >
                          <RefreshCw className={`w-3 h-3 ${pendingLoadState === 'loading' ? 'animate-spin' : ''}`} />
                          <span>Actualiser</span>
                        </button>
                      </div>
                    </div>

                    {pendingReviewView === 'error' && (
                      <div className="text-[11px] text-rose-300 bg-rose-950/40 border border-rose-500/30 rounded-xl px-3 py-2 mt-3">
                        ✗ {pendingError || 'Impossible de charger les mises à jour de prix en attente.'} — cliquez sur « Actualiser » pour réessayer.
                      </div>
                    )}
                    {pendingReviewView === 'loading' && (
                      <p className="text-[11px] text-slate-400 mt-3">Chargement de la file de révision…</p>
                    )}
                    {pendingReviewView === 'empty' && (
                      <p className="text-[11px] text-slate-500 mt-3">Aucune mise à jour de prix en attente.</p>
                    )}

                    <table className="w-full text-left text-[11px] mt-3">
                      <thead className="bg-slate-900 text-slate-400">
                        <tr>
                          <th className="px-2 py-1.5">Matériau</th>
                          <th className="px-2 py-1.5">Marché</th>
                          <th className="px-2 py-1.5">Prix</th>
                          <th className="px-2 py-1.5">Reçu le</th>
                          <th className="px-2 py-1.5 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingUpdates.map((pu) => (
                          <tr key={pu.id} className="border-b border-slate-800">
                            <td className="px-2 py-1.5 text-slate-200 font-mono">{pu.code || pu.materialId}</td>
                            <td className="px-2 py-1.5 text-slate-300 font-mono">{pu.countryCode} Â· {pu.currency}</td>
                            <td className="px-2 py-1.5 text-emerald-300 font-mono">{Number(pu.price).toFixed(3)}</td>
                            <td className="px-2 py-1.5 text-slate-400 text-[10px]">
                              {new Date(pu.createdAt).toLocaleDateString('fr-FR')}
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <button
                                type="button"
                                onClick={() => handleApprovePending(pu.id)}
                                disabled={isApprovePendingBlocked(approvingIds, pu.id)}
                                className="px-2.5 py-1 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 text-[10px] font-black rounded-lg cursor-pointer"
                              >
                                {isApprovePendingBlocked(approvingIds, pu.id) ? 'Approbation…' : 'Approuver'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Dynamic Material Addition Form */}
                {showAddMaterialForm && (
                  <form onSubmit={handleCreateMaterial} className="bg-slate-950 p-4 sm:p-5 rounded-2xl border border-emerald-500/40 shadow-2xl space-y-4 animate-in fade-in">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                      <h4 className="text-xs font-bold text-emerald-400 flex items-center gap-2">
                        <PlusCircle className="w-4 h-4" />
                        <span>Nouveau Matériau BTP — Inscription Dynamique dans les Calculateurs</span>
                      </h4>
                      <span className="text-[10px] text-slate-400 font-mono">Prise en compte immédiate</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">Nom du Matériau (Français) *</label>
                        <input
                          type="text"
                          value={newMaterial.nameFr}
                          onChange={(e) => setNewMaterial(prev => ({ ...prev, nameFr: e.target.value }))}
                          placeholder="Ex: Plaque BA15 Acoustic Ultra, Profilé Omega 3m..."
                          required
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-emerald-400 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">Nom en Arabe (Optionnel)</label>
                        <input
                          type="text"
                          value={newMaterial.nameAr}
                          onChange={(e) => setNewMaterial(prev => ({ ...prev, nameAr: e.target.value }))}
                          placeholder="Ex: Ø¨Ù„Ø§Ùƒ Ø¨Ø§15 ØµÙˆØªÙŠØ©"
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-serif focus:border-emerald-400 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">Nom en Anglais (Optionnel)</label>
                        <input
                          type="text"
                          value={newMaterial.nameEn}
                          onChange={(e) => setNewMaterial(prev => ({ ...prev, nameEn: e.target.value }))}
                          placeholder="Ex: BA15 Acoustic Board"
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-emerald-400 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">Catégorie BTP *</label>
                        <select
                          value={newMaterial.category}
                          onChange={(e) => setNewMaterial(prev => ({ ...prev, category: e.target.value as TradeCategory }))}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-bold focus:border-emerald-400 focus:outline-none"
                        >
                          <option value="placo">Plaquiste & Placo BA13</option>
                          <option value="peinture">Peinture & Enduits</option>
                          <option value="carrelage">Carrelage & Revêtement</option>
                          <option value="maconnerie">Maçonnerie & Ciment</option>
                          <option value="plomberie">Plomberie & Sanitaires</option>
                          <option value="electricite">Électricité BTP</option>
                          <option value="isolation">Isolation Acoustique / Thermique</option>
                          <option value="facade">Façade & Aquapanel</option>
                          <option value="etancheite">Étanchéité & Silicone</option>
                          <option value="menuiserie">Menuiserie & Fixations</option>
                          <option value="sols">Revêtements de Sols</option>
                          <option value="demolition">Démolition & Évacuation</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">Unité de Mesure *</label>
                        <select
                          value={newMaterial.unit}
                          onChange={(e) => setNewMaterial(prev => ({ ...prev, unit: e.target.value as MaterialRate['unit'] }))}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-bold focus:border-emerald-400 focus:outline-none"
                        >
                          <option value="unit">Unité (unit)</option>
                          <option value="m²">Mètre Carré (m²)</option>
                          <option value="ml">Mètre Linéaire (ml)</option>
                          <option value="m">Mètre (m)</option>
                          <option value="litre">Litre (L)</option>
                          <option value="set">Set / Kit (set)</option>
                          <option value="sac">Sac (25kg/50kg)</option>
                          <option value="boite">Boîte (boite)</option>
                          <option value="boite_1000">Boîte de 1000 (vis)</option>
                          <option value="rouleau">Rouleau</option>
                          <option value="kg">Kilogramme (kg)</option>
                          <option value="panneau">Panneau</option>
                          <option value="tube">Tube</option>
                          <option value="point">Point</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">Prix Unitaire HT (TND) *</label>
                        <input
                          type="number"
                          step="0.5"
                          min="0.1"
                          value={newMaterial.unitPriceTnd}
                          onChange={(e) => setNewMaterial(prev => ({ ...prev, unitPriceTnd: parseFloat(e.target.value) || 0 }))}
                          required
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-amber-400 font-mono font-bold focus:border-emerald-400 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">Note Technique / Spécification</label>
                      <input
                        type="text"
                        value={newMaterial.note}
                        onChange={(e) => setNewMaterial(prev => ({ ...prev, note: e.target.value }))}
                        placeholder="Ex: Conditionnement par carton, conforme aux spécifications CS8..."
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-emerald-400 focus:outline-none"
                      />
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setShowAddMaterialForm(false)}
                        className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-bold rounded-xl transition-all cursor-pointer"
                      >
                        Annuler
                      </button>
                      <button
                        type="submit"
                        className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black rounded-xl shadow-lg shadow-emerald-500/20 transition-all cursor-pointer flex items-center gap-1.5"
                      >
                        <PlusCircle className="w-4 h-4" />
                        <span>Ajouter aux Barèmes & Calculateurs</span>
                      </button>
                    </div>
                  </form>
                )}

                {/* Key Price Metric Input Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {editableRates.find(r => r.id === 'plaque_ba13_standard') && (
                    <div className="bg-slate-950 p-3.5 rounded-2xl border border-amber-500/30 space-y-2">
                      <span className="text-[11px] font-bold text-amber-400 block">Plaque BA13 Standard (DT)</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="0.5"
                          value={editableRates.find(r => r.id === 'plaque_ba13_standard')?.unitPriceTnd || 30}
                          onChange={(e) => handleRatePriceChange('plaque_ba13_standard', parseFloat(e.target.value) || 0)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 font-mono text-sm font-black text-amber-400 text-right focus:border-amber-400 focus:outline-none"
                        />
                        <span className="text-xs text-slate-400 font-mono">DT/unit</span>
                      </div>
                    </div>
                  )}

                  {editableRates.find(r => r.id === 'plaque_ba13_hydrofuge') && (
                    <div className="bg-slate-950 p-3.5 rounded-2xl border border-emerald-500/30 space-y-2">
                      <span className="text-[11px] font-bold text-emerald-400 block">Plaque BA13 Hydrofuge (DT)</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="0.5"
                          value={editableRates.find(r => r.id === 'plaque_ba13_hydrofuge')?.unitPriceTnd || 46}
                          onChange={(e) => handleRatePriceChange('plaque_ba13_hydrofuge', parseFloat(e.target.value) || 0)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 font-mono text-sm font-black text-emerald-400 text-right focus:border-emerald-400 focus:outline-none"
                        />
                        <span className="text-xs text-slate-400 font-mono">DT/unit</span>
                      </div>
                    </div>
                  )}

                  {editableRates.find(r => r.id === 'pose_m2') && (
                    <div className="bg-slate-950 p-3.5 rounded-2xl border border-sky-500/30 space-y-2">
                      <span className="text-[11px] font-bold text-sky-400 block">Main d'Å“uvre Pose mÂ² (DT)</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="0.5"
                          value={editableRates.find(r => r.id === 'pose_m2')?.unitPriceTnd || 18}
                          onChange={(e) => handleRatePriceChange('pose_m2', parseFloat(e.target.value) || 0)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 font-mono text-sm font-black text-sky-400 text-right focus:border-sky-400 focus:outline-none"
                        />
                        <span className="text-xs text-slate-400 font-mono">DT/mÂ²</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* All Materials Table */}
                <div className="max-h-96 overflow-y-auto border border-slate-800 rounded-2xl bg-slate-950">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900 text-slate-400 sticky top-0 border-b border-slate-800 z-10">
                      <tr>
                        <th className="p-3">Réf / Matériau</th>
                        <th className="p-3">Catégorie</th>
                        <th className="p-3">Unité</th>
                        <th className="p-3 text-right">Prix Unitaire HT (TND)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {editableRates.map((rate) => (
                        <tr key={rate.id} className="hover:bg-slate-900/60 transition-colors">
                          <td className="p-3 font-semibold text-white">
                            <div>{rate.nameFr}</div>
                            <div className="text-[10px] text-slate-500 font-mono">{rate.id}</div>
                          </td>
                          <td className="p-3 text-slate-400 uppercase font-mono text-[10px]">{rate.category}</td>
                          <td className="p-3 text-slate-400">{rate.unit}</td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <input
                                type="number"
                                step="0.1"
                                value={rate.unitPriceTnd}
                                onChange={(e) => handleRatePriceChange(rate.id, parseFloat(e.target.value) || 0)}
                                className="w-24 bg-slate-900 border border-amber-500/30 rounded-xl px-2.5 py-1 text-right font-bold text-amber-400 font-mono text-xs focus:border-amber-400 focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => void handleDeleteMaterial(rate)}
                                className="p-1.5 text-slate-500 hover:text-rose-400 bg-slate-900 hover:bg-rose-950/50 border border-slate-800 rounded-lg transition-all cursor-pointer"
                                title="Archiver ce matériau (base de données) et le retirer des barèmes — historique conservé"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 2b: ADMIN → MÉTIERS (single source of truth for Outils + Services) */}
            {activeAdminTab === 'trades' && (
              <AdminTradesPanel
                isAdmin={isCurrentlyAdmin}
                onNotify={(message) => {
                  if (message === null) setNotification(null);
                  else setNotification(message);
                }}
              />
            )}

            {/* TAB 3: QUICK ADD ARTISAN FORM */}
            {activeAdminTab === 'add_artisan' && (
              <form onSubmit={handleCreateArtisan} className="bg-slate-950 p-5 rounded-2xl border border-slate-800 space-y-4">
                <h4 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                  <PlusCircle className="w-4 h-4 text-amber-400" />
                  Formulaire d'enregistrement rapide d'un nouvel artisan
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Nom & Prénom *</label>
                    <input
                      type="text"
                      value={newArtisan.name}
                      onChange={(e) => setNewArtisan(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Ex: Sami Ben Ahmed"
                      required
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-400 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Nom de la Société / Entreprise</label>
                    <input
                      type="text"
                      value={newArtisan.company}
                      onChange={(e) => setNewArtisan(prev => ({ ...prev, company: e.target.value }))}
                      placeholder="Ex: Ben Ahmed Placo Bizerte"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-400 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Spécialité Principale</label>
                    <select
                      value={newArtisan.trade}
                      onChange={(e) => setNewArtisan(prev => ({ ...prev, trade: e.target.value as TradeCategory }))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-bold focus:border-amber-400 focus:outline-none"
                    >
                      <option value="placo">Plaquiste & Faux Plafonds</option>
                      <option value="peinture">Peinture & Enduits</option>
                      <option value="carrelage">Carrelage & Revêtement</option>
                      <option value="electricite">Électricité BTP</option>
                      <option value="plomberie">Plomberie & Sanitaires</option>
                      <option value="facade">Façadier & Aquapanel</option>
                      <option value="isolation">Isolation Acoustique</option>
                      <option value="maconnerie">Maçonnerie Générale</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Gouvernorat (Tunisie)</label>
                    <select
                      value={newArtisan.region}
                      onChange={(e) => setNewArtisan(prev => ({ ...prev, region: e.target.value }))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-bold focus:border-amber-400 focus:outline-none"
                    >
                      {TUNISIAN_GOVERNORATES_LIST.map(g => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Numéro Téléphone *</label>
                    <input
                      type="text"
                      value={newArtisan.phone}
                      onChange={(e) => setNewArtisan(prev => ({ ...prev, phone: e.target.value }))}
                      placeholder="+216 98 123 456"
                      required
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:border-amber-400 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Tarif Pose mÂ² (DT)</label>
                    <input
                      type="number"
                      value={newArtisan.squareMeterRateTnd}
                      onChange={(e) => setNewArtisan(prev => ({ ...prev, squareMeterRateTnd: parseFloat(e.target.value) || 0 }))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:border-amber-400 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Tarif Horaire (DT)</label>
                    <input
                      type="number"
                      value={newArtisan.hourlyRateTnd}
                      onChange={(e) => setNewArtisan(prev => ({ ...prev, hourlyRateTnd: parseFloat(e.target.value) || 0 }))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:border-amber-400 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Abonnement Initial</label>
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="checkbox"
                        id="pro_check_add"
                        checked={newArtisan.isPro2026}
                        onChange={(e) => setNewArtisan(prev => ({ ...prev, isPro2026: e.target.checked }))}
                        className="w-4 h-4 accent-amber-500 cursor-pointer"
                      />
                      <label htmlFor="pro_check_add" className="text-xs text-amber-400 font-bold cursor-pointer">
                        Activer Statut PRO Verified 2026
                      </label>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Présentation / Bio</label>
                  <textarea
                    rows={2}
                    value={newArtisan.bio}
                    onChange={(e) => setNewArtisan(prev => ({ ...prev, bio: e.target.value }))}
                    placeholder="Description des compétences, outillage et références de chantiers..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-xs text-white focus:border-amber-400 focus:outline-none"
                  />
                </div>

                <div className="pt-2 text-right">
                  <button
                    type="submit"
                    className="px-6 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-black rounded-xl shadow-lg shadow-amber-500/20 transition-all cursor-pointer inline-flex items-center gap-2"
                  >
                    <PlusCircle className="w-4 h-4" />
                    <span>Ajouter l'Artisan à l'Annuaire</span>
                  </button>
                </div>
              </form>
            )}

            {/* TAB 4: COMMISSION & FEES CONFIGURATION PANEL */}
            {activeAdminTab === 'commissions' && (
              <div className="space-y-6">
                
                {/* Config Section Header & Controls Form */}
                <form onSubmit={handleSaveCommissions} className="bg-slate-950 p-5 rounded-2xl border border-slate-800 space-y-5">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-800 pb-4">
                    <div>
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <Coins className="w-5 h-5 text-amber-400" />
                        <span>Gestion des Commissions, Frais & Modèle Economique BTP 2026</span>
                      </h4>
                      <p className="text-xs text-slate-400">
                        Configurez les règles de prélèvement sur les devis validés, abonnements artisans et frais de mise en relation.
                      </p>
                    </div>

                    <button
                      type="submit"
                      className="px-5 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-black rounded-xl shadow-lg shadow-amber-500/20 transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>âœ“ Enregistrer la Grille des Commissions</span>
                    </button>
                  </div>

                  {/* Commission Structure Options */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <button
                      type="button"
                      onClick={() => setCommissionType('percent')}
                      className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                        commissionType === 'percent'
                          ? 'bg-amber-500/10 border-amber-400 text-white ring-2 ring-amber-400/20'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold uppercase font-mono">Commission Variable %</span>
                        <Percent className="w-4 h-4 text-amber-400" />
                      </div>
                      <p className="text-xs text-slate-300 font-semibold mb-1">Pourcentage sur Devis</p>
                      <p className="text-[11px] text-slate-400">Prélèvement proportionnel au montant total HT du chantier.</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setCommissionType('flat')}
                      className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                        commissionType === 'flat'
                          ? 'bg-emerald-500/10 border-emerald-400 text-white ring-2 ring-emerald-400/20'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold uppercase font-mono">Frais Fixe par Devis</span>
                        <Receipt className="w-4 h-4 text-emerald-400" />
                      </div>
                      <p className="text-xs text-slate-300 font-semibold mb-1">Forfait par Estimation</p>
                      <p className="text-[11px] text-slate-400">Montant fixe prélevé par devis accepté ou transaction client.</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setCommissionType('hybrid')}
                      className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                        commissionType === 'hybrid'
                          ? 'bg-sky-500/10 border-sky-400 text-white ring-2 ring-sky-400/20'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold uppercase font-mono">Modèle Hybride BTP</span>
                        <Coins className="w-4 h-4 text-sky-400" />
                      </div>
                      <p className="text-xs text-slate-300 font-semibold mb-1">Pourcentage + Forfait Fixe</p>
                      <p className="text-[11px] text-slate-400">Combinaison d'une commission % et de frais fixes de dossier.</p>
                    </button>
                  </div>

                  {/* Detailed Commission Parameter Inputs */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
                    <div className="bg-slate-900 p-3.5 rounded-2xl border border-slate-800 space-y-1.5">
                      <label className="block text-xs font-bold text-amber-400">Taux de Commission (%)</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="25"
                          value={commissionPercent}
                          onChange={(e) => setCommissionPercent(parseFloat(e.target.value) || 0)}
                          className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 font-mono text-sm font-black text-amber-400 focus:border-amber-400 focus:outline-none"
                        />
                        <span className="text-xs font-bold text-slate-400 font-mono">%</span>
                      </div>
                      <span className="text-[10px] text-slate-500 block">Sur montant brut devis</span>
                    </div>

                    <div className="bg-slate-900 p-3.5 rounded-2xl border border-slate-800 space-y-1.5">
                      <label className="block text-xs font-bold text-emerald-400">Frais Fixes par Devis (DT)</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={flatFeePerDevis}
                          onChange={(e) => setFlatFeePerDevis(parseFloat(e.target.value) || 0)}
                          className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 font-mono text-sm font-black text-emerald-400 focus:border-emerald-400 focus:outline-none"
                        />
                        <span className="text-xs font-bold text-slate-400 font-mono">TND</span>
                      </div>
                      <span className="text-[10px] text-slate-500 block">Frais de traitement/Devis</span>
                    </div>

                    <div className="bg-slate-900 p-3.5 rounded-2xl border border-slate-800 space-y-1.5">
                      <label className="block text-xs font-bold text-sky-400">Abonnement Artisan PRO (DT/Mois)</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={proMonthlySubPrice}
                          onChange={(e) => setProMonthlySubPrice(parseFloat(e.target.value) || 0)}
                          className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 font-mono text-sm font-black text-sky-400 focus:border-sky-400 focus:outline-none"
                        />
                        <span className="text-xs font-bold text-slate-400 font-mono">DT/mois</span>
                      </div>
                      <span className="text-[10px] text-slate-500 block">Recette récurrente SaaS</span>
                    </div>

                    <div className="bg-slate-900 p-3.5 rounded-2xl border border-slate-800 space-y-1.5">
                      <label className="block text-xs font-bold text-purple-400">Prélèvement Retenue Source (%)</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          max="15"
                          value={retentionTaxPercent}
                          onChange={(e) => setRetentionTaxPercent(parseFloat(e.target.value) || 0)}
                          className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 font-mono text-sm font-black text-purple-400 focus:border-purple-400 focus:outline-none"
                        />
                        <span className="text-xs font-bold text-slate-400 font-mono">%</span>
                      </div>
                      <span className="text-[10px] text-slate-500 block">Conformité fiscale 2026</span>
                    </div>
                  </div>
                </form>

                {/* Simulation & Revenue Earnings Tracker Dashboard */}
                <div className="bg-slate-950 p-5 rounded-2xl border border-amber-500/30 space-y-4">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-800 pb-3 gap-2">
                    <div>
                      <h4 className="text-xs font-bold text-amber-400 flex items-center gap-2">
                        <Calculator className="w-4 h-4" />
                        <span>Simulateur & Traqueur de Revenus Estimés (Platform Earnings)</span>
                      </h4>
                      <p className="text-[11px] text-slate-400">
                        Estimation des revenus générés en fonction des {totalDevisCount} devis calculés et {proArtisansCount} artisans PRO.
                      </p>
                    </div>
                    <span className="px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/30 text-[10px] font-mono font-bold rounded-lg uppercase">
                      Mode : {commissionType === 'percent' ? 'Variable %' : commissionType === 'flat' ? 'Forfait Fixe' : 'Hybride'}
                    </span>
                  </div>

                  {/* KPI Revenue Simulation Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800 space-y-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Volume Brut Devis</span>
                      <div className="text-xl font-black text-white font-mono">{totalDevisVolumeTnd.toLocaleString('fr-TN')} DT</div>
                      <span className="text-[10px] text-slate-500 block">Volume total chantiers</span>
                    </div>

                    <div className="bg-slate-900/90 p-4 rounded-2xl border border-amber-500/30 space-y-1">
                      <span className="text-[10px] font-bold text-amber-400 uppercase">Commissions Sur Devis Est.</span>
                      <div className="text-xl font-black text-amber-400 font-mono">
                        {Math.round(
                          commissionType === 'percent' ? (totalDevisVolumeTnd * commissionPercent) / 100 :
                          commissionType === 'flat' ? totalDevisCount * flatFeePerDevis :
                          ((totalDevisVolumeTnd * commissionPercent) / 100) + (totalDevisCount * flatFeePerDevis)
                        ).toLocaleString('fr-TN')} DT
                      </div>
                      <span className="text-[10px] text-slate-400 block font-mono">
                        {commissionType === 'percent' ? `${commissionPercent}% du volume` : commissionType === 'flat' ? `${flatFeePerDevis} DT/devis` : `${commissionPercent}% + ${flatFeePerDevis} DT/devis`}
                      </span>
                    </div>

                    <div className="bg-slate-900/90 p-4 rounded-2xl border border-sky-500/30 space-y-1">
                      <span className="text-[10px] font-bold text-sky-400 uppercase">Abonnements PRO Est.</span>
                      <div className="text-xl font-black text-sky-400 font-mono">
                        {(proArtisansCount * proMonthlySubPrice).toLocaleString('fr-TN')} DT
                      </div>
                      <span className="text-[10px] text-slate-400 block">{proArtisansCount} Artisans PRO × {proMonthlySubPrice} DT/mois</span>
                    </div>

                    <div className="bg-gradient-to-br from-emerald-950/80 to-slate-950 p-4 rounded-2xl border border-emerald-500/50 space-y-1 shadow-lg shadow-emerald-500/10">
                      <span className="text-[10px] font-bold text-emerald-400 uppercase">Revenu Global Estimé</span>
                      <div className="text-2xl font-black text-emerald-400 font-mono">
                        {Math.round(
                          (commissionType === 'percent' ? (totalDevisVolumeTnd * commissionPercent) / 100 :
                           commissionType === 'flat' ? totalDevisCount * flatFeePerDevis :
                           ((totalDevisVolumeTnd * commissionPercent) / 100) + (totalDevisCount * flatFeePerDevis)) +
                          (proArtisansCount * proMonthlySubPrice)
                        ).toLocaleString('fr-TN')} DT
                      </div>
                      <span className="text-[10px] text-emerald-300/80 block font-semibold">Total plateforme KONSTRIVO</span>
                    </div>
                  </div>

                  {/* Simulated Per-Devis Revenue Breakdown Table */}
                  <div className="pt-2">
                    <h5 className="text-xs font-bold text-slate-300 mb-2">Simulations Détaillées par Devis du Journal</h5>
                    <div className="max-h-64 overflow-y-auto border border-slate-800 rounded-xl bg-slate-900/60">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-950 text-slate-400 sticky top-0 border-b border-slate-800">
                          <tr>
                            <th className="p-3">Réf / Client</th>
                            <th className="p-3">Projet</th>
                            <th className="p-3">Montant Devis HT</th>
                            <th className="p-3">Calcul Commission (%)</th>
                            <th className="p-3 text-right">Commission Est. (DT)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-850 font-mono">
                          {sampleDevisList.map((d, i) => {
                            const percentFee = (d.totalTnd * commissionPercent) / 100;
                            const flatFee = flatFeePerDevis;
                            const totalFee = 
                              commissionType === 'percent' ? percentFee :
                              commissionType === 'flat' ? flatFee :
                              (percentFee + flatFee);

                            return (
                              <tr key={d.id || i} className="hover:bg-slate-900 transition-colors">
                                <td className="p-3 font-semibold text-white">
                                  <div>{d.clientName}</div>
                                  <div className="text-[10px] text-amber-400">{d.id}</div>
                                </td>
                                <td className="p-3 text-slate-300 font-sans">{d.projectTitle}</td>
                                <td className="p-3 font-bold text-white">{d.totalTnd.toLocaleString('fr-TN')} DT</td>
                                <td className="p-3 text-slate-400 text-[11px]">
                                  {commissionType === 'percent' && `${commissionPercent}% de ${d.totalTnd} DT`}
                                  {commissionType === 'flat' && `${flatFeePerDevis} DT forfait`}
                                  {commissionType === 'hybrid' && `${commissionPercent}% (${Math.round(percentFee)} DT) + ${flatFeePerDevis} DT`}
                                </td>
                                <td className="p-3 text-right font-black text-amber-400">
                                  +{Math.round(totalFee).toLocaleString('fr-TN')} DT
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                </div>

              </div>
            )}

            {/* TAB 5: GESTION DES OFFRES PRO (SaaS) */}
            {activeAdminTab === 'pro_offers' && (
              <div className="space-y-6">
                
                {/* Phase 2 — Admin Usage Analytics (real DB data only) */}
                <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-800 pb-4">
                    <div>
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <BarChart3 className="w-5 h-5 text-amber-400" />
                        <span>Analytique d'Usage — données réelles</span>
                      </h4>
                      <p className="text-xs text-slate-400">
                        Agrégation en lecture seule de <span className="font-mono">user_feature_usage</span> : usage total, utilisateurs uniques, usage du mois. Classement par usage décroissant. P3 : ces compteurs sont ceux réellement appliqués par les limites d'usage.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center rounded-xl border border-slate-800 overflow-hidden">
                        {([
                          { id: 'this_month', label: 'Ce mois' },
                          { id: 'last_month', label: 'Mois dernier' },
                          { id: 'all', label: 'Tout' },
                        ] as Array<{ id: UsageRangePreset; label: string }>).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setUsagePreset(opt.id)}
                            className={`px-2.5 py-2 text-xs font-semibold transition-all cursor-pointer ${
                              usagePreset === opt.id ? 'bg-amber-500 text-slate-950' : 'bg-slate-900 text-slate-400 hover:text-white'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={usageShowTopUsers}
                          onChange={(e) => setUsageShowTopUsers(e.target.checked)}
                          className="accent-amber-500 cursor-pointer"
                        />
                        <span>Top utilisateurs</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => loadUsageStats()}
                        disabled={usageStatsLoading}
                        title="Recharger les statistiques d'usage"
                        className="px-3 py-2 bg-slate-900 hover:bg-slate-850 text-slate-400 hover:text-white border border-slate-800 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${usageStatsLoading ? 'animate-spin' : ''}`} />
                        <span>Actualiser</span>
                      </button>
                    </div>
                  </div>

                  {usageStatsError && (
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-[11px] text-red-300">
                      {usageStatsError}
                    </div>
                  )}

                  {usageStats && (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                          <div className="text-lg font-black text-slate-100">{usageStats.totalUsage}</div>
                          <div className="text-[10px] uppercase tracking-wider text-slate-500">
                            {usageStats.from || usageStats.to
                              ? `Usage sur la période sélectionnée${usageStats.from ? ` (${usageStats.from}` : ''}${usageStats.from && usageStats.to ? ` → ${usageStats.to})` : usageStats.from ? ')' : ''}`
                              : 'Usage total (toutes périodes)'}
                          </div>
                        </div>
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                          <div className="text-lg font-black text-amber-400">
                            {usageStats.features.reduce((sum, f) => sum + f.currentMonthUsage, 0)}
                          </div>
                          <div className="text-[10px] uppercase tracking-wider text-slate-500">Usage ce mois ({usageStats.periodStart})</div>
                        </div>
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                          <div className="text-lg font-black text-emerald-400">{usageStats.features.length}</div>
                          <div className="text-[10px] uppercase tracking-wider text-slate-500">Fonctionnalités trackées</div>
                        </div>
                      </div>

                      {usageStats.features.length === 0 ? (
                        <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-400">
                          Aucune donnée d'usage enregistrée pour le moment — les statistiques apparaissent dès les premières actions réelles (aucune donnée d'exemple n'est affichée).
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[560px] text-[11px]">
                            <thead>
                              <tr className="text-left text-slate-500 uppercase tracking-wider">
                                <th className="py-2 pr-3 font-bold">Fonctionnalité</th>
                                <th className="py-2 pr-3 font-bold">Usage total</th>
                                <th className="py-2 pr-3 font-bold">Utilisateurs uniques</th>
                                <th className="py-2 pr-3 font-bold">Ce mois</th>
                                <th className="py-2 font-bold">Dernière activité</th>
                              </tr>
                            </thead>
                            <tbody>
                              {usageStats.features.map((f) => (
                                <tr key={f.featureKey} className="border-t border-slate-800/70 text-slate-200">
                                  <td className="py-2 pr-3 font-mono text-slate-100">{f.featureKey}</td>
                                  <td className="py-2 pr-3 font-bold text-amber-400">{f.totalUsage}</td>
                                  <td className="py-2 pr-3">{f.uniqueUsers}</td>
                                  <td className="py-2 pr-3">{f.currentMonthUsage}</td>
                                  <td className="py-2 text-slate-400">
                                    {f.lastActivityAt ? new Date(f.lastActivityAt).toLocaleString('fr-FR') : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {usageStats.series.length > 0 && (
                        <div className="overflow-x-auto">
                          <h5 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Série par période</h5>
                          <table className="w-full min-w-[420px] text-[11px]">
                            <thead>
                              <tr className="text-left text-slate-500 uppercase tracking-wider">
                                <th className="py-1.5 pr-3 font-bold">Période</th>
                                <th className="py-1.5 pr-3 font-bold">Usage</th>
                                <th className="py-1.5 font-bold">Utilisateurs actifs</th>
                              </tr>
                            </thead>
                            <tbody>
                              {usageStats.series.map((p) => (
                                <tr key={p.periodStart} className="border-t border-slate-800/70 text-slate-200">
                                  <td className="py-1.5 pr-3 font-mono">{p.periodStart}</td>
                                  <td className="py-1.5 pr-3 font-bold text-amber-400">{p.totalUsage}</td>
                                  <td className="py-1.5">{p.activeUsers}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {usageStats.roleBreakdown.length > 0 && (
                        <div className="overflow-x-auto">
                          <h5 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                            Par rôle (jointure en lecture seule avec users.global_role)
                          </h5>
                          <table className="w-full min-w-[420px] text-[11px]">
                            <thead>
                              <tr className="text-left text-slate-500 uppercase tracking-wider">
                                <th className="py-1.5 pr-3 font-bold">Rôle</th>
                                <th className="py-1.5 pr-3 font-bold">Usage</th>
                                <th className="py-1.5 font-bold">Utilisateurs uniques</th>
                              </tr>
                            </thead>
                            <tbody>
                              {usageStats.roleBreakdown.map((r) => (
                                <tr key={r.role} className="border-t border-slate-800/70 text-slate-200">
                                  <td className="py-1.5 pr-3 font-mono">{r.role}</td>
                                  <td className="py-1.5 pr-3 font-bold text-amber-400">{r.totalUsage}</td>
                                  <td className="py-1.5">{r.uniqueUsers}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {usageShowTopUsers && usageStats.features.some((f) => f.topUsers && f.topUsers.length > 0) && (
                        <div className="overflow-x-auto">
                          <h5 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                            Top utilisateurs (5 premiers par fonctionnalité — visible uniquement dans le panneau Admin)
                          </h5>
                          <table className="w-full min-w-[420px] text-[11px]">
                            <thead>
                              <tr className="text-left text-slate-500 uppercase tracking-wider">
                                <th className="py-1.5 pr-3 font-bold">Fonctionnalité</th>
                                <th className="py-1.5 pr-3 font-bold">Utilisateur</th>
                                <th className="py-1.5 font-bold">Usage</th>
                              </tr>
                            </thead>
                            <tbody>
                              {usageStats.features.flatMap((f) =>
                                (f.topUsers || []).map((t) => (
                                  <tr key={`${f.featureKey}:${t.userId}`} className="border-t border-slate-800/70 text-slate-200">
                                    <td className="py-1.5 pr-3 font-mono">{f.featureKey}</td>
                                    <td className="py-1.5 pr-3 font-mono text-slate-400">{t.userId.slice(0, 8)}…</td>
                                    <td className="py-1.5 font-bold text-amber-400">{t.totalUsage}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Header & Controls Bar */}
                <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-800 pb-4">
                    <div>
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <ListChecks className="w-5 h-5 text-amber-400" />
                        <span>Gestion Dynamique des Offres Plan Pro (SaaS Artisans)</span>
                      </h4>
                      <p className="text-xs text-slate-400">
                        Ajustez les fonctionnalités, avantages et points clés présentés aux artisans sur la carte tarifaire Plan PRO ({proMonthlySubPrice} DT/mois).
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={loadAdminFeatures}
                        disabled={featuresLoadState === 'loading'}
                        title="Recharger les entitlements depuis le serveur"
                        className="px-3 py-2 bg-slate-900 hover:bg-slate-850 text-slate-400 hover:text-white border border-slate-800 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${featuresLoadState === 'loading' ? 'animate-spin' : ''}`} />
                        <span>Recharger depuis le serveur</span>
                      </button>
                    </div>
                  </div>

                  {/* P3 — live FREE/PRO enforcement status (server-driven) */}
                  <div className={`p-3 rounded-xl border text-[11px] leading-relaxed ${featureEnforced ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-300'}`}>
                    <span className="font-bold">{featureEnforced ? 'P3 — contrôle FREE/PRO actif :' : 'Mode « tout gratuit » actif :'}</span>{' '}
                    {featureEnforced ? (
                      <>
                        les réglages ci-dessous sont <span className="font-bold">réellement appliqués</span> par le serveur
                        (<span className="font-mono">feature_entitlements</span> via <span className="font-mono">/api/v1/admin/features</span>) :
                        accès FREE/PRO, rôle (<span className="font-mono">scope</span>) et limites d'usage mensuelles. Statut du compte connecté :{' '}
                        <span className="font-bold">{adminPlanLabel(featurePlan)}</span>.
                      </>
                    ) : (
                      <>
                        le serveur tourne avec le commutateur d'urgence <span className="font-mono">ALL_FEATURES_FREE=1</span> :
                        toutes les fonctionnalités restent gratuites et illimitées, les réglages ci-dessous sont seulement enregistrés.
                      </>
                    )}
                  </div>

                  {/* P3 — Admin plan management (FREE/PRO) on the existing subscription row */}
                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-800 pb-3">
                      <div>
                        <h5 className="text-xs font-bold text-white flex items-center gap-2 uppercase tracking-wider">
                          <KeyRound className="w-4 h-4 text-amber-400" />
                          <span>Plans (FREE / PRO) — gérés côté serveur</span>
                        </h5>
                        <p className="text-[11px] text-slate-400 mt-1">
                          Le plan d'un compte est l'abonnement de son entreprise (même table que le paiement Flouci).
                          Le statut affiché à l'utilisateur et le contrôle d'accès utilisent la même source.
                        </p>
                      </div>
                      <span className={`shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${featureEnforced ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'bg-amber-500/15 text-amber-300 border-amber-500/40'}`}>
                        {enforcementStatusLabel(featureEnforced)}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                      <input
                        type="text"
                        value={planTargetInput}
                        onChange={(e) => setPlanTargetInput(e.target.value)}
                        disabled={planBusy}
                        placeholder="email@exemple.tn Â· user:<id> Â· company:<id>"
                        className="w-full bg-slate-900/60 border border-slate-850 rounded-xl px-3 py-2 text-[11px] text-slate-200 placeholder-slate-500 focus:border-amber-400 focus:outline-none disabled:opacity-50"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={handlePlanCheck}
                          disabled={planBusy}
                          title="Résoudre le plan réel via l'abonnement de l'entreprise"
                          className="px-3 py-2 bg-slate-900 hover:bg-slate-850 text-slate-300 hover:text-white border border-slate-800 rounded-xl text-[11px] font-semibold transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <Search className="w-3.5 h-3.5" />
                          <span>Vérifier</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePlanGrant('pro')}
                          disabled={planBusy}
                          title="Activer PRO (abonnement entreprise mis à jour, tier=PRO)"
                          className="px-3 py-2 bg-amber-400/10 border border-amber-400/40 text-amber-400 rounded-xl text-[11px] font-bold hover:bg-amber-400/20 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          Passer en PRO
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePlanGrant('free')}
                          disabled={planBusy}
                          title="Repasser en FREE (abonnement entreprise conservé, tier=FREE)"
                          className="px-3 py-2 bg-slate-900 border border-slate-800 text-slate-300 rounded-xl text-[11px] font-bold hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                        >
                          Repasser en FREE
                        </button>
                      </div>
                    </div>

                    {planError && (
                      <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-[11px] text-red-300 flex items-start gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>{planError}</span>
                      </div>
                    )}

                    {planView && (
                      <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-[11px] text-slate-300 space-y-1">
                        <div>
                          Plan actuel :{' '}
                          <span className={`font-black ${planView.planCode === 'pro' ? 'text-amber-400' : 'text-slate-200'}`}>
                            {adminPlanLabel(planView.planCode)}
                          </span>
                          {' '}Â· entreprise <span className="font-mono text-slate-400">{planView.companyId}</span>
                          {' '}· abonnement <span className="font-mono text-slate-400">{planView.subscription?.tier ?? '—'}</span>
                          {' / '}<span className="font-mono text-slate-400">{planView.subscription?.status ?? '—'}</span>
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Source : {planView.resolvedFrom === 'user_plan' ? 'getUserPlan (utilisateur → abonnement entreprise)' : 'abonnement entreprise'} — contrôle {planView.enforced ? 'ACTIF' : 'désactivé'}.
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Server load state */}
                  {featuresLoadState === 'loading' && (
                    <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-400 flex items-center gap-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Chargement depuis GET /api/v1/admin/features…</span>
                    </div>
                  )}

                  {/* Server load error (with retry) */}
                  {featuresLoadState === 'error' && (
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-[11px] text-red-300 leading-relaxed">
                      <div className="font-bold flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>Échec du chargement des entitlements</span>
                      </div>
                      <div className="mt-1">{featuresLoadError}</div>
                      <button
                        type="button"
                        onClick={loadAdminFeatures}
                        className="mt-2 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 rounded-lg font-bold cursor-pointer"
                      >
                        Réessayer
                      </button>
                    </div>
                  )}

                  {/* Persist error for the last admin change (clear error state) */}
                  {featureActionError && (
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-[11px] text-red-300 flex items-start justify-between gap-2">
                      <div className="flex items-start gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>{featureActionError}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFeatureActionError(null)}
                        className="text-red-400 hover:text-red-200 font-bold cursor-pointer shrink-0"
                        title="Masquer l'erreur"
                      >
                        âœ•
                      </button>
                    </div>
                  )}
                </div>

                {/* Main Content Layout: Features List (2 cols) & Live Preview Pricing Card (1 col) */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  
                  {/* Left Column: Feature Management List */}
                  <div className="lg:col-span-2 space-y-3">
                    <div className="flex items-center justify-between mb-1">
                      <h5 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                        Entitlements Serveur ({serverFeatures.length})
                      </h5>
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-amber-400 font-mono font-bold">
                          {serverFeatures.filter(f => f.isActive).length} Actives / {serverFeatures.length} Total
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setShowCreateFeatureForm((open) => !open);
                            setFeatureCreateError(null);
                          }}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-400/10 border border-amber-400/40 text-amber-400 text-[11px] font-bold hover:bg-amber-400/20 transition-colors cursor-pointer"
                          title="Créer un nouvel entitlement (persisté côté serveur)"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Ajouter une fonctionnalité</span>
                        </button>
                      </div>
                    </div>

                    {/* Create form — saves through the existing /api/v1/admin/features API.
                        P3: the created row is applied by the backend immediately. */}
                    {showCreateFeatureForm && (
                      <div className="p-4 bg-slate-950 rounded-2xl border border-amber-500/30 space-y-3">
                        <div className="flex items-center justify-between">
                          <h6 className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                            Nouvelle fonctionnalité (persistée côté serveur)
                          </h6>
                          <button
                            type="button"
                            onClick={() => {
                              setShowCreateFeatureForm(false);
                              setFeatureCreateError(null);
                            }}
                            className="text-slate-400 hover:text-white text-xs font-bold cursor-pointer"
                            title="Fermer le formulaire"
                          >
                            âœ•
                          </button>
                        </div>

                        {featureCreateError && (
                          <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-[11px] text-red-300 flex items-start gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span>{featureCreateError}</span>
                          </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                              Clé de fonctionnalité * <span className="text-slate-500 font-normal">(unique, ex : devis:export_excel)</span>
                            </label>
                            <input
                              type="text"
                              value={featureCreateDraft.featureKey}
                              onChange={(e) => setFeatureCreateDraft((d) => ({ ...d, featureKey: e.target.value }))}
                              disabled={featureCreateSaving}
                              placeholder="devis:export_excel"
                              maxLength={100}
                              className="w-full bg-slate-900/60 border border-slate-850 rounded-xl px-3 py-2 text-[11px] text-slate-200 placeholder-slate-500 font-mono focus:border-amber-400 focus:outline-none disabled:opacity-50"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-300 mb-1">Scope *</label>
                            <select
                              value={featureCreateDraft.scope}
                              onChange={(e) => setFeatureCreateDraft((d) => ({ ...d, scope: e.target.value }))}
                              disabled={featureCreateSaving}
                              className="w-full bg-slate-900/60 border border-slate-850 rounded-xl px-3 py-2 text-[11px] text-slate-300 focus:border-amber-400 focus:outline-none disabled:opacity-50 cursor-pointer"
                            >
                              {FEATURE_SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-300 mb-1">Libellé FR <span className="text-slate-500 font-normal">(optionnel)</span></label>
                            <input
                              type="text"
                              value={featureCreateDraft.labelFr}
                              onChange={(e) => setFeatureCreateDraft((d) => ({ ...d, labelFr: e.target.value }))}
                              disabled={featureCreateSaving}
                              maxLength={200}
                              placeholder="Export Excel des devis"
                              className="w-full bg-slate-900/60 border border-slate-850 rounded-xl px-3 py-2 text-[11px] text-slate-200 placeholder-slate-500 focus:border-amber-400 focus:outline-none disabled:opacity-50"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-300 mb-1">Libellé AR <span className="text-slate-500 font-normal">(optionnel)</span></label>
                            <input
                              type="text"
                              dir="rtl"
                              value={featureCreateDraft.labelAr}
                              onChange={(e) => setFeatureCreateDraft((d) => ({ ...d, labelAr: e.target.value }))}
                              disabled={featureCreateSaving}
                              maxLength={200}
                              placeholder="ØªØµØ¯ÙŠØ± Ø¥ÙƒØ³Ù„"
                              className="w-full bg-slate-900/60 border border-slate-850 rounded-xl px-3 py-2 text-[11px] text-slate-200 placeholder-slate-500 focus:border-amber-400 focus:outline-none disabled:opacity-50"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-300 mb-1">Libellé Derja <span className="text-slate-500 font-normal">(optionnel)</span></label>
                            <input
                              type="text"
                              dir="rtl"
                              value={featureCreateDraft.labelDerja}
                              onChange={(e) => setFeatureCreateDraft((d) => ({ ...d, labelDerja: e.target.value }))}
                              disabled={featureCreateSaving}
                              maxLength={200}
                              placeholder="Ø¥ÙƒØ³ÙˆØ± Ø¥ÙƒØ³Ù„"
                              className="w-full bg-slate-900/70 border border-slate-850 rounded-xl px-3 py-2 text-[11px] text-slate-200 placeholder-slate-500 focus:border-amber-400 focus:outline-none disabled:opacity-50"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                          <button
                            type="button"
                            onClick={() => setFeatureCreateDraft((d) => ({ ...d, freeAccess: !d.freeAccess }))}
                            disabled={featureCreateSaving}
                            className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50 ${
                              featureCreateDraft.freeAccess
                                ? 'bg-sky-500/10 border-sky-400 text-sky-400'
                                : 'bg-slate-900/60 border-slate-850 text-slate-400 hover:text-white'
                            }`}
                          >
                            {featureCreateDraft.freeAccess ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                            <span>Accès FREE : {featureCreateDraft.freeAccess ? 'Oui' : 'Non'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setFeatureCreateDraft((d) => ({ ...d, proAccess: !d.proAccess }))}
                            disabled={featureCreateSaving}
                            className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50 ${
                              featureCreateDraft.proAccess
                                ? 'bg-amber-500/10 border-amber-400 text-amber-400'
                                : 'bg-slate-900/60 border-slate-850 text-slate-400 hover:text-white'
                            }`}
                          >
                            {featureCreateDraft.proAccess ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                            <span>Accès PRO : {featureCreateDraft.proAccess ? 'Oui' : 'Non'}</span>
                          </button>
                          <div>
                            <label className="block text-[11px] font-semibold text-slate-300 mb-1">Limite mensuelle <span className="text-slate-500 font-normal">(vide = illimité)</span></label>
                            <input
                              type="number"
                              min={1}
                              value={featureCreateDraft.usageLimit}
                              onChange={(e) => setFeatureCreateDraft((d) => ({ ...d, usageLimit: e.target.value }))}
                              disabled={featureCreateSaving}
                              placeholder="Illimité"
                              className="w-full bg-slate-900/60 border border-slate-850 rounded-xl px-3 py-2 text-[11px] text-slate-300 font-mono focus:border-amber-400 focus:outline-none disabled:opacity-50"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => setFeatureCreateDraft((d) => ({ ...d, isActive: !d.isActive }))}
                            disabled={featureCreateSaving}
                            className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50 ${
                              featureCreateDraft.isActive
                                ? 'bg-emerald-500/10 border-emerald-400 text-emerald-400'
                                : 'bg-slate-900/60 border-slate-850 text-slate-400 hover:text-white'
                            }`}
                            title="Active — persisté côté serveur"
                          >
                            {featureCreateDraft.isActive ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                            <span>Active : {featureCreateDraft.isActive ? 'Oui' : 'Non'}</span>
                          </button>
                        </div>

                        <div className="flex items-center justify-between gap-3 pt-1">
                          <span className="text-[10px] text-slate-500">
                            Enregistré dans <code className="text-slate-400 font-mono">feature_entitlements</code> via <code className="text-slate-400 font-mono">/api/v1/admin/features</code> — P3 : appliqué immédiatement par le serveur (accès FREE/PRO, rôle, limite d'usage).
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleCreateFeature()}
                            disabled={featureCreateSaving}
                            className="flex items-center gap-1.5 px-4 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 text-[11px] font-black rounded-xl shadow-lg shadow-amber-500/20 transition-all cursor-pointer disabled:opacity-50 shrink-0"
                          >
                            {featureCreateSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                            <span>{featureCreateSaving ? 'Création…' : 'Créer la fonctionnalité'}</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Phase 3 — control-center overview strip (pure client-side counters) */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-[10px] font-bold">
                      {[
                        { label: 'Total', value: featureSummary.total, cls: 'text-slate-300' },
                        { label: 'Actives', value: featureSummary.active, cls: 'text-emerald-400' },
                        { label: 'Accès FREE', value: featureSummary.freeAccess, cls: 'text-sky-400' },
                        { label: 'PRO uniquement', value: featureSummary.proOnly, cls: 'text-amber-400' },
                        { label: 'Avec limite', value: featureSummary.limited, cls: 'text-rose-400' },
                      ].map((s) => (
                        <div key={s.label} className="p-2 rounded-xl bg-slate-950 border border-slate-850 text-center">
                          <div className={`text-sm font-black font-mono ${s.cls}`}>{s.value}</div>
                          <div className="text-slate-500 uppercase tracking-wider">{s.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Phase 3 — search + display ordering (view-only: the backend
                        model has no ordering column, so this is never persisted) */}
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={featureSearch}
                        onChange={(e) => setFeatureSearch(e.target.value)}
                        placeholder="Rechercher une fonctionnalité…"
                        title="Filtre client (clé, libellés ou scope) — ne modifie pas le serveur"
                        className="flex-1 min-w-[180px] bg-slate-900/60 border border-slate-850 rounded-xl px-3 py-2 text-[11px] text-slate-200 placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                      />
                      <select
                        value={featureSearchField}
                        onChange={(e) => setFeatureSearchField(e.target.value as FeatureFilterField)}
                        title="Champ de filtrage"
                        className="bg-slate-900/60 border border-slate-850 rounded-xl px-2.5 py-2 text-[11px] text-slate-300 focus:border-amber-400 focus:outline-none cursor-pointer"
                      >
                        <option value="all">Tout</option>
                        <option value="key">Clé</option>
                        <option value="label">Libellé</option>
                        <option value="scope">Scope</option>
                      </select>
                      <select
                        value={featureSortMode}
                        onChange={(e) => setFeatureSortMode(e.target.value as FeatureSortMode)}
                        title="Ordre d'affichage (non persisté — le modèle serveur n'a pas de colonne d'ordre)"
                        className="bg-slate-900/60 border border-slate-850 rounded-xl px-2.5 py-2 text-[11px] text-slate-300 focus:border-amber-400 focus:outline-none cursor-pointer"
                      >
                        {FEATURE_SORT_MODES.map((m) => (
                          <option key={m} value={m}>
                            {m === 'key' ? 'Tri : clé' : m === 'label' ? 'Tri : libellé' : m === 'scope' ? 'Tri : scope' : 'Tri : statut'}
                          </option>
                        ))}
                      </select>
                    </div>

                    {featuresLoadState === 'loaded' && serverFeatures.length === 0 && (
                      <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-400">
                        Aucun entitlement retourné par GET /api/v1/admin/features.
                      </div>
                    )}

                    {featuresLoadState === 'loaded' && serverFeatures.length > 0 && visibleFeatures.length === 0 && (
                      <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-400">
                        Aucune fonctionnalité ne correspond à la recherche « {featureSearch} ».
                      </div>
                     )}

                    <div className="space-y-3">
                      {visibleFeatures.map((ent) => {
                        const saving = !!savingKeys[ent.featureKey];
                        return (
                        <div
                          key={ent.featureKey}
                          className={`p-4 rounded-2xl border transition-all space-y-3 ${
                            ent.isActive
                              ? 'bg-slate-950 border-slate-800 hover:border-amber-500/40'
                              : 'bg-slate-950/50 border-slate-900 opacity-60'
                          }`}
                        >
                          {/* Top Row: isActive Toggle & Label Input & Scope Tag & Deactivate */}
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              {/* isActive toggle — persisted via POST /admin/features */}
                              <button
                                type="button"
                                onClick={() => toggleFeatureFlag(ent, 'isActive')}
                                disabled={saving}
                                title={ent.isActive ? 'Désactiver côté serveur (isActive=false)' : 'Réactiver côté serveur (isActive=true)'}
                                className={`p-2 rounded-lg border transition-colors cursor-pointer flex-shrink-0 disabled:opacity-50 ${
                                  ent.isActive
                                    ? 'bg-amber-400/10 border-amber-400 text-amber-400'
                                    : 'bg-slate-900 border-slate-800 text-slate-600'
                                }`}
                              >
                                {ent.isActive ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                              </button>

                              <div className="flex-1 min-w-0">
                                <div className="text-[10px] font-mono font-bold text-amber-400/80 truncate">{ent.featureKey}</div>
                                <input
                                  type="text"
                                  key={`${ent.featureKey}:${ent.labelFr ?? ''}`}
                                  defaultValue={ent.labelFr ?? ''}
                                  onBlur={(e) => commitLabelFr(ent, e.target.value)}
                                  disabled={saving}
                                  placeholder="Libellé (FR)"
                                  className="w-full bg-transparent text-xs font-bold text-white border-b border-transparent hover:border-slate-700 focus:border-amber-400 focus:outline-none py-0.5"
                                />
                                {/* Phase 3 — the model's other label columns (labelAr / labelDerja) */}
                                <input
                                  type="text"
                                  key={`${ent.featureKey}:labelAr:${ent.labelAr ?? ''}`}
                                  defaultValue={ent.labelAr ?? ''}
                                  onBlur={(e) => commitLabel(ent, 'labelAr', e.target.value)}
                                  disabled={saving}
                                  placeholder="Libellé (AR) — عربي"
                                  title="Colonne label_ar (varchar 200) — persisté côté serveur"
                                  className="w-full bg-transparent text-[11px] text-slate-300 border-b border-transparent hover:border-slate-700 focus:border-amber-400 focus:outline-none py-0.5"
                                />
                                <input
                                  type="text"
                                  key={`${ent.featureKey}:labelDerja:${ent.labelDerja ?? ''}`}
                                  defaultValue={ent.labelDerja ?? ''}
                                  onBlur={(e) => commitLabel(ent, 'labelDerja', e.target.value)}
                                  disabled={saving}
                                  placeholder="Libellé (Derja) — دارجة"
                                  title="Colonne label_derja (varchar 200) — persisté côté serveur"
                                  dir="rtl"
                                  className="w-full bg-transparent text-[11px] text-slate-400 border-b border-transparent hover:border-slate-700 focus:border-amber-400 focus:outline-none py-0.5"
                                />
                              </div>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase font-mono border bg-emerald-500/10 border-emerald-500/30 text-emerald-400">
                                {ent.scope}
                              </span>

                              {saving && <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />}

                              <button
                                type="button"
                                onClick={() => handleDeactivateFeature(ent)}
                                disabled={saving}
                                className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-slate-900 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                                title="Désactiver côté serveur (soft-delete)"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          {/* Server-persisted settings: plan access, scope, monthly limit */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => toggleFeatureFlag(ent, 'freeAccess')}
                              disabled={saving}
                              title="Accès FREE — persisté côté serveur (sans effet tant que PHASE1_ALL_FEATURES_FREE=true)"
                              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50 ${
                                ent.freeAccess
                                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                  : 'bg-slate-900 border-slate-800 text-slate-500'
                              }`}
                            >
                              {ent.freeAccess ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                              <span>Accès FREE : {ent.freeAccess ? 'Oui' : 'Non'}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => toggleFeatureFlag(ent, 'proAccess')}
                              disabled={saving}
                              title="Accès PRO — persisté côté serveur"
                              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50 ${
                                ent.proAccess
                                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                                  : 'bg-slate-900 border-slate-800 text-slate-500'
                              }`}
                            >
                              {ent.proAccess ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                              <span>Accès PRO : {ent.proAccess ? 'Oui' : 'Non'}</span>
                            </button>

                            <select
                              value={ent.scope}
                              onChange={(e) => void patchFeatureOnServer(ent, { scope: e.target.value }, `✓ Scope de "${ent.featureKey}" enregistré côté serveur (${e.target.value}).`)}
                              disabled={saving}
                              title="Scope rôle — persisté côté serveur"
                              className="bg-slate-900/60 border border-slate-850 rounded-xl px-2.5 py-2 text-[11px] text-slate-300 focus:border-amber-400 focus:outline-none disabled:opacity-50 cursor-pointer"
                            >
                              {FEATURE_SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>

                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min={1}
                                value={usageLimitDrafts[ent.featureKey] ?? (ent.usageLimit == null ? '' : String(ent.usageLimit))}
                                onChange={(e) => setUsageLimitDrafts(prev => ({ ...prev, [ent.featureKey]: e.target.value }))}
                                onBlur={() => commitUsageLimit(ent)}
                                disabled={saving}
                                placeholder="Illimité"
                                title="Limite mensuelle — persistée côté serveur (vide = illimité)"
                                className="w-20 bg-slate-900/60 border border-slate-850 rounded-xl px-2.5 py-2 text-[11px] text-slate-300 font-mono focus:border-amber-400 focus:outline-none disabled:opacity-50"
                              />
                              <span className="text-[10px] text-slate-500 leading-tight">/mois — vide = illimité (inactif en Phase 1)</span>
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right Column: Live Interactive Preview of Plan Pro Card */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between mb-1">
                      <h5 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Eye className="w-4 h-4" />
                        <span>Aperçu Carte Plan Pro Artisan</span>
                      </h5>
                      <span className="text-[10px] text-slate-400">Rendu Temps Réel</span>
                    </div>

                    <div className="bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950 border-2 border-amber-400/80 rounded-3xl p-6 space-y-6 shadow-2xl shadow-amber-500/10 relative overflow-hidden">
                      {/* Top Ribbon */}
                      <div className="absolute top-3 right-3 px-3 py-1 bg-amber-400 text-slate-950 text-[10px] font-black uppercase rounded-full tracking-wider flex items-center gap-1">
                        <Star className="w-3 h-3 fill-slate-950" />
                        <span>Offre Recommandée</span>
                      </div>

                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Award className="w-5 h-5 text-amber-400" />
                          <h3 className="text-lg font-black text-white">Abonnement PLAN PRO 2026</h3>
                        </div>
                        <p className="text-xs text-slate-400">
                          Solution intégrée pour artisans, entrepreneurs et chefs de chantier en Tunisie.
                        </p>
                      </div>

                      {/* Pricing Tag */}
                      <div className="bg-slate-950 p-4 rounded-2xl border border-amber-500/30 flex items-baseline justify-between">
                        <div>
                          <span className="text-3xl font-black text-amber-400 font-mono">{proMonthlySubPrice}</span>
                          <span className="text-xs font-bold text-slate-300 font-mono ml-1">DT / mois HT</span>
                        </div>
                        <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-500/20">
                          Sans engagement
                        </span>
                      </div>

                      {/* Dynamic Bullet Points List — sourced from /api/v1/admin/features */}
                      <div className="space-y-3 border-t border-slate-800 pt-4">
                        <h4 className="text-xs font-bold text-slate-300">Avantages Inclus dans l'Abonnement (source serveur) :</h4>
                        <ul className="space-y-2.5 text-xs">
                          {serverFeatures.map((ent) => (
                            <li key={ent.featureKey} className={`flex items-start gap-2.5 ${ent.isActive ? 'text-slate-200' : 'text-slate-600 line-through'}`}>
                              <Check className={`w-4 h-4 flex-shrink-0 mt-0.5 ${ent.isActive ? 'text-emerald-400 font-bold' : 'text-slate-700'}`} />
                              <div>
                                <span className="font-bold block text-white">{ent.labelFr || ent.featureKey}</span>
                                <span className="text-[11px] text-slate-400 block font-normal leading-tight">
                                  {ent.featureKey} · {ent.scope} · {ent.usageLimit == null ? 'illimité' : `${ent.usageLimit}/mois`}
                                </span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <button
                        type="button"
                        className="w-full py-3 bg-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-amber-500/20 uppercase tracking-wider"
                      >
                        Souscrire au Plan Pro ({proMonthlySubPrice} DT)
                      </button>
                    </div>
                  </div>

                </div>

              </div>
            )}

            {/* TAB 7: GLOBAL CATALOG */}
            {activeAdminTab === 'global_catalog' && (
              <GlobalCatalogAdminPanel />
            )}
            {/* TAB 6: STATISTIQUES & DEVIS DETAILED VIEW */}
            {activeAdminTab === 'stats' && (
              <div className="space-y-4">
                
                {/* Stats Summary Panel */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Volume Financier Total</span>
                    <div className="text-2xl font-black text-amber-400 font-mono">
                      {totalDevisVolumeTnd.toLocaleString('fr-TN')} DT
                    </div>
                    <span className="text-[11px] text-slate-400 block">Calculé sur la plateforme</span>
                  </div>

                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Moyenne Devis Chantiers</span>
                    <div className="text-2xl font-black text-emerald-400 font-mono">
                      {avgDevisTnd.toLocaleString('fr-TN')} DT
                    </div>
                    <span className="text-[11px] text-slate-400 block">Par estimation client/artisan</span>
                  </div>

                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-1">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Chantiers & Surfaces</span>
                    <div className="text-2xl font-black text-sky-400 font-mono">
                      {totalDevisCount * 120} mÂ²
                    </div>
                    <span className="text-[11px] text-slate-400 block">Superficie cumulée calculée</span>
                  </div>
                </div>

                {/* Devis History Log Table */}
                <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-white flex items-center gap-2">
                        <FileText className="w-4 h-4 text-amber-400" />
                        <span>Journal Récent des Devis / Estimations Générées</span>
                      </h4>
                      <p className="text-[11px] text-slate-400">Historique des devis créés par les clients et artisans</p>
                    </div>
                    <span className="px-2.5 py-1 text-[10px] font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-lg">
                      {sampleDevisList.length} devis enregistrés
                    </span>
                  </div>

                    <div className="max-h-80 overflow-y-auto overflow-x-auto border border-slate-850 rounded-xl">
                      <table className="w-full min-w-[560px] text-left text-xs">
                      <thead className="bg-slate-900 text-slate-400 sticky top-0 border-b border-slate-800">
                        <tr>
                          <th className="p-3">Réf / Client</th>
                          <th className="p-3">Projet & Ouvrage</th>
                          <th className="p-3">Surface (mÂ²)</th>
                          <th className="p-3 font-mono">Total (TND)</th>
                          <th className="p-3">Date</th>
                          <th className="p-3 text-right">Statut</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-850">
                        {sampleDevisList.map((devis, index) => (
                          <tr key={devis.id || index} className="hover:bg-slate-900/60 transition-colors">
                            <td className="p-3 font-semibold text-white">
                              <div className="font-bold">{devis.clientName || 'Client Particulier'}</div>
                              <div className="text-[10px] font-mono text-amber-400">{devis.id || `DEV-2026-${index + 100}`}</div>
                            </td>
                            <td className="p-3 text-slate-300 font-medium">
                              {devis.projectTitle}
                            </td>
                            <td className="p-3 font-mono text-slate-300">
                              {devis.surfaceArea} mÂ²
                            </td>
                            <td className="p-3 font-mono font-bold text-amber-400">
                              {devis.totalTnd.toLocaleString('fr-TN')} DT
                            </td>
                            <td className="p-3 text-slate-400 font-mono text-[11px]">
                              {devis.date || '2026-08-20'}
                            </td>
                            <td className="p-3 text-right">
                              <span className="px-2.5 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full inline-flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" /> Validé
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            )}

          </div>
        )}

        {/* Modal Footer */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-amber-400" />
            <span>Panneau Propriétaire KONSTRIVO Technologies 2026</span>
          </div>

          <div className="flex items-center gap-2">
            {isCurrentlyAdmin && (
              <button
                type="button"
                onClick={handleAdminLogout}
                className="px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-500/40 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Déconnexion Admin</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-bold rounded-xl transition-all cursor-pointer"
            >
              Fermer le Panneau
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};







