// @ts-nocheck
/**
 * Universal Professional Métré — Phase 2 bridge.
 *
 * Computes material/service quantities from a Dynamic Métré element + dims,
 * without changing official calculators or Devis contracts.
 */

import type { MaterialRate, MaterialItemResult } from '../types';
import type { MetreElementDef } from '../data/metreElements';
import type { MetreQtyLine } from './metreEngine';
import { aggregateQuantities, evaluateElement } from './metreEngine';
import { parseBindings, type ReviewIssue, type MaterialBinding, type ServiceBinding } from './metreBindings';

function round3(n: number): number { return Math.round(n * 1000) / 1000; }

function applyWaste(qty: number, wastePercent?: number | null): number {
  const w = Number(wastePercent ?? 0);
  if (!Number.isFinite(w) || w <= 0) return qty;
  return qty * (1 + w / 100);
}

function qtyFromDriver(binding: any, metreQty: number, metreUnit: string, dims: Record<string, any>): { qty: number; unit: string } | null {
  const d = binding?.driver;
  if (!d || typeof d !== 'object') return null;
  if (d.type === 'metre_qty') return { qty: metreQty, unit: metreUnit };
  if (d.type === 'dimension') {
    const v = Number(dims?.[d.key]);
    if (!Number.isFinite(v) || v < 0) return null;
    return { qty: v, unit: String(binding.outputUnit || metreUnit) };
  }
  if (d.type === 'constant') {
    const v = Number(d.value);
    if (!Number.isFinite(v) || v < 0) return null;
    return { qty: v, unit: String(d.unit) };
  }
  return null;
}

function applyCoverage(qty: number, basisUnit: string, cov?: any): { qty: number; unit: string } | null {
  if (!cov) return { qty, unit: basisUnit };
  const v = Number(cov.value);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (String(cov.basis) !== basisUnit) return null;
  return { qty: qty / v, unit: String(cov.unit) };
}

export type MetreCalculationOutput = {
  materialItems: MaterialItemResult[];
  serviceItems: Array<{ nameFr: string; qty: number; unit: string }>;
  issues: ReviewIssue[];
  totals: Record<string, number>;
};

export function computeMetreBoundOutputs(args: {
  metreElement: MetreElementDef;
  metreDims: Record<string, any>;
  metreLines: MetreQtyLine[];
  rates: MaterialRate[];
}): MetreCalculationOutput {
  const { metreElement, metreDims, metreLines, rates } = args;
  const totals = aggregateQuantities(metreLines.map((l) => ({ qty: l.qty, unit: l.unit })));
  const issues: ReviewIssue[] = [];
  const materialItems: MaterialItemResult[] = [];
  const serviceItems: Array<{ nameFr: string; qty: number; unit: string }> = [];

  const spec = parseBindings({
    materialBindings: (metreElement as any).materialBindings,
    serviceBindings: (metreElement as any).serviceBindings,
  });

  const hasAny = (spec.materialBindings?.length || 0) + (spec.serviceBindings?.length || 0);
  if (!hasAny) {
    issues.push({ type: 'missing_binding', message: `No bindings configured for ${metreElement.trade}/${metreElement.code}` });
    return { materialItems, serviceItems, issues, totals };
  }

  const preview = evaluateElement(metreElement, metreDims);
  if (!preview.ok) {
    issues.push({ type: 'invalid_binding', message: 'Cannot bind: invalid metre dimensions' });
    return { materialItems, serviceItems, issues, totals };
  }

  const metreQty = Number(preview.qty);
  const metreUnit = String(preview.unit);

  for (const b of (spec.materialBindings || []) as MaterialBinding[]) {
    const base = qtyFromDriver(b, metreQty, metreUnit, metreDims);
    if (!base) { issues.push({ type: 'invalid_binding', message: 'Invalid material driver', binding: b }); continue; }
    const coef = Number(b.coefficient?.value ?? 1);
    if (!Number.isFinite(coef) || coef <= 0) { issues.push({ type: 'invalid_binding', message: 'Invalid coefficient', binding: b }); continue; }

    let qty = base.qty * coef;
    const covered = applyCoverage(qty, base.unit, b.coveragePerProductUnit);
    if (!covered) { issues.push({ type: 'invalid_binding', message: 'Invalid coveragePerProductUnit', binding: b }); continue; }

    qty = applyWaste(covered.qty, b.wastePercent);
    const outUnit = covered.unit;

    const code = String(b.materialCode || '').trim();
    const rate = code ? rates.find((r) => String(r.id).trim() === code) : null;
    if (!rate) { issues.push({ type: 'unresolved_material', message: `Unresolved material '${code || '∅'}'`, binding: b }); continue; }

    const unitPrice = Number(rate.unitPriceTnd);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      issues.push({ type: 'price_unavailable', message: `Price unavailable for '${rate.id}'`, binding: b });
      continue;
    }

    materialItems.push({
      id: rate.id,
      nameFr: rate.nameFr,
      nameAr: rate.nameAr,
      qty: round3(qty),
      unit: outUnit,
      unitPriceTnd: unitPrice,
      totalTnd: round3(qty * unitPrice),
      category: rate.category,
      formulaUsed: `metre_binding(${metreUnit}→${outUnit})`,
    });
  }

  for (const s of (spec.serviceBindings || []) as ServiceBinding[]) {
    const base = qtyFromDriver(s, metreQty, metreUnit, metreDims);
    if (!base) { issues.push({ type: 'invalid_binding', message: 'Invalid service driver', binding: s }); continue; }
    const coef = Number(s.coefficient?.value ?? 1);
    if (!Number.isFinite(coef) || coef <= 0) { issues.push({ type: 'invalid_binding', message: 'Invalid coefficient', binding: s }); continue; }
    const qty = applyWaste(base.qty * coef, s.wastePercent);
    const nameFr = String(s.serviceNameFr || s.serviceId || '').trim();
    if (!nameFr) { issues.push({ type: 'unresolved_service', message: 'Unresolved service (no name/id)', binding: s }); continue; }
    serviceItems.push({ nameFr, qty: round3(qty), unit: String(s.outputUnit || base.unit) });
  }

  return { materialItems, serviceItems, issues, totals };
}
