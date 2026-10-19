// ai_detection_enabled = false: /api/check never calls Hugging Face, and the report says AI
// detection was not available instead of showing a score. Hugging Face is stubbed through
// the axios adapter, so nothing leaves the machine.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import axios from 'axios';

const TEXT = 'A short essay about the river valleys of Bhutan and their farms.';
let analyzeSubmission;
let calls = [];
const realAdapter = axios.defaults.adapter;
const saved = { HF_API_KEY: process.env.HF_API_KEY, VWT_API_KEY: process.env.VWT_API_KEY };

before(async () => {
  process.env.HF_API_KEY = 'test-key';
  delete process.env.VWT_API_KEY;
  axios.defaults.adapter = async (config) => {
    calls.push(config.url);
    return { data: [[{ label: 'Real', score: 0.9 }, { label: 'Fake', score: 0.1 }]], status: 200, statusText: 'OK', headers: {}, config };
  };
  ({ analyzeSubmission } = await import('../../routes/check.js'));
});

after(() => {
  axios.defaults.adapter = realAdapter;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete process.env.FLAG_AI_DETECTION_ENABLED;
});

test('flag off: Hugging Face is not called and the report marks AI detection unavailable', async () => {
  process.env.FLAG_AI_DETECTION_ENABLED = 'false';
  calls = [];
  const { report } = await analyzeSubmission({ text: TEXT, userId: 'u1', fileId: 'f1', groupId: 'g1', fileName: 'Essay' });
  assert.deepEqual(calls, []);
  assert.notEqual(report.aiDetectionAvailable, true); // false, or absent on the all-unavailable report
});

test('flag on (the default): Hugging Face is called', async () => {
  delete process.env.FLAG_AI_DETECTION_ENABLED;
  calls = [];
  await analyzeSubmission({ text: TEXT, userId: 'u1', fileId: 'f1', groupId: 'g1', fileName: 'Essay' });
  assert.ok(calls.some((url) => /huggingface/.test(url)), calls.join(', '));
});
