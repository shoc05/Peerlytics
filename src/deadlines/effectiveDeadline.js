// The deadline that counts for a group (step 4.6): a lecturer's extension, otherwise the
// original. Same rule as effectiveDeadlineMs in backend/src/jobs/deadlines/time.js.
export function effectiveDeadline(group) {
  return group?.extendedDeadline || group?.deadline || null;
}

export function isExtended(group) {
  return Boolean(group?.extendedDeadline);
}

/** datetime-local value ("2026-10-23T18:00", the browser's time) -> ISO string with offset. */
export function localInputToIso(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value || ''))) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
