import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  arrayRemove,
  arrayUnion,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

const projectId = 'demo-peerlytics';
const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
let testEnvironment;

before(async () => {
  testEnvironment = await initializeTestEnvironment({ projectId, firestore: { rules } });
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'groups/group-1'), {
      memberIds: ['student-1'],
      lecturerIds: ['lecturer-1'],
      submittedToLecturers: [],
    });
    await setDoc(doc(db, 'users/lecturer-1'), { role: 'lecturer' });
    await setDoc(doc(db, 'groups/group-1/files/file-1'), { name: 'draft' });
    await setDoc(doc(db, 'groups/group-1/versions/version-1'), { body: 'snapshot' });
  });
});

after(async () => {
  await testEnvironment?.cleanup();
});

test('allows a student member to read workspace files', async () => {
  const db = testEnvironment.authenticatedContext('student-1').firestore();
  await assertSucceeds(getDoc(doc(db, 'groups/group-1/files/file-1')));
});

test('denies an unrelated user access to workspace files', async () => {
  const db = testEnvironment.authenticatedContext('outsider').firestore();
  await assertFails(getDoc(doc(db, 'groups/group-1/files/file-1')));
});

test('allows a lecturer to read workspace files only after submission unlock', async () => {
  const db = testEnvironment.authenticatedContext('lecturer-1').firestore();
  await assertFails(getDoc(doc(db, 'groups/group-1/files/file-1')));

  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'groups/group-1'), {
      memberIds: ['student-1'],
      lecturerIds: ['lecturer-1'],
      submittedToLecturers: ['lecturer-1'],
    });
  });

  await assertSucceeds(getDoc(doc(db, 'groups/group-1/files/file-1')));
});

// ——— Server deadline lock (step 1.6) ———

async function seedLockedGroup(locked) {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const path of ['groups/lock-g/files/f2', 'documents/lock-new', 'groups/lock-g/versions/v9',
      'groups/lock-g/pasteEvents/p9', 'reports/late-r', 'submissions/late-s']) {
      await deleteDoc(doc(db, path));
    }
    await setDoc(doc(db, 'groups/lock-g'), {
      name: 'Lock test',
      memberIds: ['lock-stu'],
      lecturerIds: [],
      submittedToLecturers: [],
      deadline: '2026-10-20T18:00:00.000Z',
      ...(locked ? { locked: true, lockedBy: 'deadline' } : {}),
    });
    await setDoc(doc(db, 'groups/lock-g/files/f1'), { name: 'Report', submitted: false });
    await setDoc(doc(db, 'groups/lock-g/folders/d1'), { name: 'Folder' });
    await setDoc(doc(db, 'documents/lock-f1'), { fileId: 'lock-f1', groupId: 'lock-g', text: 'draft' });
  });
}

// setDoc with merge on an existing document is an update for the rules.
const update = (ref, data) => setDoc(ref, data, { merge: true });
const lockStudentDb = () => testEnvironment.authenticatedContext('lock-stu').firestore();

// Every write the locked tests deny is allowed here on the same unlocked group, so the lock
// flag is the only reason for those denials.
test('a member can edit workspace content before the lock', async () => {
  await seedLockedGroup(false);
  const db = lockStudentDb();
  await assertSucceeds(update(doc(db, 'groups/lock-g/files/f1'), { name: 'Report v2' }));
  await assertSucceeds(setDoc(doc(db, 'groups/lock-g/files/f2'), { name: 'new file' }));
  await assertSucceeds(update(doc(db, 'groups/lock-g/folders/d1'), { name: 'renamed' }));
  await assertSucceeds(update(doc(db, 'documents/lock-f1'), { text: 'draft 2' }));
  await assertSucceeds(setDoc(doc(db, 'documents/lock-new'), { fileId: 'lock-new', groupId: 'lock-g', text: 'x' }));
  await assertSucceeds(setDoc(doc(db, 'groups/lock-g/versions/v9'), { fileId: 'f1', content: 'x' }));
  await assertSucceeds(setDoc(doc(db, 'groups/lock-g/pasteEvents/p9'), { fileId: 'f1', userId: 'lock-stu' }));
  await assertSucceeds(setDoc(doc(db, 'reports/late-r'), { groupId: 'lock-g', userId: 'lock-stu' }));
  await assertSucceeds(
    setDoc(doc(db, 'submissions/late-s'), { workspaceId: 'lock-g', submittedBy: 'lock-stu', status: 'submitted' })
  );
  await assertSucceeds(deleteDoc(doc(db, 'groups/lock-g/files/f1')));
});

