// One-off: copy users/{uid}.role into custom claims (admin -> superAdmin). Contract section 6.
import { applyRole, claimsToRole, mapLegacyRole } from './roles.js';

/**
 * Returns { migrated, skipped, invalid } as lists of uids. Accounts that already have a role
 * claim are left alone; accounts without a valid legacy role get no claim (they see the picker).
 */
export async function migrateRoles({ auth, db, dryRun = false, log = () => {} }) {
  const result = { migrated: [], skipped: [], invalid: [] };
  const snap = await db.collection('users').get();
  for (const docSnap of snap.docs) {
    const uid = docSnap.id;
    const role = mapLegacyRole(docSnap.get('role'));
    if (!role) {
      result.invalid.push(uid);
      continue;
    }
    let record;
    try {
      record = await auth.getUser(uid);
    } catch (err) {
      if (err?.code !== 'auth/user-not-found') throw err;
      result.invalid.push(uid); // profile without an Auth account
      continue;
    }
    if (claimsToRole(record.customClaims).role) {
      result.skipped.push(uid);
      continue;
    }
    if (!dryRun) await applyRole({ auth, db, uid, role });
    result.migrated.push(uid);
    log(`${dryRun ? '[dry run] ' : ''}${uid} -> ${role}`);
  }
  return result;
}
