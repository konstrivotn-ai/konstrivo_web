/**
 * Step 4 — Production Catalog Seed (`npm run db:seed`).
 *
 * Idempotently seeds the canonical KONSTRIVO official catalog into the
 * EXISTING PostgreSQL schema (no schema change, no migration, no deletes):
 *
 *   1. price_sources   — the canonical sources from PRICE_SOURCES.
 *                        Naturally idempotent: `code` is the PRIMARY KEY.
 *   2. materials       — one official row per DEFAULT_MARKET_RATES entry.
 *                        - The legacy identifier (e.g. `plaque_ba13_standard`)
 *                          is stored in `materials.code` (the existing
 *                          identifier column) — `materials.id` stays the
 *                          DB-generated UUID (type unchanged).
 *                        - Lookup key: (code, company_id IS NULL) — the same
 *                          key as the existing `uq_material_code` index.
 *                        - Soft-deleted rows with the same code are
 *                          resurrected (never duplicated, never deleted).
 *   3. material_prices — one OFFICIAL current price per material:
 *                        source_code='OFFICIAL_DEFAULT', TN / TND,
 *                        is_current=true, company_id IS NULL.
 *                        Lookup key: (material_id, source_code, is_current,
 *                        is_deleted, company_id IS NULL) — existing columns
 *                        only, no new constraints.
 *                        CUSTOM / supplier / company prices are NEVER read,
 *                        touched or replaced.
 *
 * Idempotency: every write is preceded by a lookup; re-running only inserts
 * what is missing and updates rows whose official price actually changed.
 * Running it once or ten times yields the same single row set.
 *
 * Safety:
 *   - NODE_ENV=production requires SEED_CONFIRM=1 (or --dry-run).
 *   - --dry-run performs the read-only lookups and prints the plan without
 *     writing anything.
 *   - No TRUNCATE / DROP / DELETE / schema DDL anywhere in this script.
 *
 * Usage:
 *   npm run db:seed                 # seed the configured DATABASE_URL
 *   npm run db:seed -- --dry-run    # read-only plan
 *   SEED_CONFIRM=1 npm run db:seed  # explicit confirmation for production
 */
import 'dotenv/config';
import { and, eq, isNull } from 'drizzle-orm';
import { materialPrices, materials, priceSources, trades, tradeServices } from './schema';
import { DEFAULT_MARKET_RATES } from '../../src/data/marketRates';
import { PRICE_SOURCES } from '../repositories/seed';
import { config } from '../config';

const DRY_RUN = process.argv.includes('--dry-run');
const OFFICIAL_SOURCE = 'OFFICIAL_DEFAULT';

// ── Official Trades (Métiers) ───────────────────────────────────────────────
// The 12 canonical trades. is_official = true protects them from deletion.
// code values match the existing TradeCategory union in src/types.ts.
const OFFICIAL_TRADES = [
  { code: 'placo',        labelFr: 'PLACO / PLÂTRE',         labelAr: 'جبس وبلاطور',           labelDerja: 'جبس وبلاطور',           icon: 'Layers',      sortOrder: 1 },
  { code: 'peinture',     labelFr: 'PEINTURE',               labelAr: 'دهان وطلاء',            labelDerja: 'دهان',                  icon: 'Paintbrush',  sortOrder: 2 },
  { code: 'carrelage',    labelFr: 'CARRELAGE',              labelAr: 'تبليط وسيراميك',        labelDerja: 'زربيعة',                icon: 'Grid3x3',     sortOrder: 3 },
  { code: 'maconnerie',   labelFr: 'MAÇONNERIE',             labelAr: 'بناء بالأجر',           labelDerja: 'بناء',                  icon: 'BrickWall',   sortOrder: 4 },
  { code: 'plomberie',    labelFr: 'PLOMBERIE',              labelAr: 'سباكية',                labelDerja: 'سباكية',                icon: 'Droplets',    sortOrder: 5 },
  { code: 'electricite',  labelFr: 'ÉLECTRICITÉ',            labelAr: 'كهرباء',                labelDerja: 'كهرباء',                icon: 'Zap',         sortOrder: 6 },
  { code: 'etancheite',   labelFr: 'ÉTANCHÉITÉ',             labelAr: 'عزل مائي',              labelDerja: 'عزل ماء',               icon: 'ShieldCheck', sortOrder: 7 },
  { code: 'isolation',    labelFr: 'ISOLATION',              labelAr: 'عزل حراري',             labelDerja: 'عزل حرارة',              icon: 'Thermometer', sortOrder: 8 },
  { code: 'menuiserie',   labelFr: 'MENUISERIE',             labelAr: 'نجارة',                 labelDerja: 'نجارة',                  icon: 'Hammer',      sortOrder: 9 },
  { code: 'sols',         labelFr: 'REVÊTEMENTS DE SOL',     labelAr: 'أرضيات',                labelDerja: 'أرضيات',                icon: 'LayoutGrid',  sortOrder: 10 },
  { code: 'facade',       labelFr: 'FAÇADE & EXTÉRIEUR',     labelAr: 'واجهات خارجية',         labelDerja: 'واجهات',                icon: 'Building2',   sortOrder: 11 },
  { code: 'demolition',   labelFr: 'DÉMOLITION',             labelAr: 'هدم وإزالة',            labelDerja: 'هدم',                   icon: 'Trash2',      sortOrder: 12 },
] as const;

