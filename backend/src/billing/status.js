// A college's subscription status, worked out from its subscription rows (docs/billing.md).
// Pure functions: no database, so they are unit-tested on their own and used by the store.
//
//   active     a non-revoked subscription covers now
//   grace      the last one ended less than grace_days ago
//   read_only  later than that
//   revoked    nothing else, and at least one was revoked
//   none       never had one

const DAY_MS = 24 * 60 * 60 * 1000;
const time = (value) => new Date(value).getTime();

/**
 * @param {Array<{ id, planId, startsAt, endsAt, revokedAt }>} subscriptions
 * @returns {{ status, subscription, paidUntil, graceEndsAt }}
 *   subscription: the row whose plan applies (the covering one, or in grace the one that ended).
 *   paidUntil: the latest end of any non-revoked subscription, for display and renewals.
 */
export function collegeStatus(subscriptions, { now = new Date(), graceDays = 7 } = {}) {
  const t = time(now);
  const live = subscriptions.filter((s) => !s.revokedAt);
  const paidUntil = live.length ? new Date(Math.max(...live.map((s) => time(s.endsAt)))) : null;

  const covering = live
    .filter((s) => time(s.startsAt) <= t && t <= time(s.endsAt))
    .sort((a, b) => time(b.startsAt) - time(a.startsAt))[0];
  if (covering) return { status: 'active', subscription: covering, paidUntil, graceEndsAt: null };

  const ended = live.filter((s) => time(s.endsAt) < t).sort((a, b) => time(b.endsAt) - time(a.endsAt))[0];
  if (ended) {
    const graceEndsAt = new Date(time(ended.endsAt) + graceDays * DAY_MS);
    const status = t <= graceEndsAt.getTime() ? 'grace' : 'read_only';
    return { status, subscription: ended, paidUntil, graceEndsAt };
  }
  const status = subscriptions.some((s) => s.revokedAt) ? 'revoked' : 'none';
  return { status, subscription: null, paidUntil: null, graceEndsAt: null };
}

/** Covered means a lecturer with a seat may create and mark, and students may submit. */
export const isCovered = (status) => status === 'active' || status === 'grace';

/**
 * Where a new period starts: at the current end while active or in grace, otherwise now. So
 * renewing early never loses days, and renewing late doesn't pay for days already gone.
 */
export function renewalStart(info, now = new Date()) {
  return isCovered(info.status) && info.paidUntil ? new Date(info.paidUntil) : new Date(now);
}

export const addDays = (date, days) => new Date(time(date) + days * DAY_MS);

/**
 * A seat still counts for grace_days after it is removed, so a lecturer's courses don't stop
 * mid-week (spec section 2, "A course's access").
 */
export function seatCounts(seat, { now = new Date(), graceDays = 7 } = {}) {
  if (!seat) return false;
  if (!seat.removedAt) return true;
  return time(now) <= time(seat.removedAt) + graceDays * DAY_MS;
}

/** Journal numbers are stored upper case without spaces, so "jn 8989 2938" matches "JN89892938". */
export const normaliseJournal = (value) => String(value ?? '').replace(/\s+/g, '').toUpperCase();

/** Today's date (YYYY-MM-DD) in Bhutan, where the payments are made. */
export function todayInBhutan(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Thimphu', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** A server-made reference the payer puts in the transfer remarks, e.g. PL-7F3K9Q. */
const REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function makeReferenceCode(randomBytes) {
  const bytes = randomBytes(6);
  let code = '';
  for (const byte of bytes) code += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  return `PL-${code}`;
}
