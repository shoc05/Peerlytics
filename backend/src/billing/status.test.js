import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paymentRequestCreate, planCreate, planUpdate } from './schemas.js';
import { addDays, collegeStatus, isCovered, makeReferenceCode, normaliseJournal, renewalStart, seatCounts, todayInBhutan } from './status.js';

const NOW = new Date('2026-11-09T06:00:00Z');
const sub = (id, startsAt, endsAt, extra = {}) => ({ id, planId: 'p1', startsAt, endsAt, revokedAt: null, ...extra });

test('no subscriptions: none', () => {
  assert.deepEqual(collegeStatus([], { now: NOW }), { status: 'none', subscription: null, paidUntil: null, graceEndsAt: null });
});

test('a subscription covering now is active, with paidUntil its end', () => {
  const info = collegeStatus([sub('a', '2026-10-01T00:00:00Z', '2026-12-01T00:00:00Z')], { now: NOW });
  assert.equal(info.status, 'active');
  assert.equal(info.subscription.id, 'a');
  assert.equal(info.paidUntil.toISOString(), '2026-12-01T00:00:00.000Z');
});

test('ended less than grace_days ago is grace; later is read_only', () => {
  const ended = [sub('a', '2026-09-01T00:00:00Z', '2026-11-05T00:00:00Z')];
  const grace = collegeStatus(ended, { now: NOW, graceDays: 7 });
  assert.equal(grace.status, 'grace');
  assert.equal(grace.graceEndsAt.toISOString(), '2026-11-12T00:00:00.000Z');
  assert.equal(collegeStatus(ended, { now: new Date('2026-11-12T00:00:01Z'), graceDays: 7 }).status, 'read_only');
  assert.equal(collegeStatus(ended, { now: NOW, graceDays: 0 }).status, 'read_only');
});

test('a revoked subscription does not count; only revoked ones is revoked', () => {
  const revoked = [sub('a', '2026-10-01T00:00:00Z', '2026-12-01T00:00:00Z', { revokedAt: '2026-11-01T00:00:00Z' })];
  assert.equal(collegeStatus(revoked, { now: NOW }).status, 'revoked');
  const withOld = [...revoked, sub('b', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')];
  assert.equal(collegeStatus(withOld, { now: NOW }).status, 'read_only');
});

test('renewals queue: paidUntil is the latest end, the covering one applies', () => {
  const info = collegeStatus(
    [sub('now', '2026-10-01T00:00:00Z', '2026-12-01T00:00:00Z'), sub('next', '2026-12-01T00:00:00Z', '2027-03-01T00:00:00Z')],
    { now: NOW }
  );
  assert.equal(info.subscription.id, 'now');
  assert.equal(info.paidUntil.toISOString(), '2027-03-01T00:00:00.000Z');
});

test('renewalStart: from the current end while active or grace, else now', () => {
  const end = new Date('2026-12-01T00:00:00Z');
  assert.equal(renewalStart({ status: 'active', paidUntil: end }, NOW).toISOString(), end.toISOString());
  assert.equal(renewalStart({ status: 'grace', paidUntil: end }, NOW).toISOString(), end.toISOString());
  assert.equal(renewalStart({ status: 'read_only', paidUntil: end }, NOW).toISOString(), NOW.toISOString());
  assert.equal(renewalStart({ status: 'none', paidUntil: null }, NOW).toISOString(), NOW.toISOString());
  assert.equal(isCovered('grace'), true);
  assert.equal(isCovered('read_only'), false);
});

test('a removed seat still counts for grace_days', () => {
  assert.equal(seatCounts(null), false);
  assert.equal(seatCounts({ removedAt: null }), true);
  assert.equal(seatCounts({ removedAt: '2026-11-05T00:00:00Z' }, { now: NOW, graceDays: 7 }), true);
  assert.equal(seatCounts({ removedAt: '2026-10-05T00:00:00Z' }, { now: NOW, graceDays: 7 }), false);
});

test('journal numbers are upper case without spaces', () => {
  assert.equal(normaliseJournal(' jn 8989 2938 '), 'JN89892938');
});

test('reference codes use the alphabet without look-alikes', () => {
  const code = makeReferenceCode(() => Buffer.from([0, 1, 30, 31, 200, 255]));
  assert.match(code, /^PL-[A-HJKMNP-Z2-9]{6}$/);
});

test("today in Bhutan is UTC+6, so a payment made this morning there isn't in the future", () => {
  assert.equal(todayInBhutan(new Date('2026-11-09T20:00:00Z')), '2026-11-10');
  assert.equal(addDays(new Date('2026-01-01T00:00:00Z'), 30).toISOString(), '2026-01-31T00:00:00.000Z');
});

test('payment request bodies: normalised journal, real dates, two decimals, nothing extra', () => {
  const base = { planId: '0b5c1f9e-2a71-4c8e-9d3b-6e0f4a2c7b11', paymentMethodId: '0b5c1f9e-2a71-4c8e-9d3b-6e0f4a2c7b12', amountNu: 1500.1, paidOn: '2026-11-08' };
  assert.equal(paymentRequestCreate.parse({ ...base, journalNumber: '8989 2938' }).journalNumber, '89892938');
  assert.equal(paymentRequestCreate.safeParse({ ...base, journalNumber: 'ab' }).success, false);
  assert.equal(paymentRequestCreate.safeParse({ ...base, journalNumber: '89892938', paidOn: '2026-02-30' }).success, false);
  assert.equal(paymentRequestCreate.safeParse({ ...base, journalNumber: '89892938', amountNu: 10.005 }).success, false);
  assert.equal(paymentRequestCreate.safeParse({ ...base, journalNumber: '89892938', screenshot: 'x' }).success, false);
});

test('plan bodies', () => {
  assert.equal(planCreate.safeParse({ name: 'College', priceNu: 25000, durationDays: 365, seats: 20 }).success, true);
  assert.equal(planCreate.safeParse({ name: 'College', priceNu: 0, durationDays: 365, seats: 20 }).success, false);
  assert.equal(planUpdate.safeParse({}).success, false);
  assert.equal(planUpdate.safeParse({ isActive: false }).success, true);
});
