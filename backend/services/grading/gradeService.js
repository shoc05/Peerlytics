// Loads one submitted workspace's frozen inputs, grades every member with backend/grading/,
// and writes their grade rows (step 2.8). A recompute (after a new analysis) updates the row in
// place: grades with overrides can't be deleted (overrides.grade_id is ON DELETE RESTRICT),
// and overrides themselves are never touched, so a lecturer's decision always stays final.
import { gradeWorkspace } from '../../grading/index.js';
import { weightsOf } from '../courses/mappers.js';

/** Recompute and store the grades for a workspace that has a submission. Returns the uids graded. */
export async function recomputeGrades(q, workspaceId) {
  const { rows } = await q.query(
    `SELECT s.author_metrics, a.weight_time, a.weight_edits, a.weight_writing, a.weight_tasks, a.time_cap_minutes,
            COALESCE((SELECT ge.deadline FROM group_extensions ge WHERE ge.workspace_id = w.id ORDER BY ge.created_at DESC LIMIT 1),
                     a.deadline) AS effective_deadline
       FROM workspaces w
       JOIN assignments a ON a.id = w.assignment_id
       JOIN submissions s ON s.workspace_id = w.id
      WHERE w.id = $1`,
    [workspaceId]
  );
  const ctx = rows[0];
  if (!ctx) return [];

  const { rows: analysisRows } = await q.query(
    `SELECT ar.id, ar.status, ar.writing_quality, ar.flagged_sentences
       FROM analysis_results ar JOIN submissions s ON s.id = ar.submission_id
      WHERE s.workspace_id = $1
      ORDER BY ar.created_at DESC, ar.id DESC LIMIT 1`,
    [workspaceId]
  );
  const analysis = analysisRows[0] ?? null;
  const { rows: taskRows } = await q.query('SELECT owner_id, tab_id, done_at FROM tasks WHERE workspace_id = $1', [workspaceId]);

  // Graded: the members at submission time (the metrics snapshot), in a stable order.
  const members = Object.keys(ctx.author_metrics || {}).sort();
  const weights = weightsOf(ctx);
  const results = gradeWorkspace({
    members,
    authorMetrics: ctx.author_metrics,
    analysis,
    tasks: taskRows.map((t) => ({ ownerId: t.owner_id, tabId: t.tab_id, doneAt: t.done_at?.toISOString() ?? null })),
    weights,
    timeCapMinutes: ctx.time_cap_minutes,
    deadlineMs: new Date(ctx.effective_deadline).getTime(),
  });

  for (const r of results) {
    // A member whose account was removed since can't hold a grade row (FK); skip them.
    const exists = await q.query('SELECT 1 FROM users WHERE id = $1', [r.uid]);
    if (exists.rowCount === 0) continue;
    await q.query(
      `INSERT INTO grades (workspace_id, user_id, analysis_result_id, time_score, edits_score, writing_score, tasks_score,
                           weights, deductions, suggested, explanation, computed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET
         analysis_result_id = EXCLUDED.analysis_result_id,
         time_score = EXCLUDED.time_score, edits_score = EXCLUDED.edits_score,
         writing_score = EXCLUDED.writing_score, tasks_score = EXCLUDED.tasks_score,
         weights = EXCLUDED.weights, deductions = EXCLUDED.deductions,
         suggested = EXCLUDED.suggested, explanation = EXCLUDED.explanation, computed_at = now()`,
      [
        workspaceId,
        r.uid,
        analysis?.id ?? null,
        r.scores.time,
        r.scores.edits,
        r.scores.writing,
        r.scores.tasks,
        JSON.stringify(weights),
        JSON.stringify(r.deductions),
        r.suggested,
        r.explanation,
      ]
    );
  }
  return results.map((r) => r.uid);
}
