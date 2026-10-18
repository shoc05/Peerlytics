import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectiveDeadlineMs, isDue, toMs } from './time.js';

test('a zone-less datetime-local deadline is read in Bhutan time, not server time', () => {
  // 23:59 in Thimphu (UTC+6) is 17:59 UTC.
  assert.equal(toMs('2026-10-20T23:59'), Date.UTC(2026, 9, 20, 17, 59));
  assert.equal(toMs('2026-10-20T23:59:30'), Date.UTC(2026, 9, 20, 17, 59, 30));
});

test('another college time zone, including daylight saving', () => {
  assert.equal(toMs('2026-07-01T12:00', 'America/New_York'), Date.UTC(2026, 6, 1, 16, 0));
  assert.equal(toMs('2026-01-15T12:00', 'America/New_York'), Date.UTC(2026, 0, 15, 17, 0));
});

test('zoned strings, Timestamps, Dates and epoch ms are taken as they are', () => {
  assert.equal(toMs('2026-10-20T18:00:00.000Z'), Date.UTC(2026, 9, 20, 18));
  assert.equal(toMs('2026-10-20T23:59+06:00'), Date.UTC(2026, 9, 20, 17, 59));
  assert.equal(toMs({ toMillis: () => 1234 }), 1234);
  assert.equal(toMs(new Date(5678)), 5678);
  assert.equal(toMs(42), 42);
});

test('a date-only deadline is UTC midnight, exactly as the browser countdown reads it', () => {
  assert.equal(toMs('2026-10-20'), new Date('2026-10-20').getTime());
});

test('missing or unreadable deadlines are null', () => {
  for (const v of [null, undefined, '', 'next friday', new Date('x'), NaN, {}]) assert.equal(toMs(v), null);
});

test('an extended deadline wins over the original one', () => {
  const group = { deadline: '2026-10-20T10:00:00Z', extendedDeadline: '2026-10-22T10:00:00Z' };
  assert.equal(effectiveDeadlineMs(group), Date.UTC(2026, 9, 22, 10));
  assert.equal(effectiveDeadlineMs({ deadline: '2026-10-20T10:00:00Z', extendedDeadline: null }), Date.UTC(2026, 9, 20, 10));
});

test('isDue: from the deadline instant on, never when locked or without a deadline', () => {
  const d = Date.UTC(2026, 9, 20, 10);
  const group = { deadline: new Date(d).toISOString() };
  assert.equal(isDue(group, d - 1), false);
  assert.equal(isDue(group, d), true);
  assert.equal(isDue(group, d + 60_000), true);
  assert.equal(isDue({ ...group, locked: true }, d + 60_000), false);
  assert.equal(isDue({}, d), false);
  assert.equal(isDue({ ...group, extendedDeadline: new Date(d + 3600_000).toISOString() }, d + 60_000), false);
});
