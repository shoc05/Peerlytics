import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSubmissionReport } from './reportGenerator.js';

test('builds an available report from analysis results', () => {
  const report = buildSubmissionReport({
    text: 'A submitted paragraph.',
    ai: {
      aiGeneratedProbability: 5,
      aiScore: 95,
      writingQualityScore: 90,
      metrics: { grammar: 90 },
    },
    plagiarism: { plagiarismScore: 2 },
  });

  assert.equal(report.aiEvaluation, 'available');
  assert.equal(report.recommendation, 'Accept');
  assert.equal(report.scores.writingQualityScore, 90);
  assert.equal(report.metrics.grammar, 90);
});

test('keeps submission successful without inventing an AI score when evaluation is unavailable', () => {
  const report = buildSubmissionReport({
    text: 'A submitted paragraph.',
    ai: { aiAvailable: false },
    plagiarism: { plagiarismScore: 12 },
  });

  assert.equal(report.status, 'completed');
  assert.equal(report.aiEvaluation, 'unavailable');
  assert.equal(report.plagiarismScore, 12);
  assert.equal(report.suggestedGrade, null);
  assert.equal('aiUsageScore' in report.scores, false);
});
