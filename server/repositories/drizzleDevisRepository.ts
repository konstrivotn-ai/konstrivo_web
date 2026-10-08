import { getDatabase } from '../db/client';
import { devis, devisItems, idempotencyKeys } from '../db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { isValidUuid } from '../utils/validation';

// ── Phase 1 — Devis client↔server field mapping helpers ────────────────────
// Small, explicit mapping only (no schema/API changes): the client
// DevisDocument uses different names than the devis/devis_items columns and
// Postgres `numeric` columns come back as strings.

/** Coerce numeric strings / numbers to a finite number (null otherwise). */
function toNum(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** `numeric(...)` columns are string-mode in Drizzle — serialize numbers. */
function numCol(value: any): any {
  if (value === null || value === undefined) return null;
  return String(value);
}

/** Normalize any provided date to `YYYY-MM-DD` (undefined when invalid). */
function isoDateOnly(value: any): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (value instanceof Date) return isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
  const s = String(value).trim();
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const legacy = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (legacy) return `${legacy[3]}-${legacy[2].padStart(2, '0')}-${legacy[1].padStart(2, '0')}`;
  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

// Status enums: client (brouillon/envoye/valide) ↔ server (draft/sent/validated).
const CLIENT_STATUS_TO_SERVER: Record<string, string> = { brouillon: 'draft', envoye: 'sent', valide: 'validated' };
const SERVER_STATUS_TO_CLIENT: Record<string, string> = { draft: 'brouillon', sent: 'envoye', validated: 'valide' };

/** Client DevisItem → devis_items columns (names differ between the two sides). */
function mapItemToServerRow(it: any) {
  return {
    materialId: it?.materialId || null,
    trade: it?.trade || null,
    title: it?.title || null,
    descriptionSnapshot: it?.descriptionSnapshot ?? it?.details ?? null,
    unit: it?.unit || null,
    exactCalculatedQuantity: numCol(toNum(it?.exactCalculatedQuantity) ?? toNum(it?.quantity) ?? 0),
    wasteIncludedQuantity: numCol(toNum(it?.wasteIncludedQuantity) ?? toNum(it?.quantity) ?? 0),
    billableQuantity: numCol(toNum(it?.billableQuantity) ?? toNum(it?.quantity) ?? 0),
    unitPriceAppliedTnd: numCol(toNum(it?.unitPriceAppliedTnd) ?? toNum(it?.unitPriceTnd) ?? toNum(it?.unitPrice) ?? 0),
    totalPriceTnd: numCol(toNum(it?.totalPriceTnd) ?? toNum(it?.totalTnd) ?? toNum(it?.total) ?? 0),
    isCustomAdded: !!it?.isCustomAdded,
    packageDetailsSnapshot: it?.packageDetailsSnapshot ?? null,
    supplierReference: it?.supplierReference ?? null,
  };
}

/** devis_items row → client DevisItem shape (numeric coercion included). */
function mapItemRowToClient(it: any) {
  const quantity =
    toNum(it?.billableQuantity) ??
    toNum(it?.quantity) ??
    toNum(it?.wasteIncludedQuantity) ??
    toNum(it?.exactCalculatedQuantity) ??
    0;
  const unitPrice = toNum(it?.unitPriceAppliedTnd) ?? toNum(it?.unitPriceTnd) ?? 0;
  const total = toNum(it?.totalPriceTnd) ?? toNum(it?.totalTnd) ?? quantity * unitPrice;
  return {
    id: it?.id,
    materialId: it?.materialId || undefined,
    trade: it?.trade || 'placo',
    title: it?.title || '',
    quantity,
    unit: it?.unit || 'u',
    unitPrice,
    total,
    unitPriceTnd: unitPrice,
    totalTnd: total,
    unitPriceConverted: unitPrice,
    totalConverted: total,
    details: it?.descriptionSnapshot || it?.details || undefined,
    isCustomAdded: !!it?.isCustomAdded,
  };
}

/**
 * devis row (+ its items) → client DevisDocument shape:
 * reference fallback to devisNumber, YYYY-MM-DD date, client status enum,
 * numeric coercion of totals/tax and mapped items. Unknown server fields are
 * preserved so nothing is lost downstream.
 */
function mapDevisRowToClient(row: any, items?: any[]) {
  const clientItems = (items || []).map(mapItemRowToClient);
  const itemsSum = clientItems.reduce((acc, it) => acc + (it.totalTnd || 0), 0);
  // Discount is not a DB column; it is recovered from the stored net-HT
  // snapshot (subtotal_before_tax_tnd = raw items total − discount).
  const netHt = toNum(row?.subtotalBeforeTaxTnd);
  return {
    ...row,
    reference: row?.reference || row?.devisNumber,
    date: isoDateOnly(row?.date) || row?.date || null,
    tvaPercent: toNum(row?.taxRatePercent) ?? undefined,
    subtotalMaterials: toNum(row?.totalMaterialsCostTnd) ?? row?.subtotalMaterials,
    subtotalLabor: toNum(row?.totalLaborCostTnd) ?? row?.subtotalLabor,
    discount: netHt !== null ? Math.max(0, itemsSum - netHt) : toNum(row?.discount) ?? 0,
    totalTnd: toNum(row?.grandTotalTnd) ?? 0,
    total: toNum(row?.grandTotalTnd) ?? 0,
    status: SERVER_STATUS_TO_CLIENT[row?.status] || 'brouillon',
    items: clientItems,
  };
}

async function generateDevisNumber(db: any) {
  const year = new Date().getFullYear();
  const prefix = `DEV-${year}-`;
  const rows = await db.select({ devisNumber: devis.devisNumber }).from(devis).where(sql`${devis.devisNumber} LIKE ${`${prefix}%`}`);
  let maxNum = 0;
  for (const r of rows) {
    const match = r.devisNumber?.match(/DEV-\d{4}-(\d+)/);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
  }
  return `${prefix}${String(maxNum + 1).padStart(5, '0')}`;
}

export async function findDevisById(id: string) {
  const db = await getDatabase();
  if (!db) return undefined;
  // See drizzleMaterialRepository — guard non-UUID input before PostgreSQL
  // (the `devis`/`devis_items` id columns are `uuid`).
  if (!isValidUuid(id)) return undefined;
  // Soft-deleted devis are hidden from reads (DELETE → 204, subsequent GET → 404).
  const d = await db.select().from(devis).where(and(eq(devis.id, id), eq(devis.isDeleted, false))).limit(1);
  if (!d || d.length === 0) return undefined;
  const items = await db.select().from(devisItems).where(eq(devisItems.devisId, id));
  items.sort((a: any, b: any) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0));
  return mapDevisRowToClient(d[0], items);
}

