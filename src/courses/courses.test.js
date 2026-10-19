import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_API_METHODS, isCourseApiReady } from './courseApi.js';
import { COURSE_TABS, parseCourseTab, tabIndexAfterKey } from './tabs.js';
import { DEFAULT_RUBRIC, RUBRIC_CRITERIA, rubricFromPercents, toPercentInputs } from './rubric.js';
import { buildDeadline, parseDate } from './deadline.js';
import { errorKey, listViewState } from './viewState.js';
import { normalizeJoinCode, validateJoinCode } from './joinCode.js';
import { COURSE_STRINGS, courseText } from './strings.js';
import { formatDate } from '../utils/workspaceHelpers.js';

// ── courseApi ──
test('the course site stays off without a complete course API', () => {
  assert.equal(isCourseApiReady(null), false);
  assert.equal(isCourseApiReady(undefined), false);
  assert.equal(isCourseApiReady({}), false);
  const partial = Object.fromEntries(COURSE_API_METHODS.slice(1).map((m) => [m, async () => {}]));
  assert.equal(isCourseApiReady(partial), false);
  const full = Object.fromEntries(COURSE_API_METHODS.map((m) => [m, async () => {}]));
  assert.equal(isCourseApiReady(full), true);
  assert.equal(isCourseApiReady({ ...full, getCourse: 'not a function' }), false);
});

// ── tabs ──
test('a course has the five tabs in order', () => {
  assert.deepEqual([...COURSE_TABS], ['overview', 'assignments', 'groups', 'members', 'grades']);
});

test('unknown or missing tabs open Overview', () => {
  assert.equal(parseCourseTab('grades'), 'grades');
  assert.equal(parseCourseTab('Grades'), 'overview');
  assert.equal(parseCourseTab(undefined), 'overview');
  assert.equal(parseCourseTab('settings'), 'overview');
});

test('arrow keys wrap around the tablist; Home and End jump', () => {
  assert.equal(tabIndexAfterKey(0, 'ArrowRight'), 1);
  assert.equal(tabIndexAfterKey(4, 'ArrowRight'), 0);
  assert.equal(tabIndexAfterKey(0, 'ArrowLeft'), 4);
  assert.equal(tabIndexAfterKey(2, 'Home'), 0);
  assert.equal(tabIndexAfterKey(2, 'End'), 4);
  assert.equal(tabIndexAfterKey(2, 'Enter'), null);
  assert.equal(tabIndexAfterKey(0, 'ArrowRight', 0), null);
});

// ── rubric ──
test('the default rubric is 25% for each criterion and sums to 1', () => {
  assert.deepEqual([...RUBRIC_CRITERIA], ['time', 'edits', 'writing', 'tasks']);
  const total = RUBRIC_CRITERIA.reduce((s, k) => s + DEFAULT_RUBRIC[k], 0);
  assert.equal(total, 1);
  assert.deepEqual(toPercentInputs(), { time: '25', edits: '25', writing: '25', tasks: '25' });
});

test('percent inputs become fractions when they add up to 100', () => {
  const { rubric, errors, total } = rubricFromPercents({ time: '10', edits: '20', writing: '50', tasks: '20' });
  assert.deepEqual(errors, {});
  assert.equal(total, 100);
  assert.deepEqual(rubric, { time: 0.1, edits: 0.2, writing: 0.5, tasks: 0.2 });
  assert.ok(rubricFromPercents({ time: '33.33', edits: '33.33', writing: '33.34', tasks: '0' }).rubric);
  assert.ok(rubricFromPercents(toPercentInputs()).rubric);
});

test('the rubric rejects totals other than 100', () => {
  const r = rubricFromPercents({ time: '25', edits: '25', writing: '25', tasks: '20' });
  assert.equal(r.rubric, null);
  assert.equal(r.total, 95);
  assert.deepEqual(r.errors, { total: 'weightsTotal' });
});

test('the rubric rejects blank, negative, too large and non-numeric weights', () => {
  const r = rubricFromPercents({ time: '', edits: '-5', writing: '150', tasks: 'abc' });
  assert.equal(r.rubric, null);
  assert.deepEqual(r.errors, { time: 'weightInvalid', edits: 'weightInvalid', writing: 'weightInvalid', tasks: 'weightInvalid' });
  assert.equal(rubricFromPercents(null).rubric, null);
});

// ── deadline ──
test('dates are read as dd/mm/yyyy', () => {
  const d = parseDate('05/11/2026');
  assert.equal(d.getDate(), 5);
  assert.equal(d.getMonth(), 10);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(formatDate(parseDate('5/1/2027')), '05/01/2027');
  assert.equal(formatDate(parseDate(' 31/12/2026 ')), '31/12/2026');
});

test('impossible and malformed dates are rejected', () => {
  for (const bad of ['31/02/2027', '29/02/2027', '00/01/2027', '12/13/2026', '2026-11-05', '05-11-2026', '', null]) {
    assert.equal(parseDate(bad), null, String(bad));
  }
  assert.ok(parseDate('29/02/2028'), 'leap day');
});

