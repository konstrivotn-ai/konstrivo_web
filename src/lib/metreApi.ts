// @ts-nocheck
/**
 * Universal Professional Métré — Phase 3/4 client API helpers.
 */
import { getAccessToken } from './api';

const BASE = '/api/v1';

async function authFetch(path: string, init: RequestInit = {}): Promise<any> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((payload as any)?.error?.message || `Request failed: ${res.status}`);
  return (payload as any).data;
}

export const metreApi = {
  listZones: (projectId: string) => authFetch(`/metre/projects/${encodeURIComponent(projectId)}/zones`),
  createZone: (projectId: string, body: any) => authFetch(`/metre/projects/${encodeURIComponent(projectId)}/zones`, { method: 'POST', body: JSON.stringify(body) }),

  listOuvrages: (projectId: string, zoneId?: string) => {
    const q = zoneId ? `?zoneId=${encodeURIComponent(zoneId)}` : '';
    return authFetch(`/metre/projects/${encodeURIComponent(projectId)}/ouvrages${q}`);
  },
  createOuvrage: (projectId: string, body: any) => authFetch(`/metre/projects/${encodeURIComponent(projectId)}/ouvrages`, { method: 'POST', body: JSON.stringify(body) }),

  listReleves: (ouvrageId: string) => authFetch(`/metre/ouvrages/${encodeURIComponent(ouvrageId)}/releves`),
  createReleve: (ouvrageId: string, body: any) => authFetch(`/metre/ouvrages/${encodeURIComponent(ouvrageId)}/releves`, { method: 'POST', body: JSON.stringify(body) }),

  listLines: (releveId: string) => authFetch(`/metre/releves/${encodeURIComponent(releveId)}/lines`),
  addLine: (releveId: string, body: any) => authFetch(`/metre/releves/${encodeURIComponent(releveId)}/lines`, { method: 'POST', body: JSON.stringify(body) }),
};
