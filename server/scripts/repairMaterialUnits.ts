/**
 * Unit repair — restore `materials.base_unit` from the system's OWN import record.
 *
 * THE BUG THIS REPAIRS (proved against the live database):
 *   A CSV import performed before the client-side unit mapper was fixed stored
 *   the PLACEHOLDER `unit` in `materials.base_unit` for every row whose file unit
 *   was `m`, `Set`, `Litre`, `Kg` (and case variants such as `Unit`), while `m²`
 *   survived. `/api/v1/prices` returns `materials.base_unit` verbatim as `unit`,
 *   so Outils displayed «1 unit» and priced those materials as one piece.
 *
 *   The same import ALSO recorded each row's unit VERBATIM in the active country
 *   catalog snapshot (`country_catalog_items.unit`). This script copies that
 *   recorded truth back onto the material.
 *
 * GENERIC BY CONSTRUCTION: any trade, any market, any file — the unit comes from
 * the file's own recorded value, always through the ONE shared normalizer used by
 * the app (`normalizeRateUnit`). No material name, trade or CSV is special-cased.
 *
 * SAFETY
 *  - Only the ACTIVE `country_catalogs` versions are read.
 *  - Only `materials.base_unit` is written, and only when the stored value
 *    carries NO real unit (NULL / '' / 'unit' = the old import placeholder)
 *    while the snapshot records a real unit. Prices, trades, categories, names
 *    and every other column stay untouched.
 *  - Company-scoped materials (company_id NOT NULL) are never touched.
 *  - Fully idempotent: a second run finds nothing to repair.
 *  - DRY-RUN by default — pass `--apply` to write.
 *
 * Usage:
 *   npx tsx server/scripts/repairMaterialUnits.ts           (dry-run)
 *   npx tsx server/scripts/repairMaterialUnits.ts --apply   (write)
 */
import { getDatabase } from '../db/client';
import { materials, countryCatalogItems, countryCatalogs } from '../db/schema';
import { eq, isNull, inArray } from 'drizzle-orm';
// The app's single canonical unit table — no second alias list is introduced.
import { normalizeRateUnit } from '../../src/utils/priceLookup';

const APPLY = process.argv.includes('--apply');

/** The old import placeholder ("no real unit recorded"): NULL, '', or 'unit'. */
function isPlaceholderUnit(stored: string | null | undefined): boolean {
  const raw = String(stored ?? '').trim();
  return raw === '' || normalizeRateUnit(raw) === 'unit';
}


async function main() {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available — DATABASE_URL must be set.');

  // ── Active catalog versions (the authoritative import record) ─────────────
  const activeCatalogs = await db
    .select({ id: countryCatalogs.id, countryCode: countryCatalogs.countryCode, version: countryCatalogs.version })
    .from(countryCatalogs)
    .where(eq(countryCatalogs.isActive, true));
  if (activeCatalogs.length === 0) {
    console.log('No ACTIVE country_catalogs row — nothing to repair from.');
    process.exit(0);
  }

  const items = await db
    .select({
      materialCode: countryCatalogItems.materialCode,
      fileUnit: countryCatalogItems.unit,
      countryCode: countryCatalogItems.countryCode,
    })
    .from(countryCatalogItems)
    .where(inArray(countryCatalogItems.catalogId, activeCatalogs.map((c: any) => c.id)));

  // ── Official materials (one read, matched in memory) ─────────────────────
  const official = await db
    .select({ id: materials.id, code: materials.code, baseUnit: materials.baseUnit, nameFr: materials.nameFr, trade: materials.trade })
    .from(materials)
    .where(isNull(materials.companyId));

  const byCode = new Map<string, any>();
  const byLowerCode = new Map<string, any>();
  for (const m of official) {
    byCode.set(String(m.code), m);
    const lower = String(m.code).toLowerCase();
    if (!byLowerCode.has(lower)) byLowerCode.set(lower, m);
  }

  const repairs: Array<{ id: string; code: string; nameFr: string; from: string; to: string; fileUnit: string }> = [];
  let alreadyCorrect = 0;
  let noMaterial = 0;
  let conflicts = 0; // stored unit is REAL and differs from the file → reported only, never overwritten

  for (const it of items) {
    const code = String(it.materialCode);
    const mat = byCode.get(code) ?? byLowerCode.get(code.toLowerCase());
    if (!mat) { noMaterial++; continue; }

    const fileUnit = String(it.fileUnit ?? '');
    const fileCanonical = normalizeRateUnit(fileUnit);
    const storedRaw = String(mat.baseUnit ?? '').trim();
    const storedCanonical = normalizeRateUnit(storedRaw);

    if (fileCanonical === 'unit') {
      // The file itself carried no real unit — nothing to restore.
      if (isPlaceholderUnit(storedRaw)) alreadyCorrect++;
      continue;
    }
    if (!isPlaceholderUnit(storedRaw)) {
      if (storedCanonical !== fileCanonical) conflicts++;
      else alreadyCorrect++;
      continue;
    }
    repairs.push({
      id: mat.id, code, nameFr: mat.nameFr,
      from: storedRaw === '' ? '(empty)' : storedRaw, to: fileCanonical, fileUnit,
    });
  }

  console.log(`Active catalog version(s): ${activeCatalogs.map((c: any) => `${c.countryCode} v${c.version}`).join(', ')}`);
  console.log(`Snapshot rows read        : ${items.length}`);
  console.log(`Already correct           : ${alreadyCorrect}`);
  console.log(`No matching material      : ${noMaterial}`);
  console.log(`Conflicts (left as-is)    : ${conflicts}`);
  console.log(`Repairable (placeholder)  : ${repairs.length}`);
  for (const r of repairs.slice(0, 60)) {
    console.log(`  ${r.code.padEnd(12)} ${String(r.from).padEnd(8)} -> ${String(r.to).padEnd(8)} (file '${r.fileUnit}')  ${r.nameFr}`);
  }
  if (repairs.length > 60) console.log(`  … ${repairs.length - 60} more`);

  if (!APPLY) {
    console.log('\nDRY-RUN — nothing written. Re-run with --apply to repair.');
    process.exit(0);
  }

  let written = 0;
  for (const r of repairs) {
    await db.update(materials).set({ baseUnit: r.to, updatedAt: new Date() }).where(eq(materials.id, r.id));
    written++;
  }
  console.log(`\nAPPLIED — ${written} material(s) updated (only materials.base_unit).`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[repairMaterialUnits] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
