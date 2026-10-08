/**
 * PHASE 1 — Country-scoped catalog service (ADDITIVE, pure helpers + DB layer).
 * Identity = Country + content-hash (never filename alone).
 * Uses ONLY the new country_catalog* tables + existing trades/materials/prices.
 */
import * as crypto from 'crypto';
export function normalizeCountryCode(v: unknown): string {
  return String(v || 'TN').trim().toUpperCase().slice(0, 5) || 'TN';
}
export function normalizeTradeCode(v: unknown): string {
  return String(v || '').trim().toLowerCase();
}
export function catalogContentHash(rows: Array<{ reference: string; price: number; unit: string; trade: string; category: string }>, currency: string, country: string): string {
  const canon = [...rows]
    .map((r) => [String(r.reference).trim(), Number(r.price).toFixed(3), String(r.unit).trim(), normalizeTradeCode(r.trade), String(r.category || '').trim(), String(currency).toUpperCase(), String(country).toUpperCase()].join('|'))
    .sort();
  return crypto.createHash('sha256').update(canon.join('\n'), 'utf8').digest('hex');
}
/** Calculator rule resolution: DB rows first, static fallback second. */
export async function getCountryCalcRules(countryCode: string, txOrDb?: any): Promise<Record<string, any>> {
  const fallback: Record<string, any> = { default_tva: { rate: 19 }, timbre_fiscal: { amount: 1.0 }, retenue_garantie: { rate: 5 } };
  try {
    const { getDatabase } = await import('../db/client');
    const db = txOrDb || (await getDatabase());
    if (!db) return fallback;
    const ci: any = await import('../db/schema/countryCatalogItems');
    const orm: any = await import('drizzle-orm');
    const rows = await db.select().from(ci.countryCalculationRules)
      .where(orm.and(orm.eq(ci.countryCalculationRules.countryCode, String(countryCode || 'TN').toUpperCase()), orm.eq(ci.countryCalculationRules.isActive, true)));
    const out: Record<string, any> = { ...fallback };
    for (const r of rows) out[String(r.ruleKey)] = r.ruleValue;
    return out;
  } catch { return fallback; }
}
