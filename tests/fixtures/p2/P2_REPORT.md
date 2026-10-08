# P2 — Audit + Trial Data Pack Report (Astral Lakalo)

**Scope:** audit only + ONE temporary trial Data Pack for the P2 Métré → Material Binding path.
**No Production DB involvement:** 0 INSERT/UPDATE/DELETE, 0 migrations, 0 Supabase calls, 0 seed changes.

**P2.2 update (same session):** metadata-only refresh of this pack from the verified product
source — OFFICIAL Astral technical sheet for **LAKALO SATINÉ** (rendement **11–13 m²/L, per coat**).
No engine/binding/calculation behaviour changed; `PROPOSED_ONLY` + fail-closed preserved.
**Stop after P2.2** (P2.3 not started).

---

## 1. Files inspected (read-only)

| File | What was established |
|---|---|
| `src/data/metreElements.ts` | Element registry + `mapMetreElementRow` + `isValidMetreElementShape`. `peinture/mur_interieur` exists as a **legacy-shape** element (surface, `largeur × hauteur × nb`, `m²`) with **no** bindings, **no** enriched block, **no** `layers`, **no** coverage. Bindings only travel through a row when the row carries them. |
| `src/utils/metreBindings.ts` | Phase-2 binding model: `MaterialBinding = { slotCode?, materialCode?, driver, coefficient?, coveragePerProductUnit?, wastePercent?, outputUnit? }`, `driver.type = metre_qty \| dimension \| constant`. Unresolved bindings must stay REVIEW. |
| `src/utils/metreToCalculationResult.ts` | `computeMetreBoundOutputs`: `qty = (metreQty × coefficient) ÷ coverage` (coverage `basis` must equal the metre unit), `round3`, then resolve `materialCode` against the `rates` list → `unresolved_material` when no match, `price_unavailable` when the matched row has no positive price. |
| `server/services/catalogImport.ts` | Import pipeline accepts optional `material_bindings` / `service_bindings` **JSON cells** (explicit JSON only, never repaired/guessed) and validates the element through the SAME `isValidMetreElementShape`; commit writes via `upsertTradeMetreElement` (DB write path — NOT used in this session). |
| `server/repositories/drizzleMaterialRepository.ts` | Official material = `company_id IS NULL` + legacy `code`; `upsertMaterialByCode` / `findOfficialMaterialByCode`. A binding's `materialCode` must match one of these codes to resolve. |
| `server/repositories/drizzlePriceRepository.ts` | `review_status` values are `pending \| reviewed \| rejected \| published` (default `published`); public/calculator reads only `published + is_current + !is_deleted`; `upsertOfficialPrice` **throws** if the official material code does not exist. |
| `server/db/schema/catalog.ts`, `server/repositories/drizzleTradeMetreElementRepository.ts` | `trade_metre_elements` has `material_bindings` / `service_bindings` (jsonb, migration 0020) and an enriched set (`layers`, `waste_percent`, `coverage_per_product_unit`, …) — but **no `review_status` column**. |

---

## 2. Data Pack created (temporary, outside Production)

**Path:** `tests/fixtures/p2/astral_lakalo_datapack.json`

- Product: **Astral Lakalo** · Brand: **Astral** · Trade: **peinture** · Work type/Métré element: **`mur_interieur`**
- Product coverage (P2.2, official source): **NOMINAL 13 m²/L**, `min 11 m²/L`, `max 13 m²/L`, **basis = per coat**, `guaranteed: false` → binding keeps `{ value: 13, unit: "L", basis: "m²" }`.
  - Source: **official Astral technical sheet for LAKALO SATINÉ** (rendement 11–13 m²/L per coat; Astral Tunisia identifies Lakalo as an official product). **13 is the nominal top of that range — NOT a guaranteed coverage.**
  - The min/max are review metadata only: they are **not** encoded into the binding, **no** waste percentage was added, and the P2 formula stays `50 × 1 ÷ 13 = 3.846 L`.
- coefficient: **1** · driver: **`metre_qty`** · outputUnit: **`L`**
- source/provenance: `OFFICIAL_ASTRAL_TECHNICAL_SHEET_LAKALO_SATINE` (+ `provenance.technicalSheet` block: brand/product/document/range/perCoat/officiallyIdentified) and the code-as-truth element mirror; `supabaseWrites: 0`, no official material/price match.
- **2 coats = PRODUCT APPLICATION RECOMMENDATION only** (`applicationRecommendation: { coats: 2, productScope: "Astral Lakalo only" }`) — carried from this fixture/report context at **product level**; still **NO `layers=2`** in the generic `peinture/mur_interieur` element, not in the binding, never a general paint rule (rule 3/4), and the Métré quantity is not multiplied by it.
- reviewStatus: **`PENDING_REVIEW`** — deliberately **not mappable to any DB column** today (`trade_metre_elements` has no review column; `material_prices.review_status` only accepts `pending|reviewed|rejected|published`), so the pack cannot leak into a published state.
- materialCode: **`PROPOSED_ONLY`** — explicit placeholder, `publishable: false`; **no** official code invented or guessed, **no** Astral/Lakalo material created in production, **no** price invented.

---

## 3. Tests

Runner: `npx tsx tests/p2AstralLakaloDataPack.test.ts` (DB-free, no server, no DB env).

P2.2 note: **`tests/p2AstralLakaloDataPack.test.ts` was NOT edited** — every existing assertion
still holds against the corrected metadata (nominal coverage is still 13 m²/L, the binding spec is
byte-identical, `PROPOSED_ONLY`, `PENDING_REVIEW`, zero writes and fail-closed all unchanged).

