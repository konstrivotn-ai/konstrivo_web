/**
 * UNIT FIDELITY (server side) — CSV/material `baseUnit` → MemoryPriceRepository
 * → GET /api/v1/prices → `unit`.
 *
 * CONFIRMED BUG THIS LOCKS DOWN: in local development `/api/v1/prices` is served
 * by `MemoryPriceRepository`. That repository returned the raw price row — and a
 * price row carries NO unit (the unit lives on the MATERIAL, in
 * `materials.base_unit`). The Drizzle/production path joins `materials` and maps
 * `unit: row.baseUnit ?? row.unit`, so production was correct while local
 * development returned `unit === undefined`; the frontend then fell back to the
 * neutral default `'unit'` and priced an imported CSV material quoted in
 * `m / Kg / Litre / Set / m² / …` as "1 unit".
 *
 * The regression proves, WITHOUT a database:
 *   1. every `/prices` row carries the REAL `baseUnit` of its material
 *      (including rows persisted by an older build, i.e. the self-healing path);
 *   2. a CSV/material created with `baseUnit = m | m² | Kg | Litre | Set | unit`
 *      reaches `/prices` verbatim, for ANY unit — no trade/CSV is special-cased;
 *   3. the Memory payload and the Drizzle payload return the SAME unit;
 *   4. the frontend chain (`buildPriceMapWithTrade` → `mergeRates`) keeps that
 *      unit, so `calculateGeneric` prices the real quantity/unit;
 *   5. no KNOWN unit degrades to `'unit'` because of case/alias differences.
 *
 * The in-memory path is forced explicitly (`config.databaseUrl = undefined`) so
 * this suite can never query — or depend on — a real PostgreSQL database.
 *
 * Run: npx tsx tests/priceUnitMemoryPath.test.ts
 */
import { strict as assert } from 'node:assert';
import http from 'node:http';
import express from 'express';
import { config } from '../server/config';

// Force the in-memory repositories BEFORE anything touches the DB: this suite
// covers exactly the local-development path (`MemoryPriceRepository`).
(config as any).databaseUrl = undefined;

import { pricesRouter } from '../server/routes/v1/prices';
import { materialRepository } from '../server/repositories/materialRepository';
import { priceRepository } from '../server/repositories/priceRepository';
import { normalizePriceRow } from '../server/repositories/drizzlePriceRepository';
import { memoryStore } from '../server/repositories/store';
import { normalizeRateUnit, buildPriceMapWithTrade, mergeRates } from '../src/utils/priceLookup';
import { DEFAULT_MARKET_RATES } from '../src/data/marketRates';

let passed = 0;
let failed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; console.log(`  PASS ${name}`); }
  catch (err: any) {
    failed++;
    const msg = `  FAIL ${name}\n       ${err?.message || err}`;
    failures.push(msg);
    console.log(msg);
  }
}

console.log('\nPrice unit fidelity — material.baseUnit → MemoryPriceRepository → /api/v1/prices\n');

// ── The real /prices route, mounted on an ephemeral port ─────────────────────
const app = express();
app.use(express.json());
app.use('/api/v1/prices', pricesRouter);

const server = await new Promise<any>((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const PORT = (server.address() as any).port as number;

// Plain `node:http` (the same client tests/setup.ts uses) instead of the global
// `fetch`: undici keeps an async handle whose teardown races `process.exit()`,
// which produced a harmless-but-noisy libuv assertion on Windows.
function getPrices(query = ''): Promise<{ status: number; data: any[] }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port: PORT, path: `/api/v1/prices${query}`, method: 'GET' },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          try {
            const body: any = raw ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode || 0, data: body.data || [] });
          } catch (err) { reject(err); }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

/** The units of the reported CSV, in their ORIGINAL CSV spelling. */
const CSV_UNITS: Array<{ csv: string; canonical: string }> = [
  { csv: 'm', canonical: 'm' },
  { csv: 'm²', canonical: 'm²' },
  { csv: 'Kg', canonical: 'kg' },
  { csv: 'Litre', canonical: 'litre' },
  { csv: 'Set', canonical: 'set' },
  { csv: 'unit', canonical: 'unit' },
];

/** Every unit the shared `MaterialRate` contract can express. */
const KNOWN_UNITS = [
  'unit', 'm²', 'ml', 'kg', 'sac', 'boite', 'rouleau', 'boite_1000', 'tube',
  'm³', 'point', 'panneau', 'mètre', 'm', 'litre', 'set',
];

const unitFixId = (csv: string) => `unitfix_${csv}`.replace(/[^a-z0-9_]/gi, '_');

