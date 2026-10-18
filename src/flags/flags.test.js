import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { envOverrides, FLAG_DEFAULTS, FLAG_NAMES, parseFlagValue, resolveFlags } from './flags.js';

const template = JSON.parse(readFileSync(new URL('../../remoteconfig.template.json', import.meta.url), 'utf8'));

test('defaults match remoteconfig.template.json exactly', () => {
  assert.deepEqual(Object.keys(template.parameters).sort(), [...FLAG_NAMES].sort());
  for (const name of FLAG_NAMES) {
    assert.equal(template.parameters[name].defaultValue.value, String(FLAG_DEFAULTS[name]), name);
  }
});

test('every advanced feature is off by default; existing behaviour stays on', () => {
  for (const name of FLAG_NAMES) {
    if (name === 'ai_provider' || name === 'ai_detection_enabled') continue;
    assert.equal(FLAG_DEFAULTS[name], false, name);
  }
  assert.equal(FLAG_DEFAULTS.ai_detection_enabled, true);
  assert.equal(FLAG_DEFAULTS.ai_provider, 'legacy');
});

test('parseFlagValue reads Remote Config strings and falls back on anything odd', () => {
  assert.equal(parseFlagValue('yjs_enabled', 'true'), true);
  assert.equal(parseFlagValue('yjs_enabled', ' FALSE '), false);
  assert.equal(parseFlagValue('yjs_enabled', '1'), true);
  assert.equal(parseFlagValue('yjs_enabled', 'yes please'), false);
  assert.equal(parseFlagValue('ai_detection_enabled', ''), true);
  assert.equal(parseFlagValue('ai_provider', 'openai'), 'openai');
  assert.equal(parseFlagValue('ai_provider', 'gpt'), 'legacy');
});

test('resolveFlags: later sources win, unknown names are dropped', () => {
  const flags = resolveFlags({ yjs_enabled: 'true', made_up: 'true' }, { ai_provider: 'openai' });
  assert.equal(flags.yjs_enabled, true);
  assert.equal(flags.ai_provider, 'openai');
  assert.equal('made_up' in flags, false);
});

test('tabs and offline switch off when Yjs is off', () => {
  assert.equal(resolveFlags({ doc_tabs_enabled: 'true', offline_enabled: 'true' }).doc_tabs_enabled, false);
  const on = resolveFlags({ yjs_enabled: true, doc_tabs_enabled: true, offline_enabled: true });
  assert.equal(on.doc_tabs_enabled, true);
  assert.equal(on.offline_enabled, true);
});

test('envOverrides picks up VITE_FLAG_* only', () => {
  assert.deepEqual(envOverrides({ VITE_FLAG_YJS_ENABLED: 'true', VITE_OTHER: 'x', VITE_FLAG_PUSH_ENABLED: '' }), {
    yjs_enabled: 'true',
  });
});
