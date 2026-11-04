import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appVersion } from './appVersion.js';

test('appVersion falls back to "dev"', () => {
  assert.equal(appVersion({}), 'dev');
  assert.equal(appVersion({ VITE_APP_VERSION: '  ' }), 'dev');
  assert.equal(appVersion(), 'dev');
});

test('appVersion shortens a full commit SHA and keeps tags as they are', () => {
  assert.equal(appVersion({ VITE_APP_VERSION: 'b3996c8f0e1d2c3b4a5968778695a4b3c2d1e0f9' }), 'b3996c8');
  assert.equal(appVersion({ VITE_APP_VERSION: 'v1.2.0' }), 'v1.2.0');
  assert.equal(appVersion({ VITE_APP_VERSION: 'b3996c8' }), 'b3996c8');
});
