// OpenAI, Hugging Face and Virtual Writing Tutor are all stubbed here: no network calls.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createOpenAIProvider, estimateCost, SYSTEM_PROMPT } from './openaiProvider.js';
import { createLegacyProvider } from './legacyProvider.js';
import { createAnalysisService } from './analysisService.js';
import { openaiResponseSchema, validateAnalysisResult, validateTrackingEvent } from './validate.js';
import { keepVerbatim } from './text.js';
import { buildAuthorMetrics } from '../submissions/workspaceStore.js';

const TEXT =
  'Climate policy in Bhutan balances growth with conservation. The constitution requires sixty percent forest cover at all times. ' +
  'Hydropower exports fund public services, but they depend on glaciers that are retreating every year.';

const goodResult = () => ({
  ai_likelihood: 35,
  flagged_sentences: [{ sentence: 'The constitution requires sixty percent forest cover at all times.', reason: 'Generic phrasing' }],
  writing_quality: 7.5,
  writing_feedback: { strengths: ['Clear thesis'], weaknesses: ['Few sources'], summary: 'Solid and focused.' },
  difficulty: 2,
  grade_explanation: 'Clear structure; needs more evidence.',
});

const SETTINGS = {
  apiKey: 'sk-test-not-real',
  model: 'test-model',
  baseUrl: 'https://openai.test/v1',
  timeoutMs: 5000,
  maxInputChars: 60000,
  priceInputPer1M: 0.5,
  priceOutputPer1M: 2,
};

/** A fetch stub that records the request and answers with `reply` (an object, a function or an Error). */
function fakeFetch(reply) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const r = typeof reply === 'function' ? reply() : reply;
    if (r instanceof Error) throw r;
    return { ok: r.status === undefined || r.status < 400, status: r.status ?? 200, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}

const completion = (content, usage = { prompt_tokens: 1000, completion_tokens: 200 }) => ({
  body: { choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }], usage },
});

describe('JSON Schemas (Ajv)', () => {
  test('a full analysis result passes; out-of-range values and extra fields fail', () => {
    assert.equal(validateAnalysisResult(goodResult()).valid, true);
    assert.equal(validateAnalysisResult({ ...goodResult(), ai_likelihood: 101 }).valid, false);
    assert.equal(validateAnalysisResult({ ...goodResult(), writing_quality: -1 }).valid, false);
    assert.equal(validateAnalysisResult({ ...goodResult(), difficulty: 4 }).valid, false);
    assert.equal(validateAnalysisResult({ ...goodResult(), grade: 9 }).valid, false);
    const missing = goodResult();
    delete missing.ai_likelihood;
    assert.equal(validateAnalysisResult(missing).valid, false);
  });

  test('nulls are allowed where a part was unavailable', () => {
    assert.equal(validateAnalysisResult({ ...goodResult(), ai_likelihood: null, writing_quality: null, difficulty: null, grade_explanation: null }).valid, true);
  });

  test('the OpenAI schema keeps the shape but drops keywords strict mode rejects', () => {
    const json = JSON.stringify(openaiResponseSchema);
    for (const k of ['"minimum"', '"maximum"', '"maxLength"', '"maxItems"', '"$schema"', '"$id"']) assert.equal(json.includes(k), false, k);
    assert.deepEqual(openaiResponseSchema.required, Object.keys(openaiResponseSchema.properties));
    assert.equal(openaiResponseSchema.additionalProperties, false);
  });

  test('tracking events: counts pass; any text field is rejected', () => {
    const at = Date.parse('2026-10-19T10:00:00Z');
    assert.equal(validateTrackingEvent({ kind: 'metric', at, payload: { timeSpent: 1.5, edits: 12, tabId: 'k3j2h1g0' } }).valid, true);
    assert.equal(validateTrackingEvent({ kind: 'paste', at, payload: { fileId: 'f1', length: 420, changeType: 'paste-large' } }).valid, true);
    assert.equal(validateTrackingEvent({ kind: 'version', at, payload: { fileId: 'f1', wordCount: 900 } }).valid, true);

    assert.equal(validateTrackingEvent({ kind: 'paste', at, payload: { fileId: 'f1', length: 4, changeType: 'paste-small', contentSnippet: 'text' } }).valid, false);
    assert.equal(validateTrackingEvent({ kind: 'version', at, payload: { fileId: 'f1', wordCount: 1, content: '<p>text</p>' } }).valid, false);
    assert.equal(validateTrackingEvent({ kind: 'metric', at, payload: {} }).valid, false, 'empty metric');
    assert.equal(validateTrackingEvent({ kind: 'keystroke', at, payload: { key: 'a' } }).valid, false);
    assert.equal(validateTrackingEvent({ kind: 'metric', at, payload: { edits: 1, tabId: 'a.b' } }).valid, false, 'dots would split a Firestore path');
  });
});

