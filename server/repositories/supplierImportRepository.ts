/**
 * Phase 2 — Supplier Import Repository
 *
 * Import data stays ISOLATED. It NEVER mutates official Materials
 * or official Prices directly. Publishing is a controlled API action.
 */
import { memoryStore } from './store';
import { SupplierImport, SupplierCatalogItem, ImportStatus } from '../types';
import { generateId } from '../utils/crypto';

const COLLECTION = 'supplier_imports';

export interface CreateImportInput {
  fileName: string;
  fileSizeBytes: number;
  fileSha256: string;
  fileMimeType: string;
  supplierId?: string;
  supplierName?: string;
}

export interface ISupplierImportRepository {
  findById(id: string): SupplierImport | undefined;
  list(page: number, limit: number): { data: SupplierImport[]; total: number };
  create(input: CreateImportInput): SupplierImport;
  setStatus(id: string, status: ImportStatus, extra?: Partial<SupplierImport>): SupplierImport;
  setParsedItems(id: string, items: SupplierCatalogItem[]): void;
}

class MemorySupplierImportRepository implements ISupplierImportRepository {
  private get map() {
    return memoryStore.getCollection(COLLECTION, `server/data/${COLLECTION}.json`);
  }

  findById(id: string): SupplierImport | undefined {
    const i = this.map.get(id);
    if (!i || (i as SupplierImport).isDeleted) return undefined;
    return i as SupplierImport;
  }

  list(page: number, limit: number) {
    const all = Array.from(this.map.values()) as SupplierImport[];
    const filtered = all.filter(i => !i.isDeleted)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const total = filtered.length;
    const start = (page - 1) * limit;
    return { data: filtered.slice(start, start + limit), total };
  }

  create(input: CreateImportInput): SupplierImport {
    const now = new Date().toISOString();
    const imp: SupplierImport = {
      id: generateId(),
      supplierId: input.supplierId,
      supplierName: input.supplierName,
      fileName: input.fileName,
      fileSizeBytes: input.fileSizeBytes,
      fileSha256: input.fileSha256,
      fileMimeType: input.fileMimeType,
      status: 'UPLOADED',
      itemsCount: 0,
      createdAt: now,
      updatedAt: now,
      version: 1,
      isDeleted: false,
      items: [],
    };
    this.map.set(imp.id, imp);
    memoryStore.saveCollection(COLLECTION);
    return imp;
  }

  setStatus(id: string, status: ImportStatus, extra?: Partial<SupplierImport>): SupplierImport {
    const existing = this.map.get(id) as SupplierImport;
    if (!existing) throw new Error('Import not found');
    const updated = { ...existing, ...extra, status, updatedAt: new Date().toISOString(), version: existing.version + 1 };
    this.map.set(id, updated);
    memoryStore.saveCollection(COLLECTION);
    return updated;
  }

  setParsedItems(id: string, items: SupplierCatalogItem[]): void {
    const existing = this.map.get(id) as SupplierImport;
    if (!existing) throw new Error('Import not found');
    existing.items = items;
    existing.itemsCount = items.length;
    existing.status = 'PENDING_APPROVAL';
    existing.parsedAt = new Date().toISOString();
    existing.updatedAt = new Date().toISOString();
    this.map.set(id, existing);
    memoryStore.saveCollection(COLLECTION);
  }
}

export const supplierImportRepository: ISupplierImportRepository = new MemorySupplierImportRepository();
