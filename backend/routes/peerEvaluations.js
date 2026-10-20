// Peer evaluation (step 3.7), behind the peer_eval_enabled flag. After submission each student
// rates every teammate 1-5 with an optional comment. Students see the ratings they gave;
// lecturers see each student's average, how many ratings they got and the comments, but never
// who wrote which. It is not part of the grade.
import express from 'express';
import { z } from 'zod';
import { fail, handler, parse, withTransaction } from './http.js';
import { uid, workspaceId as workspaceIdSchema } from './courseSchemas.js';
import { isStaff, workspaceAccess } from '../services/courses/access.js';
import { iso } from '../services/courses/mappers.js';

const ratingsBody = z
  .object({
    ratings: z
      .array(
        z
          .object({
            rateeId: uid,
            rating: z.number().int().min(1).max(5),
            comment: z.string().trim().max(500).optional(),
          })
          .strict()
      )
      .min(1)
      .max(20),
  })
  .strict();

const round2 = (v) => Math.round(v * 100) / 100;

export function createPeerEvaluationRouter(ctx) {
  const { db, guard, getFlag } = ctx;
  const router = express.Router();

  /** Flag on, the caller may see the workspace, and it has been submitted. */
  async function submittedWorkspace(req) {
    if ((await getFlag('peer_eval_enabled')) !== true) throw fail(404, 'FEATURE_DISABLED', 'Peer evaluation is not turned on.');
    const parsed = workspaceIdSchema.safeParse(req.params.workspaceId);
    if (!parsed.success) throw fail(404, 'NOT_FOUND');
    const access = await workspaceAccess(db.pool, req.user, parsed.data);
    if (access.workspace.status === 'open') throw fail(409, 'NOT_SUBMITTED', 'Peer evaluation opens after the group submits.');
    const { rows } = await db.pool.query('SELECT user_id FROM workspace_members WHERE workspace_id = $1 ORDER BY user_id', [access.workspace.id]);
    return { ...access, members: rows.map((r) => r.user_id) };
  }

  async function given(workspaceId, raterId) {
    const { rows } = await db.pool.query(
      `SELECT ratee_id, rating, comment, updated_at FROM peer_evaluations
        WHERE workspace_id = $1 AND rater_id = $2 ORDER BY ratee_id`,
      [workspaceId, raterId]
    );
    return { ratings: rows.map((r) => ({ rateeId: r.ratee_id, rating: r.rating, comment: r.comment, updatedAt: iso(r.updated_at) })) };
  }

  router.get(
    '/workspaces/:workspaceId/peer-evaluations',
    guard('student', 'lecturer'),
    handler(async (req, res) => {
      const access = await submittedWorkspace(req);
      if (access.isMember) return res.json(await given(access.workspace.id, req.user.uid));
      if (!isStaff(access)) throw fail(404, 'NOT_FOUND');

      const { rows: users } = await db.pool.query('SELECT id, display_name, email FROM users WHERE id = ANY($1)', [access.members]);
      const { rows: received } = await db.pool.query(
        `SELECT ratee_id, round(avg(rating)::numeric, 2) AS average, count(*)::int AS count,
                -- Sorted by text, not by time, so the order can't hint at who wrote which.
                COALESCE(array_agg(comment ORDER BY comment) FILTER (WHERE comment IS NOT NULL), '{}') AS comments
           FROM peer_evaluations WHERE workspace_id = $1 GROUP BY ratee_id`,
        [access.workspace.id]
      );
      const byId = new Map(received.map((r) => [r.ratee_id, r]));
      const members = users
        .sort((a, b) => a.display_name.localeCompare(b.display_name) || a.id.localeCompare(b.id))
        .map((u) => {
          const r = byId.get(u.id);
          return {
            student: { id: u.id, displayName: u.display_name, ...(u.email ? { email: u.email } : {}) },
            average: r ? round2(Number(r.average)) : null,
            count: r?.count ?? 0,
            expected: access.members.length - 1,
            comments: r?.comments ?? [],
          };
        });
      res.json({ members });
    })
  );

  router.put(
    '/workspaces/:workspaceId/peer-evaluations',
    guard('student'),
    handler(async (req, res) => {
      const access = await submittedWorkspace(req);
      if (!access.isMember) throw fail(403, 'FORBIDDEN');
      const { ratings } = parse(ratingsBody, req.body);

      // Exactly one rating for each teammate: not yourself, nobody outside the group, nobody missed.
      const teammates = access.members.filter((m) => m !== req.user.uid).sort();
      const rated = ratings.map((r) => r.rateeId).sort();
      if (rated.length !== teammates.length || rated.some((id, i) => id !== teammates[i])) {
        throw fail(400, 'INVALID_BODY', 'Rate each teammate exactly once, and not yourself.');
      }

      await withTransaction(db.pool, async (q) => {
        for (const r of ratings) {
          await q.query(
            `INSERT INTO peer_evaluations (workspace_id, rater_id, ratee_id, rating, comment)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (workspace_id, rater_id, ratee_id)
             DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = now()`,
            [access.workspace.id, req.user.uid, r.rateeId, r.rating, r.comment ? r.comment : null]
          );
        }
      });
      res.json(await given(access.workspace.id, req.user.uid));
    })
  );

  return router;
}
