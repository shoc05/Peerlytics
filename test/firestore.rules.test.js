import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';

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

test('prevents deletion of immutable workspace versions', async () => {
  const db = testEnvironment.authenticatedContext('student-1').firestore();
  await assertFails(deleteDoc(doc(db, 'groups/group-1/versions/version-1')));
});
