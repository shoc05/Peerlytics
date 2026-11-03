# Peerlytics collab server (Hocuspocus + Yjs). Build from this folder:
#   docker build -t peerlytics-collab collab/
# Settings come from environment variables only; .dockerignore keeps .env and key files out.

# Stage 1: production dependencies only.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Stage 2: what runs. Files stay owned by root and read-only to the app user.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER node
EXPOSE 1234
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${COLLAB_PORT:-1234}/health" > /dev/null || exit 1
CMD ["node", "src/index.js"]
