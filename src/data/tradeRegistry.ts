import { Trade } from '../types';
import { listTrades, listTradesForAdmin, listInactiveCatalogRefs } from '../lib/api';
import { catalogKey, sameCatalogKey } from '../utils/catalogDisplay';
import {
  replaceCatalogTombstones,
  markTradeTombstoned,
  clearTradeTombstoned,
  listTradeTombstones,
} from './catalogTombstones';

type TradeRegistryListener = () => void;
const registryListeners = new Set<TradeRegistryListener>();
let registryVersion = 0;

let cachedActiveTrades: Trade[] | null = null;
/**
 * Codes the DATABASE reports as deactivated (`trades.is_active = false`, via the
 * additive `GET /catalog/inactive-refs`). Replaced on every successful sync and
 * NEVER cleared by a failure — an unreachable endpoint keeps the last known
 * truth instead of silently reviving a hidden métier.
 */
let serverInactiveTradeCodes = new Set<string>();
/** Client-persisted codes of trades HARD-DELETED through the Admin panel.
 *  A deleted trade has no DB row left, so no server list can report it. */
let deletedTradeCodes = new Set<string>(listTradeTombstones());
/** Union of both — what `isTradeInactiveOrDeleted` answers against. */
let cachedInactiveTradeCodes = new Set<string>([...serverInactiveTradeCodes, ...deletedTradeCodes]);

function rebuildInactiveTradeCodes(): void {
  cachedInactiveTradeCodes = new Set<string>([...serverInactiveTradeCodes, ...deletedTradeCodes]);
}

let isLoaded = false;
let isLoading = false;

function notifyTradeRegistry(): void {
  registryVersion++;
  registryListeners.forEach((fn) => {
    try { fn(); } catch { /* ignore */ }
  });
}

/** Subscribe to trade registry state changes (Admin toggles, deletions, creations). */
export function subscribeTradeRegistry(listener: TradeRegistryListener): () => void {
  registryListeners.add(listener);
  return () => { registryListeners.delete(listener); };
}

export function getTradeRegistryVersion(): number {
  return registryVersion;
}

/**
 * Check if the registry has been hydrated from the server.
 */
export function isTradeRegistryHydrated(): boolean {
  return isLoaded;
}

/**
 * Synchronous read of currently known active trades (empty if still unhydrated).
 */
export function getActiveTradesSync(): Trade[] {
  return cachedActiveTrades ?? [];
}

/**
 * Check whether a trade code is confirmed inactive or deleted in the backend registry.
 * When true, no local fallback, cache, or rates row is allowed to revive this trade.
 */
export function isTradeInactiveOrDeleted(tradeCode: string | null | undefined): boolean {
  if (!tradeCode) return false;
  const key = catalogKey(tradeCode);
  if (cachedInactiveTradeCodes.has(key)) return true;
  // A trade this browser confirmed as DELETED (no DB row left → no server list
  // can report it) stays suppressed until it is created again.
  if (deletedTradeCodes.has(key)) return true;
  return false;
}

/**
 * Notify that trades have changed (e.g. after Admin toggle, delete, or import).
 */
export async function invalidateAndRefreshTrades(): Promise<Trade[]> {
  return refreshTradeRegistry();
}

/**
 * Fetch active trades from the server and update the registry cache.
 */
export async function refreshTradeRegistry(): Promise<Trade[]> {
  isLoading = true;
  try {
    // 1. Fetch public active trades (GET /trades: isActive = true only)
    try {
      const activeRes = await listTrades();
      const activeList: Trade[] = Array.isArray(activeRes?.data) ? activeRes.data : [];
      cachedActiveTrades = activeList;
      isLoaded = true;
    } catch {
      // Total network failure → keep the previous cache (never empty the UI).
    }

    // 2. DB truth for inactive/archived references (materials + trades).
    await refreshInactiveCatalogRefs();

    notifyTradeRegistry();
    return cachedActiveTrades ?? [];
  } finally {
    isLoading = false;
  }
}

/**
 * Sync the DB truth of INACTIVE references:
 *   • `trades.is_active = false`  → the métier must stay hidden after a Refresh,
 *   • `materials.is_deleted = true` → the material must stay removed after a
 *     Refresh even when the local barème cache still contains it.
 *
 * Fail-safe by design: `null` (endpoint unreachable / older server) keeps the
 * previously known state. Returns true only when the server answered.
 */
export async function refreshInactiveCatalogRefs(): Promise<boolean> {
  let answered = false;
  try {
    const refs = await listInactiveCatalogRefs();
    if (refs) {
      answered = true;
      serverInactiveTradeCodes = new Set(refs.tradeCodes.map(catalogKey));
      // The DB list is authoritative for MATERIALS too (additive suppression
      // list the whole app reads; see src/data/catalogTombstones.ts).
      replaceCatalogTombstones(refs.materialCodes);
    }
  } catch {
    // keep previous state
  }

  // Admin sessions get the same information from the trades registry itself —
  // additive source so an older server (without /catalog/inactive-refs) still
  // hides deactivated métiers for an admin, and so a just-deactivated trade is
  // never missed while the public list is in flight.
  try {
    const adminList = await listTradesForAdmin();
    if (Array.isArray(adminList)) {
      for (const t of adminList) {
        if (t && t.isActive === false && t.code) serverInactiveTradeCodes.add(catalogKey(t.code));
      }
    }
  } catch {
    // Non-admin session or offline: nothing to add.
  }

  rebuildInactiveTradeCodes();
  notifyTradeRegistry();
  return answered;
}

/**
 * Mark a trade code as deactivated locally right away (optimistic update from Admin).
 */
export function markTradeDeactivated(tradeCode: string): void {
  const key = catalogKey(tradeCode);
  serverInactiveTradeCodes.add(key);
  rebuildInactiveTradeCodes();
  if (cachedActiveTrades) {
    cachedActiveTrades = cachedActiveTrades.filter((t) => !sameCatalogKey(t.code, tradeCode));
  }
  notifyTradeRegistry();
}

/**
 * Mark a trade code as active locally right away (optimistic update from Admin).
 */
export function markTradeActivated(trade: Trade): void {
  const key = catalogKey(trade.code);
  serverInactiveTradeCodes.delete(key);
  // A re-created / re-activated trade is alive again → drop the deletion mark.
  deletedTradeCodes.delete(key);
  clearTradeTombstoned(trade.code);
  rebuildInactiveTradeCodes();
  if (cachedActiveTrades) {
    const existingIdx = cachedActiveTrades.findIndex((t) => sameCatalogKey(t.code, trade.code));
    if (existingIdx >= 0) {
      cachedActiveTrades[existingIdx] = trade;
    } else {
      cachedActiveTrades.push(trade);
    }
  }
  notifyTradeRegistry();
}

/**
 * Remove a trade code from active trades cache upon deletion.
 * The code is ALSO persisted (`catalogTombstones`) so a Refresh — or a full app
 * reopen — cannot bring a hard-deleted non-official métier back through the
 * local barème/rates cache (the DB row is gone, so no server list can report it).
 */
export function markTradeDeleted(tradeId: string, tradeCode?: string): void {
  if (tradeCode) {
    deletedTradeCodes.add(catalogKey(tradeCode));
    markTradeTombstoned(tradeCode);
  }
  rebuildInactiveTradeCodes();
  if (cachedActiveTrades) {
    cachedActiveTrades = cachedActiveTrades.filter((t) => t.id !== tradeId && (!tradeCode || !sameCatalogKey(t.code, tradeCode)));
  }
  notifyTradeRegistry();
}
