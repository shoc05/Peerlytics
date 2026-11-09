// Plans, payment methods and settings, payment requests, subscriptions and seats in PostgreSQL
// (docs/billing.md). Every change writes its audit_log row in the same transaction, with the
// actor's users row (ensureUser runs before every billing route).
import { fail, withTransaction } from '../../routes/http.js';
import { addDays, collegeStatus, isCovered, makeReferenceCode, renewalStart, seatCounts, todayInBhutan } from './status.js';

const MAX_PENDING_PER_PAYER = 3;
const REFERENCE_TRIES = 5;
const DEFAULT_SETTINGS = Object.freeze({
  accountName: null,
  accountNumber: null,
  bank: null,
  qrImagePath: null,
  verificationMessage: null,
  refundPolicy: null,
  graceDays: 7,
  updatedAt: null,
});

const num = (value) => (value == null ? null : Number(value));
const iso = (value) => (value == null ? null : new Date(value).toISOString());

export const mapPlan = (r) => ({
  id: r.id,
  name: r.name,
  priceNu: num(r.price_nu),
  durationDays: r.duration_days,
  seats: r.seats,
  maxCourses: r.max_courses,
  monthlyAiAnalyses: r.monthly_ai_analyses,
  isActive: r.is_active,
  manualOnly: r.manual_only,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const mapMethod = (r) => ({ id: r.id, name: r.name, isActive: r.is_active });

const mapSettings = (r) =>
  r
    ? {
        accountName: r.account_name,
        accountNumber: r.account_number,
        bank: r.bank,
        qrImagePath: r.qr_image_path,
        verificationMessage: r.verification_message,
        refundPolicy: r.refund_policy,
        graceDays: r.grace_days,
        updatedAt: iso(r.updated_at),
      }
    : { ...DEFAULT_SETTINGS };

const mapSubscription = (r) => ({
  id: r.id,
  planId: r.plan_id,
  planName: r.plan_name,
  seats: r.plan_seats,
  maxCourses: r.plan_max_courses,
  startsAt: iso(r.starts_at),
  endsAt: iso(r.ends_at),
  grantType: r.grant_type,
  note: r.note,
  paymentRequestId: r.payment_request_id,
  revokedAt: iso(r.revoked_at),
  revokeReason: r.revoke_reason,
});

const REQUEST_SELECT = `
  SELECT r.*, r.paid_on::text AS paid_on_text,
         c.name AS college_name, p.name AS plan_name, m.name AS method_name,
         u.display_name AS payer_name, u.email AS payer_email
    FROM payment_requests r
    JOIN colleges c ON c.id = r.college_id
    JOIN plans p ON p.id = r.plan_id
    JOIN payment_methods m ON m.id = r.payment_method_id
    JOIN users u ON u.id = r.payer_id`;

/** `staff` (superAdmin) also sees who paid. */
const mapRequest = (r, { staff = false } = {}) => ({
  id: r.id,
  referenceCode: r.reference_code,
  college: { id: r.college_id, name: r.college_name },
  plan: { id: r.plan_id, name: r.plan_name },
  amountNu: num(r.amount_nu),
  method: { id: r.payment_method_id, name: r.method_name },
  journalNumber: r.journal_number,
  paidOn: r.paid_on_text,
  status: r.status,
  rejectReason: r.reject_reason,
  reviewedAt: iso(r.reviewed_at),
  createdAt: iso(r.created_at),
  ...(staff ? { payer: { uid: r.payer_id, name: r.payer_name, email: r.payer_email } } : {}),
});

function audit(q, actorId, action, targetType, targetId, details = {}) {
  return q.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5)`,
    [actorId, action, targetType, String(targetId), JSON.stringify(details)]
  );
}

// ── Settings, plans, methods ──

export async function getSettings(q) {
  const { rows } = await q.query('SELECT * FROM payment_settings WHERE id = 1');
  return mapSettings(rows[0]);
}

const graceDaysOf = async (q) => (await getSettings(q)).graceDays;

export async function updateSettings(pool, body, actorId) {
  return withTransaction(pool, async (q) => {
    const before = await getSettings(q);
    const { rows } = await q.query(
      `INSERT INTO payment_settings (id, account_name, account_number, bank, qr_image_path, verification_message, refund_policy, grace_days, updated_by, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (id) DO UPDATE SET
         account_name = EXCLUDED.account_name, account_number = EXCLUDED.account_number, bank = EXCLUDED.bank,
         qr_image_path = EXCLUDED.qr_image_path, verification_message = EXCLUDED.verification_message,
         refund_policy = EXCLUDED.refund_policy, grace_days = EXCLUDED.grace_days,
         updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING *`,
      [
        body.accountName || null,
        body.accountNumber || null,
        body.bank || null,
        body.qrImagePath || null,
        body.verificationMessage || null,
        body.refundPolicy || null,
        body.graceDays,
        actorId,
      ]
    );
    const after = mapSettings(rows[0]);
    await audit(q, actorId, 'payment_settings.updated', 'payment_settings', 1, { before, after });
    return after;
  });
}

export async function listPlans(q, { forBuyers = false } = {}) {
  const { rows } = await q.query(
    `SELECT * FROM plans ${forBuyers ? 'WHERE is_active AND NOT manual_only' : ''} ORDER BY is_active DESC, price_nu, name`
  );
  return rows.map(mapPlan);
}

const PLAN_COLUMNS = {
  name: 'name',
  priceNu: 'price_nu',
  durationDays: 'duration_days',
  seats: 'seats',
  maxCourses: 'max_courses',
  monthlyAiAnalyses: 'monthly_ai_analyses',
  manualOnly: 'manual_only',
  isActive: 'is_active',
};

const nameTaken = (err, constraint) => err?.code === '23505' && err.constraint === constraint;

export async function createPlan(pool, body, actorId) {
  try {
    return await withTransaction(pool, async (q) => {
      const { rows } = await q.query(
        `INSERT INTO plans (name, price_nu, duration_days, seats, max_courses, monthly_ai_analyses, manual_only, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [body.name, body.priceNu, body.durationDays, body.seats, body.maxCourses ?? null, body.monthlyAiAnalyses ?? null, body.manualOnly ?? false, actorId]
      );
      const plan = mapPlan(rows[0]);
      await audit(q, actorId, 'plan.created', 'plan', plan.id, { after: plan });
      return plan;
    });
  } catch (err) {
    if (nameTaken(err, 'plans_name_key')) throw fail(409, 'NAME_TAKEN');
    throw err;
  }
}

