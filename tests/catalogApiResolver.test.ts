// @ts-nocheck
/**
 * Global Catalog - API Resolver tests (DB-FREE, no network).
 * Run: npx tsx tests/catalogApiResolver.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  API_RESOLVER_MAX_PRODUCTS,
  API_RESOLVER_MAX_VALUE_LENGTH,
  getApiPathValue,
  resolveApiResponse,
} from '../server/services/catalogApiResolver';

const BASE = { root: '', collection: 'products', fields: { name: 'name' } };
function doc(products: unknown, root = '') {
  return root ? { data: { products } } : { products };
}

test('resolver: nested root+collection+dot paths resolve', () => {
  const out = resolveApiResponse(
    { data: { products: [{ title: { fr: 'Plaque' } }] } },
    { root: 'data', collection: 'products', fields: { name: 'title.fr' } },
  );
  assert.equal(out.accepted, 1);
  assert.equal(out.rows[0].row.name, 'Plaque');
});

test('resolver: indexed segment resolves', () => {
  const out = resolveApiResponse(doc([{ codes: ['A', 'B'] }]), { root: '', collection: 'products', fields: { name: 'codes[0]' } });
  assert.equal(out.rows[0].row.name, 'A');
});

test('resolver: missing name rejects the row only', () => {
  const out = resolveApiResponse(doc([{ sku: 'S1' }, { name: 'Ok' }]), { root: '', collection: 'products', fields: { name: 'name', sku: 'sku' } });
  assert.equal(out.accepted, 1);
  assert.equal(out.rejected, 1);
  assert.match(out.errors[0].reasons.join(';'), /Missing name/);
});

test('resolver: price currency availability never reach product columns', () => {
  const m = { root: '', collection: 'products', fields: { name: 'name', price: 'price', currency: 'currency', availability: 'availability' } };
  const out = resolveApiResponse(doc([{ name: 'P', price: 99, currency: 'TND', availability: 'in_stock' }]), m);
  assert.equal(out.accepted, 1);
  const row = out.rows[0].row as any;
  assert.equal(row.price, undefined);
  assert.equal(row.currency, undefined);
  assert.equal(row.available, undefined);
  assert.equal(out.rows[0].unsupported.length, 3);
});

test('resolver: gtin normalizes without inventing merge', () => {
  const m = { root: '', collection: 'products', fields: { name: 'name', gtin: 'ean' } };
  const out = resolveApiResponse(doc([{ name: 'P', ean: ' 6191234567890 ' }]), m);
  assert.equal(out.rows[0].row.identifier_type, 'gtin');
  assert.equal(out.rows[0].row.identifier_value, '6191234567890');
});

test('resolver: objects and arrays as values are rejected', () => {
  const out = resolveApiResponse(doc([{ name: { fr: 'X' } }, { name: ['X'] }]), BASE);
  assert.equal(out.accepted, 0);
  assert.equal(out.rejected, 2);
});

test('resolver: dangerous segments fail closed', () => {
  assert.throws(() => getApiPathValue({ a: 1 }, '__proto__.x'), /forbidden/);
  assert.throws(() => getApiPathValue({ a: 1 }, 'a.constructor'), /forbidden/);
  const bad = { root: '', collection: 'products', fields: { name: '__proto__.x' } };
  assert.throws(() => resolveApiResponse(doc([{ name: 'P' }]), bad), /forbidden/);
});

test('resolver: caps refuse oversized collections and values', () => {
  const big = new Array(API_RESOLVER_MAX_PRODUCTS + 1).fill({ name: 'P' });
  assert.throws(() => resolveApiResponse(doc(big), BASE), /above cap/);
  const over = 'x'.repeat(API_RESOLVER_MAX_VALUE_LENGTH + 1);
  const out = resolveApiResponse(doc([{ name: over }]), BASE);
  assert.equal(out.accepted, 0);
  assert.match(out.errors[0].reasons.join(';'), /exceeds/);
});

test('resolver: non-object entries and non-array collections reported', () => {
  const mixed = resolveApiResponse(doc(['nope', { name: 'Ok' }]), BASE);
  assert.equal(mixed.accepted, 1);
  assert.match(mixed.errors[0].reasons.join(';'), /not a JSON object/);
  assert.throws(() => resolveApiResponse({ products: { a: 1 } }, BASE), /array/);
});

test('resolver: module stays pure', () => {
  const src = readFileSync(resolvePath(process.cwd(), 'server', 'services', 'catalogApiResolver.ts'), 'utf8');
  assert.ok(!src.includes('getDatabase'), 'no DB');
  assert.ok(!src.includes('fetch('), 'no fetch');
  assert.ok(!src.includes('setInterval'), 'no scheduler');
  assert.ok(!src.includes('node-cron'), 'no scheduler');
  assert.ok(!src.includes('console.'), 'no logging');
});