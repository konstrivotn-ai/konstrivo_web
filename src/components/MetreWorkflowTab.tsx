// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import { Layers, RefreshCw, AlertCircle } from 'lucide-react';
import type { ChantierProject, Language, CountryCode, CurrencyCode, MaterialRate } from '../types';
import { elementsForTrade, loadMetreElementsForTrade } from '../data/metreElements';
import type { MetreElementDef } from '../data/metreElements';
import { evaluateElement, aggregateQuantities } from '../utils/metreEngine';
import { computeMetreBoundOutputs } from '../utils/metreToCalculationResult';
import { metreApi } from '../lib/metreApi';

export const MetreWorkflowTab: React.FC<{
  projects: ChantierProject[];
  rates: MaterialRate[];
  trades: any[];
  lang: Language;
  country: CountryCode;
  currency: CurrencyCode;
}> = ({ projects, rates, trades }) => {
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const project = useMemo(() => projects.find((p: any) => p.id === selectedProjectId) || null, [projects, selectedProjectId]);

  const [zones, setZones] = useState<any[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string>('');
  const [zoneName, setZoneName] = useState('');

  const [ouvrages, setOuvrages] = useState<any[]>([]);
  const [selectedOuvrageId, setSelectedOuvrageId] = useState<string>('');
  const [ouvrageTitle, setOuvrageTitle] = useState('');
  const [ouvrageTradeCode, setOuvrageTradeCode] = useState('');
  const [ouvrageElementCode, setOuvrageElementCode] = useState('');

  const [releves, setReleves] = useState<any[]>([]);
  const [selectedReleveId, setSelectedReleveId] = useState<string>('');
  const [lines, setLines] = useState<any[]>([]);

  const [metreElements, setMetreElements] = useState<MetreElementDef[]>([]);
  const [metreDims, setMetreDims] = useState<Record<string, string>>({});

  const [error, setError] = useState<string | null>(null);

  const selectedOuvrage = useMemo(() => ouvrages.find((o: any) => o.id === selectedOuvrageId) || null, [ouvrages, selectedOuvrageId]);
  const activeElement = useMemo(() => {
    if (!selectedOuvrage) return null;
    return metreElements.find((e) => e.code === selectedOuvrage.metreElementCode) || null;
  }, [metreElements, selectedOuvrage]);

  const preview = useMemo(() => {
    if (!activeElement) return null;
    return evaluateElement(activeElement, metreDims);
  }, [activeElement, metreDims]);

  async function reloadAll() {
    setError(null);
    if (!selectedProjectId) return;
    try {
      const z = await metreApi.listZones(selectedProjectId);
      setZones(z || []);
      const o = await metreApi.listOuvrages(selectedProjectId, selectedZoneId || undefined);
      setOuvrages(o || []);
    } catch (e: any) {
      setError(e?.message || 'Load failed');
    }
  }

  useEffect(() => { void reloadAll(); }, [selectedProjectId, selectedZoneId]);

  useEffect(() => {
    async function loadForOuvrage() {
      if (!selectedOuvrage) { setMetreElements([]); setMetreDims({}); return; }
      const tradeObj = trades.find((t: any) => t.code === selectedOuvrage.tradeCode);
      const els = await loadMetreElementsForTrade(tradeObj?.id, selectedOuvrage.tradeCode);
      const registry = els.length ? els : elementsForTrade(selectedOuvrage.tradeCode);
      setMetreElements(registry);
      const def = registry.find((e) => e.code === selectedOuvrage.metreElementCode) as any;
      const init: any = {};
      for (const d of def?.dims || []) init[d.key] = d.default != null ? String(d.default) : '';
      setMetreDims(init);
      const r = await metreApi.listReleves(selectedOuvrage.id);
      setReleves(r || []);
      setSelectedReleveId('');
      setLines([]);
    }
    void loadForOuvrage();
  }, [selectedOuvrageId]);

  const totals = useMemo(() => {
    return aggregateQuantities(lines.map((l: any) => ({ qty: Number(l?.qty ?? 0), unit: String(l?.unit ?? '') })).filter((x: any) => x.unit));
  }, [lines]);

  const bound = useMemo(() => {
    if (!activeElement) return null;
    return computeMetreBoundOutputs({
      metreElement: activeElement,
      metreDims,
      metreLines: lines.map((l: any) => ({ qty: Number(l.qty), unit: String(l.unit) })),
      rates,
    });
  }, [activeElement, metreDims, lines, rates]);

  async function createZone() {
    if (!selectedProjectId || !zoneName.trim()) return;
    try {
      await metreApi.createZone(selectedProjectId, { name: zoneName.trim() });
      setZoneName('');
      await reloadAll();
    } catch (e: any) { setError(e?.message || 'Create zone failed'); }
  }

  async function createOuvrage() {
    if (!selectedProjectId || !ouvrageTitle.trim() || !ouvrageTradeCode || !ouvrageElementCode) return;
    try {
      await metreApi.createOuvrage(selectedProjectId, {
        zoneId: selectedZoneId || null,
        title: ouvrageTitle.trim(),
        tradeCode: ouvrageTradeCode,
        metreElementCode: ouvrageElementCode,
        specVersion: 1,
      });
      setOuvrageTitle('');
      await reloadAll();
    } catch (e: any) { setError(e?.message || 'Create ouvrage failed'); }
  }

  async function createReleve() {
    if (!selectedOuvrageId) return;
    try {
      const r = await metreApi.createReleve(selectedOuvrageId, { projectId: selectedProjectId, zoneId: selectedZoneId || null, status: 'draft', specVersion: 1 });
      const list = await metreApi.listReleves(selectedOuvrageId);
      setReleves(list || []);
      setSelectedReleveId(r?.id || '');
      setLines([]);
    } catch (e: any) { setError(e?.message || 'Create releve failed'); }
  }

  async function loadLines(releveId: string) {
    try {
      const l = await metreApi.listLines(releveId);
      setLines(l || []);
    } catch (e: any) { setError(e?.message || 'Load lines failed'); }
  }

  async function addLine() {
    if (!selectedReleveId || !activeElement || !preview?.ok) return;
    try {
      await metreApi.addLine(selectedReleveId, { lineNo: lines.length, dims: metreDims });
      await loadLines(selectedReleveId);
    } catch (e: any) { setError(e?.message || 'Add line failed'); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Layers className="w-4 h-4 text-amber-400" />
        <div className="text-sm font-black text-white">Métré Pro (Workflow)</div>
      </div>

      {error && (
        <div className="text-xs text-rose-300 bg-rose-950/30 border border-rose-500/30 rounded-xl px-3 py-2 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 space-y-2">
          <div className="text-xs font-bold text-slate-200">1) Projet</div>
          <select className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2 py-2 text-xs text-white" value={selectedProjectId} onChange={(e) => { setSelectedProjectId(e.target.value); setSelectedZoneId(''); setSelectedOuvrageId(''); }}>
            <option value="">— Choisir —</option>
            {(projects || []).map((p: any) => (<option key={p.id} value={p.id}>{p.title || p.name || p.id}</option>))}
          </select>

          <div className="text-xs font-bold text-slate-200 mt-2">2) Zone</div>
          <select className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2 py-2 text-xs text-white" value={selectedZoneId} onChange={(e) => { setSelectedZoneId(e.target.value); setSelectedOuvrageId(''); }} disabled={!selectedProjectId}>
            <option value="">(Sans zone)</option>
            {zones.map((z: any) => (<option key={z.id} value={z.id}>{z.name}</option>))}
          </select>
          <div className="flex gap-2">
            <input className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-2 py-2 text-xs text-white" value={zoneName} onChange={(e) => setZoneName(e.target.value)} placeholder="Nouvelle zone…" />
            <button className="px-3 py-2 rounded-xl bg-amber-400 text-slate-950 text-xs font-black" onClick={() => void createZone()} disabled={!selectedProjectId}>+</button>
          </div>

          <button className="px-3 py-2 rounded-xl border border-slate-700 text-xs text-white flex items-center gap-2" onClick={() => void reloadAll()} disabled={!selectedProjectId}>
            <RefreshCw className="w-4 h-4" /> Actualiser
          </button>
        </div>

        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 space-y-2">
          <div className="text-xs font-bold text-slate-200">3) Ouvrage</div>
          <select className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2 py-2 text-xs text-white" value={selectedOuvrageId} onChange={(e) => { setSelectedOuvrageId(e.target.value); }} disabled={!selectedProjectId}>
            <option value="">— Choisir —</option>
            {ouvrages.map((o: any) => (<option key={o.id} value={o.id}>{o.title} ({o.tradeCode}/{o.metreElementCode})</option>))}
          </select>

          <div className="text-xs font-bold text-slate-200 mt-2">Créer un ouvrage</div>
          <input className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2 py-2 text-xs text-white" value={ouvrageTitle} onChange={(e) => setOuvrageTitle(e.target.value)} placeholder="Titre ouvrage" />
          <select className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2 py-2 text-xs text-white" value={ouvrageTradeCode} onChange={(e) => { setOuvrageTradeCode(e.target.value); setOuvrageElementCode(''); }}>
            <option value="">— Métier —</option>
            {(trades || []).map((t: any) => (<option key={t.code} value={t.code}>{t.labelFr || t.code}</option>))}
          </select>
          <select className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2 py-2 text-xs text-white" value={ouvrageElementCode} onChange={(e) => setOuvrageElementCode(e.target.value)} disabled={!ouvrageTradeCode}>
            <option value="">— Élément de métré —</option>
            {elementsForTrade(ouvrageTradeCode).map((el: any) => (<option key={el.code} value={el.code}>{el.labelFr} ({el.unit})</option>))}
          </select>
          <button className="px-3 py-2 rounded-xl bg-emerald-500 text-slate-950 text-xs font-black" onClick={() => void createOuvrage()} disabled={!selectedProjectId}>Créer</button>
        </div>

        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 space-y-2">
          <div className="text-xs font-bold text-slate-200">4) Relevé</div>
          <div className="flex gap-2">
            <button className="px-3 py-2 rounded-xl bg-sky-500 text-slate-950 text-xs font-black" onClick={() => void createReleve()} disabled={!selectedOuvrageId}>Nouveau relevé</button>
            <select className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-2 py-2 text-xs text-white" value={selectedReleveId} onChange={(e) => { setSelectedReleveId(e.target.value); void loadLines(e.target.value); }} disabled={!selectedOuvrageId}>
              <option value="">— Choisir —</option>
              {releves.map((r: any) => (<option key={r.id} value={r.id}>{r.id.slice(0, 8)}… ({r.status})</option>))}
            </select>
          </div>

          <div className="text-xs font-bold text-slate-200 mt-2">5) Mesures</div>
          {!activeElement && <div className="text-xs text-slate-400">Choisir un ouvrage pour charger les dimensions.</div>}
          {activeElement && (
            <div className="space-y-2">
              {activeElement.dims.map((d: any) => (
                <div key={d.key} className="flex items-center gap-2">
                  <div className="w-28 text-[11px] text-slate-300 font-bold">{d.labelFr}</div>
                  <input className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-2 py-2 text-xs text-white" value={metreDims[d.key] || ''} onChange={(e) => setMetreDims((p) => ({ ...p, [d.key]: e.target.value }))} />
                  <div className="w-10 text-[11px] text-slate-500 font-mono">{d.unit}</div>
                </div>
              ))}
              <div className="text-xs text-slate-400">Formule: <span className="font-mono">{activeElement.qtyFormula}</span></div>
              <div className="text-xs text-white">Aperçu: {preview?.ok ? <span className="font-black text-emerald-400">{preview.qty} {preview.unit}</span> : <span className="text-rose-300">invalide</span>}</div>
              <button className="px-3 py-2 rounded-xl bg-amber-400 text-slate-950 text-xs font-black" onClick={() => void addLine()} disabled={!selectedReleveId || !preview?.ok}>Ajouter ligne</button>
            </div>
          )}

          <div className="text-xs font-bold text-slate-200 mt-2">6) Quantitatif (résumé)</div>
          <div className="text-[11px] text-slate-300 space-y-1">
            {Object.keys(totals).length === 0 && <div className="text-slate-500">Aucune ligne.</div>}
            {Object.entries(totals).map(([u, q]) => (<div key={u}><span className="font-mono">{q}</span> {u}</div>))}
          </div>

          <div className="text-xs font-bold text-slate-200 mt-2">7) Matériaux/Services (bindings)</div>
          {bound && (
            <div className="space-y-2">
              {bound.issues.length > 0 && (
                <div className="text-[11px] text-amber-200 bg-amber-950/20 border border-amber-500/30 rounded-xl px-2 py-2">
                  {bound.issues.map((i: any, idx: number) => (<div key={idx}>REVIEW: {i.message}</div>))}
                </div>
              )}
              <div className="text-[11px] text-slate-300">
                <div className="font-bold">Matériaux</div>
                {bound.materialItems.length === 0 ? <div className="text-slate-500">(aucun)</div> : bound.materialItems.map((m: any) => (
                  <div key={m.id}>{m.nameFr}: <span className="font-mono">{m.qty}</span> {m.unit}</div>
                ))}
              </div>
              <div className="text-[11px] text-slate-300">
                <div className="font-bold">Services</div>
                {bound.serviceItems.length === 0 ? <div className="text-slate-500">(aucun)</div> : bound.serviceItems.map((s: any, idx: number) => (
                  <div key={idx}>{s.nameFr}: <span className="font-mono">{s.qty}</span> {s.unit}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
