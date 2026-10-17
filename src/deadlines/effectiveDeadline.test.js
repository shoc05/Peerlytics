import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveDeadline, isExtended, localInputToIso } from './effectiveDeadline.js';

test('an extension wins over the original deadline', () => {
  assert.equal(effectiveDeadline({ deadline: 'a', extendedDeadline: 'b' }), 'b');
  assert.equal(effectiveDeadline({ deadline: 'a' }), 'a');
  assert.equal(effectiveDeadline(null), null);
  assert.equal(isExtended({ extendedDeadline: 'b' }), true);
  assert.equal(isExtended({ deadline: 'a' }), false);
});

test('datetime-local input becomes an exact instant', () => {
  const iso = localInputToIso('2026-10-23T18:00');
  assert.equal(new Date(iso).getTime(), new Date('2026-10-23T18:00').getTime());
  assert.equal(localInputToIso('tomorrow'), null);
  assert.equal(localInputToIso(''), null);
});
