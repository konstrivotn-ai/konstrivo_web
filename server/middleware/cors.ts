import cors from 'cors';
import express from 'express';
import { config } from '../config';

export function applyCors(app: express.Express) {
  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
  const allowedHeaders = ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Requested-With'];

  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) {
    const raw = process.env.CORS_ALLOWED_ORIGINS;
    if (!raw) {
      throw new Error('[KONSTRIVO] FATAL: CORS_ALLOWED_ORIGINS must be set in production');
    }
    const origins = raw.split(',').map(s => s.trim()).filter(Boolean);
    const opts = {
      origin: (origin, cb) => {
        if (!origin) return cb(null, false); // no origin (curl/postman) -> do not set
        if (origins.includes(origin)) return cb(null, true);
        return cb(null, false);
      },
      methods,
      allowedHeaders,
      optionsSuccessStatus: 204,
      credentials: true,
    };
    app.use(cors(opts));
  } else {
    // In development/test reflect origin to allow browser-like requests
    const opts = {
      origin: true,
      methods,
      allowedHeaders,
      optionsSuccessStatus: 204,
      credentials: true,
    };
    app.use(cors(opts));
  }
}

export default applyCors;
