import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import { CLAIM_LEASE_MS, claimGroup, runDeadlineSweep, startDeadlineJob } from './job.js';
import { fakeFirestore } from './fakeFirestore.js';
import { fakePostgres } from './fakePostgres.js';

const DEADLINE = Date.UTC(2026, 9, 20, 18, 0); // 21 Oct 00:00 in Thimphu
const TEXT = 'Our group report on renewable energy in Bhutan and its hydropower future.';

function seed(groupExtra = {}) {
  return fakeFirestore({
    'groups/g1': {
      name: 'Energy report',
      deadline: new Date(DEADLINE).toISOString(),
      memberIds: ['stu1', 'stu2', 'lec1'],
      lecturerIds: ['lec1'],
      submittedToLecturers: [],
      ...groupExtra,
    },
    'groups/g1/files/f1': { name: 'Report', type: 'document', submitted: false },
    'groups/g1/files/f2': { name: 'Already in', type: 'document', submitted: true },
    'groups/g1/files/f3': { name: 'Empty', type: 'document', submitted: false },
    'documents/f1': { fileId: 'f1', groupId: 'g1', html: `<p>${TEXT}</p>`, text: TEXT },
    'documents/f3': { fileId: 'f3', groupId: 'g1', html: '<p>hi</p>', text: 'hi' },
    'groups/g1/pasteEvents/p1': { fileId: 'f1', userId: 'stu2', changeType: 'paste-large', contentSnippet: 'hydropower future', timestamp: 2 },
    'groups/g1/pasteEvents/p2': { fileId: 'other', userId: 'stu1', changeType: 'paste', contentSnippet: 'x', timestamp: 3 },
    'groups/g1/versions/v1': { fileId: 'f1', timestamp: 1, content: 'Our group' },
    'groups/g1/versions/v2': { fileId: 'f1', timestamp: 5, content: TEXT },
    'analytics/g1/members/stu1': { edits: 10 },
    // A second group with a later deadline must not be touched.
    'groups/g2': { name: 'Later', deadline: new Date(DEADLINE + 86_400_000).toISOString(), lecturerIds: ['lec1'] },
    'groups/g2/files/f9': { name: 'Draft', type: 'document', submitted: false },
    'documents/f9': { fileId: 'f9', groupId: 'g2', text: TEXT },
  });
}

function fakeAnalyze() {
  const calls = [];
  const analyze = async (input) => {
    calls.push(input);
    return { report: { id: 'report-123', scores: { aiUsageScore: 12, plagiarismScore: 30 }, feedback: { summary: 'ok' } } };
  };
  return { analyze, calls };
}

const get = (db, path) => db.store.get(path);

