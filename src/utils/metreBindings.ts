// @ts-nocheck
/**
 * Universal Professional Métré — Phase 2 binding model (data-driven).
 *
 * Maps Métré outputs to materials/services WITHOUT inventing prices or units.
 * Unresolved bindings must remain REVIEW.
 */

import type { MetreQtyUnit } from '../data/metreElements';

export type BindingDriver =
  | { type: 'metre_qty' }
  | { type: 'dimension'; key: string }
  | { type: 'constant'; value: number; unit: MetreQtyUnit };

export type MaterialBinding = {
  slotCode?: string;
  materialCode?: string;
  driver: BindingDriver;
  coefficient?: { value: number };
  coveragePerProductUnit?: { value: number; unit: MetreQtyUnit; basis: MetreQtyUnit };
  wastePercent?: number;
  outputUnit?: MetreQtyUnit;
};

export type ServiceBinding = {
  serviceId?: string;
  serviceNameFr?: string;
  driver: BindingDriver;
  coefficient?: { value: number };
  wastePercent?: number;
  outputUnit: MetreQtyUnit;
};

export type MetreBindingsSpec = {
  materialBindings?: MaterialBinding[];
  serviceBindings?: ServiceBinding[];
};

export type ReviewIssue = {
  type:
    | 'unresolved_material'
    | 'unresolved_service'
    | 'missing_binding'
    | 'invalid_binding'
    | 'price_unavailable';
  message: string;
  binding?: any;
};

export function parseBindings(spec: any): MetreBindingsSpec {
  const out: MetreBindingsSpec = {};
  if (!spec || typeof spec !== 'object') return out;
  if (Array.isArray(spec.materialBindings)) out.materialBindings = spec.materialBindings;
  if (Array.isArray(spec.serviceBindings)) out.serviceBindings = spec.serviceBindings;
  return out;
}