interface SeedStats {
  sourcesInserted: number;
  sourcesExisting: number;
  materialsCreated: number;
  materialsResurrected: number;
  materialsUpdated: number;
  materialsUnchanged: number;
  pricesCreated: number;
  pricesToCreate: number;
  pricesUpdated: number;
  pricesUnchanged: number;
  servicesInserted: number;
  servicesExisting: number;
}

const stats: SeedStats = {
  sourcesInserted: 0,
  sourcesExisting: 0,
  materialsCreated: 0,
  materialsResurrected: 0,
  materialsUpdated: 0,
  materialsUnchanged: 0,
  pricesCreated: 0,
  pricesToCreate: 0,
  pricesUpdated: 0,
  pricesUnchanged: 0,
  servicesInserted: 0,
  servicesExisting: 0,
};

// Phase D — canonical services per official trade (data-driven, not hardcoded in code).
// These seed the trade_services table so the calculator can resolve services
// from the database for any trade, including dynamic ones added later.
const OFFICIAL_TRADE_SERVICES: Record<string, Array<{ nameFr: string; nameAr: string; unit: string; rate: number }>> = {
  placo: [
    { nameFr: 'Pose de cloisons sèches', nameAr: 'تركيب جدران جافة', unit: 'm²', rate: 18 },
    { nameFr: 'Faux plafonds BA13', nameAr: 'أسقف صناعية جبس', unit: 'm²', rate: 20 },
    { nameFr: 'Doublage mural collé', nameAr: 'عزل جدار لاصق', unit: 'm²', rate: 16 },
    { nameFr: 'Caisson retombée', nameAr: 'إضاءة مخفية', unit: 'ml', rate: 25 },
  ],
  peinture: [
    { nameFr: 'Préparation de surface', nameAr: 'تحضير السطح', unit: 'm²', rate: 5 },
    { nameFr: 'Peinture acrylique intérieure', nameAr: 'دهان أكريليك داخلي', unit: 'm²', rate: 8 },
    { nameFr: 'Peinture satinée', nameAr: 'دهان ساتان', unit: 'm²', rate: 10 },
    { nameFr: 'Enduit décoratif', nameAr: 'جص ديكوري', unit: 'm²', rate: 15 },
  ],
  carrelage: [
    { nameFr: 'Pose droite carrelage', nameAr: 'تبليط مستقيم', unit: 'm²', rate: 22 },
    { nameFr: 'Pose diagonale', nameAr: 'تبليط قطري', unit: 'm²', rate: 28 },
    { nameFr: 'Jointoiement', nameAr: 'حشو الفواصل', unit: 'm²', rate: 4 },
  ],
  maconnerie: [
    { nameFr: 'Maçonnerie brique', nameAr: 'بناء بالطوب', unit: 'm²', rate: 15 },
    { nameFr: 'Maçonnerie bloc béton', nameAr: 'بناء بالبلوك', unit: 'm²', rate: 18 },
    { nameFr: 'Enduit ciment', nameAr: 'جص إسمنتي', unit: 'm²', rate: 12 },
  ],
  plomberie: [
    { nameFr: 'Réseau PPR', nameAr: 'شبكة PPR', unit: 'point', rate: 45 },
    { nameFr: 'Évacuation PVC', nameAr: 'صرف PVC', unit: 'ml', rate: 20 },
    { nameFr: 'Robinetterie', nameAr: 'سباكة وتركيب', unit: 'unit', rate: 35 },
  ],
  electricite: [
    { nameFr: 'Câblage éclairage', nameAr: 'أسلاك الإنارة', unit: 'point', rate: 25 },
    { nameFr: 'Prises de courant', nameAr: 'مآخذ كهرباء', unit: 'point', rate: 20 },
    { nameFr: 'Tableau électrique', nameAr: 'لوحة كهربائية', unit: 'unit', rate: 150 },
  ],
  etancheite: [
    { nameFr: 'Membrane bitumineuse', nameAr: 'غشاء بيتوميني', unit: 'm²', rate: 18 },
    { nameFr: 'Résine liquide', nameAr: 'راتنج سائل', unit: 'm²', rate: 22 },
  ],
  isolation: [
    { nameFr: 'Isolation thermique laine de verre', nameAr: 'عزل حراري صوف زجاجي', unit: 'm²', rate: 14 },
    { nameFr: 'Polystyrène expansé', nameAr: 'بولسترين ممدد', unit: 'm²', rate: 12 },
  ],
  menuiserie: [
    { nameFr: 'Pose de portes', nameAr: 'تركيب أبواب', unit: 'unit', rate: 60 },
    { nameFr: 'Pose de fenêtres', nameAr: 'تركيب نوافذ', unit: 'unit', rate: 80 },
  ],
  sols: [
    { nameFr: 'Pose parquet stratifié', nameAr: 'تركيب باركيه', unit: 'm²', rate: 12 },
    { nameFr: 'Béton ciré', nameAr: 'إسمنت مصقول', unit: 'm²', rate: 35 },
  ],
  facade: [
    { nameFr: 'Enduit monocouche', nameAr: 'جص أحادي الطبقة', unit: 'm²', rate: 18 },
    { nameFr: 'Peinture façade', nameAr: 'دهان واجهة', unit: 'm²', rate: 12 },
  ],
  demolition: [
    { nameFr: 'Démolition cloisons', nameAr: 'هدم جدران', unit: 'm²', rate: 8 },
    { nameFr: 'Évacuation gravats', nameAr: 'نقل الأنقاض', unit: 'm²', rate: 6 },
  ],
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const databaseUrl = config.databaseUrl;
  if (!databaseUrl) {
    console.error('[KONSTRIVO-SEED] FATAL: DATABASE_URL is not set. Refusing to guess a target (see drizzle.config.ts).');
    process.exit(1);
  }

  const isProd = process.env.NODE_ENV === 'production';
  if (isProd && !DRY_RUN && process.env.SEED_CONFIRM !== '1') {
    console.error('[KONSTRIVO-SEED] REFUSING: NODE_ENV=production requires SEED_CONFIRM=1 (or use --dry-run).');
    process.exit(1);
  }

  // Same safe bootstrap pattern as server/db/client.ts (lazy dynamic imports).
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const postgresFactory = (await import('postgres')).default;
  const client = postgresFactory(databaseUrl, { max: 1, idle_timeout: 5, connect_timeout: 10 });
  const db = drizzle(client);

  try {
    await client`SELECT 1`;
  } catch (err) {
    console.error('[KONSTRIVO-SEED] FATAL: cannot connect to DATABASE_URL:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  let host = 'unknown';
  try { host = new URL(databaseUrl).host; } catch { /* keep 'unknown' — never print credentials */ }

  console.log(`[KONSTRIVO-SEED] target host : ${host} (${isProd ? 'PRODUCTION' : 'non-production'})`);
  console.log(`[KONSTRIVO-SEED] mode        : ${DRY_RUN ? 'DRY-RUN (read-only plan, no writes)' : 'WRITE (additive, idempotent)'}`);
  console.log(`[KONSTRIVO-SEED] catalog     : ${DEFAULT_MARKET_RATES.length} materials from src/data/marketRates.ts`);
  const startedAt = Date.now();

  try {
    // ── 1) price_sources — PK `code` makes this naturally idempotent ────────
    for (const source of PRICE_SOURCES) {
      const existing = await db.select().from(priceSources)
        .where(eq(priceSources.code, source.code))
        .limit(1);
      if (existing.length > 0) { stats.sourcesExisting++; continue; }
      stats.sourcesInserted++;
      if (DRY_RUN) continue;
      await db.insert(priceSources).values({
        code: source.code,
        name: source.name,
        isVerified: source.isVerified,
        priorityWeight: source.priorityWeight,
      }).onConflictDoNothing({ target: priceSources.code });
    }
    // ── 2) trades — seed the 12 official trades ─────────────────────────────
    const tradeCodeToId = new Map<string, string>();
    for (const t of OFFICIAL_TRADES) {
      const existing = await db.select().from(trades)
        .where(eq(trades.code, t.code))
        .limit(1);
      if (existing.length > 0) {
        tradeCodeToId.set(t.code, existing[0].id);
        continue;
      }
      stats.sourcesInserted++; // reuse counter for visibility; trades are inserted
      if (DRY_RUN) {
        tradeCodeToId.set(t.code, `dry-run-${t.code}`);
        continue;
      }
      const [inserted] = await db.insert(trades).values({
        code: t.code,
        labelFr: t.labelFr,
        labelAr: t.labelAr ?? null,
        labelDerja: t.labelDerja ?? null,
        icon: t.icon ?? null,
        sortOrder: t.sortOrder,
        isActive: true,
        isOfficial: true,
      }).onConflictDoNothing({ target: trades.code }).returning({ id: trades.id });
      if (inserted?.id) tradeCodeToId.set(t.code, inserted.id);
    }

    // ── 3) materials — upsert by (code, company_id IS NULL) + link trade_id ──
    for (const rate of DEFAULT_MARKET_RATES) {
      const desired = {
        trade: rate.category,
        tradeId: tradeCodeToId.get(rate.category) ?? null,
        category: rate.category,
        nameFr: rate.nameFr,
        nameAr: rate.nameAr ?? null,
        nameEn: rate.nameEn ?? null,
        baseUnit: rate.unit,
        isOfficial: true,
        technicalSpecs: rate.note ?? null,
      };

      const found = await db.select().from(materials)
        .where(and(eq(materials.code, rate.id), isNull(materials.companyId)))
        .limit(1);

      if (found.length === 0) {
        // New official material — legacy identifier lives in `materials.code`.
        stats.materialsCreated++;
        if (DRY_RUN) continue;
        await db.insert(materials).values({
          code: rate.id,
          trade: desired.trade,
          tradeId: desired.tradeId,
          category: desired.category,
          nameFr: desired.nameFr,
          nameAr: desired.nameAr,
          nameEn: desired.nameEn,
          baseUnit: desired.baseUnit,
          isOfficial: desired.isOfficial,
          companyId: null,
          technicalSpecs: desired.technicalSpecs,
        }).returning({ id: materials.id });
        continue;
      }

      const current = found[0];
      const identical =
        !current.isDeleted &&
        current.trade === desired.trade &&
        (current.tradeId ?? null) === desired.tradeId &&
        current.category === desired.category &&
        current.nameFr === desired.nameFr &&
        (current.nameAr ?? null) === desired.nameAr &&
        (current.nameEn ?? null) === desired.nameEn &&
        current.baseUnit === desired.baseUnit &&
        current.isOfficial === desired.isOfficial &&
        (current.technicalSpecs ?? null) === desired.technicalSpecs;

      if (identical) { stats.materialsUnchanged++; continue; }

      // Update in place (or resurrect a soft-deleted row) — never duplicate.
      stats[current.isDeleted ? 'materialsResurrected' : 'materialsUpdated']++;
      if (DRY_RUN) continue;
      await db.update(materials).set({
        trade: desired.trade,
        tradeId: desired.tradeId,
        category: desired.category,
        nameFr: desired.nameFr,
        nameAr: desired.nameAr,
        nameEn: desired.nameEn,
        baseUnit: desired.baseUnit,
        isOfficial: desired.isOfficial,
        technicalSpecs: desired.technicalSpecs,
        isDeleted: false,
        deletedAt: null,
        updatedAt: new Date(),
      }).where(eq(materials.id, current.id));
    }
    // ── 4) material_prices — one official current price per material ────────
    for (const rate of DEFAULT_MARKET_RATES) {
      const found = await db.select().from(materials)
        .where(and(eq(materials.code, rate.id), isNull(materials.companyId)))
        .limit(1);
      const materialId: string | undefined = found[0]?.id;

      if (!materialId) {
        // Dry-run on an empty DB: the material itself would only exist after a
        // real run — the official price follows right after it.
        stats.pricesToCreate++;
        continue;
      }

      const priceFound = await db.select().from(materialPrices).where(and(
        eq(materialPrices.materialId, materialId),
        eq(materialPrices.sourceCode, OFFICIAL_SOURCE),
        eq(materialPrices.isCurrent, true),
        eq(materialPrices.isDeleted, false),
        isNull(materialPrices.companyId),
      )).limit(1);

      if (priceFound.length === 0) {
        stats.pricesCreated++;
        if (DRY_RUN) continue;
        await db.insert(materialPrices).values({
          materialId,
          sourceCode: OFFICIAL_SOURCE,
          countryCode: 'TN',
          currencyCode: 'TND',
          unitPrice: rate.unitPriceTnd.toFixed(3),
          companyId: null,
          supplierId: null,
          isCurrent: true,
          effectiveFrom: todayIso(),
          notes: rate.defaultPriceTnd !== rate.unitPriceTnd
            ? `Default: ${rate.defaultPriceTnd} TND`
            : undefined,
        });
        continue;
      }

      const currentPrice = priceFound[0];
      const samePrice = parseFloat(String(currentPrice.unitPrice)).toFixed(3) === rate.unitPriceTnd.toFixed(3);
      if (samePrice) { stats.pricesUnchanged++; continue; }

      // Official barème changed → update the official current price in place.
      // CUSTOM / supplier prices for the same material are NOT touched.
      stats.pricesUpdated++;
      if (DRY_RUN) continue;
      await db.update(materialPrices).set({
        unitPrice: rate.unitPriceTnd.toFixed(3),
        effectiveFrom: todayIso(),
        updatedAt: new Date(),
      }).where(eq(materialPrices.id, currentPrice.id));
    }

    // ── 5) trade_services — seed canonical services per official trade ──────
    for (const [tradeCode, services] of Object.entries(OFFICIAL_TRADE_SERVICES)) {
      const tradeId = tradeCodeToId.get(tradeCode);
      if (!tradeId || tradeId.startsWith('dry-run-')) continue;
      for (let i = 0; i < services.length; i++) {
        const svc = services[i];
        // Idempotency: skip if a service with the same name already exists for this trade
        const nameExists = await db.select({ id: tradeServices.id }).from(tradeServices)
          .where(and(eq(tradeServices.tradeId, tradeId), eq(tradeServices.nameFr, svc.nameFr)))
          .limit(1);
        if (nameExists.length > 0) { stats.servicesExisting++; continue; }
        stats.servicesInserted++;
        if (DRY_RUN) continue;
        await db.insert(tradeServices).values({
          tradeId,
          nameFr: svc.nameFr,
          nameAr: svc.nameAr,
          defaultUnit: svc.unit,
          suggestedRateTnd: svc.rate.toFixed(3),
          sortOrder: i,
        });
      }
    }

    // ── Summary ──────────────────────────────────────────────────────────────
    const label = DRY_RUN ? 'WOULD' : 'DID';
    console.log('[KONSTRIVO-SEED] ── Summary ─────────────────────────────');
    console.log(`[KONSTRIVO-SEED] price_sources : ${label} insert ${stats.sourcesInserted}, existing ${stats.sourcesExisting}`);
    console.log(`[KONSTRIVO-SEED] materials     : ${label} create ${stats.materialsCreated}, resurrect ${stats.materialsResurrected}, update ${stats.materialsUpdated}, unchanged ${stats.materialsUnchanged}`);
    if (stats.pricesToCreate > 0) {
      console.log(`[KONSTRIVO-SEED] prices        : ${stats.pricesToCreate} would follow newly created materials (run without --dry-run first)`);
    }
    console.log(`[KONSTRIVO-SEED] prices        : ${label} create ${stats.pricesCreated}, update ${stats.pricesUpdated}, unchanged ${stats.pricesUnchanged}`);
    console.log(`[KONSTRIVO-SEED] trade_services: ${label} insert ${stats.servicesInserted}, existing ${stats.servicesExisting}`);
    console.log(`[KONSTRIVO-SEED] done in ${Date.now() - startedAt}ms ${DRY_RUN ? '(dry-run — nothing was written)' : ''}`);
  } finally {
    try { await client.end({ timeout: 1 }); } catch { /* never connected */ }
  }
}

main().catch(err => {
  console.error('[KONSTRIVO-SEED] FATAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});