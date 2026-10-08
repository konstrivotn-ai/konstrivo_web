/**
 * Universal Import — Smart-Mapping DISPLAY regression (DB-free, static source).
 *
 * Locks the display contract of the Admin panel « Import intelligent —
 * correspondance des colonnes »: it must render the mapping the BACKEND
 * returned (`appliedMapping` from POST /api/v1/catalog/preview — the very
 * object /catalog/import consumes) and can never display « — Non mappé — » for
 * a field the server mapped:
 *   1. the <select> value is `importPreview.appliedMapping[field.key]` with the
 *      Admin's manual deltas (`importMapping`) layered ON TOP — server truth
 *      first, never a separate list that processing ignores;
 *   2. a server value is ALWAYS selectable: an <option> is emitted for it even
 *      when `detectedColumns` does not contain it (a controlled <select> whose
 *      value matches no option falls back to its FIRST option, i.e. the
 *      « — Non mappé — » placeholder → a mapped field looked unmapped);
 *   3. the applied mapping is ALSO printed as readable text, so the panel can
 *      not silently disagree with the backend.
 *
 * Static (no browser, no DB) on purpose: the component source IS the contract,
 * exactly like the other source-reading suites of this project. The display fix
 * changes NOTHING in the pipeline — /preview remains the single source of truth.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, ok, testResults } from './run';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODAL_SRC = fs.readFileSync(
  path.join(HERE, '..', 'src', 'components', 'AdminDashboardModal.tsx'),
  'utf8'
);
/**
 * Isolate the mapping-selector block — from its opening comment to the NEXT
 * panel section (« Detected correspondence … »), never the whole file (no false
 * positives) and NEVER a fixed-length prefix: a 4200-character prefix silently
 * truncated the block (the emitted server-mapped <option> sits ≈4.65k chars in),
 * so an assertion inspected a view that stopped BEFORE the code it checks. The
 * COMPLETE block is analysed now; every assertion below is unchanged.
 */
const PANEL_START = MODAL_SRC.indexOf('Mapping selectors — DISPLAY ONLY');
const PANEL_END = PANEL_START >= 0 ? MODAL_SRC.indexOf('Detected correspondence', PANEL_START) : -1;
const PANEL = PANEL_START >= 0
  ? MODAL_SRC.slice(PANEL_START, PANEL_END > PANEL_START ? PANEL_END : PANEL_START + 8000)
  : '';

export async function runUniversalImportMappingDisplayTests() {
  console.log('\n🧭 Universal Import — Smart-Mapping display (server truth)\n');

  await test('display: the value comes from the SERVER mapping (appliedMapping), deltas on top', async () => {
    ok(PANEL !== '', 'the mapping panel block is found in AdminDashboardModal.tsx');
    ok(
      /const serverValue: string = importPreview\.appliedMapping\?\.\[field\.key\]/.test(PANEL),
      'the select value is seeded from appliedMapping[field.key] (the object /import uses)'
    );
    ok(
      /const current: string = hasManualDelta \?/.test(PANEL),
      "the Admin's manual deltas are layered ON TOP of the server mapping"
    );
    ok(
      /Object\.prototype\.hasOwnProperty\.call\(importMapping, field\.key\)/.test(PANEL),
      'manual detection uses hasOwnProperty (an explicit « Non mappé » stays distinguishable)'
    );
  });

  await test('display: a server-mapped column is always a selectable option (no phantom « Non mappé »)', async () => {
    ok(/const hasMatchingOption = detectedColumns\.some/.test(PANEL), 'the value is checked against the option list');
    ok(/current !== '' && !hasMatchingOption/.test(PANEL), 'the fallback <option> is emitted only when needed');
    ok(/\{current\} \(mapping serveur\)/.test(PANEL), 'the server column is rendered as an explicit option');
  });

  await test('display: the applied mapping is also rendered as readable text (field ← column)', async () => {
    ok(
      /Mapping appliqué par le serveur \(celui utilisé par l'import\)/.test(PANEL),
      'the server-mapping summary is rendered above the selectors'
    );
    ok(/✓ \{current\}/.test(PANEL), 'each mapped field prints its source column next to its label');
    ok(/Object\.entries\(importPreview\.appliedMapping \|\| \{\}\)/.test(PANEL), 'the summary reads the server mapping verbatim');
  });
}

// Direct-run guard (same convention as tests/run.ts): `npx tsx
// tests/universalImportMappingDisplay.test.ts` runs this DB-free suite alone,
// while `tests/runPhaseC.ts` imports it and just reuses the runner.
const __mainEntry = (process.argv[1] || '').replace(/\\/g, '/').toLowerCase();
if (__mainEntry.endsWith('universalimportmappingdisplay.test.ts')) {
  runUniversalImportMappingDisplayTests()
    .then(() => {
      const results = testResults();
      console.log(`\n  Universal import mapping display: ✅ ${results.passed} passed | ❌ ${results.failed} failed\n`);
      if (results.failed > 0) process.exit(1);
    })
    .catch((err) => {
      console.error('[KONSTRIVO] mapping-display suite crashed:', err);
      process.exit(1);
    });
}