test('a locked workspace is read-only: files, folders, documents, versions, paste events', async () => {
  await seedLockedGroup(true);
  const db = lockStudentDb();
  await assertSucceeds(getDoc(doc(db, 'groups/lock-g/files/f1')));
  await assertSucceeds(getDoc(doc(db, 'documents/lock-f1')));
  await assertFails(update(doc(db, 'groups/lock-g/files/f1'), { name: 'late edit' }));
  await assertFails(setDoc(doc(db, 'groups/lock-g/files/f2'), { name: 'new file' }));
  await assertFails(deleteDoc(doc(db, 'groups/lock-g/files/f1')));
  await assertFails(update(doc(db, 'groups/lock-g/folders/d1'), { name: 'renamed' }));
  await assertFails(update(doc(db, 'documents/lock-f1'), { text: 'late edit' }));
  await assertFails(setDoc(doc(db, 'documents/lock-new'), { fileId: 'lock-new', groupId: 'lock-g', text: 'x' }));
  await assertFails(setDoc(doc(db, 'groups/lock-g/versions/v9'), { fileId: 'f1', content: 'x' }));
  await assertFails(setDoc(doc(db, 'groups/lock-g/pasteEvents/p9'), { fileId: 'f1', userId: 'lock-stu' }));
});

test('no new client report or submission after the lock', async () => {
  await seedLockedGroup(true);
  const db = lockStudentDb();
  await assertFails(setDoc(doc(db, 'reports/late-r'), { groupId: 'lock-g', userId: 'lock-stu' }));
  await assertFails(
    setDoc(doc(db, 'submissions/late-s'), { workspaceId: 'lock-g', submittedBy: 'lock-stu', status: 'submitted' })
  );
});

test('members cannot unlock a group or set the lock, claim or extension fields', async () => {
  await seedLockedGroup(true);
  const db = lockStudentDb();
  await assertFails(update(doc(db, 'groups/lock-g'), { locked: false }));
  await assertFails(update(doc(db, 'groups/lock-g'), { lockedAt: null }));
  await assertFails(update(doc(db, 'groups/lock-g'), { autoSubmit: { status: 'done' } }));
  await assertFails(update(doc(db, 'groups/lock-g'), { extendedDeadline: '2026-12-01T00:00:00Z' }));

  await seedLockedGroup(false);
  await assertFails(update(doc(db, 'groups/lock-g'), { locked: true }));
  await assertFails(update(doc(db, 'groups/lock-g'), { extendedDeadline: '2026-12-01T00:00:00Z' }));
  await assertSucceeds(update(doc(db, 'groups/lock-g'), { name: 'Renamed' }));
});

test('prevents deletion of immutable workspace versions', async () => {
  const db = testEnvironment.authenticatedContext('student-1').firestore();
  await assertFails(deleteDoc(doc(db, 'groups/group-1/versions/version-1')));
});

// ——— users/{uid}.role is written only by the backend (step 1.2) ———

async function seedUser(uid, data) {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `users/${uid}`), data);
  });
}

test('allows a user to create their own profile without a role', async () => {
  const db = testEnvironment.authenticatedContext('new-user').firestore();
  await assertSucceeds(setDoc(doc(db, 'users/new-user'), { uid: 'new-user', name: 'New', classSection: '' }));
});

test('denies creating your own profile with any role', async () => {
  for (const role of ['student', 'lecturer', 'admin', 'superAdmin', 'collegeAdmin']) {
    const uid = `picker-${role}`;
    const db = testEnvironment.authenticatedContext(uid).firestore();
    await assertFails(setDoc(doc(db, `users/${uid}`), { uid, name: 'X', role }));
  }
});

