// Accounts and sign-in for the browser journeys. Everything goes to the Firebase emulators and a
// throwaway database (e2e/journeys/run.mjs). These accounts only ever exist there.
import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';

const API_URL = process.env.JOURNEY_API_URL;
const AUTH_URL = process.env.JOURNEY_AUTH_URL;
const FIRESTORE_URL = process.env.JOURNEY_FIRESTORE_URL;
const PROJECT = 'demo-peerlytics';
const PASSWORD = 'journey-password';

let counter = 0;

async function json(res, label) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${label} failed (${res.status}): ${JSON.stringify(body)}`);
  return body;
}

const post = (url, body, headers = {}) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

async function signUp(role, name) {
  counter += 1;
  const email = `${role.toLowerCase()}-${Date.now()}-${counter}@example.test`;
  const account = await json(
    await post(`${AUTH_URL}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, { email, password: PASSWORD, displayName: name, returnSecureToken: true }),
    'Sign-up'
  );
  return { email, name, uid: account.localId, idToken: account.idToken };
}

/** A fresh ID token, so it carries any claims set since the last one. */
export async function idTokenFor({ email }) {
  const session = await json(
    await post(`${AUTH_URL}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, { email, password: PASSWORD, returnSecureToken: true }),
    'Sign-in'
  );
  return session.idToken;
}

/** A new account with a chosen role, through the same routes a real sign-up uses. */
export async function createAccount(role, name) {
  const account = await signUp(role, name);
  await json(await post(`${API_URL}/api/auth/role`, { role }, { Authorization: `Bearer ${account.idToken}` }), 'Choosing a role');
  return { email: account.email, name, uid: account.uid };
}

/**
 * A superAdmin or collegeAdmin. Nobody can pick these at sign-up, so the emulator's admin API
 * sets the claims (as set-role.js would) and the users/{uid} mirror the rules read.
 */
export async function createAdminAccount(role, name, collegeId = null) {
  const account = await signUp(role, name);
  await json(
    await post(
      `${AUTH_URL}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`,
      { localId: account.uid, customAttributes: JSON.stringify({ role, collegeId }) },
      { Authorization: 'Bearer owner' }
    ),
    'Setting claims'
  );
  const fields = { role: { stringValue: role }, name: { stringValue: name }, email: { stringValue: account.email } };
  if (collegeId) fields.collegeId = { stringValue: collegeId };
  await json(
    await fetch(`${FIRESTORE_URL}/v1/projects/${PROJECT}/databases/(default)/documents/users/${account.uid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ fields }),
    }),
    'Writing the profile'
  );
  return { email: account.email, name, uid: account.uid };
}

/** Call the backend as `account`. */
export async function api(account, method, path, body) {
  const token = await idTokenFor(account);
  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  return json(res, `${method} ${path}`);
}

const today = () => new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
const shortId = () => Date.now().toString(36).slice(-5) + (counter += 1);

/**
 * Everything billing needs, through the real routes: a superAdmin, a plan and a method, a college
 * with its collegeAdmin. Returns { superAdmin, collegeAdmin, college, plan, method }.
 */
export async function setUpCollege({ seats = 5, price = 25000 } = {}) {
  const id = shortId();
  const superAdmin = await createAdminAccount('superAdmin', `Super Admin ${id}`);
  const college = await api(superAdmin, 'POST', '/admin/colleges', { name: `Journey College ${id}`, slug: `journey-${id}`.toLowerCase().replace(/[^a-z0-9-]/g, '') });
  const plan = await api(superAdmin, 'POST', '/admin/billing/plans', { name: `College plan ${id}`, priceNu: price, durationDays: 365, seats });
  const method = await api(superAdmin, 'POST', '/admin/billing/methods', { name: `mBoB ${id}` });
  const collegeAdmin = await createAdminAccount('collegeAdmin', `College Admin ${id}`, college.id);
  return { superAdmin, collegeAdmin, college, plan, method };
}

/** A lecturer with a seat on an approved, paid plan, so they can create courses. */
export async function createCoveredLecturer(name) {
  const setup = await setUpCollege();
  const lecturer = await createAccount('lecturer', name);
  const request = await api(setup.collegeAdmin, 'POST', '/college/payment-requests', {
    planId: setup.plan.id,
    paymentMethodId: setup.method.id,
    amountNu: setup.plan.priceNu,
    journalNumber: `J${Date.now()}${counter}`,
    paidOn: today(),
  });
  await api(setup.superAdmin, 'POST', `/admin/billing/requests/${request.id}/approve`);
  await api(setup.collegeAdmin, 'POST', '/college/lecturers', { email: lecturer.email });
  await api(setup.collegeAdmin, 'POST', `/college/seats/${lecturer.uid}`);
  return lecturer;
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
