import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSeedCoordinator, SEED_MESSAGE } from './seed.js';

const conn = (socketId, readOnly = false) => {
  const sent = [];
  return { socketId, readOnly, sent, sendStateless: (m) => sent.push(m) };
};

test('only the first writable connection is asked to seed', () => {
  const seeds = createSeedCoordinator();
  const reader = conn('r', true);
  const a = conn('a');
  const b = conn('b');
  assert.equal(seeds.offer('doc', a), false); // nothing pending yet
  seeds.markEmpty('doc');
  assert.equal(seeds.offer('doc', reader), false);
  assert.equal(seeds.offer('doc', a), true);
  assert.equal(seeds.offer('doc', b), false);
  assert.deepEqual(a.sent, [SEED_MESSAGE]);
  assert.deepEqual(b.sent, []);
  assert.deepEqual(reader.sent, []);
});

test('if the seeder leaves before there is content, the next writer is asked', () => {
  const seeds = createSeedCoordinator();
  const a = conn('a');
  const reader = conn('r', true);
  const b = conn('b');
  seeds.markEmpty('doc');
  seeds.offer('doc', a);
  seeds.released('doc', 'a', { isEmpty: true, connections: [reader, b] });
  assert.deepEqual(b.sent, [SEED_MESSAGE]);
  assert.deepEqual(reader.sent, []);
});

test('nothing happens when the seeder leaves after seeding, or someone else leaves', () => {
  const seeds = createSeedCoordinator();
  const a = conn('a');
  const b = conn('b');
  seeds.markEmpty('doc');
  seeds.offer('doc', a);
  seeds.released('doc', 'b', { isEmpty: true, connections: [a] });
  seeds.released('doc', 'a', { isEmpty: false, connections: [b] });
  assert.deepEqual(b.sent, []);
  assert.equal(seeds.isPending('doc'), false);
});

test('the last seeder leaving an empty document keeps it pending for the next visitor', () => {
  const seeds = createSeedCoordinator();
  seeds.markEmpty('doc');
  seeds.offer('doc', conn('a'));
  seeds.released('doc', 'a', { isEmpty: true, connections: [] });
  assert.equal(seeds.isPending('doc'), true);
  seeds.forget('doc');
  assert.equal(seeds.isPending('doc'), false);
});
