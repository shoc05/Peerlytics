// Zod schemas for the request bodies of the routes in this folder. Bodies are strict: an
// unknown top-level field is rejected. Items inside versions[] and pasteEvents[] are Firestore
// documents the browser forwards as they are, so only the fields the analysis reads are
// checked there and the rest are passed through.
import { z } from 'zod';
import { sendError, zodDetails } from '../src/auth/errors.js';

const MAX_TEXT = 500_000;
const id = z.string().max(256);

const versionItem = z.object({}).passthrough();
const pasteEventItem = z
  .object({
    contentSnippet: z.string().max(20_000).optional(),
    changeType: z.string().max(40).optional(),
  })
  .passthrough();

/** POST /api/check: what WorkspacePanel.jsx sends through submitForCheck. */
export const checkBody = z
  .object({
    text: z.string().max(MAX_TEXT).optional(),
    html: z.string().max(MAX_TEXT * 2).optional(),
    userId: id.optional(),
    fileId: id.optional(),
    groupId: id.optional(),
    fileName: z.string().max(512).optional(),
    studentName: z.string().max(256).optional(),
    // utils/difficultyDetection.js: 1–3 in steps of 0.1 (1.5 for spreadsheets).
    difficulty: z.number().min(0).max(10).optional(),
    versions: z.array(versionItem).max(5_000).optional(),
    pasteEvents: z.array(pasteEventItem).max(5_000).optional(),
    // Not checked here on purpose: reportTabs() (src/tabs/reportTabs.js) validates the tab list
    // with its own Zod schema and drops a bad one, so a bad tab list never fails a submission.
    tabs: z.unknown().optional(),
  })
  .strict();

/** POST /api/analyze */
export const analyzeBody = z.object({ text: z.string().max(MAX_TEXT) }).strict();

/** Express middleware: replace req.body with the parsed body, or answer 400 INVALID_BODY. */
export function validateBody(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) return sendError(res, 400, 'INVALID_BODY', zodDetails(parsed.error));
    req.body = parsed.data;
    next();
  };
}
