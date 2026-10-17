// The deadline sweep against the real Firestore emulator through the Admin SDK. Run from the
// repo root:
//   npx firebase emulators:exec --only firestore --project demo-peerlytics "node --test backend/src/jobs/deadlines/deadlines.emulator.itest.js"
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { getDeadlineDb } from './firestore.js';
import { runDeadlineSweep } from './job.js';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Run this inside `firebase emulators:exec --only firestore` (see the header).');
}

const DEADLINE = Date.UTC(2026, 9, 20, 18, 0);
const TEXT = 'Our group report on renewable energy in Bhutan and its hydropower future.';
let db;

before(async () => {
  db = getDeadlineDb();
  const projectId = process.env.GCLOUD_PROJECT || 'demo-peerlytics';
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, {
    method: 'DELETE',
  });
  const g = db.collection('groups').doc('itest-g');
  // Zone-less datetime-local value, as group creation stores it: 21 Oct 00:00 in Thimphu.
  await g.set({ name: 'Itest', deadline: '2026-10-21T00:00', memberIds: ['s1', 'l1'], lecturerIds: ['l1'], submittedToLecturers: [] });
  await g.collection('files').doc('f1').set({ name: 'Report', type: 'document', submitted: false });
  await db.collection('documents').doc('f1').set({ fileId: 'f1', groupId: 'itest-g', text: TEXT, html: `<p>${TEXT}</p>` });
  await g.collection('pasteEvents').add({ fileId: 'f1', userId: 's1', changeType: 'paste', contentSnippet: 'hydropower', timestamp: 1 });
  await g.collection('versions').add({ fileId: 'f1', timestamp: 2, content: TEXT });
});

test('sweeps, submits and locks with the real Admin SDK; a second sweep does nothing', async () => {
  const calls = [];
  const analyze = async (input) => {
    calls.push(input);
    return { report: { id: 'r1', scores: { aiUsageScore: 5 }, feedback: {} } };
  };

  assert.deepEqual(await runDeadlineSweep({ db, analyze, nowMs: DEADLINE - 1000 }), []);
  const [result] = await runDeadlineSweep({ db, analyze, nowMs: DEADLINE });
  assert.deepEqual(result.submittedFileIds, ['f1']);
  assert.equal(calls[0].pasteEvents.length, 1);
  assert.equal(calls[0].versions.length, 1);

  const group = (await db.collection('groups').doc('itest-g').get()).data();
  assert.equal(group.locked, true);
  assert.equal(group.lockedDeadline, new Date(DEADLINE).toISOString());
  assert.deepEqual(group.submittedToLecturers, ['l1']);
  assert.equal(group.autoSubmit.status, 'done');

  const sub = (await db.collection('submissions').doc('auto_itest-g_f1').get()).data();
  assert.equal(sub.submittedBy, 'deadline');
  assert.equal(sub.lecturerId, 'l1');
  assert.equal(typeof sub.createdAt.toMillis, 'function'); // stored as a Firestore Timestamp
  assert.equal((await db.collection('reports').doc('auto_itest-g_f1').get()).data().pasteEvents[0].userId, 's1');
  assert.equal((await db.doc('groups/itest-g/files/f1').get()).data().submitted, true);

  assert.deepEqual(await runDeadlineSweep({ db, analyze, nowMs: DEADLINE + 60_000 }), []);
  assert.equal(calls.length, 1);
});

test('a failed run is recorded with a dotted-path update and retried', async () => {
  const g = db.collection('groups').doc('itest-fail');
  await g.set({ name: 'Fail', deadline: new Date(DEADLINE).toISOString(), lecturerIds: [] });
  await g.collection('files').doc('f2').set({ name: 'Doc', type: 'document', submitted: false });
  await db.collection('documents').doc('f2').set({ fileId: 'f2', groupId: 'itest-fail', text: TEXT });

  // The real db, except that writing a report fails.
  const broken = {
    collection: (name) => {
      if (name === 'reports') throw new Error('Firestore unavailable');
      return db.collection(name);
    },
    doc: (path) => db.doc(path),
    runTransaction: (fn) => db.runTransaction(fn),
  };
  const [first] = await runDeadlineSweep({ db: broken, analyze: async () => ({ report: { id: 'x' } }), nowMs: DEADLINE });
  assert.ok(first.error);
  const failed = (await g.get()).data();
  assert.equal(failed.autoSubmit.status, 'failed');
  assert.equal(failed.autoSubmit.attempts, 1);
  assert.equal(failed.locked, undefined);

  await runDeadlineSweep({ db, analyze: async () => ({ report: { id: 'x' } }), nowMs: DEADLINE + 60_000 });
  const done = (await g.get()).data();
  assert.equal(done.locked, true);
  assert.equal(done.autoSubmit.attempts, 2);
});
