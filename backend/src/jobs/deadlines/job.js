// Server-side deadline enforcement (step 1.6). Every minute: find group workspaces past their
// (extended) deadline, submit each unsubmitted file the way the app does, then lock the group.
// The browser countdown and its auto-submit stay; whichever runs first wins, and files the
// browser already submitted are skipped.
//
// With PostgreSQL (`pg`, a store from postgres.js), workspaces in the `workspaces` table take
// their deadline from the assignment or the group's latest extension, and the job also records
// the submission there and sets the workspace to `locked`. Groups that only exist in Firestore
// keep the Firestore deadline, and without DATABASE_URL the job works on Firestore alone.
import { DEFAULT_TIMEZONE, effectiveDeadlineMs, isDue } from './time.js';
import { describeSubmission, submitFile } from './submit.js';

export const INTERVAL_MS = 60_000;
// A claim older than this is treated as a crashed run and taken over.
export const CLAIM_LEASE_MS = 10 * 60_000;

/**
 * Claim a due group in a transaction so two backends (or two ticks) never submit it twice.
 * Returns the group data when this run owns it, otherwise null. `due` defaults to the Firestore
 * deadline; PostgreSQL workspaces pass their own check, since PostgreSQL already found them due.
 */
export async function claimGroup({ db, groupId, nowMs, timeZone, due = (group) => isDue(group, nowMs, timeZone) }) {
  const ref = db.collection('groups').doc(groupId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const group = snap.data();
    if (!due(group)) return null;
    const claim = group.autoSubmit;
    if (claim?.status === 'running' && nowMs - (claim.claimedAtMs || 0) < CLAIM_LEASE_MS) return null;
    tx.update(ref, {
      autoSubmit: { status: 'running', claimedAtMs: nowMs, attempts: (claim?.attempts || 0) + 1 },
    });
    return group;
  });
}

async function lockGroup({ db, groupId, nowMs, timeZone, deadlineMs, submittedFileIds, skippedFileIds }) {
  const ref = db.collection('groups').doc(groupId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const group = snap.data();
    const lecturerIds = group.lecturerIds || [];
    const update = {
      locked: true,
      lockedAt: new Date(nowMs).toISOString(),
      lockedBy: 'deadline',
      lockedDeadline: new Date(deadlineMs ?? effectiveDeadlineMs(group, timeZone)).toISOString(),
      autoSubmit: {
        status: 'done',
        claimedAtMs: group.autoSubmit?.claimedAtMs ?? nowMs,
        finishedAtMs: nowMs,
        attempts: group.autoSubmit?.attempts || 1,
        submittedFileIds,
        skippedFileIds,
      },
    };
    // Same unlock as unlockLecturersForGroup: lecturers can read the workspace after submission.
    if (submittedFileIds.length && lecturerIds.length) {
      update.submittedToLecturers = [...new Set([...(group.submittedToLecturers || []), ...lecturerIds])];
    }
    tx.update(ref, update);
  });
}

async function recordFailure({ db, groupId, nowMs, log, err }) {
  await db
    .collection('groups')
    .doc(groupId)
    .update({ 'autoSubmit.status': 'failed', 'autoSubmit.error': String(err.message).slice(0, 300), 'autoSubmit.failedAtMs': nowMs })
    .catch(() => {});
  log(`[deadlines] ${groupId} failed, will retry: ${err.message}`);
  return { groupId, error: err.message };
}

/** Submit and lock one claimed group. Errors are recorded on the group and retried next tick. */
export async function processGroup({ db, groupId, group, analyze, nowMs, timeZone, deadlineMs, log }) {
  const groupRef = db.collection('groups').doc(groupId);
  try {
    const filesSnap = await groupRef.collection('files').get();
    const submittedFileIds = [];
    const skippedFileIds = [];
    for (const fileDoc of filesSnap.docs) {
      const file = { id: fileDoc.id, ...fileDoc.data() };
      if (file.submitted === true) continue; // the browser (or an earlier run) already did it
      const result = await submitFile({ db, groupId, group, file, analyze, nowMs, log });
      (result.submitted ? submittedFileIds : skippedFileIds).push(file.id);
    }
    await lockGroup({ db, groupId, nowMs, timeZone, deadlineMs, submittedFileIds, skippedFileIds });
    log(`[deadlines] locked ${groupId}: submitted ${submittedFileIds.length}, skipped ${skippedFileIds.length}`);
    return { groupId, submittedFileIds, skippedFileIds };
  } catch (err) {
    return recordFailure({ db, groupId, nowMs, log, err });
  }
}

