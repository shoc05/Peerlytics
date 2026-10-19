// Courses, join codes, members, announcements and the course grades list (step 2.1).
// Shapes, roles and errors follow backend/openapi.yaml.
import express from 'express';
import { fail, handler, isUniqueViolation, parse, withTransaction } from './http.js';
import { ANY_ROLE } from './courseContext.js';
import {
  announcementCreate,
  announcementUpdate,
  courseCreate,
  courseUpdate,
  gradesQuery,
  joinBody,
  listCoursesQuery,
  uid as uidSchema,
  uuid,
} from './courseSchemas.js';
import { collegeUuid, courseAccess, isStaff, mustBeActive, mustTeach } from '../services/courses/access.js';
import { generateJoinCode, normaliseJoinCode } from '../services/courses/joinCode.js';
import * as map from '../services/courses/mappers.js';

const JOIN_CODE_TRIES = 5;

/** A path id that isn't a uuid can't name anything: 404, like an unknown id. */
function idParam(value) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw fail(404, 'NOT_FOUND');
  return parsed.data;
}

async function loadCourse(q, courseId) {
  const { rows } = await q.query(
    `SELECT c.*, (SELECT count(*) FROM enrolments e WHERE e.course_id = c.id AND e.course_role = 'student') AS student_count
       FROM courses c WHERE c.id = $1`,
    [courseId]
  );
  return rows[0];
}

const ANNOUNCEMENT_SELECT = `
  SELECT a.*, u.display_name AS author_name
    FROM announcements a JOIN users u ON u.id = a.author_id`;

