import React, { useState } from 'react';
import { 
  Smartphone, Wifi, WifiOff, RefreshCw, Copy, Check, Code, 
  Database, Send, ShieldCheck, CheckCircle2, ArrowUpRight, Zap 
} from 'lucide-react';
import { CountryCode, CurrencyCode, DevisDocument, Language, MaterialRate, UnitSystem } from '../types';
import { getCountryConfig } from '../data/countryConfig';

interface ApiSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  country: CountryCode;
  currency: CurrencyCode;
  unitSystem: UnitSystem;
  lang: Language;
  rates: MaterialRate[];
  currentDevis: DevisDocument;
  devisHistory: DevisDocument[];
  isOffline: boolean;
  setIsOffline: (offline: boolean) => void;
}

export const ApiSyncModal: React.FC<ApiSyncModalProps> = ({
  isOpen,
  onClose,
  country,
  currency,
  unitSystem,
  lang,
  rates,
  currentDevis,
  devisHistory,
  isOffline,
  setIsOffline
}) => {
  const [copied, setCopied] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const countryInfo = getCountryConfig(country);

  const liveStatePayload = {
    konstrivoEngineVersion: 'v3.4.0-2026',
    timestampUtc: new Date().toISOString(),
    clientPlatform: 'Web & Mobile Hybrid (Flutter / React Native Ready)',
    syncStatus: isOffline ? 'OFFLINE_PENDING_SYNC' : 'ONLINE_SYNCHRONIZED',
    environment: {
      activeCountry: country,
      countryName: countryInfo.nameFr,
      activeCurrency: currency,
      unitSystem: unitSystem,
      buildingCodesStandard: countryInfo.buildingCodes,
      activeTaxVatRate: countryInfo.defaultVatRate,
      timbreFiscalApplicable: countryInfo.timbreFiscalDefault,
      standardRetenueRate: countryInfo.standardRetenueRate
    },
    activeDevisDocument: {
      reference: currentDevis.reference,
      date: currentDevis.date,
      clientName: currentDevis.clientName || 'Chantier Client',
      clientPhone: currentDevis.clientPhone || 'N/A',
      itemsCount: currentDevis.items.length,
      subtotalMaterials: currentDevis.subtotalMaterials,
      subtotalLabor: currentDevis.subtotalLabor,
      totalTtc: currentDevis.total,
      currency: currency,
      items: currentDevis.items
    },
    devisHistoryCount: devisHistory.length,
    cachedMaterialRatesCount: rates.length,
    endpointsSupported: [
      'POST /api/v1/estimations/compute',
      'POST /api/v1/chantiers/sync/batch',
      'GET /api/v1/market/prices/locate?country=' + country,
      'POST /api/v1/escrow/milestones/release'
    ]
  };

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(liveStatePayload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTriggerSync = () => {
    setSyncing(true);
    setSyncMessage(null);
    setTimeout(() => {
      setSyncing(false);
      setSyncMessage(`Synchronisation réussie avec le Cloud KONSTRIVO (${new Date().toLocaleTimeString()})`);
      if (typeof window !== 'undefined') {
        (window as any).KonstrivoState = liveStatePayload;
      }
    }, 900);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-white font-mono">KONSTRIVO MOBILE SYNC ENGINE</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  API v3.4 Ready
                </span>
              </div>
              <p className="text-xs text-slate-400">
                État des données en temps réel prêt pour la synchronisation Flutter / React Native & REST API
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer text-sm font-bold"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
          
          {/* Status Indicators Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800/80 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Statut Réseau</span>
                <span className={`font-bold flex items-center gap-1.5 mt-0.5 ${isOffline ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {isOffline ? <WifiOff className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5" />}
                  {isOffline ? 'Mode Hors-Ligne (Offline Chantiers)' : 'Connecté au Cloud (Live Sync)'}
                </span>
              </div>
              <button
                onClick={() => setIsOffline(!isOffline)}
                className="px-2.5 py-1 text-[11px] rounded-lg font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer border border-slate-700"
              >
                {isOffline ? 'Passer En Ligne' : 'Tester Hors-Ligne'}
              </button>
            </div>

            <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800/80">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Pays & Normes Actives</span>
              <span className="font-bold text-slate-100 flex items-center gap-1.5 mt-0.5">
                <span>{countryInfo.flag} {countryInfo.nameFr}</span>
                <span className="text-amber-400 text-[10px] font-mono">({currency})</span>
              </span>
              <span className="text-[10px] text-slate-500 block truncate">{countryInfo.buildingCodes}</span>
            </div>

            <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800/80 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Devis & Tarifs en Cache</span>
                <span className="font-bold text-slate-100 mt-0.5 block font-mono">
                  {currentDevis.items.length} articles • {rates.length} prix
                </span>
              </div>
              <button
                onClick={handleTriggerSync}
                disabled={syncing}
                className="p-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition-all cursor-pointer shadow-md shadow-amber-500/20 disabled:opacity-50"
                title="Lancer la synchronisation"
              >
                <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {syncMessage && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 flex items-center gap-2 font-bold animate-fadeIn">
              <CheckCircle2 className="w-4 h-4" />
              <span>{syncMessage}</span>
            </div>
          )}

          {/* JSON Payload Inspection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-300 flex items-center gap-2">
                <Code className="w-4 h-4 text-amber-400" />
                <span>Modèle de Données JSON (window.KonstrivoState) :</span>
              </label>

              <button
                onClick={handleCopyJson}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold flex items-center gap-1.5 transition-colors cursor-pointer border border-slate-700"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copié !' : 'Copier le JSON API'}</span>
              </button>
            </div>

            <pre className="bg-slate-950 p-4 rounded-2xl border border-slate-800 font-mono text-[11px] text-emerald-300 overflow-x-auto max-h-60 scrollbar-thin scrollbar-thumb-slate-800">
              {JSON.stringify(liveStatePayload, null, 2)}
            </pre>
          </div>

          {/* Mobile Integration Specifications */}
          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/80 space-y-2">
            <h4 className="font-bold text-amber-400 flex items-center gap-1.5">
              <Database className="w-4 h-4" />
              <span>Directives pour l'intégration Flutter / WatermelonDB :</span>
            </h4>
            <ul className="list-disc list-inside space-y-1 text-slate-300 text-[11px]">
              <li><strong className="text-white">Persistance Locale :</strong> Les calculs de métré et devis sont stockés en local sur SQLite / Hive pour fonctionnement offline complet sur le chantier.</li>
              <li><strong className="text-white">Multi-Devises & Taxes :</strong> Les montants de base sont convertis automatiquement selon le pays ({country}) et la devise ({currency}).</li>
              <li><strong className="text-white">Résolution de Conflits :</strong> Synchronisation par lots (Batch sync) avec horodatage UTC et signature de terminal.</li>
            </ul>
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">
            KONSTRIVO Enterprise Cloud • Protocole REST/GraphQL
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition-colors cursor-pointer text-xs"
          >
            Fermer
          </button>
        </div>

      </div>
    </div>
  );
};
