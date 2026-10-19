// A group's task list (step 2.8): add, assign an owner, link a document tab, set a due date,
// tick done. Members only, and only while the workspace is open; after submission the list
// is frozen, and the course's lecturers can read it. The Tasks score uses it.
import express from 'express';
import { z } from 'zod';
import { fail, handler, parse } from './http.js';
import { uid, uuid, workspaceId as workspaceIdSchema } from './courseSchemas.js';
import { isStaff, mustBeOpen, workspaceAccess } from '../services/courses/access.js';
import { iso } from '../services/courses/mappers.js';

const tabId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const taskFields = {
  title: z.string().trim().min(1).max(200),
  ownerId: uid.nullable(),
  tabId: tabId.nullable(),
  dueAt: z.string().datetime({ offset: true }).nullable(),
};
const taskCreate = z
  .object({ title: taskFields.title, ownerId: taskFields.ownerId.optional(), tabId: taskFields.tabId.optional(), dueAt: taskFields.dueAt.optional() })
  .strict();
const taskUpdate = z
  .object({ ...Object.fromEntries(Object.entries(taskFields).map(([k, v]) => [k, v.optional()])), done: z.boolean().optional() })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Send at least one field to change.' });

const TASK_SELECT = `
  SELECT t.*, u.display_name AS owner_name
    FROM tasks t LEFT JOIN users u ON u.id = t.owner_id`;

function task(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    owner: row.owner_id ? { id: row.owner_id, displayName: row.owner_name } : null,
    tabId: row.tab_id,
    dueAt: iso(row.due_at),
    doneAt: iso(row.done_at),
    doneBy: row.done_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function idParam(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw fail(404, 'NOT_FOUND');
  return parsed.data;
}

export function createTaskRouter(ctx) {
  const { db, guard } = ctx;
  const router = express.Router();

  /** 400 NOT_A_MEMBER unless the new owner is in the workspace. */
  async function mustBeMember(workspaceId, ownerId) {
    if (ownerId == null) return;
    const { rowCount } = await db.pool.query('SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [workspaceId, ownerId]);
    if (rowCount === 0) throw fail(400, 'NOT_A_MEMBER', 'A task can only be assigned to a member of this group.');
  }

  /** The caller must be a member of an open workspace. */
  async function memberOfOpenWorkspace(req, workspaceId) {
    const access = await workspaceAccess(db.pool, req.user, workspaceId);
    if (!access.isMember) throw fail(403, 'FORBIDDEN');
    mustBeOpen(access.workspace);
    return access;
  }

  router.get(
    '/workspaces/:workspaceId/tasks',
    guard('student', 'lecturer'),
    handler(async (req, res) => {
      const access = await workspaceAccess(db.pool, req.user, idParam(workspaceIdSchema, req.params.workspaceId));
      // Lecturers see a workspace's contents only after submission.
      if (!access.isMember && isStaff(access) && access.workspace.status === 'open') {
        throw fail(409, 'NOT_SUBMITTED', 'This workspace has not been submitted yet.');
      }
      const { rows } = await db.pool.query(`${TASK_SELECT} WHERE t.workspace_id = $1 ORDER BY t.done_at NULLS FIRST, t.due_at NULLS LAST, t.created_at`, [
        access.workspace.id,
      ]);
      res.json({ tasks: rows.map(task) });
    })
  );

  router.post(
    '/workspaces/:workspaceId/tasks',
    guard('student'),
    handler(async (req, res) => {
      const access = await memberOfOpenWorkspace(req, idParam(workspaceIdSchema, req.params.workspaceId));
      const body = parse(taskCreate, req.body);
      await mustBeMember(access.workspace.id, body.ownerId);
      const { rows } = await db.pool.query(
        `INSERT INTO tasks (workspace_id, title, owner_id, tab_id, due_at, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [access.workspace.id, body.title, body.ownerId ?? null, body.tabId ?? null, body.dueAt ?? null, req.user.uid]
      );
      const created = await db.pool.query(`${TASK_SELECT} WHERE t.id = $1`, [rows[0].id]);
      res.status(201).json(task(created.rows[0]));
    })
  );

  async function taskForMember(req) {
    const id = idParam(uuid, req.params.taskId);
    const { rows } = await db.pool.query('SELECT workspace_id FROM tasks WHERE id = $1', [id]);
    if (!rows[0]) throw fail(404, 'NOT_FOUND');
    const access = await memberOfOpenWorkspace(req, rows[0].workspace_id);
    return { id, access };
  }

  router.patch(
    '/tasks/:taskId',
    guard('student'),
    handler(async (req, res) => {
      const { id, access } = await taskForMember(req);
      const body = parse(taskUpdate, req.body);
      if (body.ownerId !== undefined) await mustBeMember(access.workspace.id, body.ownerId);

      const columns = { title: 'title', ownerId: 'owner_id', tabId: 'tab_id', dueAt: 'due_at' };
      const sets = [];
      const values = [id];
      for (const [field, column] of Object.entries(columns)) {
        if (body[field] !== undefined) {
          values.push(body[field]);
          sets.push(`${column} = $${values.length}`);
        }
      }
      if (body.done === true) {
        // Ticking an already-done task keeps its original time and person.
        values.push(req.user.uid);
        sets.push(`done_at = COALESCE(done_at, now()), done_by = COALESCE(done_by, $${values.length})`);
      } else if (body.done === false) {
        sets.push('done_at = NULL, done_by = NULL');
      }
      await db.pool.query(`UPDATE tasks SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, values);
      const { rows } = await db.pool.query(`${TASK_SELECT} WHERE t.id = $1`, [id]);
      res.json(task(rows[0]));
    })
  );

  router.delete(
    '/tasks/:taskId',
    guard('student'),
    handler(async (req, res) => {
      const { id } = await taskForMember(req);
      await db.pool.query('DELETE FROM tasks WHERE id = $1', [id]);
      res.status(204).end();
    })
  );

  return router;
}
