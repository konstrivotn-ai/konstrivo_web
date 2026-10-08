import React, { useState } from 'react';
import { 
  TrendingUp, ArrowUpRight, ArrowDownRight, AlertTriangle, ShieldAlert, 
  Info, Sparkles, RefreshCw, Layers, DollarSign, Calendar, Share2 
} from 'lucide-react';
import { CountryCode, CurrencyCode, Language } from '../types';
import { getCurrencyMeta, formatPrice } from '../data/countryConfig';
import { openWhatsApp } from '../utils/whatsapp';

interface LivePriceIndexWidgetProps {
  lang: Language;
  country: CountryCode;
  currency: CurrencyCode;
  onOpenSupplierDashboard?: () => void;
}

export const LivePriceIndexWidget: React.FC<LivePriceIndexWidgetProps> = ({
  lang,
  country,
  currency,
  onOpenSupplierDashboard
}) => {
  const [activeCategory, setActiveCategory] = useState<'all' | 'placo' | 'acier' | 'enduit' | 'isolation'>('all');
  const [showAlertDetails, setShowAlertDetails] = useState<boolean>(true);

  const currMeta = getCurrencyMeta(currency);

  // 2026 Tunisian Building Material Price Inflation Trends (MoM Data)
  const priceTrends = [
    {
      id: 'ba13_std',
      nameFr: 'Plaque BA13 Standard 1.2x2.5m',
      nameAr: 'صفائح البلاكو العادية BA13',
      category: 'placo',
      currentPriceTnd: 30.500,
      prevMonthPriceTnd: 29.800,
      changePercent: +2.35,
      trend: 'up',
      reasonFr: 'Hausse coût transport du gypse & papier cartonné',
      reasonAr: 'ارتفاع كلفة نقل الجبس والورق المقوى'
    },
    {
      id: 'ba13_hydro',
      nameFr: 'Plaque BA13 Hydrofuge (Verte)',
      nameAr: 'صفائح البلاكو المقاومة للرطوبة (الخضراء)',
      category: 'placo',
      currentPriceTnd: 46.800,
      prevMonthPriceTnd: 45.500,
      changePercent: +2.85,
      trend: 'up',
      reasonFr: 'Tension d\'approvisionnement résines étanches',
      reasonAr: 'ارتفاع كلفة المواد العازلة للماء'
    },
    {
      id: 'rail_48',
      nameFr: 'Rail R48 Galvanisé 3m (Acier)',
      nameAr: 'حديد سكة R48 مجلفن 3م',
      category: 'acier',
      currentPriceTnd: 7.800,
      prevMonthPriceTnd: 7.650,
      changePercent: +1.96,
      trend: 'up',
      reasonFr: 'Ajustement cours de l\'acier galvanisé',
      reasonAr: 'تعديل أسعار الفولاذ المجلفن'
    },
    {
      id: 'fourrure_f530',
      nameFr: 'Fourrure F530 Plafond 3m',
      nameAr: 'فورور F530 للسقف الفوقي 3م',
      category: 'acier',
      currentPriceTnd: 7.200,
      prevMonthPriceTnd: 7.100,
      changePercent: +1.40,
      trend: 'up',
      reasonFr: 'Demande accrue chantiers résidentiels Grand Tunis',
      reasonAr: 'زيادة الطلب في مشاريع تونس الكبرى'
    },
    {
      id: 'enduit_25kg',
      nameFr: 'Enduit à Joint Placo (Sac 25kg)',
      nameAr: 'معجون الفواصل 25 كغ',
      category: 'enduit',
      currentPriceTnd: 43.500,
      prevMonthPriceTnd: 42.000,
      changePercent: +3.57,
      trend: 'up',
      reasonFr: 'Hausse coûts énergétiques de cuisson du plâtre',
      reasonAr: 'ارتفاع تكاليف الطاقة لمعالجة الجبس'
    },
    {
      id: 'vis_placo',
      nameFr: 'Vis Placo TTPC 25mm (Boîte 1000)',
      nameAr: 'علبة براغي البلاكو 1000 قطعة',
      category: 'acier',
      currentPriceTnd: 22.800,
      prevMonthPriceTnd: 22.600,
      changePercent: +0.88,
      trend: 'up',
      reasonFr: 'Stabilité relative des pièces d\'importation',
      reasonAr: 'استقرار نسبى في مستلزمات الربط'
    },
    {
      id: 'laine_verre',
      nameFr: 'Laine de Verre 50mm (15m²)',
      nameAr: 'الصوف الزجاجي العازل 50مم',
      category: 'isolation',
      currentPriceTnd: 76.500,
      prevMonthPriceTnd: 75.000,
      changePercent: +2.00,
      trend: 'up',
      reasonFr: 'Normes d\'isolation thermique DTU 2026',
      reasonAr: 'مطابقة المعايير الحرارية الجديدة'
    }
  ];

  const filteredTrends = priceTrends.filter(t => activeCategory === 'all' || t.category === activeCategory);

  const handleShareIndexWhatsApp = () => {
    const text = `🇹🇳 *INDICE DE VARIATION DES PRIX MATÉRIAUX BTP (TND 2026)*\n` +
      `_Avis aux Artisans, Entrepreneurs & Clients_\n\n` +
      `📈 *Évolution constatée ce mois-ci :*\n` +
      `• Plaque BA13 Standard: +2.4%\n` +
      `• Ossature Métallique (Rails/Fourrures): +1.8%\n` +
      `• Enduit & Joints (Sac 25kg): +3.1%\n` +
      `• Isolation Laine de Verre: +2.0%\n\n` +
      `⚠️ *Conseil Contractuel:* Intégrez une clause de révision des prix dans vos devis BTP avant signature.\n` +
      `Consultez la mercuriale officielle en direct sur KONSTRIVO BTP Pro.`;
    openWhatsApp(text);
  };

  return (
    <div className="bg-[#0b0f17] border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-5">
      
      {/* Widget Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-white flex items-center gap-2">
                <span>Indice des Prix & Mercuriale des Matériaux 2026</span>
                <span className="px-2 py-0.5 text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full font-mono">
                  Direct Quincailleries
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Suivi mensuel de l'inflation des matériaux de construction & plaques de plâtre en Tunisie
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onOpenSupplierDashboard && (
            <button
              onClick={onOpenSupplierDashboard}
              className="px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <DollarSign className="w-3.5 h-3.5" />
              <span>Espace Fournisseur (CSV)</span>
            </button>
          )}

          <button
            onClick={handleShareIndexWhatsApp}
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-md"
            title="Partager l'indice d'inflation via WhatsApp"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Alerte WhatsApp</span>
          </button>
        </div>
      </div>

      {/* Contractor Pre-Contract Signing Alert Banner */}
      {showAlertDetails && (
        <div className="p-4 bg-gradient-to-r from-amber-950/60 via-slate-900 to-amber-950/40 border border-amber-500/40 rounded-2xl flex items-start gap-3 relative">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs text-slate-200">
            <div className="font-bold text-amber-300 flex items-center gap-2">
              <span>⚠️ Note importante pour entrepreneurs & artisans avant signature du contrat :</span>
            </div>
            <p className="leading-relaxed text-slate-300">
              En raison d'une hausse moyenne des matières premières de <strong className="text-amber-400">+2.1% ce mois-ci</strong>, nous recommandons vivement d'insérer une <strong className="underline decoration-amber-400">clause d'ajustement de prix</strong> ou une validité du devis limitée à <strong>15 jours calendaires</strong>.
            </p>
          </div>
          <button
            onClick={() => setShowAlertDetails(false)}
            className="text-slate-500 hover:text-white text-xs ml-auto shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      {/* Category Pills Filter */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {[
          { id: 'all', label: 'Tous les matériaux (+2.1%)' },
          { id: 'placo', label: 'Plaques Placo BA13 (+2.4%)' },
          { id: 'acier', label: 'Ossature & Rails Acier (+1.8%)' },
          { id: 'enduit', label: 'Enduits & Mortiers (+3.1%)' },
          { id: 'isolation', label: 'Isolants Thermiques (+2.0%)' }
        ].map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id as any)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
              activeCategory === cat.id
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Price Inflation Trend Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredTrends.map((item) => (
          <div
            key={item.id}
            className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800/80 hover:border-slate-700 transition-all flex flex-col justify-between space-y-2"
          >
            <div>
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-900 text-slate-400 uppercase font-mono">
                  {item.category}
                </span>
                <span className="text-xs font-black font-mono flex items-center gap-0.5 text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/20">
                  <ArrowUpRight className="w-3.5 h-3.5" />
                  +{item.changePercent}%
                </span>
              </div>

              <h4 className="text-xs font-bold text-white leading-tight">{item.nameFr}</h4>
              <p className="text-[10px] text-slate-500 mt-0.5">{item.nameAr}</p>
            </div>

            <div className="pt-2 border-t border-slate-900 flex items-end justify-between">
              <div>
                <span className="text-[9px] text-slate-500 block uppercase">Prix Quincaillerie :</span>
                <span className="text-xs font-bold font-mono text-emerald-400">
                  {formatPrice(item.currentPriceTnd, currency, country)}
                </span>
              </div>

              <div className="text-right">
                <span className="text-[9px] text-slate-500 block">Mois Précédent :</span>
                <span className="text-[11px] font-mono text-slate-400 line-through">
                  {formatPrice(item.prevMonthPriceTnd, currency, country)}
                </span>
              </div>
            </div>

            <div className="text-[9.5px] text-slate-400 italic bg-slate-900/50 p-1.5 rounded-lg border border-slate-800">
              💡 {item.reasonFr}
            </div>
          </div>
        ))}
      </div>

    </div>
  );
};
