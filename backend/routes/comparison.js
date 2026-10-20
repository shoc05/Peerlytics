// GET /api/courses/:courseId/comparison (step 4.7), behind course_dashboard_enabled: every
// submitted group's contribution balance, AI and paste levels, and grades, for lecturers and
// admins of the course.
import express from 'express';
import { fail, handler, parse } from './http.js';
import { gradesQuery, uuid } from './courseSchemas.js';
import { courseAccess, isStaff } from '../services/courses/access.js';
import { compareGroup } from '../services/reports/comparison.js';

export function createComparisonRouter(ctx) {
  const { db, guard, getFlag } = ctx;
  const router = express.Router();

  router.get(
    '/courses/:courseId/comparison',
    guard('lecturer', 'collegeAdmin', 'superAdmin'),
    handler(async (req, res) => {
      if ((await getFlag('course_dashboard_enabled')) !== true) throw fail(404, 'FEATURE_DISABLED', 'The course dashboard is not turned on.');
      const parsed = uuid.safeParse(req.params.courseId);
      if (!parsed.success) throw fail(404, 'NOT_FOUND');
      const access = await courseAccess(db.pool, req.user, parsed.data);
      if (!isStaff(access)) throw fail(403, 'FORBIDDEN');
      const { assignmentId } = parse(gradesQuery, req.query);

      const { rows: groups } = await db.pool.query(
        `SELECT w.id, w.name, w.assignment_id, s.author_metrics,
                (SELECT ar.ai_likelihood FROM analysis_results ar
                  WHERE ar.submission_id = s.id ORDER BY ar.created_at DESC, ar.id DESC LIMIT 1) AS ai_likelihood
           FROM workspaces w
           JOIN assignments a ON a.id = w.assignment_id
           JOIN submissions s ON s.workspace_id = w.id
          WHERE a.course_id = $1 AND ($2::uuid IS NULL OR a.id = $2)
          ORDER BY a.deadline, a.title, w.name`,
        [access.course.id, assignmentId ?? null]
      );
      const { rows: finals } = await db.pool.query(
        `SELECT g.workspace_id, COALESCE(o.new_grade, g.suggested) AS final
           FROM grades g
           LEFT JOIN LATERAL (
             SELECT new_grade FROM overrides WHERE grade_id = g.id ORDER BY created_at DESC, id DESC LIMIT 1
           ) o ON true
          WHERE g.workspace_id = ANY($1)`,
        [groups.map((g) => g.id)]
      );
      const byWorkspace = new Map();
      for (const f of finals) byWorkspace.set(f.workspace_id, [...(byWorkspace.get(f.workspace_id) || []), Number(f.final)]);

      res.json({
        courseId: access.course.id,
        assignmentId: assignmentId ?? null,
        groups: groups.map((g) => compareGroup(g, byWorkspace.get(g.id) || [])),
      });
    })
  );

  return router;
}
