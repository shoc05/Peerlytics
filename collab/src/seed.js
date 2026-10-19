// First-time seeding. A file that already has text in Firestore (written by the old sync)
// but no Yjs state yet must get that text exactly once, even when several members open it
// at the same moment. The server can't turn HTML into the editor's schema itself, so it asks
// exactly one writable client to do it with a stateless "seed" message. If that client
// leaves before the document has content, the next writable client is asked.

export const SEED_MESSAGE = JSON.stringify({ type: 'seed' });

export function createSeedCoordinator() {
  const pending = new Set();
  const seeders = new Map(); // documentName -> socketId

  function offer(name, connection) {
    if (!pending.has(name) || !connection || connection.readOnly) return false;
    pending.delete(name);
    seeders.set(name, connection.socketId);
    connection.sendStateless(SEED_MESSAGE);
    return true;
  }

  return {
    /** The document was loaded with no stored state. */
    markEmpty(name) {
      pending.add(name);
    },
    offer,
    /** A connection left. `connections` are the ones still open on the document. */
    released(name, socketId, { isEmpty, connections = [] }) {
      if (seeders.get(name) !== socketId) return;
      seeders.delete(name);
      if (!isEmpty) return;
      pending.add(name);
      for (const connection of connections) {
        if (offer(name, connection)) break;
      }
    },
    /** The document was unloaded from memory. */
    forget(name) {
      pending.delete(name);
      seeders.delete(name);
    },
    isPending: (name) => pending.has(name),
  };
}
