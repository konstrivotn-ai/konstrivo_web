import { Router, Response } from 'express';
import crypto from 'crypto';
import { createLimiter } from '../../middleware/rateLimit';
import { getPriceSourceSpec } from '../../priceSources/connector';
import { createMalaysiaCidbConnector, SOURCE_MY_CIDB } from '../../priceSources/malaysiaCidb';
import { runSaudiGastatUpdate } from '../../priceSources/saudiPipeline';
import { toGastatRows } from '../../priceSources/saudiConstruction';
import { submitPendingPriceUpdate } from '../../repositories/drizzlePriceRepository';

const router = Router();
const machinePriceUpdateLimiter = createLimiter('default', { max: 5, windowMs: 15 * 60 * 1000 });

function safeSecretEquals(candidate: string | undefined, expected: string | undefined): boolean {
  if (!candidate || !expected) return false;
  try {
    const a = Buffer.from(candidate, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

router.post('/price-update',
  machinePriceUpdateLimiter,
  async (req: any, res: Response, next: any) => {
    try {
      const providedSecret = Array.isArray(req.headers['x-price-update-token'])
        ? req.headers['x-price-update-token'][0]
        : req.headers['x-price-update-token'];
      const expectedSecret = process.env.PRICE_UPDATE_MACHINE_SECRET;

      if (!expectedSecret) {
        return res.status(500).json({ error: 'Machine secret not configured' });
      }

      if (!safeSecretEquals(providedSecret, expectedSecret)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const sourceCode = typeof req.body?.sourceCode === 'string' ? req.body.sourceCode : undefined;
      if (!sourceCode) {
        return res.status(400).json({ error: 'Invalid or missing sourceCode' });
      }

      const spec = getPriceSourceSpec(sourceCode);
      if (!spec || !spec.enabled) {
        return res.status(501).json({ error: `Source '${sourceCode}' not registered or not implemented` });
      }

      if (sourceCode === 'SOURCE_SA_GASTAT') {
        // Official GASTAT rows supplied by the authorized machine caller
        // (transcribed from the officially downloaded GASTAT monthly file). No live
        // fetch and no invented data: absent/empty rows keeps the 501 path below.
        const rows = toGastatRows(req.body?.rows);
        if (rows.length === 0) {
          return res.status(501).json({
            sourceCode,
            market: 'SA',
            currency: 'SAR',
            submitted: 0,
            rejected: 0,
            errors: ['GASTAT data source not available: no official rows supplied. POST { sourceCode: "SOURCE_SA_GASTAT", rows: [{ label, unit, price, month }] } with rows transcribed from the officially downloaded GASTAT monthly file — prices are never fetched live or invented.'],
          });
        }

        const result = await runSaudiGastatUpdate(rows);
        return res.json({
          sourceCode,
          market: 'SA',
          currency: 'SAR',
          submitted: result.submitted,
          rejected: result.rejected,
          errors: result.errors,
        });
      }

      if (sourceCode === SOURCE_MY_CIDB) {
        try {
          const connector = createMalaysiaCidbConnector({
            token: process.env.CIDB_API_TOKEN,
            baseUrl: process.env.CIDB_API_BASE_URL,
          });
          const candidates = await connector.fetchCandidates();
          const submittedRows = [] as any[];
          const errors = [] as any[];

          for (const candidate of candidates) {
            try {
              const row = await submitPendingPriceUpdate({
                materialCode: candidate.materialCode,
                price: candidate.price,
                countryCode: candidate.market,
                currencyCode: candidate.currency,
                effectiveFrom: candidate.effectiveFrom,
                notes: candidate.notes || `CIDB ${candidate.sourceCode}`,
              });
              submittedRows.push(row);
            } catch (err: any) {
              errors.push({ materialCode: candidate.materialCode, reason: err?.message || 'pending submission failed' });
            }
          }

          return res.json({
            sourceCode,
            market: 'MY',
            currency: 'MYR',
            submitted: submittedRows.length,
            rejected: errors.length,
            errors,
          });
        } catch (err: any) {
          return res.status(502).json({
            sourceCode,
            market: 'MY',
            currency: 'MYR',
            submitted: 0,
            rejected: 0,
            error: err?.message || 'CIDB API request failed and produced no usable prices',
          });
        }
      }

      return res.status(501).json({ error: `No orchestration registered for source '${sourceCode}'` });
    } catch (err) {
      next(err);
    }
  }
);

export { router as machineRouter };
