import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, deleteField, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

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
