/**
 * PHASE 0 — SAFETY NET (1/2): FORMULA FREEZE
 *   npx tsx tests/formulaFreeze.test.ts
 *
 * PURPOSE (Phase 0 of the Universal Métré engine):
 *   Freeze the EXISTING official calculation layer so later phases can PROVE
 *   the new engine did not change any historical result.
 *
 * SCOPE — read-only. This test NEVER writes, never mocks, never patches.
 *   It only (a) asserts exported symbols/signatures still exist and
 *   (b) scans source text for forbidden mutations.
 *
 * PHILOSOPHY — deliberately mirrors tests/sentinelExclusion.test.ts:
 *   static, comment-blind source scans + real runtime identity checks, so a
 *   documentation change cannot break it but a real code change can.
 *
 * WHAT IS FROZEN:
 *   1. The 12 official calculator names (calculatePlaco …).
 *   2. `genericQty` — the dynamic-trade quantity rules.
 *   3. `computeFiscalData` — the single fiscal authority.
 *   4. The `CalculationResult` shape (src/types.ts) consumed by Devis/audit.
 *
 * NOT CLAIMED HERE: arithmetic identity — that is tests/formulaGolden.test.ts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as calc from '../src/utils/calculations';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => fs.readFileSync(path.join(HERE, '..', ...p), 'utf8');

const CALC_SRC = read('src', 'utils', 'calculations.ts');
const TYPES_SRC = read('src', 'types.ts');

/** Comment-blind view: block comments + full-line `//` removed. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
}
const CALC_CODE = codeOnly(CALC_SRC);

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  PASS ${name}`);
  } catch (err: any) {
    failed++;
    const msg = `  FAIL ${name}\n       ${err?.message || err}`;
    failures.push(msg);
    console.log(msg);
  }
}

const assert = (cond: any, msg: string) => {
  if (!cond) throw new Error(msg);
};

/** The 12 official calculators, exactly as they must remain named. */
const OFFICIAL_CALCULATORS = [
  'calculatePlaco',
  'calculatePeinture',
  'calculateCarrelage',
  'calculateMaconnerie',
  'calculatePlomberie',
  'calculateElectricite',
  'calculateEtancheite',
  'calculateIsolation',
  'calculateMenuiserie',
  'calculateSols',
  'calculateFacade',
  'calculateDemolition',
] as const;

// ════ 1) Runtime: every frozen symbol is still exported as a function ════
await test('freeze: all 12 official calculators are exported functions', () => {
  const missing = OFFICIAL_CALCULATORS.filter((n) => typeof (calc as any)[n] !== 'function');
  assert(missing.length === 0, `missing/non-function exports: ${missing.join(', ')}`);
});

await test('freeze: calculateGeneric / computeFiscalData still exported', () => {
  assert(typeof calc.calculateGeneric === 'function', 'calculateGeneric must stay exported');
  assert(typeof calc.computeFiscalData === 'function', 'computeFiscalData must stay exported');
});

await test('freeze: each calculator is arity 2 (input, rates)', () => {
  for (const n of OFFICIAL_CALCULATORS) {
    assert((calc as any)[n].length === 2, `${n} must keep arity 2 (input, rates)`);
  }
  assert(calc.calculateGeneric.length === 2, 'calculateGeneric must keep arity 2');
  assert(calc.computeFiscalData.length === 3, 'computeFiscalData must keep arity 3');
});

// ════ 2) Static: the 12 names are still declared in source ════
await test('freeze: all 12 calculator declarations present in calculations.ts', () => {
  for (const n of OFFICIAL_CALCULATORS) {
    assert(CALC_CODE.includes(`function ${n}(`), `calculations.ts must still declare "function ${n}("`);
  }
});

await test('freeze: genericQty still exists and is NOT exported (private)', () => {
  assert(CALC_CODE.includes('function genericQty('), 'genericQty must still exist');
  assert(
    !CALC_CODE.includes('export function genericQty('),
    'genericQty must stay module-private — only calculateGeneric may consume it',
  );
});

await test('freeze: computeFiscalData still exported for the rules bridge', () => {
  assert(
    CALC_CODE.includes('export function computeFiscalData('),
    'computeFiscalData must stay exported (calculatorRulesBridge depends on it)',
  );
});