test('a deadline combines the date and a 24-hour time', () => {
  const now = new Date(2026, 9, 18, 12, 0).getTime();
  const { deadline, error } = buildDeadline('20/10/2026', '23:59', now);
  assert.equal(error, null);
  assert.equal(deadline.getTime(), new Date(2026, 9, 20, 23, 59).getTime());
  assert.equal(buildDeadline('20/10/2026', '9:05', now).deadline.getHours(), 9);
});

test('a deadline needs a valid time and must be in the future', () => {
  const now = new Date(2026, 9, 18, 12, 0).getTime();
  assert.equal(buildDeadline('32/10/2026', '10:00', now).error, 'dateInvalid');
  assert.equal(buildDeadline('20/10/2026', '24:00', now).error, 'timeInvalid');
  assert.equal(buildDeadline('20/10/2026', '10am', now).error, 'timeInvalid');
  assert.equal(buildDeadline('18/10/2026', '12:00', now).error, 'deadlinePast');
  assert.equal(buildDeadline('17/10/2026', '23:00', now).error, 'deadlinePast');
});

// ── viewState ──
test('API errors map to the contract codes', () => {
  assert.equal(errorKey(null), null);
  assert.equal(errorKey({ status: 0, code: 'NETWORK_ERROR' }), 'errorOffline');
  assert.equal(errorKey({ status: 401, code: 'TOKEN_EXPIRED' }), 'errorSignedOut');
  assert.equal(errorKey({ status: 403, code: 'NO_ROLE' }), 'errorNoRole');
  assert.equal(errorKey({ status: 403, code: 'FORBIDDEN' }), 'errorForbidden');
  assert.equal(errorKey({ status: 404 }), 'errorNotFound');
  assert.equal(errorKey({ status: 501 }), 'errorUnavailable');
  assert.equal(errorKey({ status: 429 }), 'errorRateLimited');
  assert.equal(errorKey({ status: 400, code: 'INVALID_BODY' }), 'errorInvalid');
  assert.equal(errorKey({ status: 500 }), 'errorGeneric');
  assert.equal(errorKey(new Error('boom')), 'errorGeneric');
});

test('without the API a list is unavailable, never empty or filled', () => {
  assert.equal(listViewState({ ready: false, loading: false, error: null, items: [] }), 'unavailable');
  assert.equal(listViewState({ ready: false, loading: true, error: null, items: [{}] }), 'unavailable');
  assert.equal(listViewState({ ready: true, loading: true, error: null, items: [] }), 'loading');
  assert.equal(listViewState({ ready: true, loading: false, error: { status: 0 }, items: [] }), 'error');
  assert.equal(listViewState({ ready: true, loading: false, error: null, items: [] }), 'empty');
  assert.equal(listViewState({ ready: true, loading: false, error: null, items: null }), 'empty');
  assert.equal(listViewState({ ready: true, loading: false, error: null, items: [{ id: 'c1' }] }), 'ready');
});

// ── joinCode ──
test('join codes are trimmed and required, and otherwise left to the server', () => {
  assert.equal(normalizeJoinCode('  abC-12 '), 'abC-12');
  assert.equal(normalizeJoinCode(null), '');
  assert.equal(validateJoinCode('   '), 'joinCodeRequired');
  assert.equal(validateJoinCode('x'), null);
});

// ── strings ──
test('English and Dzongkha have the same keys and no empty text', () => {
  const en = Object.keys(COURSE_STRINGS.en).sort();
  const dz = Object.keys(COURSE_STRINGS.dz).sort();
  assert.deepEqual(dz, en);
  for (const lang of ['en', 'dz']) {
    for (const [key, text] of Object.entries(COURSE_STRINGS[lang])) {
      assert.ok(typeof text === 'string' && text.trim(), `${lang}.${key}`);
    }
  }
});

test('every message key the course logic can return has text', () => {
  const keys = new Set([
    'joinCodeRequired', 'dateInvalid', 'timeInvalid', 'deadlinePast', 'weightInvalid', 'weightsTotal',
    ...[0, 401, 403, 404, 429, 400, 500, 501].map((status) => errorKey({ status })),
    errorKey({ status: 403, code: 'NO_ROLE' }),
    ...COURSE_TABS.map((tab) => `tab${tab[0].toUpperCase()}${tab.slice(1)}`),
    ...RUBRIC_CRITERIA.map((c) => `criterion${c[0].toUpperCase()}${c.slice(1)}`),
  ]);
  for (const key of keys) assert.ok(key in COURSE_STRINGS.en, key);
});

test('courseText fills placeholders and falls back to English', () => {
  assert.equal(courseText('en')('due', { date: '20/10/2026' }), 'Due 20/10/2026');
  assert.equal(courseText('dz')('title'), COURSE_STRINGS.dz.title);
  assert.equal(courseText('fr')('title'), 'Courses');
  assert.equal(courseText('en')('openCourse', {}), 'Open {title}');
  assert.equal(courseText('en')('missingKey'), 'missingKey');
});
