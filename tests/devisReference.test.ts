/**
 * Devis reference uniqueness tests.
 *
 * Guards the fix: a NEW Devis always receives a reference different from any
 * previously issued/saved one, while reloading an EXISTING Devis keeps its
 * reference untouched (the reference is only regenerated for a brand-new
 * Devis — never on edit/reload).
 *
 * Run: npx tsx tests/devisReference.test.ts
 */
import { strict as assert } from 'node:assert';
import {
  makeDevisReference,
  resolveDevisReference,
  normalizeDevisFromServer,
} from '../src/utils/devisFields';

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

// ════ 1) Two consecutive NEW Devis → always different references ════
test('two consecutive new devis get different references', () => {
  const ref1 = makeDevisReference();
  const ref2 = makeDevisReference();
  assert.notEqual(ref1, ref2, `second ref ${ref2} must differ from first ${ref1}`);
});

// ════ 2) Uniqueness across many consecutive generations ════
test('100 consecutive generations are all unique', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const ref = makeDevisReference();
    assert.ok(!seen.has(ref), `duplicate reference ${ref} after ${i} generations`);
    seen.add(ref);
  }
});

// ════ 3) Existing pattern DEV-YYYY-XXXX is kept ════
test('references still match DEV-YYYY-XXXX', () => {
  const year = new Date().getFullYear();
  for (let i = 0; i < 25; i++) {
    const ref = makeDevisReference();
    assert.match(ref, new RegExp(`^DEV-${year}-\\d{4}$`), `unexpected format: ${ref}`);
  }
});

// ════ 4) makeDevisReference(used) never reuses an already-saved reference ════
test('new devis skips references already saved in history', () => {
  const saved = ['DEV-2026-2711', 'DEV-2026-0001', 'DEV-2026-9999'];
  for (let i = 0; i < 50; i++) {
    const ref = makeDevisReference(saved);
    assert.ok(!saved.includes(ref), `new devis reused saved reference ${ref}`);
  }
});

// ════ 5) Reloading the SAME devis → reference unchanged (no regeneration) ════
test('reloading the same devis keeps its reference', () => {
  const savedDevis: any = {
    id: 'dev-saved-1',
    reference: 'DEV-2026-4242',
    date: '2026-09-06',
    status: 'draft',
    items: [{ id: 'it-1', title: 'Plaque BA13', quantity: 10, unit: 'u', unitPrice: 30, total: 300 }],
  };
  const loaded = normalizeDevisFromServer(savedDevis);
  assert.equal(
    loaded.reference,
    'DEV-2026-4242',
    'reference must be preserved when the same devis is loaded/opened'
  );
  // And a subsequent brand-new devis never reuses the loaded one.
  const nextNew = makeDevisReference([loaded.reference]);
  assert.notEqual(nextNew, 'DEV-2026-4242', 'a new devis must not reuse the loaded reference');
});

// ════ 6) A manually edited reference survives reload ════
test('a manually edited reference is preserved on reload', () => {
  const edited: any = { id: 'dev-9', reference: 'DEV-2026-CUSTOM-01', date: '2026-09-06', status: 'brouillon' };
  const loaded = normalizeDevisFromServer(edited);
  assert.equal(loaded.reference, 'DEV-2026-CUSTOM-01', 'manual reference must not be overwritten');
});

// ════ 7) Reference fallback chain still works (devisNumber → reference) ════
test('reference falls back to server devisNumber when empty', () => {
  const raw: any = { id: 'dev-10', devisNumber: 'DEV-2026-05071', date: '2026-09-06', status: 'draft' };
  assert.equal(resolveDevisReference(raw), 'DEV-2026-05071');
  const normalized = normalizeDevisFromServer(raw);
  assert.equal(normalized.reference, 'DEV-2026-05071', 'devisNumber fallback must fill the reference');
});

console.log(`\n═══ Devis reference tests: ✅ ${passed} passed | ❌ ${failed} failed ═══\n`);
if (failures.length > 0) {
  failures.forEach(f => console.log(f));
  console.log('');
  process.exit(1);
}