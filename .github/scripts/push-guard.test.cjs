const assert = require('node:assert/strict');
const { test } = require('node:test');
const { checkPush, parseAllowed } = require('./push-guard.cjs');

const repo = { owner: 'shoc05', repo: 'Peerlytics' };
const SHA_A = 'aaaaaaa1111111111111111111111111111111111';
const SHA_B = 'bbbbbbb2222222222222222222222222222222222';

// prsBySha: sha -> array of answers, one per attempt (last one repeats).
function fakeGitHub({ commits = [], prsBySha = {}, labelExists = true, newBranchCommit } = {}) {
  const calls = { compare: 0, getCommit: 0, prLookups: {}, createLabel: 0, issues: [] };
  const github = {
    rest: {
      repos: {
        compareCommitsWithBasehead: async () => {
          calls.compare += 1;
          return { data: { total_commits: commits.length, commits: commits.map(([sha, message]) => ({ sha, commit: { message } })) } };
        },
        getCommit: async () => {
          calls.getCommit += 1;
          const [sha, message] = newBranchCommit;
          return { data: { sha, commit: { message } } };
        },
        listPullRequestsAssociatedWithCommit: async ({ commit_sha }) => {
          const n = calls.prLookups[commit_sha] || 0;
          calls.prLookups[commit_sha] = n + 1;
          const answers = prsBySha[commit_sha] || [[]];
          return { data: answers[Math.min(n, answers.length - 1)] };
        },
      },
      issues: {
        getLabel: async () => {
          if (!labelExists) { const err = new Error('Not Found'); err.status = 404; throw err; }
          return { data: {} };
        },
        createLabel: async () => { calls.createLabel += 1; return { data: {} }; },
        create: async (args) => {
          calls.issues.push(args);
          return { data: { number: 42, html_url: 'https://github.com/shoc05/Peerlytics/issues/42' } };
        },
      },
    },
  };
  return { github, calls };
}

function fakeCore() {
  const out = { summary: '', failed: null };
  const summary = { addRaw(text) { out.summary += text; return summary; }, async write() { return summary; } };
  return { out, core: { summary, setFailed: (msg) => { out.failed = msg; } } };
}

const baseEnv = {
  BRANCH: 'develop',
  PUSHER: 'Kezang698',
  ACTOR: 'Kezang698',
  BEFORE: 'c'.repeat(40),
  AFTER: SHA_B,
  CREATED: 'false',
  DELETED: 'false',
  ALLOWED_DIRECT_PUSHERS: '',
  RUN_URL: 'https://github.com/shoc05/Peerlytics/actions/runs/1',
};
const merged = [{ number: 7, merged_at: '2026-10-18T10:00:00Z' }];
const noSleep = async () => {};

test('passes when every commit belongs to a merged PR', async () => {
  const { github, calls } = fakeGitHub({ commits: [[SHA_A, 'PEER-6 one'], [SHA_B, 'PEER-6 two']], prsBySha: { [SHA_A]: [merged], [SHA_B]: [merged] } });
  const { core, out } = fakeCore();
  const result = await checkPush({ github, core, repo, env: baseEnv, sleep: noSleep });
  assert.equal(result.status, 'ok');
  assert.match(out.summary, /All commits came through pull requests/);
  assert.equal(out.failed, null);
  assert.equal(calls.issues.length, 0);
});

test('a commit with no merged PR fails the run, opens an issue and writes the summary', async () => {
  const { github, calls } = fakeGitHub({
    commits: [[SHA_A, 'PEER-6 fine'], [SHA_B, 'quick fix on develop\n\nlong body']],
    prsBySha: { [SHA_A]: [merged], [SHA_B]: [[{ number: 9, merged_at: null }]] },
  });
  const { core, out } = fakeCore();
  const result = await checkPush({ github, core, repo, env: baseEnv, sleep: noSleep });
  assert.equal(result.status, 'direct');
  assert.deepEqual(result.commits, [SHA_B]);
  assert.match(out.failed, /Direct push to develop by Kezang698/);
  assert.match(out.failed, /bbbbbbb/);
  const issue = calls.issues[0];
  assert.equal(issue.title, 'Direct push to develop by Kezang698');
  assert.deepEqual(issue.labels, ['direct-push']);
  assert.match(issue.body, /`bbbbbbb` quick fix on develop/);
  assert.doesNotMatch(issue.body, /aaaaaaa/);
  assert.match(issue.body, /Please open a PR next time; Sangay will review this change/);
  assert.match(out.summary, /Direct push detected/);
  assert.match(out.summary, /issues\/42/);
});

