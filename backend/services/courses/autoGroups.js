// Random groups (step 3.7). Pure functions: the randomness is passed in, so tests are exact.
//
// Sizes: floor(n / size) groups, and the students left over join the last groups one each
// ("the last can be one bigger"). If that would make a group bigger than size + 1, one more
// group is made instead and the students are spread as evenly as possible (bigger groups first).
//   11 students, size 5 -> 5, 6        14 students, size 5 -> 5, 5, 4
import { randomInt } from 'node:crypto';

/** Group sizes for n students; throws if n < size. */
export function planGroupSizes(n, size) {
  if (!Number.isInteger(n) || !Number.isInteger(size) || size < 1) throw new RangeError('n and size must be whole numbers, size at least 1');
  const groups = Math.floor(n / size);
  if (groups === 0) throw new RangeError('fewer students than the group size');
  const left = n - groups * size;
  if (left <= groups) {
    return Array.from({ length: groups }, (_, i) => size + (i >= groups - left ? 1 : 0));
  }
  const more = groups + 1;
  const base = Math.floor(n / more);
  const extra = n % more;
  return Array.from({ length: more }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Fisher–Yates shuffle of a copy, using `random(max)` -> an integer in [0, max). */
export function shuffle(items, random = randomInt) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = random(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Shuffle the students and cut them into groups of the planned sizes. */
export function makeGroups(students, size, random = randomInt) {
  const sizes = planGroupSizes(students.length, size);
  const shuffled = shuffle(students, random);
  let at = 0;
  return sizes.map((n) => {
    const group = shuffled.slice(at, at + n);
    at += n;
    return group;
  });
}
