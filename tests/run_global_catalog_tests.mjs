/*
  Minimal runnable tests for Global Catalog.
  Runs WITHOUT project node_modules install by bundling required TS files with esbuild.
*/
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'server/services/globalCatalogImport.ts');
const out = path.join(root, 'tests/.tmp_globalCatalogImport.mjs');

await build({
  entryPoints: [entry],
  outfile: out,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  bundle: true,
  sourcemap: false,
  logLevel: 'silent',
  external: [
    // Force DB to remain external/unresolved in preview-only tests.
    'drizzle-orm',
    'drizzle-orm/pg-core',
    'drizzle-orm/postgres-js',
    'postgres',
  ],
});

const mod = await import(pathToFileURL(out));
const { previewGlobalCatalogImport } = mod;

const buf = (s) => Buffer.from(s, 'utf-8');

// Test 1: identifier requires pair
{
  const csv = [
    'name,identifier_type,identifier_value,country,available',
    'Cement 42.5R,gtin,,TN,yes',
  ].join('\n');
  const out = await previewGlobalCatalogImport({ fileType: 'csv', buffer: buf(csv), countryFallback: 'TN' });
  assert.equal(out.summary.total, 1);
  assert.ok(out.items[0].errors.length > 0);
}

// Test 2: no identifier => review_required
{
  const csv = [
    'name,brand,country,available',
    'Cement 42.5R,ACME,TN,yes',
  ].join('\n');
  const out = await previewGlobalCatalogImport({ fileType: 'csv', buffer: buf(csv), countryFallback: 'TN' });
  assert.equal(out.items[0].matchStatus, 'review_required');
}

console.log('GLOBAL_CATALOG_TESTS_OK');
