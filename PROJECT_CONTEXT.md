# KONSTRIVO — Project Context (Country Catalog)

> Created 2026-09-21 (did not exist in the pre-Phase-1 backup). Scope: the
> Phase 1 central catalog system. General project overview: `PROJECT_OVERVIEW.md`;
> current status: `PROJECT_STATE.md`.

## Central chain

```
Country → Country Catalog (version) → Trades → Materials → Prices → Calculation Rules
```

- **Country → Catalog:** every CSV/XLSX import creates ONE catalog VERSION per
  country (`country_catalogs`). Exactly ONE version per country is `is_active`.
  Identity = `country_code + content_sha256` (canonical rows + currency +
  country). The upload FILENAME is metadata only — never identity.
- **Catalog → Trades/Materials:** `country_catalog_items` snapshots every row of
  a version: `trade` = normalized trade code, `category` = supplier family label
  (VERBATIM, e.g. "Menuiserie Aluminium") — the two are NEVER merged. The legacy
  global `trades` / `materials` / `material_prices` upsert path is unchanged
  (backward compatible with everything already consuming `/api/v1`).
- **Prices:** live per country/currency in `material_prices(country_code,
  currency_code)` (existing), mirrored in the version snapshot (`price_ht`).
- **Calculation Rules:** `country_calculation_rules` = per-country data rows
  (`default_tva`, `timbre_fiscal`, `retenue_garantie`, …). Resolved by
  `getCountryCalcRules(country)` — DB first, static TN fallback. Calculators
  must read rules from here instead of gaining `if (country === …)` branches.

## Invariants (all verified by tests/phase1_country_catalog.test.ts)

1. Full-file validation BEFORE any write (existing pipeline behaviour kept).
2. Create/update without duplicates (UNIQUE `(catalog_id, material_code)` +
   conflict-safe insert + legacy upsert).
3. `trade` and `category` are separate columns — no mixing.
4. A new CSV for the same country becomes the NEW ACTIVE catalog (old versions
   deactivated by UPDATE, never deleted — history kept).
5. Items absent from the new file are no longer part of the ACTIVE version
   (they remain readable in their historical version snapshots).
6. Deleting the local CSV file does NOT touch Supabase — data lives only in DB.
7. Identity is Country + content hash — never the filename alone.
8. Materials/units/prices/TVA/rules may differ per country without code changes.
9. Rules are data (`country_calculation_rules`), not code branches.
10. Import is idempotent: re-uploading identical data = replay, ZERO writes.

## Import (Admin, CATALOG_OFFICIAL_MANAGE)

- `POST /api/v1/catalog/import-csv` (multipart) or `POST /api/v1/catalog/import`
  with `countryCode` + `currencyCode` fields/query (+ optional `sourceRef`).
- Response now includes additive `catalog: { id, version, countryCode,
  idempotentReplay }`.
- Read side: `GET /api/v1/reference/catalog-active?country=TN`,
  `GET /api/v1/reference/calc-rules?country=TN`.

## Test data convention (for verification only — nothing pre-seeded)

- Aluminium: 40 materials `AL001–AL040`, `trade=Aluminium`,
  `category=Menuiserie Aluminium`.
- Installation Chauffroie/HVAC: 20 materials `HV001–HV020`.
- NEVER move `accessoires` items into the Aluminium trade.

## Migrations to apply (additive, re-runnable, no production data touched)

```
server/db/migrations/0011_country_catalog.sql
server/db/migrations/0012_country_catalog_items.sql   (rules index NULLS NOT DISTINCT)
server/db/migrations/0013_country_rules_seed.sql
server/db/migrations/0014_country_rules_idempotent.sql (repairs DBs where 0013 ran pre-fix)
```
Apply with any Postgres client against the target DB (psql, or the
`server/scripts/apply_*` / whole-file `tx.unsafe` pattern). Safe to re-run.
NOTE: `_apply_mig.mjs` cannot parse `DO $$ … $$` blocks (pre-existing splitter
bug) — use the whole-file applier for 0012+.

## Applied status (2026-09-22)

All four migrations are APPLIED and COMMITTED on the production Supabase DB
(`DATABASE_URL` from `server/.env`), with a fresh full backup taken first
(`backups/prod/konstrivo_prod_pre_migrations_0011-0013_20260922070906..dump`).
Verified live: tables/indexes/FK exist, 5 TN rules exact, seed replay idempotent
(5 stays 5), `country_catalogs=0` / `country_catalog_items=0`.

## Global Catalog (Phase 4)
KONSTRIVO includes a Global Product Master layer on top of existing materials/material_prices.
- Backend routes mounted at /api/v1/global-catalog
- Migrations: 0016_global_product_master.sql, 0017_global_catalog_hardening.sql
- Admin-only mutations require admin role + CATALOG_OFFICIAL_MANAGE entitlement.
- Preview import is read-only; commit import writes staged items and requires admin.

## Dynamic Métré — Final Verified Status

- Dynamic Métré is **Data-Driven**, not Trade-Specific.
- Adding a new Trade requires **no** `if/else` or `switch` on the trade inside the Calculator.
- Approved path: `Admin/Data → Catalog → Trade → Métré Elements → Dynamic Métré Engine → Calculator → Materials/Services → Devis`.
- DB overrides work **per-element** (by `elementCode`) and never replace the whole list.
- Material/Service bindings travel through the path **without changing the computed quantity**.
- A new Trade was tested end-to-end (Trade → Calculator → Materials/Services → Devis) successfully.
- Legacy trades regression: `20 passed | 0 failed`.
- Phase C catalog/admin/import verification: `85 passed | 0 failed`.
- G2 real Test DB verification: PASS.
- Final hardcoded-trade audit: PASS.
- No hardcoded calculator branches such as `if (tradeCode === "placo")`, `if (tradeCode === "peinture")`, or `switch (tradeCode)`.
- `calculatorRulesBridge.ts` uses generic trade matching, not Trade-specific logic.
- `UNMAPPED_REVIEW_TRADE` in `catalogImport.ts` is a technical import/review sentinel, not a hardcoded Trade métier.
