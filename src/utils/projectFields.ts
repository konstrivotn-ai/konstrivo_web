/**
 * Phase 1 — Project field mapping (client side) for the EXISTING `projects`
 * table (`server/db/schema/operations.ts`).
 *
 * Why this file exists:
 *  - `ProjectsTab` builds a UI-shaped object (title/location/surface/budget,
 *    French status labels, `as any`) that does NOT match the server columns
 *    (`name`/`region`/`notes`/`budgetTotalHt`, machine status enum).
 *  - The server `status` column is `varchar(30)` with a default but NO CHECK
 *    constraint, so pushing the UI label ('Terminé') would silently store a
 *    value no reader understands. We normalize it to the real enum used by
 *    `ChantierProject.status`.
 *
 * This is the projects counterpart of `src/utils/devisFields.ts` — same
 * explicit-mapping approach, no calculation logic.
 */
import type { ChantierProject } from '../types';

/** Server `projects.status` values (mirrors `ChantierProject['status']`). */
export const PROJECT_STATUSES: ReadonlyArray<ChantierProject['status']> = [
  'planification',
  'en_cours',
  'reception_provisoire',
  'cloture',
];

/** Server `projects.type` values (mirrors `ChantierProject['type']`). */
export const PROJECT_TYPES: ReadonlyArray<ChantierProject['type']> = [
  'residentiel',
  'commercial',
  'renovation',
  'villa_neuve',
  'bureau',
];

/** 'Terminé' / 'En cours' / 'Planification' … → real server enum value. */
export function normalizeProjectStatus(value: unknown): ChantierProject['status'] {
  if (typeof value !== 'string') return 'planification';
  const raw = value.trim().toLowerCase();
  if (!raw) return 'planification';
  // Already a canonical server value (accent/case-insensitive check).
  const canonical = PROJECT_STATUSES.find((s) => s === raw);
  if (canonical) return canonical;
  // French display labels produced by the UI.
  if (raw === 'terminé' || raw === 'termine' || raw === 'clôturé') return 'cloture';
  if (raw === 'en cours') return 'en_cours';
  if (raw === 'réception provisoire' || raw === 'reception provisoire') return 'reception_provisoire';
  return 'planification';
}

/** Free-text UI type → real server enum value (unknown → 'residentiel'). */
export function normalizeProjectType(value: unknown): ChantierProject['type'] {
  if (typeof value !== 'string') return 'residentiel';
  const raw = value.trim().toLowerCase();
  const canonical = PROJECT_TYPES.find((t) => t === raw);
  if (canonical) return canonical;
  if (raw.includes('rénov') || raw.includes('renov')) return 'renovation';
  if (raw.includes('villa')) return 'villa_neuve';
  if (raw.includes('bureau') || raw.includes('commercial')) return 'commercial';
  return 'residentiel';
}

/** Choose the canonical value when present, else the normalized fallback. */
export function pickProjectEnum<T extends string>(
  value: unknown,
  list: ReadonlyArray<T>,
  fallback: T,
): T {
  if (typeof value === 'string' && (list as ReadonlyArray<string>).includes(value)) return value as T;
  return fallback;
}

/** Numeric coercion — Postgres `numeric` columns arrive as strings. */
export function toProjectNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** Best-effort YYYY-MM-DD for the `timestamp` columns. */
export function toProjectTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const legacy = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (legacy) return `${legacy[3]}-${legacy[2].padStart(2, '0')}-${legacy[1].padStart(2, '0')}`;
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

/**
 * Map a UI project object into the EXACT shape `POST /api/v1/projects` accepts.
 * `companyId` is intentionally NOT set here — the server resolves it from the
 * authenticated JWT (`req.user.companyId`), so the client never has to know it.
 *
 * UI-only fields with no column (`location`, `surface`, `duration`, `author`,
 * `services`) are folded into `notes` so no user-entered information is lost.
 */
export function toServerProjectPayload(project: any): Record<string, unknown> {
  const title = String(project?.title ?? project?.name ?? '').trim();
  const description = String(project?.description ?? '').trim();

  const extras: string[] = [];
  if (project?.location) extras.push(`Localisation: ${project.location}`);
  if (project?.surface) extras.push(`Surface: ${project.surface}`);
  if (project?.duration) extras.push(`Durée: ${project.duration}`);
  if (project?.author) extras.push(`Auteur: ${project.author}`);
  if (Array.isArray(project?.services) && project.services.length > 0) {
    extras.push(`Services: ${project.services.join(', ')}`);
  }
  const notes = [description, ...extras].filter(Boolean).join('\n');

  // The UI packs "Région • Type d'usage" into `location`; the `region` column
  // expects the geographic part only (varchar(100)).
  const regionFromLocation = typeof project?.location === 'string'
    ? project.location.split('•')[0].trim() || undefined
    : undefined;

  return {
    name: title,
    clientName: project?.clientName ?? undefined,
    clientPhone: project?.clientPhone ?? undefined,
    address: project?.address ?? undefined,
    region: project?.region ?? regionFromLocation ?? undefined,
    country: project?.country ?? undefined,
    currency: project?.currency ?? undefined,
    type: pickProjectEnum(project?.type, PROJECT_TYPES, normalizeProjectType(project?.category)),
    status: pickProjectEnum(project?.status, PROJECT_STATUSES, normalizeProjectStatus(project?.status)),
    progressPercent: toProjectNumber(project?.progressPercent),
    budgetTotalHt: toProjectNumber(project?.budgetTotalHt),
    startDate: toProjectTimestamp(project?.startDate),
    targetEndDate: toProjectTimestamp(project?.targetEndDate),
    notes: notes || undefined,
  };
}

/**
 * `POST /api/v1/projects` requires a non-empty `name` (server: 400 otherwise).
 * The UI treats an empty title as "nothing to publish", so the caller can use
 * this to skip the API call instead of provoking a 400.
 */
export function hasPublishableProjectData(project: any): boolean {
  return String(project?.title ?? project?.name ?? '').trim().length > 0;
}