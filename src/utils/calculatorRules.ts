export type CalcRuleStatus = 'configured' | 'missing' | 'resolved';

export interface CalcSlotDefinition {
  code: string;
  label: string;
  trade: string;
  materialKey?: string;
  aliases?: string[];
}

export interface CalcRuleDefinition {
  code: string;
  trade: string;
  slotCode: string;
  legacyKey?: string;
  materialCode?: string;
  aliases?: string[];
  description?: string;
}

export interface MaterialCalcRuleInput {
  code?: string | null;
  trade?: string | null;
  materialId?: string | null;
  legacyKey?: string | null;
}

export interface MaterialCalcResolution {
  status: CalcRuleStatus;
  legacyKey?: string;
  price?: number;
  slotCode?: string;
  ruleCode?: string;
  message?: string;
}

export const calcSlots: Record<string, CalcSlotDefinition> = {
  placo_board: { code: 'placo_board', label: 'Plaque BA13 / plâtre', trade: 'placo', aliases: ['plaque-ba13-standard-3m', 'plaque-ba13-standard-2m5', 'plaque_ba13_standard'] },
  placo_furrings: { code: 'placo_furrings', label: 'Fourrures', trade: 'placo', aliases: ['fourrure-f47', 'fourrure'] },
  placo_rail: { code: 'placo_rail', label: 'Rail', trade: 'placo', aliases: ['rail-48', 'rail-70', 'rail_48', 'rail_70'] },
  placo_montant: { code: 'placo_montant', label: 'Montant', trade: 'placo', aliases: ['montant-48', 'montant-70', 'montant_48', 'montant_70'] },
  placo_joint: { code: 'placo_joint', label: 'Joint / bande', trade: 'placo', aliases: ['bande-joint', 'bande-arm', 'bande_a_joint_90m'] },
  placo_enduit: { code: 'placo_enduit', label: 'Enduit / colle', trade: 'placo', aliases: ['enduit-25kg', 'enduit-colle-25', 'enduit_joint_25kg', 'colle_gypse_25kg'] },
  placo_fastener: { code: 'placo_fastener', label: 'Vis/attaches', trade: 'placo', aliases: ['vis-placo-1000', 'vis-trpf-1000', 'vis_placo_25', 'vis_trpf'] },
  placo_insulation: { code: 'placo_insulation', label: 'Isolation', trade: 'placo', aliases: ['laine-verre-12', 'laine_de_verre_50mm'] },
  tile_plinth: { code: 'tile_plinth', label: 'Plinthe', trade: 'carrelage', aliases: ['plinthes-mdf-decor-2-4m', 'plinthes_carrelage'] },
};

export const calcRules: Record<string, CalcRuleDefinition> = {
  placo_ba13_standard: { code: 'placo_ba13_standard', trade: 'placo', slotCode: 'placo_board', legacyKey: 'plaque_ba13_standard', materialCode: 'plaque-ba13-standard-3m', aliases: ['plaque-ba13-standard-3m', 'plaque-ba13-standard-2m5', 'plaque_ba13_standard'] },
  placo_ba13_hydrofuge: { code: 'placo_ba13_hydrofuge', trade: 'placo', slotCode: 'placo_board', legacyKey: 'plaque_ba13_hydrofuge', materialCode: 'plaque-ba13-hydro', aliases: ['plaque-ba13-hydro', 'plaque_ba13_hydrofuge'] },
  placo_furrings: { code: 'placo_furrings', trade: 'placo', slotCode: 'placo_furrings', legacyKey: 'fourrure', materialCode: 'fourrure-f47', aliases: ['fourrure-f47', 'fourrure'] },
  placo_rail_48: { code: 'placo_rail_48', trade: 'placo', slotCode: 'placo_rail', legacyKey: 'rail_48', materialCode: 'rail-48', aliases: ['rail-48', 'rail_48'] },
  placo_rail_70: { code: 'placo_rail_70', trade: 'placo', slotCode: 'placo_rail', legacyKey: 'rail_70', materialCode: 'rail-70', aliases: ['rail-70', 'rail_70'] },
  placo_montant_48: { code: 'placo_montant_48', trade: 'placo', slotCode: 'placo_montant', legacyKey: 'montant_48', materialCode: 'montant-48', aliases: ['montant-48', 'montant_48'] },
  placo_montant_70: { code: 'placo_montant_70', trade: 'placo', slotCode: 'placo_montant', legacyKey: 'montant_70', materialCode: 'montant-70', aliases: ['montant-70', 'montant_70'] },
  placo_joint: { code: 'placo_joint', trade: 'placo', slotCode: 'placo_joint', legacyKey: 'bande_a_joint_90m', materialCode: 'bande-joint', aliases: ['bande-joint', 'bande-arm', 'bande_a_joint_90m'] },
  placo_enduit: { code: 'placo_enduit', trade: 'placo', slotCode: 'placo_enduit', legacyKey: 'enduit_joint_25kg', materialCode: 'enduit-25kg', aliases: ['enduit-25kg', 'enduit_joint_25kg'] },
  placo_colle: { code: 'placo_colle', trade: 'placo', slotCode: 'placo_enduit', legacyKey: 'colle_gypse_25kg', materialCode: 'enduit-colle-25', aliases: ['enduit-colle-25', 'colle_gypse_25kg'] },
  placo_vis: { code: 'placo_vis', trade: 'placo', slotCode: 'placo_fastener', legacyKey: 'vis_placo_25', materialCode: 'vis-placo-1000', aliases: ['vis-placo-1000', 'vis_placo_25'] },
  placo_insulation: { code: 'placo_insulation', trade: 'placo', slotCode: 'placo_insulation', legacyKey: 'laine_de_verre_50mm', materialCode: 'laine-verre-12', aliases: ['laine-verre-12', 'laine_de_verre_50mm'] },
  carrelage_plinth: { code: 'carrelage_plinth', trade: 'carrelage', slotCode: 'tile_plinth', legacyKey: 'plinthes_carrelage', materialCode: 'plinthes-mdf-decor-2-4m', aliases: ['plinthes-mdf-decor-2-4m', 'plinthes_carrelage'] },
};

