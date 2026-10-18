// Roles, claim shape and the one place that writes them. See docs/auth-contract.md.
import { z } from 'zod';

export const ROLES = ['superAdmin', 'collegeAdmin', 'lecturer', 'student'];

// The only roles a user may pick for themselves, once, at sign-up.
export const SELF_PICKABLE_ROLES = ['student', 'lecturer'];

export const pickRoleBody = z.object({ role: z.enum(SELF_PICKABLE_ROLES) }).strict();

export const adminSetRoleBody = z
  .object({
    role: z.enum(ROLES),
    collegeId: z.string().trim().min(1).max(128).nullable().optional(),
  })
  .strict()
  .refine((b) => b.role !== 'superAdmin' || b.collegeId == null, {
    message: 'A superAdmin has no college.',
    path: ['collegeId'],
  });

export const uidParam = z.string().min(1).max(128);

/** Read { role, collegeId } from decoded token claims or customClaims; unknown roles become null. */
export function claimsToRole(claims) {
  const role = ROLES.includes(claims?.role) ? claims.role : null;
  const collegeId = typeof claims?.collegeId === 'string' ? claims.collegeId : null;
  return { role, collegeId };
}

/** Map a pre-claims users/{uid}.role value to a role, or null if it isn't valid. */
export function mapLegacyRole(value) {
  if (value === 'admin') return 'superAdmin';
  return ROLES.includes(value) ? value : null;
}

/**
 * Set the custom claim and the users/{uid}.role mirror. The claim is the source of truth;
 * the mirror only keeps today's firestore.rules working until step 1.8.
 */
export async function applyRole({ auth, db, uid, role, collegeId = null, revoke = false }) {
  await auth.setCustomUserClaims(uid, { role, collegeId });
  await db.collection('users').doc(uid).set({ role }, { merge: true });
  // Revoking makes verifyIdToken(token, true) reject the old token, so the old role stops
  // working straight away instead of when the token expires.
  if (revoke) await auth.revokeRefreshTokens(uid);
}
