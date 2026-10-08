import React, { useState } from 'react';
import { 
  X, Upload, FileText, CheckCircle2, AlertTriangle, RefreshCw, Layers, 
  DollarSign, ArrowRight, ShieldCheck, Download, Store, TrendingUp, Building2
} from 'lucide-react';
import { MaterialRate, Language, TradeCategory, CountryCode, CurrencyCode } from '../types';
import { getCurrencyMeta, formatPrice } from '../data/countryConfig';

interface SupplierDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  rates: MaterialRate[];
  onApplyCatalog: (updatedRates: MaterialRate[]) => void;
  lang: Language;
  country: CountryCode;
  currency: CurrencyCode;
}

interface ParsedCatalogItem {
  id?: string;
  nameFr: string;
  category: TradeCategory;
  unit: string;
  newPriceTnd: number;
  oldPriceTnd?: number;
  unitPriceTtc?: number;
  matchedRateId?: string;
}

export const SupplierDashboardModal: React.FC<SupplierDashboardModalProps> = ({
  isOpen,
  onClose,
  rates,
  onApplyCatalog,
  lang,
  country,
  currency
}) => {
  const [supplierName, setSupplierName] = useState('Quincaillerie & Comptoir BTP Tunis 2026');
  const [taxMode, setTaxMode] = useState<'ht' | 'ttc'>('ht');
  const [tvaRate, setTvaRate] = useState<number>(19);
  const [parsedItems, setParsedItems] = useState<ParsedCatalogItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const currMeta = getCurrencyMeta(currency);

  // Sample CSV Catalog generator for instant wholesaler testing
  const sampleWholesalerCSV = `Reference,Designation,Categorie,Unite,Prix_HT_TND
PLA-BA13-STD,Plaque de plâtre BA13 Standard 1.2x2.5m,placo,unit,30.500
PLA-BA13-HYD,Plaque de plâtre BA13 Hydrofuge Verte 1.2x2.5m,placo,unit,46.800
PLA-BA13-IGN,Plaque de plâtre BA13 Coupe-Feu Ignifuge Rose,placo,unit,50.500
PLA-AQUA-EXT,Plaque Aquapanel Outdoor Ciment 1.2x2.5m,placo,unit,86.000
OSS-RAIL48,Rail R48 galvanisé ép. 0.6mm - Longueur 3m,placo,unit,7.600
OSS-MONT48,Montant M48 renforcé - Longueur 3m,placo,unit,8.200
OSS-FOURRURE,Fourrure F530 plafond suspendu 3m,placo,unit,7.100
ACC-VIS25,Vis Placo TTPC 25mm (Boîte de 1000 pièces),placo,boite_1000,22.500
END-JOINT25,Enduit à joint pour plaque de plâtre 25kg,placo,sac,43.000
ISOL-VERRE50,Laine de verre avec kraft 50mm (Rouleau 15m²),isolation,rouleau,76.000
DAL-VINYL60,Dalle de plafond démontable vinyle 60x60cm,placo,unit,5.600`;

  const handleDownloadSample = () => {
    const blob = new Blob([sampleWholesalerCSV], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Catalogue_Comptoir_Fournisseur_2026.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const parseFileContent = (content: string) => {
    setIsProcessing(true);
    try {
      const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
      if (lines.length < 2) {
        throw new Error('Fichier vide ou format non reconnu');
      }

      const results: ParsedCatalogItem[] = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const cols = line.split(/[,;\t]/).map(c => c.trim().replace(/^["']|["']$/g, ''));
        
        if (cols.length >= 3) {
          const designation = cols[1] || cols[0];
          const rawPrice = parseFloat(cols[cols.length - 1].replace(',', '.'));
          
          if (!isNaN(rawPrice) && rawPrice > 0) {
            let priceHt = rawPrice;
            let priceTtc = rawPrice;

            if (taxMode === 'ttc') {
              priceHt = +(rawPrice / (1 + tvaRate / 100)).toFixed(3);
              priceTtc = rawPrice;
            } else {
              priceHt = rawPrice;
              priceTtc = +(rawPrice * (1 + tvaRate / 100)).toFixed(3);
            }

            const matchedRate = rates.find(r => {
              const rName = r.nameFr.toLowerCase();
              const dName = designation.toLowerCase();
              return dName.includes(r.id.replace(/_/g, ' ')) || 
                     rName.split(' ').some(w => w.length > 4 && dName.includes(w));
            });

            results.push({
              nameFr: designation,
              category: (cols[2] as TradeCategory) || 'placo',
              unit: cols[3] || 'unit',
              newPriceTnd: priceHt,
              unitPriceTtc: priceTtc,
              matchedRateId: matchedRate?.id,
              oldPriceTnd: matchedRate?.unitPriceTnd
            });
          }
        }
      }

      setParsedItems(results);
      setStatusMessage(`Catalogue grossiste analysé : ${results.length} tarifs synchronisés.`);
    } catch (err: any) {
      setStatusMessage(`Erreur d'analyse : ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      parseFileContent(text);
    };
    reader.readAsText(file);
  };

  const handleApplyToPlatform = () => {
    if (parsedItems.length === 0) return;

    let updatedCount = 0;
    const updatedRates = rates.map(rate => {
      const matched = parsedItems.find(p => p.matchedRateId === rate.id || p.nameFr.toLowerCase().includes(rate.nameFr.toLowerCase()));
      if (matched) {
        updatedCount++;
        return {
          ...rate,
          unitPriceTnd: matched.newPriceTnd,
          note: `Fournisseur: ${supplierName} (${new Date().toLocaleDateString('fr-TN')})`
        };
      }
      return rate;
    });

    onApplyCatalog(updatedRates);
    setStatusMessage(`Succès : ${updatedCount} matériaux mis à jour en direct dans le calculateur.`);
    setTimeout(() => {
      onClose();
    }, 1000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-[#0b0f17] border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-6 text-white">
        
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-amber-950/40 p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-400">
              <Store className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-white flex items-center gap-2">
                Espace Fournisseurs & Quincailleries
                <span className="px-2 py-0.5 text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full font-mono">
                  Mise à jour direct 2026
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Importez vos fichiers de tarifs (CSV/Excel) pour mettre à jour les prix matériaux du calculateur en temps réel
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-5 sm:p-6 space-y-5">
          
          {/* Wholesaler Config Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-950 p-4 rounded-2xl border border-slate-800">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Raison Sociale Fournisseur</label>
              <input
                type="text"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Type de Prix en Entrée</label>
              <div className="grid grid-cols-2 gap-1 bg-slate-900 p-1 rounded-xl border border-slate-700">
                <button
                  type="button"
                  onClick={() => setTaxMode('ht')}
                  className={`py-1 text-xs font-bold rounded-lg transition-all ${taxMode === 'ht' ? 'bg-amber-500 text-slate-950' : 'text-slate-400'}`}
                >
                  Hors Taxes (HT)
                </button>
                <button
                  type="button"
                  onClick={() => setTaxMode('ttc')}
                  className={`py-1 text-xs font-bold rounded-lg transition-all ${taxMode === 'ttc' ? 'bg-amber-500 text-slate-950' : 'text-slate-400'}`}
                >
                  TTC (TVA Inclus)
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Taux TVA Applicable</label>
              <select
                value={tvaRate}
                onChange={(e) => setTvaRate(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-bold"
              >
                <option value={19}>19% (Taux BTP Tunisie)</option>
                <option value={13}>13% (Matériaux)</option>
                <option value={7}>7% (Services)</option>
              </select>
            </div>
          </div>

          {/* File Upload Zone */}
          <div className="border-2 border-dashed border-slate-800 rounded-2xl p-6 text-center bg-slate-950/60 hover:border-amber-400/50 transition-all">
            <Upload className="w-8 h-8 text-amber-400 mx-auto mb-2" />
            <h4 className="text-sm font-bold text-white mb-1">Importer votre fichier de tarifs (Excel / CSV)</h4>
            <p className="text-xs text-slate-400 mb-4">Colonnes requises: Référence, Désignation, Catégorie, Unité, Prix TND</p>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <label className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs cursor-pointer shadow-lg shadow-amber-500/20">
                <span>Parcourir mes fichiers</span>
                <input
                  type="file"
                  accept=".csv,.txt,.tsv"
                  onChange={(e) => e.target.files && e.target.files[0] && handleFileUpload(e.target.files[0])}
                  className="hidden"
                />
              </label>

              <button
                type="button"
                onClick={() => parseFileContent(sampleWholesalerCSV)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-amber-400 border border-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Tester Fichier Démo 2026</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadSample}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800 rounded-xl text-xs font-medium transition-all flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Modèle CSV</span>
              </button>
            </div>
          </div>

          {/* Status Alert */}
          {statusMessage && (
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}

          {/* Parsed Items Preview Table */}
          {parsedItems.length > 0 && (
            <div className="space-y-3">
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-slate-200">Aperçu du catalogue ({parsedItems.length} articles) :</span>
                <span className="text-amber-400 font-mono">TVA {tvaRate}% appliquée</span>
              </div>

              <div className="max-h-56 overflow-y-auto border border-slate-800 rounded-xl bg-slate-950">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900 text-slate-400 sticky top-0 border-b border-slate-800">
                    <tr>
                      <th className="p-2.5">Matériau</th>
                      <th className="p-2.5">Unité</th>
                      <th className="p-2.5 text-right">Ancien Prix HT</th>
                      <th className="p-2.5 text-right text-amber-400">Nouveau HT</th>
                      <th className="p-2.5 text-right text-emerald-400">TTC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850">
                    {parsedItems.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-900/50">
                        <td className="p-2.5 font-medium text-white">{item.nameFr}</td>
                        <td className="p-2.5 text-slate-400">{item.unit}</td>
                        <td className="p-2.5 text-right text-slate-500 font-mono">
                          {item.oldPriceTnd !== undefined ? `${item.oldPriceTnd.toFixed(3)} DT` : '-'}
                        </td>
                        <td className="p-2.5 text-right font-bold text-amber-400 font-mono">
                          {item.newPriceTnd.toFixed(3)} DT
                        </td>
                        <td className="p-2.5 text-right font-semibold text-emerald-400 font-mono">
                          {item.unitPriceTtc?.toFixed(3)} DT
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Format conforme au décret BTP 2026</span>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-bold rounded-xl transition-all"
            >
              Annuler
            </button>
            <button
              onClick={handleApplyToPlatform}
              disabled={parsedItems.length === 0}
              className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black rounded-xl shadow-lg shadow-amber-500/20 disabled:opacity-50 transition-all cursor-pointer flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Mettre à jour le Calculateur</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
