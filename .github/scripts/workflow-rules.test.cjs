// Team rules for .github/workflows (step 0.5), run by the root npm test:
//   1. Every status check branch protection requires (CHECKS in scripts/setup-github.sh) is still a job
//      name, and that job has no needs:, because GitHub counts a skipped job as a passed check.
//   2. A job that needs another sets its own if: with !cancelled(). Without it the default success() skips
//      the job when any earlier job in the chain fails, even an optional matrix leg.
//   3. The services folder check fails for a missing folder unless its matrix leg is marked optional, and
//      no optional leg is a required check.
//   4. Every action is pinned to a full commit SHA, with its version in a comment.
//   5. No ${{ }} expression sits inside a run: script; values reach the shell through env: instead.
// The workflows use two-space indents, so a small line reader is enough and no YAML package is needed.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');

const indentOf = (line) => line.length - line.trimStart().length;
const isComment = (line) => line.trimStart().startsWith('#');
const plain = (value) => value.replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2');

function requiredChecks(setupScript) {
  const match = setupScript.match(/^CHECKS=\((.*)\)\s*$/m);
  if (!match) throw new Error('No CHECKS=(...) line in scripts/setup-github.sh');
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

// Each job with the check names it reports (its name:, or its id, with ${{ matrix.<key> }} filled in from
// an inline list such as "service: [backend, collab]"), the jobs it needs, its if:, and the names of the
// matrix legs that an include: entry marks "optional: true".
function jobs(text) {
  const found = [];
  let inJobs = false;
  let inInclude = false;
  let job = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || isComment(line)) continue;
    const indent = indentOf(line);
    if (inInclude && indent <= 8) inInclude = false;
    if (indent === 0) {
      inJobs = line.startsWith('jobs:');
      job = null;
    } else if (inJobs && indent === 2) {
      job = { id: line.trim().replace(/:$/, ''), name: null, matrix: {}, needs: [], condition: null, include: [] };
      found.push(job);
    } else if (job && inInclude) {
      const entry = line.match(/^ {10}- ([\w-]+):\s*(.*)$/);
      const more = line.match(/^ {12}([\w-]+):\s*(.*)$/);
      if (entry) job.include.push({ [entry[1]]: plain(entry[2]) });
      else if (more && job.include.length > 0) job.include[job.include.length - 1][more[1]] = plain(more[2]);
    } else if (job) {
      const key = line.match(/^ {4}([\w-]+):\s*(.*)$/);
      if (key && key[1] === 'name') job.name = plain(key[2]);
      if (key && key[1] === 'if') job.condition = plain(key[2]);
      if (key && key[1] === 'needs') {
        const value = plain(key[2]).replace(/^\[(.*)\]$/, '$1');
        job.needs = value ? value.split(',').map((need) => need.trim()).filter(Boolean) : ['(block list)'];
      }
      const list = line.match(/^ {8}([\w-]+):\s*\[(.*)\]\s*$/);
      if (list) job.matrix[list[1]] = list[2].split(',').map(plain);
      if (/^ {8}include:\s*$/.test(line)) inInclude = true;
    }
  }
  return found.map(({ id, name, matrix, needs, condition, include }) => {
    const template = name ?? id;
    const ref = template.match(/\$\{\{\s*matrix\.([\w-]+)\s*\}\}/);
    const fill = (value) => template.replace(ref[0], value);
    const names = ref && matrix[ref[1]] ? matrix[ref[1]].map(fill) : [template];
    const optionalNames = ref ? include.filter((entry) => entry.optional === 'true' && entry[ref[1]]).map((entry) => fill(entry[ref[1]])) : [];
    return { id, names, needs, condition, optionalNames };
  });
}

// The run: | block of the step with this name, without its indentation.
function stepScript(text, stepName) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  if (start === -1) throw new Error(`No step named "${stepName}"`);
  for (let i = start + 1; i < lines.length && (!lines[i].trim() || indentOf(lines[i]) > indentOf(lines[start])); i += 1) {
    const run = lines[i].match(/^(\s*)run:\s*\|\s*$/);
    if (!run) continue;
    const body = [];
    for (let j = i + 1; j < lines.length && (!lines[j].trim() || indentOf(lines[j]) > run[1].length); j += 1) body.push(lines[j]);
    const margin = Math.min(...body.filter((line) => line.trim()).map(indentOf));
    return body.map((line) => line.slice(margin)).join('\n');
  }
  throw new Error(`Step "${stepName}" has no run: | block`);
}

