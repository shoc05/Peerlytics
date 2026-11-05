// Assignments (brief, deadline, rubric weights), group workspaces and their members (step 2.1).
// Shapes, roles and errors follow backend/openapi.yaml. Every change to a workspace's name,
// members or deadline is copied to its Firestore groups/{id} document in the same transaction.
import express from 'express';
import { fail, handler, isUniqueViolation, parse, withTransaction } from './http.js';
import { ANY_ROLE } from './courseContext.js';
import {
  addMemberBody,
  assignmentCreate,
  assignmentUpdate,
  DEFAULT_WEIGHTS,
  uid as uidSchema,
  uuid,
  workspaceCreate,
  workspaceId as workspaceIdSchema,
  workspaceRename,
} from './courseSchemas.js';
import { assignmentAccess, courseAccess, isStaff, mustBeActive, mustBeOpen, mustTeach, workspaceAccess } from '../services/courses/access.js';
import { newWorkspaceId } from '../services/courses/groupMirror.js';
import * as map from '../services/courses/mappers.js';

function idParam(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw fail(404, 'NOT_FOUND');
  return parsed.data;
}

/**
 * Assignments with their counts. `studentUid` adds myWorkspaceId and the effective deadline
 * (the group's latest extension, else the assignment deadline) for that student.
 */
async function loadAssignments(q, { courseId, assignmentId }, studentUid) {
  const studentCols = studentUid
    ? `, (SELECT m.workspace_id FROM workspace_members m WHERE m.assignment_id = a.id AND m.user_id = $2) AS my_workspace_id,
         (SELECT ge.deadline FROM group_extensions ge
            JOIN workspace_members m ON m.workspace_id = ge.workspace_id
           WHERE m.assignment_id = a.id AND m.user_id = $2
           ORDER BY ge.created_at DESC LIMIT 1) AS my_effective_deadline`
    : '';
  const { rows } = await q.query(
    `SELECT a.*,
            (SELECT count(*) FROM workspaces w WHERE w.assignment_id = a.id) AS group_count,
            (SELECT count(*) FROM submissions s JOIN workspaces w ON w.id = s.workspace_id WHERE w.assignment_id = a.id) AS submitted_count
            ${studentCols}
       FROM assignments a
      WHERE ${courseId ? 'a.course_id' : 'a.id'} = $1
      ORDER BY a.deadline, a.title`,
    studentUid ? [courseId ?? assignmentId, studentUid] : [courseId ?? assignmentId]
  );
  return rows;
}

/** Workspaces matching `where` (SQL on w/a, using $1...) with members; emails for staff only. */
async function loadWorkspaces(q, where, params, { withEmail }) {
  const { rows } = await q.query(
    `SELECT w.*, a.course_id, a.deadline, s.submitted_at,
            (SELECT ge.deadline FROM group_extensions ge WHERE ge.workspace_id = w.id ORDER BY ge.created_at DESC LIMIT 1) AS effective_deadline
       FROM workspaces w
       JOIN assignments a ON a.id = w.assignment_id
       LEFT JOIN submissions s ON s.workspace_id = w.id
      WHERE ${where}
      ORDER BY a.deadline, w.name`,
    params
  );
  if (rows.length === 0) return [];
  const { rows: members } = await q.query(
    `SELECT m.workspace_id, u.id, u.display_name, u.email
       FROM workspace_members m JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = ANY($1)
      ORDER BY u.display_name, u.id`,
    [rows.map((r) => r.id)]
  );
  return rows.map((r) =>
    map.workspace(
      r,
      members.filter((m) => m.workspace_id === r.id),
      { withEmail }
    )
  );
}

const loadWorkspace = async (q, id, opts) => (await loadWorkspaces(q, 'w.id = $1', [id], opts))[0];

