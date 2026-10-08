import React, { useState } from 'react';
import { 
  Users, ShoppingBag, Search, Filter, Star, ShieldCheck, Phone, 
  Share2, MapPin, CheckCircle2, Package, Tag, ArrowRight, ExternalLink,
  SlidersHorizontal, Check, Sparkles, Building2, Wrench, Layers
} from 'lucide-react';
import { 
  ArtisanDirectoryItem, MarketProduct, TradeCategory, Language, 
  CountryCode, CurrencyCode 
} from '../types';
import { getCurrencyMeta, convertFromTnd, formatPrice } from '../data/countryConfig';
import { openWhatsApp } from '../utils/whatsapp';

interface DirectoryMarketplaceTabProps {
  artisans: ArtisanDirectoryItem[];
  products: MarketProduct[];
  lang: Language;
  country: CountryCode;
  currency: CurrencyCode;
  onOpenDevisWithMaterial?: (prod: MarketProduct) => void;
}

export const DirectoryMarketplaceTab: React.FC<DirectoryMarketplaceTabProps> = ({
  artisans,
  products,
  lang,
  country,
  currency,
  onOpenDevisWithMaterial
}) => {
  const [mainView, setMainView] = useState<'directory' | 'marketplace'>('directory');
  
  // Directory Filters
  const [artisanSearch, setArtisanSearch] = useState('');
  const [selectedTrade, setSelectedTrade] = useState<string>('all');
  const [selectedRegion, setSelectedRegion] = useState<string>('all');

  // Marketplace Filters
  const [productSearch, setProductSearch] = useState('');
  const [productCategory, setProductCategory] = useState<string>('all');

  // Selected Artisan for Profile Modal
  const [activeArtisanModal, setActiveArtisanModal] = useState<ArtisanDirectoryItem | null>(null);

  const currMeta = getCurrencyMeta(currency);

  // Filtered Artisans — null-safe: API rows may legitimately have an empty
  // company/bio/region (e.g. imported profiles), and an unguarded
  // `art.bio.toLowerCase()` here previously crashed the WHOLE app (no error
  // boundary existed) → the reported blank screen.
  const filteredArtisans = artisans.filter(art => {
    const q = artisanSearch.toLowerCase();
    const matchSearch = (art.name || '').toLowerCase().includes(q) ||
      (art.company || '').toLowerCase().includes(q) ||
      (art.bio || '').toLowerCase().includes(q);
    const matchTrade = selectedTrade === 'all' || art.trade === selectedTrade || art.secondaryTrades?.includes(selectedTrade as TradeCategory);
    const matchRegion = selectedRegion === 'all' || (art.region || '').toLowerCase().includes(selectedRegion.toLowerCase());
    return matchSearch && matchTrade && matchRegion;
  });

  // Filtered Products — same null-safety for API-fed marketplace rows.
  const filteredProducts = products.filter(prod => {
    const q = productSearch.toLowerCase();
    const matchSearch = (prod.name || '').toLowerCase().includes(q) ||
      (prod.brand || '').toLowerCase().includes(q) ||
      (prod.supplierName || '').toLowerCase().includes(q);
    const matchCat = productCategory === 'all' || prod.category === productCategory;
    return matchSearch && matchCat;
  });

  const handleContactArtisanWhatsApp = (art: ArtisanDirectoryItem) => {
    const text = `Bonjour M. ${art.name} (${art.company}), je vous contacte via KONSTRIVO BTP Pro 2026 pour une demande de devis concernant des travaux de ${art.trade.toUpperCase()}...`;
    openWhatsApp(text);
  };

  const handleOrderProductWhatsApp = (prod: MarketProduct) => {
    const text = `Bonjour ${prod.supplierName}, je souhaite commander ou demander un devis pour le produit:\n` +
      `📦 *${prod.name}*\n` +
      `🏷️ *Marque:* ${prod.brand}\n` +
      `💰 *Prix Référencé:* ${formatPrice(prod.priceTnd, currency, country)} / ${prod.unit}\n` +
      `Quantité minimale: ${prod.minOrderQty} ${prod.unit}\n\n` +
      `_Envoyé via KONSTRIVO Marketplace BTP_`;
    openWhatsApp(text);
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner Navigation & View Toggle */}
      <div className="bg-slate-900 rounded-3xl p-5 sm:p-6 border border-slate-800 shadow-xl space-y-4">
        
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg sm:text-xl font-black text-white flex items-center gap-2">
              {mainView === 'directory' ? <Users className="w-5 h-5 text-amber-400" /> : <ShoppingBag className="w-5 h-5 text-emerald-400" />}
              <span>
                {mainView === 'directory'
                  ? (lang === 'ar' ? 'دليل الحرفيين والشركات المعتمدة 2026' : 'Annuaire des Professionnels & Artisans BTP')
                  : (lang === 'ar' ? 'سوق مواد البناء ومحلات الكنكايري' : 'Marketplace Matériaux & Quincailleries BTP')}
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              {mainView === 'directory'
                ? 'Trouvez des plaquistes, carreleurs, peintres et techniciens vérifiés avec avis clients et tarifs indicatifs.'
                : 'Consultez les catalogues des fournisseurs et quincailleries partenaires aux prix du marché 2026.'}
            </p>
          </div>

          {/* Toggle Directory / Marketplace */}
          <div className="flex bg-slate-950 p-1.5 rounded-2xl border border-slate-800 self-stretch sm:self-auto">
            <button
              onClick={() => setMainView('directory')}
              className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                mainView === 'directory'
                  ? 'bg-amber-500 text-slate-950 font-black shadow-md shadow-amber-500/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Annuaire Artisans ({artisans.length})</span>
            </button>

            <button
              onClick={() => setMainView('marketplace')}
              className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                mainView === 'marketplace'
                  ? 'bg-emerald-500 text-slate-950 font-black shadow-md shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ShoppingBag className="w-4 h-4" />
              <span>Marketplace Matériaux ({products.length})</span>
            </button>
          </div>
        </div>

      </div>

      {/* VIEW 1: ARTISANS DIRECTORY */}
      {mainView === 'directory' && (
        <div className="space-y-6">
          
          {/* Search & Filter Bar */}
          <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={artisanSearch}
                onChange={(e) => setArtisanSearch(e.target.value)}
                placeholder="Rechercher par nom, entreprise, compétence..."
                className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-white"
              />
            </div>

            <div>
              <select
                value={selectedTrade}
                onChange={(e) => setSelectedTrade(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-bold cursor-pointer"
              >
                <option value="all">Tous les corps d'état (12 Métiers)</option>
                <option value="placo">Placo / Plâtre (جبس وأسقف)</option>
                <option value="peinture">Peinture & Déco (دهان)</option>
                <option value="carrelage">Carrelage & Grès (تبليط)</option>
                <option value="plomberie">Plomberie & Sanitaire (سباكة)</option>
                <option value="electricite">Électricité BTP (كهرباء)</option>
                <option value="isolation">Isolation Acoustique & Thermique</option>
              </select>
            </div>

            <div>
              <select
                value={selectedRegion}
                onChange={(e) => setSelectedRegion(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-bold cursor-pointer"
              >
                <option value="all">Toutes les régions / Gouvernorats (24 Gouvernorats)</option>
                <option value="Tunis">Tunis Grand</option>
                <option value="Ariana">Ariana</option>
                <option value="Ben Arous">Ben Arous</option>
                <option value="Manouba">Manouba</option>
                <option value="Nabeul">Nabeul / Cap Bon</option>
                <option value="Bizerte">Bizerte</option>
                <option value="Sousse">Sousse / Sahel</option>
                <option value="Monastir">Monastir</option>
                <option value="Mahdia">Mahdia</option>
                <option value="Sfax">Sfax</option>
                <option value="Kairouan">Kairouan</option>
                <option value="Gabès">Gabès</option>
                <option value="Médenine">Médenine / Djerba</option>
                <option value="Béja">Béja</option>
                <option value="Jendouba">Jendouba</option>
                <option value="Le Kef">Le Kef</option>
                <option value="Siliana">Siliana</option>
                <option value="Kasserine">Kasserine</option>
                <option value="Sidi Bouzid">Sidi Bouzid</option>
                <option value="Gafsa">Gafsa</option>
                <option value="Tozeur">Tozeur</option>
                <option value="Kebili">Kebili</option>
                <option value="Tataouine">Tataouine</option>
                <option value="Zaghouan">Zaghouan</option>
              </select>
            </div>
          </div>

          {/* Artisans Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredArtisans.map(art => (
              <div
                key={art.id}
                className="bg-slate-900 rounded-3xl p-5 border border-slate-800 flex flex-col justify-between space-y-4 hover:border-slate-700 transition-all shadow-xl"
              >
                <div>
                  {/* Header with Avatar, Rating, and Badges */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <img
                        src={art.avatar}
                        alt={art.name}
                        className="w-12 h-12 rounded-2xl object-cover border border-amber-500/30"
                      />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h4 className="text-sm font-black text-white">{art.name}</h4>
                          {art.isVerified && (
                            <ShieldCheck className="w-4 h-4 text-amber-400" title="Vérifié KONSTRIVO" />
                          )}
                        </div>
                        <div className="text-xs text-slate-400 font-medium">{art.company}</div>
                        <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 text-slate-400" />
                          <span>{art.region}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 bg-amber-500/10 px-2 py-1 rounded-xl border border-amber-500/20 text-amber-400 font-bold text-xs">
                      <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                      <span>{art.rating}</span>
                      <span className="text-[10px] text-slate-500">({art.reviewsCount})</span>
                    </div>
                  </div>

                  {/* Bio */}
                  <p className="text-xs text-slate-300 line-clamp-3 mb-3 leading-relaxed">
                    {art.bio}
                  </p>

                  {/* Badges / Certifications */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {art.badges.map((b, i) => (
                      <span
                        key={i}
                        className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-slate-950 text-slate-300 border border-slate-800"
                      >
                        ✓ {b}
                      </span>
                    ))}
                  </div>

                  {/* Indicative Rates */}
                  <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-400">Tarif Pose Estimé :</span>
                    <span className="text-amber-400 font-bold">
                      ~{formatPrice(art.squareMeterRateTnd, currency, country)} / m²
                    </span>
                  </div>
                </div>

                {/* Actions: Call & WhatsApp */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
                  <a
                    href={`tel:${art.phone}`}
                    className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all text-center"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>Appeler</span>
                  </a>

                  <button
                    onClick={() => handleContactArtisanWhatsApp(art)}
                    className="py-2 px-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md shadow-emerald-500/20"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>WhatsApp</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

        </div>
      )}

      {/* VIEW 2: MATERIALS MARKETPLACE */}
      {mainView === 'marketplace' && (
        <div className="space-y-6">
          
          {/* Search & Category Filter */}
          <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Rechercher plaques, profilés, enduits, outillage, marques (Knauf, Astral...)"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-white"
              />
            </div>

            <div>
              <select
                value={productCategory}
                onChange={(e) => setProductCategory(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-bold cursor-pointer"
              >
                <option value="all">Toutes les catégories de matériaux</option>
                <option value="placo">Plaques & Ossature Placo</option>
                <option value="peinture">Peintures & Enduits</option>
                <option value="carrelage">Colles & Carrelages</option>
                <option value="isolation">Isolants Laine Minérale</option>
              </select>
            </div>
          </div>

          {/* Products Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredProducts.map(prod => (
              <div
                key={prod.id}
                className="bg-slate-900 rounded-3xl p-5 border border-slate-800 flex flex-col justify-between space-y-4 hover:border-slate-700 transition-all shadow-xl"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase">
                      {prod.category}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      Stock: <span className="text-emerald-400 font-bold">{prod.stockQty} {prod.unit}</span>
                    </span>
                  </div>

                  <h4 className="text-sm font-black text-white leading-snug mb-1">{prod.name}</h4>
                  <div className="text-xs text-slate-400 font-bold mb-2">Marque: <span className="text-slate-200">{prod.brand}</span></div>

                  <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed mb-3">
                    {prod.specs}
                  </p>

                  <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">Prix Public Conseillé 2026 :</span>
                      <span className="text-base font-black text-amber-400 font-mono">
                        {formatPrice(prod.priceTnd, currency, country)}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 flex justify-between">
                      <span>Unité: {prod.unit}</span>
                      <span>Min. commande: {prod.minOrderQty}</span>
                    </div>
                  </div>

                  <div className="mt-2.5 text-[11px] text-slate-400">
                    🏢 Fournisseur: <span className="text-slate-200 font-bold">{prod.supplierName}</span> ({prod.supplierLocation})
                  </div>
                </div>

                {/* WhatsApp Order Button */}
                <button
                  onClick={() => handleOrderProductWhatsApp(prod)}
                  className="w-full py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-emerald-500/20"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Commander / Demander Devis</span>
                </button>
              </div>
            ))}
          </div>

        </div>
      )}

    </div>
  );
};
