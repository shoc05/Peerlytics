// Tests for the LIVE grading engine (behaviorGrade.js) + the contribution-roster
// helpers (scoring.js). Zero-dependency: run with `node --test`  →  npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeSubmission, writingFromReport } from './behaviorGrade.js';
import { enrichMembers, detectFreeRider, getRank } from './scoring.js';

// ─── behaviorGrade: writing base ───
test('writing base score = average of the four sub-scores', () => {
  const g = gradeSubmission({ writing: { grammar: 8, clarity: 8, structure: 8, content: 8 }, timeSpentSeconds: 9999, editCount: 50 });
  assert.equal(g.baseScore, 8);
});

test('clean, high-effort submission keeps its full writing score', () => {
  const g = gradeSubmission({ writing: { grammar: 9, clarity: 9, structure: 9, content: 9 }, timeSpentSeconds: 3600, editCount: 40, pastePercentage: 0, aiProbability: 0 });
  assert.equal(g.recommendedScore, 9);
  assert.deepEqual(g.penalties, { time: 0, edits: 0, paste: 0, ai: 0 });
});

// ─── behaviorGrade: conservative penalties ───
test('low active time is penalised (relative to the lecturer time cap)', () => {
  // 5 min spent, 60-min expected cap → below 25% → −2.
  const g = gradeSubmission({ writing: { grammar: 8, clarity: 8, structure: 8, content: 8 }, timeSpentSeconds: 300, editCount: 30, timeCapMinutes: 60 });
  assert.equal(g.penalties.time, 2);
  assert.ok(g.flags.includes('Low Effort'));
});

test('very low edits is penalised', () => {
  const g = gradeSubmission({ writing: { grammar: 8, clarity: 8, structure: 8, content: 8 }, timeSpentSeconds: 9999, editCount: 2 });
  assert.equal(g.penalties.edits, 1);
});

test('high paste (>70%) is penalised and flagged', () => {
  const g = gradeSubmission({ writing: { grammar: 8, clarity: 8, structure: 8, content: 8 }, timeSpentSeconds: 9999, editCount: 30, pastePercentage: 90 });
  assert.ok(g.penalties.paste >= 2);
  assert.ok(g.flags.includes('High Paste Usage'));
});

// ─── behaviorGrade: AI is a weak signal only ───
test('high AI alone (no corroboration) applies NO AI penalty', () => {
  const g = gradeSubmission({ writing: { grammar: 8, clarity: 8, structure: 8, content: 8 }, timeSpentSeconds: 9999, editCount: 40, pastePercentage: 0, aiProbability: 0.95 });
  assert.equal(g.penalties.ai, 0); // no high paste, enough edits → not corroborated
});

test('high AI + corroboration (high paste) applies an AI penalty + flag', () => {
  const g = gradeSubmission({ writing: { grammar: 8, clarity: 8, structure: 8, content: 8 }, timeSpentSeconds: 9999, editCount: 40, pastePercentage: 90, aiProbability: 0.95 });
  assert.ok(g.penalties.ai >= 2);
  assert.ok(g.flags.includes('Possible AI Assistance'));
});

// ─── behaviorGrade: clamping + shape ───
test('recommendedScore is clamped to 0–10 and never negative', () => {
  const g = gradeSubmission({ writing: { grammar: 1, clarity: 1, structure: 1, content: 1 }, timeSpentSeconds: 10, editCount: 0, pastePercentage: 100, aiProbability: 0.99 });
  assert.ok(g.recommendedScore >= 0 && g.recommendedScore <= 10);
});

test('output JSON has the documented shape', () => {
  const g = gradeSubmission({ writing: { grammar: 7, clarity: 7, structure: 7, content: 7 }, timeSpentSeconds: 3600, editCount: 20 });
  for (const key of ['scores', 'baseScore', 'penalties', 'recommendedScore', 'flags', 'behaviorSummary', 'lecturerNote']) {
    assert.ok(key in g, `missing ${key}`);
  }
  assert.equal(typeof g.lecturerNote, 'string');
  assert.ok(Array.isArray(g.flags));
});

test('writingFromReport maps a report into the 4 writing sub-scores (0–10)', () => {
  const w = writingFromReport({ scores: { writingQualityScore: 80 }, metrics: { grammar: 90, coherence: 70 } });
  for (const k of ['grammar', 'clarity', 'structure', 'content']) {
    assert.ok(w[k] >= 0 && w[k] <= 10, `${k} out of range`);
  }
});

// ─── scoring.js: contribution roster helpers (still live) ───
test('enrichMembers ranks higher contributors first and attaches rank/badges', () => {
  const members = [
    { id: 'a', name: 'A', edits: 5, timeSpent: 5, taskCompletion: 20, writingQuality: 40 },
    { id: 'b', name: 'B', edits: 200, timeSpent: 50, taskCompletion: 95, writingQuality: 90 },
  ];
  const enriched = enrichMembers(members);
  assert.equal(enriched[0].id, 'b', 'top contributor sorts first');
  assert.ok('rank' in enriched[0] && 'badges' in enriched[0]);
});

test('detectFreeRider flags a clearly below-average member', () => {
  const all = [
    { id: 'a', edits: 100, timeSpent: 60, taskCompletion: 90 },
    { id: 'b', edits: 100, timeSpent: 60, taskCompletion: 90 },
    { id: 'c', edits: 2, timeSpent: 1, taskCompletion: 5 },
  ];
  assert.equal(detectFreeRider(all[2], all), 'low-contributor');
});

test('getRank returns a label for a score', () => {
  assert.ok(getRank(90).label);
  assert.ok(getRank(10).label);
});
