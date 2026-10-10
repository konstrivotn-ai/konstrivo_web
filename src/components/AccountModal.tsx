import React, { FC, useEffect, useState } from 'react';
import { X, User, Mail, Phone, MapPin, Shield, Lock, Check, Sparkles, LogOut, RefreshCw, AlertTriangle, Clock } from 'lucide-react';
import { Language, UserProfile } from '../types';
import { useFeatures, COMING_SOON_FEATURE_KEYS, CLIENT_ONLY_FEATURE_KEYS } from '../hooks/useFeatures';
import { requestProCheckout } from '../lib/api';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile | null;
  onLogout: () => void;
  lang: Language;
}

const FEATURE_LABELS: Record<string, Record<Language, string>> = {
  'devis:create': { fr: 'Créer des devis', ar: 'إنشاء عروض الأسعار', en: 'Create quotes' },
  'devis:export_pdf': { fr: 'Exporter en PDF', ar: 'تصدير PDF', en: 'Export to PDF' },
  'projects:save': { fr: 'Sauvegarder des projets', ar: 'حفظ المشاريع', en: 'Save projects' },
  'projects:premium_formulas': { fr: 'Formules premium', ar: 'معادلات بريميوم', en: 'Premium formulas' },
  'supplier:products': { fr: 'Produits fournisseur', ar: 'منتجات المزود', en: 'Supplier products' },
  'supplier:bulk_update': { fr: 'Mise à jour en masse', ar: 'تحديث بالجملة', en: 'Bulk update' },
  'engineer:advanced_calc': { fr: 'Calculs avancés', ar: 'حسابات متقدمة', en: 'Advanced calculations' },
  'engineer:multi_project': { fr: 'Multi-projets', ar: 'مشاريع متعددة', en: 'Multi-project' },
  'catalogue:browse': { fr: 'Parcourir le catalogue', ar: 'تصفح الكتالوج', en: 'Browse the catalogue' },
  'catalogue:export': { fr: 'Exporter le catalogue', ar: 'تصدير الكتالوج', en: 'Export the catalogue' },
  'analytics:view': { fr: 'Voir les analyses', ar: 'عرض التحليلات', en: 'View analytics' }
};

const DEFAULT_LABEL: Record<Language, string> = { fr: 'Fonctionnalité', ar: 'ميزة', en: 'Feature' };

function getFeatureLabel(featureKey: string, lang: Language): string {
  return FEATURE_LABELS[featureKey]?.[lang] ?? `${DEFAULT_LABEL[lang]} · ${featureKey}`;
}

