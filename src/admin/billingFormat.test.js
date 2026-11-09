import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coverageMessage,
  daysUntil,
  formatDate,
  formatNu,
  normaliseJournal,
  paymentFormError,
  paymentPayload,
  planFormError,
  planPayload,
  reasonError,
  statusTone,
  todayInBhutan,
} from './billingFormat.js';

const form = { planId: 'p1', paymentMethodId: 'm1', journalNumber: '8989 2938', paidOn: '2026-11-08' };

test('payment form: each missing or bad field has its own message', () => {
  assert.equal(paymentFormError(form, '2026-11-09'), '');
  assert.match(paymentFormError({ ...form, planId: '' }, '2026-11-09'), /plan/);
  assert.match(paymentFormError({ ...form, paymentMethodId: '' }, '2026-11-09'), /how you paid/);
  assert.match(paymentFormError({ ...form, journalNumber: 'ab' }, '2026-11-09'), /journal number/);
  assert.match(paymentFormError({ ...form, paidOn: '' }, '2026-11-09'), /date/);
  assert.match(paymentFormError({ ...form, paidOn: '2026-11-10' }, '2026-11-09'), /future/);
});

test("payment payload: the amount is the plan's price and the journal is normalised", () => {
  assert.deepEqual(paymentPayload(form, { priceNu: 25000 }), {
    planId: 'p1',
    paymentMethodId: 'm1',
    amountNu: 25000,
    journalNumber: '89892938',
    paidOn: '2026-11-08',
  });
  assert.equal(normaliseJournal(' jn-12 34 '), 'JN-1234');
});

test('plan form and payload', () => {
  const plan = { name: 'College', priceNu: '25000', durationDays: '365', seats: '20', maxCourses: '', monthlyAiAnalyses: '500' };
  assert.equal(planFormError(plan), '');
  assert.match(planFormError({ ...plan, priceNu: '0' }), /price/);
  assert.match(planFormError({ ...plan, seats: '1.5' }), /Seats/);
  assert.match(planFormError({ ...plan, maxCourses: '0' }), /Courses per seat/);
  assert.deepEqual(planPayload(plan), {
    name: 'College',
    priceNu: 25000,
    durationDays: 365,
    seats: 20,
    maxCourses: null,
    monthlyAiAnalyses: 500,
    manualOnly: false,
  });
});

test('reasons are 5 to 500 characters', () => {
  assert.notEqual(reasonError('no'), '');
  assert.equal(reasonError('Not in the statement'), '');
  assert.notEqual(reasonError('x'.repeat(501)), '');
});

test('formatting', () => {
  assert.equal(formatNu(25000), 'Nu. 25,000');
  assert.equal(formatNu(1500.5), 'Nu. 1,500.50');
  assert.equal(formatDate('2026-11-09'), '9 Nov 2026');
  assert.equal(formatDate(null), '—');
  assert.equal(daysUntil('2026-11-12T00:00:00Z', Date.parse('2026-11-09T00:00:00Z')), 3);
  assert.equal(todayInBhutan(new Date('2026-11-09T20:00:00Z')), '2026-11-10');
  assert.equal(statusTone('active'), 'good');
  assert.equal(statusTone('grace'), 'warn');
  assert.equal(statusTone('read_only'), 'bad');
  assert.equal(statusTone('none'), 'muted');
});

test('what a lecturer is told about their plan', () => {
  assert.equal(coverageMessage({ billingEnabled: false, coverage: null }), null);
  assert.match(coverageMessage({ billingEnabled: true, coverage: { covered: false, reason: 'NO_SEAT' } }).text, /seat/);
  assert.match(coverageMessage({ billingEnabled: true, coverage: { covered: true, status: 'grace', graceEndsAt: '2026-11-16T00:00:00Z' } }).text, /keep working/);
  assert.match(coverageMessage({ billingEnabled: true, coverage: { covered: false, status: 'read_only', reason: 'SUBSCRIPTION_INACTIVE' } }).text, /read-only/);
  const far = new Date(Date.now() + 90 * 864e5).toISOString();
  assert.equal(coverageMessage({ billingEnabled: true, coverage: { covered: true, status: 'active', paidUntil: far } }), null);
});
