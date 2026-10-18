import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrackingQueue, MAX_QUEUED } from './trackingQueue.js';

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function setup({ online = true, failSend = false } = {}) {
  const storage = memoryStorage();
  const sent = [];
  const state = { online, failSend, clock: 1000 };
  const queue = createTrackingQueue({
    storage,
    key: 'q',
    send: async (event) => {
      if (state.failSend) throw new Error('network');
      sent.push(event);
    },
    isOnline: () => state.online,
    now: () => state.clock,
  });
  return { storage, sent, state, queue };
}

test('online: events go straight out with their time', async () => {
  const { queue, sent, storage } = setup();
  assert.equal(await queue.track('paste', { fileId: 'f' }), 'sent');
  assert.deepEqual(sent, [{ kind: 'paste', payload: { fileId: 'f' }, at: 1000 }]);
  assert.equal(storage.map.size, 0);
});

test('offline: events wait on the device and keep their original times', async () => {
  const { queue, sent, state, storage } = setup({ online: false });
  await queue.track('paste', { fileId: 'f' });
  state.clock = 2000;
  await queue.track('version', { fileId: 'f', summary: 'Typed' });
  assert.equal(sent.length, 0);
  assert.equal(JSON.parse(storage.map.get('q')).length, 2);

  state.online = true;
  state.clock = 9000;
  assert.equal(await queue.flush(), 2);
  assert.deepEqual(sent.map((e) => [e.kind, e.at]), [['paste', 1000], ['version', 2000]]);
  assert.equal(storage.map.has('q'), false);
});

test('the queue survives a page reload', async () => {
  const first = setup({ online: false });
  await first.queue.track('metric', { edits: 1 });
  const reloaded = createTrackingQueue({
    storage: first.storage, key: 'q', send: async (e) => first.sent.push(e), isOnline: () => true,
  });
  assert.equal(reloaded.pending(), 1);
  await reloaded.flush();
  assert.deepEqual(first.sent.map((e) => e.payload), [{ edits: 1 }]);
});

test('edit and time increments made offline merge into one event', async () => {
  const { queue, sent, state } = setup({ online: false });
  await queue.track('metric', { edits: 1 });
  await queue.track('metric', { edits: 1, timeSpent: 0.5 });
  await queue.track('paste', { fileId: 'f' });
  await queue.track('metric', { timeSpent: 1 });
  state.online = true;
  await queue.flush();
  assert.deepEqual(sent.map((e) => [e.kind, e.payload]), [
    ['metric', { edits: 2, timeSpent: 0.5 }],
    ['paste', { fileId: 'f' }],
    ['metric', { timeSpent: 1 }],
  ]);
});

test('a failed send is kept and retried, in order', async () => {
  const { queue, sent, state } = setup({ failSend: true });
  assert.equal(await queue.track('paste', { n: 1 }), 'queued');
  await queue.track('paste', { n: 2 });
  assert.equal(queue.pending(), 2);
  state.failSend = false;
  await queue.flush();
  assert.deepEqual(sent.map((e) => e.payload.n), [1, 2]);
});

test('new events wait behind older queued ones', async () => {
  const { queue, sent, state } = setup({ online: false });
  await queue.track('paste', { n: 1 });
  state.online = true;
  await queue.track('paste', { n: 2 });
  await queue.flush();
  assert.deepEqual(sent.map((e) => e.payload.n), [1, 2]);
});

test('the queue is capped so a long offline spell cannot fill the device', async () => {
  const { queue } = setup({ online: false });
  for (let i = 0; i < MAX_QUEUED + 5; i += 1) await queue.track('paste', { n: i });
  assert.equal(queue.pending(), MAX_QUEUED);
});

test('broken storage does not break tracking', async () => {
  const sent = [];
  const queue = createTrackingQueue({
    storage: { getItem: () => '{oops', setItem: () => { throw new Error('full'); }, removeItem: () => {} },
    key: 'q',
    send: async (e) => sent.push(e),
    isOnline: () => true,
  });
  assert.equal(await queue.track('metric', { edits: 1 }), 'sent');
  assert.equal(sent.length, 1);
});

test('an increment queued while the previous one is being sent is not lost', async () => {
  const storage = memoryStorage();
  storage.setItem('q', JSON.stringify([{ kind: 'metric', payload: { edits: 1 }, at: 1 }]));
  const sent = [];
  const waiting = [];
  const queue = createTrackingQueue({
    storage,
    key: 'q',
    // Each send waits until the test lets it through.
    send: (event) => new Promise((resolve) => waiting.push(() => { sent.push(event); resolve(); })),
    isOnline: () => true,
  });
  const tick = () => new Promise((r) => setTimeout(r, 0));

  const flushing = queue.flush();
  await tick();
  const tracked = queue.track('metric', { edits: 1 }); // arrives while the first is in flight
  waiting.shift()();
  await tick();
  waiting.shift()();
  await Promise.all([flushing, tracked]);
  assert.equal(sent.reduce((n, e) => n + e.payload.edits, 0), 2);
  assert.equal(queue.pending(), 0);
});

test('increments for different groups never merge', async () => {
  const { queue, sent, state } = setup({ online: false });
  await queue.track('metric', { groupId: 'g1', edits: 1 });
  await queue.track('metric', { groupId: 'g1', edits: 2 });
  await queue.track('metric', { groupId: 'g2', edits: 1 });
  state.online = true;
  await queue.flush();
  assert.deepEqual(sent.map((e) => e.payload), [{ groupId: 'g1', edits: 3 }, { groupId: 'g2', edits: 1 }]);
});
