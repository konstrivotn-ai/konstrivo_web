import { strict as assert } from 'node:assert';
import {
  resolveCalculatorRuleForMaterial,
  resolveRuntimeMaterialPrice,
  resolveMaterialCalcRule,
} from '../src/utils/calculatorRules';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS ${name}`);
  } catch (err: any) {
    console.log(`  FAIL ${name}\n       ${err?.message || err}`);
    process.exit(1);
  }
}

test('canonical material resolves to active calc rule and legacy price key', () => {
  const result = resolveCalculatorRuleForMaterial({ materialId: 'plaque-ba13-standard-3m' });
  assert.equal(result.status, 'configured');
  assert.equal(result.ruleCode, 'placo_ba13_standard');
  assert.equal(result.legacyKey, 'plaque_ba13_standard');
  assert.equal(result.slotCode, 'placo_board');
});

test('material without reliable rule returns Rule not configured', () => {
  const result = resolveCalculatorRuleForMaterial({ materialId: 'material-unknown-xyz' });
  assert.equal(result.status, 'missing');
  assert.equal(result.message, 'Rule not configured');
});

test('legacy PLACO aliases remain compatible', () => {
  const result = resolveMaterialCalcRule({ legacyKey: 'plaque_ba13_standard' });
  assert.equal(result.status, 'configured');
  assert.equal(result.ruleCode, 'placo_ba13_standard');
  const runtime = resolveRuntimeMaterialPrice({
    code: 'plaque-ba13-standard-3m',
    materialId: 'plaque-ba13-standard-3m',
    price: 32,
  });
  assert.equal(runtime.status, 'resolved');
  assert.equal(runtime.legacyKey, 'plaque_ba13_standard');
  assert.equal(runtime.price, 32);
});

console.log('\ncalculatorRuntime tests completed');
