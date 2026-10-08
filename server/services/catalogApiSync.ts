import crypto from 'node:crypto';

import { badRequest } from '../utils/errors';
import {
  normalizeCatalogSourceApiConfiguration,
} from '../repositories/globalCatalogRepository';
import {
  assertTestConnectionTargetAllowed,
  buildCatalogSourceConnectionPlan,
  defaultTestConnectionLookup,
  redactTestConnectionUrl,
} from './catalogSourceTestConnection';
import { resolveApiResponse } from './catalogApiResolver';
import { previewApiImportRows } from './catalogApiImportPreview';
import { commitApiImportRows, sha256Json } from './catalogApiImportCommit';

export type CatalogApiSyncStatus = 'running' | 'success' | 'partial' | 'failed';

export type CatalogApiSyncCounts = {
  total: number;
  valid: number;
  invalid: number;
  created: number;
  matched: number;
  updated: number;
  reviewRequired: number;
  rejected: number;
};

export type CatalogApiSyncRun = {
  runId: string;
  sourceId: string;
  startedAt: string;
  finishedAt: string | null;
  status: CatalogApiSyncStatus;
  counts: CatalogApiSyncCounts;
  errorSummary: string | null;
  triggeredBy: string;
  target: string | null;
  message: string;
};

export type CatalogApiSyncOptions = {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  lookup?: (hostname: string) => Promise<string[]>;
  matcher?: (identifierType: string | null, identifierValue: string | null, supplierId: string | null) => Promise<string | null>;
  previewRows?: (resolved: any, opts?: any) => Promise<any>;
  commitRows?: (items: any[], args: any) => Promise<any>;
  triggeredBy?: string;
  now?: () => number;
  timeoutMs?: number;
  /** Test seam for the response-size guard. Defaults to SYNC_MAX_RESPONSE_BYTES. */
  maxResponseBytes?: number;
  runId?: string;
};

export type CatalogApiSyncResult = CatalogApiSyncRun & {
  durationMs: number;
};

const syncHistoryBySource = new Map<string, CatalogApiSyncRun[]>();
const runningSyncsBySource = new Map<string, Promise<CatalogApiSyncResult>>();

const DEFAULT_SYNC_TIMEOUT_MS = 15000;

/**
 * Hard cap on the response body a sync will ever buffer.
 *
 * The sync must be able to hold a FULL, valid catalog: the resolver already
 * refuses a collection above `API_RESOLVER_MAX_PRODUCTS` (it throws rather than
 * truncating), so this cap only protects the process from an oversized payload.
 * Exceeding it is a hard FAILURE — the body is never silently truncated, which
 * would commit a partial catalog and make "products disappeared from the API"
 * indistinguishable from a truncated read.
 */
export const SYNC_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/**
 * Read the whole body, refusing anything above `maxBytes`.
 *
 * Unlike the test-connection prefix read (which only sniffs a format), a sync
 * needs EVERY byte: a short read would drop products. So the body is either
 * read in full or the sync fails.
 */
async function readBodyStrictly(
  response: Response,
  maxBytes: number,
): Promise<string> {
  // Fast reject on a declared Content-Length, before buffering anything.
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    try {
      await response.body?.cancel();
    } catch {
      /* the stream may already be closed — nothing to release */
    }
    throw new Error(
      `Response exceeds the maximum sync size of ${maxBytes} bytes. ` +
      'The source was not imported; raise the source page size or narrow the endpoint.',
    );
  }

  const body = response.body;
  if (!body) return '';

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      if (!step.value || step.value.byteLength === 0) continue;
      total += step.value.byteLength;
      if (total > maxBytes) {
        throw new Error(
          `Response exceeds the maximum sync size of ${maxBytes} bytes. ` +
          'The source was not imported; raise the source page size or narrow the endpoint.',
        );
      }
      chunks.push(step.value);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* the stream may already be closed — nothing to release */
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

function normalizeSourceId(source: any): string {
  const value = String(source?.id ?? source?.source_id ?? source?.name ?? 'unknown-source').trim();
  return value || 'unknown-source';
}

function ensureHistory(sourceId: string): CatalogApiSyncRun[] {
  if (!syncHistoryBySource.has(sourceId)) {
    syncHistoryBySource.set(sourceId, []);
  }
  return syncHistoryBySource.get(sourceId)!;
}