export function createCourseRouter(ctx) {
  const { db, guard, joinLimit } = ctx;
  const router = express.Router();

  // ── Courses ──
  router.get(
    '/courses',
    guard(...ANY_ROLE),
    handler(async (req, res) => {
      const { includeArchived } = parse(listCoursesQuery, req.query);
      const { rows } = await db.pool.query(
        `SELECT c.*, e.course_role
           FROM courses c
           LEFT JOIN enrolments e ON e.course_id = c.id AND e.user_id = $1
          WHERE (e.user_id IS NOT NULL
                 OR $2 = 'superAdmin'
                 OR ($2 = 'collegeAdmin' AND c.college_id = $3::uuid))
            AND ($4 OR c.archived_at IS NULL)
          ORDER BY c.archived_at NULLS FIRST, c.code, c.title`,
        [req.user.uid, req.user.role, collegeUuid(req.user), includeArchived]
      );
      res.json({ courses: rows.map((r) => map.courseSummary(r, r.course_role)) });
    })
  );

  router.post(
    '/courses',
    guard('lecturer'),
    handler(async (req, res) => {
      const body = parse(courseCreate, req.body);
      const created = await withTransaction(db.pool, async (q) => {
        // ON CONFLICT DO NOTHING keeps the transaction usable when a random code is already taken.
        for (let i = 0; i < JOIN_CODE_TRIES; i += 1) {
          const { rows } = await q.query(
            `INSERT INTO courses (college_id, code, title, description, term, join_code, owner_id)
             VALUES ((SELECT id FROM colleges WHERE id = $1::uuid), $2, $3, $4, $5, $6, $7)
             ON CONFLICT (join_code) DO NOTHING
             RETURNING *`,
            [collegeUuid(req.user), body.code, body.title, body.description ?? null, body.term ?? null, generateJoinCode(), req.user.uid]
          );
          if (rows[0]) {
            await q.query(
              `INSERT INTO enrolments (course_id, user_id, course_role, joined_via) VALUES ($1, $2, 'lecturer', 'owner')`,
              [rows[0].id, req.user.uid]
            );
            return rows[0];
          }
        }
        throw new Error('Could not find a free join code');
      });
      res
        .status(201)
        .location(`/api/courses/${created.id}`)
        .json(map.course({ ...created, student_count: 0 }, { courseRole: 'lecturer', staff: true }));
    })
  );

  router.get(
    '/courses/:courseId',
    guard(...ANY_ROLE),
    handler(async (req, res) => {
      const access = await courseAccess(db.pool, req.user, idParam(req.params.courseId));
      const row = await loadCourse(db.pool, access.course.id);
      res.json(map.course(row, { courseRole: access.courseRole, staff: isStaff(access) }));
    })
  );

  router.patch(
    '/courses/:courseId',
    guard('lecturer'),
    handler(async (req, res) => {
      const access = await courseAccess(db.pool, req.user, idParam(req.params.courseId));
      mustTeach(access);
      const body = parse(courseUpdate, req.body);
      // An archived course only accepts being unarchived.
      if (access.course.archived_at && !(body.archived === false)) throw fail(403, 'COURSE_ARCHIVED');

      const columns = { code: 'code', title: 'title', description: 'description', term: 'term', joinCodeEnabled: 'join_code_enabled' };
      const sets = [];
      const values = [access.course.id];
      for (const [field, column] of Object.entries(columns)) {
        if (body[field] !== undefined) {
          values.push(body[field]);
          sets.push(`${column} = $${values.length}`);
        }
      }
      if (body.archived !== undefined) sets.push(`archived_at = ${body.archived ? 'COALESCE(archived_at, now())' : 'NULL'}`);
      await db.pool.query(`UPDATE courses SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, values);
      const row = await loadCourse(db.pool, access.course.id);
      res.json(map.course(row, { courseRole: access.courseRole, staff: true }));
    })
  );

  router.post(
    '/courses/:courseId/join-code',
    guard('lecturer'),
    handler(async (req, res) => {
      const access = await courseAccess(db.pool, req.user, idParam(req.params.courseId));
      mustTeach(access);
      mustBeActive(access.course);
      for (let i = 0; i < JOIN_CODE_TRIES; i += 1) {
        const joinCode = generateJoinCode();
        try {
          await withTransaction(db.pool, async (q) => {
            await q.query('UPDATE courses SET join_code = $2, updated_at = now() WHERE id = $1', [access.course.id, joinCode]);
            await q.query(
              `INSERT INTO audit_log (actor_id, action, target_type, target_id) VALUES ($1, 'course.join_code_reset', 'course', $2)`,
              [req.user.uid, access.course.id]
            );
          });
          return res.json({ joinCode });
        } catch (err) {
          if (!isUniqueViolation(err, 'courses_join_code_key')) throw err;
        }
      }
      throw new Error('Could not find a free join code');
    })
  );

  // ── Enrolment ──
  router.post(
    '/courses/join',
    guard('student'),
    handler(async (req, res) => {
      joinLimit(req.user.uid);
      const { joinCode } = parse(joinBody, req.body);
      const code = normaliseJoinCode(joinCode);
      if (!code) throw fail(404, 'INVALID_JOIN_CODE');
      const { rows } = await db.pool.query('SELECT * FROM courses WHERE join_code = $1', [code]);
      const course = rows[0];
      if (!course) throw fail(404, 'INVALID_JOIN_CODE');
      if (!course.join_code_enabled || course.archived_at) throw fail(403, 'JOIN_DISABLED');
      const inserted = await db.pool.query(
        `INSERT INTO enrolments (course_id, user_id, course_role, joined_via) VALUES ($1, $2, 'student', 'code')
         ON CONFLICT (course_id, user_id) DO NOTHING`,
        [course.id, req.user.uid]
      );
      if (inserted.rowCount === 0) throw fail(409, 'ALREADY_ENROLLED');
      res.json(map.courseSummary(course, 'student'));
    })
  );

  router.get(
    '/courses/:courseId/members',
    guard(...ANY_ROLE),
    handler(async (req, res) => {
      const access = await courseAccess(db.pool, req.user, idParam(req.params.courseId));
      const staff = isStaff(access);
      const { rows } = await db.pool.query(
        `SELECT u.id, u.display_name, u.email, e.course_role, e.joined_via, e.joined_at
           FROM enrolments e JOIN users u ON u.id = e.user_id
          WHERE e.course_id = $1
          ORDER BY e.course_role, u.display_name, u.id`,
        [access.course.id]
      );
      res.json({
        members: rows.map((r) => ({
          ...map.userRef(r, { withEmail: staff }),
          courseRole: r.course_role,
          ...(staff ? { joinedVia: r.joined_via } : {}),
          joinedAt: map.iso(r.joined_at),
        })),
      });
    })
  );

  router.delete(
    '/courses/:courseId/members/:uid',
    guard('lecturer'),
    handler(async (req, res) => {
      const access = await courseAccess(db.pool, req.user, idParam(req.params.courseId));
      mustTeach(access);
      const target = uidSchema.safeParse(req.params.uid);
      if (!target.success) throw fail(404, 'NOT_FOUND');

      await withTransaction(db.pool, async (q) => {
        const enrolled = await q.query(
          `SELECT 1 FROM enrolments WHERE course_id = $1 AND user_id = $2 AND course_role = 'student' FOR UPDATE`,
          [access.course.id, target.data]
        );
        if (enrolled.rowCount === 0) throw fail(404, 'NOT_FOUND');
        // Groups that haven't submitted lose the student; submitted groups keep their history.
        const { rows: open } = await q.query(
          `DELETE FROM workspace_members m
            USING workspaces w, assignments a
            WHERE m.workspace_id = w.id AND w.assignment_id = a.id
              AND a.course_id = $1 AND m.user_id = $2 AND w.status = 'open'
           RETURNING m.workspace_id`,
          [access.course.id, target.data]
        );
        const ids = open.map((r) => r.workspace_id);
        if (ids.length) {
          await q.query('UPDATE tasks SET owner_id = NULL, updated_at = now() WHERE owner_id = $1 AND workspace_id = ANY($2)', [
            target.data,
            ids,
          ]);
        }
        await q.query('DELETE FROM enrolments WHERE course_id = $1 AND user_id = $2', [access.course.id, target.data]);
        for (const id of ids) await ctx.mirror.removeMember(id, target.data);
      });
      res.status(204).end();
    })
  );

  // ── Announcements ──
  router.get(
    '/courses/:courseId/announcements',
    guard(...ANY_ROLE),
    handler(async (req, res) => {
      const access = await courseAccess(db.pool, req.user, idParam(req.params.courseId));
      const { rows } = await db.pool.query(`${ANNOUNCEMENT_SELECT} WHERE a.course_id = $1 ORDER BY a.pinned DESC, a.created_at DESC`, [
        access.course.id,
      ]);
      res.json({ announcements: rows.map(map.announcement) });
    })
  );

  router.post(
    '/courses/:courseId/announcements',
    guard('lecturer'),
    handler(async (req, res) => {
      const access = await courseAccess(db.pool, req.user, idParam(req.params.courseId));
      mustTeach(access);
      mustBeActive(access.course);
      const body = parse(announcementCreate, req.body);
      const { rows } = await db.pool.query(
        `INSERT INTO announcements (course_id, author_id, title, body, pinned) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [access.course.id, req.user.uid, body.title, body.body, body.pinned ?? false]
      );
      const created = await db.pool.query(`${ANNOUNCEMENT_SELECT} WHERE a.id = $1`, [rows[0].id]);
      res.status(201).json(map.announcement(created.rows[0]));
    })
  );

  async function announcementForLecturer(req) {
    const id = idParam(req.params.announcementId);
    const { rows } = await db.pool.query('SELECT course_id FROM announcements WHERE id = $1', [id]);
    if (!rows[0]) throw fail(404, 'NOT_FOUND');
    const access = await courseAccess(db.pool, req.user, rows[0].course_id);
    mustTeach(access);
    mustBeActive(access.course);
    return id;
  }

  router.patch(
    '/announcements/:announcementId',
    guard('lecturer'),
    handler(async (req, res) => {
      const id = await announcementForLecturer(req);
      const body = parse(announcementUpdate, req.body);
      const sets = [];
      const values = [id];
      for (const field of ['title', 'body', 'pinned']) {
        if (body[field] !== undefined) {
          values.push(body[field]);
          sets.push(`${field} = $${values.length}`);
        }
      }
      await db.pool.query(`UPDATE announcements SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, values);
      const { rows } = await db.pool.query(`${ANNOUNCEMENT_SELECT} WHERE a.id = $1`, [id]);
      res.json(map.announcement(rows[0]));
    })
  );

  router.delete(
    '/announcements/:announcementId',
    guard('lecturer'),
    handler(async (req, res) => {
      const id = await announcementForLecturer(req);
      await db.pool.query('DELETE FROM announcements WHERE id = $1', [id]);
      res.status(204).end();
    })
  );

  // ── Grades tab ──
  router.get(
    '/courses/:courseId/grades',
    guard(...ANY_ROLE),
    handler(async (req, res) => {
      const access = await courseAccess(db.pool, req.user, idParam(req.params.courseId));
      const { assignmentId } = parse(gradesQuery, req.query);
      const staff = isStaff(access);
      const { rows } = await db.pool.query(
        `SELECT g.*, w.assignment_id, u.display_name, u.email, o.new_grade AS override_grade
           FROM grades g
           JOIN workspaces w ON w.id = g.workspace_id
           JOIN assignments a ON a.id = w.assignment_id
           JOIN users u ON u.id = g.user_id
           LEFT JOIN LATERAL (
             SELECT new_grade FROM overrides WHERE grade_id = g.id ORDER BY created_at DESC, id DESC LIMIT 1
           ) o ON true
          WHERE a.course_id = $1
            AND ($2::uuid IS NULL OR a.id = $2)
            AND ($3::text IS NULL OR g.user_id = $3)
          ORDER BY a.deadline, w.name, u.display_name`,
        [access.course.id, assignmentId ?? null, staff ? null : req.user.uid]
      );
      res.json({ grades: rows.map((r) => map.grade(r, { withEmail: staff })) });
    })
  );

  return router;
}