export async function updatePlan(pool, id, body, actorId) {
  try {
    return await withTransaction(pool, async (q) => {
      const current = await q.query('SELECT * FROM plans WHERE id = $1 FOR UPDATE', [id]);
      if (!current.rows[0]) throw fail(404, 'NOT_FOUND');
      const sets = [];
      const values = [];
      for (const [key, column] of Object.entries(PLAN_COLUMNS)) {
        if (body[key] === undefined) continue;
        values.push(body[key]);
        sets.push(`${column} = $${values.length}`);
      }
      values.push(id);
      const { rows } = await q.query(`UPDATE plans SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING *`, values);
      const before = mapPlan(current.rows[0]);
      const after = mapPlan(rows[0]);
      await audit(q, actorId, 'plan.updated', 'plan', id, { before, after });
      return after;
    });
  } catch (err) {
    if (nameTaken(err, 'plans_name_key')) throw fail(409, 'NAME_TAKEN');
    throw err;
  }
}

export async function listMethods(q, { activeOnly = false } = {}) {
  const { rows } = await q.query(`SELECT * FROM payment_methods ${activeOnly ? 'WHERE is_active' : ''} ORDER BY name`);
  return rows.map(mapMethod);
}

export async function createMethod(pool, { name }, actorId) {
  try {
    return await withTransaction(pool, async (q) => {
      const { rows } = await q.query('INSERT INTO payment_methods (name) VALUES ($1) RETURNING *', [name]);
      const method = mapMethod(rows[0]);
      await audit(q, actorId, 'payment_method.created', 'payment_method', method.id, { after: method });
      return method;
    });
  } catch (err) {
    if (nameTaken(err, 'payment_methods_name_key')) throw fail(409, 'NAME_TAKEN');
    throw err;
  }
}

