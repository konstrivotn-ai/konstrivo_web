# Portable KONSTRIVO production image: build the frontend and Express server in Docker.
# Configure DATABASE_URL, JWT_SECRET, and other secrets in the hosting provider's
# environment settings. Never bake secrets or a production .env file into this image.

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Source directories must remain in the Docker build context (see .dockerignore).
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && addgroup -S app \
    && adduser -S app -G app \
    && mkdir -p /app/server/data \
    && chown -R app:app /app

# Include both the Express server bundle and Vite's index.html/assets.
COPY --from=build --chown=app:app /app/dist ./dist

USER app
EXPOSE 8080
CMD ["node", "dist/server.cjs"]