export const AccountModal: FC<AccountModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onLogout,
  lang
}) => {
  // Backend Feature Entitlements are the ONLY source of truth for the plan and
  // its features (GET /api/v1/features). We enable the fetch ONLY while the
  // modal is open and refresh on every open so the view never drifts from the
  // server (previously it fetched once at app mount, modal closed or not).
  // P3: `planCode` and `enforced` come from that same endpoint, which resolves
  // both through the resolvers access control uses — the badge below can never
  // show a different FREE/PRO than the backend enforces.
  const { planCode, features, loading, refresh, remaining, enforced } = useFeatures({ enabled: isOpen });

  // Real PRO checkout flow (Phase E contract): POST /api/v1/payments/checkout
  // → redirect to the returned provider-hosted checkoutUrl. PRO is granted
  // ONLY by the backend after payment verification — never from this client.
  const [checkoutState, setCheckoutState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setCheckoutState('idle');
      setCheckoutError(null);
      refresh();
    }
  }, [isOpen, refresh]);

  const handleUpgrade = async (): Promise<void> => {
    setCheckoutState('loading');
    setCheckoutError(null);
    try {
      const res = await requestProCheckout();
      window.location.href = res.checkoutUrl;
    } catch (e: any) {
      setCheckoutState('error');
      setCheckoutError(e?.message || 'Payment is temporarily unavailable');
    }
  };

  if (!isOpen) return null;

  const isPro = planCode === 'pro';
  // ── F9 — honest feature counts: keys with no implementing code ("Bientôt")
  // are neither available now nor sellable with PRO, so they are excluded from
  // the X/Y counter and rendered in their own group below.
  const implementedFeatures = features.filter((f) => !COMING_SOON_FEATURE_KEYS.has(f.featureKey));
  const comingSoonFeatures = features.filter((f) => COMING_SOON_FEATURE_KEYS.has(f.featureKey));
  const totalFeatures = implementedFeatures.length;
  const availableFeatures = implementedFeatures.filter((f) => f.canAccess).length;

  const t = {
    title: lang === 'ar' ? 'حسابي' : lang === 'en' ? 'My Account' : 'Mon Compte',
    plan: lang === 'ar' ? 'الخطة' : 'Plan',
    planFree: lang === 'ar' ? 'مجاني' : lang === 'en' ? 'FREE' : 'GRATUIT',
    planPro: lang === 'ar' ? 'احترافي' : 'PRO',
    features: lang === 'ar' ? 'الميزات' : lang === 'en' ? 'Features' : 'Fonctionnalités',
    proOnly: lang === 'ar' ? 'PRO uniquement' : lang === 'en' ? 'PRO only' : 'PRO uniquement',
    remaining: lang === 'ar' ? 'متبقي' : lang === 'en' ? 'remaining' : 'restant',
    // F15 — honest lock reasons (mapped from the server access `reason`).
    scopeMismatch: lang === 'ar' ? 'الدور غير مصرح به' : lang === 'en' ? 'Role not authorized' : 'Rôle non autorisé',
    usageExhausted: lang === 'ar' ? 'تم بلوغ الحد الشهري' : lang === 'en' ? 'Monthly limit reached' : 'Limite mensuelle atteinte',
    featureDisabled: lang === 'ar' ? 'هذه الميزة معطلة' : lang === 'en' ? 'Feature disabled' : 'Fonctionnalité désactivée',
    planDenied: lang === 'ar' ? 'متاحة لخطة FREE فقط' : lang === 'en' ? 'FREE plan only' : 'Réservé au plan FREE',
    upgrade: lang === 'ar' ? 'الترقية إلى PRO' : lang === 'en' ? 'Upgrade to PRO' : 'Passer à PRO',
    upgradeSoon: lang === 'ar' ? 'قريباً — تواصل معنا للترقية' : lang === 'en' ? 'Coming soon — contact us to upgrade to PRO' : 'Bientôt disponible — contactez-nous pour passer à PRO',
    // F9 — honest presentation labels (see COMING_SOON / CLIENT_ONLY key sets).
    comingSoon: lang === 'ar' ? 'قريباً' : lang === 'en' ? 'Coming soon' : 'Bientôt',
    uiOnly: lang === 'ar' ? 'إجراء في الواجهة — يعمل داخل المتصفح دون نقطة نهاية خادم'
      : lang === 'en'
        ? 'UI action — runs in your browser, no server endpoint'
        : 'Action d\'interface — exécutée dans le navigateur, sans endpoint serveur',
    proActive: lang === 'ar' ? 'نشط' : lang === 'en' ? 'active' : 'actif',
    profile: lang === 'ar' ? 'الملف الشخصي' : lang === 'en' ? 'Profile' : 'Profil',
    logout: lang === 'ar' ? 'تسجيل الخروج' : lang === 'en' ? 'Sign out' : 'Se déconnecter',
    loading: lang === 'ar' ? 'جاري التحميل...' : lang === 'en' ? 'Loading...' : 'Chargement...',
    unavailable: lang === 'ar' ? 'غير متاح' : lang === 'en' ? 'Not available' : 'Non disponible',
    // Website redesign additions
    availableNow: lang === 'ar' ? 'متاحة الآن' : lang === 'en' ? 'Available now' : 'Disponibles',
    withPro: lang === 'ar' ? 'متاحة مع PRO' : lang === 'en' ? 'Available with PRO' : 'Avec PRO',
    secureNote: lang === 'ar'
      ? 'دفع آمن عبر Flouci — يتم تفعيل PRO تلقائيًا بعد تحقق الخادم من الدفع.'
      : lang === 'en'
        ? 'Secure payment via Flouci — PRO is activated once the server verifies the payment.'
        : 'Paiement sécurisé via Flouci — le passage PRO est effectif après vérification serveur du paiement.',
    errorTitle: lang === 'ar' ? 'تعذّر بدء الدفع' : lang === 'en' ? 'Unable to start the payment' : 'Impossible de démarrer le paiement',
    retry: lang === 'ar' ? 'إعادة المحاولة' : lang === 'en' ? 'Retry' : 'Réessayer',
    starting: lang === 'ar' ? 'جاري التحويل...' : lang === 'en' ? 'Redirecting...' : 'Redirection...',
    featuresAvail: lang === 'ar' ? 'ميزة متاحة' : lang === 'en' ? 'features available' : 'fonctions disponibles',
    planLabel: lang === 'ar' ? 'خطتك الحالية' : lang === 'en' ? 'Your plan' : 'Votre plan',
    // P3 — plan provenance (same server source as access control).
    planSource: lang === 'ar'
      ? 'الخطة مُحددة من الخادم (اشتراك الشركة) — نفس المصدر المستخدم للتحقق من الوصول.'
      : lang === 'en'
        ? 'Plan resolved server-side (company subscription) — the same source used for access control.'
        : 'Plan résolu côté serveur (abonnement entreprise) — la même source que le contrôle d\'accès.',
    planFreeMode: lang === 'ar'
      ? 'الخادم في وضع «كل شيء مجاني» — لا قيود حالياً.'
      : lang === 'en'
        ? 'Server runs in "all features free" mode — no gating right now.'
        : 'Serveur en mode « tout gratuit » — aucun contrôle d\'accès actif.'
  };

  const sortedFeatures = [...implementedFeatures].sort((a, b) => {
    if (a.canAccess === b.canAccess) return 0;
    return a.canAccess ? -1 : 1;
  });

  // Visual grouping only — same server data, same order, now split three ways
  // (F9): available now / with PRO / Bientôt (no implementation yet).
  const unlockedFeatures = sortedFeatures.filter((f) => f.canAccess);
  const lockedFeatures = sortedFeatures.filter((f) => !f.canAccess);

  // F9 — one tile for a key with NO implementing code: neutral "Bientôt" state
  // (never green = available, never amber = sellable with PRO).
  const renderComingSoonTile = (f: (typeof features)[number]) => (
    <div
      key={f.featureKey}
      className="flex items-start gap-3 p-3 rounded-lg border bg-slate-950/30 border-slate-800/60"
    >
      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-slate-800/50">
        <Clock className="w-3.5 h-3.5 text-slate-500" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[13px] font-medium leading-snug block text-slate-400">{getFeatureLabel(f.featureKey, lang)}</span>
        <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide mt-0.5 block">{t.comingSoon}</span>
      </div>
    </div>
  );

  // Presentational helper (no state, no API): renders ONE feature tile so the
  // "Disponibles" and "Avec PRO" groups look identical.
  const renderFeatureTile = (f: (typeof features)[number]) => {
    const isLocked = !f.canAccess;
    const hasLimit = f.usageLimit !== null && f.usageLimit > 0;
    const rem = remaining(f.featureKey);
    const label = getFeatureLabel(f.featureKey, lang);
    // F15 — honest lock reason: show the SERVER's access `reason`
    // (GET /api/v1/features → mapAccess) instead of always claiming
    // "PRO uniquement". Display only — entitlement enforcement, FREE/PRO
    // rules and FeatureGate are untouched. `unmanaged`/available rows are
    // never locked (canAccess=true) so they keep the existing available
    // behaviour; a missing/unknown reason falls back to the previous
    // PRO-only label (backward compatible).
    let lockText: string | null = null;
    if (isLocked) {
      switch (f.reason) {
        case 'SCOPE_MISMATCH':
          lockText = t.scopeMismatch;
          break;
        case 'USAGE_EXHAUSTED':
          lockText = f.usageRemaining == null
            ? t.usageExhausted
            : `${t.usageExhausted} · ${t.remaining}: ${f.usageRemaining}`;
          break;
        case 'FEATURE_DISABLED':
          lockText = t.featureDisabled;
          break;
        case 'PLAN_DENIED':
          lockText = t.planDenied;
          break;
        default:
          // PRO_REQUIRED, legacy rows without a reason, unknown codes.
          lockText = t.proOnly;
      }
    }
    return (
      <div
        key={f.featureKey}
        className={`flex items-start gap-3 p-3 rounded-lg border ${
          isLocked ? 'bg-slate-950/40 border-slate-800/70' : 'bg-emerald-500/[0.04] border-emerald-500/20'
        }`}
      >
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isLocked ? 'bg-slate-800/70' : 'bg-emerald-500/15'}`}>
          {isLocked ? <Lock className="w-3.5 h-3.5 text-slate-500" /> : <Check className="w-3.5 h-3.5 text-emerald-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <span className={`text-[13px] font-medium leading-snug block ${isLocked ? 'text-slate-400' : 'text-white'}`}>{label}</span>
          {isLocked && <span className="text-[10px] text-amber-400/90 font-semibold uppercase tracking-wide mt-0.5 block">{lockText}</span>}
          {/* F9 — client-only actions run in the browser (no server endpoint): say so. */}
          {CLIENT_ONLY_FEATURE_KEYS.has(f.featureKey) && (
            <span className="text-[10px] text-slate-500 mt-0.5 block">{t.uiOnly}</span>
          )}
          {!isLocked && hasLimit && rem !== null && (
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              {t.remaining}: {rem}
              {f.usageCount != null && f.usageLimit != null ? ` · ${f.usageCount}/${f.usageLimit}` : ''}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center overflow-y-auto overscroll-contain p-3 sm:p-6 bg-black/70 backdrop-blur-sm">
      {/* Same scroll container as before (max-h-[90vh] overflow-y-auto): only the
          header becomes sticky inside it, so no behaviour change in scrolling. */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-2xl w-full max-w-4xl max-h-[calc(100dvh-1.5rem)] sm:max-h-[90vh] overflow-y-auto overscroll-contain">
        <div className="sticky top-0 z-20 flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-800 bg-slate-900/95 backdrop-blur-sm">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-blue-500 ring-1 ring-blue-400/30 shadow-lg shadow-blue-600/20 flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-white leading-tight">{t.title}</h2>
              {currentUser && <p className="text-[11px] text-slate-400 truncate">{currentUser.email}</p>}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6">
          <div className="grid gap-4 sm:gap-5 lg:grid-cols-5 lg:items-start">
            {/* ── Main column (3/5) : Plan + Fonctionnalités ── */}
            <div className="lg:col-span-3 space-y-4 sm:space-y-5">
              <section className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-950 to-slate-950/40 p-5 shadow-lg shadow-black/20">
                <header className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">{t.plan}</span>
                    <p className="text-sm text-slate-300 mt-1">{t.planLabel}</p>
                  </div>
                  {loading ? (
                    <span className="text-xs text-slate-500 shrink-0">{t.loading}</span>
                  ) : (
                    <span className={`shrink-0 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider ${planCode === 'pro' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'bg-slate-800 text-slate-200 border border-slate-700'}`}>
                      {planCode === 'pro' ? t.planPro : t.planFree}
                    </span>
                  )}
                </header>

                {/* P3 — provenance of the displayed plan (same server source as the gate) */}
                {!loading && (
                  <p className="mt-3 text-[10px] text-slate-500 leading-tight">
                    {enforced ? t.planSource : t.planFreeMode}
                  </p>
                )}

                <div className="mt-5 flex items-end justify-between gap-3">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-black text-white tabular-nums leading-none">{availableFeatures}</span>
                    <span className="text-sm font-semibold text-slate-500 leading-none">/ {totalFeatures}</span>
                  </div>
                  <span className="text-[11px] text-slate-500 text-right leading-tight">{t.featuresAvail}</span>
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${planCode === 'pro' ? 'bg-amber-500' : 'bg-blue-500'}`}
                      style={{ width: totalFeatures > 0 ? `${Math.round((availableFeatures / totalFeatures) * 100)}%` : '0%' }}
                    />
                  </div>
                  {planCode === 'pro' && !loading && (
                    <span className="text-[10px] font-bold text-amber-400 uppercase shrink-0">{t.proActive}</span>
                  )}
                </div>
              </section>
              <section className="rounded-2xl border border-slate-800 bg-slate-950/50 p-5">
                <header className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold text-white">{t.features}</h3>
                  {!loading && sortedFeatures.length > 0 && (
                    <span className="shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-800 text-slate-300 border border-slate-700 tabular-nums">
                      {availableFeatures}/{totalFeatures}
                    </span>
                  )}
                </header>

                {/* Same server data, same order — regrouped into three compact
                    grids (F9): available now / with PRO / Bientôt. */}
                {loading ? (
                  <div className="text-sm text-slate-500 py-6 text-center">{t.loading}</div>
                ) : features.length === 0 ? (
                  <div className="text-sm text-slate-500 py-6 text-center">{t.unavailable}</div>
                ) : (
                  <div className="mt-4 space-y-5">
                    {unlockedFeatures.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-400/90">{t.availableNow}</span>
                          <span className="flex-1 h-px bg-slate-800" />
                          <span className="text-[11px] font-bold text-slate-500 tabular-nums shrink-0">{unlockedFeatures.length}</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {unlockedFeatures.map(renderFeatureTile)}
                        </div>
                      </div>
                    )}

                    {lockedFeatures.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-400/90">{t.withPro}</span>
                          <span className="flex-1 h-px bg-slate-800" />
                          <span className="text-[11px] font-bold text-slate-500 tabular-nums shrink-0">{lockedFeatures.length}</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {lockedFeatures.map(renderFeatureTile)}
                        </div>
                      </div>
                    )}

                    {comingSoonFeatures.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-500 shrink-0" />
                          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{t.comingSoon}</span>
                          <span className="flex-1 h-px bg-slate-800" />
                          <span className="text-[11px] font-bold text-slate-500 tabular-nums shrink-0">{comingSoonFeatures.length}</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {comingSoonFeatures.map(renderComingSoonTile)}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>

            {/* ── Side column (2/5) : Passer à PRO + Profil + Se déconnecter ── */}
            <div className="lg:col-span-2 space-y-4 sm:space-y-5">

              {!loading && planCode === 'free' && (
                <section className="rounded-2xl border border-amber-500/25 bg-gradient-to-br from-amber-500/[0.10] via-amber-500/[0.04] to-transparent p-5">
                  {/* Real PRO checkout (Phase E contract): POST /api/v1/payments/checkout
                      → redirect to the provider-hosted checkoutUrl returned by the
                      backend. PRO is granted ONLY after server-side verification
                      (webhook → verify_payment) — this client never fakes a plan. */}
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>{t.upgrade}</span>
                  </h3>
                  <p className="mt-2 text-[11px] text-slate-400 leading-relaxed">{t.secureNote}</p>
                  <button
                    onClick={handleUpgrade}
                    disabled={checkoutState === 'loading'}
                    className={`mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-amber-500 to-amber-400 text-slate-950 shadow-lg shadow-amber-500/20 transition-all ${
                      checkoutState === 'loading'
                        ? 'opacity-70 cursor-wait'
                        : 'hover:from-amber-400 hover:to-amber-300 hover:shadow-amber-500/30 cursor-pointer'
                    }`}
                  >
                    <Sparkles className={`w-4 h-4 shrink-0 ${checkoutState === 'loading' ? 'animate-pulse' : ''}`} />
                    <span>{checkoutState === 'loading' ? t.starting : t.upgrade}</span>
                  </button>

                  {checkoutState === 'error' && (
                    <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-[11px] leading-relaxed">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div className="space-y-1 text-left">
                        <div className="font-bold">{t.errorTitle}</div>
                        <div>{checkoutError}</div>
                        <button
                          onClick={handleUpgrade}
                          className="underline hover:text-red-200 cursor-pointer font-semibold"
                        >
                          {t.retry}
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {currentUser && (
                <section className="rounded-2xl border border-slate-800 bg-slate-950/50 p-5">
                  <header className="flex items-center gap-2.5 mb-4">
                    <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-800/80 ring-1 ring-slate-700 shrink-0">
                      <User className="w-4 h-4 text-slate-300" />
                    </span>
                    <h3 className="text-sm font-bold text-white">{t.profile}</h3>
                  </header>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300"><User className="w-3.5 h-3.5 text-slate-500 shrink-0" /><span className="truncate">{currentUser.fullName || currentUser.name || '—'}</span></div>
                    <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300"><Mail className="w-3.5 h-3.5 text-slate-500 shrink-0" /><span className="truncate">{currentUser.email}</span></div>
                    <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300"><Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" /><span className="truncate">{currentUser.phone || '—'}</span></div>
                    <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300"><Shield className="w-3.5 h-3.5 text-slate-500 shrink-0" /><span className="truncate capitalize">{currentUser.role}</span></div>
                    <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300 sm:col-span-2"><MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" /><span className="truncate">{currentUser.region}</span></div>
                  </div>
                </section>
              )}

              <button onClick={() => { onLogout(); onClose(); }} className="w-full py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl text-sm font-semibold transition-all cursor-pointer flex items-center justify-center gap-2">
                <LogOut className="w-4 h-4" />
                <span>{t.logout}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
export {};