test('denies creating a profile for someone else', async () => {
  const db = testEnvironment.authenticatedContext('student-1').firestore();
  await assertFails(setDoc(doc(db, 'users/someone-else'), { uid: 'someone-else', name: 'X' }));
});

test('denies changing or removing your own role', async () => {
  await seedUser('student-2', { uid: 'student-2', name: 'S', role: 'student' });
  const db = testEnvironment.authenticatedContext('student-2').firestore();
  for (const role of ['lecturer', 'admin', 'superAdmin', 'collegeAdmin']) {
    await assertFails(updateDoc(doc(db, 'users/student-2'), { role }));
  }
  await assertFails(updateDoc(doc(db, 'users/student-2'), { role: deleteField() }));
  await assertFails(setDoc(doc(db, 'users/student-2'), { uid: 'student-2', name: 'S' }));
});

test('allows updating your own profile fields other than role', async () => {
  await seedUser('student-3', { uid: 'student-3', name: 'S', role: 'student', classSection: '' });
  const db = testEnvironment.authenticatedContext('student-3').firestore();
  await assertSucceeds(updateDoc(doc(db, 'users/student-3'), { name: 'Renamed', classSection: 'CS Year 2' }));
});

test('denies setting the role of another user', async () => {
  await seedUser('student-4', { uid: 'student-4', name: 'S', role: 'student', groupId: null });
  const db = testEnvironment.authenticatedContext('student-1').firestore();
  await assertFails(updateDoc(doc(db, 'users/student-4'), { role: 'lecturer' }));
  await assertFails(updateDoc(doc(db, 'users/student-4'), { role: 'lecturer', groupId: 'group-1' }));
});

test('gives the superAdmin mirror the same read-only oversight as the legacy admin role', async () => {
  await seedUser('super-1', { uid: 'super-1', role: 'superAdmin' });
  await seedUser('legacy-admin', { uid: 'legacy-admin', role: 'admin' });
  for (const uid of ['super-1', 'legacy-admin']) {
    const db = testEnvironment.authenticatedContext(uid).firestore();
    await assertSucceeds(getDoc(doc(db, 'groups/group-1')));
  }
  const outsider = testEnvironment.authenticatedContext('outsider').firestore();
  await assertFails(getDoc(doc(outsider, 'groups/group-1')));
});

// ——— Step 1.8: membership, lecturer unlock, read-only submissions, create-once results ———

const ACC_CREATED = [
  'groups/acc-g/files/acc-new', 'groups/acc-g/versions/acc-v2', 'groups/acc-g/presence/acc-stu',
  'groups/acc-g/presence/acc-out', 'groups/acc-g/overrides/o1', 'groups/acc-g/grades/acc-stu',
  'groups/acc-new-g', 'reports/acc-r2', 'users/acc-stu/fcmTokens/tok-1', 'users/acc-stu/fcmTokens/tok-2',
];

async function seedAccess({ unlocked = false } = {}) {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const path of ACC_CREATED) await deleteDoc(doc(db, path));
    await setDoc(doc(db, 'groups/acc-g'), {
      name: 'Access test',
      memberIds: ['acc-stu', 'acc-stu2'],
      lecturerIds: ['acc-lec'],
      submittedToLecturers: unlocked ? ['acc-lec'] : [],
    });
    await setDoc(doc(db, 'groups/acc-g/files/acc-open'), { name: 'Draft', submitted: false });
    await setDoc(doc(db, 'groups/acc-g/files/acc-done'), { name: 'Final', submitted: true });
    await setDoc(doc(db, 'documents/acc-open'), { fileId: 'acc-open', groupId: 'acc-g', text: 'draft' });
    await setDoc(doc(db, 'documents/acc-done'), { fileId: 'acc-done', groupId: 'acc-g', text: 'final' });
    await setDoc(doc(db, 'groups/acc-g/versions/acc-v1'), { fileId: 'acc-open', content: 'v1' });
    await setDoc(doc(db, 'groups/acc-g/pasteEvents/acc-p1'), { fileId: 'acc-open', userId: 'acc-stu' });
    await setDoc(doc(db, 'reports/acc-r1'), { groupId: 'acc-g', userId: 'acc-stu', scores: {} });
  });
}