describe('runDeadlineSweep', () => {
  test('does nothing before the deadline', async () => {
    const db = seed();
    const { analyze, calls } = fakeAnalyze();
    assert.deepEqual(await runDeadlineSweep({ db, analyze, nowMs: DEADLINE - 1 }), []);
    assert.equal(calls.length, 0);
    assert.equal(get(db, 'groups/g1').locked, undefined);
  });

  test('at the deadline it submits unsubmitted files the way the app does, then locks', async () => {
    const db = seed();
    const { analyze, calls } = fakeAnalyze();
    const [result] = await runDeadlineSweep({ db, analyze, nowMs: DEADLINE });

    assert.deepEqual(result.submittedFileIds, ['f1']);
    assert.deepEqual(result.skippedFileIds, ['f3']); // under 10 characters
    assert.equal(calls.length, 1);
    assert.equal(calls[0].text, TEXT);
    assert.deepEqual(calls[0].pasteEvents.map((p) => p.id), ['p1']);
    assert.deepEqual(calls[0].versions.map((v) => v.id), ['v2', 'v1']); // newest first

    const report = get(db, 'reports/auto_g1_f1');
    assert.equal(report.id, 'auto_g1_f1');
    assert.equal(report.userId, 'deadline');
    assert.equal(report.autoSubmitted, true);
    assert.equal(report.groupId, 'g1');
    assert.equal(report.aiScore, 12);
    assert.equal(report.plagiarismScore, 30);
    // Each paste keeps its author, so penalties still go to the student responsible.
    assert.equal(report.pasteEvents[0].userId, 'stu2');

    const sub = get(db, 'submissions/auto_g1_f1');
    assert.equal(sub.lecturerId, 'lec1');
    assert.equal(sub.submittedBy, 'deadline');
    assert.equal(sub.reportId, 'auto_g1_f1');
    assert.equal(sub.documentContent.text, TEXT);
    assert.equal(get(db, 'submissions/f1_deadline').locked, true);

    assert.equal(get(db, 'groups/g1/files/f1').submitted, true);
    assert.equal(get(db, 'groups/g1/files/f1').autoSubmitted, true);
    assert.equal(get(db, 'groups/g1/files/f3').submitted, false);
    assert.equal(get(db, 'groups/g1/files/f2').autoSubmitted, undefined);
    assert.equal(get(db, 'groups/g1/notifications/auto_f1_lec1').lecturerId, 'lec1');
    assert.match(get(db, 'groups/g1/activity/auto_f1').action, /at the deadline/);

    const group = get(db, 'groups/g1');
    assert.equal(group.locked, true);
    assert.equal(group.lockedBy, 'deadline');
    assert.equal(group.lockedAt, new Date(DEADLINE).toISOString());
    assert.deepEqual(group.submittedToLecturers, ['lec1']);
    assert.equal(group.autoSubmit.status, 'done');

    assert.equal(get(db, 'groups/g2').locked, undefined);
  });

  test('a second sweep after locking is a no-op', async () => {
    const db = seed();
    const { analyze, calls } = fakeAnalyze();
    await runDeadlineSweep({ db, analyze, nowMs: DEADLINE });
    const before = JSON.stringify([...db.store]);
    assert.deepEqual(await runDeadlineSweep({ db, analyze, nowMs: DEADLINE + 60_000 }), []);
    assert.equal(calls.length, 1);
    assert.equal(JSON.stringify([...db.store]), before);
  });

  test('uses the extended deadline when there is one', async () => {
    const extended = DEADLINE + 2 * 3600_000;
    const db = seed({ extendedDeadline: new Date(extended).toISOString() });
    const { analyze } = fakeAnalyze();
    assert.deepEqual(await runDeadlineSweep({ db, analyze, nowMs: DEADLINE + 60_000 }), []);
    assert.equal(get(db, 'groups/g1').locked, undefined);
    await runDeadlineSweep({ db, analyze, nowMs: extended });
    assert.equal(get(db, 'groups/g1').locked, true);
    assert.equal(get(db, 'groups/g1').lockedDeadline, new Date(extended).toISOString());
  });

  test('if analysis fails, the work is still submitted with the "AI evaluation unavailable" report', async () => {
    const db = seed();
    const analyze = async () => {
      throw new Error('Hugging Face down');
    };
    const logs = [];
    await runDeadlineSweep({ db, analyze, nowMs: DEADLINE, log: (l) => logs.push(l) });
    const report = get(db, 'reports/auto_g1_f1');
    assert.equal(report.aiEvaluation, 'unavailable');
    assert.equal(report.suggestedGrade, null);
    assert.equal(report.meta.pasteEventCount, 1);
    assert.equal(get(db, 'submissions/auto_g1_f1').status, 'submitted');
    assert.equal(get(db, 'groups/g1').locked, true);
    assert.ok(logs.some((l) => l.includes('analysis failed')));
  });

  test('one submission per lecturer when a group has several', async () => {
    const db = seed({ lecturerIds: ['lec1', 'lec2'] });
    await runDeadlineSweep({ db, analyze: fakeAnalyze().analyze, nowMs: DEADLINE });
    assert.equal(get(db, 'submissions/auto_g1_f1_lec1').parentSubmissionId, 'auto_g1_f1');
    assert.equal(get(db, 'submissions/auto_g1_f1_lec2').lecturerId, 'lec2');
    assert.deepEqual(get(db, 'groups/g1').submittedToLecturers, ['lec1', 'lec2']);
  });

  test('a group without a lecturer is still submitted and locked', async () => {
    const db = seed({ lecturerIds: [] });
    await runDeadlineSweep({ db, analyze: fakeAnalyze().analyze, nowMs: DEADLINE });
    assert.equal(get(db, 'submissions/auto_g1_f1').lecturerId, null);
    assert.equal(get(db, 'groups/g1').locked, true);
    assert.deepEqual(get(db, 'groups/g1').submittedToLecturers, []);
  });

  test('a storage error is recorded and the group is retried on the next sweep', async () => {
    const db = seed();
    const realCollection = db.collection;
    let fail = true;
    db.collection = (name) => {
      if (name === 'reports' && fail) throw new Error('Firestore unavailable');
      return realCollection(name);
    };
    const [first] = await runDeadlineSweep({ db, analyze: fakeAnalyze().analyze, nowMs: DEADLINE });
    assert.equal(first.error, 'Firestore unavailable');
    assert.equal(get(db, 'groups/g1').autoSubmit.status, 'failed');
    assert.equal(get(db, 'groups/g1').locked, undefined);

    fail = false;
    await runDeadlineSweep({ db, analyze: fakeAnalyze().analyze, nowMs: DEADLINE + 60_000 });
    assert.equal(get(db, 'groups/g1').locked, true);
    assert.equal(get(db, 'groups/g1').autoSubmit.attempts, 2);
  });
});

