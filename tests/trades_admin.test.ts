/**
 * Admin → Métiers — Trades management tests (additive layer).
 *
 * HERMETIC repository-level coverage (in-memory implementation, no HTTP server):
 *   1. update changes only the editable fields (labels, icon, sortOrder,
 *      isActive) — `code` and `isOfficial` can never be patched.
 *   2. only NON-OFFICIAL trades can be removed; official trades always survive
 *      a remove() call.
 *   3. isActive=false hides a trade from the DEFAULT list (Outils/Services
 *      view) while list(..., includeInactive=true) still exposes it to Admin.
 *   4. list() is deterministically ordered by (sortOrder, code) — the same
 *      contract the Drizzle path enforces with ORDER BY sort_order, code.
 *
 * The HTTP contract (admin-only PATCH/DELETE, 403/404/409 codes, discovery
 * entries) is covered by tests/trades_admin_api.test.ts (registered in
 * tests/run.ts, which needs the shared test server).
 *
 * Registered in tests/run.ts via runTradeAdminTests() — importing this module
 * does NOT start the suite: there is no top-level main() and no process.exit().
 * Every result feeds the shared harness tally (tests/run.ts), so a failure here
 * fails `npm test`.
 *
 * Standalone: npx tsx tests/trades_admin.test.ts
 */
import { test, assertEq, ok, testResults } from './run';
import { upsertTradeByCode, MemoryTradeRepository } from '../server/repositories/tradeRepository';
import { memoryStore } from '../server/repositories/store';

export async function runTradeAdminTests() {
  console.log('\n🛠️  Admin → Métiers (Trades) Tests\n');

  // Hermetic isolation: earlier suites in a batch may have persisted hybrid
  // mirror rows into the shared server/data store — a DB official (UUID id)
  // coexists with the `trade_` placeholder by design (see mirrorDbTradeToMemory),
  // which would otherwise leak TWO active rows with the same code into the
  // assertions below. Wipe so every run starts from the canonical seed.
  memoryStore.resetAll();

  await test('memory: update changes editable fields only (labels, icon, sortOrder, isActive)', async () => {
    const repo = new MemoryTradeRepository();
    const placo = repo.findByCode('placo');
    ok(placo, 'placo exists');

    const updated = repo.update(placo!.id, {
      labelFr: 'PLACO & PLAQUES',
      labelAr: 'جبس',
      labelDerja: 'بلاكو',
      icon: 'Hammer',
      sortOrder: 42,
    });
    ok(updated, 'update returned the row');
    assertEq(updated!.labelFr, 'PLACO & PLAQUES');
    assertEq(updated!.labelAr, 'جبس');
    assertEq(updated!.labelDerja, 'بلاكو');
    assertEq(updated!.icon, 'Hammer');
    assertEq(updated!.sortOrder, 42);
    // Identity + protection fields can NEVER be patched:
    assertEq(updated!.code, 'placo', 'code is immutable');
    assertEq(updated!.isOfficial, true, 'isOfficial is immutable');

    const byId = repo.findById(placo!.id);
    assertEq(byId!.labelFr, 'PLACO & PLAQUES', 'update is persisted in the store');

    // Restore the canonical values: MemoryTradeRepository shares one collection,
    // so leaving placo renamed/re-ordered would leak into the later ordering test.
    repo.update(placo!.id, {
      labelFr: 'PLACO / PLÂTRE',
      labelAr: 'جبس وبلاطور',
      labelDerja: 'جبس وبلاطور',
      sortOrder: 1,
    });
  });

  await test('memory: update returns undefined for unknown ids', async () => {
    const repo = new MemoryTradeRepository();
    assertEq(repo.update('trade_does_not_exist', { labelFr: 'X' }), undefined);
  });

  await test('memory: official trades can never be removed', async () => {
    const repo = new MemoryTradeRepository();
    const placo = repo.findByCode('placo')!;
    assertEq(repo.remove(placo.id), undefined, 'remove() refuses official trades');
    ok(repo.findByCode('placo'), 'official trade still present after remove()');
  });

  await test('memory: non-official trades can be removed', async () => {
    const repo = new MemoryTradeRepository();
    const created = await upsertTradeByCode('admin_gx', 'Admin GX');
    ok(created, 'dynamic trade created');
    const removed = repo.remove(created!.id);
    ok(removed, 'dynamic trade removed');
    assertEq(removed!.isOfficial, false);
    assertEq(repo.findByCode('admin_gx'), undefined, 'dynamic trade is gone from the registry');
  });

  await test('memory: isActive=false hides the trade unless includeInactive is set', async () => {
    const repo = new MemoryTradeRepository();
    const created = await upsertTradeByCode('admin_hide', 'Admin Hide');
    repo.update(created!.id, { isActive: false });

    const publicList = repo.list(false);
    ok(!publicList.some((t) => t.code === 'admin_hide'), 'hidden trade NOT in the Outils/Services view');
    const adminList = repo.list(false, true);
    const hidden = adminList.find((t) => t.code === 'admin_hide');
    ok(hidden, 'hidden trade still visible to Admin with includeInactive');
    assertEq(hidden!.isActive, false, 'the row keeps its data — nothing was deleted');
  });

  await test('memory: deactivating an official trade keeps it in the official list when includeInactive', async () => {
    const repo = new MemoryTradeRepository();
    const placo = repo.findByCode('placo')!;
    repo.update(placo!.id, { isActive: false });
    ok(!repo.list(true).some((t) => t.code === 'placo'), 'deactivated official trade hidden by default');
    ok(repo.list(true, true).some((t) => t.code === 'placo'), 'Admin view still lists it');
    // Restore for the other suites sharing this store.
    repo.update(placo!.id, { isActive: true });
  });

  await test('memory: list() is ordered by (sortOrder, code)', async () => {
    memoryStore.resetAll();
    const repo = new MemoryTradeRepository();
    const a = repo.findByCode('placo')!;
    const b = repo.findByCode('peinture')!;
    assertEq(a.sortOrder, 1);
    assertEq(b.sortOrder, 2);
    const ordered = repo.list(true).map((t) => t.code);
    ok(ordered.indexOf('placo') < ordered.indexOf('peinture'), 'official trades follow sortOrder');
  });
}

// ── Auto-run ONLY when executed directly ─────────────────────────────────────
// `npx tsx tests/trades_admin.test.ts` runs this suite alone and exits 1 on any
// failure. tests/run.ts imports this module and just awaits runTradeAdminTests():
// importing it must NOT start a second suite and must NEVER process.exit()
// (a top-level main() used to kill the whole `npm test` run at import time).
const __mainEntry = (process.argv[1] || '').toLowerCase();
if (__mainEntry.endsWith('trades_admin.test.ts')) {
  runTradeAdminTests()
    .then(() => {
      const { passed, failed } = testResults();
      console.log('\n═══════════════════════════════════════════');
      console.log(` Admin → Métiers: ✅ ${passed} passed | ❌ ${failed} failed`);
      console.log('═══════════════════════════════════════════\n');
      process.exit(failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('[KONSTRIVO] Admin → Métiers test runner crashed:', err);
      process.exit(1);
    });
}