/** 400 NOT_ENROLLED unless every uid is a student in the course. */
async function mustBeStudents(q, courseId, uids) {
  if (uids.length === 0) return;
  const { rows } = await q.query(
    `SELECT count(*)::int AS n FROM enrolments WHERE course_id = $1 AND course_role = 'student' AND user_id = ANY($2)`,
    [courseId, uids]
  );
  if (rows[0].n !== uids.length) throw fail(400, 'NOT_ENROLLED');
}

/** Turn the membership unique constraints into the contract's 409s. */
function membershipConflict(err) {
  if (isUniqueViolation(err, 'workspace_members_one_group_per_assignment') || isUniqueViolation(err, 'workspace_members_pkey')) {
    return fail(409, 'ALREADY_IN_GROUP');
  }
  if (isUniqueViolation(err, 'workspaces_assignment_name_key')) {
    return fail(409, 'CONFLICT', 'Another group in this assignment already has that name.');
  }
  return err;
}

export function createAssignmentRouter(ctx) {
  const { db, guard, mirror, now, random } = ctx;
  const router = express.Router();

  const mustBeFuture = (deadline) => {
    if (Date.parse(deadline) <= now()) throw fail(400, 'DEADLINE_IN_PAST');
  };

  // ── Assignments ──
  router.get(
    '/courses/:courseId/assignments',
    guard(...ANY_ROLE),
    handler(async (req, res) => {
      const access = await courseAccess(db.pool, req.user, idParam(uuid, req.params.courseId));
      const student = access.courseRole === 'student' ? req.user.uid : null;
      const rows = await loadAssignments(db.pool, { courseId: access.course.id }, student);
      res.json({ assignments: rows.map(map.assignment) });
    })
  );

  router.post(
    '/courses/:courseId/assignments',
    guard('lecturer'),
    handler(async (req, res) => {
      const access = await courseAccess(db.pool, req.user, idParam(uuid, req.params.courseId));
      mustTeach(access);
      mustBeActive(access.course);
      const body = parse(assignmentCreate, req.body);
      mustBeFuture(body.deadline);
      const w = body.weights ?? DEFAULT_WEIGHTS;
      const { rows } = await db.pool.query(
        `INSERT INTO assignments (course_id, title, brief, deadline, weight_time, weight_edits, weight_writing, weight_tasks,
                                  time_cap_minutes, group_size, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [access.course.id, body.title, body.brief, body.deadline, w.time, w.edits, w.writing, w.tasks,
          body.timeCapMinutes ?? null, body.groupSize ?? null, req.user.uid]
      );
      const [row] = await loadAssignments(db.pool, { assignmentId: rows[0].id });
      res.status(201).json(map.assignment(row));
    })
  );

  router.get(
    '/assignments/:assignmentId',
    guard(...ANY_ROLE),
    handler(async (req, res) => {
      const access = await assignmentAccess(db.pool, req.user, idParam(uuid, req.params.assignmentId));
      const student = access.courseRole === 'student' ? req.user.uid : null;
      const [row] = await loadAssignments(db.pool, { assignmentId: access.assignment.id }, student);
      res.json(map.assignment(row));
    })
  );

  router.patch(
    '/assignments/:assignmentId',
    guard('lecturer'),
    handler(async (req, res) => {
      const access = await assignmentAccess(db.pool, req.user, idParam(uuid, req.params.assignmentId));
      mustTeach(access);
      mustBeActive(access.course);
      const body = parse(assignmentUpdate, req.body);
      if (body.deadline !== undefined) mustBeFuture(body.deadline);

      const columns = { title: 'title', brief: 'brief', deadline: 'deadline', timeCapMinutes: 'time_cap_minutes', groupSize: 'group_size' };
      const sets = [];
      const values = [access.assignment.id];
      const set = (column, value) => {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
      };
      for (const [field, column] of Object.entries(columns)) if (body[field] !== undefined) set(column, body[field]);
      if (body.weights) {
        set('weight_time', body.weights.time);
        set('weight_edits', body.weights.edits);
        set('weight_writing', body.weights.writing);
        set('weight_tasks', body.weights.tasks);
      }

      await withTransaction(db.pool, async (q) => {
        await q.query(`UPDATE assignments SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, values);
        if (body.deadline !== undefined) {
          // The editor, the deadline job and the reminders read the deadline from Firestore.
          // A group's own extension (extendedDeadline) still wins over it.
          const { rows } = await q.query('SELECT id FROM workspaces WHERE assignment_id = $1', [access.assignment.id]);
          const deadline = new Date(body.deadline).toISOString();
          for (const { id } of rows) await mirror.update(id, { deadline });
        }
      });
      const [row] = await loadAssignments(db.pool, { assignmentId: access.assignment.id });
      res.json(map.assignment(row));
    })
  );

  router.delete(
    '/assignments/:assignmentId',
    guard('lecturer'),
    handler(async (req, res) => {
      const access = await assignmentAccess(db.pool, req.user, idParam(uuid, req.params.assignmentId));
      mustTeach(access);
      mustBeActive(access.course);
      await withTransaction(db.pool, async (q) => {
        const { rows: subs } = await q.query(
          `SELECT 1 FROM submissions s JOIN workspaces w ON w.id = s.workspace_id WHERE w.assignment_id = $1 LIMIT 1`,
          [access.assignment.id]
        );
        if (subs.length) throw fail(409, 'HAS_SUBMISSIONS');
        const { rows } = await q.query('SELECT id FROM workspaces WHERE assignment_id = $1', [access.assignment.id]);
        await q.query('DELETE FROM assignments WHERE id = $1', [access.assignment.id]);
        for (const { id } of rows) await mirror.remove(id);
      });
      res.status(204).end();
    })
  );

  // ── Groups ──
  router.get(
    '/assignments/:assignmentId/groups',
    guard(...ANY_ROLE),
    handler(async (req, res) => {
      const access = await assignmentAccess(db.pool, req.user, idParam(uuid, req.params.assignmentId));
      const staff = isStaff(access);
      const groups = await loadWorkspaces(db.pool, 'w.assignment_id = $1', [access.assignment.id], { withEmail: staff });
      let ungroupedStudents = [];
      if (staff) {
        const { rows } = await db.pool.query(
          `SELECT u.id, u.display_name, u.email
             FROM enrolments e JOIN users u ON u.id = e.user_id
            WHERE e.course_id = $1 AND e.course_role = 'student'
              AND NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.assignment_id = $2 AND m.user_id = e.user_id)
            ORDER BY u.display_name, u.id`,
          [access.course.id, access.assignment.id]
        );
        ungroupedStudents = rows.map((r) => map.userRef(r, { withEmail: true }));
      }
      res.json({ groups, ungroupedStudents });
    })
  );

  router.post(
    '/assignments/:assignmentId/groups',
    guard('lecturer'),
    handler(async (req, res) => {
      const access = await assignmentAccess(db.pool, req.user, idParam(uuid, req.params.assignmentId));
      mustTeach(access);
      mustBeActive(access.course);
      const body = parse(workspaceCreate, req.body);
      const memberIds = body.memberIds ?? [];
      const id = newWorkspaceId(random);

      try {
        await withTransaction(db.pool, async (q) => {
          await mustBeStudents(q, access.course.id, memberIds);
          await q.query(
            `INSERT INTO workspaces (id, assignment_id, name, created_via, created_by) VALUES ($1, $2, $3, 'manual', $4)`,
            [id, access.assignment.id, body.name, req.user.uid]
          );
          for (const uid of memberIds) {
            await q.query('INSERT INTO workspace_members (workspace_id, user_id, assignment_id) VALUES ($1, $2, $3)', [
              id,
              uid,
              access.assignment.id,
            ]);
          }
          const { rows: lecturers } = await q.query(
            `SELECT user_id FROM enrolments WHERE course_id = $1 AND course_role = 'lecturer' ORDER BY user_id`,
            [access.course.id]
          );
          await mirror.create({
            id,
            name: body.name,
            deadline: map.iso(access.assignment.deadline),
            memberIds,
            lecturerIds: lecturers.map((l) => l.user_id),
            courseId: access.course.id,
            assignmentId: access.assignment.id,
          });
        });
      } catch (err) {
        throw membershipConflict(err);
      }
      res.status(201).json(await loadWorkspace(db.pool, id, { withEmail: true }));
    })
  );

  router.get(
    '/me/workspaces',
    guard('student'),
    handler(async (req, res) => {
      const workspaces = await loadWorkspaces(
        db.pool,
        'w.id IN (SELECT workspace_id FROM workspace_members WHERE user_id = $1)',
        [req.user.uid],
        { withEmail: false }
      );
      res.json({ workspaces });
    })
  );

  // ── Workspaces ──
  router.get(
    '/workspaces/:workspaceId',
    guard(...ANY_ROLE),
    handler(async (req, res) => {
      const access = await workspaceAccess(db.pool, req.user, idParam(workspaceIdSchema, req.params.workspaceId));
      res.json(await loadWorkspace(db.pool, access.workspace.id, { withEmail: isStaff(access) }));
    })
  );

  async function workspaceForLecturer(req) {
    const access = await workspaceAccess(db.pool, req.user, idParam(workspaceIdSchema, req.params.workspaceId));
    mustTeach(access);
    mustBeActive(access.course);
    return access;
  }

  router.patch(
    '/workspaces/:workspaceId',
    guard('lecturer'),
    handler(async (req, res) => {
      const access = await workspaceForLecturer(req);
      const { name } = parse(workspaceRename, req.body);
      try {
        await withTransaction(db.pool, async (q) => {
          await q.query('UPDATE workspaces SET name = $2, updated_at = now() WHERE id = $1', [access.workspace.id, name]);
          await mirror.update(access.workspace.id, { name });
        });
      } catch (err) {
        throw membershipConflict(err);
      }
      res.json(await loadWorkspace(db.pool, access.workspace.id, { withEmail: true }));
    })
  );

  router.post(
    '/workspaces/:workspaceId/members',
    guard('lecturer'),
    handler(async (req, res) => {
      const access = await workspaceForLecturer(req);
      mustBeOpen(access.workspace);
      const { userId } = parse(addMemberBody, req.body);
      try {
        await withTransaction(db.pool, async (q) => {
          await mustBeStudents(q, access.course.id, [userId]);
          await q.query('INSERT INTO workspace_members (workspace_id, user_id, assignment_id) VALUES ($1, $2, $3)', [
            access.workspace.id,
            userId,
            access.workspace.assignment_id,
          ]);
          await mirror.addMember(access.workspace.id, userId);
        });
      } catch (err) {
        throw membershipConflict(err);
      }
      res.json(await loadWorkspace(db.pool, access.workspace.id, { withEmail: true }));
    })
  );

  router.delete(
    '/workspaces/:workspaceId/members/:uid',
    guard('lecturer'),
    handler(async (req, res) => {
      const access = await workspaceForLecturer(req);
      mustBeOpen(access.workspace);
      const target = idParam(uidSchema, req.params.uid);
      await withTransaction(db.pool, async (q) => {
        const removed = await q.query('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [
          access.workspace.id,
          target,
        ]);
        if (removed.rowCount === 0) throw fail(404, 'NOT_FOUND');
        // Their tasks become unowned; their edits stay in the document history.
        await q.query('UPDATE tasks SET owner_id = NULL, updated_at = now() WHERE workspace_id = $1 AND owner_id = $2', [
          access.workspace.id,
          target,
        ]);
        await mirror.removeMember(access.workspace.id, target);
      });
      res.status(204).end();
    })
  );

  return router;
}
