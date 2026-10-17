// Firestore (Admin SDK) for the deadline job. Uses FIREBASE_SERVICE_ACCOUNT like the reminder
// emails, or the Firestore emulator when FIRESTORE_EMULATOR_HOST is set. Returns null when
// neither is configured, so the job stays off and the server still starts.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function loadServiceAccount(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const file = path.isAbsolute(trimmed) ? trimmed : path.resolve(backendDir, trimmed);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function getDeadlineDb(env = process.env) {
  try {
    if (!getApps().length) {
      if (env.FIRESTORE_EMULATOR_HOST) {
        initializeApp({ projectId: env.GCLOUD_PROJECT || 'demo-peerlytics' });
      } else {
        const serviceAccount = loadServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
        if (!serviceAccount) return null;
        initializeApp({ credential: cert(serviceAccount) });
      }
    }
    return getFirestore();
  } catch (err) {
    console.warn('⚠ Deadline job: could not start the Firebase Admin SDK —', err.message);
    return null;
  }
}
