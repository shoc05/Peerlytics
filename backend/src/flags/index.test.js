import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createFlags, envOverrides, FLAG_DEFAULTS, FLAG_NAMES, parseFlagValue } from './index.js';

const template = JSON.parse(readFileSync(new URL('../../../remoteconfig.template.json', import.meta.url), 'utf8'));
const frontendDefaults = (await import('../../../src/flags/flags.js')).FLAG_DEFAULTS;

test('defaults match remoteconfig.template.json and the frontend', () => {
  assert.deepEqual(Object.keys(template.parameters).sort(), [...FLAG_NAMES].sort());
  for (const name of FLAG_NAMES) {
    assert.equal(template.parameters[name].defaultValue.value, String(FLAG_DEFAULTS[name]), name);
  }
  assert.deepEqual({ ...FLAG_DEFAULTS }, { ...frontendDefaults });
});

test('parseFlagValue keeps bad values at the safe default', () => {
  assert.equal(parseFlagValue('yjs_enabled', 'true'), true);
  assert.equal(parseFlagValue('yjs_enabled', 'maybe'), false);
  assert.equal(parseFlagValue('ai_provider', 'openai'), 'openai');
  assert.equal(parseFlagValue('ai_provider', 'nope'), 'legacy');
});

test('envOverrides reads FLAG_<NAME>', () => {
  assert.deepEqual(envOverrides({ FLAG_AI_DETECTION_ENABLED: 'false', FLAG_X: '1' }), { ai_detection_enabled: 'false' });
});

test('defaults without Remote Config; env beats Remote Config', async () => {
  const none = createFlags({ load: async () => null, env: {} });
  assert.deepEqual(await none.all(), { ...FLAG_DEFAULTS });

  const flags = createFlags({
    load: async () => ({ yjs_enabled: 'true', ai_provider: 'openai' }),
    env: { FLAG_AI_PROVIDER: 'legacy' },
  });
  assert.equal(await flags.get('yjs_enabled'), true);
  assert.equal(await flags.get('ai_provider'), 'legacy');
  await assert.rejects(flags.get('not_a_flag'), /Unknown feature flag/);
});

test('cached for a minute, and a failed fetch keeps the last good values', async () => {
  let clock = 0;
  let calls = 0;
  let fail = false;
  const warnings = [];
  const flags = createFlags({
    load: async () => {
      calls += 1;
      if (fail) throw new Error('offline');
      return { push_enabled: 'true' };
    },
    env: {},
    now: () => clock,
    log: (m) => warnings.push(m),
  });
  assert.equal(await flags.get('push_enabled'), true);
  clock = 30_000;
  await flags.get('push_enabled');
  assert.equal(calls, 1);

  fail = true;
  clock = 61_000;
  assert.equal(await flags.get('push_enabled'), true);
  assert.equal(calls, 2);
  assert.equal(warnings.length, 1);
});

test('concurrent reads share one fetch', async () => {
  let calls = 0;
  const flags = createFlags({ load: async () => { calls += 1; return {}; }, env: {} });
  await Promise.all([flags.all(), flags.all(), flags.all()]);
  assert.equal(calls, 1);
});
