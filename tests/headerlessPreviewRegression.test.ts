import assert from 'node:assert/strict';
import { parseCatalogCsv } from '../server/utils/csv';
import { normalizeAndValidateRows, resolveMapping } from '../server/services/catalogImport';

const csv = Array.from({ length: 52 }, (_, i) => {
  const n = String(i + 1).padStart(3, '0');
  return `01.01.${n},"ITEM CONSTRUCTION ${n}",${(3.5 + i).toFixed(2)},M2`;
}).join('\n');

// Reproduce the Excel/LibreOffice export that caused every field to appear
// "Non mappé" in the Admin preview.
const parsed = parseCatalogCsv(`sep=;\n${csv.replace(/,/g, ';')}`);
assert.equal(parsed.headerless, true, 'CSV sans entête doit être détecté');
assert.equal(parsed.rows.length, 52, 'aucune ligne ne doit être perdue');
assert.deepEqual(parsed.headers, ['material_code', 'material_name', 'price_ht', 'unit']);

const mapping = resolveMapping(parsed.headers, parsed.rows[0]);
assert.equal(mapping.appliedMapping.material_code, 'material_code');
assert.equal(mapping.appliedMapping.material_name, 'material_name');
assert.equal(mapping.appliedMapping.price_ht, 'price_ht');
assert.equal(mapping.appliedMapping.unit, 'unit');
assert.deepEqual(mapping.unmappedRequired, ['trade_code']);

const normalized = normalizeAndValidateRows(
  parsed.rows,
  mapping.appliedMapping,
  { countryCode: 'TN', currencyCode: 'TND' },
  'terrassement'
);
assert.equal(normalized.failed.length, 0, 'aucune ligne ne doit être rejetée');
assert.equal(normalized.valid.length, 52, '52 lignes doivent être prévisualisées/importables');
assert.equal(normalized.valid[0].reference, '01.01.001');
assert.equal(normalized.valid[0].price, 3.5);
assert.equal(normalized.valid[0].trade, 'terrassement');

console.log('headerlessPreviewRegression: PASS — 52/52 rows mapped and valid');
