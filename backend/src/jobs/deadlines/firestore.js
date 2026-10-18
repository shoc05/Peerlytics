// Firestore (Admin SDK) for the deadline job, shared with the auth routes. Returns null when
// neither FIREBASE_SERVICE_ACCOUNT nor an emulator is configured, so the job stays off and the
// server still starts.
import { getAdmin } from '../../auth/firebaseAdmin.js';

export function getDeadlineDb() {
  return getAdmin()?.db ?? null;
}