function sanitizeSummary(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;

  let out = text
    .replace(/https?:\/\/[^\s)>'"`]+/gi, '[URL]')
    .replace(/(api[_-]?key|token|secret|authorization)=?[^&\s\]]+/gi, '$1=[REDACTED]')
    .replace(/Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/gi, 'Authorization: Bearer [REDACTED]')
    .replace(/X-API-Key:\s*[A-Za-z0-9._-]+/gi, 'X-API-Key: [REDACTED]');

  if (out.length > 400) {
    out = `${out.slice(0, 400).trimEnd()}…`;
  }

  return out;
}

function isApiSource(source: any): boolean {
  return String(source?.sourceType ?? source?.type ?? '').trim().toLowerCase() === 'api';
}

export function listCatalogApiSyncRuns(sourceId?: string): CatalogApiSyncRun[] {
  const target = sourceId ? String(sourceId) : undefined;
  if (!target) {
    const all: CatalogApiSyncRun[] = [];
    for (const rows of syncHistoryBySource.values()) {
      all.push(...rows);
    }
    return all.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }

  return [...(syncHistoryBySource.get(target) ?? [])].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
}

export function isCatalogApiSyncRunning(sourceId: string): boolean {
  return runningSyncsBySource.has(String(sourceId));
}

export function getCatalogApiSyncRunSummary(sourceId: string, runId: string): CatalogApiSyncRun | undefined {
  const rows = syncHistoryBySource.get(String(sourceId)) ?? [];
  return rows.find((row) => row.runId === String(runId));
}

