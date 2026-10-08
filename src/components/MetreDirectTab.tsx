/**
 * PHASE 2.3-B1 — DIRECT MÉTRÉ SKELETON (pickers + descriptor only).
 *
 * Flow: Métré Pro → Direct → Métier → Type de travail → Descriptor card.
 *
 * HARD CONTRACTS (locked by tests/metreDirectSkeleton.test.ts):
 *   - Presentation ONLY: this module imports NO calculation engine, NO
 *     bindings, NO persistence API — it resolves data and renders it.
 *   - Métier labels/order come from `MetreTradeSpec` when present, otherwise
 *     from the trade itself (never assume every métier has a spec).
 *   - Work-type order = `workTypeOrder` first, remaining elements keep their
 *     registry order afterwards (`METRE_ELEMENTS` untouched).
 *   - Descriptor (`MetreWorkTypeSpec`) is displayed as information only and
 *     is never forwarded to any calculation.
 *   - No Project / Zone / Ouvrage / Relevé concept exists in this file.
 *   - State is component-local (trade + work type); nothing is persisted.
 *
 * B2-B5 (this revision): adds the Mesures form, the live quantity result,
 * materials/services, fiscalité, Devis and WhatsApp — EVERY computation is
 * routed through the pure adapter `utils/metreDirectResult`, so this file
 * stays presentation-only (no direct calculator, no binding logic, no
 * persistence call). Enriched editors (openings/layers/waste/…) stay in B6.
 *
 * FORBIDDEN here: Project / Zone / Ouvrage / Relevé, DB writes, new work
 * types, new métiers, price or fiscal invention.
 */
import React, { useState } from 'react';
import type { CountryCode, CurrencyCode, DevisItem, Language, MaterialRate, Trade } from '../types';
import type { MetreElementDef } from '../data/metreElements';
import { elementsForTrade } from '../data/metreElements';
import type { MetreTradeSpec } from '../data/metreTradeSpecs';
import { getMetreTradeSpec, getWorkTypeSpec } from '../data/metreTradeSpecs';
import { formatCalculationForWhatsApp, openWhatsApp } from '../utils/whatsapp';
import {
  buildDirectQuantity,
  buildDirectDefaults,
  buildDirectBoundOutput,
  buildDirectFiscal,
  buildDirectDevisItems,
  buildDirectCalculationResult,
  buildDirectOverrides,
  resolveDirectDownstreamElement,
  sumMaterialTotals,
  directQuantityError,
  type DirectBoundOutput,
  type DirectFiscal,
  type DirectQuantityResult,
  type DirectOverrides,
} from '../utils/metreDirectResult';

export interface MetreDirectTabProps {
  trades: Trade[];
  lang: Language;
  country: CountryCode;
  currency: CurrencyCode;
  /** Barème — used only through the existing bindings output. */
  rates: MaterialRate[];
  /** Existing App devis handlers (CalculatorTab pattern). */
  onAddToDevis: (item: DevisItem) => void;
  onAddMultipleToDevis: (items: DevisItem[]) => void;
}

/** Bilingual display labels of a trade (spec first, trade as fallback). */
export interface TradeDisplay {
  labelFr: string;
  labelAr: string;
}

/**
 * Resolve display labels for a trade: a registered `MetreTradeSpec` wins,
 * otherwise the trade's own labels are used (fallback — no spec required).
 * Pure and presentation-only (test 1 + test 2).
 */
export function resolveTradeDisplay(
  trade: Pick<Trade, 'code' | 'labelFr' | 'labelAr'>,
): TradeDisplay {
  const spec: MetreTradeSpec | null = getMetreTradeSpec(trade.code);
  if (spec) return { labelFr: spec.labelFr, labelAr: spec.labelAr };
  return {
    labelFr: trade.labelFr || trade.code,
    labelAr: trade.labelAr || '',
  };
}

/**
 * Order work types for display: codes listed in `workTypeOrder` come first
 * (in that exact order, duplicates ignored), every remaining element keeps
 * its current registry order. Never mutates the input (test 3).
 */
export function orderWorkTypesForDisplay(
  elements: readonly MetreElementDef[],
  workTypeOrder?: readonly string[],
): MetreElementDef[] {
  const source: readonly MetreElementDef[] = Array.isArray(elements) ? elements : [];
  if (!workTypeOrder || workTypeOrder.length === 0) return [...source];
  const placed = new Set<string>();
  const ordered: MetreElementDef[] = [];
  for (const code of workTypeOrder) {
    const el = source.find((e) => e && e.code === code);
    if (el && !placed.has(el.code)) {
      ordered.push(el);
      placed.add(el.code);
    }
  }
  for (const el of source) {
    if (el && !placed.has(el.code)) ordered.push(el);
  }
  return ordered;
}

