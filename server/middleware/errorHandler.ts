/**
 * Phase 2 — Central Error Handler
 *
 * Catches errors passed to next(), formats them consistently,
 * and ensures no stack traces leak in production.
 */
import { Request, Response, NextFunction } from 'express';
import { ApiError, ApiError as ApiErrorClass } from '../utils/errors';
import { config } from '../config';

export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  // Already an ApiError — use its status code and safe message.
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json(err.toJSON());
  }

  // Multer / express body-parser limits
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } });
  }

  // Validation errors (from Joi-like validators)
  if (err?.isJoi || err?.name === 'ValidationError') {
    return res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: err.message || 'Validation error',
      },
    });
  }

  // JWT errors
  if (err?.name === 'JsonWebTokenError' || err?.name === 'TokenExpiredError') {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
  }

  // Unexpected error
  console.error('[KONSTRIVO] Unhandled error:', err);

  const statusCode = err?.statusCode || 500;
  const message = config.isProduction
    ? 'An internal server error occurred'
    : (err?.message || 'Internal server error');

  return res.status(statusCode).json({
    error: {
      code: 'INTERNAL_ERROR',
      message,
    },
  });
}
