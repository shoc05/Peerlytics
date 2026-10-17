// Deadline extensions (step 4.6). POST /api/groups/:groupId/extension { deadline, reason }
// gives one group a new deadline. The server lock (job.js), the browser countdown, the
// reminder emails and the calendar all read `extendedDeadline` before `deadline`.
//
// Only a lecturer of that group may do it, and only while the workspace is still open:
// once the deadline job has submitted and locked it, an extension would not undo that.
// Every change is logged with who, when and why. Until the PostgreSQL audit_log table
// (docs/db-schema.md) exists, the log is the server-only Firestore collection auditLog.
import express from 'express';
import { z } from 'zod';
import { createRequireAuth, requireRole } from '../../auth/middleware.js';
import { sendError, zodDetails } from '../../auth/errors.js';
import { getAdmin } from '../../auth/firebaseAdmin.js';
import { effectiveDeadlineMs } from './time.js';

export const extensionBody = z
  .object({
    // An exact instant: the lecturer's browser sends it with its UTC offset.
    deadline: z.string().datetime({ offset: true }),
    reason: z.string().trim().min(5, 'Give a reason of at least 5 characters.').max(500),
  })
  .strict();

const groupIdParam = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

export function createExtensionRouter({ getClients = getAdmin, now = Date.now, timeZone = process.env.DEADLINE_TIMEZONE } = {}) {
  const router = express.Router();
  const requireAuth = createRequireAuth(() => getClients()?.auth ?? null);

  router.post(
    '/groups/:groupId/extension',
    requireAuth,
    requireRole('lecturer'),
    wrap(async (req, res) => {
      const groupId = groupIdParam.safeParse(req.params.groupId);
      const body = extensionBody.safeParse(req.body);
      if (!groupId.success) return sendError(res, 400, 'INVALID_BODY', zodDetails(groupId.error));
      if (!body.success) return sendError(res, 400, 'INVALID_BODY', zodDetails(body.error));

      const nowMs = now();
      const newMs = Date.parse(body.data.deadline);
      if (newMs <= nowMs + 60_000) {
        return res.status(400).json({ error: 'The new deadline must be in the future.', code: 'DEADLINE_IN_PAST' });
      }

      const { db } = getClients();
      const ref = db.collection('groups').doc(groupId.data);
      const uid = req.user.uid;
      const at = new Date(nowMs).toISOString();
      const to = new Date(newMs).toISOString();

      const outcome = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { status: 404, code: 'GROUP_NOT_FOUND', error: 'That workspace does not exist.' };
        const group = snap.data();
        if (!(group.lecturerIds || []).includes(uid)) {
          return { status: 403, code: 'FORBIDDEN', error: 'Only a lecturer of this workspace can extend its deadline.' };
        }
        if (group.locked === true) {
          return { status: 409, code: 'ALREADY_LOCKED', error: 'This workspace was already submitted and locked at its deadline.' };
        }
        const previousMs = effectiveDeadlineMs(group, timeZone || undefined);
        const from = previousMs == null ? null : new Date(previousMs).toISOString();
        tx.update(ref, {
          extendedDeadline: to,
          extension: { deadline: to, previous: from, reason: body.data.reason, by: uid, at },
        });
        tx.set(db.collection('auditLog').doc(), {
          action: 'deadline.extended',
          actorUid: uid,
          groupId: groupId.data,
          from,
          to,
          reason: body.data.reason,
          at,
        });
        tx.set(ref.collection('activity').doc(), {
          user: 'System',
          action: `Deadline extended to ${to} by the lecturer. Reason: ${body.data.reason}`,
          timestamp: nowMs,
          createdAt: new Date(nowMs),
        });
        return { status: 200, from };
      });

      if (outcome.status !== 200) return res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
      return res.json({ groupId: groupId.data, deadline: to, previous: outcome.from, reason: body.data.reason });
    })
  );

  return router;
}