describe('OpenAI provider', () => {
  test('one strict structured-output request with only the text, then a validated result', async () => {
    const fetch = fakeFetch(completion(goodResult()));
    const r = await createOpenAIProvider(SETTINGS, { fetch }).analyse(TEXT);
    assert.equal(r.ok, true);
    assert.deepEqual(r.result, goodResult());
    assert.equal(fetch.calls.length, 1);

    const { url, init, body } = fetch.calls[0];
    assert.equal(url, 'https://openai.test/v1/chat/completions');
    assert.equal(init.headers.Authorization, 'Bearer sk-test-not-real');
    assert.equal(body.model, 'test-model');
    assert.equal(body.response_format.type, 'json_schema');
    assert.equal(body.response_format.json_schema.strict, true);
    assert.deepEqual(body.messages, [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: TEXT },
    ]);
  });

  test('usage counts tokens and estimates cost from the configured prices', async () => {
    const r = await createOpenAIProvider(SETTINGS, { fetch: fakeFetch(completion(goodResult())) }).analyse(TEXT);
    assert.equal(r.usage.provider, 'openai');
    assert.equal(r.usage.outcome, 'ok');
    assert.equal(r.usage.promptTokens, 1000);
    assert.equal(r.usage.completionTokens, 200);
    assert.equal(r.usage.costUsd, 0.0009); // 1000 × 0.5/1M + 200 × 2/1M
    assert.equal(estimateCost({ promptTokens: 2_000_000, completionTokens: 0 }, SETTINGS), 1);
  });

  test('flags that are not in the text are dropped before validation', async () => {
    const reply = goodResult();
    reply.flagged_sentences.push({ sentence: 'A sentence the student never wrote at all.', reason: 'Invented' });
    const r = await createOpenAIProvider(SETTINGS, { fetch: fakeFetch(completion(reply)) }).analyse(TEXT);
    assert.deepEqual(r.result.flagged_sentences.map((f) => f.reason), ['Generic phrasing']);
  });

  test('a timeout is openai_timeout', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const r = await createOpenAIProvider(SETTINGS, { fetch: fakeFetch(timeout) }).analyse(TEXT);
    assert.deepEqual([r.ok, r.reason, r.usage.outcome], [false, 'openai_timeout', 'timeout']);
  });

  test('a network error or an HTTP error is openai_error', async () => {
    const down = await createOpenAIProvider(SETTINGS, { fetch: fakeFetch(new TypeError('fetch failed')) }).analyse(TEXT);
    assert.deepEqual([down.ok, down.reason], [false, 'openai_error']);
    const http = await createOpenAIProvider(SETTINGS, { fetch: fakeFetch({ status: 429, body: { error: { type: 'insufficient_quota' } } }) }).analyse(TEXT);
    assert.deepEqual([http.ok, http.reason, http.usage.outcome], [false, 'openai_error', 'error']);
  });

  test('unparseable output, a refusal, or a reply that fails the schema is openai_invalid_output', async () => {
    const bad = [
      completion('not json'),
      { body: { choices: [{ message: { refusal: 'I cannot help with that.' } }], usage: {} } },
      completion({ ...goodResult(), ai_likelihood: 150 }),
      completion({ ...goodResult(), extra: true }),
    ];
    for (const reply of bad) {
      const r = await createOpenAIProvider(SETTINGS, { fetch: fakeFetch(reply) }).analyse(TEXT);
      assert.deepEqual([r.ok, r.reason, r.usage.outcome], [false, 'openai_invalid_output', 'invalid_output']);
    }
  });

  test('tokens are still counted when the reply is unusable', async () => {
    const r = await createOpenAIProvider(SETTINGS, { fetch: fakeFetch(completion('not json', { prompt_tokens: 500, completion_tokens: 10 })) }).analyse(TEXT);
    assert.equal(r.usage.promptTokens, 500);
    assert.ok(r.usage.costUsd > 0);
  });

  test('very long text is cut to maxInputChars', async () => {
    const fetch = fakeFetch(completion(goodResult()));
    await createOpenAIProvider({ ...SETTINGS, maxInputChars: 1000 }, { fetch }).analyse(TEXT.repeat(20));
    assert.equal(fetch.calls[0].body.messages[1].content.length, 1000);
  });

  test('configured only when both the key and the model are set', () => {
    assert.equal(createOpenAIProvider({ ...SETTINGS, model: null }).configured, false);
    assert.equal(createOpenAIProvider({ ...SETTINGS, apiKey: null }).configured, false);
    assert.equal(createOpenAIProvider(SETTINGS).configured, true);
  });
});

