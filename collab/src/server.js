// The Hocuspocus server. Every dependency is passed in, so tests run it with fakes:
//   verifyToken(token) -> decoded Firebase ID token ({ uid, role? }), throws when invalid
//   loadRole(uid)      -> users/{uid}.role mirror for accounts without the claim (or null)
//   loadGroup(groupId), loadFile(groupId, fileId) -> Firestore data or null
//   storage            -> { load(name), store(name, state) } (storage.js)
import { Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import { decideAccess, parseDocumentName } from './access.js';
import { createSeedCoordinator } from './seed.js';
import { createCollabMetrics } from './metrics.js';

// The TipTap Collaboration extension's fragment.
export const FIELD = 'default';
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;

export function createCollabServer({
  verifyToken,
  loadRole = async () => null,
  loadGroup,
  loadFile,
  storage,
  port = 1234,
  address = '0.0.0.0',
  debounce = 2000,
  // Ping timeout for idle connections (Hocuspocus default 30 s).
  timeout = 30_000,
  log = console,
  quiet = true,
  metrics = createCollabMetrics(),
}) {
  const seeds = createSeedCoordinator();

  const server = new Hocuspocus({
    name: 'peerlytics-collab',
    port,
    address,
    debounce,
    timeout,
    quiet,
    stopOnSignals: false,

    async onRequest({ request, response }) {
      const path = (request.url || '').split('?')[0];
      if (path === '/health') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: true, service: 'peerlytics-collab' }));
      } else if (path === '/metrics') {
        const token = process.env.METRICS_TOKEN;
        if (token && request.headers.authorization !== `Bearer ${token}`) {
          response.writeHead(401);
          response.end();
        } else {
          response.writeHead(200, { 'Content-Type': metrics.registry.contentType });
          response.end(await metrics.registry.metrics());
        }
      } else {
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'Not found' }));
      }
      // A rejection with no error stops Hocuspocus's default "OK" response.
      throw null;
    },

    async onAuthenticate({ token, documentName, connection }) {
      const target = parseDocumentName(documentName);
      if (!target) {
        metrics.refused.inc({ reason: 'BAD_DOCUMENT' });
        throw new Error('BAD_DOCUMENT');
      }

      let decoded;
      try {
        decoded = await verifyToken(token);
      } catch {
        metrics.refused.inc({ reason: 'TOKEN_INVALID' });
        throw new Error('TOKEN_INVALID');
      }
      const uid = decoded?.uid;
      const role = decoded?.role ?? (uid ? await loadRole(uid) : null);
      const [group, file] = await Promise.all([loadGroup(target.groupId), loadFile(target.groupId, target.fileId)]);

      const decision = decideAccess({ uid, role, group, file });
      if (!decision.allow) {
        log.info?.(`[collab] refused uid=${uid ?? 'none'} doc=${documentName} reason=${decision.reason}`);
        metrics.refused.inc({ reason: decision.reason });
        throw new Error(decision.reason);
      }
      connection.readOnly = decision.readOnly;
      return { uid, role, readOnly: decision.readOnly };
    },

    async onLoadDocument({ documentName, document }) {
      metrics.documents.inc();
      const state = await storage.load(documentName);
      if (state && state.byteLength) Y.applyUpdate(document, state);
      else seeds.markEmpty(documentName);
      return document;
    },

    async connected({ documentName, connectionInstance }) {
      metrics.connections.inc();
      metrics.active.inc();
      seeds.offer(documentName, connectionInstance);
    },

    async onDisconnect({ documentName, document, socketId }) {
      metrics.active.dec();
      seeds.released(documentName, socketId, {
        isEmpty: document.isEmpty(FIELD),
        connections: document.getConnections().filter((c) => c.socketId !== socketId),
      });
    },

    async onStoreDocument({ documentName, document }) {
      try {
        await storage.store(documentName, Y.encodeStateAsUpdate(document));
      } catch (err) {
        metrics.storeErrors.inc();
        log.error?.(`[collab] could not store ${documentName}: ${err.message}`);
        throw err;
      }
    },

    async afterUnloadDocument({ documentName }) {
      metrics.documents.dec();
      seeds.forget(documentName);
    },
  });

  return {
    instance: server,
    seeds,
    async listen() {
      await server.listen(null, null, { maxPayload: MAX_MESSAGE_BYTES });
      return server;
    },
    get port() {
      return server.address.port;
    },
    async destroy() {
      await server.destroy();
    },
  };
}
