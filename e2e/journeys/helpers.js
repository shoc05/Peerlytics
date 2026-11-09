// Accounts and sign-in for the browser journeys. Everything goes to the Firebase emulators and a
// throwaway database (e2e/journeys/run.mjs). These accounts only ever exist there.
import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';

const API_URL = process.env.JOURNEY_API_URL;
const AUTH_URL = process.env.JOURNEY_AUTH_URL;
const PASSWORD = 'journey-password';

let counter = 0;

async function json(res, label) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${label} failed (${res.status}): ${JSON.stringify(body)}`);
  return body;
}

/** A new account with a chosen role, through the same routes a real sign-up uses. */
export async function createAccount(role, name) {
  counter += 1;
  const email = `${role}-${Date.now()}-${counter}@example.test`;
  const account = await json(
    await fetch(`${AUTH_URL}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, displayName: name, returnSecureToken: true }),
    }),
    'Sign-up'
  );
  await json(
    await fetch(`${API_URL}/api/auth/role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${account.idToken}` },
      body: JSON.stringify({ role }),
    }),
    'Choosing a role'
  );
  return { email, name, uid: account.localId };
}

export async function signIn(page, { email }) {
  await page.goto('/login');
  await page.getByPlaceholder('your@email.com').fill(email);
  await page.getByPlaceholder('Enter password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.getByPlaceholder('Enter password')).toHaveCount(0, { timeout: 30_000 });
}

/** No serious or critical accessibility problems in the given part of the page. */
export async function expectAccessible(page, selector, label) {
  const { violations } = await new AxeBuilder({ page }).include(selector).analyze();
  const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const summary = bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(summary, `axe: ${label}`).toEqual([]);
}
