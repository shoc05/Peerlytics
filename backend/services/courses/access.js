// Who may see or change a course or workspace. The custom-claim role (requireRole) says what
// kind of user someone is; these checks add the row-level rule from x-access in
// backend/openapi.yaml, using enrolments (auth contract §8: course permissions come from
// PostgreSQL, not claims). Something the caller may not know about is a 404, not a 403.
import { fail } from '../../routes/http.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The collegeId claim when it is a uuid (it is null for everyone until colleges are in use), else null. */
export const collegeUuid = (user) =>
  typeof user.collegeId === 'string' && UUID.test(user.collegeId) ? user.collegeId : null;

/** Admin over a course: any superAdmin, or a collegeAdmin of the course's college. */
export function isCourseAdmin(user, collegeId) {
  if (user.role === 'superAdmin') return true;
  return user.role === 'collegeAdmin' && collegeId != null && collegeId === user.collegeId;
}

/**
 * Create or refresh the caller's users row from their token. The display name is looked up
 * once, when the row is first created (`lookupName(uid)`), because ID tokens don't carry it
 * reliably. The claim role and college are kept in step on later calls.
 */
export async function ensureUser(q, user, lookupName) {
  const collegeId = collegeUuid(user);
  const updated = await q.query(
    `UPDATE users
        SET email = $2, role = $3,
            college_id = (SELECT id FROM colleges WHERE id = $4::uuid),
            updated_at = now()
      WHERE id = $1
        AND (email, role, college_id) IS DISTINCT FROM ($2, $3, (SELECT id FROM colleges WHERE id = $4::uuid))`,
    [user.uid, user.email, user.role, collegeId]
  );
  if (updated.rowCount > 0) return;
  const exists = await q.query('SELECT 1 FROM users WHERE id = $1', [user.uid]);
  if (exists.rowCount > 0) return;

  const name = (await lookupName(user.uid))?.trim() || user.email?.split('@')[0] || 'User';
  await q.query(
    `INSERT INTO users (id, email, display_name, role, college_id)
     VALUES ($1, $2, $3, $4, (SELECT id FROM colleges WHERE id = $5::uuid))
     ON CONFLICT (id) DO NOTHING`,
    [user.uid, user.email, name.slice(0, 100), user.role, collegeId]
  );
}

/**
 * The caller's relation to a course: { course, courseRole: 'lecturer'|'student'|null, isAdmin }.
 * 404 when the course doesn't exist or the caller has no relation to it.
 */
export async function courseAccess(q, user, courseId) {
  const { rows } = await q.query(
    `SELECT c.*, e.course_role
       FROM courses c
       LEFT JOIN enrolments e ON e.course_id = c.id AND e.user_id = $2
      WHERE c.id = $1`,
    [courseId, user.uid]
  );
  const course = rows[0];
  if (!course) throw fail(404, 'NOT_FOUND');
  const access = { course, courseRole: course.course_role ?? null, isAdmin: isCourseAdmin(user, course.college_id) };
  if (!access.courseRole && !access.isAdmin) throw fail(404, 'NOT_FOUND');
  return access;
}

/** The caller must teach this course. */
export function mustTeach(access) {
  if (access.courseRole !== 'lecturer') throw fail(403, 'FORBIDDEN');
}

/** Archived courses are read-only. */
export function mustBeActive(course) {
  if (course.archived_at) throw fail(403, 'COURSE_ARCHIVED');
}

/** Lecturers and admins see emails, join codes and other students' details. */
export const isStaff = (access) => access.courseRole === 'lecturer' || access.isAdmin;

/** An assignment with its course access, or 404. */
export async function assignmentAccess(q, user, assignmentId) {
  const { rows } = await q.query('SELECT * FROM assignments WHERE id = $1', [assignmentId]);
  if (!rows[0]) throw fail(404, 'NOT_FOUND');
  const access = await courseAccess(q, user, rows[0].course_id);
  return { ...access, assignment: rows[0] };
}

/**
 * A workspace with the caller's relation to it: members and the course's staff can see it.
 * Returns { workspace, assignment, course, courseRole, isAdmin, isMember }.
 */
export async function workspaceAccess(q, user, id) {
  const { rows } = await q.query(
    `SELECT w.*, EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = $2) AS is_member
       FROM workspaces w WHERE w.id = $1`,
    [id, user.uid]
  );
  const workspace = rows[0];
  if (!workspace) throw fail(404, 'NOT_FOUND');
  const { rows: a } = await q.query('SELECT * FROM assignments WHERE id = $1', [workspace.assignment_id]);
  const access = await courseAccess(q, user, a[0].course_id);
  if (!workspace.is_member && !isStaff(access)) throw fail(404, 'NOT_FOUND');
  return { ...access, workspace, assignment: a[0], isMember: workspace.is_member };
}

/** Members and lecturers can change a workspace only while it is open. */
export function mustBeOpen(workspace) {
  if (workspace.status !== 'open') throw fail(409, 'WORKSPACE_SUBMITTED');
}
