/**
 * Phase 2 — Upload Middleware
 *
 * Handles multipart/form-data for file uploads.
 * Enforces size limits and file type validation.
 * Uses the custom multipart parser (no multer dependency).
 */
import { Request, Response, NextFunction } from 'express';
import { parseMultipart, getBoundary, MultipartField, MultipartFile, isValidFileType } from '../utils/multipart';
import { config } from '../config';
import { payloadTooLarge, unsupportedMediaType, badRequest } from '../utils/errors';

export interface UploadRequest extends Request {
  uploadedFiles?: MultipartFile[];
  uploadedFields?: MultipartField[];
}

/**
 * Middleware that parses multipart/form-data from the request body.
 * Attaches parsed files to req.uploadedFiles and fields to req.uploadedFields.
 *
 * Must be used BEFORE the route handler.
 * The route must use express.raw({ type: 'multipart/form-data' }) to get the raw buffer,
 * OR this middleware can read req.body if it's already a Buffer.
 */
export function handleUpload(
  req: UploadRequest,
  res: Response,
  next: NextFunction
): void {
  const contentType = req.headers['content-type'] || '';

  if (!contentType.startsWith('multipart/form-data')) {
    return next(unsupportedMediaType('Expected multipart/form-data'));
  }

  const boundary = getBoundary(contentType);
  if (!boundary) {
    return next(badRequest('Missing multipart boundary'));
  }

  // Express may have already parsed the body as a Buffer if we used express.raw()
  const body = req.body;
  if (!Buffer.isBuffer(body)) {
    // Body might be in req (raw body stored by a prior middleware)
    // If body is a string, convert to Buffer
    if (typeof body === 'string') {
      req.uploadedFields = parseMultipart(Buffer.from(body), boundary);
    } else {
      return next(badRequest('Invalid body format for multipart upload'));
    }
  } else {
    req.uploadedFields = parseMultipart(body, boundary);
  }

  // Separate files from text fields
  const files: MultipartFile[] = [];
  const fields: MultipartField[] = [];

  for (const field of req.uploadedFields) {
    if ('buffer' in field && (field as MultipartFile).buffer) {
      const file = field as MultipartFile;
      // Validate file size
      if (file.size > config.maxUploadBytes) {
        return next(payloadTooLarge(`File too large. Max size: ${config.maxUploadBytes} bytes`));
      }
      // Validate file type
      if (!isValidFileType(file.filename, file.contentType, config.allowedUploadMime)) {
        return next(unsupportedMediaType(`File type not allowed: ${file.filename}`));
      }
      files.push(file);
    } else {
      fields.push(field);
    }
  }

  req.uploadedFiles = files;
  req.uploadedFields = fields;
  next();
}

/**
 * Helper: extract a text field from uploaded fields.
 */
export function getField(fields: MultipartField[] | undefined, name: string): string | undefined {
  if (!fields) return undefined;
  const field = fields.find(f => f.name === name && !('buffer' in f));
  return field ? field.value : undefined;
}

/**
 * Helper: extract a file from uploaded files.
 */
export function getFile(files: MultipartFile[] | undefined, name: string): MultipartFile | undefined {
  if (!files) return undefined;
  return files.find(f => f.name === name);
}