export async function updateMethod(pool, id, { isActive }, actorId) {
  return withTransaction(pool, async (q) => {
    const { rows } = await q.query('UPDATE payment_methods SET is_active = $2, updated_at = now() WHERE id = $1 RETURNING *', [id, isActive]);
    if (!rows[0]) throw fail(404, 'NOT_FOUND');
    const method = mapMethod(rows[0]);
    await audit(q, actorId, 'payment_method.updated', 'payment_method', id, { after: method });
    return method;
  });
}

// ── Subscriptions and status ──

async function subscriptionsOf(q, collegeId) {
  const { rows } = await q.query(
    `SELECT s.*, p.name AS plan_name, p.seats AS plan_seats, p.max_courses AS plan_max_courses
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.college_id = $1
      ORDER BY s.starts_at DESC`,
    [collegeId]
  );
  return rows.map(mapSubscription);
}

async function openSeatCount(q, collegeId) {
  const { rows } = await q.query('SELECT count(*)::int AS n FROM seat_assignments WHERE college_id = $1 AND removed_at IS NULL', [collegeId]);
  return rows[0].n;
}

/** { status, plan, paidUntil, graceEndsAt, seatsUsed, seatLimit, subscriptions } for one college. */
export async function collegeBilling(q, collegeId, { now = new Date(), graceDays } = {}) {
  const grace = graceDays ?? (await graceDaysOf(q));
  const subscriptions = await subscriptionsOf(q, collegeId);
  const info = collegeStatus(subscriptions, { now, graceDays: grace });
  const sub = info.subscription;
  return {
    status: info.status,
    plan: sub ? { id: sub.planId, name: sub.planName, seats: sub.seats, maxCourses: sub.maxCourses } : null,
    paidUntil: iso(info.paidUntil),
    graceEndsAt: iso(info.graceEndsAt),
    seatsUsed: await openSeatCount(q, collegeId),
    seatLimit: isCovered(info.status) && sub ? sub.seats : 0,
    graceDays: grace,
    subscriptions,
    info,
  };
}

const publicBilling = ({ info, ...rest }) => rest; // eslint-disable-line no-unused-vars

/** Every college with its status, for the superAdmin. */
export async function listCollegesWithBilling(q, { now = new Date() } = {}) {
  const graceDays = await graceDaysOf(q);
  const { rows } = await q.query('SELECT id, name, slug, created_at FROM colleges ORDER BY name');
  const out = [];
  for (const c of rows) {
    out.push({ id: c.id, name: c.name, slug: c.slug, createdAt: iso(c.created_at), billing: publicBilling(await collegeBilling(q, c.id, { now, graceDays })) });
  }
  return out;
}

async function lockCollege(q, collegeId) {
  const { rows } = await q.query('SELECT id, name FROM colleges WHERE id = $1 FOR UPDATE', [collegeId]);
  if (!rows[0]) throw fail(404, 'NOT_FOUND');
  return rows[0];
}

