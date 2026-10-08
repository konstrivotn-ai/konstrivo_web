/**
 * Phase 2 — Shared In-Memory Store with JSON File Persistence
 *
 * This is the Phase 2 persistence adapter.
 * Phase 3 will replace this with a Drizzle repository behind the same interface.
 *
 * Data is kept in memory and periodically (or on write) persisted to JSON files
 * in server/data/. This is separate from the frontend's localStorage.
 */
import fs from 'fs';
import path from 'path';
import { isTestRunnerEntry } from '../config';

// ── TEST ISOLATION (2026-09-27 — root-cause fix, data safety) ────────────────
// `server/data/*.json` is the PERSISTED STATE of the RUNNING APPLICATION
// (trades, materials, prices, users, devis…). The test harness used to read AND
// write those exact files — `MemoryStore.resetAll()` even UNLINKS every `*.json`
// in that directory — so:
//   * test-created entities (e.g. the dynamic trades `p1…gate` / `pc…dyn`
//     produced by tests/catalogPreviewTradeGate.test.ts and
//     tests/catalogImportPhaseC.test.ts) were PERSISTED into the real store and
//     reappeared in Admin → Métiers, Outils, Services and the Calculator; and
//   * test teardown could DELETE real application data.
// A test entry now gets its OWN directory (same file names, isolated location):
// production/dev still read and write `server/data` byte-for-byte as before.
const IS_TEST_ENTRY = process.env.NODE_ENV === 'test' || isTestRunnerEntry();
const REAL_DATA_DIR = path.resolve(process.cwd(), 'server', 'data');
const DATA_DIR = IS_TEST_ENTRY ? path.join(REAL_DATA_DIR, '.test') : REAL_DATA_DIR;

try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {
  // Read-only filesystem (e.g. Vercel /var/task): skip data-dir creation.
  // In-memory mode keeps working; JSON persistence simply stays unavailable.
  console.warn('[KONSTRIVO] Could not create data dir (read-only FS?):', (e as Error & { code?: string }).code || e);
}

export class MemoryStore {
  private static instance: MemoryStore;
  private stores: Map<string, Map<string, any>> = new Map();
  private persistenceKeys: Map<string, string> = new Map(); // collection name → file path

  private constructor() {}

  static getInstance(): MemoryStore {
    if (!MemoryStore.instance) {
      MemoryStore.instance = new MemoryStore();
    }
    return MemoryStore.instance;
  }

  /** Get (or create) the in-memory Map for a collection. Optionally loads from JSON. */
  getCollection(name: string, filePath: string): Map<string, any> {
    if (!this.stores.has(name)) {
      // Test entries never touch the application's own `server/data` files:
      // the collection is persisted under the isolated test directory instead
      // (same file name — every caller keeps passing `server/data/<x>.json`).
      const targetPath = IS_TEST_ENTRY ? path.join(DATA_DIR, path.basename(filePath)) : filePath;
      this.stores.set(name, new Map<string, any>());
      this.persistenceKeys.set(name, targetPath);
      // Load from JSON if file exists
      try {
        if (fs.existsSync(targetPath)) {
          const raw = fs.readFileSync(targetPath, 'utf8');
          const data = JSON.parse(raw);
          if (Array.isArray(data)) {
            const map = this.stores.get(name)!;
            for (const item of data) {
              if (item && item.id) {
                map.set(item.id, item);
              }
            }
          }
        }
      } catch (e) {
        console.warn(`[KONSTRIVO] Failed to load ${name} from ${filePath}:`, e);
      }
    }
    return this.stores.get(name)!;
  }

  /** Save a collection to its JSON file. */
  saveCollection(name: string): void {
    const map = this.stores.get(name);
    if (!map) return;
    const filePath = this.persistenceKeys.get(name);
    if (!filePath) return;
    try {
      const data = Array.from(map.values());
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.warn(`[KONSTRIVO] Failed to save ${name} to ${filePath}:`, e);
    }
  }

  /** Clear a collection from memory and disk (for testing). */
  clearCollection(name: string): void {
    const map = this.stores.get(name);
    if (map) {
      map.clear();
    }
    const filePath = this.persistenceKeys.get(name);
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) { /* ignore */ }
    }
  }

  /** Clear only items whose id starts with a given prefix, leaving the collection intact. */
  clearByPrefix(name: string, prefix: string): void {
    const map = this.stores.get(name);
    if (map) {
      for (const key of [...map.keys()]) {
        if (key.startsWith(prefix)) map.delete(key);
      }
    }
    const filePath = this.persistenceKeys.get(name);
    if (filePath) {
      try {
        const data = Array.from(this.stores.get(name)?.values() ?? []).map(v => v && v.id ? v : null).filter((v): v is any => !!v);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      } catch (e) { /* ignore */ }
    }
  }

  /** Reset all collections (for testing). Also wipes persisted JSON files. */
  resetAll(): void {
    for (const [name, filePath] of this.persistenceKeys) {
      const map = this.stores.get(name);
      if (map) map.clear();
    }
    this.stores.clear();
    this.persistenceKeys.clear();
    // Remove ALL persisted collection files so stale data never leaks between runs.
    try {
      const files = fs.readdirSync(DATA_DIR);
      for (const f of files) {
        if (f.endsWith('.json')) {
          try { fs.unlinkSync(path.join(DATA_DIR, f)); } catch (e) { /* ignore */ }
        }
      }
    } catch (e) { /* ignore */ }
  }
}

export const memoryStore = MemoryStore.getInstance();