// uses: lines that are neither a local workflow nor owner/repo@<40-hex SHA> followed by "# v<version>".
function unpinnedActions(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !isComment(line))
    .map((line) => line.match(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/))
    .filter((m) => m && !m[1].startsWith('./'))
    .filter((m) => !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(m[1]) || !/^\s*#\s*v\d/.test(m[2]))
    .map((m) => m[0].trim());
}

// run: lines whose script (the same line, or the | or > block under it) contains ${{.
function expressionsInRun(text) {
  const lines = text.split(/\r?\n/);
  const found = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(\s*(?:-\s+)?)run:\s*(.*)$/);
    if (!m || isComment(lines[i])) continue;
    const start = lines[i].trim();
    const script = [m[2]];
    if (/^[|>][-+]?\s*$/.test(m[2])) {
      while (i + 1 < lines.length && (!lines[i + 1].trim() || indentOf(lines[i + 1]) > m[1].length)) {
        i += 1;
        script.push(lines[i]);
      }
    }
    if (script.some((line) => line.includes('${{'))) found.push(start);
  }
  return found;
}

const workflowFiles = fs.readdirSync(WORKFLOWS).filter((file) => /\.ya?ml$/.test(file));
const read = (file) => fs.readFileSync(path.join(WORKFLOWS, file), 'utf8');
const required = () => requiredChecks(fs.readFileSync(path.join(ROOT, 'scripts', 'setup-github.sh'), 'utf8'));

