import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Layers,
  Power, Plus, RefreshCw, Trash2,
} from 'lucide-react';
import {
  listTradesForAdmin,
  updateTrade,
  deleteTrade,
  listTradeServicesForAdmin,
  upsertTradeService,
  setTradeServiceActive,
} from '../lib/api';
import {
  markTradeActivated,
  markTradeDeactivated,
  markTradeDeleted,
  invalidateAndRefreshTrades,
} from '../data/tradeRegistry';

/**
 * Admin → Métiers (Trades)
 *
 * Central management of the `trades` registry — the SINGLE source of truth
 * consumed by Outils (CalculatorTab), Services and the CSV catalog import.
 *
 * - `isActive = false` hides the métier from Outils AND Services at once
 *   (both call GET /api/v1/trades, which filters active rows by default).
 *   Nothing is deleted and no separate data source is created.
 * - Official trades can be renamed/reordered/deactivated but NEVER deleted.
 * - Non-official trades can be deleted only when no material references them
 *   (the server answers 409 with a clear message otherwise).
 * - Services (trade_services) are managed per trade when the data supports it.
 *
 * All writes go through the admin-only endpoints guarded by
 * `authenticate + requireEntitlement('CATALOG_OFFICIAL_MANAGE') + requireRole('admin')`.
 */
interface AdminTradesPanelProps {
  /** Server-validated admin session (currentUser.role === 'admin'). */
  isAdmin: boolean;
  /** Shared notification channel of the Admin dashboard. */
  onNotify: (message: string | null) => void;
}

interface TradeRow {
  id: string;
  code: string;
  labelFr: string;
  labelAr?: string | null;
  labelDerja?: string | null;
  icon?: string | null;
  sortOrder: number;
  isActive: boolean;
  isOfficial: boolean;
}

interface TradeDraft {
  labelFr: string;
  labelAr: string;
  labelDerja: string;
  icon: string;
  sortOrder: string;
}

function toDraft(t: TradeRow): TradeDraft {
  return {
    labelFr: t.labelFr ?? '',
    labelAr: t.labelAr ?? '',
    labelDerja: t.labelDerja ?? '',
    icon: t.icon ?? '',
    sortOrder: String(t.sortOrder ?? 0),
  };
}

