import { PriceCandidate, PriceSourceConnector, PriceSourceSpec, getPriceSourceSpec, normalizeConnectorCandidate } from './connector';

export const SOURCE_MY_CIDB = 'SOURCE_MY_CIDB';

export interface MalaysiaCidbRow {
  specificationName?: string;
  specification?: string;
  name?: string;
  unit?: string;
  price?: unknown;
  effectiveMonth?: string;
  market?: string;
  currency?: string;
}

export interface MalaysiaCidbFetchOptions {
  baseUrl?: string;
  token?: string;
  email?: string;
  password?: string;
  timeoutMs?: number;
}

interface N3cLoginPayload {
  access_token?: string;
  token_type?: string;
}

async function resolveMalaysiaCidbToken(opts: MalaysiaCidbFetchOptions = {}, timeoutMs = 15000): Promise<string> {
  const directToken = (opts.token ?? process.env.CIDB_API_TOKEN ?? '').trim();
  if (directToken) return directToken;

  const email = (opts.email ?? process.env.CIDB_API_EMAIL ?? '').trim();
  const password = (opts.password ?? process.env.CIDB_API_PASSWORD ?? '').trim();

  if (!email || !password) {
    throw new Error('CIDB API credentials are missing or invalid. Configure a token or CIDB API email/password.');
  }

  const loginBaseUrl = (opts.baseUrl || 'https://n3c-api.cidb.gov.my').replace(/\/$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${loginBaseUrl}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ email, password }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error('CIDB API authentication failed');
    }

    const payload = (await response.json()) as N3cLoginPayload;
    const accessToken = typeof payload.access_token === 'string' ? payload.access_token.trim() : '';

    if (!accessToken) {
      throw new Error('CIDB API authentication failed');
    }

    return accessToken;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error(`CIDB API login timed out after ${timeoutMs}ms`);
    }
    if (error instanceof Error && /CIDB API authentication failed|CIDB API login timed out/.test(error.message)) {
      throw error;
    }
    throw new Error('CIDB API authentication failed');
  } finally {
    clearTimeout(timeout);
  }
}

export interface MalaysiaCidbSubmission {
  materialCode: string;
  price: number;
  countryCode: string;
  currencyCode: string;
  effectiveFrom?: string;
  notes?: string;
  candidate: PriceCandidate;
}

export interface MalaysiaCidbPendingPlan {
  spec: PriceSourceSpec;
  submissions: MalaysiaCidbSubmission[];
  rejected: Array<{ specificationName: string; reason: string }>;
  readonly official: false;
}

const MALAYSIA_MAPPING: Array<{ materialCode: string; labels: string[]; units: string[]; notes: string }> = [
  {
    materialCode: 'sac_ciment_50kg',
    labels: ['Ordinary Portland Cement', 'Cement Ordinary Portland', 'Portland Cement'],
    units: ['bag', '50kg'],
    notes: 'CIDB material matches the existing cement 50kg bag code exactly',
  },
  {
    materialCode: 'bloc_beton_20x20x40',
    labels: ['Concrete Block 20x20x40', 'Concrete Block 20x20x40 CM', 'Block Concrete 20x20x40'],
    units: ['piece', 'pc', 'unit'],
    notes: 'CIDB block specification matches the 20x20x40 concrete block unit exactly',
  },
];

