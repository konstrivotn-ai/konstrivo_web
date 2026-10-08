# Global Catalog (Phase 4)

This phase adds a **Global Product Master** layer on top of existing `materials` / `material_prices`.

## What was added
- DB schema: `server/db/schema/globalCatalog.ts`
- Migration: `server/db/migrations/0016_global_product_master.sql`
- Repository: `server/repositories/globalCatalogRepository.ts`
- Import service: `server/services/globalCatalogImport.ts`
- API routes: `server/routes/v1/globalCatalog.ts` (mounted at `/api/v1/global-catalog`)

## Safety
- `materials` and `material_prices` are unchanged.
- Matching is **strong-identifier exact match only**; no name-based merges.
- Preview import does **not** write to DB.
- Commit import is **admin-only** (`CATALOG_OFFICIAL_MANAGE` + admin role).

## Endpoints
- `GET  /api/v1/global-catalog/products`
- `GET  /api/v1/global-catalog/products/:id`
- `POST /api/v1/global-catalog/admin/products`
- `PATCH /api/v1/global-catalog/admin/products/:id`
- `POST /api/v1/global-catalog/admin/products/:id/identifiers`
- `POST /api/v1/global-catalog/admin/material-link`
- `POST /api/v1/global-catalog/admin/availability`
- `POST /api/v1/global-catalog/admin/import/preview` (multipart file=csv/xlsx)
- `POST /api/v1/global-catalog/admin/import/commit` (multipart file=csv/xlsx)
- `GET  /api/v1/global-catalog/admin/imports` — **Import History (READ-ONLY)**: lists the existing `catalog_imports` runs (date, file/source, type, country, status, total, valid/invalid/matched/review/new, `importId`). Admin-only (`CATALOG_OFFICIAL_MANAGE` + admin role), writes nothing.
- `GET  /api/v1/global-catalog/admin/sources` — **Sources Management (list)**: existing `catalog_sources` rows with `?search=` (name/provider), `?country=`, `?type=` (csv/xlsx/api/pdf/manual/…), `?status=` (active/inactive) + `limit`/`offset`.
- `POST /api/v1/global-catalog/admin/sources` — create a source (`name` + `sourceType` required; optional `countryCode`, `provider`, `url`, `updateFrequency`, `status`, `configuration`). App-level duplicate rejection (409) on the `ensureCatalogSource` identity (name + type + country); unknown country code → 400 (FK `country_code → countries(code)`).
- `PATCH /api/v1/global-catalog/admin/sources/:id` — update any provided field; `status: "inactive"` is the **disable** action. Rename collisions → 409, unknown id → 404.

> **Sources Management never imports or syncs:** POST/PATCH only write the `catalog_sources` row. `last_successful_sync_at` / `last_error` are never touched and no `catalog_imports` run is created (API Sync + scheduling are out of scope).
