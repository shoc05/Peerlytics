// Where each document's Yjs state lives between sessions.
// Firestore: collabDocs/{documentName} = { state: bytes, updatedAt }. Clients can't read or
// write this collection (firestore.rules); only this server does, with the Admin SDK.

// Firestore documents max out at 1 MiB; leave room for the other fields.
export const MAX_STATE_BYTES = 1_000_000;

export function createFirestoreStorage(db, { log = console } = {}) {
  const ref = (name) => db.collection('collabDocs').doc(name);
  return {
    async load(name) {
      const snap = await ref(name).get();
      const state = snap.exists ? snap.get('state') : null;
      return state ? new Uint8Array(state) : null;
    },
    async store(name, state) {
      if (state.byteLength > MAX_STATE_BYTES) {
        log.error(`[collab] ${name} is ${state.byteLength} bytes, over the ${MAX_STATE_BYTES} limit; not stored`);
        return false;
      }
      await ref(name).set({ state: Buffer.from(state), updatedAt: new Date() });
      return true;
    },
  };
}

/** In-memory storage for tests and local runs without Firebase. */
export function createMemoryStorage() {
  const docs = new Map();
  return {
    docs,
    async load(name) {
      return docs.get(name) ?? null;
    },
    async store(name, state) {
      docs.set(name, new Uint8Array(state));
      return true;
    },
  };
}
