import { strict as assert } from 'node:assert';
import {
  resolveMaterialCalcRule,
  resolveCanonicalMaterialPrice,
  type MaterialCalcResolution,
} from '../src/utils/calculatorRules';
import { DEFAULT_MARKET_RATES } from '../src/data/marketRates';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS ${name}`);
  } catch (err: any) {
    console.log(`  FAIL ${name}\n       ${err?.message || err}`);
    process.exit(1);
  }
}

test('known canonical material resolves to a calculator slot and rule', () => {
  const result = resolveMaterialCalcRule({ code: 'plaque-ba13-standard-3m', trade: 'placo' });
  assert.equal(result.status, 'configured');
  assert.equal(result.slotCode, 'placo_board');
  assert.equal(result.ruleCode, 'placo_ba13_standard');
  assert.equal(result.message, undefined);
});

test('unknown canonical material does not silently resolve to zero', () => {
  const result = resolveMaterialCalcRule({ code: 'material-unknown-xyz', trade: 'placo' });
  assert.equal(result.status, 'missing');
  assert.equal(result.message, 'Rule not configured');
  assert.equal(result.slotCode, undefined);
  assert.equal(result.ruleCode, undefined);
});

test('canonical price resolution uses legacy calculator key and preserves known price', () => {
  const resolution = resolveCanonicalMaterialPrice({ code: 'plaque-ba13-standard-3m', price: 32 }, DEFAULT_MARKET_RATES);
  assert.equal((resolution as MaterialCalcResolution).status, 'resolved');
  assert.equal((resolution as MaterialCalcResolution).legacyKey, 'plaque_ba13_standard');
  assert.equal((resolution as MaterialCalcResolution).price, 32);
});

console.log('\ncalculatorIntegration tests completed');