// Roles come from the custom claim (docs/auth-contract.md); no users/{uid} doc is seeded here.
const as = (uid, role) => testEnvironment.authenticatedContext(uid, role ? { role } : {}).firestore();
const student = () => as('acc-stu', 'student');
const lecturer = () => as('acc-lec', 'lecturer');
const outsider = () => as('acc-out', 'student');
const ACC_CONTENT = ['groups/acc-g/files/acc-open', 'documents/acc-open', 'groups/acc-g/versions/acc-v1',
  'groups/acc-g/pasteEvents/acc-p1', 'reports/acc-r1'];

test('roles come from the custom claim; the claim wins over the profile mirror', async () => {
  await seedAccess();
  // A lecturer claim in memberIds still can't read content before submission.
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'groups/acc-g'), { memberIds: ['acc-stu', 'acc-stu2', 'claim-lec'] });
  });
  await assertFails(getDoc(doc(as('claim-lec', 'lecturer'), 'groups/acc-g/files/acc-open')));
  // A student claim reads even though an old profile says lecturer.
  await seedUser('acc-stu2', { uid: 'acc-stu2', role: 'lecturer' });
  await assertSucceeds(getDoc(doc(as('acc-stu2', 'student'), 'groups/acc-g/files/acc-open')));
  // No claim yet: the mirror still decides (pre-migration accounts).
  await assertFails(getDoc(doc(as('acc-stu2'), 'groups/acc-g/files/acc-open')));
});

test('only members read or write a workspace', async () => {
  await seedAccess();
  const db = outsider();
  await assertFails(getDoc(doc(db, 'groups/acc-g')));
  await assertFails(update(doc(db, 'groups/acc-g'), { name: 'hijacked' }));
  await assertFails(deleteDoc(doc(db, 'groups/acc-g')));
  for (const path of ACC_CONTENT) await assertFails(getDoc(doc(db, path)));
  await assertFails(setDoc(doc(db, 'groups/acc-g/files/acc-new'), { name: 'x' }));
  await assertFails(update(doc(db, 'documents/acc-open'), { text: 'x' }));
  await assertFails(setDoc(doc(db, 'groups/acc-g/versions/acc-v2'), { fileId: 'acc-open' }));
  await assertFails(setDoc(doc(db, 'groups/acc-g/presence/acc-out'), { online: true }));

  const member = student();
  await assertSucceeds(getDoc(doc(member, 'groups/acc-g')));
  for (const path of ACC_CONTENT) await assertSucceeds(getDoc(doc(member, path)));
  await assertSucceeds(setDoc(doc(member, 'groups/acc-g/files/acc-new'), { name: 'x', submitted: false }));
  await assertSucceeds(setDoc(doc(member, 'groups/acc-g/presence/acc-stu'), { online: true }));
});

test('a new group must include its creator and starts unsubmitted and unlocked', async () => {
  await seedAccess();
  const db = student();
  const base = { name: 'New', memberIds: ['acc-stu'], lecturerIds: [], submittedToLecturers: [] };
  await assertFails(setDoc(doc(db, 'groups/acc-new-g'), { ...base, memberIds: ['someone-else'] }));
  await assertFails(setDoc(doc(db, 'groups/acc-new-g'), { ...base, submittedToLecturers: ['acc-lec'] }));
  await assertFails(setDoc(doc(db, 'groups/acc-new-g'), { ...base, locked: true }));
  await assertFails(setDoc(doc(db, 'groups/acc-new-g'), { ...base, extendedDeadline: '2026-12-01T00:00:00Z' }));
  await assertSucceeds(setDoc(doc(db, 'groups/acc-new-g'), base));
});

