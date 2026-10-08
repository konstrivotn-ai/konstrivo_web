/**
 * Sentinel exclusion — `unmapped_review` hidden from user-facing métier lists
 * (DB-free, static source + pure-function checks).
 *
 * The `unmapped_review` code is an import-pipeline DATA bucket (35 real
 * materials in production): it must stay in the database, stay resolvable, and
 * stay importable — but never be offered as a selectable profession.
 * DB-retention is asserted by backup + read-only production verification
 * (see PROJECT_STATE 2026-09-28), never by writing here.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, ok, testResults } from './run';
import {
  isExcludedSentinelTradeCode,
  EXCLUDED_SENTINEL_TRADE_CODES,
} from '../src/utils/catalogDisplay';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CALC_SRC = fs.readFileSync(
  path.join(HERE, '..', 'src', 'components', 'CalculatorTab.tsx'),
  'utf8'
);
const SERVICES_SRC = fs.readFileSync(
  path.join(HERE, '..', 'src', 'components', 'ServicesTab.tsx'),
  'utf8'
);
const RATES_SRC = fs.readFileSync(
  path.join(HERE, '..', 'src', 'components', 'RatesTab.tsx'),
  'utf8'
);
const IMPORT_SRC = fs.readFileSync(
  path.join(HERE, '..', 'server', 'services', 'catalogImport.ts'),
  'utf8'
);
const TRADE_REPO_SRC = fs.readFileSync(
  path.join(HERE, '..', 'server', 'repositories', 'tradeRepository.ts'),
  'utf8'
);

/** Comment-blind view: block + full-line comments removed. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
}

const CALC_CODE = codeOnly(CALC_SRC);
const SERVICES_CODE = codeOnly(SERVICES_SRC);
const RATES_CODE = codeOnly(RATES_SRC);

export async function runSentinelExclusionTests() {
  console.log('\n🙈 Sentinel exclusion — `unmapped_review` hidden, data kept\n');

  await test('sentinel: exactly one shared predicate, flagging only the sentinel', async () => {
    ok(EXCLUDED_SENTINEL_TRADE_CODES.has('unmapped_review'), 'the sentinel set contains unmapped_review');
    ok(EXCLUDED_SENTINEL_TRADE_CODES.size === 1, 'no other code is display-excluded');
    ok(isExcludedSentinelTradeCode('unmapped_review'), 'exact code excluded');
    ok(isExcludedSentinelTradeCode('UNMAPPED_REVIEW'), 'case-insensitive');
    ok(isExcludedSentinelTradeCode('  unmapped_review  '), 'whitespace-tolerant');
    ok(!isExcludedSentinelTradeCode('placo'), 'official trade NOT excluded');
    ok(!isExcludedSentinelTradeCode('aluminium'), 'legitimate dynamic trade NOT excluded');
    ok(!isExcludedSentinelTradeCode('hvac systems'), 'legitimate dynamic trade NOT excluded');
    ok(!isExcludedSentinelTradeCode(''), 'empty code NOT excluded');
    ok(!isExcludedSentinelTradeCode(null), 'null NOT excluded');
  });

  await test('sentinel: Calculator/Outils never lists it', async () => {
    ok(/isExcludedSentinelTradeCode\(t\.code\)/.test(CALC_CODE), 'isServableTrade rejects the sentinel registry row');
    ok(/isExcludedSentinelTradeCode\(c\)/.test(CALC_CODE), 'rates-derived fallback cards exclude the sentinel');
  });

  await test('sentinel: Services never lists it', async () => {
    ok(/activeDynTrades[\s\S]{0,400}isExcludedSentinelTradeCode\(t\.code\)/.test(SERVICES_CODE), 'dynamic trades exclude the sentinel');
    ok(/rateTradeCodes[\s\S]{0,400}isExcludedSentinelTradeCode\(code\)/.test(SERVICES_CODE), 'category sections exclude the sentinel');
  });

  await test('sentinel: Tarifs sections exclude it, materials stay reachable', async () => {
    ok(/availableCategories[\s\S]{0,600}isExcludedSentinelTradeCode\(c\)/.test(RATES_CODE), 'sections exclude the sentinel');
    ok(!/filteredRates[\s\S]{0,2000}isExcludedSentinelTradeCode/.test(RATES_CODE), 'no material filter added (rows stay under « all »)');
  });

  await test('sentinel: officials and import pipeline untouched', async () => {
    ok(/if \(t\.isOfficial\) return true/.test(CALC_CODE), 'officials still always servable');
    ok(/OFFICIAL_TRADES/.test(TRADE_REPO_SRC), 'official registry untouched');
    ok(/export const UNMAPPED_REVIEW_TRADE = 'unmapped_review'/.test(IMPORT_SRC), 'pipeline still owns the sentinel');
    ok(/findTradeByCode\(UNMAPPED_REVIEW_TRADE\)/.test(IMPORT_SRC), 'pipeline still reuses the sentinel row');
    ok(!/upsertTradeByCode|createTrade|registerTrade/.test(CALC_CODE.replace(/isServableTrade/g, '')), 'no creation path added to Calculator');
    ok(!/upsertTradeByCode|createTrade|registerTrade/.test(SERVICES_CODE), 'no creation path added to Services');
  });
}

// Direct-run guard (same convention as the other suites).
const __mainEntry = (process.argv[1] || '').replace(/\\/g, '/').toLowerCase();
if (__mainEntry.endsWith('sentinelexclusion.test.ts')) {
  runSentinelExclusionTests()
    .then(() => {
      const results = testResults();
      console.log(`\n  Sentinel exclusion: ✅ ${results.passed} passed | ❌ ${results.failed} failed\n`);
      if (results.failed > 0) process.exit(1);
    })
    .catch((err) => {
      console.error('[KONSTRIVO] sentinel-exclusion suite crashed:', err);
      process.exit(1);
    });
}
