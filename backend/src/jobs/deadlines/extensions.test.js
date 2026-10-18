import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import express from 'express';
import { fakeAuth } from '../../auth/testFakes.js';
import { createExtensionRouter } from './extensions.js';
import { fakeFirestore } from './fakeFirestore.js';
import { isDue } from './time.js';

const NOW = Date.UTC(2026, 9, 20, 6, 0);
const TOKENS = {
  lec: { uid: 'lec-1', role: 'lecturer' },
  other: { uid: 'lec-2', role: 'lecturer' },
  stu: { uid: 'stu-1', role: 'student' },
};
let clients;
let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', createExtensionRouter({ getClients: () => clients, now: () => NOW, timeZone: 'Asia/Thimphu' }));
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function setup(group = {}) {
  const db = fakeFirestore({
    'groups/g1': { name: 'G1', memberIds: ['stu-1'], lecturerIds: ['lec-1'], deadline: '2026-10-20T18:00:00.000Z', ...group },
  });
  clients = { auth: fakeAuth({ tokens: TOKENS }), db };
  return db;
}

async function extend(token, body, groupId = 'g1') {
  const res = await fetch(`${baseUrl}/api/groups/${groupId}/extension`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const LATER = '2026-10-23T18:00:00+06:00';

test('a lecturer of the group extends it; the lock, audit log and activity follow', async () => {
  const db = setup();
  const res = await extend('lec', { deadline: LATER, reason: 'Two members were ill this week' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    groupId: 'g1',
    deadline: '2026-10-23T12:00:00.000Z',
    previous: '2026-10-20T18:00:00.000Z',
    reason: 'Two members were ill this week',
  });

  const group = db.store.get('groups/g1');
  assert.equal(group.extendedDeadline, '2026-10-23T12:00:00.000Z');
  assert.deepEqual(group.extension, {
    deadline: '2026-10-23T12:00:00.000Z',
    previous: '2026-10-20T18:00:00.000Z',
    reason: 'Two members were ill this week',
    by: 'lec-1',
    at: new Date(NOW).toISOString(),
  });
  // The server lock now waits for the new deadline.
  assert.equal(isDue(group, Date.UTC(2026, 9, 20, 18, 30)), false);
  assert.equal(isDue(group, Date.UTC(2026, 9, 23, 12, 0)), true);

  const audit = [...db.store.entries()].filter(([k]) => k.startsWith('auditLog/')).map(([, v]) => v);
  assert.deepEqual(audit, [{
    action: 'deadline.extended', actorUid: 'lec-1', groupId: 'g1',
    from: '2026-10-20T18:00:00.000Z', to: '2026-10-23T12:00:00.000Z',
    reason: 'Two members were ill this week', at: new Date(NOW).toISOString(),
  }]);
  assert.equal([...db.store.keys()].filter((k) => k.startsWith('groups/g1/activity/')).length, 1);
});

test('a second extension records the first one as the previous deadline', async () => {
  const db = setup({ extendedDeadline: '2026-10-22T00:00:00.000Z' });
  const res = await extend('lec', { deadline: LATER, reason: 'Power cut in the hostel' });
  assert.equal(res.body.previous, '2026-10-22T00:00:00.000Z');
  assert.equal(db.store.get('groups/g1').extension.previous, '2026-10-22T00:00:00.000Z');
});

test('refused: students, other lecturers, no token, unknown or locked workspaces', async () => {
  setup();
  assert.equal((await extend(null, { deadline: LATER, reason: 'Because' })).status, 401);
  assert.equal((await extend('stu', { deadline: LATER, reason: 'Because' })).status, 403);
  assert.equal((await extend('other', { deadline: LATER, reason: 'Because' })).body.code, 'FORBIDDEN');
  assert.equal((await extend('lec', { deadline: LATER, reason: 'Because' }, 'nope')).status, 404);
  setup({ locked: true });
  assert.equal((await extend('lec', { deadline: LATER, reason: 'Because' })).body.code, 'ALREADY_LOCKED');
});

test('the body is checked: a real future instant and a reason', async () => {
  const db = setup();
  for (const body of [
    { deadline: '2026-10-23T18:00', reason: 'No offset given' },
    { deadline: 'next week', reason: 'Not a date' },
    { deadline: LATER, reason: 'no' },
    { deadline: LATER },
    { deadline: LATER, reason: 'Fine reason', extra: true },
  ]) {
    assert.equal((await extend('lec', body)).body.code, 'INVALID_BODY', JSON.stringify(body));
  }
  assert.equal((await extend('lec', { deadline: '2026-10-20T06:00:30Z', reason: 'Already passed' })).body.code, 'DEADLINE_IN_PAST');
  assert.equal(db.store.get('groups/g1').extendedDeadline, undefined);
});