| # | Test | Intent |
|---|---|---|
| 1 | pack identity | trial pack, `PENDING_REVIEW`, non-publishable, zero writes |
| 2 | pack target | Astral Lakalo / Astral / peinture / `mur_interieur`; element mirror == registry |
| 3 | binding data | `metre_qty`, coefficient 1, 13 m²/L, code `PROPOSED_ONLY` |
| 4 | rule 3 | no `layers` (no `layers=2`) in pack nor mapped element |
| 5 | production untouched | registry element still binding-free / no enriched fields |
| 6 | leakage guard | engine, bindings, bridge, registry, Calculator, Devis, WhatsApp carry no trial tokens |
| 7 | mapping path | `mapMetreElementRow` carries the binding; shape stays engine-valid |
| 8 | **rule 5 quantity** | 50 m² → `50 × 1 ÷ 13` = **3.846 L** (in-memory test double used ONLY to observe the quantity) |
| 9 | **rule 6 rejection** | empty official rates → `unresolved_material`, no item, no invented price |
| 10 | **rule 6 rejection** | real official peinture codes do NOT satisfy the `PROPOSED_ONLY` binding |
| 11 | report | this report exists and references the pack path |

---

## 4. Result

**PASS/FAIL verdict: ✅ PASS** (recorded from the actual execution — never claimed without running).

| Run | Command | Result |
|---|---|---|
| P2 pack suite | `npx tsx tests/p2AstralLakaloDataPack.test.ts` | **11 passed / 0 failed — EXITCODE=0** |
| Regression (existing) | `npx tsx tests/metreBindingsLoop.test.ts` | **8 passed / 0 failed — EXITCODE=0** |
| Regression (existing) | `npx tsx tests/metreDirectPeinture.test.ts` | **13 passed / 0 failed — EXITCODE=0** |

**P2.2 validation re-run (after the metadata update):**

| Run | Command | Result |
|---|---|---|
| P2 pack suite | `npx tsx tests/p2AstralLakaloDataPack.test.ts` | **11 passed / 0 failed — EXITCODE=0** |
| Bindings loop | `npx tsx tests/metreBindingsLoop.test.ts` | **8 passed / 0 failed — EXITCODE=0** |
| Peinture/mur_interieur proof | `npx tsx tests/metreDirectPeinture.test.ts` | **13 passed / 0 failed — EXITCODE=0** |

P2.2 integrity checks:
- **No production DB writes** — the pack still records `supabaseWrites: 0`, `officialMaterialCatalogMatch: null`, `officialPriceMatch: null`; no repository/API/seed code was invoked or touched.
- **`git diff` is empty** (the repository has no tracked files — `git status --porcelain` lists the tree as untracked), therefore no tracked/production file was modified; the only files touched in P2.2 are the two allowed ones: `tests/fixtures/p2/astral_lakalo_datapack.json` and `tests/fixtures/p2/P2_REPORT.md`.
- No build was run (not required).
- `PROPOSED_ONLY` + fail-closed preserved: tests 9 & 10 still reject the binding without an official material.

Notes on execution:
- All runs are DB-free and touched no database, no server, no generated files.
- One iteration occurred during development: the first run failed test 8 because the
  trial dims were `5 × 5 × 1 = 25 m²` (my fixture arithmetic error); corrected to
  `10 × 5 × 1 = 50 m²` and re-run green — recorded here for honesty.
- The session shell does not capture stdout directly (pre-existing issue also
  documented in `PROJECT_STATE.md` 2026-09-24), so output was redirected to a
  temporary file under `tests/` and read back; the temp files were removed after
  the results above were transcribed.


---

## 5. What needs an OFFICIAL Material Catalog

1. A real `materials` row (`company_id IS NULL`) created through the official import/seed path for **Astral Lakalo** (trade `peinture`, base unit `L`) — its `materials.code` then replaces `PROPOSED_ONLY` in the pack.
2. Until then `computeMetreBoundOutputs` **correctly rejects** the binding (`unresolved_material`) — proven by tests 9 & 10.
3. `catalogImport` will happily persist a `material_bindings` JSON cell as-is; therefore **the pack must never be fed to the import endpoint** while `materialCode = PROPOSED_ONLY` (nothing in the pipeline blocks a non-official code — that is a data-discipline rule, not a code gap).

## 6. What needs a Price Pack

- After the material exists: an official price row (`upsertOfficialPrice`, source `OFFICIAL_DEFAULT`, market TN, currency TND, `review_status = published`, `is_current = true`). `upsertOfficialPrice` throws while the material code does not exist.
- The trial pack contains **no price at all** (`officialPriceMatch: null`); the in-memory test double's price exists only inside the test process and is not a price claim.

## 7. Is a code change required?

**No.** The P2 path already works end-to-end as data:
- driver / coefficient / coverage / `round3` / unresolved-review behaviour are implemented and exercised unchanged;
- the gap is **purely data**: an official Material Catalog row + a Price Pack, then promote the pack (replace `PROPOSED_ONLY`, use a mappable review state).
- Optional future (NOT done here, needs explicit approval): a review gate that refuses to persist `material_bindings` whose `materialCode` is not an existing official material, and/or a review-status column for `trade_metre_elements`.

---

## 8. Files created / modified (minimal set)

| Action | File |
|---|---|
| CREATED (P2) / **UPDATED (P2.2)** | `tests/fixtures/p2/astral_lakalo_datapack.json` (the trial Data Pack — v2 metadata) |
| CREATED (P2) / **UPDATED (P2.2)** | `tests/fixtures/p2/P2_REPORT.md` (this report) |
| CREATED (P2) — **unchanged in P2.2** | `tests/p2AstralLakaloDataPack.test.ts` (assertions did not require correction) |
| MODIFIED | none outside the two allowed P2 files — no production source, no generated files, no API, no repositories, no schema, no migrations, no Supabase, no Material Catalog, no prices |