describe('legacy provider (Hugging Face + Virtual Writing Tutor)', () => {
  const hf = (over = {}) => async () => ({
    available: true,
    aiScore: 62,
    flaggedSegments: [{ text: 'Hydropower exports fund public services, but they depend on glaciers that are retreating every year.', reason: 'Flagged as likely AI-generated' }],
    ...over,
  });
  const vwt = (over = {}) => async () => ({ available: true, writingScore: 84, grammarErrors: 3, feedback: ['Use a comma after the clause.'], ...over });

  test('both working: completed, mapped to the shared shape', async () => {
    const r = await createLegacyProvider({ detectAI: hf(), checkGrammar: vwt() }).analyse(TEXT);
    assert.equal(r.status, 'completed');
    assert.equal(validateAnalysisResult(r.result).valid, true);
    assert.equal(r.result.ai_likelihood, 62);
    assert.equal(r.result.writing_quality, 8.4);
    assert.equal(r.result.flagged_sentences.length, 1);
    assert.deepEqual(r.usage.map((u) => [u.provider, u.outcome]), [['huggingface', 'ok'], ['vwt', 'ok']]);
  });

  test('one failing: partial; both failing: unavailable', async () => {
    const partial = await createLegacyProvider({ detectAI: hf({ available: false }), checkGrammar: vwt() }).analyse(TEXT);
    assert.equal(partial.status, 'partial');
    assert.equal(partial.result.ai_likelihood, null);
    const none = await createLegacyProvider({ detectAI: hf({ available: false }), checkGrammar: vwt({ available: false }) }).analyse(TEXT);
    assert.equal(none.status, 'unavailable');
    assert.equal(validateAnalysisResult(none.result).valid, true);
  });

  test('with AI detection off, Hugging Face is not called', async () => {
    let called = false;
    const r = await createLegacyProvider({ detectAI: async () => { called = true; return { available: true, aiScore: 1 }; }, checkGrammar: vwt() }).analyse(TEXT, { aiDetection: false });
    assert.equal(called, false);
    assert.equal(r.status, 'completed');
    assert.deepEqual(r.usage.map((u) => u.provider), ['vwt']);
  });
});

