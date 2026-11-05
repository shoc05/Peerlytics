// Helpers for the admin area. No Firebase or React imports, so they run under `node --test`.

const pad = (n) => String(n).padStart(2, '0');

/** Today in the browser's time zone as YYYY-MM-DD, the format licence dates use. */
export function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 'none', 'upcoming', 'active' or 'expired'. A licence still counts on its last day. */
export function licenceStatus(licence, today = todayIso()) {
  if (!licence) return 'none';
  if (licence.startsOn > today) return 'upcoming';
  if (licence.endsOn && licence.endsOn < today) return 'expired';
  return 'active';
}

/** A short name for a new college, e.g. "College of Science" -> "college-of-science". */
export function slugFromName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/** The first problem with a new college's fields, or '' when they can be sent. */
export function collegeFormError({ name, slug }) {
  if (String(name || '').trim().length < 2) return 'Enter the college name.';
  if (!/^[a-z0-9-]{2,40}$/.test(slug || '')) return 'The short name can use 2 to 40 lower-case letters, digits or hyphens.';
  return '';
}

/** The first problem with a licence form, or '' when it can be sent. */
export function licenceFormError({ seats, monthlyAiBudgetUsd, startsOn, endsOn }) {
  if (!Number.isInteger(Number(seats)) || Number(seats) < 1) return 'Seats must be a whole number of at least 1.';
  if (monthlyAiBudgetUsd === '' || !(Number(monthlyAiBudgetUsd) >= 0)) return 'The monthly AI budget must be 0 or more.';
  if (!startsOn) return 'Choose a start date.';
  if (endsOn && endsOn <= startsOn) return 'The end date must be after the start date.';
  return '';
}

/** The licence form as the API expects it. */
export function licencePayload({ plan, seats, monthlyAiBudgetUsd, startsOn, endsOn }) {
  return { plan, seats: Number(seats), monthlyAiBudgetUsd: Number(monthlyAiBudgetUsd), startsOn, endsOn: endsOn || null };
}

/** Users whose name or email contains the search text, sorted by name. */
export function filterUsers(users, search) {
  const needle = String(search || '').trim().toLowerCase();
  return users
    .filter((u) => !needle || `${u.name || ''} ${u.email || ''}`.toLowerCase().includes(needle))
    .sort((a, b) => String(a.name || a.email || '').localeCompare(String(b.name || b.email || '')));
}

/** groups/{id}.submittedToLecturers lists who it was submitted to. */
export function isSubmitted(group) {
  const to = group?.submittedToLecturers;
  return Array.isArray(to) ? to.length > 0 : Boolean(to);
}

/** The names of the given user ids, falling back to the id so nobody disappears from the list. */
export function namesFor(ids, userById) {
  return (ids || []).map((id) => userById[id]?.name || userById[id]?.email || id);
}
