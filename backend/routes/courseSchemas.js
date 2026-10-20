// Zod schemas for the course, enrolment, announcement, assignment and group routes. Each one
// matches its component in backend/openapi.yaml; bodies are .strict() (additionalProperties: false).
import { z } from 'zod';

export const uuid = z.string().uuid();
export const uid = z.string().min(1).max(128);
export const workspaceId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const nullableText = (max) => z.string().trim().max(max).nullable();

// ── Courses ──
const courseFields = {
  code: z.string().trim().min(2).max(20),
  title: z.string().trim().min(2).max(200),
  description: nullableText(5000).optional(),
  term: nullableText(40).optional(),
};

export const courseCreate = z.object(courseFields).strict();

export const courseUpdate = z
  .object({
    ...Object.fromEntries(Object.entries(courseFields).map(([k, v]) => [k, v.optional()])),
    joinCodeEnabled: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Send at least one field to change.' });

export const listCoursesQuery = z
  .object({ includeArchived: z.enum(['true', 'false']).optional() })
  .strict()
  .transform((q) => ({ includeArchived: q.includeArchived === 'true' }));

export const joinBody = z.object({ joinCode: z.string().min(8).max(12) }).strict();

// ── Announcements ──
export const announcementCreate = z
  .object({
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(10000),
    pinned: z.boolean().optional(),
  })
  .strict();

export const announcementUpdate = announcementCreate
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Send at least one field to change.' });

// ── Assignments ──
const hundredths = (n) => Math.round(n * 100);
const weight = z
  .number()
  .min(0)
  .max(1)
  .refine((n) => Math.abs(n * 100 - hundredths(n)) < 1e-9, { message: 'Use steps of 0.01.' });

export const DEFAULT_WEIGHTS = Object.freeze({ time: 0.25, edits: 0.25, writing: 0.25, tasks: 0.25 });

export const rubricWeights = z
  .object({ time: weight, edits: weight, writing: weight, tasks: weight })
  .strict()
  .refine((w) => hundredths(w.time) + hundredths(w.edits) + hundredths(w.writing) + hundredths(w.tasks) === 100, {
    message: 'The four weights must add up to 1.00.',
  });

const assignmentFields = {
  title: z.string().trim().min(2).max(200),
  brief: z.string().trim().min(1).max(20000),
  deadline: z.string().datetime({ offset: true }),
  weights: rubricWeights,
  timeCapMinutes: z.number().int().min(1).max(10000).nullable(),
  groupSize: z.number().int().min(1).max(20).nullable(),
};

export const assignmentCreate = z
  .object({
    title: assignmentFields.title,
    brief: assignmentFields.brief,
    deadline: assignmentFields.deadline,
    weights: assignmentFields.weights.optional(),
    timeCapMinutes: assignmentFields.timeCapMinutes.optional(),
    groupSize: assignmentFields.groupSize.optional(),
  })
  .strict();

export const assignmentUpdate = z
  .object(Object.fromEntries(Object.entries(assignmentFields).map(([k, v]) => [k, v.optional()])))
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Send at least one field to change.' });

// ── Groups ──
export const workspaceCreate = z
  .object({
    name: z.string().trim().min(1).max(100),
    memberIds: z.array(uid).max(20).optional(),
  })
  .strict()
  .refine((b) => !b.memberIds || new Set(b.memberIds).size === b.memberIds.length, {
    message: 'A student is listed twice.',
    path: ['memberIds'],
  });

export const workspaceRename = z.object({ name: z.string().trim().min(1).max(100) }).strict();
export const addMemberBody = z.object({ userId: uid }).strict();

export const gradesQuery = z.object({ assignmentId: uuid.optional() }).strict();