export async function listDevis(filters: any) {
  const db = await getDatabase();
  if (!db) return { data: [], page: filters.page || 1, limit: filters.limit || 20, total: 0 };
  let q = db.select().from(devis).where(eq(devis.isDeleted, false));
  if (filters.companyId) q = q.where(eq(devis.companyId, filters.companyId));
  if (filters.status) q = q.where(eq(devis.status, filters.status));
  if (filters.search) q = q.where(sql`${devis.clientName} ILIKE ${`%${filters.search}%`} OR ${devis.projectTitle} ILIKE ${`%${filters.search}%`} OR ${devis.reference} ILIKE ${`%${filters.search}%`} OR ${devis.devisNumber} ILIKE ${`%${filters.search}%`}`);
  const all = await q;
  all.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const total = all.length;
  const page = filters.page || 1;
  const limit = filters.limit || 20;
  const start = (page - 1) * limit;
  const data = all.slice(start, start + limit);
  // Phase 1 mapping — attach the mapped items of the returned page (single
  // batched query) so items are never lost when the client lists/loads Devis.
  let itemsByDevis = new Map<string, any[]>();
  if (data.length > 0) {
    const ids = data.map((d: any) => d.id);
    const itemRows = await db.select().from(devisItems).where(inArray(devisItems.devisId, ids));
    for (const it of itemRows) {
      const arr = itemsByDevis.get(it.devisId) || [];
      arr.push(it);
      itemsByDevis.set(it.devisId, arr);
    }
  }
  return {
    data: data.map((d: any) => mapDevisRowToClient(
      d,
      (itemsByDevis.get(d.id) || []).sort((a: any, b: any) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0)),
    )),
    page,
    limit,
    total,
  };
}

