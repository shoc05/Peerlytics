import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { loadConfig, missingProviderKeys } from './index.js';

describe('loadConfig', () => {
  test('an empty environment gives the old defaults', () => {
    const c = loadConfig({});
    assert.equal(c.port, 5000);
    assert.equal(c.corsOrigin, true);
    assert.equal(c.databaseUrl, null);
    assert.equal(c.databasePoolMax, 10);
    assert.equal(c.env, 'development');
    assert.equal(c.runJobs, true);
  });

  test('RUN_JOBS=false turns the background jobs off; other values are rejected', () => {
    assert.equal(loadConfig({ RUN_JOBS: 'false' }).runJobs, false);
    assert.equal(loadConfig({ RUN_JOBS: 'true' }).runJobs, true);
    assert.equal(loadConfig({ RUN_JOBS: '' }).runJobs, true);
    assert.throws(() => loadConfig({ RUN_JOBS: 'no' }), /RUN_JOBS/);
  });

  test('empty strings from .env count as unset', () => {
    const c = loadConfig({ PORT: '', CORS_ORIGIN: '', DATABASE_URL: '' });
    assert.equal(c.port, 5000);
    assert.equal(c.corsOrigin, true);
    assert.equal(c.databaseUrl, null);
  });

  test('reads the values that are set', () => {
    const c = loadConfig({
      PORT: '8080',
      CORS_ORIGIN: 'http://localhost:3000',
      DATABASE_URL: 'postgres://u:p@db:5432/peerlytics',
      DATABASE_POOL_MAX: '4',
      NODE_ENV: 'production',
    });
    assert.equal(c.port, 8080);
    assert.equal(c.corsOrigin, 'http://localhost:3000');
    assert.equal(c.databaseUrl, 'postgres://u:p@db:5432/peerlytics');
    assert.equal(c.databasePoolMax, 4);
    assert.equal(c.env, 'production');
    assert.ok(Object.isFrozen(c));
  });

  test('bad values fail with every variable named and no value echoed', () => {
    assert.throws(
      () => loadConfig({ PORT: 'abc', DATABASE_URL: 'mysql://secret-password@host/db' }),
      (err) => {
        assert.match(err.message, /PORT/);
        assert.match(err.message, /DATABASE_URL/);
        assert.doesNotMatch(err.message, /secret-password/);
        return true;
      }
    );
  });
});

describe('missingProviderKeys', () => {
  test('lists keys that are unset or still placeholders', () => {
    const missing = missingProviderKeys({ HF_API_KEY: 'your_hf_key_here', VWT_API_KEY: 'real' });
    assert.deepEqual(missing.map(([k]) => k), ['HF_API_KEY']);
  });

  test('is empty when both keys are set', () => {
    assert.deepEqual(missingProviderKeys({ HF_API_KEY: 'a', VWT_API_KEY: 'b' }), []);
  });
});
