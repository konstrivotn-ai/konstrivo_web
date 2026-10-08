/**
 * CATALOG TOMBSTONES — client-side suppression of refs the DATABASE no longer
 * serves (Admin archive / deactivate).
 *
 * WHY THIS EXISTS
 * ---------------
 * `/api/v1/prices` no longer serves an archived material, but the client keeps
 * its own barème cache (`konstrivo_rates_2026`, the dev `DEFAULT_MARKET_RATES`,
 * the `localRatesBaseRef` merge base). `mergeRates` deliberately KEEPS a cached
 * rate the server does not quote (Tier-2 offline fallback), so a material
 * archived in the DB came back after every Refresh / app reopen.
 *
 * RULES (DB IS THE SOURCE OF TRUTH — this module never becomes a second one)
 * -------------------------------------------------------------------------
 *   1. A ref is suppressed ONLY when the DB says so: either the server list
 *      (`GET /api/v1/catalog/inactive-refs`) confirmed it, or an Admin action
 *      confirmed it against the DB (HTTP 2xx) in this browser and it is
 *      persisted until the next confirmed sync.
 *   2. An ALIVE ref always wins: when the server serves the material again
 *      (e.g. a deliberate re-import resurrects it) the suppression is dropped
 *      automatically — no manual cleanup, no silent resurrection either.
 *   3. A failed/absent sync NEVER clears anything (fail-safe: an unreachable
 *      endpoint keeps the previously known list).
 *   4. Nothing here creates, renames, prices or re-orders a rate; it only
 *      removes/includes whole entries from the arrays the UI already builds.
 *
 * Identity uses ONE rule shared with the server (`normalizeMaterialRef`) and the
 * price pipeline: accents folded, lower-cased, every run of non-alphanumeric
 * characters → `_`, leading/trailing `_` trimmed.
 */
export const CATALOG_TOMBSTONE_STORAGE_KEY = 'konstrivo_catalog_tombstones_v1';
const TRADE_TOMBSTONE_STORAGE_KEY = 'konstrivo_trade_tombstones_v1';

type Listener = () => void;
const listeners = new Set<Listener>();

/**
 * Identity of a material reference (rate id, DB code, import code).
 * Mirrors `server/utils/validation.ts#normalizeMaterialRef` — one rule, so
 * `ALU-001`, `alu_001` and `ALU 001` are the same reference. A value that
 * normalizes to nothing keeps its trimmed lower-case form (never an empty
 * identity, which would match everything).
 */
export function catalogRefIdentity(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (raw === '') return '';
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || raw.toLowerCase();
}

/** localStorage access that is safe in SSR / private mode / Node tests. */
function safeStorage(): { getItem(key: string): string | null; setItem(key: string, value: string): void } | null {
  try {
    const storage = (globalThis as any)?.localStorage;
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') return null;
    return storage;
  } catch {
    return null;
  }
}

function readSet(key: string): Set<string> {
  const storage = safeStorage();
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [];
    return new Set(list.map((v: unknown) => catalogRefIdentity(v)).filter((v: string) => v !== ''));
  } catch {
    return new Set();
  }
}

function writeSet(key: string, values: Set<string>): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(Array.from(values).sort()));
  } catch { /* private mode / quota — the in-memory state still applies */ }
}

function notify(): void {
  listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
}

// ── Server-confirmed material tombstones ────────────────────────────────────
let materialTombstones = readSet(CATALOG_TOMBSTONE_STORAGE_KEY);

// ── Client-persisted DELETED trade codes ────────────────────────────────────
// A hard-deleted non-official trade has NO row left in the database, so no
// server list can report it: only the browser that performed the confirmed
// deletion can remember it (until the trade is created again).
let tradeTombstones = readSet(TRADE_TOMBSTONE_STORAGE_KEY);

