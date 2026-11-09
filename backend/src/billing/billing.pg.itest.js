// Billing end to end on a real PostgreSQL (npm run test:db): plans, payments, approvals, seats,
// grace and read-only, and who may do what. Firebase Auth is stubbed (src/auth/testFakes.js).
// Every row is a test fixture in a throwaway database, not app data.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import client from 'prom-client';
import { createApp } from '../../app.js';
import { loadConfig } from '../../config/index.js';
import { createTestDatabase } from '../../db/testDatabase.js';
import { createUserRateLimit } from '../../routes/http.js';
import { fakeAuth } from '../auth/testFakes.js';
import { createMetrics } from '../metrics/index.js';

const COLLEGE_A = '1a5c1f9e-2a71-4c8e-9d3b-6e0f4a2c7b11';
const COLLEGE_B = '2b5c1f9e-2a71-4c8e-9d3b-6e0f4a2c7b22';
const DAY = 864e5;

const people = {
  sadm: { uid: 'sadm-1', email: 'sadm@rub.edu.bt', role: 'superAdmin' },
  cadmA: { uid: 'cadm-a', email: 'cadm.a@rub.edu.bt', role: 'collegeAdmin', collegeId: COLLEGE_A },
  cadmB: { uid: 'cadm-b', email: 'cadm.b@rub.edu.bt', role: 'collegeAdmin', collegeId: COLLEGE_B },
  cadmNone: { uid: 'cadm-0', email: 'cadm.none@rub.edu.bt', role: 'collegeAdmin' },
  lect: { uid: 'lect-1', email: 'pema@rub.edu.bt', role: 'lecturer' },
  lect2: { uid: 'lect-2', email: 'karma@rub.edu.bt', role: 'lecturer' },
  lectB: { uid: 'lect-b', email: 'dorji@rub.edu.bt', role: 'lecturer', collegeId: COLLEGE_B },
  stu: { uid: 'stu-1', email: 'stu@rub.edu.bt', role: 'student' },
};
const tokens = Object.fromEntries(
  Object.entries(people).map(([k, p]) => [`tok-${k}`, { uid: p.uid, email: p.email, role: p.role, collegeId: p.collegeId ?? null }])
);
const users = Object.fromEntries(
  Object.values(people).map((p) => [p.uid, { email: p.email, displayName: p.email.split('@')[0], customClaims: { role: p.role, collegeId: p.collegeId ?? null } }])
);
const auth = fakeAuth({ users, tokens });

let testDb;
let server;
let baseUrl;
let billingOn = false;
let offset = 0; // moves the app's clock for the grace and read-only tests
const clock = () => Date.now() + offset;
const noMirror = new Proxy({}, { get: () => async () => {} });

before(async () => {
  testDb = await createTestDatabase();
  const db = { pool: testDb.pool, ping: async () => true, close: async () => {} };
  const isEnabled = async (name) => (name === 'courses_v2' ? true : name === 'billing_enabled' ? billingOn : false);
  const app = createApp({
    config: loadConfig({}),
    db,
    metrics: createMetrics({ registry: new client.Registry() }),
    courseDeps: { getClients: () => ({ auth }), mirror: noMirror, isEnabled, now: clock },
    billingDeps: { getClients: () => ({ auth }), isEnabled, now: clock, payLimit: createUserRateLimit({ max: 1000, windowMs: 60_000 }) },
  });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await testDb.pool.query(`INSERT INTO colleges (id, name, slug) VALUES ($1, 'College of Science and Technology', 'cst'), ($2, 'Gedu College', 'gedu')`, [
    COLLEGE_A,
    COLLEGE_B,
  ]);
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  await testDb?.drop();
});