async function insertSubscription(q, { collegeId, plan, startsAt, days, grantType, paymentRequestId = null, note = null, actorId }) {
  const { rows } = await q.query(
    `INSERT INTO subscriptions (college_id, plan_id, payment_request_id, starts_at, ends_at, grant_type, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [collegeId, plan.id, paymentRequestId, startsAt, addDays(startsAt, days), grantType, note, actorId]
  );
  return { ...mapSubscription({ ...rows[0], plan_name: plan.name, plan_seats: plan.seats, plan_max_courses: plan.max_courses }) };
}

// ── Payment requests ──

async function loadPlan(q, planId) {
  const { rows } = await q.query('SELECT * FROM plans WHERE id = $1', [planId]);
  return rows[0] ?? null;
}

/** A collegeAdmin's claim that they paid. Nothing activates until a superAdmin approves it. */
export async function createPaymentRequest(pool, { payerId, collegeId, body, now = new Date(), random }) {
  return withTransaction(pool, async (q) => {
    // Lock the payer so two requests sent at once can't both slip under the pending limit.
    await q.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [payerId]);
    const plan = await loadPlan(q, body.planId);
    if (!plan || !plan.is_active || plan.manual_only) throw fail(400, 'PLAN_UNAVAILABLE');
    const method = (await q.query('SELECT * FROM payment_methods WHERE id = $1', [body.paymentMethodId])).rows[0];
    if (!method || !method.is_active) throw fail(400, 'METHOD_UNAVAILABLE');
    if (Number(plan.price_nu) !== body.amountNu) throw fail(400, 'WRONG_AMOUNT');
    if (body.paidOn > todayInBhutan(now)) throw fail(400, 'PAID_ON_IN_FUTURE');

    const pending = await q.query(`SELECT count(*)::int AS n FROM payment_requests WHERE payer_id = $1 AND status = 'pending'`, [payerId]);
    if (pending.rows[0].n >= MAX_PENDING_PER_PAYER) throw fail(409, 'TOO_MANY_PENDING');

    for (let i = 0; i < REFERENCE_TRIES; i += 1) {
      // ON CONFLICT DO NOTHING covers both unique rules without aborting the transaction: the
      // journal number (payment_requests_journal_key) and the random reference code.
      const { rows } = await q.query(
        `INSERT INTO payment_requests (payer_id, college_id, plan_id, reference_code, amount_nu, payment_method_id, journal_number, paid_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [payerId, collegeId, plan.id, makeReferenceCode(random), plan.price_nu, method.id, body.journalNumber, body.paidOn]
      );
      if (rows[0]) {
        const created = (await q.query(`${REQUEST_SELECT} WHERE r.id = $1`, [rows[0].id])).rows[0];
        await audit(q, payerId, 'payment.requested', 'payment_request', created.id, {
          collegeId,
          planId: plan.id,
          amountNu: Number(plan.price_nu),
          method: method.name,
          journalNumber: body.journalNumber,
        });
        return mapRequest(created);
      }
      const used = await q.query(
        `SELECT 1 FROM payment_requests WHERE payment_method_id = $1 AND journal_number = $2 AND status IN ('pending', 'approved')`,
        [method.id, body.journalNumber]
      );
      if (used.rowCount > 0) throw fail(409, 'JOURNAL_USED');
    }
    throw new Error('Could not find a free reference code');
  });
}

export async function listRequests(q, { status = 'pending', collegeId = null, staff = false } = {}) {
  const where = [];
  const values = [];
  if (status !== 'all') {
    values.push(status);
    where.push(`r.status = $${values.length}`);
  }
  if (collegeId) {
    values.push(collegeId);
    where.push(`r.college_id = $${values.length}`);
  }
  const { rows } = await q.query(
    `${REQUEST_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.created_at ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 500`,
    values
  );
  return rows.map((r) => mapRequest(r, { staff }));
}

/** Lock a request; a collegeAdmin only finds their own college's. */
async function lockRequest(q, id, { collegeId = null } = {}) {
  const { rows } = await q.query('SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE', [id]);
  const request = rows[0];
  if (!request || (collegeId && request.college_id !== collegeId)) throw fail(404, 'NOT_FOUND');
  if (request.status !== 'pending') throw fail(409, 'ALREADY_REVIEWED');
  return request;
}

const reloadRequest = async (q, id, staff) => mapRequest((await q.query(`${REQUEST_SELECT} WHERE r.id = $1`, [id])).rows[0], { staff });

/**
 * superAdmin approval: one transaction holding the request and college rows, so two approvals
 * at once give one subscription (the second sees "approved" and gets 409).
 */
export async function approveRequest(pool, { id, actorId, now = new Date() }) {
  return withTransaction(pool, async (q) => {
    const request = await lockRequest(q, id);
    await lockCollege(q, request.college_id);
    const plan = await loadPlan(q, request.plan_id);
    const billing = await collegeBilling(q, request.college_id, { now });
    const startsAt = renewalStart(billing.info, now);
    const subscription = await insertSubscription(q, {
      collegeId: request.college_id,
      plan,
      startsAt,
      days: plan.duration_days,
      grantType: 'paid',
      paymentRequestId: request.id,
      actorId,
    });
    await q.query(`UPDATE payment_requests SET status = 'approved', reviewed_by = $2, reviewed_at = $3 WHERE id = $1`, [id, actorId, now]);
    await audit(q, actorId, 'payment.approved', 'payment_request', id, {
      collegeId: request.college_id,
      before: { status: 'pending', paidUntil: billing.paidUntil, collegeStatus: billing.status },
      after: { status: 'approved', subscriptionId: subscription.id, startsAt: subscription.startsAt, endsAt: subscription.endsAt },
    });
    return { request: await reloadRequest(q, id, true), subscription };
  });
}

