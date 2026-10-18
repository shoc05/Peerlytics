// Firebase Admin SDK for the auth routes. Uses FIREBASE_SERVICE_ACCOUNT (a path or the JSON
// itself, like the reminder emails), or the Auth emulator when FIREBASE_AUTH_EMULATOR_HOST is set.
// Returns null when neither is configured, so the server still starts and the auth routes
// answer 503 AUTH_UNAVAILABLE instead of crashing.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadServiceAccount(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const file = path.isAbsolute(trimmed) ? trimmed : path.resolve(backendDir, trimmed);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

let cached;

export function getAdmin(env = process.env) {
  if (cached !== undefined) return cached;
  try {
    if (!getApps().length) {
      if (env.FIREBASE_AUTH_EMULATOR_HOST) {
        initializeApp({ projectId: env.GCLOUD_PROJECT || 'demo-peerlytics' });
      } else {
        const serviceAccount = loadServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
        if (!serviceAccount) {
          console.warn('⚠ Auth routes: FIREBASE_SERVICE_ACCOUNT is not set, so /api/auth/* answers 503.');
          cached = null;
          return cached;
        }
        initializeApp({ credential: cert(serviceAccount) });
      }
    }
    cached = { auth: getAuth(), db: getFirestore() };
  } catch (err) {
    console.warn('⚠ Auth routes: could not start the Firebase Admin SDK —', err.message);
    cached = null;
  }
  return cached;
}
