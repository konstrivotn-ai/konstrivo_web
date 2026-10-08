import React, { useState } from 'react';
import { 
  Tag, Search, RefreshCw, Check, Info, ShieldAlert, Sparkles, 
  Edit2, CheckCircle2, Upload, Wifi, TrendingUp, Sliders, 
  Percent, DollarSign, ArrowUpRight, ArrowDownRight, Layers 
} from 'lucide-react';
import { MaterialRate, Language, TradeCategory, CurrencyCode, CountryCode } from '../types';
import { getCountryConfig, getCurrencyMeta, convertFromTnd } from '../data/countryConfig';
import { catalogKey, sameCatalogKey, uniqueCatalogValues } from '../utils/catalogDisplay';
import { isExcludedSentinelTradeCode } from '../utils/catalogDisplay';
import { isTradeInactiveOrDeleted, subscribeTradeRegistry } from '../data/tradeRegistry';


interface RatesTabProps {
  rates: MaterialRate[];
  onUpdateRate: (id: string, newPrice: number) => void;
  onBulkUpdateRates?: (updatedRates: MaterialRate[]) => void;
  onResetRates: () => void;
  onOpenCatalogUpload: () => void;
  lang: Language;
  country: CountryCode;
  currency: CurrencyCode;
}

export const RatesTab: React.FC<RatesTabProps> = ({
  rates,
  onUpdateRate,
  onBulkUpdateRates,
  onResetRates,
  onOpenCatalogUpload,
  lang,
  country,
  currency
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempPrice, setTempPrice] = useState<number>(0);
  const [savedBadge, setSavedBadge] = useState<string | null>(null);

  // Dynamic Market Sync State
  const [isAutoSyncActive, setIsAutoSyncActive] = useState<boolean>(true);
  const [syncStatus, setSyncStatus] = useState<string>('Connecté au Réseau Fournisseurs BTP 2026 (Mise à jour quotidienne active)');
  const [inflationIndex, setInflationIndex] = useState<number>(0);
  const [appliedInflationMsg, setAppliedInflationMsg] = useState<string | null>(null);

  const countryInfo = getCountryConfig(country);
  const currMeta = getCurrencyMeta(currency);

  // ── Dynamic trade sections ───────────────────────────────────────────────
  // Category labels for the 12 official codes (display nicety only — a new
  // métier like "aluminium" is NEVER hardcoded: it gets its own filter/chip
  // just by being present in the `rates` data). Lookup is spelling-insensitive
  // so "Placo", " PLACO " and "placo" all resolve to the same section label.
  const OFFICIAL_CATEGORY_LABELS: Record<string, string> = {
    placo: 'Placo / Plâtre',
    peinture: 'Peinture',
    carrelage: 'Carrelage',
    maconnerie: 'Maçonnerie',
    plomberie: 'Plomberie',
    electricite: 'Électricité',
    etancheite: 'Étanchéité',
    isolation: 'Isolation',
    menuiserie: 'Menuiserie',
    sols: 'Sols & Parquet',
    facade: 'Façade',
    demolition: 'Démolition',
  };

  function categoryLabel(cat: string): string {
    const official = OFFICIAL_CATEGORY_LABELS[cat] || OFFICIAL_CATEGORY_LABELS[catalogKey(cat)];
    if (official) return official;
    const pretty = (cat || '').trim().replace(/[-_]+/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()).trim();
    return pretty || cat;
  }

  // Subscribe to trade registry changes so deactivated/deleted trades disappear immediately
  const [, setRatesRegistryTick] = useState(0);
  React.useEffect(() => {
    return subscribeTradeRegistry(() => setRatesRegistryTick((t) => t + 1));
  }, []);

  // Unique categories actually present in the data — the only source of truth
  // for the sections shown below. Deactivated or deleted trades are filtered out.
  // The `unmapped_review` import sentinel is a DATA bucket, never a Tarifs
  // section: excluded here while its materials stay visible under « all ».
  const availableCategories: string[] = uniqueCatalogValues(
    rates
      .filter(r => !isTradeInactiveOrDeleted(r.trade) && !isTradeInactiveOrDeleted(r.category))
      .map(r => r.category)
      .filter(c => !isExcludedSentinelTradeCode(c))
  );
  // If a previously selected category disappears from the data, fall back to
  // "all" instead of rendering an empty list.
  const activeCategory = availableCategories.some(c => sameCatalogKey(c, selectedCategory))
    ? selectedCategory
    : 'all';

  const filteredRates = rates.filter(r => {
    // Hide materials belonging to deactivated/deleted trades
    if (isTradeInactiveOrDeleted(r.trade) || isTradeInactiveOrDeleted(r.category)) {
      return false;
    }
    const matchesSearch =
      (r.nameFr || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r.nameAr || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r.nameEn || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (r.id || '').toLowerCase().includes(searchTerm.toLowerCase());
    // Section match is spelling-insensitive: every item of a classification is
    // listed in its own section, exactly once.
    const matchesCategory = activeCategory === 'all' || sameCatalogKey(r.category, activeCategory);
    return matchesSearch && matchesCategory;
  });

  const handleStartEdit = (rate: MaterialRate) => {
    setEditingId(rate.id);
    setTempPrice(rate.unitPriceTnd);
  };

  const handleSaveEdit = (id: string) => {
    onUpdateRate(id, tempPrice);
    setEditingId(null);
    setSavedBadge(id);
    setTimeout(() => setSavedBadge(null), 1500);
  };

  const handleApplyInflation = (percent: number) => {
    if (!onBulkUpdateRates) return;
    const factor = 1 + (percent / 100);
    const updated = rates.map(r => ({
      ...r,
      unitPriceTnd: +(r.unitPriceTnd * factor).toFixed(3),
      note: `Index marché ajusté de ${percent > 0 ? '+' : ''}${percent}% (${new Date().toLocaleDateString('fr-TN')})`
    }));
    onBulkUpdateRates(updated);
    setAppliedInflationMsg(`Index de variation de ${percent > 0 ? '+' : ''}${percent}% appliqué sur l'ensemble des ${rates.length} matériaux.`);
    setTimeout(() => setAppliedInflationMsg(null), 3000);
  };

  const handleToggleAutoSync = () => {
    setIsAutoSyncActive(!isAutoSyncActive);
    if (!isAutoSyncActive) {
      setSyncStatus('Connecté au Réseau Fournisseurs BTP 2026 (Mise à jour quotidienne active)');
    } else {
      setSyncStatus('Mode Manuel Actif (Mises à jour automatiques désactivées)');
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner: Dynamic Market Price Sync Engine */}
      <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-amber-950/40 rounded-3xl p-6 border border-slate-800 shadow-xl space-y-5">
        
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-white flex items-center gap-2">
                <Tag className="w-5 h-5 text-amber-400" />
                <span>Bordereau des Prix Unitaires & Tarifs Matériaux 2026</span>
              </h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 font-bold font-mono">
                {countryInfo.flag} {currency}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Synchronisation directe avec les quincailleries industrielles et distributeurs agréés (Knauf, Siniat, Astral, Ciments)
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={onOpenCatalogUpload}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-xs font-bold rounded-xl shadow-lg shadow-amber-500/20 transition-all cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>Importer Catalogue Fournisseur (CSV/Excel)</span>
            </button>

            <button
              onClick={onResetRates}
              className="flex items-center gap-2 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl border border-slate-700 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
              <span>Réinitialiser 2026</span>
            </button>
          </div>
        </div>

        {/* Live Sync Status Pill & Inflation Index Engine */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-3 border-t border-slate-800/80">
          
          {/* Status Indicator */}
          <div className="md:col-span-6 bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-xl ${isAutoSyncActive ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'}`}>
                <Wifi className="w-4 h-4 animate-pulse" />
              </div>
              <div>
                <span className="text-xs font-bold text-white block">
                  {isAutoSyncActive ? 'Flux Marché Connecté' : 'Synchronisation Suspendue'}
                </span>
                <span className="text-[11px] text-slate-400 block">{syncStatus}</span>
              </div>
            </div>

            <button
              onClick={handleToggleAutoSync}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all ${
                isAutoSyncActive
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              {isAutoSyncActive ? 'Actif ✓' : 'Activer'}
            </button>
          </div>

          {/* Dynamic Inflation Index Controls */}
          <div className="md:col-span-6 bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
                Ajustement Index Inflation Marché
              </span>
              <span className="text-[11px] text-slate-400 block">
                Variation rapide sur l'ensemble du catalogue
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleApplyInflation(2.5)}
                className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-amber-400 border border-slate-700 hover:border-amber-500/40 rounded-lg text-xs font-bold transition-all flex items-center gap-1"
                title="Hausse matières premières +2.5%"
              >
                <ArrowUpRight className="w-3 h-3" /> +2.5%
              </button>
              <button
                onClick={() => handleApplyInflation(5.0)}
                className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-amber-400 border border-slate-700 hover:border-amber-500/40 rounded-lg text-xs font-bold transition-all flex items-center gap-1"
                title="Index trimestriel +5.0%"
              >
                <ArrowUpRight className="w-3 h-3" /> +5.0%
              </button>
              <button
                onClick={() => handleApplyInflation(-3.0)}
                className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-emerald-400 border border-slate-700 hover:border-emerald-500/40 rounded-lg text-xs font-bold transition-all flex items-center gap-1"
                title="Remise volume -3.0%"
              >
                <ArrowDownRight className="w-3 h-3" /> -3.0%
              </button>
            </div>
          </div>

        </div>

        {appliedInflationMsg && (
          <div className="p-3 bg-emerald-950/70 border border-emerald-500/40 rounded-xl flex items-center gap-2 text-xs text-emerald-300">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>{appliedInflationMsg}</span>
          </div>
        )}

      </div>

      {/* Search & Category Filter Bar */}
      <div className="bg-slate-900 rounded-3xl p-5 border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder={lang === 'ar' ? 'ابحث عن مادة (BA13, Rail, Peinture, Ciment...)' : 'Rechercher un matériau par désignation, référence ou profilé...'}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-2xl pl-10 pr-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            {[
              { id: 'all', label: 'Tous (الكل)' },
              ...availableCategories.map(cat => ({ id: cat, label: categoryLabel(cat) })),
            ].map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  (cat.id === 'all' ? activeCategory === 'all' : sameCatalogKey(activeCategory, cat.id))
                    ? 'bg-amber-500 text-slate-950 font-black shadow-md shadow-amber-500/20'
                    : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Rates Table */}
      <div className="bg-slate-900 rounded-3xl border border-slate-800 shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider font-bold border-b border-slate-800">
              <tr>
                <th className="p-4">Désignation Matériau</th>
                <th className="p-4">Désignation Anglaise (English)</th>
                <th className="p-4">Conditionnement</th>
                <th className="p-4 text-right">Prix Réf. Base (TND)</th>
                <th className="p-4 text-right">Prix Actif Converti ({currMeta.symbol})</th>
                <th className="p-4 text-center">Édition Rapide</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredRates.map(rate => {
                const isEditing = editingId === rate.id;
                const convertedPrice = convertFromTnd(rate.unitPriceTnd, currency);
                return (
                  <tr key={rate.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="p-4 font-bold text-slate-100">
                      <div className="flex items-center gap-2">
                        <span>{rate.nameFr}</span>
                        {savedBadge === rate.id && (
                          <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.2 rounded font-mono font-bold flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Mis à jour
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 font-semibold">{rate.nameAr || ''}</div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                        <span className="text-[9px] font-mono bg-slate-950 px-1.5 py-0.5 rounded border border-slate-700 text-slate-500">
                          Code : {rate.id}
                        </span>
                        <span className="text-[9px] bg-slate-950 px-1.5 py-0.5 rounded border border-slate-700 text-amber-400/90">
                          {categoryLabel(rate.category)}
                        </span>
                      </div>
                      {rate.note && (
                        <div className="text-[10px] text-amber-400/80 font-normal italic mt-0.5">{rate.note}</div>
                      )}
                    </td>

                    <td className="p-4 text-slate-300 font-medium">
                      <span className="bg-slate-950 px-2 py-0.5 rounded-lg border border-slate-800 text-amber-400/90">
                        {rate.nameEn || ''}
                      </span>
                    </td>

                    <td className="p-4 text-slate-400 font-medium font-mono">
                      {rate.unit || '—'}
                    </td>

                    <td className="p-4 text-right font-mono font-bold text-slate-300">
                      {isEditing ? (
                        <input
                          type="number"
                          step={0.5}
                          value={tempPrice}
                          onChange={(e) => setTempPrice(parseFloat(e.target.value) || 0)}
                          className="w-24 bg-slate-950 border border-amber-500 rounded-lg px-2 py-1 text-right font-mono font-black text-amber-400 focus:outline-none"
                          autoFocus
                        />
                      ) : (
                        <span>{rate.unitPriceTnd.toFixed(3)} TND</span>
                      )}
                    </td>

                    <td className="p-4 text-right font-mono font-black text-amber-400 text-sm">
                      {convertedPrice.toFixed(currMeta.decimals)} {currMeta.symbol}
                    </td>

                    <td className="p-4 text-center">
                      {isEditing ? (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleSaveEdit(rate.id)}
                            className="p-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg font-bold transition-colors cursor-pointer"
                            title="Sauvegarder"
                          >
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-lg transition-colors cursor-pointer"
                            title="Annuler"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleStartEdit(rate)}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 mx-auto"
                        >
                          <Edit2 className="w-3 h-3 text-amber-400" />
                          <span>Modifier</span>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {filteredRates.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    <div>Aucun matériau trouvé pour cette recherche.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