export function normalizeMaterialCalcKey(input?: string | null): string | null {
  if (!input) return null;
  return input.trim().toLowerCase();
}

function matchesCalculatorRule(rule: CalcRuleDefinition, key: string | null, trade?: string | null): boolean {
  if (!key) return false;
  const t = (trade || '').trim().toLowerCase();
  if (t && rule.trade !== t) return false;
  const aliasMatch = rule.aliases?.some(alias => normalizeMaterialCalcKey(alias) === key) || false;
  const legacyMatch = normalizeMaterialCalcKey(rule.legacyKey) === key;
  const materialMatch = normalizeMaterialCalcKey(rule.materialCode) === key;
  return aliasMatch || legacyMatch || materialMatch;
}

export function resolveMaterialCalcRule(input: MaterialCalcRuleInput): {
  status: 'configured' | 'missing';
  slotCode?: string;
  ruleCode?: string;
  legacyKey?: string;
  message?: string;
} {
  const key = normalizeMaterialCalcKey(input.code ?? input.legacyKey ?? input.materialId ?? null);
  if (!key) return { status: 'missing', message: 'Rule not configured' };

  const rule = Object.values(calcRules).find(r => matchesCalculatorRule(r, key, input.trade));
  if (!rule) return { status: 'missing', message: 'Rule not configured' };

  return {
    status: 'configured',
    slotCode: rule.slotCode,
    ruleCode: rule.code,
    legacyKey: rule.legacyKey,
  };
}

export function resolveCalculatorRuleForMaterial(material: MaterialCalcRuleInput): {
  status: 'configured' | 'missing';
  slotCode?: string;
  ruleCode?: string;
  legacyKey?: string;
  message?: string;
} {
  const direct = resolveMaterialCalcRule(material);
  if (direct.status === 'configured') return direct;

  const fallbackKey = normalizeMaterialCalcKey(material.code ?? material.materialId ?? material.legacyKey ?? null);
  if (!fallbackKey) return { status: 'missing', message: 'Rule not configured' };

  const activeSlot = Object.values(calcSlots).find(slot =>
    slot.aliases?.some(alias => normalizeMaterialCalcKey(alias) === fallbackKey)
  );

  if (!activeSlot) return { status: 'missing', message: 'Rule not configured' };

  const matchingRule = Object.values(calcRules).find(rule => rule.slotCode === activeSlot.code && matchesCalculatorRule(rule, fallbackKey, material.trade));
  if (!matchingRule) return { status: 'missing', message: 'Rule not configured' };

  return {
    status: 'configured',
    slotCode: matchingRule.slotCode,
    ruleCode: matchingRule.code,
    legacyKey: matchingRule.legacyKey,
  };
}

export function resolveRuntimeMaterialPrice(
  material: { code?: string | null; materialId?: string | null; price?: number | null; trade?: string | null },
  rates: Array<{ id?: string; code?: string; unitPriceTnd?: number; defaultPriceTnd?: number }> = []
): MaterialCalcResolution {
  const rule = resolveCalculatorRuleForMaterial(material);
  if (rule.status === 'missing') {
    return { status: 'missing', message: 'Rule not configured' };
  }

  const legacyKey = rule.legacyKey || material.materialId || material.code || null;
  const exactRate = rates.find(r => (r.id && r.id === legacyKey) || (r.code && r.code === material.code));
  const price = typeof material.price === 'number'
    ? material.price
    : (exactRate?.unitPriceTnd ?? exactRate?.defaultPriceTnd ?? 0);

  return {
    status: 'resolved',
    legacyKey: legacyKey || undefined,
    slotCode: rule.slotCode,
    ruleCode: rule.ruleCode,
    price,
  };
}

export function resolveCanonicalMaterialPrice(
  material: { code?: string | null; materialId?: string | null; price?: number | null },
  rates: Array<{ id?: string; code?: string; unitPriceTnd?: number; defaultPriceTnd?: number }>
): MaterialCalcResolution {
  const rule = resolveCalculatorRuleForMaterial(material);
  if (rule.status === 'missing') {
    return { status: 'missing', message: 'Rule not configured' };
  }

  const legacyKey = rule.legacyKey || material.materialId || material.code || null;
  const exactRate = rates.find(r => (r.id && r.id === legacyKey) || (r.code && r.code === material.code));
  const price = typeof material.price === 'number'
    ? material.price
    : (exactRate?.unitPriceTnd ?? exactRate?.defaultPriceTnd ?? 0);

  return {
    status: 'resolved',
    legacyKey: legacyKey || undefined,
    slotCode: rule.slotCode,
    ruleCode: rule.ruleCode,
    price,
  };
}
