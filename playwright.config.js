// Playwright (step 5.8). `npm run test:e2e:staging` runs the read-only smoke tests in
// e2e/staging/ against a deployed site; cd-staging.yml runs it after every staging deploy.
//   BASE_URL  the website, e.g. https://<owner>.github.io/<repo>/ (required)
//   API_URL   the backend server without /api, e.g. https://<STAGING_DOMAIN> (required)
//   COLLAB_URL optional; default wss://<API_URL host>/collab
//   E2E_TOKEN  optional Firebase ID token; without it the signed-in tests are skipped
// There is no local web server: to try it locally, run `npx vite preview` and point BASE_URL at it.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  projects: [
    // Browser journeys against emulators and a real PostgreSQL: npm run test:e2e:journeys (e2e/journeys/run.mjs).
    {
      name: 'journeys',
      testDir: './e2e/journeys',
      timeout: 120_000,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.JOURNEY_URL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
      },
    },
    {
      name: 'staging',
      testDir: './e2e/staging',
      retries: 1,
      timeout: 60_000,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.BASE_URL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
      },
    },
  ],
});
