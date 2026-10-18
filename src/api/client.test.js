import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createApiClient, parseRetryAfter } from './client.js';
import { AI_UNAVAILABLE_MESSAGE, createApi } from './endpoints.js';

// A stub fetch that records calls and answers with the given status, body and headers.
function stubFetch({ status = 200, body = {}, headers = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => headers[name] ?? null },
      json: async () => body,
    };
  };
  return { fetchImpl, calls };
}

const user = (token = 'id-token-1') => {
  const forced = [];
  return { forced, getIdToken: async (force) => { forced.push(force); return token; } };
};

test('sends the ID token as a Bearer header on API calls', async () => {
  const { fetchImpl, calls } = stubFetch({ body: { uid: 'u1', role: 'student' } });
  const api = createApi(createApiClient({ baseUrl: 'http://api', fetchImpl, getUser: () => user('tok') }));
  const me = await api.getMe();
  assert.deepEqual(me, { uid: 'u1', role: 'student' });
  assert.equal(calls[0].url, 'http://api/api/auth/me');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
});

test('POST bodies are JSON and keep the token', async () => {
  const { fetchImpl, calls } = stubFetch({ body: { role: 'lecturer', collegeId: null } });
  const api = createApi(createApiClient({ fetchImpl, getUser: () => user('tok') }));
  await api.chooseRole('lecturer');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(calls[0].init.body), { role: 'lecturer' });
});

test('/api/health is the one call sent without a token', async () => {
  const { fetchImpl, calls } = stubFetch({ body: { status: 'ok' } });
  const api = createApi(createApiClient({ fetchImpl, getUser: () => user() }));
  await api.healthCheck();
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test('no Authorization header when nobody is signed in', async () => {
  const { fetchImpl, calls } = stubFetch();
  await createApiClient({ fetchImpl, getUser: () => null }).request('/api/auth/me');
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test('authHeaders can force a token refresh after a role change', async () => {
  const u = user('fresh');
  const client = createApiClient({ fetchImpl: stubFetch().fetchImpl, getUser: () => u });
  assert.deepEqual(await client.authHeaders({ forceRefresh: true }), { Authorization: 'Bearer fresh' });
  assert.deepEqual(u.forced, [true]);
});

test('401 TOKEN_REVOKED signs the user out and throws with the code', async () => {
  const { fetchImpl } = stubFetch({ status: 401, body: { error: 'Please sign in again.', code: 'TOKEN_REVOKED' } });
  let signedOut = 0;
  const client = createApiClient({ fetchImpl, getUser: () => user(), onRevoked: async () => { signedOut += 1; } });
  await assert.rejects(client.request('/api/auth/me'), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 401);
    assert.equal(err.code, 'TOKEN_REVOKED');
    assert.equal(err.message, 'Please sign in again.');
    return true;
  });
  assert.equal(signedOut, 1);
});

test('other 401s do not sign the user out', async () => {
  const { fetchImpl } = stubFetch({ status: 401, body: { error: 'Expired', code: 'TOKEN_EXPIRED' } });
  let signedOut = 0;
  const client = createApiClient({ fetchImpl, getUser: () => user(), onRevoked: async () => { signedOut += 1; } });
  await assert.rejects(client.request('/api/auth/me'), { code: 'TOKEN_EXPIRED' });
  assert.equal(signedOut, 0);
});

test('429 carries the wait time from Retry-After', async () => {
  const { fetchImpl } = stubFetch({ status: 429, body: { error: 'Too many requests' }, headers: { 'Retry-After': '42' } });
  await assert.rejects(createApiClient({ fetchImpl, getUser: () => null }).request('/api/check'), {
    status: 429,
    retryAfter: 42,
  });
});

test('parseRetryAfter reads seconds, HTTP dates and the body field', () => {
  const now = Date.parse('2026-10-18T10:00:00Z');
  assert.equal(parseRetryAfter('7', null, now), 7);
  assert.equal(parseRetryAfter('Sun, 18 Oct 2026 10:01:30 GMT', null, now), 90);
  assert.equal(parseRetryAfter(null, { retryAfter: 12.2 }, now), 13);
  assert.equal(parseRetryAfter('soon', {}, now), null);
});

test('an unreachable backend becomes a NETWORK_ERROR with status 0', async () => {
  const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(createApiClient({ fetchImpl, getUser: () => null }).request('/api/auth/me'), {
    status: 0,
    code: 'NETWORK_ERROR',
  });
});

test('error without a JSON body falls back to the status in the message', async () => {
  const fetchImpl = async () => ({ ok: false, status: 502, headers: { get: () => null }, json: async () => { throw new Error('html'); } });
  await assert.rejects(createApiClient({ fetchImpl, getUser: () => null }).request('/api/x'), {
    message: 'Request failed (502)',
    status: 502,
  });
});

test('submitForCheck never fails: backend down returns the AI-unavailable report', async () => {
  const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
  const warnings = [];
  const api = createApi(createApiClient({ fetchImpl, getUser: () => user() }), { warn: (...a) => warnings.push(a) });
  const out = await api.submitForCheck({
    userId: 'u1', fileId: 'f1', groupId: 'g1', text: 'two words',
    pasteEvents: [{ changeType: 'paste-large' }, { changeType: 'paste-small' }],
  });
  assert.equal(out.report.aiEvaluation, 'unavailable');
  assert.equal(out.report.suggestedGrade, null);
  assert.equal(out.report.feedback.summary, AI_UNAVAILABLE_MESSAGE);
  assert.equal(out.report.audit.largePasteCount, 1);
  assert.equal(out.extraction.wordCount, 2);
  assert.equal(warnings.length, 1);
});

test('submitForCheck returns the backend report when the check succeeds', async () => {
  const { fetchImpl, calls } = stubFetch({ body: { report: { id: 'r1' } } });
  const api = createApi(createApiClient({ fetchImpl, getUser: () => user('tok') }));
  assert.deepEqual(await api.submitForCheck({ text: 'x' }), { report: { id: 'r1' } });
  assert.equal(calls[0].url, '/api/check');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
});

test('grantExtension encodes the group id in the path', async () => {
  const { fetchImpl, calls } = stubFetch();
  const api = createApi(createApiClient({ fetchImpl, getUser: () => user() }));
  await api.grantExtension('g/1', { deadline: '2026-10-20T00:00:00Z', reason: 'ill' });
  assert.equal(calls[0].url, '/api/groups/g%2F1/extension');
});
