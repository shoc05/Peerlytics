// A workspace's grades, lecturer overrides and the CSV export for the VLE (step 2.8).
// Overrides are append-only rows (who, when, why, previous and new grade); the latest one is
// the final grade. The suggested grade itself is never changed by an override.
import express from 'express';
import { z } from 'zod';
import { fail, handler, parse, withTransaction } from './http.js';
import { ANY_ROLE } from './courseContext.js';
import { gradesQuery, uuid, workspaceId as workspaceIdSchema } from './courseSchemas.js';
import { courseAccess, isStaff, mustTeach, workspaceAccess } from '../services/courses/access.js';
import * as map from '../services/courses/mappers.js';
import { toCsv } from '../services/grading/csv.js';

const overrideBody = z
  .object({
    grade: z
      .number()
      .min(0)
      .max(10)
      .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-9, { message: 'Use at most two decimals.' }),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();

const GRADE_SELECT = `
  SELECT g.*, w.assignment_id, u.display_name, u.email,
         o.new_grade AS override_grade, o.reason AS override_reason, ol.display_name AS override_by
    FROM grades g
    JOIN workspaces w ON w.id = g.workspace_id
    JOIN users u ON u.id = g.user_id
    LEFT JOIN LATERAL (
      SELECT new_grade, reason, lecturer_id FROM overrides WHERE grade_id = g.id ORDER BY created_at DESC, id DESC LIMIT 1
    ) o ON true
    LEFT JOIN users ol ON ol.id = o.lecturer_id`;

function override(row) {
  return {
    id: row.id,
    gradeId: row.grade_id,
    lecturer: { id: row.lecturer_id, displayName: row.lecturer_name },
    previousGrade: Number(row.previous_grade),
    newGrade: Number(row.new_grade),
    reason: row.reason,
    createdAt: map.iso(row.created_at),
  };
}

function idParam(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw fail(404, 'NOT_FOUND');
  return parsed.data;
}

export function createGradeRouter(ctx) {
  const { db, guard } = ctx;
  const router = express.Router();

  router.get(
    '/workspaces/:workspaceId/grades',
    guard(...ANY_ROLE),
    handler(async (req, res) => {
      const access = await workspaceAccess(db.pool, req.user, idParam(workspaceIdSchema, req.params.workspaceId));
      if (access.workspace.status === 'open') throw fail(409, 'NOT_SUBMITTED', 'This workspace has not been submitted yet.');
      const staff = isStaff(access);
      const { rows } = await db.pool.query(
        `${GRADE_SELECT} WHERE g.workspace_id = $1 AND ($2::text IS NULL OR g.user_id = $2) ORDER BY u.display_name, u.id`,
        [access.workspace.id, staff ? null : req.user.uid]
      );
      res.json({ grades: rows.map((r) => map.grade(r, { withEmail: staff })) });
    })
  );

  /** A grade with the caller's access: the student it belongs to, or the course's staff. */
  async function gradeAccess(req) {
    const id = idParam(uuid, req.params.gradeId);
    const { rows } = await db.pool.query('SELECT * FROM grades WHERE id = $1', [id]);
    if (!rows[0]) throw fail(404, 'NOT_FOUND');
    const access = await workspaceAccess(db.pool, req.user, rows[0].workspace_id);
    if (!isStaff(access) && rows[0].user_id !== req.user.uid) throw fail(404, 'NOT_FOUND');
    return { ...access, grade: rows[0] };
  }

  router.get(
    '/grades/:gradeId/overrides',
    guard(...ANY_ROLE),
    handler(async (req, res) => {
      const { grade } = await gradeAccess(req);
      const { rows } = await db.pool.query(
        `SELECT o.*, u.display_name AS lecturer_name FROM overrides o JOIN users u ON u.id = o.lecturer_id
          WHERE o.grade_id = $1 ORDER BY o.created_at DESC, o.id DESC`,
        [grade.id]
      );
      res.json({ overrides: rows.map(override) });
    })
  );

  router.post(
    '/grades/:gradeId/overrides',
    guard('lecturer'),
    handler(async (req, res) => {
      const access = await gradeAccess(req);
      mustTeach(access);
      const body = parse(overrideBody, req.body);
      const created = await withTransaction(db.pool, async (q) => {
        // Lock the grade so two overrides at once record the right "previous" grade.
        const { rows: g } = await q.query('SELECT suggested FROM grades WHERE id = $1 FOR UPDATE', [access.grade.id]);
        const { rows: last } = await q.query(
          'SELECT new_grade FROM overrides WHERE grade_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1',
          [access.grade.id]
        );
        const previous = last[0]?.new_grade ?? g[0].suggested;
        const { rows } = await q.query(
          `INSERT INTO overrides (grade_id, lecturer_id, previous_grade, new_grade, reason) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [access.grade.id, req.user.uid, previous, body.grade, body.reason]
        );
        await q.query(
          `INSERT INTO audit_log (actor_id, action, target_type, target_id, details) VALUES ($1, 'grade.overridden', 'grade', $2, $3)`,
          [req.user.uid, access.grade.id, JSON.stringify({ student: access.grade.user_id, from: Number(previous), to: body.grade })]
        );
        return rows[0];
      });
      const { rows } = await db.pool.query('SELECT display_name FROM users WHERE id = $1', [req.user.uid]);
      res.status(201).json(override({ ...created, lecturer_name: rows[0].display_name }));
    })
  );

  router.get(
    '/courses/:courseId/grades.csv',
    guard('lecturer'),
    handler(async (req, res) => {
      const access = await courseAccess(db.pool, req.user, idParam(uuid, req.params.courseId));
      mustTeach(access);
      const { assignmentId } = parse(gradesQuery, req.query);
      const { rows } = await db.pool.query(
        `SELECT g.*, a.title AS assignment_title, w.name AS group_name, u.display_name, u.email,
                o.new_grade AS override_grade, o.reason AS override_reason, ol.display_name AS override_by
           FROM grades g
           JOIN workspaces w ON w.id = g.workspace_id
           JOIN assignments a ON a.id = w.assignment_id
           JOIN users u ON u.id = g.user_id
           LEFT JOIN LATERAL (
             SELECT new_grade, reason, lecturer_id FROM overrides WHERE grade_id = g.id ORDER BY created_at DESC, id DESC LIMIT 1
           ) o ON true
           LEFT JOIN users ol ON ol.id = o.lecturer_id
          WHERE a.course_id = $1 AND ($2::uuid IS NULL OR a.id = $2)
          ORDER BY a.deadline, a.title, w.name, u.display_name, u.id`,
        [access.course.id, assignmentId ?? null]
      );
      const n = (v) => (v == null ? '' : Number(v));
      const csv = toCsv(rows, [
        { header: 'course_code', value: () => access.course.code },
        { header: 'assignment', value: (r) => r.assignment_title },
        { header: 'group', value: (r) => r.group_name },
        { header: 'student_name', value: (r) => r.display_name },
        { header: 'student_email', value: (r) => r.email ?? '' },
        { header: 'time', value: (r) => n(r.time_score) },
        { header: 'edits', value: (r) => n(r.edits_score) },
        { header: 'writing', value: (r) => n(r.writing_score) },
        { header: 'tasks', value: (r) => n(r.tasks_score) },
        { header: 'deductions', value: (r) => (r.deductions || []).reduce((s, d) => s + d.points, 0) },
        { header: 'suggested', value: (r) => n(r.suggested) },
        { header: 'final', value: (r) => n(r.override_grade ?? r.suggested) },
        { header: 'overridden_by', value: (r) => r.override_by ?? '' },
        { header: 'override_reason', value: (r) => r.override_reason ?? '' },
      ]);
      const safeCode = access.course.code.replace(/[^A-Za-z0-9_-]/g, '_');
      res
        .type('text/csv; charset=utf-8')
        .set('Content-Disposition', `attachment; filename="${safeCode}-grades.csv"`)
        .set('Cache-Control', 'no-store')
        .send(csv);
    })
  );

  return router;
}