export async function rejectRequest(pool, { id, actorId, reason, now = new Date() }) {
  return withTransaction(pool, async (q) => {
    const request = await lockRequest(q, id);
    await q.query(`UPDATE payment_requests SET status = 'rejected', reject_reason = $2, reviewed_by = $3, reviewed_at = $4 WHERE id = $1`, [
      id,
      reason,
      actorId,
      now,
    ]);
    await audit(q, actorId, 'payment.rejected', 'payment_request', id, { collegeId: request.college_id, reason, before: { status: 'pending' }, after: { status: 'rejected' } });
    return reloadRequest(q, id, true);
  });
}

/** The paying college's admin (collegeId set) or a superAdmin (collegeId null) can cancel before review. */
export async function cancelRequest(pool, { id, actorId, collegeId = null, now = new Date() }) {
  return withTransaction(pool, async (q) => {
    const request = await lockRequest(q, id, { collegeId });
    await q.query(`UPDATE payment_requests SET status = 'cancelled', reviewed_by = $2, reviewed_at = $3 WHERE id = $1`, [id, actorId, now]);
    await audit(q, actorId, 'payment.cancelled', 'payment_request', id, { collegeId: request.college_id, before: { status: 'pending' }, after: { status: 'cancelled' } });
    return reloadRequest(q, id, !collegeId);
  });
}

// ── superAdmin grants, extensions and revocations ──

export async function grantSubscription(pool, { collegeId, planId, days, note, actorId, now = new Date() }) {
  return withTransaction(pool, async (q) => {
    await lockCollege(q, collegeId);
    const plan = await loadPlan(q, planId);
    if (!plan) throw fail(400, 'PLAN_UNAVAILABLE');
    const billing = await collegeBilling(q, collegeId, { now });
    const subscription = await insertSubscription(q, {
      collegeId,
      plan,
      startsAt: renewalStart(billing.info, now),
      days: days ?? plan.duration_days,
      grantType: 'manual',
      note,
      actorId,
    });
    await audit(q, actorId, 'subscription.granted', 'subscription', subscription.id, {
      collegeId,
      reason: note,
      before: { paidUntil: billing.paidUntil, collegeStatus: billing.status },
      after: { planId, startsAt: subscription.startsAt, endsAt: subscription.endsAt },
    });
    return subscription;
  });
}

async function lockSubscription(q, id) {
  const { rows } = await q.query(
    `SELECT s.*, p.name AS plan_name, p.seats AS plan_seats, p.max_courses AS plan_max_courses
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.id = $1 FOR UPDATE OF s`,
    [id]
  );
  if (!rows[0]) throw fail(404, 'NOT_FOUND');
  if (rows[0].revoked_at) throw fail(409, 'REVOKED');
  return rows[0];
}

/** From ends_at, or from now when the college is already read-only. */
export async function extendSubscription(pool, { id, days, reason, actorId, now = new Date() }) {
  return withTransaction(pool, async (q) => {
    const row = await lockSubscription(q, id);
    const graceDays = await graceDaysOf(q);
    const readOnly = new Date(row.ends_at).getTime() + graceDays * 864e5 < now.getTime();
    const endsAt = addDays(readOnly ? now : row.ends_at, days);
    await q.query('UPDATE subscriptions SET ends_at = $2 WHERE id = $1', [id, endsAt]);
    await audit(q, actorId, 'subscription.extended', 'subscription', id, {
      collegeId: row.college_id,
      reason,
      days,
      before: { endsAt: iso(row.ends_at) },
      after: { endsAt: iso(endsAt) },
    });
    return mapSubscription({ ...row, ends_at: endsAt });
  });
}

