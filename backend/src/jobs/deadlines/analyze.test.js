// analyzeSubmission was moved out of the /api/check handler so the deadline job can call it.
// Without API keys both providers answer "unavailable" without any network call.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';

let analyzeSubmission;

before(async () => {
  delete process.env.HF_API_KEY;
  delete process.env.VWT_API_KEY;
  ({ analyzeSubmission } = await import('../../../routes/check.js'));
});

test('returns the same { success, report, extraction } body the route sends', async () => {
  const text = 'A short essay about the river valleys of Bhutan and their farms.';
  const out = await analyzeSubmission({ text, userId: 'u1', fileId: 'f1', groupId: 'g1', fileName: 'Essay', pasteEvents: [] });
  assert.equal(out.success, true);
  assert.ok(out.report.id);
  assert.equal(out.extraction.text, text);
  assert.equal(out.extraction.wordCount, text.split(/\s+/).length);
});

test('content under 10 characters throws a 400 error', async () => {
  await assert.rejects(analyzeSubmission({ text: 'too short' }), (err) => err.status === 400);
});
