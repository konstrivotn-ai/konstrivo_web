/**
 * Phase 2 + Phase 3 — API Error Framework
 *
 * Consistent error response format:
 *   { "error": { "code": "SOME_CODE", "message": "Human readable" } }
 */

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: ApiErrorCode;

  constructor(message: string, statusCode: number, code: ApiErrorCode) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
  }

  toJSON() {
    return { error: { code: this.code, message: this.message } };
  }
}

// ── Factory helpers ───────────────────────────────────────────────────────

export function badRequest(message: string): ApiError {
  return new ApiError(message, 400, 'BAD_REQUEST');
}

export function unauthorized(message = 'Authentication required'): ApiError {
  return new ApiError(message, 401, 'UNAUTHORIZED');
}

export function forbidden(message = 'Insufficient permissions'): ApiError {
  return new ApiError(message, 403, 'FORBIDDEN');
}

export function notFound(message = 'Resource not found'): ApiError {
  return new ApiError(message, 404, 'NOT_FOUND');
}

export function conflict(message = 'Conflict'): ApiError {
  return new ApiError(message, 409, 'CONFLICT');
}

export function payloadTooLarge(message = 'Payload too large'): ApiError {
  return new ApiError(message, 413, 'PAYLOAD_TOO_LARGE');
}

export function unsupportedMediaType(message = 'Unsupported media type'): ApiError {
  return new ApiError(message, 415, 'UNSUPPORTED_MEDIA_TYPE');
}

export function validationError(message = 'Validation error'): ApiError {
  return new ApiError(message, 422, 'VALIDATION_ERROR');
}

export function internalError(message = 'Internal server error'): ApiError {
  return new ApiError(message, 500, 'INTERNAL_ERROR');
}
