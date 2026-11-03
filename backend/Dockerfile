# Peerlytics API. Build from the repo root (the deadline job imports one frontend helper,
# src/utils/difficultyDetection.js, so the image keeps the repo's layout under /app):
#   docker build -f backend/Dockerfile -t peerlytics-backend .
# Settings come from environment variables only (.env.example lists them); no .env or key file
# is copied into the image (see Dockerfile.dockerignore). The same image runs the migrations:
#   docker run --rm -e DATABASE_URL=... peerlytics-backend npm run migrate:up

# Stage 1: production dependencies only. npm's cache and the lock-file install stay here.
FROM node:22-alpine AS deps
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Stage 2: what runs. Files stay owned by root and read-only to the app user.
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=5000
WORKDIR /app/backend
COPY --from=deps /app/backend/node_modules ./node_modules
COPY backend/ ./
COPY src/utils/difficultyDetection.js /app/src/utils/difficultyDetection.js
# The root package.json is "type": "module"; this stands in for it so the helper loads as ESM.
RUN echo '{ "type": "module" }' > /app/package.json
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" > /dev/null || exit 1
CMD ["node", "server.js"]
