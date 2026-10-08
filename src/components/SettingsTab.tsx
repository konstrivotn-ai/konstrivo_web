import React from 'react';
import { 
  Settings, Globe, Shield, RefreshCw, Download, Upload, Info, Check, 
  Flag, DollarSign, Ruler, Smartphone, Wifi, WifiOff 
} from 'lucide-react';
import { CountryCode, CurrencyCode, Language, RegionTunisia, UnitSystem } from '../types';
import { REGIONS_TUNISIA } from '../data/marketRates';
import { getCountryConfig, findCountryConfig, listCountryOptions, getCurrencyMeta, ensureCountryReferenceLoaded } from '../data/countryConfig';

interface SettingsTabProps {
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
  wasteMarginDefault: number;
  setWasteMarginDefault: (val: number) => void;
  onResetRates: () => void;
  isOffline: boolean;
  setIsOffline: (offline: boolean) => void;
  onOpenSyncModal: () => void;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
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
  wasteMarginDefault,
  setWasteMarginDefault,
  onResetRates,
  isOffline,
  setIsOffline,
  onOpenSyncModal
}) => {
  // PHASE 1 — retry the reference hydration if the boot attempt failed
  // (offline / DB down). No-op when already loaded; never rejects.
  React.useEffect(() => { ensureCountryReferenceLoaded(); }, []);

  const currentCountry = getCountryConfig(country);

  const handleCountrySelect = (cCode: CountryCode) => {
    setCountry(cCode);
    const target = findCountryConfig(cCode);
    if (target) {
      setCurrency(target.defaultCurrency);
      setUnitSystem(target.unitSystem);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      
      {/* Banner */}
      <div className="bg-slate-900 rounded-3xl p-6 border border-slate-800 shadow-xl flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2 mb-1">
            <Settings className="w-5 h-5 text-amber-400" />
            <span>{lang === 'ar' ? 'إعدادات المنصة وتفضيلات الشانطي' : 'Paramètres & Configuration Globale 2026'}</span>
          </h2>
          <p className="text-xs text-slate-400">
            Personnalisez le pays d'exercice, la devise, les unités de mesure et les options de synchronisation mobile.
          </p>
        </div>

        <button
          onClick={onOpenSyncModal}
          className="hidden sm:flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 text-xs font-bold border border-slate-700 transition-colors cursor-pointer"
        >
          <Smartphone className="w-4 h-4" />
          <span>Sync Mobile API</span>
        </button>
      </div>

      <div className="bg-slate-900 rounded-3xl p-6 sm:p-8 border border-slate-800 shadow-xl space-y-6">
        
        {/* Country & Jurisdiction Selection */}
        <div className="space-y-3">
          <label className="text-xs font-bold text-slate-200 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Flag className="w-4 h-4 text-amber-400" />
              <span>{lang === 'ar' ? 'البلد واللوائح الفنية النشطة:' : 'Pays & Cadre Réglementaire BTP :'}</span>
            </span>
            <span className="text-[11px] text-amber-400 font-mono font-bold">
              {currentCountry.buildingCodes}
            </span>
          </label>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {listCountryOptions().map((c) => {
              const isSelected = country === c.code;
              return (
                <button
                  key={c.code}
                  onClick={() => handleCountrySelect(c.code)}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-amber-500 text-slate-950 font-black border-amber-400 shadow-lg shadow-amber-500/20'
                      : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="text-base mb-1">{c.flag}</div>
                  <div className="text-xs font-bold truncate">{c.nameFr}</div>
                  <div className={`text-[10px] mt-0.5 font-mono ${isSelected ? 'text-slate-900' : 'text-slate-500'}`}>
                    {c.defaultCurrency} • TVA {c.defaultVatRate}%
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Currency & Unit System Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-800 pt-5">
          
          {/* Currency Selection */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-200 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-amber-400" />
              <span>Devise Principale d'Affichage :</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {currentCountry.supportedCurrencies.map((cur) => (
                <button
                  key={cur}
                  onClick={() => setCurrency(cur)}
                  className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                    currency === cur
                      ? 'bg-amber-500 text-slate-950 font-bold border-amber-400'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-white'
                  }`}
                >
                  <div className="text-xs font-mono font-black">{cur}</div>
                  <div className="text-[10px] font-sans opacity-80">{getCurrencyMeta(cur).label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Unit System */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-200 flex items-center gap-2">
              <Ruler className="w-4 h-4 text-amber-400" />
              <span>Système de Mesure des Surfaces :</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setUnitSystem('metric')}
                className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                  unitSystem === 'metric'
                    ? 'bg-amber-500 text-slate-950 font-bold border-amber-400'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-white'
                }`}
              >
                <div className="text-xs font-black">Métrique</div>
                <div className="text-[10px] opacity-80">Mètres, m², m³, kg</div>
              </button>

              <button
                onClick={() => setUnitSystem('imperial')}
                className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                  unitSystem === 'imperial'
                    ? 'bg-amber-500 text-slate-950 font-bold border-amber-400'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-white'
                }`}
              >
                <div className="text-xs font-black">Impérial</div>
                <div className="text-[10px] opacity-80">Feet, sq ft, cu yd, lbs</div>
              </button>
            </div>
          </div>

        </div>

        {/* Language Selection */}
        <div className="space-y-2 border-t border-slate-800 pt-5">
          <label className="text-xs font-bold text-slate-200 flex items-center gap-2">
            <Globe className="w-4 h-4 text-amber-400" />
            <span>{lang === 'ar' ? 'لغة الواجهة والتواصل (Langue de l’interface):' : 'Langue de l’application & Rapports :'}</span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { id: 'fr', label: '🇫🇷 Français Technique', desc: 'Conforme DTU & Terminologie BTP' },
              { id: 'ar', label: '🇸🇦 العربية الفصحى', desc: 'المصطلحات الهندسية الرسمية' },
              { id: 'en', label: '🇬🇧 English Technical', desc: 'Technical BTP terms in English' }
            ].map(l => (
              <button
                key={l.id}
                onClick={() => setLang(l.id as Language)}
                className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                  lang === l.id
                    ? 'bg-amber-500 text-slate-950 font-black border-amber-400 shadow-lg shadow-amber-500/20'
                    : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="text-xs font-bold">{l.label}</div>
                <div className={`text-[10px] ${lang === l.id ? 'text-slate-900' : 'text-slate-500'}`}>{l.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Tunisia Region (Conditional) */}
        {country === 'TN' && (
          <div className="space-y-2 border-t border-slate-800 pt-5">
            <label className="text-xs font-bold text-slate-200 flex items-center gap-2">
              <Shield className="w-4 h-4 text-amber-400" />
              <span>{lang === 'ar' ? 'الولاية / المنطقة في تونس:' : 'Gouvernorat en Tunisie :'}</span>
            </label>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value as RegionTunisia)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs text-white font-bold cursor-pointer"
            >
              {REGIONS_TUNISIA.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        )}

        {/* Default Waste Margin */}
        <div className="space-y-2 border-t border-slate-800 pt-5">
          <label className="text-xs font-bold text-slate-200 flex justify-between">
            <span>{lang === 'ar' ? 'نسبة الفاقد والضياع الافتراضية (Marge de Perte / Chutes):' : 'Marge de Chute & Découpe par Défaut (%) :'}</span>
            <span className="text-amber-400 font-mono font-bold">{wasteMarginDefault}%</span>
          </label>
          <div className="flex gap-3">
            {[5, 10, 15].map(wm => (
              <button
                key={wm}
                onClick={() => setWasteMarginDefault(wm)}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                  wasteMarginDefault === wm
                    ? 'bg-amber-500 text-slate-950 border-amber-400 font-black'
                    : 'bg-slate-950 text-slate-400 border-slate-800'
                }`}
              >
                {wm}% {wm === 5 ? '(Minima DTU)' : wm === 10 ? '(Standard Chantiers)' : '(Formes & Découpes complexes)'}
              </button>
            ))}
          </div>
        </div>

        {/* Offline Simulation */}
        <div className="border-t border-slate-800 pt-5 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              {isOffline ? <WifiOff className="w-3.5 h-3.5 text-amber-400" /> : <Wifi className="w-3.5 h-3.5 text-emerald-400" />}
              <span>Mode Hors-Ligne (Offline Chantiers)</span>
            </div>
            <div className="text-[11px] text-slate-500">
              Permet de simuler le fonctionnement sans connexion Internet dans les chantiers isolés.
            </div>
          </div>

          <button
            onClick={() => setIsOffline(!isOffline)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
              isOffline ? 'bg-amber-500/20 text-amber-400 border-amber-500/40' : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
            }`}
          >
            {isOffline ? 'Actif (Hors-Ligne)' : 'Désactivé (En Ligne)'}
          </button>
        </div>

        {/* Restore Defaults */}
        <div className="border-t border-slate-800 pt-5 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-slate-200">Réinitialisation des Prix du Marché</div>
            <div className="text-[11px] text-slate-500">Restaure la grille tarifaire de référence 2026.</div>
          </div>

          <button
            onClick={onResetRates}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-amber-400 text-xs font-bold rounded-xl border border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Réinitialiser</span>
          </button>
        </div>

      </div>
    </div>
  );
};
