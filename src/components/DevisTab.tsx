import React, { useState, useRef } from 'react';
import {
  FileText, Share2, Printer, Plus, Trash2, Edit2, Save, Download,
  Check, Phone, User, MapPin, Building, FolderOpen,
  Receipt, Landmark, Globe, Smartphone, AlertTriangle
} from 'lucide-react';
import { CountryCode, CurrencyCode, DevisDocument, DevisItem, Language, RegionTunisia, UnitSystem } from '../types';
import { formatDevisForWhatsApp, openWhatsApp } from '../utils/whatsapp';
import { getCountryConfig, getCurrencyMeta, convertFromTnd, formatPrice } from '../data/countryConfig';
import { toIsoDate, isDefaultCompanyName, DEFAULT_COMPANY_NAME, DEFAULT_COMPANY_PHONE, DEFAULT_COMPANY_MATRICULE } from '../utils/devisFields';
import { buildDevisPrintHtml, type DevisForPrint } from '../utils/devisPrint';
import { trackFeatureUsage } from '../utils/featureUsage';
import { FeatureGate } from './FeatureGate';

/** ISO (YYYY-MM-DD) → professional DD/MM/YYYY display (same format as the A4 PDF). */
const formatDdMmYyyy = (iso: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso;

/** DevisTab - Devis management tab. */

interface DevisTabProps {
  devis: DevisDocument;
  setDevis: React.Dispatch<React.SetStateAction<DevisDocument>>;
  devisHistory: DevisDocument[];
  onNewDevis: () => void;
  onSaveDevisHistory: (devis: DevisDocument) => void;
  onLoadFromHistory: (devis: DevisDocument) => void;
  onDeleteFromHistory: (id: string) => void;
  lang: Language;
  region: RegionTunisia;
  country: CountryCode;
  currency: CurrencyCode;
  unitSystem: UnitSystem;
}

export const DevisTab: React.FC<DevisTabProps> = ({
  devis,
  setDevis,
  devisHistory,
  onNewDevis,
  onSaveDevisHistory,
  onLoadFromHistory,
  onDeleteFromHistory,
  lang,
  region,
  country,
  currency,
  unitSystem
}) => {
  const [newItemTitle, setNewItemTitle] = useState('');
  const [newItemQty, setNewItemQty] = useState(1);
  const [newItemUnit, setNewItemUnit] = useState('u');
  const [newItemPrice, setNewItemPrice] = useState(0);
  const [includeTimbre, setIncludeTimbre] = useState(country === 'TN' || country === 'DZ');
  const [retenueGarantiePercent, setRetenueGarantiePercent] = useState(0);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const countryInfo = getCountryConfig(country);
  const currMeta = getCurrencyMeta(currency);

  // Devis date normalized to YYYY-MM-DD for the native date input (existing logic).
  const devisDateIso = toIsoDate(devis.date);

  // Recalculate totals
  const isLaborTitle = (title: string) => {
    const t = title.toLowerCase();
    return (
      t.includes("main d'\u0153uvre") ||
      t.includes("main d'oeuvre") ||
      t.includes("khidma") ||
      t.includes("labor")
    );
  };
  const subtotalMaterials = devis.items
    .filter(i => !isLaborTitle(i.title || ''))
    .reduce((acc, item) => acc + (item.totalConverted || item.totalTnd || 0), 0);

  const subtotalLabor = devis.items
    .filter(i => isLaborTitle(i.title || ''))
    .reduce((acc, item) => acc + (item.totalConverted || item.totalTnd || 0), 0);

  const rawSubtotal = devis.items.reduce((acc, item) => acc + (item.totalConverted ?? item.totalTnd ?? item.total ?? 0), 0);
  const discountAmount = devis.discount || devis.discountTnd || 0;
  const netHtSubtotal = Math.max(0, rawSubtotal - discountAmount);
  
  const activeTvaPercent = devis.tvaPercent ?? countryInfo.defaultVatRate;
  const tvaAmount = activeTvaPercent > 0 ? (netHtSubtotal * activeTvaPercent) / 100 : 0;
  
  const timbreAmount = includeTimbre ? countryInfo.timbreFiscalDefault : 0;
  const totalTtc = netHtSubtotal + tvaAmount + timbreAmount;
  const retenueAmount = (netHtSubtotal * retenueGarantiePercent) / 100;
  const netAPayer = totalTtc - retenueAmount;

  // Update Devis Object
  const handleUpdateField = (field: keyof DevisDocument, value: any) => {
    setDevis(prev => ({
      ...prev,
      [field]: value,
      total: field === 'discount' || field === 'tvaPercent' ? totalTtc : prev.total,
      currency: currency
    }));
  };

  const handleAddItem = () => {
    if (!newItemTitle) return;
    const newItem: DevisItem = {
      id: `custom-${Date.now()}`,
      trade: 'placo',
      title: newItemTitle,
      quantity: newItemQty,
      unit: newItemUnit,
      unitPrice: newItemPrice,
      total: newItemQty * newItemPrice,
      unitPriceTnd: newItemPrice,
      totalTnd: newItemQty * newItemPrice,
      unitPriceConverted: newItemPrice,
      totalConverted: newItemQty * newItemPrice,
      details: 'Fourniture & pose selon cahier des charges'
    };
    setDevis(prev => ({
      ...prev,
      items: [...prev.items, newItem]
    }));
    setNewItemTitle('');
    setNewItemQty(1);
    setNewItemPrice(0);
  };

  const handleRemoveItem = (id: string) => {
    setDevis(prev => ({
      ...prev,
      items: prev.items.filter(i => i.id !== id)
    }));
  };

  const printRef = useRef<HTMLDivElement | null>(null);

  const handleSaveToHistory = () => {
    onSaveDevisHistory(devis);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
  };

  const handleShareWhatsApp = () => {
    const msg = formatDevisForWhatsApp(devis, lang);
    openWhatsApp(msg, devis.clientPhone);
  };

  const handlePrintPdf = () => {
    const totals = {
      subtotalMaterials,
      subtotalLabor,
      discount: discountAmount,
      netHt: netHtSubtotal,
      tvaPercent: activeTvaPercent,
      tvaAmount,
      timbreAmount,
      totalTtc,
      retenueAmount,
      netAPayer,
    };
    const html = buildDevisPrintHtml({
      devis: devis as DevisForPrint,
      totals,
      currencySymbol: currMeta.symbol,
      decimals: currMeta.decimals,
      countryName: countryInfo.nameFr,
      buildingCodes: countryInfo.buildingCodes,
      timbreLabel: countryInfo.timbreLabel,
      includeTimbre,
      retenueGarantiePercent,
    });
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
      // Phase 1 Feature Usage Analytics — the PDF export succeeded; fire-and-forget.
      trackFeatureUsage('devis:export_pdf');
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Action Ribbon */}
      <div className="bg-[#131b2e] rounded-2xl p-4 sm:p-5 border border-[#1e293b] shadow-xl flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-black text-white">
              {lang === 'ar' ? 'إدارة التقارير والـ Devis الرسمي' : 'Générateur de Devis & Factures Pro'}
            </h2>
            <p className="text-xs text-slate-400">
              {lang === 'ar' ? 'طباعة Devis مهني على ورق A4' : 'Formatage A4 aux normes BTP'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={onNewDevis} className="px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black rounded-xl flex items-center gap-1.5 cursor-pointer">
            <Plus className="w-4 h-4" />
            <span>Nouveau Devis</span>
          </button>
          <button onClick={() => setShowHistoryModal(true)} className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-bold rounded-xl border border-slate-700 flex items-center gap-1.5 cursor-pointer">
            <FolderOpen className="w-4 h-4 text-amber-400" />
            <span>Historique ({devisHistory.length})</span>
          </button>
          <button onClick={handleSaveToHistory} className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-bold rounded-xl border border-slate-700 flex items-center gap-1.5 cursor-pointer">
            {savedSuccess ? <Check className="w-4 h-4 text-emerald-400" /> : <Save className="w-4 h-4 text-amber-400" />}
            <span>{savedSuccess ? 'Enregistré !' : 'Sauvegarder'}</span>
          </button>
          <button onClick={handleShareWhatsApp} className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black rounded-xl flex items-center gap-1.5 cursor-pointer">
            <Share2 className="w-4 h-4" />
            <span>WhatsApp</span>
          </button>
          {/* Phase 1 — the gate is data-driven from GET /api/v1/features.
              P3: the backend now really applies the entitlement matrix
              (freeAccess/proAccess/scope/usageLimit); FREE keeps access to
              every feature the admin marks freeAccess=true. */}
          <FeatureGate feature="devis:export_pdf">
            <button onClick={handlePrintPdf} className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black rounded-xl flex items-center gap-1.5 cursor-pointer">
              <Printer className="w-4 h-4" />
              <span>PDF A4</span>
            </button>
          </FeatureGate>
        </div>
      </div>

      {/* Document Canvas */}
      <div ref={printRef} className="bg-[#131b2e] print:bg-white rounded-3xl p-6 sm:p-10 border border-[#1e293b] print:border-none shadow-2xl space-y-8 text-white print:text-black">
        <div className="flex flex-col sm:flex-row justify-between items-start gap-6 border-b border-slate-800 print:border-slate-300 pb-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={isDefaultCompanyName(devis.companyName) ? '' : (devis.companyName || '')}
                placeholder={DEFAULT_COMPANY_NAME}
                onChange={(e) => handleUpdateField('companyName', e.target.value)}
                className="bg-transparent text-xl sm:text-2xl font-black font-mono text-white print:text-black placeholder:text-slate-600 focus:outline-none w-full"
              />
            </div>
            <div className="text-xs text-slate-400 print:text-slate-600 space-y-0.5">
              <p className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 shrink-0 text-amber-400 print:text-slate-600" />
                <input
                  type="text"
                  value={devis.companyAddress || ''}
                  placeholder={`Tunis - Région ${region}`}
                  onChange={(e) => handleUpdateField('companyAddress', e.target.value)}
                  className="bg-transparent text-white print:text-black placeholder:text-slate-500 focus:outline-none w-full"
                />
                <span className="shrink-0">• {countryInfo.nameFr}</span>
              </p>
              <p className="flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 shrink-0 text-amber-400 print:text-slate-600" />
                <span className="shrink-0">Tél : </span>
                <input
                  type="text"
                  value={devis.companyPhone || ''}
                  placeholder={DEFAULT_COMPANY_PHONE}
                  onChange={(e) => handleUpdateField('companyPhone', e.target.value)}
                  className="bg-transparent text-white print:text-black placeholder:text-slate-500 focus:outline-none w-full"
                />
              </p>
              <p className="flex items-center gap-1.5">
                <Landmark className="w-3.5 h-3.5 shrink-0 text-amber-400 print:text-slate-600" />
                <span className="shrink-0">R.C : </span>
                <input
                  type="text"
                  value={devis.companyMatricule || ''}
                  placeholder={DEFAULT_COMPANY_MATRICULE}
                  onChange={(e) => handleUpdateField('companyMatricule', e.target.value)}
                  className="bg-transparent text-white print:text-black placeholder:text-slate-500 focus:outline-none w-full"
                />
              </p>
            </div>
          </div>
          <div className="text-right space-y-1">
            <div className="text-xs font-bold text-slate-400 print:text-slate-600">DEVIS ESTIMATIF</div>
            <div className="text-sm font-mono font-bold text-amber-400 print:text-slate-800">
              <span>Réf : </span>
              <input type="text" value={devis.reference || (devis as any).devisNumber || ''} onChange={(e) => handleUpdateField('reference', e.target.value)} className="bg-transparent text-right font-mono font-bold text-white print:text-black focus:outline-none w-32" />
            </div>
            <div className="text-sm font-mono text-slate-300 print:text-slate-600">
              <span>Date : </span>
              <span className="relative inline-block">
                <input
                  type="date"
                  value={devisDateIso}
                  onChange={(e) => handleUpdateField('date', e.target.value)}
                  className={`bg-transparent font-mono focus:outline-none cursor-pointer ${devisDateIso ? 'text-transparent' : 'text-white print:text-black'}`}
                />
                {/* Professional DD/MM/YYYY display — overlays the native input so the
                    browser-locale format / jj/mm-aaaa placeholder never shows while a
                    valid date exists. Date logic & picker behaviour unchanged. */}
                {devisDateIso && (
                  <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 flex items-center font-mono text-white print:text-black">
                    {formatDdMmYyyy(devisDateIso)}
                  </span>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Client Info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-slate-950 print:bg-slate-100 p-4 rounded-2xl border border-slate-800 print:border-slate-300 space-y-2">
            <h4 className="text-xs font-bold text-amber-400 print:text-slate-600 uppercase">Client</h4>
            <input type="text" placeholder="Nom du Client" value={devis.clientName} onChange={(e) => handleUpdateField('clientName', e.target.value)} className="w-full bg-slate-900 print:bg-white border border-slate-800 print:border-slate-300 rounded-lg px-2.5 py-1.5 text-white print:text-black font-bold focus:outline-none" />
            <input type="text" placeholder="Téléphone / WhatsApp" value={devis.clientPhone} onChange={(e) => handleUpdateField('clientPhone', e.target.value)} className="w-full bg-slate-900 print:bg-white border border-slate-800 print:border-slate-300 rounded-lg px-2.5 py-1.5 text-white print:text-black font-mono focus:outline-none" />
            <input type="text" placeholder="Adresse du Chantier" value={devis.clientAddress} onChange={(e) => handleUpdateField('clientAddress', e.target.value)} className="w-full bg-slate-900 print:bg-white border border-slate-800 print:border-slate-300 rounded-lg px-2.5 py-1.5 text-white print:text-black focus:outline-none" />
          </div>
          <div className="bg-slate-950 print:bg-slate-100 p-4 rounded-2xl border border-slate-800 print:border-slate-300 space-y-2">
            <h4 className="text-xs font-bold text-amber-400 print:text-slate-600 uppercase">Projet</h4>
            <input type="text" placeholder="Intitulé du Projet" value={devis.projectTitle} onChange={(e) => handleUpdateField('projectTitle', e.target.value)} className="w-full bg-slate-900 print:bg-white border border-slate-800 print:border-slate-300 rounded-lg px-2.5 py-1.5 text-white print:text-black font-bold focus:outline-none" />
            <div className="text-xs text-slate-400 print:text-slate-600 font-mono">{devis.region || region} • {countryInfo.nameFr}</div>
          </div>
        </div>

        {/* Items Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-950 print:bg-slate-200 border-b border-slate-800 print:border-slate-400">
                <th className="text-left p-2.5 font-bold text-amber-400 print:text-slate-700">Désignation</th>
                <th className="text-center p-2.5 font-bold text-amber-400 print:text-slate-700 w-16">Qté</th>
                <th className="text-center p-2.5 font-bold text-amber-400 print:text-slate-700 w-16">Unité</th>
                <th className="text-right p-2.5 font-bold text-amber-400 print:text-slate-700 w-24">P.U</th>
                <th className="text-right p-2.5 font-bold text-amber-400 print:text-slate-700 w-28">Total</th>
                <th className="text-center p-2.5 font-bold text-amber-400 print:text-slate-700 w-10 print:hidden"></th>
              </tr>
            </thead>
            <tbody>
              {devis.items.map((item) => (
                <tr key={item.id} className="border-b border-slate-800/50 print:border-slate-200">
                  <td className="p-2.5"><input type="text" value={item.title} onChange={(e) => { const newItems = devis.items.map(i => i.id === item.id ? { ...i, title: e.target.value } : i); setDevis(prev => ({ ...prev, items: newItems })); }} className="w-full bg-transparent text-white print:text-black focus:outline-none font-bold" /></td>
                  <td className="p-2.5 text-center"><input type="number" value={item.quantity} onChange={(e) => { const qty = parseFloat(e.target.value) || 0; const newItems = devis.items.map(i => i.id === item.id ? { ...i, quantity: qty, total: qty * i.unitPrice, totalTnd: qty * i.unitPriceTnd, totalConverted: qty * i.unitPriceConverted } : i); setDevis(prev => ({ ...prev, items: newItems })); }} className="w-full bg-transparent text-center text-white print:text-black focus:outline-none font-mono" /></td>
                  <td className="p-2.5 text-center text-slate-400 print:text-slate-600">{item.unit}</td>
                  <td className="p-2.5 text-right"><input type="number" value={item.unitPrice} onChange={(e) => { const price = parseFloat(e.target.value) || 0; const newItems = devis.items.map(i => i.id === item.id ? { ...i, unitPrice: price, total: item.quantity * price, totalTnd: item.quantity * price, totalConverted: item.quantity * price } : i); setDevis(prev => ({ ...prev, items: newItems })); }} className="w-full bg-transparent text-right text-amber-400 print:text-slate-800 focus:outline-none font-mono font-bold" /></td>
                  <td className="p-2.5 text-right font-mono text-white print:text-black">{formatPrice(item.totalConverted || item.totalTnd || item.total || 0, currency, country)}</td>
                  <td className="p-2.5 text-center print:hidden"><button onClick={() => handleRemoveItem(item.id)} className="text-red-400 hover:text-red-300 cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button></td>
                </tr>
              ))}
              {devis.items.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-slate-500 print:text-slate-400">Aucune ligne dans le devis. Utilisez la Calculatrice pour insérer les résultats.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Totals Section */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Left: Conditions / Notes */}
          <div className="bg-slate-950 print:bg-slate-100 p-4 rounded-2xl border border-slate-800 print:border-slate-300 space-y-2">
            <h4 className="text-xs font-bold text-amber-400 print:text-slate-600 uppercase">Conditions & Notes</h4>
            <textarea
              placeholder="Conditions de règlement, notes..."
              value={devis.notes || ''}
              onChange={(e) => handleUpdateField('notes', e.target.value)}
              className="w-full bg-slate-900 print:bg-white border border-slate-800 print:border-slate-300 rounded-lg px-2.5 py-1.5 text-white print:text-black text-xs focus:outline-none min-h-[80px]"
            />
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-slate-400">Retenue de Garantie :</label>
              <select
                value={retenueGarantiePercent}
                onChange={(e) => setRetenueGarantiePercent(Number(e.target.value))}
                className="bg-slate-900 print:bg-white border border-slate-800 print:border-slate-300 rounded-lg px-2 py-1 text-white print:text-black text-xs focus:outline-none"
              >
                <option value={0}>0%</option>
                <option value={5}>5%</option>
                <option value={10}>10%</option>
              </select>
            </div>
          </div>

          {/* Right: Totals */}
          <div className="bg-slate-950 print:bg-slate-100 p-4 rounded-2xl border border-slate-800 print:border-slate-300">
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Sous-total Fournitures (Matériaux) :</span>
                <span className="font-mono text-white print:text-black">{formatPrice(subtotalMaterials, currency, country)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Sous-total Main d'œuvre (Chantier) :</span>
                <span className="font-mono text-white print:text-black">{formatPrice(subtotalLabor, currency, country)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-amber-400">
                  <span>Remise / Rabais :</span>
                  <span className="font-mono">-{formatPrice(discountAmount, currency, country)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold pt-1 border-t border-slate-800 print:border-slate-300">
                <span className="text-slate-300">TOTAL NET H.T :</span>
                <span className="font-mono text-white print:text-black">{formatPrice(netHtSubtotal, currency, country)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">TVA ({activeTvaPercent}%) :</span>
                <span className="font-mono text-white print:text-black">{formatPrice(tvaAmount, currency, country)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Timbre Fiscal :</span>
                <span className="font-mono text-white print:text-black">{formatPrice(timbreAmount, currency, country)}</span>
              </div>
              {retenueGarantiePercent > 0 && (
                <>
                  <div className="flex justify-between text-rose-400">
                    <span>Retenue de Garantie ({retenueGarantiePercent}%) :</span>
                    <span className="font-mono">-{formatPrice(retenueAmount, currency, country)}</span>
                  </div>
                  <div className="flex justify-between font-black pt-1 border-t border-slate-800 print:border-slate-300 text-emerald-400">
                    <span>NET À PAYER (APRÈS RETENUE) :</span>
                    <span className="font-mono text-sm">{formatPrice(netAPayer, currency, country)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between font-black pt-1 border-t border-slate-800 print:border-slate-300 text-amber-400 text-sm">
                <span>TOTAL GÉNÉRAL TTC :</span>
                <span className="font-mono">{formatPrice(totalTtc, currency, country)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Signature Section */}
        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-800 print:border-slate-300">
          <div className="border border-slate-700 print:border-slate-400 rounded-xl p-4 min-h-[80px]">
            <p className="text-[10px] text-slate-500 print:text-slate-600 text-center">Cachet & Signature de l'Entreprise</p>
          </div>
          <div className="border border-slate-700 print:border-slate-400 rounded-xl p-4 min-h-[80px]">
            <p className="text-[10px] text-slate-500 print:text-slate-600 text-center">Signature du Client / Maître d'Ouvrage</p>
          </div>
        </div>
      </div>

      {/* History Modal */}
      {showHistoryModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#131b2e] rounded-3xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto border border-slate-700">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-black text-white">Historique des Devis</h3>
              <button onClick={() => setShowHistoryModal(false)} className="text-slate-400 hover:text-white"><span className="text-2xl">&times;</span></button>
            </div>
            <div className="space-y-2">
              {devisHistory.length === 0 && <p className="text-slate-400 text-sm">Aucun devis sauvegardé.</p>}
              {devisHistory.map((h, idx) => (
                <div key={h.id || idx} className="bg-slate-900 p-3 rounded-xl flex justify-between items-center">
                  <div><div className="text-sm font-bold text-white">{h.projectTitle || 'Sans titre'}</div><div className="text-xs text-slate-400">{h.clientName} • {h.date}</div></div>
                  <div className="flex gap-2">
                    <button onClick={() => { onLoadFromHistory(h); setShowHistoryModal(false); }} className="px-3 py-1 bg-amber-500 text-slate-950 text-xs font-bold rounded-lg cursor-pointer">Charger</button>
                    <button onClick={() => onDeleteFromHistory(h.id)} className="px-3 py-1 bg-red-500/20 text-red-400 text-xs font-bold rounded-lg cursor-pointer">Supprimer</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};