export async function createDevis(input: any) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');
  return db.transaction(async (tx: any) => {
    const devisNumber = await generateDevisNumber(tx);
    const now = new Date();
    const itemsInput: any[] = Array.isArray(input.items) ? input.items : [];

    // Labor/materials classification — mirrors the in-memory repository and the
    // frontend convention (DevisTab.tsx): titles containing "main d'œuvre"
    // (ligature), "main d'oeuvre" (ASCII), "khidma" or "labor" are LABOR lines;
    // everything else is MATERIALS. Stored in the devis_* tiers columns so the
    // API contract (subtotalLabor/subtotalMaterials) is identical in both
    // backend modes. Client-provided breakdowns are always honored first.
    const isLaborTitle = (title?: string) => {
      const s = (title || '').toLowerCase();
      return (
        s.includes("main d'\u0153uvre") ||
        s.includes("main d'oeuvre") ||
        s.includes('khidma') ||
        s.includes('labor')
      );
    };
    const itemTotalFor = (it: any): number =>
      toNum(it?.totalPriceTnd) ?? toNum(it?.totalTnd) ?? toNum(it?.total) ??
      (toNum(it?.quantity) ?? 0) * (toNum(it?.unitPriceAppliedTnd) ?? toNum(it?.unitPriceTnd) ?? toNum(it?.unitPrice) ?? 0);
    const subtotalMaterials = itemsInput.filter(i => !isLaborTitle(i.title)).reduce((acc, it) => acc + itemTotalFor(it), 0);
    const subtotalLabor = itemsInput.filter(i => isLaborTitle(i.title)).reduce((acc, it) => acc + itemTotalFor(it), 0);

    // Totals snapshot — SAME formula as the client (raw − discount → TVA),
    // used only when the client did not provide its own grand total.
    const rawSum = itemsInput.reduce((acc, it) =>
      acc + (toNum(it?.totalTnd) ?? toNum(it?.totalPriceTnd) ?? toNum(it?.total) ?? 0), 0);
    const discount = toNum(input.discount) ?? 0;
    const netHt = Math.max(0, rawSum - discount);
    const tvaPercent = toNum(input.tvaPercent) ?? 0;
    const taxAmount = tvaPercent > 0 ? (netHt * tvaPercent) / 100 : 0;
    const timbre = toNum(input.timbreFiscal) ?? 0;
    const grandTotal = toNum(input.grandTotalTnd) ?? toNum(input.totalTnd) ?? toNum(input.total) ?? (netHt + taxAmount + timbre);

    const [inserted] = await tx.insert(devis).values({
      companyId: input.companyId,
      createdByUserId: input.createdByUserId,
      devisNumber,
      reference: input.reference || devisNumber,
      date: isoDateOnly(input.date),
      clientName: input.clientName,
      clientPhone: input.clientPhone,
      clientAddress: input.clientAddress,
      projectTitle: input.projectTitle,
      country: input.country,
      currency: input.currency,
      region: input.region,
      totalMaterialsCostTnd: numCol(toNum(input.subtotalMaterialsTnd) ?? toNum(input.totalMaterialsCostTnd) ?? subtotalMaterials),
      totalLaborCostTnd: numCol(toNum(input.subtotalLaborTnd) ?? toNum(input.totalLaborCostTnd) ?? subtotalLabor),
      subtotalBeforeTaxTnd: numCol(netHt),
      taxRatePercent: numCol(toNum(input.tvaPercent) ?? toNum(input.taxRatePercent)),
      taxAmountTnd: numCol(toNum(input.tvaAmount) ?? taxAmount),
      grandTotalTnd: numCol(grandTotal),
      status: CLIENT_STATUS_TO_SERVER[input.status] || input.status || 'draft',
      createdAt: now,
      updatedAt: now,
      version: 1,
      isDeleted: false,
    }).returning();

    for (let i = 0; i < itemsInput.length; i++) {
      // Phase 1 mapping — client item names → devis_items columns
      // (quantity → billable_quantity, unitPriceTnd → unit_price_applied_tnd,
      // totalTnd → total_price_tnd, details → description_snapshot).
      await tx.insert(devisItems).values({
        devisId: inserted.id,
        lineNumber: i + 1,
        ...mapItemToServerRow(itemsInput[i]),
        createdAt: now,
        updatedAt: now,
        version: 1,
      });
    }

    // Idempotency: store idempotency key if provided (same atomic transaction).
    if (input.idempotencyKey) {
      await tx.insert(idempotencyKeys).values({ key: input.idempotencyKey, entityType: 'devis', entityId: inserted.id, responseSnapshot: JSON.stringify({ id: inserted.id }) }).returning();
    }

    // Fetch the committed-row shape INSIDE the transaction: the row is not yet
    // visible to a separate `db` connection (it commits only when this callback
    // resolves). Using `tx` here keeps the read atomic with the writes.
    const [d] = await tx.select().from(devis).where(eq(devis.id, inserted.id)).limit(1);
    const items = await tx.select().from(devisItems).where(eq(devisItems.devisId, inserted.id));
    items.sort((a: any, b: any) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0));
    return mapDevisRowToClient(d, items);
  });
}