describe('runDeadlineSweep with PostgreSQL', () => {
  // The assignment deadline in PostgreSQL is an hour after the old Firestore field on g1.
  const PG_DEADLINE = DEADLINE + 3600_000;
  const workspace = (extra = {}) => ({ g1: { status: 'open', deadlineMs: PG_DEADLINE, memberIds: ['stu2', 'stu1'], ...extra } });

  test('a course workspace follows the PostgreSQL deadline, not the Firestore field', async () => {
    const db = seed();
    const pg = fakePostgres(workspace());
    const { analyze, calls } = fakeAnalyze();

    assert.deepEqual(await runDeadlineSweep({ db, pg, analyze, nowMs: DEADLINE + 60_000 }), []);
    assert.equal(get(db, 'groups/g1').locked, undefined);
    assert.equal(pg.rows.get('g1').status, 'open');

    const [result] = await runDeadlineSweep({ db, pg, analyze, nowMs: PG_DEADLINE });
    assert.deepEqual(result.submittedFileIds, ['f1']);
    assert.deepEqual(result.postgres, { status: 'locked', submissionId: 'sub1' });
    assert.equal(calls.length, 1);
    assert.equal(get(db, 'groups/g1').locked, true);
    assert.equal(get(db, 'groups/g1').lockedDeadline, new Date(PG_DEADLINE).toISOString());
    assert.equal(get(db, 'reports/auto_g1_f1').userId, 'deadline');
  });

  test('the submission row holds the latest submitted file and counts only, never text', async () => {
    const db = seed();
    const pg = fakePostgres(workspace());
    await runDeadlineSweep({ db, pg, analyze: fakeAnalyze().analyze, nowMs: PG_DEADLINE });

    const row = pg.submissions.get('g1');
    assert.equal(row.trigger, 'deadline');
    assert.equal(row.submittedBy, null);
    assert.equal(row.submittedAtMs, PG_DEADLINE);
    assert.equal(row.documentRef, 'groups/g1/files/f1');
    assert.equal(row.wordCount, 12);
    assert.deepEqual(row.authorMetrics, {
      stu1: { timeSpentSec: 0, edits: 10, pasteEvents: 1, largePastes: 0, tabEdits: {} },
      stu2: { timeSpentSec: 0, edits: 0, pasteEvents: 1, largePastes: 1, tabEdits: {} },
    });
    assert.doesNotMatch(JSON.stringify(row), /hydropower|renewable/);

    assert.equal(pg.rows.get('g1').status, 'locked');
    assert.deepEqual(pg.auditLog, [
      {
        actorId: null,
        action: 'workspace.locked',
        targetType: 'workspace',
        targetId: 'g1',
        details: { trigger: 'deadline', deadline: new Date(PG_DEADLINE).toISOString(), extended: false, submissionId: 'sub1', documentRef: 'groups/g1/files/f1' },
      },
    ]);
  });

  test("the group's latest extension in PostgreSQL moves the lock", async () => {
    const extended = PG_DEADLINE + 2 * 3600_000;
    const db = seed();
    const pg = fakePostgres(workspace({ extensions: [PG_DEADLINE + 3600_000, extended] }));
    const { analyze } = fakeAnalyze();

    assert.deepEqual(await runDeadlineSweep({ db, pg, analyze, nowMs: PG_DEADLINE + 3600_000 }), []);
    assert.equal(pg.rows.get('g1').status, 'open');

    await runDeadlineSweep({ db, pg, analyze, nowMs: extended });
    assert.equal(pg.rows.get('g1').status, 'locked');
    assert.equal(pg.auditLog[0].details.extended, true);
    assert.equal(get(db, 'groups/g1').lockedDeadline, new Date(extended).toISOString());
  });

  test('a workspace a member already submitted is left alone', async () => {
    const db = seed();
    const pg = fakePostgres(workspace({ status: 'submitted' }));
    const before = JSON.stringify([...db.store]);
    const { analyze, calls } = fakeAnalyze();
    assert.deepEqual(await runDeadlineSweep({ db, pg, analyze, nowMs: PG_DEADLINE + 60_000 }), []);
    assert.equal(calls.length, 0);
    assert.equal(JSON.stringify([...db.store]), before);
    assert.equal(pg.auditLog.length, 0);
  });

  test('if PostgreSQL fails after the Firestore submit, the next tick finishes without submitting twice', async () => {
    const db = seed();
    const pg = fakePostgres(workspace());
    pg.failNextLock = new Error('connection terminated');
    const { analyze, calls } = fakeAnalyze();
    const logs = [];

    const [first] = await runDeadlineSweep({ db, pg, analyze, nowMs: PG_DEADLINE, log: (l) => logs.push(l) });
    assert.equal(first.error, 'connection terminated');
    assert.equal(pg.rows.get('g1').status, 'open');
    assert.equal(get(db, 'groups/g1').autoSubmit.status, 'failed');
    assert.ok(logs.some((l) => l.includes('will retry')));

    const [second] = await runDeadlineSweep({ db, pg, analyze, nowMs: PG_DEADLINE + 60_000 });
    assert.deepEqual(second.submittedFileIds, []); // f1 was already submitted on the first tick
    assert.equal(second.postgres.status, 'locked');
    assert.equal(calls.length, 1);
    assert.equal(pg.rows.get('g1').status, 'locked');
    assert.equal(pg.submissions.get('g1').documentRef, 'groups/g1/files/f1');
    assert.equal(get(db, 'groups/g1').autoSubmit.attempts, 2);
  });

  test('a run holding the claim is not interrupted', async () => {
    const db = seed({ autoSubmit: { status: 'running', claimedAtMs: PG_DEADLINE } });
    const pg = fakePostgres(workspace());
    assert.deepEqual(await runDeadlineSweep({ db, pg, analyze: fakeAnalyze().analyze, nowMs: PG_DEADLINE + 60_000 }), []);
    assert.equal(pg.rows.get('g1').status, 'open');
  });

  test('a group with nothing worth submitting is still locked, without a submission row', async () => {
    const db = seed();
    db.store.set('groups/g1/files/f1', { name: 'Report', type: 'document', submitted: false });
    db.store.set('documents/f1', { text: 'tiny' });
    db.store.delete('groups/g1/files/f2');
    const pg = fakePostgres(workspace());

    const [result] = await runDeadlineSweep({ db, pg, analyze: fakeAnalyze().analyze, nowMs: PG_DEADLINE });
    assert.deepEqual(result.skippedFileIds.sort(), ['f1', 'f3']);
    assert.deepEqual(result.postgres, { status: 'locked', submissionId: null });
    assert.equal(pg.submissions.size, 0);
    assert.equal(pg.auditLog[0].details.documentRef, null);
    assert.equal(get(db, 'groups/g1').locked, true);
  });

  test('a workspace with no Firestore group is locked in PostgreSQL only', async () => {
    const db = seed();
    const pg = fakePostgres({ gone: { status: 'open', deadlineMs: DEADLINE, memberIds: ['stu1'] } });
    const results = await runDeadlineSweep({ db, pg, analyze: fakeAnalyze().analyze, nowMs: DEADLINE });
    // g1 is not in PostgreSQL, so its Firestore deadline still applies.
    assert.deepEqual(results.map((r) => r.groupId), ['g1', 'gone']);
    assert.equal(get(db, 'groups/g1').locked, true);
    assert.deepEqual(results[1].postgres, { status: 'locked', submissionId: null });
    assert.equal(pg.rows.get('gone').status, 'locked');
    assert.equal(db.store.has('groups/gone'), false);
  });

  test('every minute with a fake clock', async () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'], now: PG_DEADLINE - 90_000 });
    try {
      const db = seed();
      const pg = fakePostgres(workspace());
      const { analyze, calls } = fakeAnalyze();
      const logs = [];
      const job = startDeadlineJob({ db, pg, analyze, log: (l) => logs.push(l) });
      assert.match(logs[0], /PostgreSQL deadlines/);

      mock.timers.tick(60_000); // 30 s before
      await job.current;
      assert.equal(pg.rows.get('g1').status, 'open');

      mock.timers.tick(60_000); // 30 s after
      await job.current;
      assert.equal(pg.rows.get('g1').status, 'locked');
      assert.equal(pg.submissions.get('g1').submittedAtMs, PG_DEADLINE + 30_000);

      mock.timers.tick(60_000);
      await job.current;
      assert.equal(calls.length, 1);
      assert.equal(pg.auditLog.length, 1);
      job.stop();
    } finally {
      mock.timers.reset();
    }
  });
});