export async function revokeSubscription(pool, { id, reason, actorId, now = new Date() }) {
  return withTransaction(pool, async (q) => {
    const row = await lockSubscription(q, id);
    await q.query('UPDATE subscriptions SET revoked_at = $2, revoke_reason = $3 WHERE id = $1', [id, now, reason]);
    await audit(q, actorId, 'subscription.revoked', 'subscription', id, { collegeId: row.college_id, reason, before: { revokedAt: null }, after: { revokedAt: iso(now) } });
    return mapSubscription({ ...row, revoked_at: now, revoke_reason: reason });
  });
}

// ── College: lecturers and seats ──

/** The college admin's page: college, lecturers with seats, and course names and counts only. */
export async function collegeOverview(q, collegeId, { now = new Date(), billingOn = false } = {}) {
  const { rows: colleges } = await q.query('SELECT id, name FROM colleges WHERE id = $1', [collegeId]);
  if (!colleges[0]) throw fail(409, 'NO_COLLEGE');
  const { rows: lecturers } = await q.query(
    `SELECT u.id, u.display_name, u.email,
            EXISTS (SELECT 1 FROM seat_assignments s WHERE s.lecturer_id = u.id AND s.college_id = $1 AND s.removed_at IS NULL) AS has_seat,
            (SELECT count(*)::int FROM courses c WHERE c.owner_id = u.id AND c.archived_at IS NULL) AS course_count
       FROM users u
      WHERE u.college_id = $1 AND u.role = 'lecturer' AND u.deleted_at IS NULL
      ORDER BY u.display_name`,
    [collegeId]
  );
  const { rows: courses } = await q.query(
    `SELECT c.id, c.code, c.title, c.archived_at, owner.display_name AS lecturer_name,
            (SELECT count(*)::int FROM enrolments e WHERE e.course_id = c.id AND e.course_role = 'student') AS student_count,
            (SELECT count(*)::int FROM assignments a WHERE a.course_id = c.id) AS project_count
       FROM courses c JOIN users owner ON owner.id = c.owner_id
      WHERE c.college_id = $1
      ORDER BY c.archived_at NULLS FIRST, c.code, c.title`,
    [collegeId]
  );
  return {
    college: { id: colleges[0].id, name: colleges[0].name },
    billingEnabled: billingOn,
    billing: billingOn ? publicBilling(await collegeBilling(q, collegeId, { now })) : null,
    lecturers: lecturers.map((l) => ({ uid: l.id, name: l.display_name, email: l.email, hasSeat: l.has_seat, courseCount: l.course_count })),
    courses: courses.map((c) => ({
      id: c.id,
      code: c.code,
      title: c.title,
      lecturerName: c.lecturer_name,
      studentCount: c.student_count,
      projectCount: c.project_count,
      archived: Boolean(c.archived_at),
    })),
  };
}

/**
 * Record a lecturer as part of the college. The caller has already set their collegeId claim.
 * Their courses without a college move to this one, so the college admin can see them.
 */
export async function addCollegeLecturer(pool, { collegeId, uid, email, name, actorId }) {
  return withTransaction(pool, async (q) => {
    await q.query(
      `INSERT INTO users (id, email, display_name, role, college_id) VALUES ($1, $2, $3, 'lecturer', $4)
       ON CONFLICT (id) DO UPDATE SET college_id = EXCLUDED.college_id, role = 'lecturer', updated_at = now()`,
      [uid, email, (name || email.split('@')[0]).slice(0, 100), collegeId]
    );
    const moved = await q.query('UPDATE courses SET college_id = $1, updated_at = now() WHERE owner_id = $2 AND college_id IS NULL', [collegeId, uid]);
    await audit(q, actorId, 'college.lecturer_added', 'user', uid, { collegeId, coursesMoved: moved.rowCount });
  });
}

