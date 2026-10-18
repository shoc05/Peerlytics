import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFirestoreStorage, MAX_STATE_BYTES } from './storage.js';

// Just enough of the Admin SDK's Firestore for collabDocs/{name}.
function fakeDb() {
  const rows = new Map();
  return {
    rows,
    collection: (c) => ({
      doc: (id) => ({
        get: async () => {
          const data = rows.get(`${c}/${id}`);
          return { exists: Boolean(data), get: (field) => data?.[field] };
        },
        set: async (data) => rows.set(`${c}/${id}`, data),
      }),
    }),
  };
}

test('stores Yjs state as bytes in collabDocs and reads it back', async () => {
  const db = fakeDb();
  const storage = createFirestoreStorage(db);
  assert.equal(await storage.load('group:g:file:f'), null);
  assert.equal(await storage.store('group:g:file:f', new Uint8Array([1, 2, 3])), true);
  const row = db.rows.get('collabDocs/group:g:file:f');
  assert.ok(Buffer.isBuffer(row.state));
  assert.ok(row.updatedAt instanceof Date);
  assert.deepEqual(await storage.load('group:g:file:f'), new Uint8Array([1, 2, 3]));
});

test('refuses state larger than a Firestore document can hold, and logs it', async () => {
  const db = fakeDb();
  const errors = [];
  const storage = createFirestoreStorage(db, { log: { error: (m) => errors.push(m) } });
  assert.equal(await storage.store('big', new Uint8Array(MAX_STATE_BYTES + 1)), false);
  assert.equal(db.rows.size, 0);
  assert.equal(errors.length, 1);
});
