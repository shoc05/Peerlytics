// Direct push guard (step 0.5b). Called by .github/workflows/push-guard.yml through
// actions/github-script. Every commit pushed to develop or main must belong to a merged
// pull request; otherwise the run fails, an issue is opened and the job summary says why.
// Kept in its own file so it can be unit-tested with a stubbed GitHub client.

const ZERO_SHA = /^0+$/;
const BOTS = ['github-actions[bot]', 'dependabot[bot]'];
const LABEL = 'direct-push';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseAllowed(value) {
  return String(value || '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
}

function firstLine(message) {
  return String(message || '').split('\n')[0].trim();
}

async function listPushedCommits(github, repo, env) {
  const isNewBranch = env.CREATED === 'true' || !env.BEFORE || ZERO_SHA.test(env.BEFORE);
  if (isNewBranch) {
    const { data } = await github.rest.repos.getCommit({ ...repo, ref: env.AFTER });
    return { commits: [{ sha: data.sha, message: data.commit.message }], truncated: false };
  }
  const { data } = await github.rest.repos.compareCommitsWithBasehead({
    ...repo,
    basehead: `${env.BEFORE}...${env.AFTER}`,
  });
  const commits = data.commits.map((c) => ({ sha: c.sha, message: c.commit.message }));
  return { commits, truncated: data.total_commits > commits.length };
}

// GitHub can take a few seconds to link a freshly merged PR to its commits, so retry.
async function hasMergedPullRequest(github, repo, sha, { retries, delayMs, sleep }) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const { data } = await github.rest.repos.listPullRequestsAssociatedWithCommit({
      ...repo,
      commit_sha: sha,
    });
    if (data.some((pr) => pr.merged_at)) return true;
    if (attempt < retries) await sleep(delayMs);
  }
  return false;
}

async function ensureLabel(github, repo) {
  try {
    await github.rest.issues.getLabel({ ...repo, name: LABEL });
  } catch (err) {
    if (err.status !== 404) throw err;
    await github.rest.issues.createLabel({
      ...repo,
      name: LABEL,
      color: 'd73a4a',
      description: 'A commit reached develop or main without a pull request',
    });
  }
}

async function checkPush({ github, core, repo, env, sleep = defaultSleep, retries = 3, delayMs = 5000 }) {
  const branch = env.BRANCH;
  const pusher = env.PUSHER || env.ACTOR || 'unknown';

  if (env.DELETED === 'true') {
    await core.summary.addRaw(`Branch ${branch} was deleted; nothing to check.`).write();
    return { status: 'skipped', reason: 'deleted' };
  }

  const people = [pusher, env.ACTOR].filter(Boolean).map((p) => p.toLowerCase());
  const allowed = [...BOTS, ...parseAllowed(env.ALLOWED_DIRECT_PUSHERS)];
  const skippedBy = people.find((p) => allowed.includes(p));
  if (skippedBy) {
    await core.summary.addRaw(`Push by ${skippedBy} is allowed without a pull request; not checked.`).write();
    return { status: 'skipped', reason: 'allowed', who: skippedBy };
  }

  const { commits, truncated } = await listPushedCommits(github, repo, env);
  const direct = [];
  for (const commit of commits) {
    if (!(await hasMergedPullRequest(github, repo, commit.sha, { retries, delayMs, sleep }))) {
      direct.push(commit);
    }
  }

  if (direct.length === 0) {
    const note = truncated ? ' (GitHub listed only the first 250 commits of this push)' : '';
    await core.summary
      .addRaw(`All commits came through pull requests. Checked ${commits.length} commit(s) on ${branch}${note}.`)
      .write();
    return { status: 'ok', checked: commits.length };
  }

  const list = direct.map((c) => `- \`${c.sha.slice(0, 7)}\` ${firstLine(c.message)}`).join('\n');
  const details =
    `**${pusher}** pushed directly to **${branch}**. These commits did not come through a merged pull request:\n\n` +
    `${list}\n\nRun: ${env.RUN_URL || 'n/a'}`;

  await ensureLabel(github, repo);
  const { data: issue } = await github.rest.issues.create({
    ...repo,
    title: `Direct push to ${branch} by ${pusher}`,
    labels: [LABEL],
    body:
      `${details}\n\nPlease open a PR next time; Sangay will review this change.\n\n` +
      'To undo it: revert the commits on the branch (through a PR), then redo the change from a feature branch as a PR.',
  });

  await core.summary
    .addRaw(`## Direct push detected\n\n${details}\n\nIssue: ${issue.html_url}`)
    .write();
  core.setFailed(
    `Direct push to ${branch} by ${pusher}: ${direct.length} commit(s) without a merged PR ` +
      `(${direct.map((c) => c.sha.slice(0, 7)).join(', ')}). See ${issue.html_url}`,
  );
  return { status: 'direct', commits: direct.map((c) => c.sha), issue: issue.number };
}

module.exports = { checkPush, parseAllowed };
