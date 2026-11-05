// Firestore rules can't read Remote Config, so the backend copies courses_v2 to config/flags for
// them. Only the process running the jobs does this (RUN_JOBS). It never throws: if a write
// fails, the rules keep the last value and the next run tries again.
import { FieldValue } from 'firebase-admin/firestore';
import { getAdmin } from '../auth/firebaseAdmin.js';
import { getFlag } from './index.js';

export const MIRROR_INTERVAL_MS = 60_000;

export function createFlagMirror({ getClients = getAdmin, read = getFlag, log = console.warn } = {}) {
  let last;

  return {
    /** @returns true when it wrote the value, false when nothing changed or it couldn't. */
    async sync() {
      const db = getClients()?.db;
      if (!db) return false;
      try {
        const value = (await read('courses_v2')) === true;
        if (value === last) return false;
        await db.collection('config').doc('flags').set({ courses_v2: value, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        last = value;
        return true;
      } catch (err) {
        log(`⚠ Feature flags: could not update config/flags: ${err.message}`);
        return false;
      }
    },
  };
}

export function startFlagMirror(deps, intervalMs = MIRROR_INTERVAL_MS) {
  const mirror = createFlagMirror(deps);
  mirror.sync();
  const timer = setInterval(() => mirror.sync(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