function normalizeText(value: string | undefined): string {
  return (value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function parseMalaysiaPrice(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  }
  return Number.NaN;
}

export function getMalaysiaCidbSpec(): PriceSourceSpec {
  const spec = getPriceSourceSpec(SOURCE_MY_CIDB);
  if (!spec) {
    throw new Error(`Source '${SOURCE_MY_CIDB}' is not registered in PRICE_SOURCE_SPECS`);
  }
  return spec;
}

export function mapMalaysiaCidbRow(row: MalaysiaCidbRow): { materialCode: string; notes: string } | undefined {
  const specificationName = row.specificationName || row.specification || row.name || '';
  const normalizedName = normalizeText(specificationName);
  const normalizedUnit = normalizeText(row.unit || '');

  if (!normalizedName) return undefined;

  const match = MALAYSIA_MAPPING.find(entry =>
    entry.labels.some(label => normalizeText(label) === normalizedName) &&
    entry.units.some(unit => normalizedUnit.includes(normalizeText(unit)))
  );

  if (!match) return undefined;
  return { materialCode: match.materialCode, notes: match.notes };
}

export function buildMalaysiaCidbPendingPlan(rows: MalaysiaCidbRow[]): MalaysiaCidbPendingPlan {
  const spec: PriceSourceSpec = {
    code: SOURCE_MY_CIDB,
    name: 'CIDB Malaysia — N3C Building Material Price API',
    market: 'MY',
    currency: 'MYR',
    kind: 'supplier_api',
    enabled: true,
  };

  const plan: MalaysiaCidbPendingPlan = {
    spec,
    submissions: [],
    rejected: [],
    official: false,
  };

  const seen = new Set<string>();

  for (const row of rows) {
    const rowMarket = (row.market || spec.market).toUpperCase();
    const rowCurrency = (row.currency || spec.currency).toUpperCase();

    if (rowMarket !== spec.market.toUpperCase()) {
      plan.rejected.push({ specificationName: row.specificationName || row.specification || row.name || 'unknown', reason: `market mismatch: row declares '${rowMarket}' but source only allows '${spec.market}'` });
      continue;
    }

    if (rowCurrency !== spec.currency.toUpperCase()) {
      plan.rejected.push({ specificationName: row.specificationName || row.specification || row.name || 'unknown', reason: `currency mismatch: row declares '${rowCurrency}' but source only allows '${spec.currency}'` });
      continue;
    }

    const mapping = mapMalaysiaCidbRow(row);
    if (!mapping) {
      plan.rejected.push({ specificationName: row.specificationName || row.specification || row.name || 'unknown', reason: 'unmapped CIDB specification — no trusted materials.code match (never guessed)' });
      continue;
    }

    const price = parseMalaysiaPrice(row.price);
    if (!Number.isFinite(price)) {
      plan.rejected.push({ specificationName: row.specificationName || row.specification || row.name || 'unknown', reason: 'malformed price value' });
      continue;
    }

    const key = `${mapping.materialCode}|${row.effectiveMonth || ''}|${price}`;
    if (seen.has(key)) continue;
    seen.add(key);

    try {
      const candidate = normalizeConnectorCandidate(spec, {
        materialCode: mapping.materialCode,
        market: 'MY',
        currency: 'MYR',
        price,
        observedAt: new Date().toISOString(),
        effectiveFrom: row.effectiveMonth ? `${row.effectiveMonth}-01` : undefined,
        notes: mapping.notes,
      });

      plan.submissions.push({
        materialCode: candidate.materialCode,
        price: candidate.price,
        countryCode: candidate.market,
        currencyCode: candidate.currency,
        effectiveFrom: candidate.effectiveFrom,
        notes: candidate.notes,
        candidate,
      });
    } catch (err) {
      plan.rejected.push({ specificationName: row.specificationName || row.specification || row.name || 'unknown', reason: (err as Error).message });
    }
  }

  return plan;
}

export async function fetchMalaysiaCidbCandidates(opts: MalaysiaCidbFetchOptions = {}): Promise<PriceCandidate[]> {
  const baseUrl = (opts.baseUrl || 'https://example.invalid').replace(/\/$/, '');
  const timeoutMs = opts.timeoutMs ?? 15000;
  const token = await resolveMalaysiaCidbToken(opts, timeoutMs);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/internal/products/building-material-price`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`CIDB API request failed: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    const rawItems = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];

    if (rawItems.length === 0) {
      return [];
    }

    const rows: MalaysiaCidbRow[] = rawItems.map((item: any) => ({
      specificationName: item?.specificationName || item?.specification || item?.name || item?.materialName,
      unit: item?.unit || item?.measurementUnit || item?.unitName,
      price: item?.price || item?.unitPrice || item?.sellingPrice,
      effectiveMonth: item?.effectiveMonth || item?.month || item?.effectiveDate || item?.date,
      market: 'MY',
      currency: 'MYR',
    }));

    const plan = buildMalaysiaCidbPendingPlan(rows);
    return plan.submissions.map(s => s.candidate);
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error(`CIDB API request timed out after ${timeoutMs}ms`);
    }
    throw new Error(error?.message || 'CIDB API failed and produced no usable prices');
  } finally {
    clearTimeout(timeout);
  }
}

export function createMalaysiaCidbConnector(opts: MalaysiaCidbFetchOptions = {}): PriceSourceConnector {
  const spec = {
    code: SOURCE_MY_CIDB,
    name: 'CIDB Malaysia — N3C Building Material Price API',
    market: 'MY',
    currency: 'MYR',
    kind: 'supplier_api' as const,
    enabled: true,
  };

  return {
    spec,
    async fetchCandidates(): Promise<PriceCandidate[]> {
      const rows = await fetchMalaysiaCidbCandidates(opts);
      return rows;
    },
  };
}

export const PRICE_SOURCE_SPECS = [
  ...(getPriceSourceSpec('SOURCE_MY_CIDB') ? [getPriceSourceSpec('SOURCE_MY_CIDB')!] : []),
  {
    code: SOURCE_MY_CIDB,
    name: 'CIDB Malaysia — N3C Building Material Price API',
    market: 'MY',
    currency: 'MYR',
    kind: 'supplier_api' as const,
    enabled: true,
  },
];
