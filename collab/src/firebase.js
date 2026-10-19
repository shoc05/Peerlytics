// Firebase Admin SDK for the collab server: verifies ID tokens and reads workspaces.
// Uses FIREBASE_SERVICE_ACCOUNT (a path or the JSON itself, like the backend), or the
// emulators when FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST are set.
import fs from 'fs';
import path from 'path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function loadServiceAccount(raw, baseDir) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const file = path.isAbsolute(trimmed) ? trimmed : path.resolve(baseDir, trimmed);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Returns { auth, db }, or null when nothing is configured. */
export function getAdmin(env = process.env, baseDir = process.cwd()) {
  if (!getApps().length) {
    if (env.FIREBASE_AUTH_EMULATOR_HOST || env.FIRESTORE_EMULATOR_HOST) {
      initializeApp({ projectId: env.GCLOUD_PROJECT || 'demo-peerlytics' });
    } else {
      const serviceAccount = loadServiceAccount(env.FIREBASE_SERVICE_ACCOUNT, baseDir);
      if (!serviceAccount) return null;
      initializeApp({ credential: cert(serviceAccount) });
    }
  }
  return { auth: getAuth(), db: getFirestore() };
}

/** The loaders createCollabServer needs, backed by Firebase. */
export function firebaseLoaders({ auth, db }) {
  const data = (snap) => (snap.exists ? snap.data() : null);
  return {
    // `true` also rejects tokens revoked after a role change (docs/auth-contract.md).
    verifyToken: (token) => auth.verifyIdToken(token, true),
    loadRole: async (uid) => data(await db.collection('users').doc(uid).get())?.role ?? null,
    loadGroup: async (groupId) => data(await db.collection('groups').doc(groupId).get()),
    loadFile: async (groupId, fileId) =>
      data(await db.collection('groups').doc(groupId).collection('files').doc(fileId).get()),
  };
}