export function subscribeCatalogTombstones(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// ── Materials ───────────────────────────────────────────────────────────────

/** True when the DB (or a confirmed Admin action) says this ref is archived. */
export function isCatalogTombstoned(...refs: unknown[]): boolean {
  for (const ref of refs) {
    const identity = catalogRefIdentity(ref);
    if (identity !== '' && materialTombstones.has(identity)) return true;
  }
  return false;
}

/** Suppress a ref the DB has CONFIRMED as archived (never a guess). */
export function markCatalogTombstoned(...refs: unknown[]): void {
  let changed = false;
  for (const ref of refs) {
    const identity = catalogRefIdentity(ref);
    if (identity === '' || materialTombstones.has(identity)) continue;
    materialTombstones.add(identity);
    changed = true;
  }
  if (!changed) return;
  writeSet(CATALOG_TOMBSTONE_STORAGE_KEY, materialTombstones);
  notify();
}

export function clearCatalogTombstoned(...refs: unknown[]): void {
  let changed = false;
  for (const ref of refs) {
    const identity = catalogRefIdentity(ref);
    if (identity === '' || !materialTombstones.has(identity)) continue;
    materialTombstones.delete(identity);
    changed = true;
  }
  if (!changed) return;
  writeSet(CATALOG_TOMBSTONE_STORAGE_KEY, materialTombstones);
  notify();
}

export function listCatalogTombstones(): string[] {
  return Array.from(materialTombstones).sort();
}

/**
 * REPLACE the material suppression list with the server's authoritative one.
 * Only ever called after a SUCCESSFUL `GET /catalog/inactive-refs`: a failed
 * call must keep the previously known list (fail-safe), which is why `null` /
 * `undefined` are accepted and ignored.
 */
export function replaceCatalogTombstones(serverMaterialCodes: string[] | null | undefined): void {
  if (!Array.isArray(serverMaterialCodes)) return;
  const next = new Set<string>();
  for (const code of serverMaterialCodes) {
    const identity = catalogRefIdentity(code);
    if (identity !== '') next.add(identity);
  }
  const same =
    next.size === materialTombstones.size &&
    Array.from(next).every((value) => materialTombstones.has(value));
  if (same) return;
  materialTombstones = next;
  writeSet(CATALOG_TOMBSTONE_STORAGE_KEY, materialTombstones);
  notify();
}

/** Convenience: does this rate belong to a suppressed material? */
export function isTombstonedRate(rate: { id?: string; code?: string }): boolean {
  return isCatalogTombstoned(rate?.id, (rate as any)?.code);
}

/**
 * Apply the suppression list to a rates array (pure filter + the documented
 * "an alive ref wins" rule):
 *   • a rate suppressed by the DB list is REMOVED,
 *   • a rate whose identity appears in `aliveRefs` (the refs the server just
 *     served in /prices) is KEPT and its stale suppression is dropped — a
 *     re-import that resurrects the material must not stay hidden,
 *   • the input array is never mutated (Devis snapshots and user data are built
 *     from these arrays, so they must stay untouched).
 * Returns the SAME reference when nothing changed (cheap for React state).
 */
export function applyCatalogTombstones<T extends { id?: string; code?: string }>(
  rates: T[],
  aliveRefs?: Iterable<unknown>
): T[] {
  if (!Array.isArray(rates) || rates.length === 0) return rates;
  const alive = new Set<string>();
  if (aliveRefs) {
    for (const ref of aliveRefs) {
      const identity = catalogRefIdentity(ref);
      if (identity !== '') alive.add(identity);
    }
  }
  let changed = false;
  const kept: T[] = [];
  for (const rate of rates) {
    const identities = [rate?.id, (rate as any)?.code]
      .map((value) => catalogRefIdentity(value))
      .filter((value: string) => value !== '');
    if (identities.some((identity: string) => alive.has(identity))) {
      // DB truth: the material is served again → drop a stale suppression.
      for (const identity of identities) {
        if (materialTombstones.has(identity)) {
          materialTombstones.delete(identity);
          changed = true;
        }
      }
      kept.push(rate);
      continue;
    }
    if (identities.some((identity: string) => materialTombstones.has(identity))) {
      changed = true;
      continue;
    }
    kept.push(rate);
  }
  if (!changed) return rates;
  writeSet(CATALOG_TOMBSTONE_STORAGE_KEY, materialTombstones);
  return kept;
}

// ── Deleted (hard-removed) TRADE codes ──────────────────────────────────────

export function isTradeTombstoned(code: unknown): boolean {
  const identity = catalogRefIdentity(code);
  return identity !== '' && tradeTombstones.has(identity);
}

export function markTradeTombstoned(code: unknown): void {
  const identity = catalogRefIdentity(code);
  if (identity === '' || tradeTombstones.has(identity)) return;
  tradeTombstones.add(identity);
  writeSet(TRADE_TOMBSTONE_STORAGE_KEY, tradeTombstones);
  notify();
}

export function clearTradeTombstoned(code: unknown): void {
  const identity = catalogRefIdentity(code);
  if (identity === '' || !tradeTombstones.has(identity)) return;
  tradeTombstones.delete(identity);
  writeSet(TRADE_TOMBSTONE_STORAGE_KEY, tradeTombstones);
  notify();
}

export function listTradeTombstones(): string[] {
  return Array.from(tradeTombstones).sort();
}

/**
 * Drop every persisted suppression (materials + deleted trades).
 * Used by the regression suite and as an explicit client-side "clear local
 * catalog suppressions" action; it never writes to the database.
 */
export function resetCatalogTombstones(): void {
  materialTombstones = new Set();
  tradeTombstones = new Set();
  writeSet(CATALOG_TOMBSTONE_STORAGE_KEY, materialTombstones);
  writeSet(TRADE_TOMBSTONE_STORAGE_KEY, tradeTombstones);
  notify();
}