export async function runCatalogApiSync(
  source: any,
  options: CatalogApiSyncOptions = {},
): Promise<CatalogApiSyncResult> {
  const sourceId = normalizeSourceId(source);
  const triggeredBy = options.triggeredBy ?? 'manual';
  const now = options.now ?? Date.now;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS) || DEFAULT_SYNC_TIMEOUT_MS);
  const maxResponseBytes = Math.max(
    1024,
    Number(options.maxResponseBytes ?? SYNC_MAX_RESPONSE_BYTES) || SYNC_MAX_RESPONSE_BYTES,
  );

  if (!isApiSource(source)) {
    throw badRequest('Only API sources can be synchronized.');
  }

  const apiConfig = source?.configuration && typeof source.configuration === 'object' && !Array.isArray(source.configuration)
    ? (source.configuration as any).api
    : undefined;
  if (!apiConfig) {
    throw badRequest('This source has no API configuration for sync.');
  }

  if (runningSyncsBySource.has(sourceId)) {
    throw new Error(`A sync for source ${sourceId} is already running.`);
  }

  const normalizedApi = normalizeCatalogSourceApiConfiguration(apiConfig);
  if (!normalizedApi.mapping) {
    throw badRequest('This API source is missing a mapping required for sync.');
  }

  const runId = options.runId ?? crypto.randomUUID();
  const startedAtIso = new Date(now()).toISOString();
  const run: CatalogApiSyncRun = {
    runId,
    sourceId,
    startedAt: startedAtIso,
    finishedAt: null,
    status: 'running',
    counts: {
      total: 0,
      valid: 0,
      invalid: 0,
      created: 0,
      matched: 0,
      updated: 0,
      reviewRequired: 0,
      rejected: 0,
    },
    errorSummary: null,
    triggeredBy,
    target: null,
    message: 'Sync running…',
  };
  ensureHistory(sourceId).unshift(run);

  const runPromise = (async (): Promise<CatalogApiSyncResult> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = now();

    try {
      const env = options.env ?? process.env;
      const plan = buildCatalogSourceConnectionPlan(normalizedApi, env);
      await assertTestConnectionTargetAllowed(plan.url, options.lookup ?? defaultTestConnectionLookup);

      const target = redactTestConnectionUrl(plan.url);
      run.target = target;

      const doFetch = options.fetchImpl ?? fetch;
      const response = await doFetch(plan.url, {
        method: 'GET',
        headers: plan.headers,
        redirect: 'manual',
        signal: controller.signal,
      });

      if (response.redirected || (response.status >= 300 && response.status < 400)) {
        throw new Error('Redirects are not followed during API sync.');
      }
      if (!response.ok) {
        const statusCode = Number(response.status || 0);
        throw new Error(`HTTP ${statusCode} from API source.`);
      }

      // Never read the body with the unbounded convenience helper here: it
      // buffers everything with no limit. A sync needs every byte, so the read
      // is capped strictly — an oversized payload FAILS the run instead of
      // committing a truncated catalog.
      const rawText = await readBodyStrictly(response, maxResponseBytes);

      // A body that is not JSON at all is not silently coerced into an empty
      // document: the resolver needs a real object to report a real error.
      let document: unknown;
      if (rawText.trim()) {
        try {
          document = JSON.parse(rawText);
        } catch {
          throw new Error(
            'The API response is not valid JSON. Nothing was imported.',
          );
        }
      } else {
        throw new Error('The API response body is empty. Nothing was imported.');
      }

      if (document === null || typeof document !== 'object') {
        throw new Error(
          'The API response is not a JSON object. Nothing was imported.',
        );
      }

      const resolved = resolveApiResponse(document, normalizedApi.mapping!);
      const preview = await (options.previewRows ?? previewApiImportRows)(resolved, {
        matcher: options.matcher ?? (async () => null),
      });

      const commitResult = await (options.commitRows ?? commitApiImportRows)(preview.items, {
        source: {
          name: source?.name ?? 'Catalog API Sync',
          sourceType: source?.sourceType ?? 'api',
          countryCode: source?.countryCode ?? null,
        },
        createdByUserId: triggeredBy,
        documentSha256: sha256Json(document),
      });

      const total = Number(resolved?.total ?? preview?.items?.length ?? 0);
      const valid = Number(preview?.summary?.valid ?? 0);
      const invalid = Number(preview?.summary?.invalid ?? 0);
      // The COMMIT result is authoritative for what actually happened: it
      // already counts the rows it staged for review. The preview summary counts
      // the SAME rows, so adding them together would double-count a run.
      const reviewRequired = Number.isFinite(Number(commitResult?.reviewRequired))
        ? Number(commitResult.reviewRequired)
        : Number(preview?.summary?.reviewRequired ?? 0);
      const rejected = Number(commitResult?.rejected ?? 0);
      const created = Number(commitResult?.created ?? 0);
      const matched = Number(commitResult?.matched ?? 0);
      const updated = Number(commitResult?.updated ?? 0);

      const counts: CatalogApiSyncCounts = {
        total,
        valid,
        invalid,
        created,
        matched,
        updated,
        reviewRequired,
        rejected,
      };

      const hasPartialData = invalid > 0 || reviewRequired > 0 || rejected > 0;
      const finalStatus: CatalogApiSyncStatus = hasPartialData ? 'partial' : 'success';

      const finalResult: CatalogApiSyncResult = {
        runId,
        sourceId,
        startedAt: startedAtIso,
        finishedAt: new Date(now()).toISOString(),
        status: finalStatus,
        counts,
        errorSummary: null,
        triggeredBy,
        target,
        message: finalStatus === 'success'
          ? 'Sync completed successfully.'
          : 'Sync completed with partial data requiring review.',
        durationMs: Math.max(0, now() - startedAt),
      };

      run.status = finalResult.status;
      run.counts = finalResult.counts;
      run.errorSummary = finalResult.errorSummary;
      run.finishedAt = finalResult.finishedAt;
      run.message = finalResult.message;
      run.target = finalResult.target;
      return finalResult;
    } catch (error) {
      const summary = sanitizeSummary(error instanceof Error ? error.message : String(error));
      const failedResult: CatalogApiSyncResult = {
        runId,
        sourceId,
        startedAt: startedAtIso,
        finishedAt: new Date(now()).toISOString(),
        status: 'failed',
        counts: {
          total: 0,
          valid: 0,
          invalid: 0,
          created: 0,
          matched: 0,
          updated: 0,
          reviewRequired: 0,
          rejected: 0,
        },
        errorSummary: summary,
        triggeredBy,
        target: run.target,
        message: summary ?? 'Sync failed.',
        durationMs: Math.max(0, now() - startedAt),
      };

      run.status = failedResult.status;
      run.counts = failedResult.counts;
      run.errorSummary = failedResult.errorSummary;
      run.finishedAt = failedResult.finishedAt;
      run.message = failedResult.message;
      run.target = failedResult.target;
      return failedResult;
    } finally {
      clearTimeout(timer);
      runningSyncsBySource.delete(sourceId);
    }
  })();

  runningSyncsBySource.set(sourceId, runPromise);
  return await runPromise;
}

export function catalogApiSyncRunState(sourceId: string): CatalogApiSyncRun | null {
  const rows = syncHistoryBySource.get(String(sourceId));
  if (!rows || rows.length === 0) return null;
  return rows[0];
}
