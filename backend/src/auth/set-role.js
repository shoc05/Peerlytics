// Usage: node backend/src/auth/set-role.js <uid> <role> [collegeId]
// For the first superAdmin (contract section 6). After that, use POST /api/admin/users/:uid/role.
// Needs FIREBASE_SERVICE_ACCOUNT in the repo-root .env.
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getAdmin } from './firebaseAdmin.js';
import { adminSetRoleBody, applyRole } from './roles.js';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env') });

const [uid, role, collegeId] = process.argv.slice(2);
const parsed = adminSetRoleBody.safeParse({ role, collegeId: collegeId ?? null });
if (!uid || !parsed.success) {
  console.error('Usage: node backend/src/auth/set-role.js <uid> <superAdmin|collegeAdmin|lecturer|student> [collegeId]');
  process.exit(1);
}
const clients = getAdmin();
if (!clients) {
  console.error('FIREBASE_SERVICE_ACCOUNT is not set or not valid.');
  process.exit(1);
}
await clients.auth.getUser(uid); // throws auth/user-not-found for a wrong uid
await applyRole({ ...clients, uid, role: parsed.data.role, collegeId: parsed.data.collegeId ?? null, revoke: true });
console.log(`Set ${uid} to ${parsed.data.role}. They must sign in again.`);
process.exit(0);
