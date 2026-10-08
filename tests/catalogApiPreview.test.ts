// @ts-nocheck
/**
 * Global Catalog - API Preview tests (DB-FREE, no network).
 * Run: npx tsx tests/catalogApiPreview.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { resolveApiResponse } from '../server/services/catalogApiResolver';
import { previewApiImportRows } from '../server/services/catalogApiImportPreview';
function doc(products: unknown) { return { products }; }

test('preview: valid row passes without writes', async () => {
  const r = resolveApiResponse(doc([{ name: 'Plaque', brand: 'ACME' }]), { root: '', collection: 'products', fields: { name: 'name', brand: 'brand' } });
  const out = await previewApiImportRows(r);
  assert.equal(out.summary.total, 1);
  assert.equal(out.items[0].normalized.name, 'Plaque');
  assert.equal(out.items[0].normalized.brand, 'ACME');
});
test('preview: missing name becomes invalid', async () => {
  const r = resolveApiResponse(doc([{ sku: 'S1' }]), { root: '', collection: 'products', fields: { name: 'name' } });
  const out = await previewApiImportRows(r);
  assert.equal(out.summary.invalid, 1);
  assert.match(out.items[0].errors.join(';'), /Missing name/);
});
test('preview: valid gtin kept as identifier, matcher decides match', async () => {
  const m = { root: '', collection: 'products', fields: { name: 'name', gtin: 'ean' } };
  const r = resolveApiResponse(doc([{ name: 'P', ean: '6191234567890' }]), m);
  const noMatch = await previewApiImportRows(r, { matcher: async () => null });
  assert.equal(noMatch.items[0].normalized.identifier_type, 'gtin');
  assert.equal(noMatch.items[0].normalized.identifier_value, '6191234567890');
  const yes = await previewApiImportRows(r, { matcher: async () => '00000000-0000-4000-8000-000000000000' });
  assert.equal(yes.items[0].matchStatus, 'matched');
});
test('preview: invalid gtin surfaces as invalid row', async () => {
  const r = { total: 1, accepted: 1, rejected: 0, rows: [{ index: 0, row: { name: 'P', identifier_type: 'gtin', identifier_value: 'x'.repeat(300) }, unsupported: [], raw: { name: 'P' } }], errors: [] };
  const out = await previewApiImportRows(r as any);
  assert.equal(out.summary.invalid, 1);
});
test('preview: resolver errors become invalid rows', async () => {
  const r = resolveApiResponse(doc([{ name: { fr: 'X' } }]), { root: '', collection: 'products', fields: { name: 'name' } });
  const out = await previewApiImportRows(r);
  assert.equal(out.summary.total, 1);
  assert.equal(out.summary.invalid, 1);
});
test('preview: unsupported price currency availability stay notes only', async () => {
  const m = { root: '', collection: 'products', fields: { name: 'name', price: 'price', currency: 'currency', availability: 'availability' } };
  const r = resolveApiResponse(doc([{ name: 'P', price: 9, currency: 'TND', availability: 'yes' }]), m);
  const out = await previewApiImportRows(r);
  const n = out.items[0].normalized as any;
  assert.ok(!('price' in n));
  assert.ok(!('currency' in n));
  assert.equal(n.available, '');
  assert.equal(out.items[0].errors.length, 0);
  assert.ok(out.items[0].notes.join(';').includes('Unsupported price'));
});
test('preview: module writes nothing', () => {
  const src = readFileSync(resolvePath(process.cwd(), 'server', 'services', 'catalogApiImportPreview.ts'), 'utf8');
  assert.ok(!src.includes('getDatabase'), 'no DB');
  assert.ok(!src.includes('createGlobalProduct'), 'no create');
  assert.ok(!src.includes('upsertGlobalIdentifier'), 'no identifier write');
  assert.ok(!src.includes('setGlobalProductAvailability'), 'no availability write');
  assert.ok(!src.includes('insertImportItems'), 'no import write');
  assert.ok(!src.includes('fetch('), 'no fetch');
});