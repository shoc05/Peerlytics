// The page backgrounds stay on the logo's palette, in both themes, and never animate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('./peerlytics-theme.css', import.meta.url), 'utf8');
const variable = (name) => {
  const match = css.match(new RegExp(`--${name}:([\\s\\S]*?);\\s*(?:--|})`));
  assert.ok(match, `--${name} is missing`);
  return match[1];
};

test('both themes define a full page background that stays in place', () => {
  for (const name of ['pl-page-light', 'pl-page-dark']) {
    const value = variable(name);
    assert.match(value, /linear-gradient/);
    assert.match(value, /data:image\/svg\+xml/);
    assert.match(value, /fixed/);
  }
});

test('the art only uses the logo greens', () => {
  for (const name of ['pl-page-light', 'pl-page-dark']) {
    const decoded = decodeURIComponent(variable(name).match(/data:image\/svg\+xml,([^"]+)"/)[1]);
    const colours = [...decoded.matchAll(/(?:fill|stroke)='([^']+)'/g)].map((m) => m[1]).filter((c) => c !== 'none');
    assert.ok(colours.length > 0);
    for (const colour of colours) {
      assert.match(colour, /^(#66BA96|#7EC084|rgba\(102,186,150,[\d.]+\)|rgba\(126,192,132,[\d.]+\))$/);
    }
  }
});

test('the backgrounds have no animation', () => {
  for (const name of ['pl-page-light', 'pl-page-dark']) {
    assert.doesNotMatch(variable(name), /animation|<animate/);
  }
});
