// Step 6.4: a lecturer makes a course and project, students join with the code, and each student
// reaches only their own group's workspace. With courses_v2 on, Courses is home and there is no
// way to make a standalone workspace.
import { expect, test } from '@playwright/test';
import { createAccount, createCoveredLecturer, expectAccessible, signIn } from './helpers.js';

const THEMES = ['light', 'dark'];

test.describe.configure({ mode: 'serial' });

async function setTheme(page, theme) {
  await page.addInitScript((value) => localStorage.setItem('peerlytics-theme', value), theme);
}

const openTab = (page, name) => page.getByRole('tab', { name, exact: true }).click();

async function joinCourse(browser, student, code, title) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, student);
  await expect(page.getByTestId('courses-panel')).toBeVisible();
  await page.getByLabel('Join code').fill(code);
  await page.getByRole('button', { name: /join/i }).click();
  await expect(page.getByRole('button', { name: new RegExp(`Open .*${title}`) })).toBeVisible();
  return { context, page };
}

test('lecturer creates a course and project, and each student reaches only their own group', async ({ browser }) => {
  // billing_enabled is on in the journeys, so the lecturer needs a seat (billing.spec.js covers how).
  const lecturer = await createCoveredLecturer('Pema Lecturer');
  const tashi = await createAccount('student', 'Tashi Student');
  const dorji = await createAccount('student', 'Dorji Student');
  const suffix = Date.now().toString(36).slice(-4).toUpperCase();
  const courseTitle = `Integrated Systems ${suffix}`;

  // ── Lecturer: Courses is home, and there is nothing to make a standalone workspace with ──
  const lecturerContext = await browser.newContext();
  const page = await lecturerContext.newPage();
  await signIn(page, lecturer);
  await expect(page.getByTestId('courses-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: /New Workspace/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'My Workspaces' })).toHaveCount(0);

  await page.getByLabel('Course code').fill(`CTE${suffix}`);
  await page.getByLabel('Course title').fill(courseTitle);
  await page.getByRole('button', { name: 'Create course', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`Open .*${courseTitle}`) }).click();
  await expect(page.getByTestId('course-page')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Projects', exact: true })).toHaveAttribute('aria-selected', 'true');

  // ── Project with a name, deadline and group size ──
  await page.getByLabel('Project name').fill('Group report');
  await page.getByLabel(/Deadline date/).fill('31/12/2099');
  await page.getByLabel('Time (24-hour, hh:mm)').fill('23:59');
  await page.getByLabel('Group size').selectOption('2');
  await page.getByRole('button', { name: 'Create project' }).click();
  const project = page.getByRole('listitem').filter({ hasText: 'Group report' });
  await expect(project).toContainText('Open');
  await expect(project).toContainText('Groups of 2');
  await expect(project).toContainText('0 groups');
  await expect(project).toContainText('0 of 0 submitted');

  // ── Join code ──
  await openTab(page, 'Members');
  const code = await page.getByTestId('join-code').innerText();
  expect(code.length).toBeGreaterThanOrEqual(7);

  // ── Students join, one with the code in lower case ──
  const first = await joinCourse(browser, tashi, code, courseTitle);
  const second = await joinCourse(browser, dorji, code.toLowerCase(), courseTitle);

  // Before grouping, a student sees the project but no workspace.
  await first.page.getByRole('button', { name: new RegExp(`Open .*${courseTitle}`) }).click();
  await expect(first.page.getByText('Group report')).toBeVisible();
  await expect(first.page.getByText(/not put you in a group/)).toBeVisible();

  // ── Lecturer makes one group for each student ──
  await page.reload();
  await page.getByRole('button', { name: new RegExp(`Open .*${courseTitle}`) }).click();
  await openTab(page, 'Groups');
  for (const [group, student] of [['Team A', tashi], ['Team B', dorji]]) {
    await page.getByLabel('Group name').fill(group);
    await page.getByLabel(student.name).check();
    await page.getByRole('button', { name: 'Create group' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: group })).toContainText(student.name);
  }

  // The lecturer can't open a workspace before the group submits.
  const teamA = page.getByRole('listitem').filter({ hasText: 'Team A' });
  await expect(teamA).toContainText('Not submitted');
  await expect(teamA.getByRole('button', { name: 'View workspace' })).toHaveCount(0);

  await openTab(page, 'Projects');
  await page.reload();
  await page.getByRole('button', { name: new RegExp(`Open .*${courseTitle}`) }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Group report' })).toContainText('2 groups');

  // ── Each student sees only their own group ──
  await first.page.reload();
  await first.page.getByRole('button', { name: new RegExp(`Open .*${courseTitle}`) }).click();
  await expect(first.page.getByText('Your group: Team A')).toBeVisible();
  await openTab(first.page, 'Groups');
  await expect(first.page.getByText('Team A', { exact: true })).toBeVisible();
  await expect(first.page.getByText('Team B', { exact: true })).toHaveCount(0);
  await expect(first.page.getByText(dorji.name)).toHaveCount(0);

  // ── The student opens their workspace ──
  await openTab(first.page, 'Projects');
  await first.page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(first.page.getByTestId('course-page')).toHaveCount(0);
  await expect(first.page.getByText('Team A').first()).toBeVisible();
  await expect(first.page.getByText(/Missing or insufficient permissions/)).toHaveCount(0);

  await second.page.reload();
  await second.page.getByRole('button', { name: new RegExp(`Open .*${courseTitle}`) }).click();
  await expect(second.page.getByText('Your group: Team B')).toBeVisible();

  await first.context.close();
  await second.context.close();
  await lecturerContext.close();
});

for (const theme of THEMES) {
  test(`the new course screens pass axe, and fit a phone, in the ${theme} theme`, async ({ browser }) => {
    const lecturer = await createCoveredLecturer('Axe Lecturer');
    const student = await createAccount('student', 'Axe Student');
    const suffix = Date.now().toString(36).slice(-4).toUpperCase();
    const title = `Axe Course ${suffix}`;

    const context = await browser.newContext();
    const page = await context.newPage();
    await setTheme(page, theme);
    await signIn(page, lecturer);
    await expect(page.getByTestId('courses-panel')).toBeVisible();
    await expectAccessible(page, '[data-testid="courses-panel"]', `lecturer courses, ${theme}`);

    await page.getByLabel('Course code').fill(`AX${suffix}`);
    await page.getByLabel('Course title').fill(title);
    await page.getByRole('button', { name: 'Create course', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(`Open .*${title}`) }).click();

    await page.getByLabel('Project name').fill('Report');
    await page.getByLabel(/Deadline date/).fill('31/12/2099');
    await page.getByLabel('Time (24-hour, hh:mm)').fill('23:59');
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Report' })).toBeVisible();
    for (const tab of ['Projects', 'Overview', 'Groups', 'Members', 'Grades']) {
      await openTab(page, tab);
      await expectAccessible(page, '[data-testid="course-page"]', `lecturer ${tab}, ${theme}`);
    }

    await openTab(page, 'Members');
    const code = await page.getByTestId('join-code').innerText();

    const joined = await joinCourse(browser, student, code, title);
    await expectAccessible(joined.page, '[data-testid="courses-panel"]', `student courses, ${theme}`);
    await joined.page.close();

    await page.setViewportSize({ width: 390, height: 844 });
    for (const tab of ['Projects', 'Groups', 'Members']) {
      await openTab(page, tab);
      const panel = page.getByRole('tabpanel');
      const fits = await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      expect(fits, `${tab} fits a phone`).toBe(true);
    }
    await joined.context.close();
    await context.close();
  });
}
