import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { makeGroups, planGroupSizes, shuffle } from './autoGroups.js';

describe('planGroupSizes', () => {
  for (const [n, size, want] of [
    [10, 5, [5, 5]],
    [11, 5, [5, 6]], // one left over: the last group is one bigger
    [7, 3, [3, 4]],
    [8, 3, [4, 4]], // two left over, two groups: both one bigger
    [14, 5, [5, 5, 4]], // four left over, only two groups: one more group instead
    [5, 5, [5]],
    [9, 8, [9]],
    [12, 10, [6, 6]],
    [20, 3, [3, 3, 3, 3, 4, 4]],
  ]) {
    test(`${n} students, size ${size}`, () => {
      const sizes = planGroupSizes(n, size);
      assert.equal(sizes.reduce((a, b) => a + b, 0), n, 'everyone is placed');
      assert.deepEqual(sizes, want);
    });
  }

  test('for every class up to 80 and size 2 to 10, the rule holds', () => {
    for (let size = 2; size <= 10; size += 1) {
      for (let n = size; n <= 80; n += 1) {
        const sizes = planGroupSizes(n, size);
        assert.equal(sizes.reduce((a, b) => a + b, 0), n);
        const max = Math.max(...sizes);
        const min = Math.min(...sizes);
        assert.ok(max - min <= 1, `${n}/${size}: groups differ by at most one (${sizes})`);
        if (n % size <= Math.floor(n / size)) {
          assert.ok(sizes.every((s) => s === size || s === size + 1), `${n}/${size}: size or size + 1 (${sizes})`);
        } else {
          assert.ok(max <= size + 1, `${n}/${size}: never bigger than size + 1 (${sizes})`);
        }
      }
    }
  });

  test('fewer students than the size is an error', () => {
    assert.throws(() => planGroupSizes(3, 4), RangeError);
    assert.throws(() => planGroupSizes(0, 2), RangeError);
    assert.throws(() => planGroupSizes(5, 0), RangeError);
  });
});

describe('shuffle and makeGroups', () => {
  test('a shuffle is a permutation and leaves the input alone', () => {
    const input = Array.from({ length: 30 }, (_, i) => `s${i}`);
    const out = shuffle(input);
    assert.deepEqual([...out].sort(), [...input].sort());
    assert.equal(input[0], 's0');
  });

  test('with a fixed random source the result is exact (Fisher–Yates)', () => {
    // random always 0: each step swaps position i with 0.
    assert.deepEqual(shuffle(['a', 'b', 'c', 'd'], () => 0), ['b', 'c', 'd', 'a']);
  });

  test('every student is in exactly one group', () => {
    const students = Array.from({ length: 23 }, (_, i) => `stu-${i}`);
    const groups = makeGroups(students, 4);
    assert.deepEqual(groups.map((g) => g.length), [4, 4, 5, 5, 5]); // 3 left over join the last groups
    const placed = groups.flat();
    assert.equal(new Set(placed).size, students.length);
    assert.deepEqual([...placed].sort(), [...students].sort());
  });

  test('the order really is random', () => {
    const students = Array.from({ length: 12 }, (_, i) => `stu-${i}`);
    const firsts = new Set(Array.from({ length: 40 }, () => makeGroups(students, 3)[0].join()));
    assert.ok(firsts.size > 30, 'forty runs give (almost) forty different first groups');
  });
});