// ════ 3) Structural: genericQty per-unit rule set is unchanged ════
await test('freeze: genericQty keeps its documented unit coverage', () => {
  const fn = CALC_CODE.slice(CALC_CODE.indexOf('function genericQty('));
  const body = fn.slice(0, fn.indexOf('\nfunction calculateGeneric('));
  const required = [
    "'m²'", "'ml'", "'m'", "'kg'", "'sac'", "'boite'", "'rouleau'",
    "'panneau'", "'unit'", "'set'", "'litre'", "'point'",
    "'boite_1000'", "'tube'", "'m³'", "'mètre'",
  ];
  const missing = required.filter((u) => !body.includes(`case ${u}:`));
  assert(missing.length === 0, `genericQty lost unit branch(es): ${missing.join(', ')}`);
});

// ════ 4) Structural: CalculationResult contract (Devis + audit consumers) ════
await test('freeze: CalculationResult keeps every field consumers rely on', () => {
  const iface = TYPES_SRC.slice(
    TYPES_SRC.indexOf('export interface CalculationResult'),
    TYPES_SRC.indexOf('export interface DevisItem'),
  );
  const required = [
    'trade', 'subType', 'subTypeTitle', 'areaM2', 'netAreaM2', 'perimeterM',
    'materialItems', 'totalMaterialTnd', 'estimatedLaborTnd', 'grandTotalTnd',
    'wasteMarginPercent', 'fieldNotes', 'tvaPercent', 'tvaAmountTnd',
    'timbreFiscalTnd', 'retenueGarantiePercent', 'retenueGarantieTnd',
    'totalTtcTnd', 'netAPayerTnd',
  ];
  const missing = required.filter((f) => !new RegExp(`\\b${f}\\??:`).test(iface));
  assert(missing.length === 0, `CalculationResult lost field(s): ${missing.join(', ')}`);
});

await test('freeze: MaterialItemResult keeps qty / price / formulaUsed', () => {
  const iface = TYPES_SRC.slice(
    TYPES_SRC.indexOf('export interface MaterialItemResult'),
    TYPES_SRC.indexOf('export interface CalculationResult'),
  );
  for (const f of ['id', 'qty', 'unit', 'unitPriceTnd', 'totalTnd', 'formulaUsed']) {
    assert(new RegExp(`\\b${f}\\??:`).test(iface), `MaterialItemResult lost "${f}"`);
  }
});

// ════ 5) Guards against silent in-place mutation of the frozen layer ════
await test('freeze: no eval / Function constructor in calculations.ts', () => {
  assert(!/\beval\s*\(/.test(CALC_CODE), 'eval() must never appear in calculations.ts');
  assert(!/new\s+Function\s*\(/.test(CALC_CODE), 'new Function() must never appear');
});

await test('freeze: the fiscal chain still runs through computeFiscalData', () => {
  const calls = CALC_CODE.match(/computeFiscalData\(/g) || [];
  // 12 official + generic = 13 call sites; fewer means a calculator stopped
  // using the shared fiscal authority.
  assert(calls.length >= 13, `expected >=13 computeFiscalData call sites, found ${calls.length}`);
});

await test('freeze: Devis document contract is untouched', () => {
  const devis = TYPES_SRC.slice(
    TYPES_SRC.indexOf('export interface DevisDocument'),
    TYPES_SRC.indexOf('export interface KnowledgeArticle'),
  );
  const required = [
    'reference', 'items', 'subtotalMaterials', 'subtotalLabor',
    'tvaPercent', 'total', 'status',
  ];
  const missing = required.filter((f) => !new RegExp(`\\b${f}\\??:`).test(devis));
  assert(missing.length === 0, `DevisDocument lost field(s): ${missing.join(', ')}`);
});

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n═════════════════════════════════════════════');
console.log(` Formula freeze: ${passed} passed, ${failed} failed`);
console.log('═════════════════════════════════════════════\n');
if (failures.length > 0) {
  console.log('FAILED TESTS:');
  failures.forEach((f) => console.log(f));
  console.log('');
}
process.exit(failed > 0 ? 1 : 0);
console.log('═════════════════════════════════════════════\n');