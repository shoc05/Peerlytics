// Deadline maths for the server-side lock. Pure functions, so tests can pass any "now".
//
// Stored deadlines come in several shapes today: an ISO string with a zone (workspace
// settings), a datetime-local string with no zone ("2026-10-20T23:59", group creation), a
// date-only string, a Firestore Timestamp, a Date or epoch ms. The browser countdown reads a
// zone-less datetime in the student's local time, so the server reads it in the college's
// time zone (DEADLINE_TIMEZONE, default Asia/Thimphu) rather than the server's, which is
// usually UTC. Date-only strings are UTC midnight, exactly as `new Date()` reads them in the
// browser, so the server never locks before the countdown reaches zero.

export const DEFAULT_TIMEZONE = 'Asia/Thimphu';

const NAIVE_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;

function zoneOffsetMs(utcMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const n = (type) => Number(parts.find((p) => p.type === type).value);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - utcMs;
}

/** Wall-clock time in `timeZone` -> epoch ms. Two passes handle DST edges. */
function zonedToUtcMs([y, mo, d, h, mi, s], timeZone) {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  let utc = wall - zoneOffsetMs(wall, timeZone);
  utc = wall - zoneOffsetMs(utc, timeZone);
  return utc;
}

/** Any stored deadline value -> epoch ms, or null if missing or unreadable. */
export function toMs(value, timeZone = DEFAULT_TIMEZONE) {
  if (value == null || value === '') return null;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const m = NAIVE_DATETIME.exec(value.trim());
    if (m) return zonedToUtcMs([m[1], m[2], m[3], m[4], m[5], m[6] || 0].map(Number), timeZone);
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * The deadline that counts for a group: its extension (step 4.6 writes `extendedDeadline`)
 * when there is one, otherwise `deadline`.
 */
export function effectiveDeadlineMs(group, timeZone = DEFAULT_TIMEZONE) {
  return toMs(group?.extendedDeadline, timeZone) ?? toMs(group?.deadline, timeZone);
}

/** True when a group is past its deadline and not locked yet. */
export function isDue(group, nowMs, timeZone = DEFAULT_TIMEZONE) {
  if (!group || group.locked === true) return false;
  const deadlineMs = effectiveDeadlineMs(group, timeZone);
  return deadlineMs != null && nowMs >= deadlineMs;
}
