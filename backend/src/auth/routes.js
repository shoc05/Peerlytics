// /api/auth/me, /api/auth/role and /api/admin/users/:uid/role (docs/auth-contract.md section 5).
import express from 'express';
import { sendError, zodDetails } from './errors.js';
import { createRequireAuth, requireRole } from './middleware.js';
import { adminSetRoleBody, applyRole, claimsToRole, pickRoleBody, uidParam } from './roles.js';
import { getAdmin } from './firebaseAdmin.js';

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/** `getClients()` returns { auth, db } from firebase-admin, or null when not configured. */
export function createAuthRouter({ getClients = getAdmin } = {}) {
  const router = express.Router();
  const requireAuth = createRequireAuth(() => getClients()?.auth ?? null);

  router.get('/auth/me', requireAuth, (req, res) => {
    const { uid, email, role, collegeId } = req.user;
    res.json({ uid, email, role, collegeId });
  });

  // Pick student or lecturer, once. The users/{uid} doc is read and written in a transaction
  // so two requests sent at the same time can't both succeed.
  router.post(
    '/auth/role',
    requireAuth,
    wrap(async (req, res) => {
      const parsed = pickRoleBody.safeParse(req.body);
      if (!parsed.success) return sendError(res, 400, 'INVALID_BODY', zodDetails(parsed.error));
      const { role } = parsed.data;
      const { uid } = req.user;
      const { auth, db } = getClients();

      // The caller's token may predate a role set elsewhere, so check the live record too.
      const record = await auth.getUser(uid);
      const claimed = claimsToRole(record.customClaims).role;
      if (req.user.role || claimed) return sendError(res, 409, 'ROLE_ALREADY_SET');

      const ref = db.collection('users').doc(uid);
      const outcome = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const mirrored = snap.exists ? snap.get('role') : undefined;
        // A mirror equal to the requested role with no claim means an earlier attempt stopped
        // half-way; let it finish. Any other existing role (including legacy ones) is final.
        if (mirrored && mirrored !== role) return 'taken';
        tx.set(ref, { role }, { merge: true });
        return 'ok';
      });
      if (outcome === 'taken') return sendError(res, 409, 'ROLE_ALREADY_SET');

      await applyRole({ auth, db, uid, role });
      return res.json({ role, collegeId: null });
    })
  );

  router.post(
    '/admin/users/:uid/role',
    requireAuth,
    requireRole('superAdmin'),
    wrap(async (req, res) => {
      const target = uidParam.safeParse(req.params.uid);
      const parsed = adminSetRoleBody.safeParse(req.body);
      if (!target.success) return sendError(res, 400, 'INVALID_BODY', zodDetails(target.error));
      if (!parsed.success) return sendError(res, 400, 'INVALID_BODY', zodDetails(parsed.error));
      const uid = target.data;
      const { role } = parsed.data;
      const collegeId = parsed.data.collegeId ?? null;

      if (uid === req.user.uid) return sendError(res, 403, 'CANNOT_CHANGE_OWN_ROLE');

      const { auth, db } = getClients();
      let record;
      try {
        record = await auth.getUser(uid);
      } catch (err) {
        if (err?.code === 'auth/user-not-found') return sendError(res, 404, 'USER_NOT_FOUND');
        throw err;
      }

      const previous = claimsToRole(record.customClaims).role;
      await applyRole({ auth, db, uid, role, collegeId, revoke: true });
      // Until the PostgreSQL audit_log exists, the change is logged here (uids only, no emails).
      console.info(
        `[auth] role change by=${req.user.uid} target=${uid} from=${previous ?? 'none'} to=${role} at=${new Date().toISOString()}`
      );
      return res.json({ uid, role, collegeId });
    })
  );

  return router;
}