test('a lecturer cannot unlock a workspace for themselves; students submit and cannot take it back', async () => {
  await seedAccess();
  // The old hole: any signed-in user adding themselves as a lecturer of any group.
  await assertFails(update(doc(as('acc-out', 'lecturer'), 'groups/acc-g'), {
    lecturerIds: arrayUnion('acc-out'), submittedToLecturers: arrayUnion('acc-out'),
  }));
  await assertFails(update(doc(as('acc-out', 'lecturer'), 'groups/acc-g'), { lecturerIds: arrayUnion('acc-out') }));
  // A lecturer of the group can't unlock it before a student submits.
  await assertFails(update(doc(lecturer(), 'groups/acc-g'), { submittedToLecturers: arrayUnion('acc-lec') }));
  // A student member submits to the lecturer (unlockLecturersForGroup).
  await assertSucceeds(update(doc(student(), 'groups/acc-g'), { submittedToLecturers: arrayUnion('acc-lec') }));
  await assertFails(update(doc(student(), 'groups/acc-g'), { submittedToLecturers: arrayRemove('acc-lec') }));
  await assertFails(update(doc(student(), 'groups/acc-g'), { submittedToLecturers: [] }));
});

test('a lecturer reads workspace content and results only after submission, and never writes content', async () => {
  await seedAccess();
  let db = lecturer();
  await assertSucceeds(getDoc(doc(db, 'groups/acc-g')));
  for (const path of ACC_CONTENT) await assertFails(getDoc(doc(db, path)));

  await seedAccess({ unlocked: true });
  db = lecturer();
  for (const path of ACC_CONTENT) await assertSucceeds(getDoc(doc(db, path)));
  await assertFails(update(doc(db, 'groups/acc-g/files/acc-open'), { name: 'lecturer edit' }));
  await assertFails(update(doc(db, 'documents/acc-open'), { text: 'lecturer edit' }));
  await assertFails(setDoc(doc(db, 'groups/acc-g/versions/acc-v2'), { fileId: 'acc-open' }));
});

test('a submitted file and its document are read-only; submitting is the last write', async () => {
  await seedAccess();
  const db = student();
  await assertSucceeds(getDoc(doc(db, 'documents/acc-done')));
  await assertFails(update(doc(db, 'groups/acc-g/files/acc-done'), { name: 'renamed' }));
  await assertFails(update(doc(db, 'groups/acc-g/files/acc-done'), { submitted: false }));
  await assertFails(deleteDoc(doc(db, 'groups/acc-g/files/acc-done')));
  await assertFails(update(doc(db, 'documents/acc-done'), { text: 'after submit' }));
  await assertFails(deleteDoc(doc(db, 'documents/acc-done')));
  // persistOpenFile writes the body first, then marks the file submitted.
  await assertSucceeds(update(doc(db, 'documents/acc-open'), { text: 'final text' }));
  await assertSucceeds(update(doc(db, 'groups/acc-g/files/acc-open'), { submitted: true }));
  await assertFails(update(doc(db, 'documents/acc-open'), { text: 'too late' }));
});

test('a document body cannot be moved to another group', async () => {
  await seedAccess();
  await assertFails(update(doc(student(), 'documents/acc-open'), { groupId: 'lock-g' }));
});

test('version history is append-only', async () => {
  await seedAccess();
  const db = student();
  await assertSucceeds(setDoc(doc(db, 'groups/acc-g/versions/acc-v2'), { fileId: 'acc-open', content: 'v2' }));
  await assertFails(update(doc(db, 'groups/acc-g/versions/acc-v1'), { content: 'rewritten' }));
  await assertFails(deleteDoc(doc(db, 'groups/acc-g/versions/acc-v1')));
});

test('analysis results (reports) are create-once', async () => {
  await seedAccess({ unlocked: true });
  const db = student();
  await assertFails(setDoc(doc(db, 'reports/acc-r2'), { groupId: 'acc-g', userId: 'acc-stu2' }));
  await assertSucceeds(setDoc(doc(db, 'reports/acc-r2'), { groupId: 'acc-g', userId: 'acc-stu' }));
  await assertFails(setDoc(doc(db, 'reports/acc-r2'), { groupId: 'acc-g', userId: 'acc-stu', scores: { ai: 0 } }));
  await assertFails(update(doc(db, 'reports/acc-r1'), { suggestedGrade: 10 }));
  await assertFails(deleteDoc(doc(db, 'reports/acc-r1')));
  await assertFails(update(doc(lecturer(), 'reports/acc-r1'), { suggestedGrade: 1 }));
  await assertFails(deleteDoc(doc(lecturer(), 'reports/acc-r1')));
});

