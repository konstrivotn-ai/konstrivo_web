import type { Language } from './types';

/**
 * KONSTRIVO — Minimal UI i18n layer (Website fix: language selector + i18n).
 *
 * Scope: main navigation, header actions and shared chrome. Tab-internal
 * content keeps its existing per-component strings (out of scope here).
 *
 * IMPORTANT: the source of truth for FREE/PRO plan/features stays the backend
 * (GET /api/v1/features). This file NEVER carries plan or feature data.
 */
export type UiKey =
  | 'nav_home'
  | 'nav_services'
  | 'nav_projects'
  | 'nav_tools'
  | 'nav_professionals'
  | 'nav_devis'
  | 'nav_about'
  | 'nav_contact'
  | 'login'
  | 'register'
  | 'my_account'
  | 'search'
  | 'visual_devis'
  | 'search_title'
  | 'search_placeholder'
  | 'search_suggestions';

const STRINGS: Record<UiKey, Record<Language, string>> = {
  nav_home:           { fr: 'Accueil', ar: 'الرئيسية', en: 'Home' },
  nav_services:       { fr: 'Services', ar: 'الخدمات', en: 'Services' },
  nav_projects:       { fr: 'Projets', ar: 'المشاريع', en: 'Projects' },
  nav_tools:          { fr: 'Outils', ar: 'الأدوات', en: 'Tools' },
  nav_professionals:  { fr: 'Professionnels', ar: 'المهنيون', en: 'Professionals' },
  nav_devis:          { fr: 'Devis', ar: 'عروض الأسعار', en: 'Quotes' },
  nav_about:          { fr: 'À propos', ar: 'من نحن', en: 'About' },
  nav_contact:        { fr: 'Contact', ar: 'اتصل بنا', en: 'Contact' },
  login:              { fr: 'Se connecter', ar: 'تسجيل الدخول', en: 'Sign in' },
  register:           { fr: "S'inscrire", ar: 'إنشاء حساب', en: 'Create account' },
  my_account:         { fr: 'Mon Compte', ar: 'حسابي', en: 'My Account' },
  search:             { fr: 'Rechercher', ar: 'بحث', en: 'Search' },
  visual_devis:       { fr: 'Devis Visuel', ar: 'عرض سعر مرئي', en: 'Visual Quote' },
  search_title:       { fr: 'Recherche Globale KONSTRIVO', ar: 'البحث الشامل KONSTRIVO', en: 'KONSTRIVO Global Search' },
  search_placeholder: { fr: 'Rechercher un service, un artisan, un outil, un devis...', ar: 'ابحث عن خدمة، حرفي، أداة، عرض سعر...', en: 'Search a service, craftsman, tool, quote...' },
  search_suggestions: { fr: 'Suggestions rapides :', ar: 'اقتراحات سريعة :', en: 'Quick suggestions :' },
};

/** Resolve a UI string; falls back to the French copy when a key is missing. */
export function ui(lang: Language, key: UiKey): string {
  return STRINGS[key]?.[lang] ?? STRINGS[key].fr;
}

/** Document direction: Arabic is the only RTL locale (FR and EN are LTR). */
export function dirFor(lang: Language): 'ltr' | 'rtl' {
  return lang === 'ar' ? 'rtl' : 'ltr';
}
