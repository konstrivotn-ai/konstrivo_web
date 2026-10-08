/**
 * Phase 2 — Lightweight Validation Utilities
 *
 * The smallest appropriate validation dependency: self-contained, no npm install.
 * Validates external input: email, password, phone, body, query params.
 */

import { validationError, badRequest } from './errors';

// ── Primitives ──────────────────────────────────────────────────────────────

export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string' || email.length > 254) return false;
  // RFC 5322 simplified
  const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return re.test(email);
}

export function isValidPassword(password: string): boolean {
  if (!password || typeof password !== 'string') return false;
  if (password.length < 8 || password.length > 128) return false;
  return true;
}

export function isValidPhone(phone: string): boolean {
  if (!phone || typeof phone !== 'string') return false;
  // Accept +216 followed by 8 digits, or general international format
  const re = /^\+?[0-9]{8,15}$/;
  return re.test(phone.replace(/\s/g, ''));
}

export function isValidUuid(uuid: string): boolean {
  if (!uuid || typeof uuid !== 'string') return false;
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return re.test(uuid);
}

// ── Field-level validators ──────────────────────────────────────────────────

export interface ValidationRule {
  field: string;
  label?: string;
  required?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object';
  min?: number;      // string length min, or number min
  max?: number;
  enum?: string[];
  pattern?: RegExp;
  validate?: (value: any) => string | undefined; // returns error message if invalid
}

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

export function validateObject(
  obj: Record<string, any>,
  rules: ValidationRule[]
): ValidationResult {
  const errors: Record<string, string> = {};

  for (const rule of rules) {
    const value = obj[rule.field];
    const label = rule.label || rule.field;

    if (value === undefined || value === null || value === '') {
      if (rule.required) {
        errors[rule.field] = `${label} is required`;
      }
      continue;
    }

    if (rule.type && value !== undefined && value !== null) {
      if (rule.type === 'number' && (typeof value !== 'number' || isNaN(value))) {
        errors[rule.field] = `${label} must be a number`;
        continue;
      }
      if (rule.type === 'array' && !Array.isArray(value)) {
        errors[rule.field] = `${label} must be an array`;
        continue;
      }
      if (rule.type !== 'number' && rule.type !== 'array' && typeof value !== rule.type) {
        errors[rule.field] = `${label} must be a ${rule.type}`;
        continue;
      }
    }

    if (rule.min !== undefined && value !== undefined && value !== null) {
      if (typeof value === 'string' || Array.isArray(value)) {
        if (value.length < rule.min) errors[rule.field] = `${label} must be at least ${rule.min} characters/items`;
      } else if (typeof value === 'number') {
        if (value < rule.min) errors[rule.field] = `${label} must be >= ${rule.min}`;
      }
    }

    if (rule.max !== undefined && value !== undefined && value !== null) {
      if (typeof value === 'string' || Array.isArray(value)) {
        if (value.length > rule.max) errors[rule.field] = `${label} must be at most ${rule.max} characters/items`;
      } else if (typeof value === 'number') {
        if (value > rule.max) errors[rule.field] = `${label} must be <= ${rule.max}`;
      }
    }

    if (rule.enum && value !== undefined && value !== null) {
      if (!rule.enum.includes(String(value))) {
        errors[rule.field] = `${label} must be one of: ${rule.enum.join(', ')}`;
      }
    }

    if (rule.pattern && typeof value === 'string') {
      if (!rule.pattern.test(value)) {
        errors[rule.field] = `${label} format is invalid`;
      }
    }

    if (rule.validate && value !== undefined && value !== null) {
      const errMsg = rule.validate(value);
      if (errMsg) errors[rule.field] = errMsg;
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Express middleware: validates req.body against rules.
 * Calls next() if valid, or sends 422 with error details.
 */
import { Request, Response, NextFunction } from 'express';

export function validateBody(rules: ValidationRule[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = validateObject(req.body || {}, rules);
    if (!result.valid) {
      const err = validationError('Validation failed: ' + Object.values(result.errors).join('; '));
      (err as any).details = result.errors;
      return next(err);
    }
    next();
  };
}

export function validateQuery(rules: ValidationRule[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = validateObject(req.query || {}, rules);
    if (!result.valid) {
      return next(badRequest('Query validation failed: ' + Object.values(result.errors).join('; ')));
    }
    next();
  };
}

/**
 * Normalize a MATERIAL REFERENCE (code or calculator id) for identity
 * comparison — the ONE shared rule used by the archive endpoint and the
 * repositories.
 *
 * It mirrors the id spelling the client produces (`slugifyMaterialId`):
 * accents folded, lower-cased, every run of non-alphanumeric characters
 * (space, `-`, `.`, `_`, `/`, `#`…) collapsed into a single `_`, and leading /
 * trailing `_` removed — which makes `PLAQUE-BA13-STANDARD`,
 * `plaque ba13 standard` and `plaque_ba13_standard` the SAME reference.
 *
 * A reference that normalizes to an EMPTY string (e.g. an Arabic-only code)
 * falls back to the trimmed lower-cased raw value so an empty identity can
 * never match everything.
 */
export function normalizeMaterialRef(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (raw === '') return '';
  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized === '' ? raw.toLowerCase() : normalized;
}

/** Parse integers from query strings safely. */
export function parseIntParam(val: any, defaultValue: number): number {
  if (val === undefined || val === null) return defaultValue;
  const n = parseInt(String(val), 10);
  return isNaN(n) ? defaultValue : n;
}

/** Round to 3 decimal places for monetary values. */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
