// Staging smoke tests (step 5.8). Read-only and safe after every deploy: they open pages, call
// GET /api/health and open (then close) one WebSocket. They never sign up, sign in or write data.
import { test, expect } from '@playwright/test';
import { API_URL, BASE_PATH, BASE_URL, COLLAB_URL, E2E_TOKEN, HEALTH_URL } from './env.js';

/** Collects console errors and uncaught page errors while a test runs. */
function watchErrors(page) {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

test.describe('website under its sub-path', () => {
  test('home page loads and shows the version line, with no console errors', async ({ page }) => {
    const errors = watchErrors(page);
    const response = await page.goto(BASE_URL);
    expect(response?.ok()).toBe(true);
    await expect(page.getByTestId('app-version')).toContainText(/^Version \S+/);
    // Signed out, "/" goes to /dashboard and then to the sign-in page, still under the base path.
    await expect(page).toHaveURL(new RegExp(`^${escape(BASE_URL)}`));
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });

  test('sign-in page loads, with no console errors', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`${BASE_URL}login`);
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page).toHaveURL(`${BASE_URL}login`);
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });

  test('a deep link opens the app through 404.html', async ({ page }) => {
    // GitHub Pages answers /<repo>/courses with 404.html and status 404; the app must still boot.
    await page.goto(`${BASE_URL}courses`);
    await expect(page.getByTestId('app-version')).toBeVisible();
    await expect(page).toHaveTitle(/Peerlytics/);
    await expect(page).toHaveURL(new RegExp(`^${escape(new URL(BASE_URL).origin + BASE_PATH)}`));
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });
});

test.describe('backend', () => {
  test('GET /api/health returns OK', async ({ request }) => {
    const response = await request.get(HEALTH_URL);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe('ok');
  });

  test('the collab WebSocket connects', async () => {
    test.skip(!COLLAB_URL, 'No COLLAB_URL and API_URL is not http(s)');
    // A connection check only: open, then close without sending anything.
    const opened = await new Promise((resolve, reject) => {
      const ws = new WebSocket(COLLAB_URL);
      const timer = setTimeout(() => { ws.close(); reject(new Error(`${COLLAB_URL} did not open in 15 s`)); }, 15_000);
      ws.addEventListener('open', () => { clearTimeout(timer); ws.close(1000); resolve(true); });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`${COLLAB_URL} refused the connection`)); });
    });
    expect(opened).toBe(true);
  });

  test('signed in: GET /api/auth/me accepts the token', async ({ request }) => {
    test.skip(!E2E_TOKEN, 'E2E_TOKEN is not set');
    const base = /\/api$/.test(API_URL) ? API_URL : `${API_URL}/api`;
    const response = await request.get(`${base}/auth/me`, { headers: { Authorization: `Bearer ${E2E_TOKEN}` } });
    expect(response.status()).toBe(200);
  });
});

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
