import express from 'express';

export function applySecurityHeaders(app: express.Express) {
  app.use((req, res, next) => {
    // Basic security headers
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

    // HSTS: only in production and when served over HTTPS by the deployment
    if (process.env.NODE_ENV === 'production') {
      // 180 days
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains; preload');
    }

    // Content Security Policy
    // In production be strict; in dev allow eval/inline for tooling (Vite HMR)
    const isProd = process.env.NODE_ENV === 'production';

    // Sources
    const scriptSrc = ["'self'"];
    const styleSrc = ["'self'", "'unsafe-inline'"];
    const imgSrc = ["'self'", 'data:', 'https://images.unsplash.com'];
    const connectSrc = ["'self'"];

    if (!isProd) {
      // Vite dev server uses eval and websocket HMR
      scriptSrc.push("'unsafe-eval'");
      scriptSrc.push("'unsafe-inline'");
      connectSrc.push('ws:', 'ws://localhost', 'http://localhost');
    }

    // Build CSP string
    const csp = [
      `default-src 'self'`,
      `script-src ${scriptSrc.join(' ')}`,
      `style-src ${styleSrc.join(' ')}`,
      `img-src ${imgSrc.join(' ')}`,
      `connect-src ${connectSrc.join(' ')}`,
      "font-src 'self' data:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');

    res.setHeader('Content-Security-Policy', csp);
    next();
  });
}

export default applySecurityHeaders;