describe('analysis service: choosing the provider', () => {
  /** A query client that records SQL and returns the inserted row. */
  function recorder() {
    const calls = [];
    return {
      calls,
      async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes('INSERT INTO analysis_results')) {
          return { rows: [{ provider: params[1], model: params[2], status: params[3], fallback_reason: params[4], ai_likelihood: params[5], result: JSON.parse(params[11]) }] };
        }
        if (sql.includes('monthly_ai_budget_usd')) return { rows: [{ budget: '5.00', spent: '9.99' }] };
        return { rows: [] };
      },
    };
  }
  const flags = (over = {}) => async (name) => ({ ai_provider: 'openai', ai_detection_enabled: true, licensing_enabled: false, ...over })[name];
  const openai = (ok = true) => {
    const p = { configured: true, model: 'test-model', calls: 0 };
    p.analyse = async () => {
      p.calls += 1;
      return ok
        ? { ok: true, result: goodResult(), usage: { provider: 'openai', model: 'test-model', promptTokens: 10, completionTokens: 5, costUsd: 0.001, latencyMs: 3, outcome: 'ok' } }
        : { ok: false, reason: 'openai_timeout', usage: { provider: 'openai', model: 'test-model', promptTokens: 0, completionTokens: 0, costUsd: 0, latencyMs: 30000, outcome: 'timeout' } };
    };
    return p;
  };
  const legacy = () => {
    const p = { calls: 0 };
    p.analyse = async (_text, { aiDetection }) => {
      p.calls += 1;
      return { status: 'completed', result: { ...goodResult(), ai_likelihood: aiDetection ? 50 : null }, usage: [{ provider: 'vwt', model: null, promptTokens: 0, completionTokens: 0, costUsd: 0, latencyMs: 1, outcome: 'ok' }] };
    };
    return p;
  };
  const run = (deps, args = {}) => {
    const q = recorder();
    return createAnalysisService(deps)
      .run(q, { submissionId: 's1', text: TEXT, collegeId: '0b5c1f9e-2a71-4c8e-9d3b-6e0f4a2c7b11', courseId: 'c1', ...args })
      .then((row) => ({ row, q }));
  };
  const usageRows = (q) => q.calls.filter((c) => c.sql.includes('INSERT INTO usage')).map((c) => c.params[3]);

  test('OpenAI when the flag says so and it is configured', async () => {
    const { row, q } = await run({ openai: openai(), legacy: legacy(), getFlag: flags() });
    assert.deepEqual([row.provider, row.model, row.status, row.fallback_reason], ['openai', 'test-model', 'completed', null]);
    assert.deepEqual(usageRows(q), ['openai']);
  });

  test('the ai_provider flag can force legacy', async () => {
    const o = openai();
    const { row } = await run({ openai: o, legacy: legacy(), getFlag: flags({ ai_provider: 'legacy' }) });
    assert.deepEqual([row.provider, row.fallback_reason, o.calls], ['legacy', 'flag_legacy', 0]);
  });

  test('a re-run can ask for legacy or OpenAI regardless of the flag', async () => {
    assert.equal((await run({ openai: openai(), legacy: legacy(), getFlag: flags() }, { provider: 'legacy' })).row.provider, 'legacy');
    assert.equal((await run({ openai: openai(), legacy: legacy(), getFlag: flags({ ai_provider: 'legacy' }) }, { provider: 'openai' })).row.provider, 'openai');
  });

  test('not configured: legacy with openai_not_configured', async () => {
    const { row } = await run({ openai: { ...openai(), configured: false }, legacy: legacy(), getFlag: flags() });
    assert.deepEqual([row.provider, row.fallback_reason], ['legacy', 'openai_not_configured']);
  });

  test('an OpenAI failure falls back, and both calls are recorded in usage', async () => {
    const { row, q } = await run({ openai: openai(false), legacy: legacy(), getFlag: flags() });
    assert.deepEqual([row.provider, row.fallback_reason], ['legacy', 'openai_timeout']);
    assert.deepEqual(usageRows(q), ['openai', 'vwt']);
  });

  test('budget spent (licensing on): legacy with budget_reached, OpenAI not called', async () => {
    const o = openai();
    const { row } = await run({ openai: o, legacy: legacy(), getFlag: flags({ licensing_enabled: true }) });
    assert.deepEqual([row.fallback_reason, o.calls], ['budget_reached', 0]);
  });

  test('licensing off: the budget is not checked', async () => {
    const { q } = await run({ openai: openai(), legacy: legacy(), getFlag: flags() });
    assert.equal(q.calls.some((c) => c.sql.includes('monthly_ai_budget_usd')), false);
  });

  test('AI detection off: likelihood and flags are removed from an OpenAI result', async () => {
    const { row } = await run({ openai: openai(), legacy: legacy(), getFlag: flags({ ai_detection_enabled: false }) });
    assert.equal(row.ai_likelihood, null);
    assert.deepEqual(row.result.flagged_sentences, []);
  });

  test('text too short: unavailable, no provider called, no usage', async () => {
    const o = openai();
    const l = legacy();
    const { row, q } = await run({ openai: o, legacy: l, getFlag: flags() }, { text: '  hi  ' });
    assert.equal(row.status, 'unavailable');
    assert.deepEqual([o.calls, l.calls, usageRows(q).length], [0, 0, 0]);
  });
});

describe('helpers', () => {
  test('keepVerbatim ignores case and spacing, drops short, missing and repeated flags', () => {
    const flags = [
      { sentence: 'the CONSTITUTION   requires sixty percent forest cover', reason: 'a' },
      { sentence: 'Too short', reason: 'b' },
      { sentence: 'Not in the text anywhere at all', reason: 'c' },
      { sentence: 'The constitution requires sixty percent forest cover', reason: 'd' },
    ];
    assert.deepEqual(keepVerbatim(flags, TEXT).map((f) => f.reason), ['a']);
  });

  test('buildAuthorMetrics: minutes become seconds, pastes are counted per author, missing members get zeros', () => {
    const metrics = buildAuthorMetrics(
      ['stu-1', 'stu-2', 'stu-3'],
      [{ id: 'stu-1', uid: 'stu-1', timeSpent: 12.5, edits: 40 }, { id: 'stu-2', timeSpent: 3, edits: 5, tabEdits: { t1: 5 } }],
      [{ userId: 'stu-1', changeType: 'paste-large' }, { userId: 'stu-1', changeType: 'paste-small' }, { userId: 'stu-2', changeType: 'paste-small' }]
    );
    assert.deepEqual(metrics, {
      'stu-1': { timeSpentSec: 750, edits: 40, pasteEvents: 2, largePastes: 1, tabEdits: {} },
      'stu-2': { timeSpentSec: 180, edits: 5, pasteEvents: 1, largePastes: 0, tabEdits: { t1: 5 } },
      'stu-3': { timeSpentSec: 0, edits: 0, pasteEvents: 0, largePastes: 0, tabEdits: {} },
    });
  });
});
