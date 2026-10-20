import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { compareGroup, gini, pasteLevel } from './comparison.js';

describe('contribution balance (Gini)', () => {
  for (const [edits, want] of [
    [[50, 50], 0],
    [[25, 25, 25, 25], 0],
    [[100, 0], 1],
    [[90, 0, 0], 1],
    [[75, 25], 0.5],
    [[60, 30, 10], 0.5],
    [[40], 0], // a group of one
    [[0, 0, 0], 0], // nobody edited
    [[], 0],
  ]) {
    test(`${JSON.stringify(edits)} -> ${want}`, () => assert.equal(gini(edits), want));
  }
  test('more uneven is always higher', () => {
    assert.ok(gini([60, 40]) < gini([80, 20]));
    assert.ok(gini([80, 20]) < gini([95, 5]));
  });
});

describe('paste level', () => {
  for (const [pastes, members, want] of [
    [0, 3, 'none'],
    [1, 3, 'low'], // 0.33 each
    [2, 4, 'low'], // 0.5
    [3, 3, 'medium'], // 1
    [6, 4, 'medium'], // 1.5
    [7, 4, 'high'], // 1.75
    [5, 0, 'none'],
  ]) {
    test(`${pastes} large pastes, ${members} members -> ${want}`, () => assert.equal(pasteLevel(pastes, members), want));
  }
});

test('compareGroup summarises one group', () => {
  const row = {
    id: 'w1',
    name: 'Team Druk',
    assignment_id: 'a1',
    ai_likelihood: 35,
    author_metrics: { s1: { edits: 75, largePastes: 0 }, s2: { edits: 25, largePastes: 2 } },
  };
  assert.deepEqual(compareGroup(row, [9.17, 4]), {
    workspaceId: 'w1',
    name: 'Team Druk',
    assignmentId: 'a1',
    memberCount: 2,
    contributionGini: 0.5,
    aiLikelihood: 35,
    pasteLevel: 'medium',
    largePastes: 2,
    averageGrade: 6.59,
    minGrade: 4,
    maxGrade: 9.17,
  });
  assert.equal(compareGroup({ ...row, ai_likelihood: null }, []).averageGrade, null);
});