// ── 0) A CSV-imported material + its price (the generic import shape) ────────
/** Fixtures created by THIS suite — removed again at the end (see cleanup). */
const createdMaterialIds: string[] = [];
const createdPriceIds: string[] = [];
for (const { csv } of CSV_UNITS) {
  const id = unitFixId(csv);
  materialRepository.create({
    id,
    code: id,
    trade: 'unitfix_trade',
    category: 'unitfix_trade',
    nameFr: `Matériau importé (${csv})`,
    nameAr: '',
    baseUnit: csv,
    isOfficial: true,
    companyId: null,
  });
  const created = await priceRepository.create({
    materialId: id,
    price: 12.5,
    currency: 'TND',
    source: 'OFFICIAL_DEFAULT',
    market: 'tn',
    countryCode: 'TN',
    isCurrent: true,
  }) as any;
  createdMaterialIds.push(id);
  createdPriceIds.push(created.id);
}
// Fixtures written directly into the store by tests 4 and 5 (fixed ids).
createdMaterialIds.push('unitfix_legacy_row');
createdPriceIds.push('price_unitfix_legacy_row', 'price_unitfix_orphan_row');

// ── 1) Every /prices row carries the real baseUnit of its material ───────────
await test('memory: every /prices row returns the REAL baseUnit of its material (no lost unit)', async () => {
  const res = await getPrices('?limit=200');
  assert.equal(res.status, 200);
  assert.ok(res.data.length > 0, '/prices returned rows');

  let resolvable = 0;
  for (const row of res.data) {
    const material = await materialRepository.findById(row.materialId) as any;
    if (!material) continue; // price row without a material — not this suite's concern
    assert.equal(
      row.unit,
      material.baseUnit,
      `price '${row.id}' must expose materials.base_unit ('${material.baseUnit}'), got '${row.unit}'`
    );
    const rate = DEFAULT_MARKET_RATES.find((r) => r.id === row.materialId);
    if (rate) assert.equal(row.unit, rate.unit, `barème unit preserved for '${row.materialId}'`);
    resolvable++;
  }
  // The store is seeded from DEFAULT_MARKET_RATES, so the vast majority of rows
  // must be resolvable — this guards against a silently empty/blanket pass.
  assert.ok(resolvable >= Math.min(10, res.data.length), `only ${resolvable}/${res.data.length} rows were resolvable`);
});

// ── 2) CSV/material baseUnit reaches /prices verbatim ────────────────────────
await test('CSV import: material baseUnit m / m² / Kg / Litre / Set / unit reaches /prices', async () => {
  for (const { csv, canonical } of CSV_UNITS) {
    const id = unitFixId(csv);
    const res = await getPrices(`?materialId=${encodeURIComponent(id)}`);
    const row = res.data[0];
    assert.ok(row, `${id}: /prices returned the price row`);
    assert.equal(row.unit, csv, `${id}: the CSV unit must survive verbatim`);
    assert.equal(normalizeRateUnit(row.unit), canonical, `${id}: frontend unit resolution`);
  }
});

// ── 3) Memory path ≡ Drizzle path ────────────────────────────────────────────
await test('memory and Drizzle paths return the SAME unit for the same material', async () => {
  for (const { csv } of CSV_UNITS) {
    const id = unitFixId(csv);
    const memoryRow = (await getPrices(`?materialId=${encodeURIComponent(id)}`)).data[0];
    // Exact shape of a `listPrices` row (materials JOIN) fed to normalizePriceRow.
    const drizzleRow = normalizePriceRow({
      id: 'price_x',
      materialId: id,
      code: id,
      unitPrice: 12.5,
      currencyCode: 'TND',
      sourceCode: 'OFFICIAL_DEFAULT',
      countryCode: 'TN',
      baseUnit: csv,
      isCurrent: true,
      effectiveFrom: '2026-01-01',
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
      isDeleted: false,
    });
    assert.equal(memoryRow.unit, drizzleRow.unit, `${id}: memory unit must equal drizzle unit`);
  }
});

