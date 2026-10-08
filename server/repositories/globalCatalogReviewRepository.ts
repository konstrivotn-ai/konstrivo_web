// @ts-nocheck
/**
 * Phase 4 hardening — review workflow for imported catalog items.
 *
 * Allows Admin to list items requiring review and approve/reject explicitly.
 */
import { getDatabase } from '../db/client';
import {
  catalogImportItems,
  catalogImports,
  globalProducts,
} from '../db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { isValidUuid } from '../utils/validation';
import {
  createGlobalProduct,
  upsertGlobalIdentifier,
  linkMaterialToGlobalProduct,
  setGlobalProductAvailability,
  safePatchGlobalProduct,
} from './globalCatalogRepository';
import {
  normalizeIdentifierType,
  normalizeIdentifierValue,
  normalizeCountryCode,
} from '../services/globalCatalogValidation';

export async function listImportItems(args: { importId: string; matchStatus?: string; limit?: number; offset?: number }) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');
  if (!isValidUuid(args.importId)) throw new Error('Invalid importId');
  const limit = Math.max(1, Math.min(200, Number(args.limit || 50)));
  const offset = Math.max(0, Number(args.offset || 0));
  const where = args.matchStatus
    ? and(eq(catalogImportItems.importId, args.importId), eq(catalogImportItems.matchStatus, args.matchStatus))
    : eq(catalogImportItems.importId, args.importId);

  const rows = await db
    .select()
    .from(catalogImportItems)
    .where(where)
    .orderBy(catalogImportItems.sourceRow)
    .limit(limit)
    .offset(offset);
  return rows;
}

export async function setImportItemStatus(args: { itemId: string; matchStatus: string; notes?: string | null }, tx?: any) {
  const db = tx || (await getDatabase());
  if (!db) throw new Error('Database not available');
  if (!isValidUuid(args.itemId)) throw new Error('Invalid itemId');
  const [row] = await db
    .update(catalogImportItems)
    .set({ matchStatus: args.matchStatus, notes: args.notes ?? null, updatedAt: new Date() })
    .where(eq(catalogImportItems.id, args.itemId))
    .returning();
  return row;
}

/**
 * Approve an import item by creating or updating a global product and linking optional entities.
 *
 * - Never merges uncertain products automatically; caller must provide explicit globalProductId or createNew.
 */
export async function approveImportItem(args: {
  itemId: string;
  action: 'create_new' | 'link_existing';
  globalProductId?: string;
}) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');
  if (!isValidUuid(args.itemId)) throw new Error('Invalid itemId');

  return await db.transaction(async (tx: any) => {
    const items = await tx.select().from(catalogImportItems).where(eq(catalogImportItems.id, args.itemId)).limit(1);
    const item = items[0];
    if (!item) throw new Error('Item not found');

    const normalized = item.normalized || {};
    const raw = item.raw || {};

    let globalProductId: string | null = null;

    if (args.action === 'link_existing') {
      if (!args.globalProductId || !isValidUuid(args.globalProductId)) throw new Error('Invalid globalProductId');
      globalProductId = args.globalProductId;
      await safePatchGlobalProduct(globalProductId, normalized, tx);
    } else {
      // create_new
      const name = String(normalized.name || '').trim();
      if (!name) throw new Error('Missing product name');
      const gp = await createGlobalProduct({
        name,
        brand: normalized.brand || null,
        manufacturer: normalized.manufacturer || null,
        category: normalized.category || null,
        subcategory: normalized.subcategory || null,
        description: normalized.description || null,
        specification: normalized.specification || null,
        unit: normalized.unit || null,
        model: normalized.model || null,
        sku: normalized.sku || null,
        status: 'active',
      }, tx);
      globalProductId = gp.id;

      // Add identifier if present.
      const t = normalizeIdentifierType(normalized.identifier_type || normalized.identifierType);
      const v = normalizeIdentifierValue(normalized.identifier_value || normalized.identifierValue);
      if (t && v) {
        await upsertGlobalIdentifier({
          globalProductId,
          identifierType: t as any,
          identifierValue: v,
          supplierId: normalized.supplier_id || normalized.supplierId || null,
          source: 'review_approved',
          confidence: 100,
        }, tx);
      }
    }

    // Availability
    const country = normalizeCountryCode(normalized.country || normalized.countryCode);
    if (country) {
      const avail = normalized.available;
      const isAvailable = typeof avail === 'boolean' ? avail : String(avail || '').toLowerCase() === 'true';
      await setGlobalProductAvailability({
        globalProductId,
        countryCode: country,
        isAvailable: !!isAvailable,
        localName: normalized.local_name || normalized.localName || null,
        localReference: normalized.local_reference || normalized.localReference || null,
        localSpecification: normalized.local_specification || normalized.localSpecification || null,
        localUnit: normalized.local_unit || normalized.localUnit || null,
        catalogSourceId: null,
        sourceRef: null,
      }, tx);
    }

    // Optional material link
    if (normalized.material_id && isValidUuid(normalized.material_id)) {
      await linkMaterialToGlobalProduct({
        materialId: normalized.material_id,
        globalProductId,
        linkSource: 'review_approved',
        status: 'approved',
        confidence: 100,
      }, tx);
    }

    // Mark item approved.
    await setImportItemStatus({ itemId: args.itemId, matchStatus: 'approved', notes: null }, tx);

    // Update parent import counts best-effort.
    try {
      await tx.update(catalogImports).set({ updatedAt: new Date() }).where(eq(catalogImports.id, item.importId));
    } catch {}

    return { itemId: args.itemId, globalProductId };
  });
}

export async function rejectImportItem(args: { itemId: string; reason?: string | null }) {
  const db = await getDatabase();
  if (!db) throw new Error('Database not available');
  if (!isValidUuid(args.itemId)) throw new Error('Invalid itemId');
  const [row] = await db
    .update(catalogImportItems)
    .set({ matchStatus: 'rejected', notes: args.reason ?? 'Rejected', updatedAt: new Date() })
    .where(eq(catalogImportItems.id, args.itemId))
    .returning();
  return row;
}
