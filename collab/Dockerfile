# Peerlytics collab server (Hocuspocus + Yjs). Build from this folder:
#   docker build -t peerlytics-collab collab/
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
USER node
EXPOSE 1234
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${COLLAB_PORT:-1234}/health || exit 1
CMD ["node", "src/index.js"]
