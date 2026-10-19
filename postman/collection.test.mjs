// Every operation in backend/openapi.yaml has a request in the Postman collection, and the
// JSON in git is what build-collection.mjs produces. Run: node --test postman/collection.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** "GET /courses/{}/members" for every operation in openapi.yaml (paths are 2-space keys, methods 4-space). */
function contractOperations() {
  const ops = new Set();
  let path = null;
  for (const line of read('../backend/openapi.yaml').split(/\r?\n/)) {
    const p = /^ {2}(\/[^:\s]*):\s*$/.exec(line);
    if (p) {
      path = p[1].replace(/\{[^}]+\}/g, '{}');
      continue;
    }
    if (/^\S/.test(line)) path = null; // left the paths section
    const m = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
    if (path && m) ops.add(`${m[1].toUpperCase()} ${path}`);
  }
  return ops;
}

function collectionOperations() {
  const ops = new Set();
  const walk = (items) => {
    for (const it of items) {
      if (it.item) walk(it.item);
      else if (typeof it.request?.url === 'string' && it.request.url.startsWith('{{baseUrl}}/api/')) {
        const path = it.request.url.slice('{{baseUrl}}/api'.length).split('?')[0].replace(/\{\{[^}]+\}\}/g, '{}').replace(/\/c1$/, '/{}');
        ops.add(`${it.request.method} ${path}`);
      }
    }
  };
  walk(JSON.parse(read('./peerlytics.postman_collection.json')).item);
  return ops;
}

test('every route in openapi.yaml has a request in the collection', () => {
  const contract = contractOperations();
  assert.ok(contract.size > 40, `parsed ${contract.size} operations`);
  const missing = [...contract].filter((op) => !collectionOperations().has(op));
  assert.deepEqual(missing, [], 'add these to postman/build-collection.mjs');
});

test('the collection only calls routes that are in the contract', () => {
  const contract = contractOperations();
  const extra = [...collectionOperations()].filter((op) => !contract.has(op));
  assert.deepEqual(extra, []);
});

test('the committed JSON is up to date with build-collection.mjs', () => {
  const before = read('./peerlytics.postman_collection.json');
  execFileSync(process.execPath, [new URL('./build-collection.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')]);
  assert.equal(read('./peerlytics.postman_collection.json'), before, 'run node postman/build-collection.mjs and commit the result');
});

test('no tokens or keys are stored in the collection or the environment template', () => {
  const env = JSON.parse(read('./peerlytics.postman_environment.json'));
  assert.ok(env.values.every((v) => v.value === '' || v.key === 'baseUrl' || v.key === 'firebaseProjectId'), 'environment template values must be empty');
  const text = read('./peerlytics.postman_collection.json');
  assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]{10,}\./, 'no JWTs');
  assert.doesNotMatch(text, /AIza[0-9A-Za-z_-]{20,}/, 'no Google API keys');
});