// Runs ci.yml's services folder check the way the runner does (bash -e) in a scratch folder.
function folderCheck({ service, optional = '', withPackageJson }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-check-'));
  try {
    if (withPackageJson) {
      fs.mkdirSync(path.join(dir, service));
      fs.writeFileSync(path.join(dir, service, 'package.json'), '{}\n');
    }
    const result = spawnSync('bash', ['-e', '-c', stepScript(read('ci.yml'), 'Check that the folder exists')], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, SERVICE: service, OPTIONAL: optional, GITHUB_OUTPUT: 'github-output.txt' },
    });
    if (result.error) throw result.error;
    const outputFile = path.join(dir, 'github-output.txt');
    return {
      status: result.status,
      log: result.stdout + result.stderr,
      output: fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : '',
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Linux and macOS have bash; on Windows only Git Bash (which sets MSYSTEM) is a safe choice.
const hasBash = process.platform !== 'win32' || Boolean(process.env.MSYSTEM);

test('every required check is still a job name, and that job has no needs:', () => {
  const all = workflowFiles.flatMap((file) => jobs(read(file)).map((job) => ({ ...job, file })));
  for (const check of required()) {
    const owners = all.filter((job) => job.names.includes(check));
    assert.ok(owners.length > 0, `No workflow job reports the required check "${check}"`);
    for (const job of owners) {
      assert.deepEqual(job.needs, [], `${job.file}: job ${job.id} reports the required check "${check}" but uses needs:`);
    }
  }
});

test('every job that needs another job sets its own if: with !cancelled()', () => {
  const implicit = workflowFiles.flatMap((file) =>
    jobs(read(file))
      .filter((job) => job.needs.length > 0 && !/!\s*cancelled\(\)/.test(job.condition ?? ''))
      .map((job) => `${file}: ${job.id}`),
  );
  assert.deepEqual(implicit, [], "Add if: ${{ !cancelled() }}, plus needs.<job>.result == 'success' where it must wait for one");
});

test('no matrix leg that is a required check is marked optional', () => {
  const optional = workflowFiles.flatMap((file) => jobs(read(file)).flatMap((job) => job.optionalNames));
  assert.deepEqual(optional.filter((name) => required().includes(name)), []);
});

test('the services folder check fails for a missing folder unless its leg is optional', { skip: !hasBash && 'needs bash: runs in CI and under Git Bash' }, () => {
  const present = folderCheck({ service: 'backend', withPackageJson: true });
  assert.equal(present.status, 0, present.log);
  assert.equal(present.output.trim(), 'exists=true');

  const missing = folderCheck({ service: 'backend', withPackageJson: false });
  assert.equal(missing.status, 1, missing.log);
  assert.match(missing.log, /::error::backend\/package\.json is missing/);
  assert.equal(missing.output, '');

  const planned = folderCheck({ service: 'notifier', optional: 'true', withPackageJson: false });
  assert.equal(planned.status, 0, planned.log);
  assert.equal(planned.output.trim(), 'exists=false');
  assert.match(planned.log, /::notice::notifier\/ does not exist yet/);
});

test('every action is pinned to a full commit SHA with its version in a comment', () => {
  const unpinned = workflowFiles.flatMap((file) => unpinnedActions(read(file)).map((line) => `${file}: ${line}`));
  assert.deepEqual(unpinned, []);
});

test('no run: script contains a ${{ }} expression', () => {
  const unsafe = workflowFiles.flatMap((file) => expressionsInRun(read(file)).map((line) => `${file}: ${line}`));
  assert.deepEqual(unsafe, []);
});

test('requiredChecks reads the quoted names from setup-github.sh', () => {
  const script = 'set -e\nCHECKS=("Website (lint, test, build)" "Jira key in PR title")\nREVIEWER=x\n';
  assert.deepEqual(requiredChecks(script), ['Website (lint, test, build)', 'Jira key in PR title']);
  assert.throws(() => requiredChecks('no list here'), /CHECKS/);
});

test('jobs reads names, needs, if: and optional matrix legs', () => {
  const workflow = [
    'name: CI',
    'jobs:',
    '  lint:',
    '    runs-on: ubuntu-latest',
    '  # off:',
    '  services:',
    '    name: ${{ matrix.service }} (lint, test)',
    '    needs: lint',
    '    if: ${{ !cancelled() }}',
    '    strategy:',
    '      matrix:',
    '        service: [backend, collab, notifier]',
    '        include:',
    '          # planned',
    '          - service: notifier',
    '            optional: true',
    '    steps:',
    '      - name: Not a job name',
    '        with:',
    '          node-version: 22',
    '  docker:',
    '    needs: [lint, services]',
    '    strategy:',
    '      matrix:',
    '        include:',
    '          - service: backend',
    '            context: .',
  ].join('\n');
  assert.deepEqual(jobs(workflow), [
    { id: 'lint', names: ['lint'], needs: [], condition: null, optionalNames: [] },
    {
      id: 'services',
      names: ['backend (lint, test)', 'collab (lint, test)', 'notifier (lint, test)'],
      needs: ['lint'],
      condition: '${{ !cancelled() }}',
      optionalNames: ['notifier (lint, test)'],
    },
    { id: 'docker', names: ['docker'], needs: ['lint', 'services'], condition: null, optionalNames: [] },
  ]);
});

test('stepScript returns the run: block of a named step without its indentation', () => {
  const workflow = [
    '      - name: Check',
    '        env:',
    '          A: b',
    '        run: |',
    '          if [ -f x ]; then',
    '            echo yes',
    '          fi',
    '      - name: Next',
    '        run: echo no',
  ].join('\n');
  assert.equal(stepScript(workflow, 'Check'), 'if [ -f x ]; then\n  echo yes\nfi');
  assert.throws(() => stepScript(workflow, 'Missing'), /No step named/);
});

test('unpinnedActions accepts SHA pins with a version and local workflows only', () => {
  const sha = 'a'.repeat(40);
  const workflow = [
    `      - uses: actions/checkout@${sha} # v4.2.2`,
    '      - uses: actions/checkout@v4',
    `      - uses: actions/setup-node@${sha}`,
    '    uses: ./.github/workflows/build-images.yml',
    '  #   - uses: actions/cache@v4',
  ].join('\n');
  assert.deepEqual(unpinnedActions(workflow), ['- uses: actions/checkout@v4', `- uses: actions/setup-node@${sha}`]);
});

test('expressionsInRun finds ${{ in one-line and block scripts, not in env: or defaults:', () => {
  const workflow = [
    '    defaults:',
    '      run:',
    '        working-directory: ${{ matrix.service }}',
    '    steps:',
    '      - name: Safe',
    '        env:',
    '          TITLE: ${{ github.event.pull_request.title }}',
    '        run: echo "$TITLE"',
    '      - run: echo "${{ github.ref_name }}"',
    '      - name: Block',
    '        run: |',
    '          echo start',
    '',
    '          echo "${{ github.head_ref }}"',
    '      - name: After the block',
    '        run: echo done',
  ].join('\n');
  assert.deepEqual(expressionsInRun(workflow), ['- run: echo "${{ github.ref_name }}"', 'run: |']);
});
