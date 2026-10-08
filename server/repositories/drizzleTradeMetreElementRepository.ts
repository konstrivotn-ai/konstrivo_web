/**
 * DYNAMIC MÉTRÉ — Trade Metre Element Repository (Drizzle/PostgreSQL)
 *
 * Data-driven element ↔ trade association. Elements live in the
 * `trade_metre_elements` table (migration 0015) and are resolved by tradeId,
 * so a newly imported trade can have meaningful Dynamic Métré elements
 * WITHOUT any source-code change — the exact pattern of
 * `drizzleTradeServiceRepository.ts`.
 */
import { getDatabase } from '../db/client';
import { tradeMetreElements } from '../db/schema';
import { eq, and } from 'drizzle-orm';

export interface TradeMetreElementRow {
  id: string;
  tradeId: string;
  elementCode: string;
  labelFr: string;
  labelAr: string | null;
  method: string;
  /** `ElementDim[]` as stored (JSONB). */
  dims: unknown;
  /** `QtyCalcSpec` as stored (JSONB). */
  calc: unknown;
  qtyUnit: string;
  // ── PHASE 1 — enriched specification (nullable; NULL = not configured) ─────
  /** `MetreOpeningsSpec` as stored (JSONB). */
  openings?: unknown;
  /** `MetreDeductionsSpec` as stored (JSONB). */
  deductions?: unknown;
  /** Repetition count; null = 1 (no multiplication). */
  layers?: number | null;
  /** Waste %; null = no waste. */
  wastePercent?: number | null;
  /** `MetreYieldSpec` as stored (JSONB). */
  yieldPerUnit?: unknown;
  /** Phase 1.1 preferred field — `MetreCoverageSpec` as stored (JSONB). */
  coveragePerProductUnit?: unknown;
  // ── PHASE 2.1 — bindings travel row → API → client (migration 0020 columns) ─
  /** `MaterialBinding[]` as stored (JSONB). */
  materialBindings?: unknown;
  /** `ServiceBinding[]` as stored (JSONB). */
  serviceBindings?: unknown;
  isActive: boolean;
  sortOrder: number;
}

/**
 * PostgreSQL `numeric` arrives as a STRING over the wire. Convert to a number
 * ONLY when it really is one, so a malformed stored value becomes `null`
 * ("not configured") instead of `NaN` poisoning the engine.
 */
function toOptionalNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Map a raw `trade_metre_elements` row to the API shape (single place). */
function mapRow(r: any): TradeMetreElementRow {
  return {
    id: r.id,
    tradeId: r.tradeId,
    elementCode: r.elementCode,
    labelFr: r.labelFr,
    labelAr: r.labelAr ?? null,
    method: r.method,
    dims: r.dims,
    calc: r.calc,
    qtyUnit: r.qtyUnit,
    // PHASE 1 — absent columns stay `undefined`/`null`, so a pre-Phase-1 row
    // maps to exactly the same element as it did before.
    openings: r.openings ?? undefined,
    deductions: r.deductions ?? undefined,
    layers: toOptionalNumber(r.layers),
    wastePercent: toOptionalNumber(r.wastePercent),
    yieldPerUnit: r.yieldPerUnit ?? undefined,
    coveragePerProductUnit: r.coveragePerProductUnit ?? undefined,
    // PHASE 2.1 — bindings travel to the API/client (NULL columns stay undefined).
    materialBindings: r.materialBindings ?? undefined,
    serviceBindings: r.serviceBindings ?? undefined,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
  };
}

/**
 * List active elements for a trade, ordered by sortOrder.
 * Returns [] when the database is unavailable (loader falls back to config).
 */
export async function listMetreElementsByTradeId(tradeId: string): Promise<TradeMetreElementRow[]> {
  const db = await getDatabase();
  if (!db) return [];
  const rows = await db.select().from(tradeMetreElements)
    .where(and(eq(tradeMetreElements.tradeId, tradeId), eq(tradeMetreElements.isActive, true)))
    .orderBy(tradeMetreElements.sortOrder);
  return rows.map(mapRow);
}