/**
 * One PostgreSQL workspace past its deadline: submit and lock it in Firestore as above, then
 * record the submission and lock the row. Until the PostgreSQL commit succeeds the row stays
 * `open`, so a failure anywhere is retried next tick; the Firestore steps are safe to repeat.
 */
export async function processWorkspace({ db, pg, workspace, analyze, nowMs, timeZone, log }) {
  const { id: groupId, deadlineMs, extended, memberIds } = workspace;
  let result = { groupId, submittedFileIds: [], skippedFileIds: [] };
  let submission = null;

  const exists = (await db.collection('groups').doc(groupId).get()).exists;
  if (exists) {
    // Locked in Firestore but still open here means an earlier run stopped before PostgreSQL.
    const group = await claimGroup({ db, groupId, nowMs, timeZone, due: () => true });
    if (!group) return null; // another run holds the claim
    result = await processGroup({ db, groupId, group, analyze, nowMs, timeZone, deadlineMs, log });
    if (result.error) return result;
  }

  try {
    if (exists) submission = await describeSubmission({ db, groupId, memberIds });
    const recorded = await pg.lockAtDeadline({ workspaceId: groupId, nowMs, deadlineMs, extended, submission });
    if (recorded.status === 'skipped') log(`[deadlines] ${groupId} was already ${recorded.reason} in PostgreSQL`);
    return { ...result, postgres: recorded };
  } catch (err) {
    return recordFailure({ db, groupId, nowMs, log, err });
  }
}

/** One pass over all groups. Returns what was processed (for logs and tests). */
export async function runDeadlineSweep({ db, pg = null, analyze, nowMs, timeZone = DEFAULT_TIMEZONE, log = () => {} }) {
  const groupsSnap = await db.collection('groups').get();
  const dueInFirestore = groupsSnap.docs.filter((d) => isDue(d.data(), nowMs, timeZone)).map((d) => d.id);
  // A PostgreSQL workspace ignores the Firestore deadline: its own is checked below.
  const inPostgres = pg ? await pg.knownWorkspaceIds(dueInFirestore) : new Set();

  const results = [];
  for (const groupId of dueInFirestore) {
    if (inPostgres.has(groupId)) continue;
    const group = await claimGroup({ db, groupId, nowMs, timeZone });
    if (!group) continue;
    results.push(await processGroup({ db, groupId, group, analyze, nowMs, timeZone, log }));
  }

  if (pg) {
    for (const workspace of await pg.dueWorkspaces(nowMs)) {
      const result = await processWorkspace({ db, pg, workspace, analyze, nowMs, timeZone, log });
      if (result) results.push(result);
    }
  }
  return results;
}

/**
 * Start the every-minute sweep. Returns null (job off) when there is no Firestore, because the
 * work to submit lives there. `pg` is optional. `now` is injectable so tests can drive it with
 * a fake clock. Ticks never overlap.
 */
export function startDeadlineJob({
  db,
  pg = null,
  analyze,
  now = Date.now,
  intervalMs = INTERVAL_MS,
  timeZone = process.env.DEADLINE_TIMEZONE || DEFAULT_TIMEZONE,
  log = (line) => console.log(line),
} = {}) {
  if (!db) {
    log('ℹ Server deadline lock is OFF — missing FIREBASE_SERVICE_ACCOUNT. (The browser countdown still auto-submits.)');
    return null;
  }
  const job = { current: null };
  const tick = () => {
    if (job.current) return job.current;
    job.current = runDeadlineSweep({ db, pg, analyze, nowMs: now(), timeZone, log })
      .catch((err) => log(`[deadlines] sweep failed: ${err.message}`))
      .finally(() => {
        job.current = null;
      });
    return job.current;
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  job.tick = tick;
  job.stop = () => clearInterval(timer);
  log(
    `✓ Server deadline lock ON (every ${Math.round(intervalMs / 1000)} s, time zone ${timeZone}, ` +
      `${pg ? 'PostgreSQL deadlines for course workspaces' : 'Firestore deadlines only: no DATABASE_URL'}).`
  );
  return job;
}
