import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFlagMirror } from './firestoreMirror.js';

function fakeClients({ fail = false } = {}) {
  const writes = [];
  return {
    writes,
    db: {
      collection: (name) => ({
        doc: (id) => ({
          set: async (data, options) => {
            if (fail) throw new Error('Firestore is down');
            writes.push({ path: `${name}/${id}`, data, options });
          },
        }),
      }),
    },
  };
}

test('it writes the flag to config/flags, keeping any other fields', async () => {
  const clients = fakeClients();
  const mirror = createFlagMirror({ getClients: () => clients, read: async () => true });
  assert.equal(await mirror.sync(), true);
  assert.equal(clients.writes[0].path, 'config/flags');
  assert.equal(clients.writes[0].data.courses_v2, true);
  assert.deepEqual(clients.writes[0].options, { merge: true });
});

test('it writes only when the value changes', async () => {
  const clients = fakeClients();
  let value = false;
  const mirror = createFlagMirror({ getClients: () => clients, read: async () => value });
  await mirror.sync();
  assert.equal(await mirror.sync(), false);
  value = true;
  assert.equal(await mirror.sync(), true);
  assert.deepEqual(clients.writes.map((w) => w.data.courses_v2), [false, true]);
});

test('it does nothing without the Admin SDK', async () => {
  const mirror = createFlagMirror({ getClients: () => null, read: async () => true });
  assert.equal(await mirror.sync(), false);
});

test('a failed write is logged, never thrown, and tried again', async () => {
  const logs = [];
  let clients = fakeClients({ fail: true });
  const mirror = createFlagMirror({ getClients: () => clients, read: async () => true, log: (m) => logs.push(m) });
  assert.equal(await mirror.sync(), false);
  assert.match(logs[0], /could not update config\/flags/);
  clients = fakeClients();
  assert.equal(await mirror.sync(), true);
});