/**
 * Direct Métré skeleton: two local states (selected trade, selected work
 * type). Changing métier always clears the previous work type; nothing is
 * auto-selected and nothing is persisted.
 */
export const MetreDirectTab: React.FC<MetreDirectTabProps> = ({ trades, lang, country, currency, rates, onAddToDevis, onAddMultipleToDevis }) => {
  const [selectedTradeCode, setSelectedTradeCode] = useState<string>('');
  const [selectedElementCode, setSelectedElementCode] = useState<string>('');
  const [dims, setDims] = useState<Record<string, string>>({});
  const [addedFlash, setAddedFlash] = useState<boolean>(false);
  // M1-2 — optional enriched overrides (component-local, data-driven only).
  // Keys appear ONLY when the ACTIVE element declares the matching block.
  // Cleared on trade/work-type change so nothing leaks between elements.
  const [overOpenings, setOverOpenings] = useState<Array<{ w: string; h: string; n: string }>>([]);
  const [overDeductions, setOverDeductions] = useState<Array<{ amount: string; unit: string }>>([]);
  const [overLayers, setOverLayers] = useState<string>('');
  const [overWaste, setOverWaste] = useState<string>('');
  const [overCoverage, setOverCoverage] = useState<{ value: string; unit: string; basis: string } | null>(null);
  const isAr = lang === 'ar';

  const tradeList: Trade[] = Array.isArray(trades) ? trades : [];
  const selectedTrade = tradeList.find((t) => t.code === selectedTradeCode) ?? null;
  const tradeSpec: MetreTradeSpec | null = selectedTrade
    ? getMetreTradeSpec(selectedTrade.code)
    : null;
  const workTypes: MetreElementDef[] = selectedTrade
    ? orderWorkTypesForDisplay(
        elementsForTrade(selectedTrade.code),
        tradeSpec?.workTypeOrder,
      )
    : [];
  const selectedElement = workTypes.find((e) => e.code === selectedElementCode) ?? null;
  const descriptor = selectedTrade && selectedElement
    ? getWorkTypeSpec(selectedTrade.code, selectedElement.code)
    : null;

  const clearOverrides = (): void => {
    setOverOpenings([]);
    setOverDeductions([]);
    setOverLayers('');
    setOverWaste('');
    setOverCoverage(null);
  };

  /** Changing métier ALWAYS clears the previous work type and its form. */
  const handleSelectTrade = (code: string): void => {
    setSelectedTradeCode(code);
    setSelectedElementCode('');
    setDims({});
    clearOverrides();
  };

  /** Selecting a work type seeds the form from the element's own defaults. */
  const handleSelectWorkType = (code: string): void => {
    setSelectedElementCode(code);
    const el = workTypes.find((e) => e.code === code);
    setDims(el ? buildDirectDefaults(el) : {});
    clearOverrides();
  };

  // ── M1-2 capability flags — derived from the ACTIVE element definition ──
  // No trade/code comparison anywhere: presence of the block IS the gate.
  const capOpenings = selectedElement !== null
    && (selectedElement as { openings?: unknown }).openings !== undefined
    && (selectedElement as { openings?: unknown }).openings !== null;
  const capDeductions = selectedElement !== null
    && (selectedElement as { deductions?: unknown }).deductions !== undefined
    && (selectedElement as { deductions?: unknown }).deductions !== null;
  const capLayers = selectedElement !== null
    && (selectedElement as { layers?: unknown }).layers !== undefined
    && (selectedElement as { layers?: unknown }).layers !== null;
  const capWaste = selectedElement !== null
    && (selectedElement as { wastePercent?: unknown }).wastePercent !== undefined
    && (selectedElement as { wastePercent?: unknown }).wastePercent !== null;
  const capCoverage = selectedElement !== null
    && (((selectedElement as { coveragePerProductUnit?: unknown }).coveragePerProductUnit !== undefined
      && (selectedElement as { coveragePerProductUnit?: unknown }).coveragePerProductUnit !== null)
      || ((selectedElement as { yieldPerUnit?: unknown }).yieldPerUnit !== undefined
        && (selectedElement as { yieldPerUnit?: unknown }).yieldPerUnit !== null));
  const hasAdvanced = capOpenings || capDeductions || capLayers || capWaste || capCoverage;

  /** Build the M1-1 overrides object from local UI state (numeric-validated). */
  const buildOverrides = (): DirectOverrides => {
    const o: Record<string, unknown> = {};
    if (capOpenings && overOpenings.length > 0) {
      const items: Array<Record<string, unknown>> = [];
      for (const it of overOpenings) {
        const w = Number(String(it.w ?? '').trim());
        const h = Number(String(it.h ?? '').trim());
        const n = String(it.n ?? '').trim() === '' ? 1 : Number(String(it.n).trim());
        if (!Number.isFinite(w) || w < 0 || !Number.isFinite(h) || h < 0 || !Number.isFinite(n) || n < 0) continue;
        items.push({ width: w, height: h, count: n });
      }
      if (items.length > 0) o.openings = { enabled: true, items };
    }
    if (capDeductions && overDeductions.length > 0) {
      const items: Array<Record<string, unknown>> = [];
      for (const it of overDeductions) {
        const amount = Number(String(it.amount ?? '').trim());
        const unit = String(it.unit ?? '').trim();
        if (!Number.isFinite(amount) || amount < 0 || !unit) continue;
        items.push({ amount, unit });
      }
      if (items.length > 0) o.deductions = { enabled: true, items };
    }
    if (capLayers && String(overLayers ?? '').trim() !== '') {
      const v = Number(String(overLayers).trim());
      if (Number.isFinite(v)) o.layers = v;
    }
    if (capWaste && String(overWaste ?? '').trim() !== '') {
      const v = Number(String(overWaste).trim());
      if (Number.isFinite(v)) o.wastePercent = v;
    }
    if (capCoverage && overCoverage !== null && String(overCoverage.value ?? '').trim() !== '') {
      const v = Number(String(overCoverage.value).trim());
      const unit = String(overCoverage.unit ?? '').trim();
      const basis = String(overCoverage.basis ?? '').trim();
      if (Number.isFinite(v) && unit && basis) o.coveragePerProductUnit = { value: v, unit, basis };
    }
    return o as DirectOverrides;
  };

  // ── B2-B5 derived results — ALL computation routed through the adapter ──
  // M1-3: ONE effective element feeds quantity, bindings, waste and DTO.
  const currentOverrides = buildOverrides();
  const effectiveElement: MetreElementDef | null = selectedElement
    ? resolveDirectDownstreamElement({ element: selectedElement, overrides: currentOverrides })
    : null;
  const quantity: DirectQuantityResult | null = selectedElement
    ? buildDirectOverrides({ element: selectedElement, dims, overrides: currentOverrides })
    : null;
  const quantityOk = quantity !== null && quantity.ok;
  // Pre-narrowed error view (narrowing lives in the adapter — see
  // directQuantityError): this project compiles without strictNullChecks.
  const quantityError = directQuantityError(quantity);

  let bound: DirectBoundOutput | null = null;
  if (effectiveElement && quantity && quantity.ok) {
    bound = buildDirectBoundOutput({
      element: effectiveElement,
      dims,
      lines: [{ qty: quantity.qty, unit: quantity.unit }],
      rates,
    });
  }

  const materialSubtotal = bound ? sumMaterialTotals(bound.materialItems) : 0;
  const fiscal: DirectFiscal | null = quantityOk && bound
    ? buildDirectFiscal(materialSubtotal, 0, country)
    : null;

  const devisItems: DevisItem[] =
    quantityOk && bound && selectedTrade && selectedElement
      ? buildDirectDevisItems({
          tradeCode: selectedTrade.code,
          element: selectedElement,
          materialItems: bound.materialItems,
        })
      : [];

  const fiscalRows: Array<{ label: string; value: number; sign: string }> = !fiscal
    ? []
    : [
        { label: isAr ? 'المجموع الفرعي (HT)' : 'Sous-total HT', value: fiscal.sousTotalHtTnd, sign: '' },
        { label: `TVA (${fiscal.tvaPercent}%)`, value: fiscal.tvaAmountTnd, sign: '+' },
        ...(fiscal.timbreFiscalTnd > 0
          ? [{ label: isAr ? 'الطابع الجبائي' : 'Timbre fiscal', value: fiscal.timbreFiscalTnd, sign: '+' }]
          : []),
        ...(fiscal.retenueGarantiePercent > 0
          ? [{ label: `Retenue (${fiscal.retenueGarantiePercent}%)`, value: fiscal.retenueGarantieTnd, sign: '−' }]
          : []),
      ];

  /** Ajouter au devis — existing App handlers (CalculatorTab pattern). */
  const handleAddAllToDevis = (): void => {
    if (devisItems.length === 0) return;
    if (devisItems.length === 1) onAddToDevis(devisItems[0]);
    else onAddMultipleToDevis(devisItems);
    setAddedFlash(true);
    window.setTimeout(() => setAddedFlash(false), 2500);
  };

  /** WhatsApp — existing global formatter fed by the presentation DTO. */
  const handleShareWhatsApp = (): void => {
    if (!quantity || !quantity.ok || !bound || !effectiveElement) return;
    const dto = buildDirectCalculationResult({
      element: effectiveElement,
      quantity: { qty: quantity.qty, unit: quantity.unit },
      materialItems: bound.materialItems,
      fiscal: fiscal ?? buildDirectFiscal(0, 0, country),
      currency,
      currencySymbol: currency,
      fieldNotes: descriptor?.validationHints ?? [],
    });
    openWhatsApp(formatCalculationForWhatsApp(dto, lang));
  };
  return (
    <div className="space-y-4 px-4 sm:px-6 pb-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-black text-white">
            {isAr ? 'المتراج المباشر' : 'Métré Direct'}
          </h2>
          <p className="text-xs text-slate-400">
            {isAr ? 'المهنة ← نوع العمل ← الوصف' : 'Métier → Type de travail → Descriptif'}
          </p>
        </div>
        <span className="text-[11px] font-mono font-bold text-amber-400 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1">
          {country} · {currency}
        </span>
      </div>

      {/* 1) Métier picker */}
      <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 space-y-2">
        <div className="text-xs font-bold text-slate-200">1) {isAr ? 'المهنة' : 'Métier'}</div>
        {tradeList.length === 0 ? (
          <div className="text-xs text-slate-500">
            {isAr ? 'لا توجد مهن متاحة' : 'Aucun métier disponible.'}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {tradeList.map((t) => {
              const d = resolveTradeDisplay(t);
              const active = t.code === selectedTradeCode;
              return (
                <button
                  key={t.code}
                  type="button"
                  onClick={() => handleSelectTrade(t.code)}
                  className={`text-left rounded-xl px-3 py-2 border transition-all ${
                    active
                      ? 'bg-amber-400 text-slate-950 border-amber-300'
                      : 'bg-slate-900 border-slate-700 text-slate-200 hover:border-slate-500'
                  }`}
                >
                  <div className="text-xs font-black truncate">
                    {isAr && d.labelAr ? d.labelAr : d.labelFr}
                  </div>
                  <div className={`text-[10px] font-mono truncate ${active ? 'text-slate-800' : 'text-slate-500'}`}>
                    {t.code}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {/* 2) Work-type picker (only after a métier is chosen) */}
      {selectedTrade && (
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 space-y-2">
          <div className="text-xs font-bold text-slate-200">
            2) {isAr ? 'نوع العمل' : 'Type de travail'}
          </div>
          {workTypes.length === 0 ? (
            <div className="text-xs text-slate-500">
              {isAr ? 'لا توجد أنواع عمل لهذا المهنة' : 'Aucun type de travail pour ce métier.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {workTypes.map((el) => {
                const active = el.code === selectedElementCode;
                return (
                  <button
                    key={el.code}
                    type="button"
                    onClick={() => handleSelectWorkType(el.code)}
                    className={`text-left rounded-xl px-3 py-2 border transition-all ${
                      active
                        ? 'bg-amber-400/15 border-amber-400 text-white'
                        : 'bg-slate-900 border-slate-700 text-slate-200 hover:border-slate-500'
                    }`}
                  >
                    <div className="text-xs font-black">
                      {isAr && el.labelAr ? el.labelAr : el.labelFr}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700 text-amber-400">
                        {el.method}
                      </span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700 text-slate-300">
                        {el.unit}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 3) Descriptor (information only — never forwarded to calculation) */}
      {selectedElement && (
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 space-y-2">
          <div className="text-xs font-bold text-slate-200">
            3) {isAr ? 'الوصف' : 'Descriptif'}
          </div>
          {!descriptor ? (
            <div className="text-xs text-slate-500">
              {isAr ? 'لا يوجد وصف لهذا العنصر' : 'Aucun descriptif (workType) pour cet élément.'}
            </div>
          ) : (
            <div className="space-y-2">
              <div>
                <div className="text-sm font-black text-white">
                  {isAr && descriptor.labelAr ? descriptor.labelAr : descriptor.labelFr}
                </div>
                {descriptor.labelAr && (
                  <div className="text-xs text-slate-400" dir="rtl">{descriptor.labelAr}</div>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-400/10 border border-amber-400/40 text-amber-300 font-bold">
                  {descriptor.measurementMethod}
                </span>
                {descriptor.durationHint && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-950 border border-slate-700 text-slate-300">
                    ⏱ {descriptor.durationHint.value} {descriptor.durationHint.unit}
                  </span>
                )}
              </div>
              {descriptor.methodology && (
                <p className="text-xs text-slate-300 leading-relaxed">{descriptor.methodology}</p>
              )}
              {descriptor.norms && descriptor.norms.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold text-amber-400">
                    {isAr ? 'المرجعيات / Normes' : 'Normes / Références'}
                  </div>
                  <ul className="space-y-0.5">
                    {descriptor.norms.map((n, i) => (
                      <li key={i} className="text-[11px] text-slate-300">• {n}</li>
                    ))}
                  </ul>
                </div>
              )}
              {descriptor.validationHints && descriptor.validationHints.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold text-amber-400">
                    {isAr ? 'تنبيهات التحقق' : 'Validation'}
                  </div>
                  <ul className="space-y-0.5">
                    {descriptor.validationHints.map((h, i) => (
                      <li key={i} className="text-[11px] text-slate-300">• {h}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {/* 4) Mesures — dynamic numeric form built from activeElement.dims */}
      {selectedElement && (
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 space-y-2">
          <div className="text-xs font-bold text-slate-200">4) {isAr ? 'القياسات' : 'Mesures'}</div>
          <div className="space-y-2">
            {selectedElement.dims.map((d) => (
              <div key={d.key} className="flex items-center gap-2">
                <div className="w-32 text-[11px] text-slate-300 font-bold truncate">
                  {isAr && d.labelAr ? d.labelAr : d.labelFr}
                </div>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-xl px-2 py-2 text-xs text-white font-mono focus:border-amber-400"
                  value={dims[d.key] ?? ''}
                  onChange={(e) => setDims((prev) => ({ ...prev, [d.key]: e.target.value }))}
                />
                <div className="w-10 text-[11px] text-slate-500 font-mono">{d.unit}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* M1-2 — Options avancees (data-driven, optional overrides). */}
      {selectedElement && hasAdvanced && (
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 space-y-2">
          <div className="text-xs font-bold text-slate-200">
            {isAr ? 'خيارات متقدمة (اختياري)' : 'Options avancees (optionnel)'}
          </div>
          {capOpenings && (
            <div className="space-y-1.5 rounded-xl border border-slate-800 bg-slate-900/60 px-2 py-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-200">{isAr ? 'الفتحات' : 'Ouvertures'}</span>
                <button type="button" onClick={() => setOverOpenings((prev) => [...prev, { w: '', h: '', n: '1' }])} className="text-[11px] font-bold text-amber-300 hover:text-amber-200">
                  {isAr ? '+ إضافة فتحة' : '+ Ajouter une ouverture'}
                </button>
              </div>
              {overOpenings.length === 0 && (
                <div className="text-[10px] text-slate-500">{isAr ? 'لا توجد فتحات مضافة (محايد).' : 'Aucune ouverture ajoutee (neutre).'}</div>
              )}
              {overOpenings.map((it, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <input type="number" inputMode="decimal" min="0" step="any" placeholder={isAr ? 'عرض' : 'Larg.'} className="w-0 flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white font-mono focus:border-amber-400" value={it.w} onChange={(e) => setOverOpenings((prev) => prev.map((p, i) => (i === idx ? { ...p, w: e.target.value } : p)))} />
                  <input type="number" inputMode="decimal" min="0" step="any" placeholder={isAr ? 'ارتفاع' : 'Haut.'} className="w-0 flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white font-mono focus:border-amber-400" value={it.h} onChange={(e) => setOverOpenings((prev) => prev.map((p, i) => (i === idx ? { ...p, h: e.target.value } : p)))} />
                  <input type="number" inputMode="decimal" min="0" step="any" placeholder={isAr ? 'عدد' : 'Qte'} className="w-14 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white font-mono focus:border-amber-400" value={it.n} onChange={(e) => setOverOpenings((prev) => prev.map((p, i) => (i === idx ? { ...p, n: e.target.value } : p)))} />
                  <button type="button" onClick={() => setOverOpenings((prev) => prev.filter((_, i) => i !== idx))} className="text-[11px] font-bold text-rose-300 hover:text-rose-200 px-1" aria-label={isAr ? 'حذف' : 'Supprimer'}>X</button>
                </div>
              ))}
            </div>
          )}

          {capLayers && (
            <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-2 py-1.5">
              <span className="w-32 text-[11px] text-slate-200 font-bold truncate">{isAr ? 'الطبقات' : 'Couches'}</span>
              <input
                type="number" inputMode="numeric" min="1" step="1" placeholder="1"
                className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white font-mono focus:border-amber-400"
                value={overLayers}
                onChange={(e) => setOverLayers(e.target.value)}
              />
              <span className="text-[10px] text-slate-500 font-mono">xN</span>
            </div>
          )}
          {capDeductions && (
            <div className="space-y-1.5 rounded-xl border border-slate-800 bg-slate-900/60 px-2 py-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-200">{isAr ? 'الخصومات' : 'Deductions'}</span>
                <button type="button" onClick={() => setOverDeductions((prev) => [...prev, { amount: '', unit: 'm2' }])} className="text-[11px] font-bold text-amber-300 hover:text-amber-200">
                  {isAr ? '+ إضافة خصم' : '+ Ajouter une deduction'}
                </button>
              </div>
              {overDeductions.length === 0 && (
                <div className="text-[10px] text-slate-500">{isAr ? 'لا توجد خصومات مضافة (محايد).' : 'Aucune deduction ajoutee (neutre).'}</div>
              )}
              {overDeductions.map((it, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <input type="number" inputMode="decimal" min="0" step="any" placeholder={isAr ? 'قيمة' : 'Montant'} className="w-0 flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white font-mono focus:border-amber-400" value={it.amount} onChange={(e) => setOverDeductions((prev) => prev.map((p, i) => (i === idx ? { ...p, amount: e.target.value } : p)))} />
                  <input type="text" placeholder="m2" className="w-16 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white font-mono focus:border-amber-400" value={it.unit} onChange={(e) => setOverDeductions((prev) => prev.map((p, i) => (i === idx ? { ...p, unit: e.target.value } : p)))} />
                  <button type="button" onClick={() => setOverDeductions((prev) => prev.filter((_, i) => i !== idx))} className="text-[11px] font-bold text-rose-300 hover:text-rose-200 px-1" aria-label={isAr ? 'حذف' : 'Supprimer'}>X</button>
                </div>
              ))}
            </div>
          )}
          {capCoverage && (
            <div className="space-y-1.5 rounded-xl border border-slate-800 bg-slate-900/60 px-2 py-1.5">
              <span className="text-[11px] font-bold text-slate-200">{isAr ? 'المردود / التغطية' : 'Coverage / rendement'}</span>
              <div className="flex items-center gap-1.5">
                <input type="number" inputMode="decimal" min="0" step="any" placeholder={isAr ? 'قيمة' : 'Valeur'} className="w-0 flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white font-mono focus:border-amber-400" value={overCoverage?.value ?? ''} onChange={(e) => setOverCoverage((prev) => ({ value: e.target.value, unit: prev?.unit ?? '', basis: prev?.basis ?? '' }))} />
                <input type="text" placeholder={isAr ? 'وحدة' : 'Unite'} className="w-16 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white font-mono focus:border-amber-400" value={overCoverage?.unit ?? ''} onChange={(e) => setOverCoverage((prev) => ({ value: prev?.value ?? '', unit: e.target.value, basis: prev?.basis ?? '' }))} />
                <input type="text" placeholder="basis" className="w-16 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white font-mono focus:border-amber-400" value={overCoverage?.basis ?? ''} onChange={(e) => setOverCoverage((prev) => ({ value: prev?.value ?? '', unit: prev?.unit ?? '', basis: e.target.value }))} />
              </div>
            </div>
          )}
          {capWaste && (
            <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-2 py-1.5">
              <span className="w-32 text-[11px] text-slate-200 font-bold truncate">{isAr ? 'الفاقد (%)' : 'Dechet (%)'}</span>
              <input type="number" inputMode="decimal" min="0" step="any" placeholder="0" className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-[11px] text-white font-mono focus:border-amber-400" value={overWaste} onChange={(e) => setOverWaste(e.target.value)} />
              <span className="text-[10px] text-slate-500 font-mono">%</span>
            </div>
          )}


        </div>
      )}

      {/* 5) Résultat — live quantity (engine unit, never hardcoded) */}
      {selectedElement && quantityError && (
        <div className="bg-rose-950/40 border border-rose-500/40 rounded-2xl p-3 text-xs text-rose-200 space-y-1">
          <div className="font-black">⚠ {isAr ? 'قياسات غير صالحة' : 'Mesures invalides'}</div>
          <div>{quantityError.message}</div>
          {quantityError.badDims.length > 0 && (
            <div className="font-mono text-[10px] opacity-80">
              {isAr ? 'حقول' : 'Champs'}: {quantityError.badDims.join(', ')}
            </div>
          )}
        </div>
      )}
      {selectedElement && quantity && quantity.ok && (
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 space-y-1.5">
          <div className="text-xs font-bold text-slate-200">5) {isAr ? 'النتيجة' : 'Résultat'}</div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11px] text-slate-400">{isAr ? 'الكمية المحسوبة' : 'Quantité calculée'}</span>
            <span className="text-xl font-black text-emerald-400 font-mono">
              {quantity.qty.toFixed(2)} {quantity.unit}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11px] text-slate-400">{isAr ? 'المعادلة' : 'Formule'}</span>
            <span className="text-[11px] font-mono text-slate-200 text-right">{quantity.formula}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11px] text-slate-400">{isAr ? 'التفصيل' : 'Détail'}</span>
            <span className="text-[11px] font-mono text-amber-300 text-right">{quantity.breakdown}</span>
          </div>
          {/* B6.2 — data-driven enriched chain (definition-owned stages only).
              Rendered from quantity.stages: gross → declared stages in engine
              order → final engine qty/unit. Neutral stages are shown as
              capability (never as applied deductions). Legacy elements show
              gross + final only. No trade branch. */}
          {quantity.stages && quantity.stages.length > 0 && (
            <div className="space-y-1 rounded-xl border border-slate-800 bg-slate-900/60 px-2 py-1.5">
              {quantity.stages.map((s, idx) => (
                <div key={`${s.key}-${idx}`} className="flex items-baseline justify-between gap-3 text-[11px]">
                  <span className="text-slate-400">
                    {idx + 1}. {isAr ? s.labelAr : s.labelFr}
                    {!s.effective && (
                      <span className="text-slate-500"> ({isAr ? 'محايد' : 'neutre'})</span>
                    )}
                  </span>
                  <span className={`font-mono text-right ${s.key === 'final' ? 'text-emerald-300 font-black' : s.effective ? 'text-slate-200' : 'text-slate-500'}`}>
                    {s.key === 'final' ? `${quantity.qty.toFixed(2)} ${quantity.unit}` : (s.detail || '—')}
                  </span>
                </div>
              ))}
            </div>
          )}
          {((selectedElement as { wastePercent?: unknown }).wastePercent !== undefined
            && (selectedElement as { wastePercent?: unknown }).wastePercent !== null)
          || ((selectedElement as { layers?: unknown }).layers !== undefined
            && (selectedElement as { layers?: unknown }).layers !== null)
          || ((selectedElement as { openings?: unknown }).openings !== undefined
            && (selectedElement as { openings?: unknown }).openings !== null)
          || ((selectedElement as { deductions?: unknown }).deductions !== undefined
            && (selectedElement as { deductions?: unknown }).deductions !== null)
          || ((selectedElement as { coveragePerProductUnit?: unknown }).coveragePerProductUnit !== undefined
            && (selectedElement as { coveragePerProductUnit?: unknown }).coveragePerProductUnit !== null)
          || ((selectedElement as { yieldPerUnit?: unknown }).yieldPerUnit !== undefined
            && (selectedElement as { yieldPerUnit?: unknown }).yieldPerUnit !== null) ? (
            <div className="text-[10px] text-sky-300/90">
              {isAr
                ? 'سلسلة محسّنة مطبّقة من التعريف — الكمية من المحرك.'
                : 'Chaîne enrichie appliquée depuis la définition — quantité moteur.'}
            </div>
          ) : null}
        </div>
      )}
      {/* 6) Matériaux & Services — existing bindings output, REVIEW surfaced */}
      {quantity && quantity.ok && bound && (
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 space-y-2">
          <div className="text-xs font-bold text-slate-200">6) {isAr ? 'المواد والخدمات' : 'Matériaux & Services'}</div>
          {bound.issues.length > 0 && (
            <div className="text-[11px] text-amber-200 bg-amber-950/30 border border-amber-500/30 rounded-xl px-2.5 py-2 space-y-0.5">
              {bound.issues.map((issue, idx) => (
                <div key={idx}>REVIEW: {issue.message}</div>
              ))}
            </div>
          )}
          <div>
            <div className="text-[11px] font-bold text-slate-300 mb-1">{isAr ? 'المواد' : 'Matériaux'}</div>
            {bound.materialItems.length === 0 ? (
              <div className="text-[11px] text-slate-500">
                {isAr ? 'لا توجد مواد مرتبطة' : 'Aucun matériau lié (voir REVIEW).'}
              </div>
            ) : (
              <div className="space-y-1">
                {bound.materialItems.map((m) => (
                  <div
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[11px] bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5"
                  >
                    <span className="text-slate-200 font-bold flex-1 min-w-[40%] truncate">{m.nameFr}</span>
                    <span className="font-mono text-slate-300">{m.qty} {m.unit}</span>
                    <span className="font-mono text-slate-400">
                      {m.unitPriceTnd > 0
                        ? `${m.unitPriceTnd.toFixed(2)} ${currency}`
                        : (isAr ? 'السعر غير متوفر' : 'Prix non disponible')}
                    </span>
                    <span className="font-mono text-amber-300 font-bold">
                      {m.totalTnd > 0 ? `${m.totalTnd.toFixed(2)} ${currency}` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-300 mb-1">{isAr ? 'الخدمات' : 'Services'}</div>
            {bound.serviceItems.length === 0 ? (
              <div className="text-[11px] text-slate-500">
                {isAr ? 'اليد العاملة غير مهيكلة' : "Main d'œuvre non configurée"}
              </div>
            ) : (
              <div className="space-y-1">
                {bound.serviceItems.map((s, idx) => (
                  <div
                    key={idx}
                    className="flex flex-wrap items-center justify-between gap-x-3 text-[11px] bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5"
                  >
                    <span className="text-slate-200 font-bold">{s.nameFr}</span>
                    <span className="font-mono text-slate-300">{s.qty} {s.unit}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 7) Fiscalité & Total — computeFiscalData chain via the adapter */}
      {quantity && quantity.ok && bound && fiscal && (
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3 space-y-1.5">
          <div className="text-xs font-bold text-slate-200">7) {isAr ? 'الإجراءات الضريبية والمجمل' : 'Fiscalité & Total'}</div>
          {fiscalRows.map((row, idx) => (
            <div key={idx} className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">{row.label}</span>
              <span className="font-mono text-slate-200">
                {row.sign ? `${row.sign} ` : ''}{row.value.toFixed(2)} {currency}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between text-xs font-black text-white border-t border-slate-800 pt-1.5">
            <span>{isAr ? 'المجموع بكل الضرائب (TTC)' : 'Total TTC'}</span>
            <span className="font-mono text-amber-300">{fiscal.totalTtcTnd.toFixed(2)} {currency}</span>
          </div>
          <div className="flex items-center justify-between text-xs font-black text-emerald-400">
            <span>{isAr ? 'الصافي للدفع' : 'Net à payer'}</span>
            <span className="font-mono">{fiscal.netAPayerTnd.toFixed(2)} {currency}</span>
          </div>
          <div className="text-[10px] text-slate-500">
            {isAr ? 'اليد العاملة' : "Main d'œuvre"}:{' '}
            {bound.serviceItems.length > 0
              ? (isAr ? 'مرتبطة أعلاه (غير مسعّرة)' : 'liée ci-dessus (non chiffrée)')
              : (isAr ? 'غير مهيكلة' : 'non configurée')}{' '}
            — {fiscal.estimatedLaborTnd.toFixed(2)} {currency}
          </div>
        </div>
      )}

      {/* Actions — only with a valid live result */}
      {quantity && quantity.ok && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleAddAllToDevis}
            disabled={devisItems.length === 0}
            className="px-4 py-2.5 rounded-xl bg-amber-400 text-slate-950 text-xs font-black disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isAr ? 'أضف إلى التقرير' : 'Ajouter au devis'}
          </button>
          <button
            type="button"
            onClick={handleShareWhatsApp}
            className="px-4 py-2.5 rounded-xl bg-emerald-500 text-slate-950 text-xs font-black"
          >
            📱 WhatsApp
          </button>
          {addedFlash && (
            <span className="text-xs text-emerald-400 self-center font-bold">
              {isAr ? 'تمت الإضافة ✓' : 'Ajouté ✓'}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default MetreDirectTab;


