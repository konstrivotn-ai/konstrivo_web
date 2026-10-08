/**
 * Isolation → polystyrene (XPS) — targeted fix test:
 *   npx tsx tests/isolationPolystyrene.test.ts
 *
 * Proves selecting `polystyrene` no longer returns Laine de Roche materials
 * and that XPS quantities are correct — and that the two laine branches are
 * untouched (regression).
 */
import { strict as assert } from 'node:assert';
import { calculateIsolation, IsolationInput } from '../src/utils/calculations';
import { MaterialRate } from '../src/types';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS ${name}`);
  } catch (err: any) {
    console.log(`  FAIL ${name}\n       ${err?.message || err}`);
    process.exit(1);
  }
}

const baseInput = (insulationType: IsolationInput['insulationType']): IsolationInput => ({
  areaM2: 45.0,
  insulationType,
  wasteMarginPercent: 10,
  laborRatePerM2: 6.0,
});

test('polystyrene → XPS material, never Laine de Roche', () => {
  const res = calculateIsolation(baseInput('polystyrene'), []);
  const ids = res.materialItems.map(i => i.id);
  assert.ok(!ids.includes('laine_de_roche_50mm'), 'must not return laine de roche id');
  assert.ok(!ids.includes('laine_de_verre_50mm'), 'must not return laine de verre id');
  assert.ok(ids.includes('polystyrene_xps_50mm'), 'must return XPS id');
  const xps = res.materialItems.find(i => i.id === 'polystyrene_xps_50mm')!;
  assert.ok(/XPS/i.test(xps.nameFr), 'label must mention XPS');
  assert.equal(res.subType, 'polystyrene');
});

test('polystyrene quantities: ceil(45 × 1.10 / 0.72) = 69 panels', () => {
  const res = calculateIsolation(baseInput('polystyrene'), []);
  const xps = res.materialItems.find(i => i.id === 'polystyrene_xps_50mm')!;
  assert.equal(xps.qty, 69);
  assert.equal(xps.unit, 'panneaux 0.72m²');
  assert.equal(xps.unitPriceTnd, 15.0, 'fallback default price when rate absent');
  assert.equal(xps.totalTnd, 69 * 15.0);
  const bande = res.materialItems.find(i => i.id === 'bande_resiliente_48mm')!;
  assert.ok(bande, 'acoustic strip accessory still present');
});

test('polystyrene totals are internally consistent', () => {
  const res = calculateIsolation(baseInput('polystyrene'), []);
  const sum = res.materialItems.reduce((a, i) => a + i.totalTnd, 0);
  assert.equal(res.totalMaterialTnd, sum);
});

test('regression — laine_de_roche branch unchanged (id + qty 7)', () => {
  const res = calculateIsolation(baseInput('laine_de_roche_50mm'), []);
  const ldr = res.materialItems.find(i => i.id === 'laine_de_roche_50mm')!;
  assert.ok(ldr, 'laine de roche id preserved');
  assert.equal(ldr.qty, Math.max(1, Math.ceil((45 * 1.1) / 7.2))); // = 7
  assert.ok(!res.materialItems.some(i => i.id === 'polystyrene_xps_50mm'));
});

test('regression — laine_de_verre branch unchanged (id + qty 4)', () => {
  const res = calculateIsolation(baseInput('laine_de_verre_50mm'), []);
  const ldv = res.materialItems.find(i => i.id === 'laine_de_verre_50mm')!;
  assert.ok(ldv, 'laine de verre id preserved');
  assert.equal(ldv.qty, Math.max(1, Math.ceil((45 * 1.1) / 15.0))); // = 4
});

test('server rate for XPS overrides the fallback when present', () => {
  const rates: MaterialRate[] = [{
    id: 'polystyrene_xps_50mm', category: 'isolation', nameFr: 'XPS', nameAr: '',
    unit: 'panneau', unitPriceTnd: 22.5, defaultPriceTnd: 22.5,
  }];
  const res = calculateIsolation(baseInput('polystyrene'), rates);
  const xps = res.materialItems.find(i => i.id === 'polystyrene_xps_50mm')!;
  assert.equal(xps.unitPriceTnd, 22.5);
  assert.equal(xps.totalTnd, 69 * 22.5);
});

console.log('  — isolation polystyrene tests done —');