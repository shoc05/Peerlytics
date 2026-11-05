import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  collegeFormError,
  filterUsers,
  isSubmitted,
  licenceFormError,
  licencePayload,
  licenceStatus,
  namesFor,
  slugFromName,
  todayIso,
} from './adminArea.js';

const FORM = { plan: 'trial', seats: '30', monthlyAiBudgetUsd: '10', startsOn: '2026-01-01', endsOn: '' };

test('todayIso uses the local date with leading zeros', () => {
  assert.equal(todayIso(new Date(2026, 0, 5, 12)), '2026-01-05');
});

test('licenceStatus covers every case, including the first and last day', () => {
  const licence = { startsOn: '2026-01-01', endsOn: '2026-06-30' };
  assert.equal(licenceStatus(null), 'none');
  assert.equal(licenceStatus(licence, '2025-12-31'), 'upcoming');
  assert.equal(licenceStatus(licence, '2026-01-01'), 'active');
  assert.equal(licenceStatus(licence, '2026-06-30'), 'active');
  assert.equal(licenceStatus(licence, '2026-07-01'), 'expired');
  assert.equal(licenceStatus({ startsOn: '2026-01-01', endsOn: null }, '2099-01-01'), 'active');
});

test('slugFromName makes a short name the API accepts', () => {
  assert.equal(slugFromName(' College of Science & Technology! '), 'college-of-science-technology');
  assert.equal(slugFromName(''), '');
  const long = slugFromName(`${'a'.repeat(39)} b`);
  assert.equal(long.length <= 40, true);
  assert.equal(long.endsWith('-'), false);
});

test('collegeFormError checks the name and the short name', () => {
  assert.equal(collegeFormError({ name: 'CST College', slug: 'cst' }), '');
  assert.match(collegeFormError({ name: ' ', slug: 'cst' }), /college name/);
  assert.match(collegeFormError({ name: 'CST', slug: 'Not Valid' }), /short name/);
});

test('licenceFormError finds each problem', () => {
  assert.equal(licenceFormError(FORM), '');
  assert.match(licenceFormError({ ...FORM, seats: '0' }), /Seats/);
  assert.match(licenceFormError({ ...FORM, seats: '1.5' }), /Seats/);
  assert.match(licenceFormError({ ...FORM, monthlyAiBudgetUsd: '' }), /budget/);
  assert.match(licenceFormError({ ...FORM, monthlyAiBudgetUsd: '-1' }), /budget/);
  assert.match(licenceFormError({ ...FORM, startsOn: '' }), /start date/);
  assert.match(licenceFormError({ ...FORM, endsOn: '2026-01-01' }), /end date/);
});

test('licencePayload sends numbers, and null for no end date', () => {
  assert.deepEqual(licencePayload(FORM), { plan: 'trial', seats: 30, monthlyAiBudgetUsd: 10, startsOn: '2026-01-01', endsOn: null });
});

test('filterUsers searches name and email and sorts by name', () => {
  const users = [
    { name: 'Tashi', email: 't@x.test' },
    { name: 'Dorji', email: 'other@x.test' },
    { email: 'noname@x.test' },
  ];
  assert.deepEqual(filterUsers(users, '').map((u) => u.name ?? u.email), ['Dorji', 'noname@x.test', 'Tashi']);
  assert.deepEqual(filterUsers(users, 'OTHER@').map((u) => u.name), ['Dorji']);
  assert.deepEqual(filterUsers(users, 'zzz'), []);
});

test('isSubmitted is false for a new group, whose list is empty', () => {
  assert.equal(isSubmitted({ submittedToLecturers: [] }), false);
  assert.equal(isSubmitted({ submittedToLecturers: ['lec-1'] }), true);
  assert.equal(isSubmitted({}), false);
});

test('namesFor falls back to the email, then the id', () => {
  const byId = { a: { name: 'Ann' }, b: { email: 'b@x.test' } };
  assert.deepEqual(namesFor(['a', 'b', 'c'], byId), ['Ann', 'b@x.test', 'c']);
  assert.deepEqual(namesFor(undefined, byId), []);
});
