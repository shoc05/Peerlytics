import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pages404 from './pages404.js';

function build(root) {
  const plugin = pages404();
  assert.equal(plugin.apply, 'build');
  plugin.configResolved({ root, build: { outDir: 'dist' } });
  plugin.closeBundle();
}

test('copies dist/index.html to dist/404.html after the build', () => {
  const root = mkdtempSync(join(tmpdir(), 'pages404-'));
  try {
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'dist', 'index.html'), '<div id="root"></div>');
    build(root);
    assert.equal(readFileSync(join(root, 'dist', '404.html'), 'utf8'), '<div id="root"></div>');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does nothing when there is no index.html', () => {
  const root = mkdtempSync(join(tmpdir(), 'pages404-'));
  try {
    build(root);
    assert.equal(existsSync(join(root, 'dist', '404.html')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
