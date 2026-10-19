// Assignment deadlines typed as dd/mm/yyyy plus a 24-hour hh:mm time, in the user's time zone.
// Display uses formatDate / formatDateTime from utils/workspaceHelpers (also dd/mm/yyyy).
const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** "dd/mm/yyyy" -> local midnight Date, or null for malformed or impossible dates (31/02). */
export function parseDate(text) {
  const m = DATE_RE.exec(String(text ?? '').trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

/**
 * Date and time text -> { deadline, error }. deadline is a Date in the future, or null;
 * error is a string key in ./strings.js.
 */
export function buildDeadline(dateText, timeText, now = Date.now()) {
  const day = parseDate(dateText);
  if (!day) return { deadline: null, error: 'dateInvalid' };
  const t = TIME_RE.exec(String(timeText ?? '').trim());
  if (!t) return { deadline: null, error: 'timeInvalid' };
  const deadline = new Date(day);
  deadline.setHours(Number(t[1]), Number(t[2]), 0, 0);
  if (deadline.getTime() <= now) return { deadline: null, error: 'deadlinePast' };
  return { deadline, error: null };
}
