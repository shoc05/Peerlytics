// Server-side deadline enforcement (step 1.6). Every minute: find group workspaces past their
// (extended) deadline, submit each unsubmitted file the way the app does, then lock the group.
// The browser countdown and its auto-submit stay; whichever runs first wins, and files the
// browser already submitted are skipped.
import { DEFAULT_TIMEZONE, effectiveDeadlineMs, isDue } from './time.js';
import { submitFile } from './submit.js';

export const INTERVAL_MS = 60_000;
// A claim older than this is treated as a crashed run and taken over.
export const CLAIM_LEASE_MS = 10 * 60_000;

/**
 * Claim a due group in a transaction so two backends (or two ticks) never submit it twice.
 * Returns the group data when this run owns it, otherwise null.
 */
export async function claimGroup({ db, groupId, nowMs, timeZone }) {
  const ref = db.collection('groups').doc(groupId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const group = snap.data();
    if (!isDue(group, nowMs, timeZone)) return null;
    const claim = group.autoSubmit;
    if (claim?.status === 'running' && nowMs - (claim.claimedAtMs || 0) < CLAIM_LEASE_MS) return null;
    tx.update(ref, {
      autoSubmit: { status: 'running', claimedAtMs: nowMs, attempts: (claim?.attempts || 0) + 1 },
    });
    return group;
  });
}

async function lockGroup({ db, groupId, nowMs, timeZone, submittedFileIds, skippedFileIds }) {
  const ref = db.collection('groups').doc(groupId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const group = snap.data();
    const lecturerIds = group.lecturerIds || [];
    const update = {
      locked: true,
      lockedAt: new Date(nowMs).toISOString(),
      lockedBy: 'deadline',
      lockedDeadline: new Date(effectiveDeadlineMs(group, timeZone)).toISOString(),
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

/** Submit and lock one claimed group. Errors are recorded on the group and retried next tick. */
export async function processGroup({ db, groupId, group, analyze, nowMs, timeZone, log }) {
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
    await lockGroup({ db, groupId, nowMs, timeZone, submittedFileIds, skippedFileIds });
    log(`[deadlines] locked ${groupId}: submitted ${submittedFileIds.length}, skipped ${skippedFileIds.length}`);
    return { groupId, submittedFileIds, skippedFileIds };
  } catch (err) {
    await groupRef
      .update({ 'autoSubmit.status': 'failed', 'autoSubmit.error': String(err.message).slice(0, 300), 'autoSubmit.failedAtMs': nowMs })
      .catch(() => {});
    log(`[deadlines] ${groupId} failed, will retry: ${err.message}`);
    return { groupId, error: err.message };
  }
}

/** One pass over all groups. Returns what was processed (for logs and tests). */
export async function runDeadlineSweep({ db, analyze, nowMs, timeZone = DEFAULT_TIMEZONE, log = () => {} }) {
  const groupsSnap = await db.collection('groups').get();
  const results = [];
  for (const groupDoc of groupsSnap.docs) {
    if (!isDue(groupDoc.data(), nowMs, timeZone)) continue;
    const group = await claimGroup({ db, groupId: groupDoc.id, nowMs, timeZone });
    if (!group) continue;
    results.push(await processGroup({ db, groupId: groupDoc.id, group, analyze, nowMs, timeZone, log }));
  }
  return results;
}

/**
 * Start the every-minute sweep. Returns null (job off) when there is no Firestore.
 * `now` is injectable so tests can drive it with a fake clock. Ticks never overlap.
 */
export function startDeadlineJob({
  db,
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
    job.current = runDeadlineSweep({ db, analyze, nowMs: now(), timeZone, log })
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
  log(`✓ Server deadline lock ON (every ${Math.round(intervalMs / 1000)} s, time zone ${timeZone}).`);
  return job;
}