test('overrides are a separate append-only log: who, when and why', async () => {
  const override = (extra = {}) => ({
    memberId: 'acc-stu', grade: 6, suggestedGrade: 8, reason: 'Late section', lecturerId: 'acc-lec',
    lecturerName: 'Dr L', createdAt: serverTimestamp(), ...extra,
  });
  await seedAccess();
  await assertFails(setDoc(doc(lecturer(), 'groups/acc-g/overrides/o1'), override())); // before submission

  await seedAccess({ unlocked: true });
  const db = lecturer();
  await assertFails(setDoc(doc(db, 'groups/acc-g/overrides/o1'), override({ reason: '  ' })));
  await assertFails(setDoc(doc(db, 'groups/acc-g/overrides/o1'), override({ lecturerId: 'someone-else' })));
  await assertFails(setDoc(doc(db, 'groups/acc-g/overrides/o1'), override({ grade: 11 })));
  await assertFails(setDoc(doc(db, 'groups/acc-g/overrides/o1'), override({ createdAt: Timestamp.fromMillis(0) })));
  await assertFails(setDoc(doc(db, 'groups/acc-g/overrides/o1'), override({ extra: 'field' })));
  await assertFails(setDoc(doc(student(), 'groups/acc-g/overrides/o1'), override({ lecturerId: 'acc-stu' })));
  await assertSucceeds(setDoc(doc(db, 'groups/acc-g/overrides/o1'), override()));
  await assertFails(update(doc(db, 'groups/acc-g/overrides/o1'), { reason: 'changed my mind' }));
  await assertFails(deleteDoc(doc(db, 'groups/acc-g/overrides/o1')));
  await assertSucceeds(getDoc(doc(student(), 'groups/acc-g/overrides/o1')));
  await assertFails(getDoc(doc(outsider(), 'groups/acc-g/overrides/o1')));
});

test('a grade records the lecturer who set it', async () => {
  await seedAccess({ unlocked: true });
  const grade = { memberId: 'acc-stu', grade: 7, suggestedGrade: 7, isOverride: false, overrideReason: '' };
  await assertFails(setDoc(doc(lecturer(), 'groups/acc-g/grades/acc-stu'), { ...grade, lecturerId: 'someone-else' }));
  await assertSucceeds(setDoc(doc(lecturer(), 'groups/acc-g/grades/acc-stu'), { ...grade, lecturerId: 'acc-lec' }));
  await assertFails(setDoc(doc(student(), 'groups/acc-g/grades/acc-stu'), { ...grade, lecturerId: 'acc-stu' }));
});

test('users read and write only their own fcmTokens', async () => {
  await seedAccess();
  const token = { platform: 'web', createdAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(student(), 'users/acc-stu/fcmTokens/tok-1'), token));
  await assertSucceeds(getDoc(doc(student(), 'users/acc-stu/fcmTokens/tok-1')));
  await assertFails(setDoc(doc(outsider(), 'users/acc-stu/fcmTokens/tok-2'), token));
  await assertFails(getDoc(doc(lecturer(), 'users/acc-stu/fcmTokens/tok-1')));
  await assertSucceeds(deleteDoc(doc(student(), 'users/acc-stu/fcmTokens/tok-1')));
});

// ——— Step 2.2: Yjs state is the collab server's only ———

test('no client reads or writes collabDocs, not even a member of the group', async () => {
  await seedAccess();
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'collabDocs/group:acc-g:file:acc-open'), { state: 'x' });
  });
  await assertFails(getDoc(doc(student(), 'collabDocs/group:acc-g:file:acc-open')));
  await assertFails(setDoc(doc(student(), 'collabDocs/group:acc-g:file:acc-open'), { state: 'y' }));
  await assertFails(setDoc(doc(student(), 'collabDocs/group:acc-g:file:acc-new'), { state: 'y' }));
});
