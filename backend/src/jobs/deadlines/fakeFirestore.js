// In-memory stand-in for the firebase-admin Firestore subset the deadline job uses. Unit tests
// only; deadlines.emulator.itest.js runs the same job against the real emulator.

function setPath(obj, dotted, value) {
  const keys = dotted.split('.');
  let cur = obj;
  for (const k of keys.slice(0, -1)) {
    cur[k] = cur[k] && typeof cur[k] === 'object' ? { ...cur[k] } : {};
    cur = cur[k];
  }
  cur[keys.at(-1)] = value;
}

export function fakeFirestore(seed = {}) {
  const store = new Map(); // 'groups/g1/files/f1' -> data
  for (const [path, data] of Object.entries(seed)) store.set(path, structuredClone(data));
  let autoId = 0;

  const snapshot = (path) => ({
    id: path.split('/').at(-1),
    exists: store.has(path),
    data: () => (store.has(path) ? structuredClone(store.get(path)) : undefined),
    get: (field) => store.get(path)?.[field],
  });

  const docRef = (path) => ({
    path,
    id: path.split('/').at(-1),
    collection: (name) => collectionRef(`${path}/${name}`),
    async get() {
      return snapshot(path);
    },
    async set(data, opts) {
      const prev = opts?.merge ? store.get(path) || {} : {};
      store.set(path, { ...prev, ...structuredClone(data) });
    },
    async update(data) {
      if (!store.has(path)) throw Object.assign(new Error(`No document to update: ${path}`), { code: 5 });
      const next = structuredClone(store.get(path));
      for (const [k, v] of Object.entries(data)) setPath(next, k, structuredClone(v));
      store.set(path, next);
    },
  });

  const isDirectChild = (path, col) =>
    path.startsWith(`${col}/`) && !path.slice(col.length + 1).includes('/');

  const collectionRef = (col, filters = []) => ({
    doc: (id) => docRef(`${col}/${id}`),
    async add(data) {
      autoId += 1;
      const ref = docRef(`${col}/auto${autoId}`);
      await ref.set(data);
      return ref;
    },
    where: (field, op, value) => {
      if (op !== '==') throw new Error(`fakeFirestore supports only ==, got ${op}`);
      return collectionRef(col, [...filters, [field, value]]);
    },
    async get() {
      const docs = [...store.keys()]
        .filter((p) => isDirectChild(p, col))
        .filter((p) => filters.every(([f, v]) => store.get(p)[f] === v))
        .map(snapshot);
      return { docs, size: docs.length };
    },
  });

  return {
    store,
    collection: (name) => collectionRef(name),
    doc: (path) => docRef(path),
    async runTransaction(fn) {
      const writes = [];
      const tx = {
        get: (ref) => ref.get(),
        update: (ref, data) => writes.push(() => ref.update(data)),
        set: (ref, data, opts) => writes.push(() => ref.set(data, opts)),
      };
      const out = await fn(tx);
      for (const w of writes) await w();
      return out;
    },
  };
}