test('creates the direct-push label when it is missing', async () => {
  const { github, calls } = fakeGitHub({ commits: [[SHA_A, 'x']], labelExists: false });
  const { core } = fakeCore();
  await checkPush({ github, core, repo, env: baseEnv, sleep: noSleep });
  assert.equal(calls.createLabel, 1);
});

test('does not recreate an existing label', async () => {
  const { github, calls } = fakeGitHub({ commits: [[SHA_A, 'x']] });
  const { core } = fakeCore();
  await checkPush({ github, core, repo, env: baseEnv, sleep: noSleep });
  assert.equal(calls.createLabel, 0);
});

test('retries when GitHub has not linked a just-merged PR yet', async () => {
  const { github, calls } = fakeGitHub({ commits: [[SHA_A, 'x']], prsBySha: { [SHA_A]: [[], [], merged] } });
  const { core, out } = fakeCore();
  const waits = [];
  const result = await checkPush({ github, core, repo, env: baseEnv, sleep: async (ms) => { waits.push(ms); }, retries: 3, delayMs: 5000 });
  assert.equal(result.status, 'ok');
  assert.equal(calls.prLookups[SHA_A], 3);
  assert.deepEqual(waits, [5000, 5000]);
  assert.equal(out.failed, null);
});

test('skips GitHub bots', async () => {
  const { github, calls } = fakeGitHub({ commits: [[SHA_A, 'x']] });
  const { core, out } = fakeCore();
  const result = await checkPush({ github, core, repo, env: { ...baseEnv, PUSHER: 'github-actions[bot]', ACTOR: 'github-actions[bot]' }, sleep: noSleep });
  assert.equal(result.status, 'skipped');
  assert.equal(calls.compare, 0);
  assert.equal(out.failed, null);
});

test('skips people listed in ALLOWED_DIRECT_PUSHERS, case-insensitively', async () => {
  const { github } = fakeGitHub({ commits: [[SHA_A, 'x']] });
  const { core } = fakeCore();
  const result = await checkPush({ github, core, repo, env: { ...baseEnv, ALLOWED_DIRECT_PUSHERS: ' someone , kezang698 ' }, sleep: noSleep });
  assert.equal(result.status, 'skipped');
  assert.equal(result.who, 'kezang698');
});

test('a newly created branch checks its head commit only', async () => {
  const { github, calls } = fakeGitHub({ newBranchCommit: [SHA_B, 'start'], prsBySha: { [SHA_B]: [merged] } });
  const { core } = fakeCore();
  const result = await checkPush({ github, core, repo, env: { ...baseEnv, BEFORE: '0'.repeat(40), CREATED: 'true' }, sleep: noSleep });
  assert.equal(result.status, 'ok');
  assert.equal(calls.getCommit, 1);
  assert.equal(calls.compare, 0);
});

test('a branch deletion is not checked', async () => {
  const { github, calls } = fakeGitHub();
  const { core, out } = fakeCore();
  const result = await checkPush({ github, core, repo, env: { ...baseEnv, DELETED: 'true' }, sleep: noSleep });
  assert.equal(result.status, 'skipped');
  assert.equal(calls.compare, 0);
  assert.equal(out.failed, null);
});

test('parseAllowed ignores blanks and spacing', () => {
  assert.deepEqual(parseAllowed(''), []);
  assert.deepEqual(parseAllowed(undefined), []);
  assert.deepEqual(parseAllowed(' A ,, b '), ['a', 'b']);
});
