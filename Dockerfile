# ── KONSTRIVO PRO — Cloudflare Containers image ──────────────────────────────────────
# Runs the UNCHANGED Express server (`dist/server.cjs`, produced by `npm run build`)
# on a full Linux + Node 22 runtime. No business logic, routes, services or DB schema
# changes live in this file — it is only the runtime envelope for the existing app.
#
# The container talks to Supabase DIRECTLY over TCP with its own `DATABASE_URL`
# (Hyperdrive is a Workers-runtime binding and is not available inside containers).
# Secrets/env vars are injected by the Worker at container start (envVars in
# worker-entry.ts) — nothing secret is baked into the image.
FROM node:22-alpine

WORKDIR /app

# 1) Install production dependencies only (cached layer — package files change rarely).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# 2) Copy the prebuilt artifacts produced on the host by:
#      npm run build   → dist/server.cjs  (Express app, CJS, packages external)
#      vite build      → dist/*           (SPA assets, served by Static Assets,
#                                          NOT by this container)
#    esbuild with `--packages=external` keeps node_modules outside the bundle, which is
#    exactly what a real Node runtime wants.
COPY dist/server.cjs ./dist/server.cjs

# Non-root user (Containers run without root privileges) + writable tmp for uploads.
RUN addgroup -S app && adduser -S app -G app \
    && mkdir -p /app/server/data \
    && chown -R app:app /app
USER app

ENV NODE_ENV=production \
    PORT=8080

EXPOSE 8080

# Graceful shutdown: Workers sends SIGTERM and waits up to 15 minutes.
CMD ["node", "dist/server.cjs"]
