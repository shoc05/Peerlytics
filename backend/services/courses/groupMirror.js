// Each PostgreSQL workspace has a Firestore groups/{id} document with the same id. The editor,
// collab/, the deadline job and firestore.rules all read it, and the rules grant access from
// memberIds and lecturerIds, so those must match workspace_members and the course lecturers.
// The fields are the ones the app has always written (firestoreService.createProjectGroup),
// plus courseId and assignmentId.
//
// Writes happen inside the PostgreSQL transaction, before COMMIT: if Firestore fails, the
// database change is rolled back, so the two never disagree about who is in a group.
import { FieldValue } from 'firebase-admin/firestore';
import { fail } from '../../routes/http.js';

/** `getClients()` returns { db } (firebase-admin Firestore) or null when the Admin SDK isn't configured. */
export function createGroupMirror(getClients) {
  const groups = () => {
    const db = getClients()?.db;
    if (!db) throw fail(503, 'FIRESTORE_UNAVAILABLE');
    return db.collection('groups');
  };

  return {
    async create({ id, name, deadline, memberIds, lecturerIds, courseId, assignmentId }) {
      await groups()
        .doc(id)
        .create({
          id,
          name,
          createdDate: new Date().toISOString(),
          deadline,
          memberIds,
          lecturerIds,
          submittedToLecturers: [],
          courseId,
          assignmentId,
          createdAt: FieldValue.serverTimestamp(),
        });
    },
    /** Change plain fields such as name or deadline. */
    async update(id, fields) {
      await groups().doc(id).update(fields);
    },
    async addMember(id, uid) {
      await groups().doc(id).update({ memberIds: FieldValue.arrayUnion(uid) });
    },
    async removeMember(id, uid) {
      await groups().doc(id).update({ memberIds: FieldValue.arrayRemove(uid) });
    },
    /** An in-app notification for one user (users/{uid}/notifications, as the app writes them). */
    async notify(uid, { type, message, groupId }) {
      const db = getClients()?.db;
      if (!db) throw fail(503, 'FIRESTORE_UNAVAILABLE');
      await db.collection('users').doc(uid).collection('notifications').add({
        type,
        message,
        groupId,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    },
    /** The group document and everything under it (files, documents' versions, activity). */
    async remove(id) {
      const col = groups();
      await col.firestore.recursiveDelete(col.doc(id));
    },
  };
}

/** A Firestore-style id: 20 characters from [A-Za-z0-9], from crypto randomness. */
export function newWorkspaceId(randomBytes) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(40);
  let id = '';
  for (const b of bytes) {
    if (b < 248) id += chars[b % 62]; // 248 = 4 × 62: no modulo bias
    if (id.length === 20) break;
  }
  return id.length === 20 ? id : newWorkspaceId(randomBytes);
}