export async function removeCollegeLecturer(pool, { collegeId, uid, actorId, now = new Date() }) {
  return withTransaction(pool, async (q) => {
    const { rowCount } = await q.query(
      `UPDATE users SET college_id = NULL, updated_at = now() WHERE id = $1 AND college_id = $2 AND role = 'lecturer'`,
      [uid, collegeId]
    );
    if (rowCount === 0) throw fail(404, 'NOT_FOUND');
    await q.query('UPDATE seat_assignments SET removed_at = $3, removed_by = $4 WHERE lecturer_id = $1 AND college_id = $2 AND removed_at IS NULL', [
      uid,
      collegeId,
      now,
      actorId,
    ]);
    await audit(q, actorId, 'college.lecturer_removed', 'user', uid, { collegeId });
  });
}

/** Give a lecturer of this college a seat, within the plan's seat count. */
export async function assignSeat(pool, { collegeId, lecturerId, actorId, now = new Date() }) {
  return withTransaction(pool, async (q) => {
    await lockCollege(q, collegeId);
    const lecturer = await q.query(`SELECT 1 FROM users WHERE id = $1 AND college_id = $2 AND role = 'lecturer'`, [lecturerId, collegeId]);
    if (lecturer.rowCount === 0) throw fail(404, 'NOT_FOUND');
    const billing = await collegeBilling(q, collegeId, { now });
    if (!isCovered(billing.status)) throw fail(409, 'SUBSCRIPTION_INACTIVE');
    const open = await q.query('SELECT 1 FROM seat_assignments WHERE lecturer_id = $1 AND removed_at IS NULL', [lecturerId]);
    if (open.rowCount > 0) throw fail(409, 'ALREADY_HAS_SEAT');
    if (billing.seatsUsed >= billing.seatLimit) throw fail(409, 'SEAT_LIMIT');
    const { rows } = await q.query(
      `INSERT INTO seat_assignments (college_id, lecturer_id, assigned_by, assigned_at) VALUES ($1, $2, $3, $4) RETURNING id`,
      [collegeId, lecturerId, actorId, now]
    );
    await audit(q, actorId, 'seat.assigned', 'user', lecturerId, { collegeId, seatId: rows[0].id, seatsUsed: billing.seatsUsed + 1, seatLimit: billing.seatLimit });
    return { seatsUsed: billing.seatsUsed + 1, seatLimit: billing.seatLimit };
  });
}

export async function removeSeat(pool, { collegeId, lecturerId, actorId, now = new Date() }) {
  return withTransaction(pool, async (q) => {
    const { rows } = await q.query(
      `UPDATE seat_assignments SET removed_at = $3, removed_by = $4
        WHERE lecturer_id = $1 AND college_id = $2 AND removed_at IS NULL RETURNING id`,
      [lecturerId, collegeId, now, actorId]
    );
    if (!rows[0]) throw fail(404, 'NOT_FOUND');
    await audit(q, actorId, 'seat.removed', 'user', lecturerId, { collegeId, seatId: rows[0].id });
  });
}

/**
 * Whether a lecturer's work is covered: a seat (or one removed less than grace_days ago) on a
 * college whose subscription is active or in grace. Returns { covered, reason, status, ... }.
 */
export async function lecturerCoverage(q, lecturerId, { now = new Date() } = {}) {
  const graceDays = await graceDaysOf(q);
  const { rows } = await q.query(
    `SELECT s.college_id, s.removed_at, c.name AS college_name
       FROM seat_assignments s JOIN colleges c ON c.id = s.college_id
      WHERE s.lecturer_id = $1
      ORDER BY s.removed_at DESC NULLS FIRST
      LIMIT 1`,
    [lecturerId]
  );
  const seat = rows[0] ? { collegeId: rows[0].college_id, removedAt: rows[0].removed_at, collegeName: rows[0].college_name } : null;
  if (!seatCounts(seat, { now, graceDays })) return { covered: false, reason: 'NO_SEAT', status: null, college: null, seatRemovedAt: null };
  const billing = await collegeBilling(q, seat.collegeId, { now, graceDays });
  const covered = isCovered(billing.status);
  return {
    covered,
    reason: covered ? null : 'SUBSCRIPTION_INACTIVE',
    status: billing.status,
    college: { id: seat.collegeId, name: seat.collegeName },
    paidUntil: billing.paidUntil,
    graceEndsAt: billing.graceEndsAt,
    maxCourses: billing.plan?.maxCourses ?? null,
    seatRemovedAt: iso(seat.removedAt),
  };
}