// ── 4) Legacy rows persisted WITHOUT a unit self-heal from the material ──────
await test('self-healing: a persisted price row with no unit is repaired on read', async () => {
  const id = 'unitfix_legacy_row';
  materialRepository.create({
    id, code: id, trade: 'unitfix_trade', category: 'unitfix_trade',
    nameFr: 'Matériau legacy', nameAr: '', nameEn: null,
    baseUnit: 'm³', isOfficial: true, companyId: null,
  });
  // Simulates `server/data/material_prices.json` written by an older build:
  // the row has NO `unit` key at all.
  const prices = memoryStore.getCollection('material_prices', 'server/data/material_prices.json');
  prices.set(`price_${id}`, {
    id: `price_${id}`,
    materialId: id,
    price: 9,
    currency: 'TND',
    source: 'OFFICIAL_DEFAULT',
    market: 'tn',
    countryCode: 'TN',
    isCurrent: true,
    effectiveFrom: '2026-01-01',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    isDeleted: false,
  });
  assert.equal(prices.get(`price_${id}`)!.unit, undefined, 'fixture row really has no unit');

  const row = (await getPrices(`?materialId=${id}`)).data[0];
  assert.ok(row);
  assert.equal(row.unit, 'm³', 'the material base unit repairs the legacy price row on read');
  assert.equal(prices.get(`price_${id}`)!.price, 9, 'the stored price itself is untouched');
});

// ── 5) A price row's own unit is used when the material defines none ─────────
await test('DB parity: price-row unit is used only when the material has none', async () => {
  const id = 'unitfix_orphan_row';
  const prices = memoryStore.getCollection('material_prices', 'server/data/material_prices.json');
  prices.set(`price_${id}`, {
    id: `price_${id}`, materialId: id, unit: 'kg', price: 5,
    currency: 'TND', source: 'OFFICIAL_DEFAULT', market: 'tn', countryCode: 'TN',
    isCurrent: true, effectiveFrom: '2026-01-01',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1, isDeleted: false,
  });
  const row = (await getPrices(`?materialId=${id}`)).data[0];
  assert.ok(row);
  assert.equal(row.unit, 'kg', 'no material row → the price row unit is kept (baseUnit ?? unit)');
});

// ── 6) /prices → mergeRates keeps the imported unit ──────────────────────────
await test('/prices → buildPriceMapWithTrade → mergeRates keeps the CSV unit', async () => {
  const rows = (await getPrices('?limit=200')).data;
  const merged = mergeRates([], buildPriceMapWithTrade(rows));
  for (const { csv, canonical } of CSV_UNITS) {
    const id = unitFixId(csv);
    const rate = merged.find((r) => r.id === id);
    assert.ok(rate, `${id}: merged rate exists`);
    assert.equal(rate!.unit, canonical, `${id}: the real unit reaches the calculator rates`);
    assert.equal(rate!.unitPriceTnd, 12.5);
  }
});

// ── 7) No KNOWN unit degrades to 'unit' (case / accent / alias safe) ─────────
await test("no known unit collapses to 'unit' — every canonical unit and CSV spelling is preserved", () => {
  for (const unit of KNOWN_UNITS) {
    assert.equal(normalizeRateUnit(unit), unit, `'${unit}' must stay '${unit}'`);
  }
  // Case/alias variants of the reported CSV units.
  assert.equal(normalizeRateUnit('M'), 'm');
  assert.equal(normalizeRateUnit('KG'), 'kg');
  assert.equal(normalizeRateUnit('Kg'), 'kg');
  assert.equal(normalizeRateUnit('LITRE'), 'litre');
  assert.equal(normalizeRateUnit('liter'), 'litre');
  assert.equal(normalizeRateUnit('SET'), 'set');
  assert.equal(normalizeRateUnit('Set'), 'set');
  assert.equal(normalizeRateUnit('M²'), 'm²');
  assert.equal(normalizeRateUnit('m2'), 'm²');
  assert.equal(normalizeRateUnit('  m  '), 'm');
  assert.equal(normalizeRateUnit('Unit'), 'unit');
  // Unknown units keep the documented neutral default (never a blind cast).
  assert.equal(normalizeRateUnit('unite_inconnue_xyz'), 'unit');
});

// ── Cleanup: remove ONLY the fixtures this suite created ─────────────────────
// Pre-existing rows — including the legacy unit-less rows this suite proved are
// self-healed on read — are NEVER deleted or rewritten: only the exact ids
// created above are removed from the in-memory collections.
const materialsStore = memoryStore.getCollection('materials', 'server/data/materials.json');
const pricesStore = memoryStore.getCollection('material_prices', 'server/data/material_prices.json');
for (const id of createdMaterialIds) materialsStore.delete(id);
for (const id of createdPriceIds) pricesStore.delete(id);
memoryStore.saveCollection('materials');
memoryStore.saveCollection('material_prices');

// ── Report ───────────────────────────────────────────────────────────────────
// The ephemeral HTTP listener is deliberately NOT closed before exiting:
// `process.exit()` tears the process down deterministically, whereas closing the
// listener and exiting in the same tick triggered a libuv teardown race on
// Windows (harmless but noisy: "Assertion failed: UV_HANDLE_CLOSING").
console.log(`\nPrice unit fidelity (server memory path): ${passed} PASS / ${failed} FAIL`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