/** Admin/Phase 2: like `listMetreElementsByTradeId` but includes deactivated rows. */
export async function listAllMetreElementsByTradeId(tradeId: string): Promise<TradeMetreElementRow[]> {
  const db = await getDatabase();
  if (!db) return [];
  const rows = await db.select().from(tradeMetreElements)
    .where(eq(tradeMetreElements.tradeId, tradeId))
    .orderBy(tradeMetreElements.sortOrder);
  return rows.map(mapRow);
}

export interface TradeMetreElementInput {
  elementCode: string;
  labelFr: string;
  labelAr?: string | null;
  method: string;
  dims: unknown;
  calc: unknown;
  qtyUnit?: string;
  sortOrder?: number;
  // ── PHASE 1 — enriched specification (all optional; omitted = untouched) ───
  openings?: unknown;
  deductions?: unknown;
  layers?: number | null;
  wastePercent?: number | null;
  yieldPerUnit?: unknown;
  // ── PHASE 1.1 / PHASE 2 — additive optional columns (omitted = untouched) ───
  /** Phase 1.1 preferred coverage field (`MetreCoverageSpec`, JSONB). */
  coveragePerProductUnit?: unknown;
  /** Phase 2 bindings (`MaterialBinding[]`, JSONB). */
  materialBindings?: unknown;
  /** Phase 2 bindings (`ServiceBinding[]`, JSONB). */
  serviceBindings?: unknown;
}

/**
 * Upsert ONE element of a trade by (tradeId, elementCode) — idempotent.
 * Used by the optional catalog-import metadata path; shape validation
 * (`isValidMetreElementShape`) happens BEFORE this call, never here.
 * `tx` lets the import commit the element with the catalogue row it describes.
 *
 * PHASE 1 — the enriched columns are written ONLY when the caller supplies
 * them, so an update never blanks a value it was not asked to change.
 */
export async function upsertTradeMetreElement(
  tradeId: string,
  element: TradeMetreElementInput,
  tx?: any,
): Promise<TradeMetreElementRow | undefined> {
  const db = tx || (await getDatabase());
  if (!db) return undefined;
  /** Only the enriched keys the caller actually provided. */
  const enrichedPatch: Record<string, unknown> = {};
  if (element.openings !== undefined) enrichedPatch.openings = element.openings as any;
  if (element.deductions !== undefined) enrichedPatch.deductions = element.deductions as any;
  if (element.layers !== undefined && element.layers !== null) enrichedPatch.layers = String(element.layers);
  if (element.wastePercent !== undefined && element.wastePercent !== null) enrichedPatch.wastePercent = String(element.wastePercent);
  if (element.yieldPerUnit !== undefined) enrichedPatch.yieldPerUnit = element.yieldPerUnit as any;
  if (element.coveragePerProductUnit !== undefined) enrichedPatch.coveragePerProductUnit = element.coveragePerProductUnit as any;
  if (element.materialBindings !== undefined) enrichedPatch.materialBindings = element.materialBindings as any;
  if (element.serviceBindings !== undefined) enrichedPatch.serviceBindings = element.serviceBindings as any;

  const existing = await db.select().from(tradeMetreElements)
    .where(and(eq(tradeMetreElements.tradeId, tradeId), eq(tradeMetreElements.elementCode, element.elementCode)))
    .limit(1);
  if (existing.length > 0) {
    const [updated] = await db.update(tradeMetreElements).set({
      labelFr: element.labelFr,
      labelAr: element.labelAr ?? existing[0].labelAr,
      method: element.method,
      dims: element.dims as any,
      calc: element.calc as any,
      qtyUnit: element.qtyUnit ?? existing[0].qtyUnit,
      sortOrder: element.sortOrder ?? existing[0].sortOrder,
      isActive: true,
      updatedAt: new Date(),
      ...enrichedPatch,
    }).where(eq(tradeMetreElements.id, existing[0].id)).returning();
    return updated ? mapRow(updated) : undefined;
  }
  const [inserted] = await db.insert(tradeMetreElements).values({
    tradeId,
    elementCode: element.elementCode,
    labelFr: element.labelFr,
    labelAr: element.labelAr ?? null,
    method: element.method,
    dims: element.dims as any,
    calc: element.calc as any,
    qtyUnit: element.qtyUnit ?? 'unit',
    sortOrder: element.sortOrder ?? 0,
    ...enrichedPatch,
  }).returning();
  return inserted ? mapRow(inserted) : undefined;
}