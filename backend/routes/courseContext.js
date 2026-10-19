// What the course and assignment routers share: Kezang's requireAuth/requireRole (unchanged,
// docs/auth-contract.md §4), the database, the Firestore group copy and a per-user rate limit.
import { randomBytes } from 'node:crypto';
import { createRequireAuth, requireRole } from '../src/auth/middleware.js';
import { getAdmin } from '../src/auth/firebaseAdmin.js';
import { createUserRateLimit, requireDb } from './http.js';
import { ensureUser } from '../services/courses/access.js';
import { createGroupMirror } from '../services/courses/groupMirror.js';

export const ANY_ROLE = ['student', 'lecturer', 'collegeAdmin', 'superAdmin'];

/**
 * @param {{ db, getClients?, mirror?, now?, random?, joinLimit? }} deps
 *   getClients returns { auth, db } (firebase-admin) or null; tests pass fakes.
 */
export function createCourseContext({
  db,
  getClients = getAdmin,
  mirror = createGroupMirror(getClients),
  now = Date.now,
  random = randomBytes,
  joinLimit = createUserRateLimit({ max: 10, windowMs: 60_000 }),
}) {
  const requireAuth = createRequireAuth(() => getClients()?.auth ?? null);

  async function lookupName(uid) {
    try {
      return (await getClients()?.auth?.getUser(uid))?.displayName ?? null;
    } catch {
      return null;
    }
  }

  function syncUser(req, _res, next) {
    ensureUser(db.pool, req.user, lookupName).then(() => next(), next);
  }

  return {
    db,
    mirror,
    now,
    random,
    joinLimit,
    /** requireAuth, then the role check, then a database and the caller's users row. */
    guard: (...roles) => [requireAuth, requireRole(...roles), requireDb(db), syncUser],
  };
}
