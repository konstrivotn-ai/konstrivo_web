// @ts-nocheck
/**
 * Global Catalog — minimal focused tests
 *
 * These tests are PURE (no DB required) where possible, to stay runnable in
 * environments without DATABASE_URL.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { previewGlobalCatalogImport } from '../server/services/globalCatalogImport';

function csvBuf(text: string): Buffer {
  return Buffer.from(text, 'utf-8');
}

test('global catalog import preview: identifier match requires both fields', async () => {
  const csv = [
    'name,identifier_type,identifier_value,country,available',
    'Cement 42.5R,gtin,,TN,yes',
  ].join('\n');
  const out = await previewGlobalCatalogImport({ fileType: 'csv', buffer: csvBuf(csv), countryFallback: 'TN' });
  assert.equal(out.summary.total, 1);
  assert.equal(out.items[0].errors.length > 0, true);
});

test('global catalog import preview: rows without identifier are review_required', async () => {
  const csv = [
    'name,brand,country,available',
    'Cement 42.5R,ACME,TN,yes',
  ].join('\n');
  const out = await previewGlobalCatalogImport({ fileType: 'csv', buffer: csvBuf(csv), countryFallback: 'TN' });
  assert.equal(out.items[0].matchStatus, 'review_required');
});