async function call(who, method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (who) headers.Authorization = `Bearer tok-${who}`;
  const res = await fetch(`${baseUrl}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const sql = async (text, params) => (await testDb.pool.query(text, params)).rows;
const expectCode = (res, status, code) => assert.deepEqual([res.status, res.body?.code], [status, code], JSON.stringify(res.body));
const today = () => new Date(clock() + 6 * 3600e3).toISOString().slice(0, 10);

const s = {};
const pay = (who, journalNumber, extra = {}) =>
  call(who, 'POST', '/college/payment-requests', { planId: s.plan.id, paymentMethodId: s.mbob.id, amountNu: 1000, journalNumber, paidOn: today(), ...extra });

describe('with billing_enabled off', () => {
  test('the billing routes are off, but a collegeAdmin still has their college page', async () => {
    expectCode(await call('sadm', 'GET', '/admin/billing/plans'), 404, 'FEATURE_DISABLED');
    expectCode(await call('cadmA', 'GET', '/college/billing'), 404, 'FEATURE_DISABLED');
    const page = await call('cadmA', 'GET', '/college');
    assert.equal(page.status, 200);
    assert.equal(page.body.college.name, 'College of Science and Technology');
    assert.equal(page.body.billingEnabled, false);
    assert.equal(page.body.billing, null);
  });

  test('a lecturer without a seat can still create a course', async () => {
    assert.equal((await call('lect2', 'POST', '/courses', { code: 'OLD101', title: 'Before billing' })).status, 201);
  });

  test('a collegeAdmin without a college gets 409 NO_COLLEGE', async () => {
    expectCode(await call('cadmNone', 'GET', '/college'), 409, 'NO_COLLEGE');
  });
});

describe('setting up (superAdmin)', () => {
  before(() => {
    billingOn = true;
  });

  test('only a superAdmin manages plans, methods and settings', async () => {
    for (const who of ['cadmA', 'lect', 'stu']) {
      expectCode(await call(who, 'POST', '/admin/billing/plans', { name: 'X', priceNu: 1, durationDays: 1, seats: 1 }), 403, 'FORBIDDEN');
      expectCode(await call(who, 'PUT', '/admin/billing/settings', { graceDays: 1 }), 403, 'FORBIDDEN');
    }
  });

  test('plans, methods and settings, each with an audit row', async () => {
    s.plan = (await call('sadm', 'POST', '/admin/billing/plans', { name: 'Department', priceNu: 1000, durationDays: 30, seats: 1, maxCourses: 2 })).body;
    s.pilot = (await call('sadm', 'POST', '/admin/billing/plans', { name: 'Pilot', priceNu: 1, durationDays: 14, seats: 5, manualOnly: true })).body;
    assert.equal(s.plan.priceNu, 1000);
    expectCode(await call('sadm', 'POST', '/admin/billing/plans', { name: 'department', priceNu: 5, durationDays: 1, seats: 1 }), 409, 'NAME_TAKEN');
    s.mbob = (await call('sadm', 'POST', '/admin/billing/methods', { name: 'mBoB' })).body;
    s.bnb = (await call('sadm', 'POST', '/admin/billing/methods', { name: 'BNB mPay' })).body;
    const settings = await call('sadm', 'PUT', '/admin/billing/settings', { accountName: 'Peerlytics', accountNumber: '200111222', bank: 'Bank of Bhutan', graceDays: 7 });
    assert.equal(settings.body.graceDays, 7);
    const actions = (await sql(`SELECT action FROM audit_log WHERE actor_id = 'sadm-1' ORDER BY id`)).map((r) => r.action);
    assert.deepEqual(actions, ['plan.created', 'plan.created', 'payment_method.created', 'payment_method.created', 'payment_settings.updated']);
  });

  test('a collegeAdmin sees shown plans, active methods and where to pay, not manual-only plans', async () => {
    const page = await call('cadmA', 'GET', '/college/billing');
    assert.equal(page.status, 200);
    assert.deepEqual(page.body.plans.map((p) => p.name), ['Department']);
    assert.deepEqual(page.body.methods.map((m) => m.name).sort(), ['BNB mPay', 'mBoB']);
    assert.equal(page.body.payTo.accountNumber, '200111222');
    assert.equal('graceDays' in page.body.payTo, false);
  });
});

describe('paying', () => {
  test('lecturers and students cannot buy (D1)', async () => {
    expectCode(await pay('lect', '11112222'), 403, 'FORBIDDEN');
    expectCode(await pay('stu', '11112222'), 403, 'FORBIDDEN');
  });

  test('a lecturer without a seat cannot create a course', async () => {
    expectCode(await call('lect', 'POST', '/courses', { code: 'CTE412', title: 'Mini project' }), 403, 'NO_SEAT');
  });

  test('wrong amount, a future date and a manual-only plan are refused', async () => {
    expectCode(await pay('cadmA', '11112222', { amountNu: 999 }), 400, 'WRONG_AMOUNT');
    expectCode(await pay('cadmA', '11112222', { paidOn: '2099-01-01' }), 400, 'PAID_ON_IN_FUTURE');
    expectCode(await pay('cadmA', '11112222', { planId: s.pilot.id, amountNu: 1 }), 400, 'PLAN_UNAVAILABLE');
  });

  test('a request is pending with a server-made reference and the journal stored upper case', async () => {
    const res = await pay('cadmA', 'jn 8989 2938');
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'pending');
    assert.equal(res.body.journalNumber, 'JN89892938');
    assert.match(res.body.referenceCode, /^PL-[A-HJKMNP-Z2-9]{6}$/);
    assert.equal(res.body.amountNu, 1000);
    s.first = res.body;
  });

  test('a pending journal number cannot be used again, and the database itself refuses it', async () => {
    expectCode(await pay('cadmB', 'JN89892938'), 409, 'JOURNAL_USED');
    await assert.rejects(
      testDb.pool.query(
        `INSERT INTO payment_requests (payer_id, college_id, plan_id, reference_code, amount_nu, payment_method_id, journal_number, paid_on)
         VALUES ('cadm-b', $1, $2, 'PL-AAAAAA', 1000, $3, 'JN89892938', current_date)`,
        [COLLEGE_B, s.plan.id, s.mbob.id]
      ),
      (err) => err.code === '23505' && err.constraint === 'payment_requests_journal_key'
    );
    // The same number on another method is a different payment.
    const other = await call('cadmB', 'POST', '/college/payment-requests', { planId: s.plan.id, paymentMethodId: s.bnb.id, amountNu: 1000, journalNumber: 'JN89892938', paidOn: today() });
    assert.equal(other.status, 201);
    s.collegeBRequest = other.body;
  });

  test('a college admin only sees and cancels their own college’s requests', async () => {
    const a = await call('cadmA', 'GET', '/college/billing');
    assert.deepEqual(a.body.requests.map((r) => r.id), [s.first.id]);
    assert.equal('payer' in a.body.requests[0], false);
    expectCode(await call('cadmA', 'POST', `/college/payment-requests/${s.collegeBRequest.id}/cancel`), 404, 'NOT_FOUND');
    assert.equal((await call('cadmB', 'POST', `/college/payment-requests/${s.collegeBRequest.id}/cancel`)).body.status, 'cancelled');
  });

  test('at most 3 pending requests per payer', async () => {
    const extra = [];
    for (const n of ['30000001', '30000002']) extra.push((await pay('cadmA', n)).body);
    expectCode(await pay('cadmA', '30000003'), 409, 'TOO_MANY_PENDING');
    for (const r of extra) await call('cadmA', 'POST', `/college/payment-requests/${r.id}/cancel`);
  });
});

describe('reviewing (superAdmin)', () => {
  test('collegeAdmins and lecturers cannot approve or reject', async () => {
    for (const who of ['cadmA', 'lect']) {
      expectCode(await call(who, 'POST', `/admin/billing/requests/${s.first.id}/approve`), 403, 'FORBIDDEN');
      expectCode(await call(who, 'POST', `/admin/billing/requests/${s.first.id}/reject`, { reason: 'Not in the statement' }), 403, 'FORBIDDEN');
    }
  });

  test('the queue shows pending requests with the payer', async () => {
    const queue = await call('sadm', 'GET', '/admin/billing/requests');
    assert.deepEqual(queue.body.requests.map((r) => r.id), [s.first.id]);
    assert.equal(queue.body.requests[0].payer.email, 'cadm.a@rub.edu.bt');
  });

  test('rejecting needs a reason; the same journal number can then be sent again (D8)', async () => {
    expectCode(await call('sadm', 'POST', `/admin/billing/requests/${s.first.id}/reject`, { reason: 'no' }), 400, 'INVALID_BODY');
    const rejected = await call('sadm', 'POST', `/admin/billing/requests/${s.first.id}/reject`, { reason: 'Not found in the statement' });
    assert.equal(rejected.body.status, 'rejected');
    expectCode(await call('sadm', 'POST', `/admin/billing/requests/${s.first.id}/approve`), 409, 'ALREADY_REVIEWED');
    const seen = await call('cadmA', 'GET', '/college/billing');
    assert.equal(seen.body.requests.find((r) => r.id === s.first.id).rejectReason, 'Not found in the statement');
    const again = await pay('cadmA', 'JN89892938');
    assert.equal(again.status, 201);
    s.second = again.body;
  });

  test('two approvals at the same time give one subscription', async () => {
    const results = await Promise.all([
      call('sadm', 'POST', `/admin/billing/requests/${s.second.id}/approve`),
      call('sadm', 'POST', `/admin/billing/requests/${s.second.id}/approve`),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const subs = await sql('SELECT * FROM subscriptions WHERE payment_request_id = $1', [s.second.id]);
    assert.equal(subs.length, 1);
    s.sub1 = subs[0];
    assert.ok(Math.abs(new Date(s.sub1.ends_at) - new Date(s.sub1.starts_at) - 30 * DAY) < 1000);
  });

  test('the college is active, and an approved journal number is still taken', async () => {
    const colleges = await call('sadm', 'GET', '/admin/billing/colleges');
    const a = colleges.body.colleges.find((c) => c.id === COLLEGE_A);
    assert.equal(a.billing.status, 'active');
    assert.deepEqual([a.billing.seatsUsed, a.billing.seatLimit], [0, 1]);
    expectCode(await pay('cadmA', 'JN89892938'), 409, 'JOURNAL_USED');
  });
});

describe('lecturers and seats (collegeAdmin)', () => {
  test('adding a lecturer: unknown, not a lecturer and another college are refused', async () => {
    expectCode(await call('cadmA', 'POST', '/college/lecturers', { email: 'nobody@rub.edu.bt' }), 404, 'NOT_A_LECTURER');
    expectCode(await call('cadmA', 'POST', '/college/lecturers', { email: 'stu@rub.edu.bt' }), 404, 'NOT_A_LECTURER');
    expectCode(await call('cadmA', 'POST', '/college/lecturers', { email: 'dorji@rub.edu.bt' }), 409, 'IN_ANOTHER_COLLEGE');
  });

  test('adding a lecturer sets their college, signs them out once and moves their courses', async () => {
    const res = await call('cadmA', 'POST', '/college/lecturers', { email: 'Karma@rub.edu.bt' });
    assert.equal(res.status, 201);
    assert.deepEqual(users['lect-2'].customClaims, { role: 'lecturer', collegeId: COLLEGE_A });
    assert.ok(auth.calls.revokeRefreshTokens.includes('lect-2'));
    tokens['tok-lect2'].collegeId = COLLEGE_A; // their next sign-in carries the claim
    const lecturer = res.body.lecturers.find((l) => l.uid === 'lect-2');
    assert.deepEqual([lecturer.hasSeat, lecturer.courseCount], [false, 1]);
    assert.deepEqual(res.body.courses.map((c) => c.code), ['OLD101']);

    await call('cadmA', 'POST', '/college/lecturers', { email: 'pema@rub.edu.bt' });
    tokens['tok-lect'].collegeId = COLLEGE_A;
  });

  test('a seat goes only to the college’s own lecturers, within the plan’s seats', async () => {
    expectCode(await call('cadmA', 'POST', '/college/seats/lect-b'), 404, 'NOT_FOUND');
    expectCode(await call('cadmB', 'POST', '/college/seats/lect-1'), 404, 'NOT_FOUND');
    assert.deepEqual((await call('cadmA', 'POST', '/college/seats/lect-1')).body, { seatsUsed: 1, seatLimit: 1 });
    expectCode(await call('cadmA', 'POST', '/college/seats/lect-1'), 409, 'ALREADY_HAS_SEAT');
    expectCode(await call('cadmA', 'POST', '/college/seats/lect-2'), 409, 'SEAT_LIMIT');
  });

  test('another college sees none of it', async () => {
    const b = await call('cadmB', 'GET', '/college');
    assert.deepEqual(b.body.lecturers, []);
    assert.deepEqual(b.body.courses, []);
    expectCode(await call('cadmB', 'DELETE', '/college/seats/lect-1'), 404, 'NOT_FOUND');
  });

  test('with a seat, a lecturer creates courses up to the plan’s limit', async () => {
    const me = await call('lect', 'GET', '/billing/me');
    assert.equal(me.body.coverage.covered, true);
    s.course = (await call('lect', 'POST', '/courses', { code: 'CTE412', title: 'Mini project' })).body;
    assert.ok(s.course.id);
    assert.equal((await call('lect', 'POST', '/courses', { code: 'CTE413', title: 'Second' })).status, 201);
    expectCode(await call('lect', 'POST', '/courses', { code: 'CTE414', title: 'Third' }), 403, 'COURSE_LIMIT');
    expectCode(await call('lect2', 'POST', '/courses', { code: 'X1', title: 'No seat' }), 403, 'NO_SEAT');
  });
});

describe('renewal, grace and read-only', () => {
  const project = () => ({ title: 'Report', brief: 'Write it', deadline: new Date(clock() + 7 * DAY).toISOString() });

  test('renewing while active starts at the current end', async () => {
    const r = await pay('cadmA', '40000001');
    await call('sadm', 'POST', `/admin/billing/requests/${r.body.id}/approve`);
    const [renewal] = await sql('SELECT * FROM subscriptions WHERE payment_request_id = $1', [r.body.id]);
    assert.equal(new Date(renewal.starts_at).toISOString(), new Date(s.sub1.ends_at).toISOString());
    s.paidUntil = new Date(renewal.ends_at).getTime();
  });

  test('in grace the work goes on; after grace it is read-only but still visible', async () => {
    offset = s.paidUntil - Date.now() + 2 * DAY;
    const grace = await call('lect', 'GET', '/billing/me');
    assert.equal(grace.body.coverage.status, 'grace');
    assert.equal((await call('lect', 'POST', `/courses/${s.course.id}/assignments`, project())).status, 201);

    offset = s.paidUntil - Date.now() + 8 * DAY;
    assert.equal((await call('lect', 'GET', '/billing/me')).body.coverage.status, 'read_only');
    expectCode(await call('lect', 'POST', `/courses/${s.course.id}/assignments`, project()), 403, 'SUBSCRIPTION_INACTIVE');
    assert.equal((await call('lect', 'GET', `/courses/${s.course.id}`)).status, 200, 'viewing still works');
    expectCode(await call('cadmA', 'POST', '/college/seats/lect-2'), 409, 'SUBSCRIPTION_INACTIVE');
  });

  test('extending a read-only college counts from now, with a reason', async () => {
    const [latest] = await sql('SELECT id FROM subscriptions WHERE college_id = $1 ORDER BY ends_at DESC LIMIT 1', [COLLEGE_A]);
    expectCode(await call('sadm', 'POST', `/admin/billing/subscriptions/${latest.id}/extend`, { days: 10 }), 400, 'INVALID_BODY');
    const res = await call('sadm', 'POST', `/admin/billing/subscriptions/${latest.id}/extend`, { days: 10, reason: 'Bank delay, paid on time' });
    assert.ok(Math.abs(new Date(res.body.endsAt).getTime() - (clock() + 10 * DAY)) < 5000);
    assert.equal((await call('lect', 'GET', '/billing/me')).body.coverage.status, 'active');
    s.latest = latest.id;
  });

  test('revoking needs a reason and makes the college read-only', async () => {
    const res = await call('sadm', 'POST', `/admin/billing/subscriptions/${s.latest}/revoke`, { reason: 'Payment reversed by the bank' });
    assert.ok(res.body.revokedAt);
    expectCode(await call('sadm', 'POST', `/admin/billing/subscriptions/${s.latest}/extend`, { days: 1, reason: 'Try again' }), 409, 'REVOKED');
    assert.equal((await call('lect', 'GET', '/billing/me')).body.coverage.covered, false);
  });

  test('a manual grant (a pilot) covers the college again', async () => {
    const res = await call('sadm', 'POST', `/admin/billing/colleges/${COLLEGE_A}/grants`, { planId: s.pilot.id, note: 'Pilot for the semester' });
    assert.equal(res.status, 201);
    assert.equal(res.body.grantType, 'manual');
    assert.equal((await call('lect', 'GET', '/billing/me')).body.coverage.status, 'active');
  });

  test('a removed seat still counts for grace_days, then not', async () => {
    assert.equal((await call('cadmA', 'DELETE', '/college/seats/lect-1')).status, 204);
    assert.equal((await call('lect', 'GET', '/billing/me')).body.coverage.covered, true);
    offset += 8 * DAY;
    expectCode(await call('lect', 'POST', `/courses/${s.course.id}/assignments`, project()), 403, 'NO_SEAT');
    offset = 0;
  });

  test('every decision is in the audit log with who did it', async () => {
    const rows = await sql(`SELECT actor_id, action FROM audit_log WHERE action LIKE 'payment.%' OR action LIKE 'seat.%' OR action LIKE 'subscription.%' ORDER BY id`);
    const by = (action) => rows.filter((r) => r.action === action).map((r) => r.actor_id);
    assert.deepEqual(by('payment.rejected'), ['sadm-1']);
    assert.deepEqual(by('payment.approved'), ['sadm-1', 'sadm-1']);
    assert.deepEqual(by('seat.assigned'), ['cadm-a']);
    assert.deepEqual(by('seat.removed'), ['cadm-a']);
    assert.deepEqual(by('subscription.extended'), ['sadm-1']);
    assert.deepEqual(by('subscription.revoked'), ['sadm-1']);
    assert.deepEqual(by('subscription.granted'), ['sadm-1']);
    assert.ok(by('payment.requested').every((actor) => actor === 'cadm-a' || actor === 'cadm-b'));
  });
});
