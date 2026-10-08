import { getDatabase } from '../db/client';
import { calcRules, materialCalcLinks } from '../db/schema';
import { and, eq } from 'drizzle-orm';

export interface CalcRuleMatch {
  slotCode: string;
  ruleCode: string;
  legacyKey?: string | null;
}

/** Pure helper: generate simple legacy-key candidates from a canonical code */
export function generateLegacyCandidates(code: string): string[] {
  if (!code) return [];
  const candidates = [code];
  const underscored = code.replace(/-/g, '_');
  if (underscored !== code) candidates.push(underscored);
  return candidates;
}

/** Pure helper: pick a matching rule from an array of calc_rule rows (seed-like) */
export function selectMatchingRuleFromList(rules: any[], code: string): CalcRuleMatch | null {
  if (!rules || !code) return null;
  // 1) exact material_code match
  for (const r of rules) {
    if (r.materialCode && r.materialCode === code && r.isActive) return { slotCode: r.slotCode, ruleCode: r.code, legacyKey: r.legacyKey };
  }
  // 2) legacy_key match or underscored candidate
  const candidates = generateLegacyCandidates(code);
  for (const r of rules) {
    if (!r.legacyKey) continue;
    for (const c of candidates) {
      if (r.legacyKey === c && r.isActive) return { slotCode: r.slotCode, ruleCode: r.code, legacyKey: r.legacyKey };
    }
  }
  return null;
}

/** Find an existing calc rule for a given material canonical `code`/`materialId`.
 * Returns null when no reliable (active) rule is found.
 */
export async function findRuleForMaterial(params: { code?: string; materialId?: string; trade?: string }, tx?: any): Promise<CalcRuleMatch | null> {
  const db = tx || (await getDatabase());
  if (!db) return null;
  const code = params.code || '';
  // Step A — try direct material_code match
  const byMaterial = await db.select().from(calcRules).where(eq(calcRules.materialCode, code)).limit(1);
  if (byMaterial && byMaterial[0] && byMaterial[0].isActive) {
    return { slotCode: byMaterial[0].slotCode, ruleCode: byMaterial[0].code, legacyKey: byMaterial[0].legacyKey };
  }
  // Step B — try legacy_key candidates (underscore variant)
  const candidates = generateLegacyCandidates(code);
  if (candidates.length === 0) return null;
  const rows = await db.select().from(calcRules).where(eq(calcRules.isActive, true));
  // Perform in-memory matching to avoid complex SQL and remain deterministic
  const match = selectMatchingRuleFromList(rows, code);
  return match;
}

/** Idempotent insert/update of material_calc_links rows.
 * If a matching row exists (materialId + matchKey) update `isActive` and `updatedAt`.
 * Otherwise insert a new row.
 */
export async function upsertMaterialCalcLink(data: { materialId: string; slotCode: string; ruleCode?: string | null; matchKey: string }, tx?: any) {
  const db = tx || (await getDatabase());
  if (!db) throw new Error('Database not available');
  // Use Postgres ON CONFLICT DO UPDATE to make this idempotent and safe
  // under concurrent upserts. Keep the contract unchanged: return the
  // inserted/updated row when possible.
  try {
    const insert = db.insert(materialCalcLinks).values({
      materialId: data.materialId,
      slotCode: data.slotCode,
      ruleCode: data.ruleCode ?? null,
      matchKey: data.matchKey,
      isActive: true,
    }).onConflictDoUpdate({
      target: [materialCalcLinks.materialId, materialCalcLinks.matchKey],
      set: {
        slotCode: data.slotCode,
        ruleCode: data.ruleCode ?? null,
        isActive: true,
        updatedAt: new Date(),
      }
    }).returning();
    const res = await insert;
    return Array.isArray(res) ? res[0] : res;
  } catch (err) {
    // Fallback to the older safe-path in case the DB/driver doesn't support
    // onConflictDoUpdate for some reason in the current environment.
    const existing = await db.select().from(materialCalcLinks).where(and(eq(materialCalcLinks.materialId, data.materialId), eq(materialCalcLinks.matchKey, data.matchKey))).limit(1);
    if (existing && existing[0]) {
      const [updated] = await db.update(materialCalcLinks).set({ isActive: true, slotCode: data.slotCode, ruleCode: data.ruleCode ?? null, updatedAt: new Date() }).where(eq(materialCalcLinks.id, existing[0].id)).returning();
      return updated;
    }
    const [inserted] = await db.insert(materialCalcLinks).values({ materialId: data.materialId, slotCode: data.slotCode, ruleCode: data.ruleCode ?? null, matchKey: data.matchKey }).returning();
    return inserted;
  }
}

export const calcRepository = { findRuleForMaterial, upsertMaterialCalcLink, generateLegacyCandidates, selectMatchingRuleFromList };
