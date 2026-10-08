/**
 * Phase 2 — API Test Connection for Global Catalog sources of type `api`.
 *
 * PURPOSE: one admin-triggered, read-only probe that answers "are these API
 * connection settings reachable?". It runs ONLY when the admin presses
 * `Tester la connexion` — never on save, never on list, never on a schedule.
 *
 * DELIBERATELY OUT OF SCOPE (Phase 1/3): no Import, no Sync, no Scheduler,
 * no Mapping Engine, no schema change, no migration.
 *
 * SAFETY CONTRACT (enforced here + covered by tests):
 *  - Short, fixed timeout (`TEST_CONNECTION_TIMEOUT_MS`).
 *  - Redirects are NEVER followed (`redirect: 'manual'`) — this also removes
 *    the classic "public host 302s to 169.254.169.254" SSRF vector.
 *  - Response body is read through a hard byte cap then the stream is
 *    cancelled; it is NEVER persisted (there is no DB call in this file).
 *  - Credentials come ONLY from `process.env[credentialRef]`. This codebase
 *    has no secrets manager and Phase 2 must not invent one.
 *  - Nothing is logged. `message` strings come from a FIXED allow-list, never
 *    from `Error.message` (which could embed a URL whose query holds an
 *    api_key), never from a header value.
 *  - SSRF guard: scheme allow-list + hostname block-list + private/reserved IP
 *    detection + a DNS resolution check performed BEFORE the request.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { badRequest } from '../utils/errors';
import {
  CATALOG_SOURCE_API_AUTH_TYPES,
  normalizeCatalogSourceApiConfiguration,
} from '../repositories/globalCatalogRepository';

/** Short, fixed, non-configurable timeout — a probe must never hang. */
export const TEST_CONNECTION_TIMEOUT_MS = 5000;

/** Hard cap on how much of the response body is ever read into memory. */
export const TEST_CONNECTION_MAX_RESPONSE_BYTES = 64 * 1024;

/** What the admin gets back — concise, credential-free, never a body. */
export type CatalogSourceTestConnectionResult = {
  success: boolean;
  /** Remote HTTP status, when one was received. */
  status: number | null;
  /** Round-trip latency of the request itself. */
  durationMs: number;
  /** Best-effort response format (`json`/`xml`/`csv`/`html`/`text`/…). */
  format: string | null;
  /** `url.origin` only — never the query (it may hold the api_key). */
  target: string | null;
  /** Generic, fixed-vocabulary French message. Never contains a secret. */
  message: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// SSRF guard — PURE
// ─────────────────────────────────────────────────────────────────────────────

const BLOCKED_HOSTNAMES = [
  'localhost',
  '0.0.0.0',
  '::1',
  'host.docker.internal',
  'metadata',
  'metadata.google.internal',
  'broadcasthost',
];

/** Host suffixes that can only ever point at an internal/undeployed zone. */
const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.intranet',
  '.lan',
  '.home',
  '.corp',
  '.private',
  '.test',
  '.invalid',
  '.example',
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    out = out * 256 + value;
  }
  return out;
}

/** `[first, last]` as 32-bit ints — private / reserved / non-routable IPv4. */
const PRIVATE_IPV4_RANGES: Array<[number, number]> = [
  [ipv4ToInt('0.0.0.0')!, ipv4ToInt('0.255.255.255')!], // 0/8 "this network"
  [ipv4ToInt('10.0.0.0')!, ipv4ToInt('10.255.255.255')!],
  [ipv4ToInt('100.64.0.0')!, ipv4ToInt('100.127.255.255')!],
  [ipv4ToInt('127.0.0.0')!, ipv4ToInt('127.255.255.255')!],
  [ipv4ToInt('169.254.0.0')!, ipv4ToInt('169.254.255.255')!],
  [ipv4ToInt('172.16.0.0')!, ipv4ToInt('172.31.255.255')!],
  [ipv4ToInt('192.0.0.0')!, ipv4ToInt('192.0.0.255')!],
  [ipv4ToInt('192.0.2.0')!, ipv4ToInt('192.0.2.255')!],
  [ipv4ToInt('192.168.0.0')!, ipv4ToInt('192.168.255.255')!],
  [ipv4ToInt('198.18.0.0')!, ipv4ToInt('198.19.255.255')!],
  [ipv4ToInt('198.51.100.0')!, ipv4ToInt('198.51.100.255')!],
  [ipv4ToInt('203.0.113.0')!, ipv4ToInt('203.0.113.255')!],
  [ipv4ToInt('224.0.0.0')!, ipv4ToInt('239.255.255.255')!],
  [ipv4ToInt('240.0.0.0')!, ipv4ToInt('255.255.255.255')!],
];

