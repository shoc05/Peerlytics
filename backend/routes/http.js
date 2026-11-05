// Small helpers shared by the course routes: error bodies, Zod checks, async handlers,
// transactions and a per-user rate limit. Errors follow backend/openapi.yaml:
// { error: <for people>, code: <for programs>, details? }.
import { zodDetails } from '../src/auth/errors.js';

const MESSAGES = {
  INVALID_BODY: 'The request is not valid.',
  NOT_FOUND: 'Not found.',
  FORBIDDEN: 'You do not have permission to do this.',
  CONFLICT: 'That conflicts with something that already exists.',
  INVALID_JOIN_CODE: 'No course has that join code. Check it with your lecturer.',
  JOIN_DISABLED: 'This course is not accepting new students right now.',
  ALREADY_ENROLLED: 'You are already enrolled in this course.',
  NOT_ENROLLED: 'Every member must be a student enrolled in this course.',
  ALREADY_IN_GROUP: 'A student is already in a group for this assignment.',
  HAS_SUBMISSIONS: 'This assignment has submissions, so it cannot be deleted.',
  WORKSPACE_SUBMITTED: 'This workspace has been submitted and can no longer be changed.',
  DEADLINE_IN_PAST: 'The deadline must be in the future.',
  COURSE_ARCHIVED: 'This course is archived. Unarchive it to make changes.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  DB_UNAVAILABLE: 'The database is not available right now. Please try again later.',
  FIRESTORE_UNAVAILABLE: 'Workspace storage is not configured on the server.',
};

/** An error a handler can throw to answer with a specific status and code. */
export class HttpError extends Error {
  constructor(status, code, message = MESSAGES[code], details) {
    super(message || 'Request failed.');
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const fail = (status, code, message) => new HttpError(status, code, message);

/** Wrap an async handler so a thrown HttpError becomes its JSON answer and anything else goes to next(). */
export function handler(fn) {
  return (req, res, next) =>
    Promise.resolve(fn(req, res)).catch((err) => {
      if (err instanceof HttpError) {
        const body = { error: err.message, code: err.code };
        if (err.details) body.details = err.details;
        if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
        return res.status(err.status).json(body);
      }
      return next(err);
    });
}

/** Parse `value` with a Zod schema or throw 400 INVALID_BODY with the issue paths. */
export function parse(schema, value) {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw new HttpError(400, 'INVALID_BODY', MESSAGES.INVALID_BODY, zodDetails(parsed.error));
  return parsed.data;
}

/** Run fn(client) inside BEGIN/COMMIT, rolling back on any error. */
export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Middleware: 503 when the API runs without DATABASE_URL. */
export function requireDb(db) {
  return (_req, res, next) => {
    if (db.pool) return next();
    return res.status(503).json({ error: MESSAGES.DB_UNAVAILABLE, code: 'DB_UNAVAILABLE' });
  };
}

/**
 * At most `max` calls per user per `windowMs`. In memory, so per instance: enough to stop
 * join codes being guessed from one account. Throws 429 RATE_LIMITED with Retry-After.
 */
export function createUserRateLimit({ max, windowMs, now = Date.now }) {
  const hits = new Map(); // uid -> timestamps inside the window
  return function check(uid) {
    const t = now();
    const recent = (hits.get(uid) || []).filter((at) => t - at < windowMs);
    if (recent.length >= max) {
      const err = new HttpError(429, 'RATE_LIMITED');
      err.retryAfter = Math.max(1, Math.ceil((recent[0] + windowMs - t) / 1000));
      hits.set(uid, recent);
      throw err;
    }
    recent.push(t);
    hits.set(uid, recent);
    if (hits.size > 10_000) hits.clear(); // bound memory; worst case a user gets a fresh window
  };
}

/** PostgreSQL unique violation on a named constraint. */
export const isUniqueViolation = (err, constraint) =>
  err?.code === '23505' && (!constraint || err.constraint === constraint);
