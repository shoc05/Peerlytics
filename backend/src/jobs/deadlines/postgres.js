// The PostgreSQL side of the deadline job (step 1.6). Workspaces that have a row in `workspaces`
// (docs/db-schema.md) take their deadline from PostgreSQL: the latest `group_extensions.deadline`,
// otherwise `assignments.deadline`. Groups that only exist in Firestore keep the Firestore
// deadline (time.js).
//
// lockAtDeadline mirrors the manual submit (backend/routes/submissions.js on the courses branch):
// lock the workspace row, insert the submission, change the status, all in one transaction. A
// workspace a member already submitted is left alone, so whichever runs first wins.

// More than this in one minute waits for the next tick.
export const DUE_LIMIT = 100;

const DUE_SQL = `
  SELECT w.id,
         COALESCE(ext.deadline, a.deadline) AS deadline,
         ext.deadline IS NOT NULL AS extended,
         ARRAY(SELECT m.user_id FROM workspace_members m WHERE m.workspace_id = w.id ORDER BY m.user_id) AS member_ids
    FROM workspaces w
    JOIN assignments a ON a.id = w.assignment_id
    LEFT JOIN LATERAL (
      SELECT g.deadline FROM group_extensions g
       WHERE g.workspace_id = w.id
       ORDER BY g.created_at DESC, g.id DESC
       LIMIT 1
    ) ext ON true
   WHERE w.status = 'open'
     AND COALESCE(ext.deadline, a.deadline) <= $1
   ORDER BY 2, w.id
   LIMIT $2`;

/** Words in submitted text, counted the same way for every submission. */
export function countWords(text) {
  const words = String(text || '').trim().split(/\s+/);
  return words[0] === '' ? 0 : words.length;
}

/**
 * Per-student counts at the deadline: the `author_metrics` column. The same shape as the manual
 * submit's buildAuthorMetrics (backend/services/submissions/workspaceStore.js on the courses
 * branch). Counts only, never text. Members with no data get zeros.
 */
export function buildAuthorMetrics(memberIds, analytics, pasteEvents) {
  const byUid = new Map(analytics.map((a) => [a.uid || a.id, a]));
  return Object.fromEntries(
    memberIds.map((uid) => {
      const a = byUid.get(uid) || {};
      const mine = pasteEvents.filter((p) => p.userId === uid);
      return [
        uid,
        {
          // The editor counts active writing time in minutes.
          timeSpentSec: Math.max(0, Math.round((Number(a.timeSpent) || 0) * 60)),
          edits: Math.max(0, Math.round(Number(a.edits) || 0)),
          pasteEvents: mine.length,
          largePastes: mine.filter((p) => p.changeType === 'paste-large').length,
          tabEdits: a.tabEdits && typeof a.tabEdits === 'object' ? a.tabEdits : {},
        },
      ];
    })
  );
}

/** `pool` is a pg.Pool (backend/db/pool.js). */
export function createDeadlineStore(pool) {
  return {
    /** Which of these group ids are PostgreSQL workspaces (and so ignore the Firestore deadline). */
    async knownWorkspaceIds(ids) {
      if (!ids.length) return new Set();
      const { rows } = await pool.query('SELECT id FROM workspaces WHERE id = ANY($1::text[])', [ids]);
      return new Set(rows.map((r) => r.id));
    },

    /** Open workspaces whose effective deadline has passed, earliest first. */
    async dueWorkspaces(nowMs, limit = DUE_LIMIT) {
      const { rows } = await pool.query(DUE_SQL, [new Date(nowMs), limit]);
      return rows.map((r) => ({
        id: r.id,
        deadlineMs: r.deadline.getTime(),
        extended: r.extended,
        memberIds: r.member_ids,
      }));
    },

    /**
     * Record the deadline submission and lock the workspace. `submission` is
     * { wordCount, authorMetrics, documentRef }, or null when the group had nothing to submit
     * (the workspace is still locked). Returns { status: 'locked', submissionId } or
     * { status: 'skipped', reason } when the workspace is no longer open.
     */
    async lockAtDeadline({ workspaceId, nowMs, deadlineMs, extended, submission }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT status FROM workspaces WHERE id = $1 FOR UPDATE', [workspaceId]);
        if (rows[0]?.status !== 'open') {
          await client.query('ROLLBACK');
          return { status: 'skipped', reason: rows[0]?.status ?? 'missing' };
        }
        const at = new Date(nowMs);
        let submissionId = null;
        if (submission) {
          const inserted = await client.query(
            `INSERT INTO submissions (workspace_id, submitted_by, trigger, word_count, author_metrics, document_ref, submitted_at)
             VALUES ($1, NULL, 'deadline', $2, $3, $4, $5)
             ON CONFLICT (workspace_id) DO NOTHING
             RETURNING id`,
            [workspaceId, submission.wordCount, JSON.stringify(submission.authorMetrics), submission.documentRef, at]
          );
          submissionId = inserted.rows[0]?.id ?? null;
        }
        await client.query(`UPDATE workspaces SET status = 'locked', updated_at = $2 WHERE id = $1`, [workspaceId, at]);
        await client.query(
          `INSERT INTO audit_log (actor_id, action, target_type, target_id, details, created_at)
           VALUES (NULL, 'workspace.locked', 'workspace', $1, $2, $3)`,
          [
            workspaceId,
            JSON.stringify({
              trigger: 'deadline',
              deadline: new Date(deadlineMs).toISOString(),
              extended,
              submissionId,
              documentRef: submission?.documentRef ?? null,
            }),
            at,
          ]
        );
        await client.query('COMMIT');
        return { status: 'locked', submissionId };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
