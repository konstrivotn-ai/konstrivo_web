/**
 * PHASE 1 — Country catalog read API (ADDITIVE, read-only).
 * Existing 6 endpoints UNCHANGED below; new catalog/rules endpoints appended.
 */
import { Router } from 'express';
import { getDatabase } from '../../db/client';
import {
  countries, currencies, fxRates, taxRules,
  unitsOfMeasure, unitConversions,
} from '../../db/schema';
import { and, desc, eq } from 'drizzle-orm';

export const referenceRouter = Router();

referenceRouter.get('/countries', async (_req, res, next) => {
  try {
    const db = await getDatabase();
    if (!db) return res.status(503).json({ error: 'Database not available' });
    const rows = await db.select().from(countries).where(eq(countries.isActive, true));
    res.json({ data: rows });
  } catch (err) { next(err); }
});

referenceRouter.get('/currencies', async (_req, res, next) => {
  try {
    const db = await getDatabase();
    if (!db) return res.status(503).json({ error: 'Database not available' });
    const rows = await db.select().from(currencies).where(eq(currencies.isActive, true));
    res.json({ data: rows });
  } catch (err) { next(err); }
});

referenceRouter.get('/fx-rates', async (req, res, next) => {
  try {
    const db = await getDatabase();
    if (!db) return res.status(503).json({ error: 'Database not available' });
    const base = typeof req.query.base === 'string' ? req.query.base.toUpperCase() : undefined;
    const rows = base
      ? await db.select().from(fxRates).where(eq(fxRates.baseCurrency, base)).orderBy(desc(fxRates.effectiveFrom))
      : await db.select().from(fxRates).orderBy(desc(fxRates.effectiveFrom));
    res.json({ data: rows });
  } catch (err) { next(err); }
});

referenceRouter.get('/tax-rules', async (req, res, next) => {
  try {
    const db = await getDatabase();
    if (!db) return res.status(503).json({ error: 'Database not available' });
    const country = typeof req.query.country === 'string' ? req.query.country.toUpperCase() : undefined;
    const rows = country
      ? await db.select().from(taxRules).where(and(eq(taxRules.countryCode, country), eq(taxRules.isActive, true)))
      : await db.select().from(taxRules).where(eq(taxRules.isActive, true));
    res.json({ data: rows });
  } catch (err) { next(err); }
});

referenceRouter.get('/units', async (_req, res, next) => {
  try {
    const db = await getDatabase();
    if (!db) return res.status(503).json({ error: 'Database not available' });
    const rows = await db.select().from(unitsOfMeasure).where(eq(unitsOfMeasure.isActive, true));
    res.json({ data: rows });
  } catch (err) { next(err); }
});

referenceRouter.get('/unit-conversions', async (_req, res, next) => {
  try {
    const db = await getDatabase();
    if (!db) return res.status(503).json({ error: 'Database not available' });
    const rows = await db.select().from(unitConversions);
    res.json({ data: rows });
  } catch (err) { next(err); }
});
// PHASE 1 — active catalog + rules per country (calculator reads these).
referenceRouter.get('/catalog-active', async (req, res, next) => {
  try {
    const db = await getDatabase();
    if (!db) return res.status(503).json({ error: 'Database not available' });
    const cc: any = await import('../../db/schema/countryCatalog');
    const ci: any = await import('../../db/schema/countryCatalogItems');
    const country = String(req.query.country || 'TN').toUpperCase();
    const active = await db.select().from(cc.countryCatalogs)
      .where(and(eq(cc.countryCatalogs.countryCode, country), eq(cc.countryCatalogs.isActive, true))).limit(1);
    if (!active[0]) return res.json({ data: null });
    const items = await db.select().from(ci.countryCatalogItems)
      .where(and(eq(ci.countryCatalogItems.catalogId, active[0].id), eq(ci.countryCatalogItems.isActive, true)));
    res.json({ data: { catalog: active[0], items } });
  } catch (err) { next(err); }
});
referenceRouter.get('/calc-rules', async (req, res, next) => {
  try {
    const db = await getDatabase();
    if (!db) return res.status(503).json({ error: 'Database not available' });
    const { countryCalculationRules } = await import('../../db/schema/countryCatalogItems');
    const country = String(req.query.country || 'TN').toUpperCase();
    const rows = await db.select().from(countryCalculationRules)
      .where(and(eq(countryCalculationRules.countryCode, country), eq(countryCalculationRules.isActive, true)));
    res.json({ data: rows });
  } catch (err) { next(err); }
});
