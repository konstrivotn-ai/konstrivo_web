/**
 * Calculator — file-upload entry-point contract (DB-free, static source).
 *
 * The Calculator owns NO import pipeline of its own. This suite locks the
 * integration contract for the « Importer un fichier » button:
 *   1. the button exists inside CalculatorTab and calls an OPTIONAL
 *      `onOpenCatalogUpload` callback (never a fetch/parse/write of its own);
 *   2. App.tsx wires that callback to the EXISTING app-level catalog modal
 *      (`setShowCatalogModal(true)` — the exact same modal opened from
 *      RatesTab « Import Barème Fournisseur »), i.e. the one and only
 *      catalog/import pipeline, Smart Mapping, validation and supported
 *      formats;
 *   3. Calculator formulas are untouched (no parsing / price / trade-creation
 *      identifiers beyond the wiring).
 *
 * Static (no browser, no DB) on purpose: the component sources ARE the
 * contract, exactly like the other source-reading suites of this project.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, ok, testResults } from './run';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CALC_SRC = fs.readFileSync(
  path.join(HERE, '..', 'src', 'components', 'CalculatorTab.tsx'),
  'utf8'
);
const APP_SRC = fs.readFileSync(path.join(HERE, '..', 'src', 'App.tsx'), 'utf8');

/**
 * Comment-blind view of a component source: block comments + full-line
 * comments removed. A guard that scans identifiers must not fire on a mere
 * mention inside a comment (CalculatorTab carries a pre-existing comment that
 * names `upsertTradeByCode` while explaining which artefacts are filtered).
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
}
const CALC_CODE = codeOnly(CALC_SRC);

export async function runCalculatorFileUploadTests() {
  console.log('\n📤 Calculator — file upload entry point\n');

  await test('upload: CalculatorTab declares an optional onOpenCatalogUpload callback', async () => {
    ok(/onOpenCatalogUpload\?: \(\) => void;/.test(CALC_SRC), 'optional callback prop declared');
    ok(/onOpenCatalogUpload\n\}\)/.test(CALC_SRC) || /initialTradeCode,\n\s*onOpenCatalogUpload/.test(CALC_SRC), 'callback destructured');
  });

  await test('upload: the button opens the existing modal, nothing else', async () => {
    ok(/{onOpenCatalogUpload && \(/.test(CALC_SRC), 'button rendered only when the callback is provided');
    ok(/onClick=\{onOpenCatalogUpload\}/.test(CALC_SRC), 'the button calls the callback (no fetch/parse inline)');
    ok(!/type="file"/.test(CALC_CODE), 'no private <input type="file"> — the existing pipeline stays the only one');
    ok(!/previewCatalogImport|importCatalogFile/.test(CALC_CODE), 'no direct import-pipeline call duplicated in the Calculator');
  });

  await test('upload: App wires the Calculator to the existing CatalogUploadModal', async () => {
    ok(/<CalculatorTab[\s\S]*?onOpenCatalogUpload=\{\(\) => setShowCatalogModal\(true\)\}/.test(APP_SRC), 'Calculator opens the app-level catalog modal');
    ok(/<CatalogUploadModal[\s\S]*?onApplyCatalog=\{handleBulkUpdateRates\}/.test(APP_SRC), 'the modal still applies through the shared rates path');
  });

  await test('upload: formulas untouched', async () => {
    for (const fn of ['calculateGeneric', 'calculatePlaco', 'calculatePeinture']) {
      ok(new RegExp(`import \\{[\\s\\S]*?\\b${fn}\\b`).test(CALC_SRC), `calculation import ${fn} still present`);
    }
    ok(!/upsertTradeByCode|createTrade|registerTrade/.test(CALC_CODE), 'no trade-creation identifier in the Calculator component');
  });
}

// Direct-run guard (same convention as the other suites): `npx tsx
// tests/calculatorFileUpload.test.ts` runs this DB-free suite alone.
const __mainEntry = (process.argv[1] || '').replace(/\\/g, '/').toLowerCase();
if (__mainEntry.endsWith('calculatorfileupload.test.ts')) {
  runCalculatorFileUploadTests()
    .then(() => {
      const results = testResults();
      console.log(`\n  Calculator file upload: ✅ ${results.passed} passed | ❌ ${results.failed} failed\n`);
      if (results.failed > 0) process.exit(1);
    })
    .catch((err) => {
      console.error('[KONSTRIVO] calculator-upload suite crashed:', err);
      process.exit(1);
    });
}