describe('claimGroup', () => {
  test('a fresh claim by another run is respected; a stale one is taken over', async () => {
    const db = seed({ autoSubmit: { status: 'running', claimedAtMs: DEADLINE } });
    assert.equal(await claimGroup({ db, groupId: 'g1', nowMs: DEADLINE + 60_000 }), null);
    const group = await claimGroup({ db, groupId: 'g1', nowMs: DEADLINE + CLAIM_LEASE_MS });
    assert.ok(group);
    assert.equal(get(db, 'groups/g1').autoSubmit.claimedAtMs, DEADLINE + CLAIM_LEASE_MS);
  });

  test('a group that is not due cannot be claimed', async () => {
    const db = seed();
    assert.equal(await claimGroup({ db, groupId: 'g1', nowMs: DEADLINE - 1 }), null);
    assert.equal(await claimGroup({ db, groupId: 'missing', nowMs: DEADLINE }), null);
  });
});

describe('startDeadlineJob with a fake clock', () => {
  afterEach(() => mock.timers.reset());

  test('checks every minute and locks on the first tick after the deadline', async () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'], now: DEADLINE - 90_000 });
    const db = seed();
    const { analyze, calls } = fakeAnalyze();
    const job = startDeadlineJob({ db, analyze, log: () => {} });

    mock.timers.tick(60_000); // DEADLINE - 30 s
    await job.current;
    assert.equal(get(db, 'groups/g1').locked, undefined);

    mock.timers.tick(60_000); // DEADLINE + 30 s
    await job.current;
    assert.equal(get(db, 'groups/g1').locked, true);
    assert.equal(get(db, 'groups/g1').lockedAt, new Date(DEADLINE + 30_000).toISOString());

    mock.timers.tick(60_000);
    await job.current;
    assert.equal(calls.length, 1);
    job.stop();
  });

  test('ticks never overlap', async () => {
    mock.timers.enable({ apis: ['setInterval', 'Date'], now: DEADLINE });
    const db = seed();
    let release;
    const calls = [];
    const analyze = (input) => {
      calls.push(input);
      return new Promise((resolve) => {
        release = () => resolve({ report: { id: 'r', scores: {}, feedback: {} } });
      });
    };
    const job = startDeadlineJob({ db, analyze, log: () => {} });
    const first = job.tick();
    while (!release) await new Promise((r) => setImmediate(r));
    assert.equal(job.tick(), first); // a second tick joins the running sweep
    release();
    await first;
    assert.equal(calls.length, 1);
    job.stop();
  });

  test('stays off without Firestore', () => {
    const logs = [];
    assert.equal(startDeadlineJob({ db: null, log: (l) => logs.push(l) }), null);
    assert.match(logs[0], /OFF/);
  });
});
