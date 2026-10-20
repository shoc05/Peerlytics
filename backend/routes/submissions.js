// Tracking events, submissions and analysis (step 2.4). Shapes, roles and errors follow
// backend/openapi.yaml.
//
// Submitting: the backend reads the file and the tracking counts from Firestore itself,
// records the submission and locks the workspace (PostgreSQL and Firestore in one
// transaction), and only then runs the analysis. The analysis can fail or be unavailable;
// the submission still succeeds (CLAUDE.md).
import express from 'express';
import { z } from 'zod';
import { createUserRateLimit, fail, handler, parse, withTransaction } from './http.js';
import { ANY_ROLE } from './courseContext.js';
import { uuid, workspaceId as workspaceIdSchema } from './courseSchemas.js';
import { isStaff, mustTeach, workspaceAccess } from '../services/courses/access.js';
import { validateTrackingEvent } from '../services/analysis/validate.js';
import { wordCount } from '../services/analysis/text.js';
import { reportTabs } from '../src/tabs/reportTabs.js';
import * as map from '../services/submissions/mappers.js';

const RERUNS_PER_HOUR = 3;

const eventsBody = z.object({ events: z.array(z.unknown()).min(1).max(500) }).strict();
const submitBody = z
  .object({
    fileId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    // reportTabs() checks the list itself and drops a bad one: never fatal.
    tabs: z.unknown().optional(),
  })
  .strict();
const rerunBody = z.object({ provider: z.enum(['auto', 'openai', 'legacy']).default('auto') }).strict();

function idParam(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw fail(404, 'NOT_FOUND');
  return parsed.data;
}

const SUBMISSION_SELECT = `
  SELECT s.*, u.display_name AS submitted_by_name
    FROM submissions s LEFT JOIN users u ON u.id = s.submitted_by`;

/**
 * @param ctx  the course context (createCourseContext)
 * @param deps { analysis: createAnalysisService(...), store: createWorkspaceStore(...) }
 */
