// In-memory stand-ins for firebase-admin Auth and Firestore, used by the unit tests only.
// The emulator test (auth.emulator.itest.js) exercises the real SDK.

function authError(code) {
  return Object.assign(new Error(code), { code });
}

/** tokens: { [idToken]: decodedClaims | errorCode } */
export function fakeAuth({ users = {}, tokens = {} } = {}) {
  const calls = { setCustomUserClaims: [], revokeRefreshTokens: [] };
  return {
    calls,
    users,
    async verifyIdToken(token, checkRevoked) {
      if (checkRevoked !== true) throw new Error('verifyIdToken must be called with checkRevoked=true');
      const entry = tokens[token];
      if (!entry) throw authError('auth/argument-error');
      if (typeof entry === 'string') throw authError(entry);
      return entry;
    },
    async getUser(uid) {
      if (!users[uid]) throw authError('auth/user-not-found');
      return { uid, customClaims: users[uid].customClaims };
    },
    async setCustomUserClaims(uid, claims) {
      calls.setCustomUserClaims.push({ uid, claims });
      users[uid] = { ...users[uid], customClaims: claims };
    },
    async revokeRefreshTokens(uid) {
      calls.revokeRefreshTokens.push(uid);
    },
  };
}

export function fakeDb(initial = {}) {
  const store = new Map(Object.entries(initial)); // 'users/uid' -> data
  const snapshot = (id, key) => ({
    id,
    exists: store.has(key),
    get: (field) => store.get(key)?.[field],
  });
  const docRef = (col, id) => ({
    key: `${col}/${id}`,
    id,
    async set(data, opts) {
      store.set(this.key, opts?.merge ? { ...store.get(this.key), ...data } : { ...data });
    },
  });
  return {
    store,
    collection(col) {
      return {
        doc: (id) => docRef(col, id),
        async get() {
          const docs = [...store.keys()]
            .filter((k) => k.startsWith(`${col}/`))
            .map((k) => snapshot(k.slice(col.length + 1), k));
          return { docs };
        },
      };
    },
    async runTransaction(fn) {
      const writes = [];
      const tx = {
        get: async (ref) => snapshot(ref.id, ref.key),
        set: (ref, data, opts) => writes.push(() => ref.set(data, opts)),
      };
      const out = await fn(tx);
      for (const w of writes) await w();
      return out;
    },
  };
}
