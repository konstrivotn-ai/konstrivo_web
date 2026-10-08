import React, { useState } from 'react';
import { 
  Search, UserCircle, LogIn, Menu, X, Globe, ChevronDown, 
  ShieldCheck, Wifi, WifiOff, Sparkles, Building2, Users, Wrench, 
  Calculator, FileText, Info, PhoneCall, Bot, Tag, Compass
} from 'lucide-react';
import { CountryCode, CurrencyCode, Language, RegionTunisia, UnitSystem, UserProfile } from '../types';
import { getCountryConfig, findCountryConfig, listCountryOptions } from '../data/countryConfig';
import { ui } from '../i18n';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  lang: Language;
  setLang: (lang: Language) => void;
  region: RegionTunisia;
  setRegion: (region: RegionTunisia) => void;
  country: CountryCode;
  setCountry: (c: CountryCode) => void;
  currency: CurrencyCode;
  setCurrency: (c: CurrencyCode) => void;
  unitSystem: UnitSystem;
  setUnitSystem: (u: UnitSystem) => void;
  devisCount: number;
  onOpenSyncModal: () => void;
  onOpenAuthModal: () => void;
  onOpenRegisterModal: () => void;
  onOpenAccountModal: () => void;
  onOpenAdminModal?: () => void;
  onOpenWizardModal?: () => void;
  onOpenSupplierModal?: () => void;
  currentUser: UserProfile | null;
  isOffline: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  lang,
  setLang,
  region,
  setRegion,
  country,
  setCountry,
  currency,
  setCurrency,
  unitSystem,
  setUnitSystem,
  devisCount,
  onOpenSyncModal,
  onOpenAuthModal,
  onOpenRegisterModal,
  onOpenAccountModal,
  onOpenAdminModal,
  onOpenWizardModal,
  onOpenSupplierModal,
  currentUser,
  isOffline
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const currentCountry = getCountryConfig(country);
  const isUserAdmin = currentUser?.role === 'admin';

  const navLinks: Array<{ id: string; label: string; badge?: number }> = [
    { id: 'home', label: ui(lang, 'nav_home') },
    { id: 'services', label: ui(lang, 'nav_services') },
    { id: 'projects', label: ui(lang, 'nav_projects') },
    { id: 'tools', label: ui(lang, 'nav_tools') },
    { id: 'professionals', label: ui(lang, 'nav_professionals') },
    { id: 'devis', label: ui(lang, 'nav_devis'), badge: devisCount > 0 ? devisCount : undefined },
    { id: 'about', label: ui(lang, 'nav_about') },
    { id: 'contact', label: ui(lang, 'nav_contact') }
  ];

  const handleNavClick = (id: string) => {
    // Map navigation IDs to activeTab keys
    if (id === 'services') setActiveTab('services');
    else if (id === 'tools') setActiveTab('calculator');
    else if (id === 'professionals') setActiveTab('directory_market');
    else setActiveTab(id);
    setIsMobileMenuOpen(false);
  };

  const isLinkActive = (id: string) => {
    if (id === 'home' && activeTab === 'home') return true;
    if (id === 'services' && (activeTab === 'services' || activeTab === 'maintenance')) return true;
    if (id === 'projects' && activeTab === 'projects') return true;
    if (id === 'tools' && (activeTab === 'calculator' || activeTab === 'rates')) return true;
    if (id === 'professionals' && activeTab === 'directory_market') return true;
    if (id === 'devis' && activeTab === 'devis') return true;
    if (id === 'about' && activeTab === 'about') return true;
    if (id === 'contact' && activeTab === 'contact') return true;
    return false;
  };

  return (
    <>
      <header className="bg-[#0b0f17] border-b border-slate-800/80 text-white sticky top-0 z-50 shadow-2xl backdrop-blur-md bg-opacity-95">
        
        {/* Top Mini Utilities Bar */}
        <div className="bg-[#070a10] px-4 sm:px-8 py-1 text-[11px] border-b border-slate-800/60 flex flex-wrap justify-between items-center text-slate-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-amber-400/90 font-medium">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              Plateforme BTP & Métré 2026
            </span>
            <span className="hidden md:inline text-slate-600">•</span>
            <span className="hidden md:inline text-slate-400">DTU 25.41 & Normes Tunisiennes</span>
          </div>

          <div className="flex items-center gap-3">
            {/* Language selector (Website fix) — previously the ONLY working
                selector was buried in Réglages; now the header exposes it
                using the existing lang/setLang state (no new state added). */}
            <div className="flex items-center gap-1 bg-slate-900 px-2 py-0.5 rounded-lg border border-slate-800 text-slate-300">
              <Globe className="w-3 h-3 text-amber-400 shrink-0" />
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as Language)}
                aria-label="Langue de l'interface"
                className="bg-transparent text-[10px] font-bold text-white focus:outline-none cursor-pointer"
              >
                <option value="fr" className="bg-slate-900">🇫🇷 FR</option>
                <option value="ar" className="bg-slate-900">🇸🇦 AR</option>
                <option value="en" className="bg-slate-900">🇬🇧 EN</option>
              </select>
            </div>

            {/* Quick Country / Currency selector */}
            <div className="flex items-center gap-1 bg-slate-900 px-2 py-0.5 rounded-lg border border-slate-800 text-slate-300">
              <span>{currentCountry.flag}</span>
              <select
                value={country}
                onChange={(e) => {
                  const val = e.target.value as CountryCode;
                  setCountry(val);
                  if (findCountryConfig(val)) {
                    setCurrency(findCountryConfig(val)!.defaultCurrency);
                  }
                }}
                className="bg-transparent text-[10px] font-bold text-white focus:outline-none cursor-pointer"
              >
                {listCountryOptions().map((c) => (
                  <option key={c.code} value={c.code} className="bg-slate-900 text-white">
                    {c.nameFr} ({c.defaultCurrency})
                  </option>
                ))}
              </select>
            </div>

            {/* Offline/Online Live Indicator */}
            <button
              onClick={onOpenSyncModal}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                isOffline 
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' 
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              }`}
            >
              {isOffline ? <WifiOff className="w-3 h-3 text-amber-400" /> : <Wifi className="w-3 h-3 text-emerald-400" />}
              <span>{isOffline ? 'Hors-ligne' : 'Live Sync 2026'}</span>
            </button>
          </div>
        </div>

        {/* Main Navbar from Screenshot */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between gap-4">
          
          {/* KONSTRIVO Logo (Golden Stylized K + Text) */}
          <div 
            onClick={() => setActiveTab('home')}
            className="flex items-center gap-3 cursor-pointer group flex-shrink-0"
          >
            {/* Stylized K Logo Icon */}
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 via-amber-500 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20 group-hover:scale-105 transition-transform">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-slate-950 font-black">
                <path d="M4 3h3.5v7.2L14.7 3H19l-8.5 9 9.5 9h-4.6l-7.9-7.8V21H4V3z" />
              </svg>
            </div>
            
            {/* Logo Text */}
            <div className="flex flex-col">
              <span className="text-xl sm:text-2xl font-black tracking-tight text-white font-mono leading-none">
                KONSTRIVO
              </span>
              <span className="text-[10px] sm:text-[11px] text-amber-400 font-medium tracking-wide leading-tight">
                Construction & Bâtiment
              </span>
            </div>
          </div>

          {/* Center Navigation Links (Matching Screenshot 1:1) */}
          <nav className="hidden lg:flex items-center gap-1 xl:gap-2">
            {navLinks.map((link) => {
              const active = isLinkActive(link.id);
              return (
                <button
                  key={link.id}
                  onClick={() => handleNavClick(link.id)}
                  className={`px-3 py-2 text-sm font-semibold transition-colors cursor-pointer relative flex items-center gap-1.5 ${
                    active
                      ? 'text-amber-400 font-bold'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <span>{link.label}</span>
                  {link.badge && (
                    <span className="w-4 h-4 rounded-full bg-amber-500 text-slate-950 text-[10px] font-black flex items-center justify-center">
                      {link.badge}
                    </span>
                  )}
                  {active && (
                    <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-amber-400 rounded-full" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right Action Buttons */}
          <div className="hidden sm:flex items-center gap-3">
            {onOpenWizardModal && (
              <button
                onClick={onOpenWizardModal}
                className="px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold bg-violet-500/10 text-violet-300 border border-violet-500/30 hover:bg-violet-500/20 transition-all cursor-pointer flex items-center gap-1.5"
                title="Assistant Devis Visuel"
              >
                <Sparkles className="w-4 h-4 shrink-0" />
                <span>{ui(lang, 'visual_devis')}</span>
              </button>
            )}
            {/* Search Icon Button */}
            <button
              onClick={() => setShowSearchModal(true)}
              className="p-2.5 rounded-full text-slate-300 hover:text-amber-400 hover:bg-slate-900 transition-colors cursor-pointer"
              title={ui(lang, 'search')}
            >
              <Search className="w-5 h-5" />
            </button>

            {/* User Account / Admin Action Buttons */}
            <button
              onClick={isUserAdmin ? (onOpenAdminModal || onOpenAuthModal) : onOpenAuthModal}
              className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold border transition-all cursor-pointer ${
                isUserAdmin 
                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/40 hover:bg-amber-500/20' 
                  : 'text-white bg-[#131b2e] hover:bg-slate-800 border-slate-700/80 hover:border-slate-600'
              }`}
            >
              {isUserAdmin ? (
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Admin Owner</span>
                </span>
              ) : currentUser ? (
                currentUser.fullName.split(' ')[0]
              ) : (
                ui(lang, 'login')
              )}
            </button>

            {/* S'inscrire / Admin Dashboard Button (Solid Gold) */}
            <button
              onClick={isUserAdmin ? (onOpenAdminModal || onOpenAccountModal) : currentUser ? onOpenAccountModal : onOpenRegisterModal}
              className="px-4 py-2 rounded-xl text-xs sm:text-sm font-bold text-slate-950 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-500 hover:from-amber-300 hover:to-amber-400 shadow-lg shadow-amber-500/20 transition-all cursor-pointer transform hover:-translate-y-0.5 flex items-center gap-1.5"
            >
              {isUserAdmin ? '🛡️ Owner Panel' : currentUser ? ui(lang, 'my_account') : ui(lang, 'register')}
            </button>
          </div>

          {/* Mobile Menu Hamburger */}
          <div className="flex sm:hidden items-center gap-2">
            <button
              onClick={() => setShowSearchModal(true)}
              className="p-2 text-slate-300 hover:text-white"
            >
              <Search className="w-5 h-5" />
            </button>
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 text-slate-300 hover:text-white focus:outline-none"
            >
              {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>

        </div>

        {/* Mobile Dropdown Menu */}
        {isMobileMenuOpen && (
          <div className="lg:hidden bg-[#0d131f] border-b border-slate-800 px-4 py-4 space-y-2">
            <div className="grid grid-cols-2 gap-2 pb-3 border-b border-slate-800">
              {navLinks.map((link) => {
                const active = isLinkActive(link.id);
                return (
                  <button
                    key={link.id}
                    onClick={() => handleNavClick(link.id)}
                    className={`px-3 py-2 rounded-xl text-xs font-bold text-left transition-all ${
                      active
                        ? 'bg-amber-500 text-slate-950'
                        : 'text-slate-300 hover:bg-slate-900'
                    }`}
                  >
                    {link.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => { onOpenAuthModal(); setIsMobileMenuOpen(false); }}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white bg-[#131b2e] border border-slate-700 text-center"
              >
                {ui(lang, 'login')}
              </button>
              <button
                onClick={() => { onOpenRegisterModal(); setIsMobileMenuOpen(false); }}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold text-slate-950 bg-amber-500 text-center"
              >
                {ui(lang, 'register')}
              </button>
            </div>
          </div>
        )}

      </header>

      {/* Global Search Modal */}
      {showSearchModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#131b2e] border border-slate-700 rounded-3xl w-full max-w-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-white font-bold">
                <Search className="w-5 h-5 text-amber-400" />
                <span>{ui(lang, 'search_title')}</span>
              </div>
              <button 
                onClick={() => setShowSearchModal(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={ui(lang, 'search_placeholder')}
                className="w-full bg-[#0b0f17] border border-slate-700 rounded-2xl px-4 py-3.5 pl-11 text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 text-sm"
                autoFocus
              />
              <Search className="w-5 h-5 text-slate-400 absolute left-3.5 top-3.5" />
            </div>

            <div className="space-y-2 pt-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">{ui(lang, 'search_suggestions')}</span>
              <div className="flex flex-wrap gap-2">
                {['Placo BA13', 'Faux Plafond LED', 'Cloisons Acoustiques', 'Calculateur Métré', 'Artisan Tunis', 'Devis Plafond'].map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      if (s.includes('Calculateur') || s.includes('Placo')) setActiveTab('calculator');
                      else if (s.includes('Artisan')) setActiveTab('directory_market');
                      else if (s.includes('Devis')) setActiveTab('devis');
                      else setActiveTab('services');
                      setShowSearchModal(false);
                    }}
                    className="px-3 py-1.5 rounded-xl bg-slate-900 text-xs text-slate-300 hover:text-amber-400 hover:bg-slate-800 border border-slate-800 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