export async function updateDevis(id: string, patch: any, expectedVersion?: number) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');
  // Audit fix: guard non-UUID input before PostgreSQL (22P02 → 500).
  // The route layer translates a thrown NOT_FOUND into 404.
  if (!isValidUuid(id)) {
    const err: any = new Error(`Devis '${id}' not found`);
    err.statusCode = 404; err.code = 'NOT_FOUND'; throw err;
  }
  const existing = await db.select().from(devis).where(eq(devis.id, id)).limit(1);
  if (!existing || existing.length === 0) throw new Error('Devis not found');
  const cur = existing[0];
  if (expectedVersion !== undefined && Number(expectedVersion) !== Number(cur.version)) {
    const err: any = new Error(`Version conflict: expected ${expectedVersion}, server has ${cur.version}`);
    err.statusCode = 409; err.code = 'CONFLICT'; throw err;
  }
  const p = patch || {};

  // Phase 1 mapping — persist ONLY known devis columns and map client field
  // names (tvaPercent → tax_rate_percent, totalTnd → grand_total_tnd, …).
  // Unknown payload fields (items, companyName, notes, version, …) never
  // reach the UPDATE statement.
  const set: any = {};
  const passthrough = ['reference', 'clientName', 'clientPhone', 'clientAddress', 'projectTitle', 'country', 'currency', 'region', 'surfaceAreaM2', 'perimeterLinearM', 'wasteMarginPercent'];
  for (const k of passthrough) if (p[k] !== undefined) set[k] = p[k];
  if (p.date !== undefined) {
    const iso = isoDateOnly(p.date);
    if (iso) set.date = iso;
  }
  if (p.tvaPercent !== undefined) set.taxRatePercent = toNum(p.tvaPercent);
  else if (p.taxRatePercent !== undefined) set.taxRatePercent = toNum(p.taxRatePercent);
  if (p.status !== undefined) set.status = CLIENT_STATUS_TO_SERVER[p.status] || p.status;
  if (p.totalMaterialsCostTnd !== undefined) set.totalMaterialsCostTnd = toNum(p.totalMaterialsCostTnd);
  else if (p.subtotalMaterialsTnd !== undefined) set.totalMaterialsCostTnd = toNum(p.subtotalMaterialsTnd);
  if (p.totalLaborCostTnd !== undefined) set.totalLaborCostTnd = toNum(p.totalLaborCostTnd);
  else if (p.subtotalLaborTnd !== undefined) set.totalLaborCostTnd = toNum(p.subtotalLaborTnd);

  // Items: re-sync the devis_items rows when the client sends the full document.
  const itemsPatch: any[] | null = Array.isArray(p.items) ? p.items : null;

  // Totals snapshot (same formula as the client): raw − discount → TVA.
  if (p.discount !== undefined || itemsPatch || set.taxRatePercent !== undefined) {
    const effItems = itemsPatch ?? await db.select().from(devisItems).where(eq(devisItems.devisId, id));
    const rawSum = effItems.reduce((acc: number, it: any) =>
      acc + (toNum(it?.totalTnd) ?? toNum(it?.totalPriceTnd) ?? toNum(it?.total) ?? 0), 0);
    const discount = toNum(p.discount) ?? Math.max(0, rawSum - (toNum(cur.subtotalBeforeTaxTnd) ?? rawSum));
    const netHt = Math.max(0, rawSum - discount);
    set.subtotalBeforeTaxTnd = netHt;
    const tva = toNum(set.taxRatePercent) ?? toNum(cur.taxRatePercent) ?? 0;
    set.taxAmountTnd = tva > 0 ? (netHt * tva) / 100 : 0;
    set.grandTotalTnd = toNum(p.totalTnd) ?? toNum(p.total) ?? (netHt + (set.taxAmountTnd as number) + (toNum(p.timbreFiscal) ?? 0));
  }

  set.updatedAt = new Date();
  set.version = (cur.version || 1) + 1;

  const [updated] = await db.update(devis).set(set).where(eq(devis.id, id)).returning();

  if (itemsPatch) {
    await db.delete(devisItems).where(eq(devisItems.devisId, id));
    const now = new Date();
    for (let i = 0; i < itemsPatch.length; i++) {
      await db.insert(devisItems).values({
        devisId: id,
        lineNumber: i + 1,
        ...mapItemToServerRow(itemsPatch[i]),
        createdAt: now,
        updatedAt: now,
        version: 1,
      });
    }
  }

  return findDevisById(updated.id);
}

export async function softDeleteDevis(id: string) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');
  // Audit fix: guard non-UUID input before PostgreSQL (22P02 → 500).
  // The route layer translates an undefined lookup into 404.
  if (!isValidUuid(id)) return;
  await db.update(devis).set({ isDeleted: true, deletedAt: new Date(), updatedAt: new Date() }).where(eq(devis.id, id));
}

export async function findDevisByIdempotencyKey(key: string) {
  const db = await getDatabase();
  if (!db) return undefined;
  const rows = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key)).limit(1);
  if (!rows || rows.length === 0) return undefined;
  const entry = rows[0];
  const d = await findDevisById(entry.entityId);
  return d;
}

export async function storeIdempotencyKey(key: string, devisId: string) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');
  // ON CONFLICT DO NOTHING: the key is ALSO persisted atomically inside
  // createDevis (same transaction). The route's explicit store call would
  // otherwise raise a duplicate-key (22P05 → 500) on the FIRST request.
  await db.insert(idempotencyKeys).values({ key, entityType: 'devis', entityId: devisId, responseSnapshot: JSON.stringify({ id: devisId }) }).onConflictDoNothing();
}
