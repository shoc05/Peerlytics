// Labels, formatting and form checks for the billing screens. No React or Firebase imports, so
// they run under `node --test`. The backend checks everything again; these are for clear messages.

export const STATUS_TEXT = {
  active: 'Active',
  grace: 'Grace period',
  read_only: 'Read-only',
  revoked: 'Revoked',
  none: 'No subscription',
};

export const REQUEST_STATUS_TEXT = {
  pending: 'Waiting for review',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

/** Tone for a status pill: 'good', 'warn', 'bad' or 'muted'. */
export function statusTone(status) {
  if (status === 'active' || status === 'approved') return 'good';
  if (status === 'grace' || status === 'pending') return 'warn';
  if (status === 'read_only' || status === 'revoked' || status === 'rejected') return 'bad';
  return 'muted';
}

/** Ngultrum, e.g. "Nu. 25,000" or "Nu. 1,500.50". */
export function formatNu(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  const hasCents = Math.round(n * 100) % 100 !== 0;
  return `Nu. ${n.toLocaleString('en-IN', { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** "9 Nov 2026" from an ISO date or timestamp; '—' when empty. */
export function formatDate(value) {
  if (!value) return '—';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Thimphu' });
}

/** Whole days from now until `value` (negative once it has passed). */
export function daysUntil(value, now = Date.now()) {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - now) / 864e5);
}

export const normaliseJournal = (value) => String(value ?? '').replace(/\s+/g, '').toUpperCase();

/** Today's date (YYYY-MM-DD) in Bhutan. */
export function todayInBhutan(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Thimphu', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** The first problem with the payment form, or '' when it can be sent. */
export function paymentFormError({ planId, paymentMethodId, journalNumber, paidOn }, today = todayInBhutan()) {
  if (!planId) return 'Choose a plan.';
  if (!paymentMethodId) return 'Choose how you paid.';
  if (!/^[A-Z0-9-]{4,40}$/.test(normaliseJournal(journalNumber))) return 'Enter the journal number from your payment, using 4 to 40 letters, digits or hyphens.';
  if (!paidOn) return 'Choose the date you paid.';
  if (paidOn > today) return 'The payment date cannot be in the future.';
  return '';
}

/** The payment form as the API expects it; the amount is the plan's price. */
export function paymentPayload(form, plan) {
  return {
    planId: form.planId,
    paymentMethodId: form.paymentMethodId,
    amountNu: plan.priceNu,
    journalNumber: normaliseJournal(form.journalNumber),
    paidOn: form.paidOn,
  };
}

const wholeNumber = (value, min, max) => {
  const n = Number(value);
  return String(value).trim() !== '' && Number.isInteger(n) && n >= min && n <= max;
};

/** The first problem with a new plan, or ''. */
export function planFormError({ name, priceNu, durationDays, seats, maxCourses, monthlyAiAnalyses }) {
  if (String(name || '').trim().length < 2) return 'Enter a plan name.';
  const price = Number(priceNu);
  if (!(price > 0) || Math.abs(Math.round(price * 100) - price * 100) > 1e-6) return 'The price must be more than 0, with at most two decimals.';
  if (!wholeNumber(durationDays, 1, 1100)) return 'The length must be 1 to 1100 days.';
  if (!wholeNumber(seats, 1, 100000)) return 'Seats must be a whole number of at least 1.';
  if (String(maxCourses ?? '').trim() !== '' && !wholeNumber(maxCourses, 1, 1000)) return 'Courses per seat must be 1 to 1000, or left empty for no limit.';
  if (String(monthlyAiAnalyses ?? '').trim() !== '' && !wholeNumber(monthlyAiAnalyses, 0, 10_000_000)) return 'AI analyses a month must be 0 or more, or left empty for no limit.';
  return '';
}

export function planPayload({ name, priceNu, durationDays, seats, maxCourses, monthlyAiAnalyses, manualOnly }) {
  const optional = (v) => (String(v ?? '').trim() === '' ? null : Number(v));
  return {
    name: String(name).trim(),
    priceNu: Number(priceNu),
    durationDays: Number(durationDays),
    seats: Number(seats),
    maxCourses: optional(maxCourses),
    monthlyAiAnalyses: optional(monthlyAiAnalyses),
    manualOnly: Boolean(manualOnly),
  };
}

/** A reason the backend will accept (5 to 500 characters), or an error message. */
export function reasonError(reason) {
  const n = String(reason || '').trim().length;
  if (n < 5) return 'Give a reason of at least 5 characters.';
  if (n > 500) return 'Keep the reason under 500 characters.';
  return '';
}

/** Short words for what a lecturer's plan status means, or null when nothing needs saying. */
export function coverageMessage(billing) {
  if (!billing?.billingEnabled || !billing.coverage) return null;
  const c = billing.coverage;
  if (c.reason === 'NO_SEAT') {
    return { tone: 'warn', text: 'You do not have a seat yet. Ask your college admin to give you one before you create courses or projects.' };
  }
  if (c.status === 'grace') {
    return { tone: 'warn', text: `Your college's plan has ended. You can keep working until ${formatDate(c.graceEndsAt)}, then courses become read-only until it is renewed.` };
  }
  if (!c.covered) {
    return { tone: 'bad', text: "Your college's plan has ended, so your courses are read-only. You can still view and export work. Ask your college admin to renew." };
  }
  if (c.seatRemovedAt) {
    return { tone: 'warn', text: 'Your seat was removed. Your courses become read-only in a few days unless your college admin gives it back.' };
  }
  const left = daysUntil(c.paidUntil);
  if (left != null && left <= 7) return { tone: 'warn', text: `Your college's plan ends on ${formatDate(c.paidUntil)}.` };
  return null;
}

/** Human words for billing error codes from the API; falls back to the server's message. */
export function billingErrorText(err) {
  if (!err) return '';
  if (err.status === 0) return 'Could not reach the Peerlytics server. Check your connection and try again.';
  return err.message || 'Something went wrong. Please try again.';
}
