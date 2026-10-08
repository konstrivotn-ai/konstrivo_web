/**
 * Phase 2 — Minimal Multipart/form-data Parser
 *
 * Parses multipart/form-data from a raw Buffer body.
 * Supports text fields and file parts.
 * No external dependency (no multer required).
 */

export interface MultipartField {
  name: string;
  value: string;
  filename?: string;
  contentType?: string;
}

export interface MultipartFile extends MultipartField {
  buffer: Buffer;
  size: number;
}

export function parseMultipart(
  body: Buffer | string,
  boundary: string
): MultipartField[] {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const boundaryBuf = Buffer.from('--' + boundary);
  const fields: MultipartField[] = [];

  // Split by boundary
  const parts = splitByBoundary(buf, boundaryBuf);

  for (const part of parts) {
    if (part.length === 0) continue;

    const field = parsePart(part);
    if (field) {
      fields.push(field);
    }
  }

  return fields;
}

/** Extract the boundary from a Content-Type header. */
export function getBoundary(contentType: string): string | null {
  const match = contentType.match(/boundary=(?:(?:"([^"]+)")|([^;\s]+))/i);
  return match ? decodeURIComponent(match[1] || match[2]) : null;
}

/** Split buffer by boundary delimiter. */
function splitByBoundary(buf: Buffer, boundary: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let start = 0;
  let pos = 0;

  while (true) {
    const idx = buf.indexOf(boundary, pos);
    if (idx === -1) break;

    // Check if this is the final boundary (--boundary--)
    const afterBoundary = buf.slice(idx + boundary.length);
    if (afterBoundary.length >= 2 && afterBoundary[0] === 0x2d && afterBoundary[1] === 0x2d) {
      // This is the final boundary; everything before it is the last part
      if (idx > start) {
        parts.push(buf.slice(start, idx));
      }
      break;
    }

    if (idx > start) {
      parts.push(buf.slice(start, idx));
    }
    start = idx + boundary.length;
    pos = start;
    // Skip the CRLF after boundary
    if (buf[pos] === 0x0d && buf[pos + 1] === 0x0a) {
      pos += 2;
      start = pos;
    }
  }

  return parts.filter(p => p.length > 0);
}

function parsePart(part: Buffer): MultipartField | null {
  // Find the header/body separator (double CRLF)
  const separator = Buffer.from('\r\n\r\n');
  const sepIdx = part.indexOf(separator);
  if (sepIdx === -1) return null;

  const headerBuf = part.slice(0, sepIdx).toString('utf8');
  const bodyBuf = part.slice(sepIdx + separator.length);

  // Parse the body: remove trailing CRLF if present
  let body = bodyBuf;
  if (body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a) {
    body = bodyBuf.slice(0, -2);
  }

  const headers: Record<string, string> = {};
  const headerLines = headerBuf.split('\r\n');
  for (const line of headerLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim().toLowerCase();
      const val = line.slice(colonIdx + 1).trim();
      headers[key] = val;
    }
  }

  const disposition = headers['content-disposition'];
  if (!disposition) return null;

  const nameMatch = disposition.match(/name="([^"]+)"/);
  const filenameMatch = disposition.match(/filename="([^"]*)"/);
  const name = nameMatch ? nameMatch[1] : '';

  if (filenameMatch) {
    const file = body;
    const field: MultipartFile = {
      name,
      value: file.toString('utf8'),
      filename: filenameMatch[1],
      contentType: headers['content-type'],
      buffer: file,
      size: file.length,
    };
    return field;
  }

  return {
    name,
    value: body.toString('utf8'),
  };
}

/** Validate file type against allowed MIME types. */
export function isValidFileType(filename: string, mimeType: string | undefined, allowed: Set<string>): boolean {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'csv') return true;
  if (ext === 'xlsx' && allowed.has('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) return true;
  if (mimeType && allowed.has(mimeType)) return true;
  return false;
}
