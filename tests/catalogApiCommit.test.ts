// @ts-nocheck
/**
 * Global Catalog - API Commit tests (DB-FREE, no network).
 * In-memory fakes mirror the duplicate/matching/review guards.
 * Run: npx tsx tests/catalogApiCommit.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { resolveApiResponse } from '../server/services/catalogApiResolver';
import { previewApiImportRows } from '../server/services/catalogApiImportPreview';
import { commitApiImportRows } from '../server/services/catalogApiImportCommit';
function doc(p: unknown) { return { products: p }; }
function fakeDeps() {
  const calls: any = { created: [], patched: [], identifiers: [], staged: [] };
  const byId = new Map<string, string>();
  const deps: any = {
    transact: async (fn: any) => fn({}),
    ensureSource: async () => ({ id: 'src-1' }),
    createRun: async () => ({ id: 'run-1' }),
    findByIdentifier: async (t: string, v: string) => byId.get(t + '|' + v) || null,
    createProduct: async (d: any) => {
      const id = 'gp-' + (calls.created.length + 1);
      calls.created.push({ id, data: d });
      return { id };
    },
    patchProduct: async (id: string, p: any) => { calls.patched.push({ id, patch: p }); return { id }; },
    upsertIdentifier: async (a: any) => {
      calls.identifiers.push(a);
      byId.set(a.identifierType + '|' + a.identifierValue, a.globalProductId);
      return a;
    },
    stageItems: async (_id: string, items: any[]) => { calls.staged.push(...items); return items; },
    touchRun: async () => null,
  };
  return { deps, calls, byId };
}

test('commit: new product creates product + gtin identifier only', async () => {
  const { deps, calls } = fakeDeps();
  const m = { root: '', collection: 'products', fields: { name: 'name', gtin: 'ean', price: 'price', currency: 'currency', availability: 'availability' } };
  const r = resolveApiResponse(doc([{ name: 'P', ean: '6191', price: 9, currency: 'TND', availability: 'yes' }]), m);
  const p = await previewApiImportRows(r);
  const out = await commitApiImportRows(p.items as any, { source: { name: 'api-src' }, deps });
  assert.equal(out.created, 1);
  assert.equal(calls.identifiers[0].identifierType, 'gtin');
  assert.ok(!('price' in calls.created[0].data));
  assert.ok(!('currency' in calls.created[0].data));
});
test('commit: matched gtin patches whitelisted fields only', async () => {
  const { deps, calls, byId } = fakeDeps();
  byId.set('gtin|6191', 'gp-old');
  const r = resolveApiResponse(doc([{ name: 'P2', ean: '6191' }]), { root: '', collection: 'products', fields: { name: 'name', gtin: 'ean' } });
  const p = await previewApiImportRows(r);
  const out = await commitApiImportRows(p.items as any, { source: { name: 'api-src' }, deps });
  assert.equal(out.matched, 1);
  assert.equal(out.updated, 1);
  assert.equal(calls.created.length, 0);
  assert.equal(calls.patched[0].id, 'gp-old');
});
test('commit: possible_match without identifier goes to review only', async () => {
  const { deps, calls } = fakeDeps();
  const r = resolveApiResponse(doc([{ name: 'NoId' }]), { root: '', collection: 'products', fields: { name: 'name' } });
  const p = await previewApiImportRows(r);
  const out = await commitApiImportRows(p.items as any, { source: { name: 'api-src' }, deps });
  assert.equal(out.reviewRequired, 1);
  assert.equal(calls.created.length, 0);
});
test('commit: invalid rows rejected, never created', async () => {
  const { deps, calls } = fakeDeps();
  const r = resolveApiResponse(doc([{ name: { bad: 1 } }]), { root: '', collection: 'products', fields: { name: 'name' } });
  const p = await previewApiImportRows(r);
  const out = await commitApiImportRows(p.items as any, { source: { name: 'api-src' }, deps });
  assert.equal(out.invalid, 1);
  assert.equal(calls.created.length, 0);
});
test('commit: duplicate identifier in payload is not duplicated', async () => {
  const { deps, calls } = fakeDeps();
  const m = { root: '', collection: 'products', fields: { name: 'name', gtin: 'ean' } };
  const r = resolveApiResponse(doc([{ name: 'A', ean: 'D1' }, { name: 'B', ean: 'D1' }]), m);
  const p = await previewApiImportRows(r);
  const out = await commitApiImportRows(p.items as any, { source: { name: 'api-src' }, deps });
  assert.equal(out.created, 1);
  assert.equal(out.reviewRequired, 1);
  assert.equal(calls.created.length, 1);
});
test('commit: review approve plus safety scans', () => {
  const src = readFileSync(resolvePath(process.cwd(), 'server', 'repositories', 'globalCatalogReviewRepository.ts'), 'utf8');
  assert.ok(src.includes('create_new'), 'approve create_new exists');
  assert.ok(src.includes('link_existing'), 'approve link_existing exists');
  assert.ok(src.includes('Invalid globalProductId'), 'wrong link refused');
  const commitSrc = readFileSync(resolvePath(process.cwd(), 'server', 'services', 'catalogApiImportCommit.ts'), 'utf8');
  assert.ok(!commitSrc.includes('fetch('), 'no fetch');
  assert.ok(!commitSrc.includes('setInterval'), 'no scheduler');
  assert.ok(!commitSrc.includes('console.'), 'no secret/raw logging');
});
test('commit: preview writes nothing', async () => {
  const r = resolveApiResponse(doc([{ name: 'P' }]), { root: '', collection: 'products', fields: { name: 'name' } });
  const before = JSON.stringify(r);
  await previewApiImportRows(r);
  assert.equal(JSON.stringify(r), before);
});
