// Role helpers for the browser (docs/auth-contract.md section 3). No Firebase imports, so they
// run under `node --test`.

export const ROLES = ['superAdmin', 'collegeAdmin', 'lecturer', 'student'];

/**
 * The user's role: the custom claim is the source of truth. Until migrate-roles.js has run,
 * older accounts only have users/{uid}.role, so fall back to that (admin -> superAdmin).
 * null means "no role yet": show the role picker.
 */
export function resolveRole(claims, profile) {
  if (ROLES.includes(claims?.role)) return claims.role;
  const legacy = profile?.role === 'admin' ? 'superAdmin' : profile?.role;
  return ROLES.includes(legacy) ? legacy : null;
}

export function resolveCollegeId(claims) {
  return typeof claims?.collegeId === 'string' ? claims.collegeId : null;
}

/** Build the user object the app uses from the Firebase user, token claims and profile doc. */
export function buildSessionUser({ fbUser, claims, profile }) {
  return {
    uid: fbUser.uid,
    email: profile?.email || fbUser.email || '',
    name: profile?.name || fbUser.displayName || fbUser.email?.split('@')[0] || 'User',
    role: resolveRole(claims, profile),
    collegeId: resolveCollegeId(claims),
    groupId: profile?.groupId ?? null,
    classSection: profile?.classSection || '',
  };
}

export function roleFlags(role) {
  return {
    isStudent: role === 'student',
    isLecturer: role === 'lecturer',
    isCollegeAdmin: role === 'collegeAdmin',
    isSuperAdmin: role === 'superAdmin',
    // The existing admin dashboard (read-only grading oversight) is for super admins.
    isAdmin: role === 'superAdmin',
    needsRole: role === null,
  };
}

/** True when the backend says the user's tokens were revoked (an admin changed their role). */
export function isTokenRevoked(status, body) {
  return status === 401 && body?.code === 'TOKEN_REVOKED';
}
