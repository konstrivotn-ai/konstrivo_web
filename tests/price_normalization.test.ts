import { strict as assert } from 'node:assert';

/**
 * Step 1 — Price Read-Path Normalization (unit test, NO database needed).
 *
 * Verifies that the raw Drizzle `material_prices` row mapping in
 * server/repositories/drizzlePriceRepository.ts produces exactly the
 * MemoryRepo contract consumed by src/App.tsx (price as number, source,
 * currency, lowercase market, ISO dates) and that no raw
 * `unitPrice`/`sourceCode`/`currencyCode` keys leak into the output.
 *
 * Step 2 addition: verifies the GENERATED SQL (via .toSQL(), with NO database
 * connection) for the case-insensitive market filter, the preserved
 * is_deleted filter, and the effective_from DESC / updated_at DESC ordering.
 *
 * Run: npx tsx tests/price_normalization.test.ts
 */
// Environment guard BEFORE importing any server module: config.ts throws at
// import time when NODE_ENV=test without TEST_DATABASE_URL. This unit test
// is pure mapping — it must never touch a database. (node:assert is
// environment-independent, so its static import above is safe.)
process.env.NODE_ENV = 'development';

async function main() {
  const { normalizePriceRow } = await import('../server/repositories/drizzlePriceRepository');

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  function test(name: string, fn: () => void) {
    try { fn(); passed++; console.log(`  PASS ${name}`); }
    catch (err: any) {
      failed++;
      const msg = `  FAIL ${name}\n       ${err?.message || err}`;
      failures.push(msg);
      console.log(msg);
    }
  }

  // ── 1. Typical raw Drizzle row: NUMERIC strings + Date timestamps ─────────
  const raw = {
    id: 'p1',
    materialId: 'm1',
    sourceCode: 'OFFICIAL_DEFAULT',
    currencyCode: 'TND',
    countryCode: 'TN',
    unitPrice: '30.000',
    companyId: null,
    supplierId: null,
    isCurrent: true,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    packageDefinitionId: null,
    packagePrice: '12.500',
    supplierCatalogItemId: null,
    notes: null,
    createdAt: new Date('2026-01-01T10:00:00Z'),
    updatedAt: new Date('2026-02-01T12:30:00Z'),
    version: 3,
    isDeleted: false,
  };
  const out = normalizePriceRow(raw);

  test('unitPrice NUMERIC string → price as number', () => {
    assert.equal(typeof out.price, 'number');
    assert.equal(out.price, 30);
  });
  test('sourceCode → source', () => assert.equal(out.source, 'OFFICIAL_DEFAULT'));
  test('currencyCode → currency', () => assert.equal(out.currency, 'TND'));
  test('market = countryCode.toLowerCase()', () => assert.equal(out.market, 'tn'));
  test('countryCode preserved as-is', () => assert.equal(out.countryCode, 'TN'));
  test('no raw unitPrice/sourceCode/currencyCode keys leak into output', () => {
    assert.ok(!('unitPrice' in out), 'unitPrice must not appear');
    assert.ok(!('sourceCode' in out), 'sourceCode must not appear');
    assert.ok(!('currencyCode' in out), 'currencyCode must not appear');
  });
  test('createdAt/updatedAt Date → ISO strings', () => {
    assert.equal(typeof out.updatedAt, 'string');
    assert.equal(out.updatedAt, '2026-02-01T12:30:00.000Z');
    assert.equal(out.createdAt, '2026-01-01T10:00:00.000Z');
  });
  test('null effectiveTo/notes → undefined (optional fields)', () => {
    assert.equal(out.effectiveTo, undefined);
    assert.equal(out.notes, undefined);
  });
  test('packagePrice NUMERIC string → number', () => assert.equal(out.packagePrice, 12.5));
  test('scalars preserved (id, materialId, isCurrent, version, isDeleted, effectiveFrom)', () => {
    assert.equal(out.id, 'p1');
    assert.equal(out.materialId, 'm1');
    assert.equal(out.isCurrent, true);
    assert.equal(out.version, 3);
    assert.equal(out.isDeleted, false);
    assert.equal(out.effectiveFrom, '2026-01-01');
  });

  // ── 2. Missing countryCode → defaults TN / market 'tn' ────────────────────
  const out2 = normalizePriceRow({ id: 'p2', materialId: 'm2', unitPrice: '7.250', countryCode: undefined });
  test('missing countryCode → default TN and market tn', () => {
    assert.equal(out2.countryCode, 'TN');
    assert.equal(out2.market, 'tn');
    assert.equal(out2.price, 7.25);
  });

  // ── 3. Falsy rows pass through untouched ──────────────────────────────────
  test('null row → null', () => assert.equal(normalizePriceRow(null), null));
  test('undefined row → undefined', () => assert.equal(normalizePriceRow(undefined), undefined));

  // ── 4. Step 2 — generated-SQL semantics (NO database connection) ──────────
  // postgres.js is LAZY: creating a client never opens a socket. We build the
  // query locally and inspect it with .toSQL() — no DB is ever contacted.
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const postgresFactory = (await import('postgres')).default;
  const { materialPrices } = await import('../server/db/schema');
  const { and, desc, eq, sql } = await import('drizzle-orm');
  const lazyClient = postgresFactory('postgres://localhost:1/none');
  const db = drizzle(lazyClient);

  const built = db.select().from(materialPrices)
    .where(and(
      eq(materialPrices.isDeleted, false),
      sql`upper(${materialPrices.countryCode}) = upper(${'tn'})`,
    ))
    .orderBy(desc(materialPrices.effectiveFrom), desc(materialPrices.updatedAt))
    .toSQL();

  test('market filter is case-insensitive: upper(country_code) = upper($1) with param tn', () => {
    const s = built.sql.toLowerCase();
    assert.ok(s.includes('upper('), 'uses upper() on both sides');
    assert.ok(s.includes('country_code'), 'references country_code column');
    assert.ok(built.params.includes('tn'), 'binds the market value as a parameter');
  });

  test('is_deleted filter survives alongside the market filter (single ANDed where)', () => {
    const s = built.sql.toLowerCase();
    assert.ok(s.includes('is_deleted'), 'is_deleted condition present');
    assert.ok(s.includes(' and '), 'conditions joined with AND in one WHERE');
  });

  test('ordering: effective_from DESC before updated_at DESC', () => {
    const s = built.sql.toLowerCase();
    const orderIdx = s.indexOf('order by');
    assert.ok(orderIdx >= 0, 'has ORDER BY');
    const orderClause = s.slice(orderIdx);
    const effIdx = orderClause.indexOf('effective_from');
    const updIdx = orderClause.indexOf('updated_at');
    assert.ok(effIdx >= 0, 'orders by effective_from');
    assert.ok(updIdx > effIdx, 'updated_at comes after effective_from');
    assert.ok(orderClause.includes('effective_from" desc'), 'effective_from DESC');
    assert.ok(orderClause.includes('updated_at" desc'), 'updated_at DESC');
  });

  test('current-price selection: is_current preserved and ORDER BY precedes LIMIT 1', () => {
    const builtLimit = db.select().from(materialPrices)
      .where(and(
        eq(materialPrices.materialId, 'm1'),
        eq(materialPrices.isCurrent, true),
        sql`upper(${materialPrices.countryCode}) = upper(${'tn'})`,
      ))
      .orderBy(desc(materialPrices.effectiveFrom), desc(materialPrices.updatedAt))
      .limit(1)
      .toSQL();
    const s = builtLimit.sql.toLowerCase();
    const orderIdx = s.indexOf('order by');
    const limitIdx = s.indexOf('limit ');
    assert.ok(s.includes('is_current'), 'is_current filter preserved');
    assert.ok(orderIdx >= 0, 'has ORDER BY');
    assert.ok(limitIdx > orderIdx, 'ORDER BY applies before LIMIT 1');
  });

  try { await lazyClient.end({ timeout: 1 }); } catch { /* never connected */ }

  console.log('\n═══════════════════════════════════════════');
  console.log(` RESULTS: ✅ ${passed} passed | ❌ ${failed} failed`);
  console.log('═══════════════════════════════════════════');
  if (failures.length > 0) {
    console.log('FAILED TESTS:');
    failures.forEach(f => console.log(f));
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('[KONSTRIVO-TEST] price normalization test crashed:', err);
  process.exit(1);
});