export function createSubmissionRouter(ctx, { analysis, store, submitLimit, eventLimit }) {
  const { db, guard, now } = ctx;
  const router = express.Router();
  const limitSubmit = submitLimit ?? createUserRateLimit({ max: 5, windowMs: 60_000, now });
  const limitEvents = eventLimit ?? createUserRateLimit({ max: 60, windowMs: 60_000, now });

  /** A member of an open workspace (students only reach this through guard('student')). */
  async function openWorkspaceForMember(req) {
    const access = await workspaceAccess(db.pool, req.user, idParam(workspaceIdSchema, req.params.workspaceId));
    if (!access.isMember) throw fail(403, 'FORBIDDEN');
    return access;
  }

  // ── Tracking events ──
  router.post(
    '/workspaces/:workspaceId/events',
    guard('student'),
    handler(async (req, res) => {
      limitEvents(req.user.uid);
      const access = await openWorkspaceForMember(req);
      if (access.workspace.status !== 'open') throw fail(409, 'WORKSPACE_SUBMITTED');
      const { events } = parse(eventsBody, req.body);
      const valid = events.filter((e) => validateTrackingEvent(e).valid);
      if (valid.length) await store.recordEvents(access.workspace.id, req.user.uid, valid);
      res.json({ accepted: valid.length, rejected: events.length - valid.length });
    })
  );

  // ── Submissions ──
  router.post(
    '/workspaces/:workspaceId/submission',
    guard('student'),
    handler(async (req, res) => {
      limitSubmit(req.user.uid);
      const access = await openWorkspaceForMember(req);
      const body = parse(submitBody, req.body);
      const workspaceId = access.workspace.id;

      const { rows: memberRows } = await db.pool.query('SELECT user_id FROM workspace_members WHERE workspace_id = $1 ORDER BY user_id', [workspaceId]);
      const source = await store.readSubmission(workspaceId, body.fileId, memberRows.map((m) => m.user_id));
      const nowIso = new Date(now()).toISOString();
      const tabs = reportTabs(body.tabs);

      const submissionId = await withTransaction(db.pool, async (q) => {
        // Lock the row so two members submitting at once can't both win.
        const { rows } = await q.query('SELECT status FROM workspaces WHERE id = $1 FOR UPDATE', [workspaceId]);
        if (rows[0].status === 'locked') throw fail(409, 'ALREADY_LOCKED', 'This workspace was already submitted and locked at its deadline.');
        if (rows[0].status !== 'open') throw fail(409, 'ALREADY_SUBMITTED', 'This workspace has already been submitted.');
        const inserted = await q.query(
          `INSERT INTO submissions (workspace_id, submitted_by, trigger, word_count, tabs, author_metrics, document_ref, submitted_at)
           VALUES ($1, $2, 'manual', $3, $4, $5, $6, $7) RETURNING id`,
          [
            workspaceId,
            req.user.uid,
            wordCount(source.text),
            tabs ? JSON.stringify(tabs) : null,
            JSON.stringify(source.authorMetrics),
            `groups/${workspaceId}/files/${body.fileId}`,
            nowIso,
          ]
        );
        await q.query(`UPDATE workspaces SET status = 'submitted', updated_at = now() WHERE id = $1`, [workspaceId]);
        const { rows: lecturers } = await q.query(
          `SELECT user_id FROM enrolments WHERE course_id = $1 AND course_role = 'lecturer' ORDER BY user_id`,
          [access.course.id]
        );
        await store.markSubmitted(workspaceId, {
          fileId: body.fileId,
          lecturerIds: lecturers.map((l) => l.user_id),
          submittedBy: req.user.uid,
          nowIso,
        });
        return inserted.rows[0].id;
      });

      // The submission is committed. Analysis runs after, and its failure is not the student's.
      let analysisRow = null;
      try {
        analysisRow = await analysis.run(db.pool, {
          submissionId,
          text: source.text,
          collegeId: access.course.college_id,
          courseId: access.course.id,
        });
      } catch (err) {
        console.error('[submission] analysis could not be saved:', err.message);
      }

      const { rows } = await db.pool.query(`${SUBMISSION_SELECT} WHERE s.id = $1`, [submissionId]);
      res.status(201).json({
        submission: map.submission(rows[0], { viewerUid: req.user.uid }),
        analysis: analysisRow ? map.analysisResult(analysisRow) : null,
      });
    })
  );

  router.get(
    '/workspaces/:workspaceId/submission',
    guard(...ANY_ROLE),
    handler(async (req, res) => {
      const access = await workspaceAccess(db.pool, req.user, idParam(workspaceIdSchema, req.params.workspaceId));
      const { rows } = await db.pool.query(`${SUBMISSION_SELECT} WHERE s.workspace_id = $1`, [access.workspace.id]);
      if (!rows[0]) throw fail(409, 'NOT_SUBMITTED', 'This workspace has not been submitted yet.');
      res.json(map.submission(rows[0], { viewerUid: isStaff(access) ? null : req.user.uid }));
    })
  );

  // ── Analysis ──
  async function submissionAccess(req) {
    const id = idParam(uuid, req.params.submissionId);
    const { rows } = await db.pool.query('SELECT * FROM submissions WHERE id = $1', [id]);
    if (!rows[0]) throw fail(404, 'NOT_FOUND');
    const access = await workspaceAccess(db.pool, req.user, rows[0].workspace_id);
    return { ...access, submission: rows[0] };
  }

  router.get(
    '/submissions/:submissionId/analysis',
    guard(...ANY_ROLE),
    handler(async (req, res) => {
      const { submission } = await submissionAccess(req);
      const { rows } = await db.pool.query(
        'SELECT * FROM analysis_results WHERE submission_id = $1 ORDER BY created_at DESC, id DESC',
        [submission.id]
      );
      if (!rows.length) throw fail(404, 'NOT_FOUND', 'There is no analysis for this submission yet.');
      res.json({ current: map.analysisResult(rows[0]), history: rows.map(map.analysisResult) });
    })
  );

  router.post(
    '/submissions/:submissionId/analysis',
    guard('lecturer'),
    handler(async (req, res) => {
      const access = await submissionAccess(req);
      mustTeach(access);
      const { provider } = parse(rerunBody, req.body);
      const { rows: recent } = await db.pool.query(
        `SELECT created_at FROM analysis_results
          WHERE submission_id = $1 AND created_at > now() - interval '1 hour'
          ORDER BY created_at`,
        [access.submission.id]
      );
      // The run made at submission time counts too: at most RERUNS_PER_HOUR in any hour.
      if (recent.length >= RERUNS_PER_HOUR) {
        const err = fail(429, 'RATE_LIMITED');
        err.retryAfter = Math.max(1, Math.ceil((new Date(recent[0].created_at).getTime() + 3_600_000 - now()) / 1000));
        throw err;
      }
      const text = await store.readSubmittedText(access.submission.document_ref);
      const row = await analysis.run(db.pool, {
        submissionId: access.submission.id,
        text,
        collegeId: access.course.college_id,
        courseId: access.course.id,
        provider,
      });
      res.status(201).json(map.analysisResult(row));
    })
  );

  return router;
}
