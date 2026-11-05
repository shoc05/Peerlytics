// Every page and role shows the real logo through <Logo>, which picks the light or dark image.
// Only Logo.jsx may spell out the name as a stand-in, for when the image can't load.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const dir = new URL('./', import.meta.url);
const read = (name) => readFileSync(new URL(name, dir), 'utf8');
const components = readdirSync(dir).filter((name) => name.endsWith('.jsx') && name !== 'Logo.jsx');

test('no component writes the name as a text logo', () => {
  for (const name of components) {
    assert.doesNotMatch(read(name), />\s*Peerlytics\s*</, name);
  }
});

test('the student, lecturer and admin headers all use <Logo> with the theme', () => {
  const headers = read('peerlytics-app.jsx').match(/<Logo\b[^>]*darkMode=\{darkMode\}[^>]*>/g) ?? [];
  assert.equal(headers.length, 2);
});

test('the sign-in, sign-up, role and loading screens use <Logo> with the theme', () => {
  for (const name of ['Login.jsx', 'Signup.jsx', 'RolePicker.jsx', 'GuestRoute.jsx', 'ProtectedRoute.jsx']) {
    assert.match(read(name), /<Logo\b[^>]*darkMode=\{darkMode\}/, name);
  }
});