export const AdminTradesPanel: React.FC<AdminTradesPanelProps> = ({ isAdmin, onNotify }) => {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, TradeDraft>>({});
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});
  const [openServicesId, setOpenServicesId] = useState<string | null>(null);
  const [services, setServices] = useState<Record<string, any[]>>({});
  const [servicesLoading, setServicesLoading] = useState<boolean>(false);
  const [newService, setNewService] = useState<{ nameFr: string; nameAr: string; defaultUnit: string; suggestedRateTnd: string }>({
    nameFr: '', nameAr: '', defaultUnit: 'm²', suggestedRateTnd: '',
  });

  const loadTrades = async () => {
    if (!isAdmin) return;
    setLoadState('loading');
    setLoadError(null);
    try {
      const rows: TradeRow[] = await listTradesForAdmin();
      setTrades(rows);
      const nextDrafts: Record<string, TradeDraft> = {};
      for (const t of rows) nextDrafts[t.id] = toDraft(t);
      setDrafts(nextDrafts);
      setLoadState('loaded');
    } catch (err: any) {
      setTrades([]);
      setLoadError(err?.message || 'Impossible de charger le registre des métiers.');
      setLoadState('error');
    }
  };

  useEffect(() => {
    if (isAdmin) void loadTrades();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const officialCount = useMemo(() => trades.filter((t) => t.isOfficial).length, [trades]);
  const inactiveCount = useMemo(() => trades.filter((t) => !t.isActive).length, [trades]);

  const notify = (message: string | null) => onNotify(message);

  const patchDraft = (id: string, field: keyof TradeDraft, value: string) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };
  /** Persist only the fields that actually changed (one PATCH per row). */
  const saveRow = async (trade: TradeRow) => {
    const draft = drafts[trade.id];
    if (!draft) return;
    const patch: Record<string, unknown> = {};
    if (draft.labelFr.trim() && draft.labelFr.trim() !== (trade.labelFr ?? '')) patch.labelFr = draft.labelFr.trim();
    if (draft.labelAr.trim() !== (trade.labelAr ?? '')) patch.labelAr = draft.labelAr.trim() || null;
    if (draft.labelDerja.trim() !== (trade.labelDerja ?? '')) patch.labelDerja = draft.labelDerja.trim() || null;
    if (draft.icon.trim() !== (trade.icon ?? '')) patch.icon = draft.icon.trim() || null;
    const sortOrder = Number(draft.sortOrder);
    if (Number.isInteger(sortOrder) && sortOrder >= 0 && sortOrder !== trade.sortOrder) patch.sortOrder = sortOrder;

    if (Object.keys(patch).length === 0) {
      notify('Aucune modification à enregistrer.');
      setTimeout(() => notify(null), 3000);
      return;
    }

    setSavingIds((prev) => ({ ...prev, [trade.id]: true }));
    setActionError(null);
    try {
      const saved: TradeRow = await updateTrade(trade.id, patch as any);
      setTrades((rows) => rows.map((r) => (r.id === trade.id ? { ...r, ...saved } : r)));
      setDrafts((prev) => ({ ...prev, [trade.id]: toDraft({ ...trade, ...saved }) }));
      notify(`✓ Métier "${saved?.labelFr || trade.code}" enregistré.`);
      setTimeout(() => notify(null), 3500);
    } catch (err: any) {
      setActionError(`Échec de l'enregistrement (${trade.code}) : ${err?.message || 'erreur serveur'}`);
    } finally {
      setSavingIds((prev) => ({ ...prev, [trade.id]: false }));
    }
  };

  /** isActive=false hides the métier from Outils + Services (no deletion). */
  const toggleActive = async (trade: TradeRow) => {
    setSavingIds((prev) => ({ ...prev, [trade.id]: true }));
    setActionError(null);
    try {
      const saved: TradeRow = await updateTrade(trade.id, { isActive: !trade.isActive });
      setTrades((rows) => rows.map((r) => (r.id === trade.id ? { ...r, ...saved } : r)));
      if (saved?.isActive) {
        markTradeActivated(saved as any);
      } else {
        markTradeDeactivated(trade.code);
      }
      notify(
        saved?.isActive
          ? `✓ "${saved.labelFr || trade.code}" est de nouveau visible dans Outils et Services.`
          : `✓ "${trade.labelFr || trade.code}" masqué dans Outils et Services (données conservées).`
      );
      setTimeout(() => notify(null), 3500);
    } catch (err: any) {
      setActionError(`Échec du changement de visibilité (${trade.code}) : ${err?.message || 'erreur serveur'}`);
    } finally {
      setSavingIds((prev) => ({ ...prev, [trade.id]: false }));
    }
  };

  const removeTrade = async (trade: TradeRow) => {
    if (trade.isOfficial) {
      setActionError('Les métiers officiels ne peuvent pas être supprimés — désactivez-les à la place.');
      return;
    }
    if (!window.confirm(`Supprimer définitivement le métier "${trade.labelFr || trade.code}" ?\n\nLa suppression est refusée si des matériaux y sont encore rattachés.`)) {
      return;
    }
    setSavingIds((prev) => ({ ...prev, [trade.id]: true }));
    setActionError(null);
    try {
      await deleteTrade(trade.id);
      markTradeDeleted(trade.id, trade.code);
      setTrades((rows) => rows.filter((r) => r.id !== trade.id));
      if (openServicesId === trade.id) setOpenServicesId(null);
      notify(`✓ Métier "${trade.labelFr || trade.code}" supprimé du registre.`);
      setTimeout(() => notify(null), 3500);
    } catch (err: any) {
      setActionError(`Suppression refusée (${trade.code}) : ${err?.message || 'erreur serveur'}`);
    } finally {
      setSavingIds((prev) => ({ ...prev, [trade.id]: false }));
    }
  };


  const loadServices = async (tradeId: string) => {
    setServicesLoading(true);
    setActionError(null);
    try {
      const rows = await listTradeServicesForAdmin(tradeId);
      setServices((prev) => ({ ...prev, [tradeId]: rows }));
    } catch (err: any) {
      setActionError(`Impossible de charger les services : ${err?.message || 'erreur serveur'}`);
    } finally {
      setServicesLoading(false);
    }
  };

  const toggleServices = async (trade: TradeRow) => {
    if (openServicesId === trade.id) {
      setOpenServicesId(null);
      return;
    }
    setOpenServicesId(trade.id);
    if (!services[trade.id]) await loadServices(trade.id);
  };

  const addService = async (trade: TradeRow) => {
    if (!newService.nameFr.trim()) {
      setActionError('Le nom du service (FR) est obligatoire.');
      return;
    }
    setActionError(null);
    try {
      await upsertTradeService(trade.id, {
        nameFr: newService.nameFr.trim(),
        nameAr: newService.nameAr.trim() || null,
        defaultUnit: newService.defaultUnit.trim() || 'm²',
        suggestedRateTnd: newService.suggestedRateTnd.trim() === '' ? null : Number(newService.suggestedRateTnd),
      });
      setNewService({ nameFr: '', nameAr: '', defaultUnit: 'm²', suggestedRateTnd: '' });
      await loadServices(trade.id);
      notify(`✓ Service ajouté au métier "${trade.labelFr || trade.code}".`);
      setTimeout(() => notify(null), 3500);
    } catch (err: any) {
      setActionError(`Échec de l'ajout du service : ${err?.message || 'erreur serveur'}`);
    }
  };

  const toggleService = async (trade: TradeRow, service: any) => {
    setActionError(null);
    try {
      await setTradeServiceActive(trade.id, service.id, !service.isActive);
      await loadServices(trade.id);
    } catch (err: any) {
      setActionError(`Échec de la mise à jour du service : ${err?.message || 'erreur serveur'}`);
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300">
        Session administrateur requise pour gérer les métiers.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header & counters */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-slate-950 p-4 rounded-2xl border border-slate-800">
        <div>
          <h4 className="text-sm font-bold text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-amber-400" />
            <span>Registre des Métiers — source unique pour Outils &amp; Services</span>
          </h4>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {trades.length} métier(s) · {officialCount} officiel(s) · {inactiveCount} masqué(s).
            La désactivation retire le métier de <span className="font-mono">Outils</span> et de{' '}
            <span className="font-mono">Services</span> simultanément — aucune donnée n'est supprimée.
          </p>
        </div>
        <button
          type="button"
          onClick={loadTrades}
          disabled={loadState === 'loading'}
          className="px-3 py-2 bg-slate-900 hover:bg-slate-850 text-slate-300 hover:text-white border border-slate-800 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadState === 'loading' ? 'animate-spin' : ''}`} />
          <span>Recharger</span>
        </button>
      </div>

      {loadError && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-[11px] text-red-300 flex items-start justify-between gap-2">
          <div className="flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{loadError}</span>
          </div>
          <button type="button" onClick={loadTrades} className="text-red-300 hover:text-white font-bold cursor-pointer shrink-0">Réessayer</button>
        </div>
      )}

      {actionError && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-[11px] text-red-300 flex items-start justify-between gap-2">
          <div className="flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button type="button" onClick={() => setActionError(null)} className="text-red-400 hover:text-red-200 font-bold cursor-pointer shrink-0" title="Masquer l'erreur">✕</button>
        </div>
      )}

      {loadState === 'loading' && (
        <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-400 flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          <span>Chargement depuis GET /api/v1/trades?includeInactive=true…</span>
        </div>
      )}

      {loadState !== 'loading' && trades.length === 0 && !loadError && (
        <p className="text-[11px] text-slate-500">Aucun métier dans le registre.</p>
      )}


      {trades.length > 0 && (
        <div className="overflow-x-auto border border-slate-800 rounded-2xl bg-slate-950">
          <table className="w-full min-w-[980px] text-left text-xs">
            <thead className="bg-slate-900 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="p-3">Code (identité)</th>
                <th className="p-3">Nom FR</th>
                <th className="p-3">Nom AR</th>
                <th className="p-3">Derja</th>
                <th className="p-3">Icône</th>
                <th className="p-3">Ordre</th>
                <th className="p-3 text-center">Visible</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {trades.map((trade) => {
                const draft = drafts[trade.id] || toDraft(trade);
                const busy = !!savingIds[trade.id];
                return (
                  <React.Fragment key={trade.id}>
                    <tr className={`transition-colors ${trade.isActive ? 'hover:bg-slate-900/60' : 'bg-slate-900/40 opacity-70'}`}>
                      <td className="p-3">
                        <div className="font-mono text-[11px] text-white">{trade.code}</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold ${
                            trade.isOfficial
                              ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                              : 'bg-sky-500/10 text-sky-300 border-sky-500/30'
                          }`}>
                            {trade.isOfficial ? 'OFFICIEL' : 'DYNAMIQUE'}
                          </span>
                          {!trade.isActive && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded border font-bold bg-slate-800 text-slate-400 border-slate-700">MASQUÉ</span>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        <input
                          type="text"
                          value={draft.labelFr}
                          onChange={(e) => patchDraft(trade.id, 'labelFr', e.target.value)}
                          maxLength={100}
                          className="w-40 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-white focus:border-amber-400 focus:outline-none"
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="text"
                          value={draft.labelAr}
                          onChange={(e) => patchDraft(trade.id, 'labelAr', e.target.value)}
                          maxLength={100}
                          className="w-32 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-white font-serif focus:border-amber-400 focus:outline-none"
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="text"
                          value={draft.labelDerja}
                          onChange={(e) => patchDraft(trade.id, 'labelDerja', e.target.value)}
                          maxLength={100}
                          className="w-28 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-white focus:border-amber-400 focus:outline-none"
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="text"
                          value={draft.icon}
                          onChange={(e) => patchDraft(trade.id, 'icon', e.target.value)}
                          maxLength={50}
                          placeholder="Hammer"
                          className="w-24 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-white font-mono focus:border-amber-400 focus:outline-none"
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={draft.sortOrder}
                          onChange={(e) => patchDraft(trade.id, 'sortOrder', e.target.value)}
                          className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-white font-mono focus:border-amber-400 focus:outline-none"
                        />
                      </td>

                      <td className="p-3 text-center">
                        <button
                          type="button"
                          onClick={() => toggleActive(trade)}
                          disabled={busy}
                          title={trade.isActive ? 'Masquer dans Outils + Services' : 'Rendre visible dans Outils + Services'}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-black border transition-all cursor-pointer disabled:opacity-50 ${
                            trade.isActive
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          <Power className="w-3 h-3 inline-block mr-1" />
                          {trade.isActive ? 'ACTIF' : 'MASQUÉ'}
                        </button>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => saveRow(trade)}
                            disabled={busy}
                            className="px-2.5 py-1 bg-amber-400 hover:bg-amber-300 text-slate-950 text-[10px] font-black rounded-lg transition-all cursor-pointer flex items-center gap-1 disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Enregistrer</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleServices(trade)}
                            className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1"
                            title="Gérer les services de ce métier"
                          >
                            {openServicesId === trade.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            <span>Services</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => removeTrade(trade)}
                            disabled={busy || trade.isOfficial}
                            title={trade.isOfficial ? 'Les métiers officiels ne peuvent pas être supprimés' : 'Supprimer ce métier dynamique'}
                            className="p-1.5 bg-slate-900 border border-slate-800 rounded-lg transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed text-slate-500 hover:text-rose-400 hover:bg-rose-950/40"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Services (trade_services) — managed only when supported by the data */}
                    {openServicesId === trade.id && (
                      <tr className="bg-slate-900/60">
                        <td colSpan={8} className="p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <h5 className="text-[11px] font-bold text-amber-400 flex items-center gap-1.5">
                              <Layers className="w-3.5 h-3.5" />
                              <span>Services de « {trade.labelFr || trade.code} » (table trade_services)</span>
                            </h5>
                            <button
                              type="button"
                              onClick={() => loadServices(trade.id)}
                              className="text-[10px] font-bold text-slate-400 hover:text-white cursor-pointer flex items-center gap-1"
                            >
                              <RefreshCw className={`w-3 h-3 ${servicesLoading ? 'animate-spin' : ''}`} />
                              Recharger
                            </button>
                          </div>

                          {(services[trade.id] || []).length === 0 ? (
                            <p className="text-[11px] text-slate-500">
                              Aucun service enregistré en base pour ce métier — le calculateur utilise alors sa
                              configuration locale par défaut (aucun service inventé ici).
                            </p>
                          ) : (
                            <div className="space-y-1.5">
                              {(services[trade.id] || []).map((s: any) => (
                                <div key={s.id} className="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2">
                                  <div className="min-w-0">
                                    <div className="text-[11px] font-bold text-white truncate">{s.nameFr}</div>
                                    <div className="text-[10px] text-slate-500 font-mono">
                                      {s.nameAr || '—'} · {s.defaultUnit} · {s.suggestedRateTnd == null ? '—' : `${s.suggestedRateTnd} DT`}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => toggleService(trade, s)}
                                    className={`px-2.5 py-1 rounded-lg text-[10px] font-black border transition-all cursor-pointer shrink-0 ${
                                      s.isActive
                                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                        : 'bg-slate-800 text-slate-400 border-slate-700'
                                    }`}
                                  >
                                    {s.isActive ? 'ACTIF' : 'INACTIF'}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}


                          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                            <input
                              type="text"
                              value={newService.nameFr}
                              onChange={(e) => setNewService((p) => ({ ...p, nameFr: e.target.value }))}
                              placeholder="Service (FR) *"
                              maxLength={150}
                              className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white focus:border-amber-400 focus:outline-none"
                            />
                            <input
                              type="text"
                              value={newService.nameAr}
                              onChange={(e) => setNewService((p) => ({ ...p, nameAr: e.target.value }))}
                              placeholder="Service (AR)"
                              maxLength={150}
                              className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white font-serif focus:border-amber-400 focus:outline-none"
                            />
                            <input
                              type="text"
                              value={newService.defaultUnit}
                              onChange={(e) => setNewService((p) => ({ ...p, defaultUnit: e.target.value }))}
                              placeholder="Unité (m²)"
                              maxLength={20}
                              className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white font-mono focus:border-amber-400 focus:outline-none"
                            />
                            <input
                              type="number"
                              min={0}
                              step="0.5"
                              value={newService.suggestedRateTnd}
                              onChange={(e) => setNewService((p) => ({ ...p, suggestedRateTnd: e.target.value }))}
                              placeholder="Tarif indicatif DT"
                              className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white font-mono focus:border-amber-400 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => addService(trade)}
                              className="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 text-[11px] font-black rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>Ajouter</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] text-slate-500 leading-relaxed">
        Règles appliquées : le <span className="font-mono">code</span> et le statut officiel ne sont jamais modifiables ;
        les métiers officiels ne peuvent pas être supprimés (désactivation uniquement) ; la suppression d'un métier
        dynamique est refusée tant que des matériaux y sont rattachés (409).
      </p>
    </div>
  );
};