/** True when a hostname can never be a legitimate external API endpoint. */
export function isBlockedTestConnectionHostname(hostname: string): boolean {
  const host = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.indexOf(host) !== -1) return true;
  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (host.endsWith(suffix)) return true;
  }
  return false;
}

function isPrivateOrReservedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  // Fail closed: an unparseable literal is refused rather than allowed.
  if (value === null) return true;
  for (const range of PRIVATE_IPV4_RANGES) {
    if (value >= range[0] && value <= range[1]) return true;
  }
  return false;
}

/** Fail-closed "is this address non-routable / internal?" for v4 AND v6. */
export function isPrivateOrReservedAddress(address: string): boolean {
  const raw = String(address || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (!raw) return true;

  // IPv4-mapped / IPv4-compatible IPv6 → judge the embedded IPv4.
  const mapped = /^::(?:ffff:|)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw);
  if (mapped) return isPrivateOrReservedIpv4(mapped[1]);

  if (raw.indexOf(':') === -1) return isPrivateOrReservedIpv4(raw);

  // IPv6
  const bare = raw.split('%')[0];
  if (bare === '::' || bare === '::1') return true;
  const groups = bare.startsWith('::') ? bare.slice(2).split(':') : bare.split(':');
  const head = parseInt(groups[0] || '', 16);
  if (Number.isNaN(head)) return true; // fail closed
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((head & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((head & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (head === 0x2001 && parseInt(groups[1] || '', 16) === 0xdb8) return true; // docs range
  return false;
}

/** `dns.lookup(host, { all: true })` → address strings. Injectable for tests. */
export type TestConnectionLookup = (hostname: string) => Promise<string[]>;

export const defaultTestConnectionLookup: TestConnectionLookup = async (hostname) => {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses.map((entry) => entry.address);
};

function isIpLiteral(value: string): boolean {
  return ipv4ToInt(value) !== null || value.indexOf(':') !== -1;
}

const BLOCKED_TARGET_MESSAGE = 'Cible refusée : adresse locale, privée ou interne non autorisée.';
const UNRESOLVABLE_MESSAGE = 'Hôte introuvable (résolution DNS échouée).';

/**
 * Refuse anything that is not a routable public http(s) endpoint.
 * Throws ApiError(400) BEFORE any request is sent.
 */
export async function assertTestConnectionTargetAllowed(
  rawUrl: string,
  lookup: TestConnectionLookup = defaultTestConnectionLookup,
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    throw badRequest('URL de connexion invalide.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw badRequest('Seuls les protocoles http:// et https:// sont autorisés.');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isBlockedTestConnectionHostname(hostname)) throw badRequest(BLOCKED_TARGET_MESSAGE);

  // An IP literal is judged directly (fail closed) and needs no DNS.
  // A plain hostname can only be judged once DNS says where it points — it is
  // NOT an address, so it must never be fed to the address check.
  if (isIpLiteral(hostname)) {
    if (isPrivateOrReservedAddress(hostname)) throw badRequest(BLOCKED_TARGET_MESSAGE);
    return;
  }

  let addresses: string[];
  try {
    addresses = await lookup(hostname);
  } catch {
    throw badRequest(UNRESOLVABLE_MESSAGE);
  }
  if (!addresses || addresses.length === 0) throw badRequest(UNRESOLVABLE_MESSAGE);
  for (const address of addresses) {
    if (isPrivateOrReservedAddress(address)) throw badRequest(BLOCKED_TARGET_MESSAGE);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Credentials + request plan — PURE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `url.origin` only: protocol + host (+ port).
 * The query string is ALWAYS dropped because `credentialLocation: 'query'`
 * puts the api_key there, and the fragment is dropped for the same reason.
 * This is the ONLY form of a target URL that may be returned or logged.
 */
export function redactTestConnectionUrl(rawUrl: string): string {
  try {
    return new URL(String(rawUrl)).origin;
  } catch {
    return 'invalid-url';
  }
}

/**
 * Read the secret behind a `credentialRef` from the process environment —
 * the ONLY secret source this phase is allowed to use (no secrets manager).
 * Returns `null` for a missing/blank value; never throws, never logs.
 */
export function resolveCatalogSourceSecret(
  credentialRef: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const name = String(credentialRef ?? '').trim();
  if (!name) return null;
  const raw = env[name];
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value ? value : null;
}

export type CatalogSourceConnectionPlan = {
  url: string;
  headers: Record<string, string>;
};

const MISSING_SECRET_MESSAGE =
  'Secret introuvable : la variable d’environnement référencée est absente ou vide. ' +
  'Aucune requête n’a été envoyée.';

/**
 * Build the exact URL + headers to probe. PURE (env + config are arguments).
 *
 * - Re-validates `configuration.api` with the Phase 1 normalizer, so a row
 *   written before/outside that validation can never reach `fetch`.
 * - The secret is read from `env[credentialRef]` ONLY when authentication is
 *   enabled, and is placed in the header/query the config asks for.
 * - Throws ApiError(400) when the secret is absent so an EMPTY credential is
 *   never sent (explicitly required by the phase spec).
 * - Configured `headerNames` are intentionally NOT sent: Phase 1 stores names
 *   precisely because a header VALUE can carry a credential, and no value is
 *   stored. Only the standard `Accept`/`User-Agent`/auth headers go out.
 */
export function buildCatalogSourceConnectionPlan(
  api: unknown,
  env: Record<string, string | undefined> = process.env,
): CatalogSourceConnectionPlan {
  const cfg = normalizeCatalogSourceApiConfiguration(api);
  if (CATALOG_SOURCE_API_AUTH_TYPES.indexOf(cfg.authType) === -1) {
    throw badRequest(`Type d’authentification non pris en charge : ${cfg.authType}`);
  }

  const headers: Record<string, string> = {
    Accept: 'application/json, application/xml, text/csv;q=0.9, */*;q=0.8',
    'User-Agent': 'KONSTRIVO-TestConnection/1.0',
  };

  let url = cfg.baseUrl;

  if (cfg.authType !== 'none') {
    const secret = resolveCatalogSourceSecret(cfg.credentialRef, env);
    if (!secret) throw badRequest(MISSING_SECRET_MESSAGE);

    if (cfg.authType === 'api_key' && cfg.credentialLocation === 'query') {
      const parsed = new URL(cfg.baseUrl);
      parsed.searchParams.set(cfg.credentialKey, secret);
      url = parsed.toString();
    } else if (cfg.authType === 'api_key') {
      headers[cfg.credentialKey] = secret;
    } else if (cfg.authType === 'bearer_token') {
      headers.Authorization = `Bearer ${secret}`;
    } else if (cfg.authType === 'basic_auth') {
      const credentials = Buffer.from(`${cfg.username ?? ''}:${secret}`, 'utf8').toString('base64');
      headers.Authorization = `Basic ${credentials}`;
    }
  }

  return { url, headers };
}

// ─────────────────────────────────────────────────────────────────────────────
// Response inspection — PURE
// ─────────────────────────────────────────────────────────────────────────────

/** Best-effort format token from `Content-Type`, with a bounded body sniff. */
export function detectResponseFormat(contentType: string, sample = ''): string | null {
  const essence = String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();

  if (essence) {
    if (essence.indexOf('json') !== -1) return 'json';
    if (essence === 'application/xml' || essence === 'text/xml' || essence.endsWith('+xml')) return 'xml';
    if (essence === 'text/csv' || essence === 'application/csv') return 'csv';
    if (essence === 'text/html') return 'html';
    if (essence === 'text/plain') return 'text';
    return essence;
  }

  // No Content-Type at all → peek at the (already bounded) body prefix.
  const peek = String(sample || '').trim();
  if (peek.startsWith('{') || peek.startsWith('[')) return 'json';
  if (peek.startsWith('<')) return 'html';
  return null;
}

/**
 * Read at most `maxBytes` of the body, then cancel the stream.
 * The returned text is used ONLY to sniff the format — never returned to the
 * caller, never logged, never persisted.
 */
async function readBodyPrefix(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const body = response.body;
  if (!body) return '';

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const step = await reader.read();
      if (step.done) break;
      if (!step.value || step.value.byteLength === 0) continue;
      const remaining = maxBytes - total;
      if (step.value.byteLength > remaining) {
        chunks.push(step.value.subarray(0, remaining));
        total = maxBytes;
        break;
      }
      chunks.push(step.value);
      total += step.value.byteLength;
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

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator — the ONLY place a request is actually sent
// ─────────────────────────────────────────────────────────────────────────────

export type RunCatalogSourceTestConnectionOptions = {
  /** Injected for tests; production always uses `process.env`. */
  env?: Record<string, string | undefined>;
  /** Injected for tests so no suite ever reaches a real API. */
  fetchImpl?: typeof fetch;
  /** Injected for tests so no suite performs real DNS. */
  lookup?: TestConnectionLookup;
  now?: () => number;
};

/**
 * Probe a `catalog_sources` row of type `api`.
 *
 * THROWS ApiError(400) — i.e. "we refused / could not build the request":
 *   - source is not of type `api`
 *   - `configuration.api` is missing
 *   - the referenced secret is absent/empty (an empty credential is NEVER sent)
 *   - the target failed the SSRF guard or could not be resolved
 *
 * RETURNS `{ success: false, … }` — i.e. "we sent it and it did not answer 2xx"
 *   - timeout, network error, redirect (not followed), 4xx/5xx.
 *
 * PERFORMS NO DATABASE WRITE and logs nothing.
 */
export async function runCatalogSourceTestConnection(
  source: any,
  options: RunCatalogSourceTestConnectionOptions = {},
): Promise<CatalogSourceTestConnectionResult> {
  const now = options.now ?? Date.now;

  const sourceType = String(source?.sourceType ?? '')
    .trim()
    .toLowerCase();
  if (sourceType !== 'api') {
    throw badRequest('Seules les sources de type « api » peuvent être testées.');
  }

  const configuration = source?.configuration;
  const api =
    configuration && typeof configuration === 'object' && !Array.isArray(configuration)
      ? (configuration as any).api
      : undefined;
  if (!api) throw badRequest('Cette source n’a pas de configuration API à tester.');

  // Throws 400 when a referenced secret is missing (never sends an empty one).
  const plan = buildCatalogSourceConnectionPlan(api, options.env ?? process.env);

  // SSRF guard runs BEFORE anything leaves this process.
  await assertTestConnectionTargetAllowed(plan.url, options.lookup ?? defaultTestConnectionLookup);

  const target = redactTestConnectionUrl(plan.url);
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_CONNECTION_TIMEOUT_MS);
  const startedAt = now();

  try {
    const response = await doFetch(plan.url, {
      method: 'GET',
      headers: plan.headers,
      // Never follow: a redirect could point straight at an internal address.
      redirect: 'manual',
      signal: controller.signal,
    });
    const durationMs = Math.max(0, now() - startedAt);
    const status = typeof response.status === 'number' && response.status > 0 ? response.status : null;

    if (response.redirected || (status !== null && status >= 300 && status < 400)) {
      return {
        success: false,
        status,
        durationMs,
        format: null,
        target,
        message: 'Redirection détectée : elle n’est pas suivie.',
      };
    }

    // Bounded prefix → format sniff only. Never returned, logged or stored.
    const sample = await readBodyPrefix(response, TEST_CONNECTION_MAX_RESPONSE_BYTES);
    const format = detectResponseFormat(response.headers?.get?.('content-type') || '', sample);
    const success = status !== null && status >= 200 && status < 300;

    return {
      success,
      status,
      durationMs,
      format,
      target,
      message: success
        ? 'Connexion réussie.'
        : `Le serveur a répondu avec le statut ${status === null ? 'inconnu' : status}.`,
    };
  } catch {
    const durationMs = Math.max(0, now() - startedAt);
    if (controller.signal.aborted) {
      return {
        success: false,
        status: null,
        durationMs,
        format: null,
        target,
        message: `Délai dépassé (${TEST_CONNECTION_TIMEOUT_MS} ms).`,
      };
    }
    // `err.message` is deliberately discarded: a fetch error can embed the
    // full URL, whose query may hold the api_key.
    return {
      success: false,
      status: null,
      durationMs,
      format: null,
      target,
      message: 'Connexion impossible (réseau, DNS ou refus distant).',
    };
  } finally {
    clearTimeout(timer);
  }
}



