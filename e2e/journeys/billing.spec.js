// Steps 6.13 and 6.14: a collegeAdmin pays with a journal number, the superAdmin rejects it with a
// reason, the collegeAdmin sees the reason and sends it again, the superAdmin approves, the
// college is active and the collegeAdmin gives a lecturer a seat, who can then create a course.
// Plans and methods are set up through the API; every decision is made on the screens.
import { expect, test } from '@playwright/test';
import { api, createAccount, expectAccessible, setUpCollege, signIn } from './helpers.js';

test.describe.configure({ mode: 'serial' });

async function setTheme(context, theme) {
  await context.addInitScript((value) => localStorage.setItem('peerlytics-theme', value), theme);
}

async function open(browser, account, theme = 'light') {
  const context = await browser.newContext();
  await setTheme(context, theme);
  const page = await context.newPage();
  page.on('dialog', (dialog) => dialog.accept());
  await signIn(page, account);
  return page;
}

const openTab = (page, name) => page.getByRole('tab', { name, exact: true }).click();

async function sendPayment(page, setup, journal) {
  await openTab(page, 'Subscription and payments');
  await page.getByLabel('Plan', { exact: true }).selectOption(setup.plan.id);
  await page.getByLabel('How you paid').selectOption(setup.method.id);
  await page.getByLabel('Journal number').fill(journal);
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Sent for review' })).toBeVisible();
}

test('collegeAdmin pays, superAdmin rejects then approves, and a lecturer gets a seat', async ({ browser }) => {
  const setup = await setUpCollege({ seats: 2 });
  await api(setup.superAdmin, 'PUT', '/admin/billing/settings', { accountName: 'Peerlytics', accountNumber: '200111222', bank: 'Bank of Bhutan', graceDays: 7 });
  const lecturer = await createAccount('lecturer', 'Sonam Lecturer');
  const journal = `8989${Date.now().toString().slice(-6)}`;

  // ── A lecturer without a seat is told so, and can't create a course ──
  const lecturerPage = await open(browser, lecturer);
  await expect(lecturerPage.getByTestId('plan-banner')).toContainText('You do not have a seat yet');

  // ── collegeAdmin: their own page, not the student one ──
  const admin = await open(browser, setup.collegeAdmin);
  const consoleRoot = admin.getByTestId('college-admin-console');
  await expect(consoleRoot).toBeVisible();
  await expect(admin.getByRole('heading', { name: setup.college.name })).toBeVisible();
  await expect(admin.getByTestId('courses-panel')).toHaveCount(0);
  await expect(consoleRoot).toContainText('No subscription');
  await sendPayment(admin, setup, journal);
  await expect(admin.getByRole('row').filter({ hasText: journal })).toContainText('Waiting for review');
  await expectAccessible(admin, '[data-testid="college-admin-console"]', 'collegeAdmin: payments');

  // ── superAdmin rejects with a reason ──
  const sadm = await open(browser, setup.superAdmin);
  await expect(sadm.getByRole('tab', { name: 'Payments', exact: true })).toHaveAttribute('aria-selected', 'true');
  const card = sadm.getByRole('listitem', { name: new RegExp(setup.college.name) });
  await expect(card).toContainText(journal);
  await expectAccessible(sadm, 'body', 'superAdmin: payments');
  await card.getByRole('button', { name: 'Reject' }).click();
  await card.getByLabel(/Why is it rejected/).fill('Not found in the statement');
  await card.getByRole('button', { name: 'Reject payment' }).click();
  await expect(sadm.getByRole('status').filter({ hasText: 'Rejected' })).toBeVisible();

  // ── collegeAdmin sees the reason and sends the same journal number again (D8) ──
  await admin.reload();
  await openTab(admin, 'Subscription and payments');
  const rejected = admin.getByRole('row').filter({ hasText: journal }).filter({ hasText: 'Rejected' });
  await expect(rejected).toContainText('Reason: Not found in the statement');
  await sendPayment(admin, setup, journal);

  // ── superAdmin approves ──
  await sadm.getByRole('button', { name: 'Refresh' }).click();
  await sadm.getByRole('listitem', { name: new RegExp(setup.college.name) }).getByRole('button', { name: 'Approve' }).click();
  await expect(sadm.getByRole('status').filter({ hasText: 'Approved' })).toBeVisible();
  await openTab(sadm, 'Colleges and subscriptions');
  await expect(sadm.getByRole('listitem').filter({ hasText: setup.college.name })).toContainText('Active');
  await expectAccessible(sadm, 'body', 'superAdmin: colleges');

  // ── collegeAdmin: active, adds the lecturer and gives them a seat ──
  await admin.reload();
  await expect(admin.getByTestId('college-admin-console')).toContainText('Active');
  await openTab(admin, 'Lecturers and seats');
  await admin.getByLabel("Lecturer's email").fill(lecturer.email);
  await admin.getByRole('button', { name: 'Add lecturer' }).click();
  await admin.getByRole('button', { name: `Give ${lecturer.name} a seat` }).click();
  await expect(admin.getByRole('button', { name: `Remove the seat from ${lecturer.name}` })).toBeVisible();
  await expect(admin.getByTestId('college-admin-console')).toContainText('1 of 2 seats in use');
  await expectAccessible(admin, '[data-testid="college-admin-console"]', 'collegeAdmin: lecturers');

  // ── The lecturer signs in again (adding them to the college signed them out) and can create a course ──
  const again = await open(browser, lecturer);
  await expect(again.getByTestId('courses-panel')).toBeVisible();
  await expect(again.getByTestId('plan-banner')).toHaveCount(0);
  await again.getByLabel('Course code').fill('CTE501');
  await again.getByLabel('Course title').fill('Seated course');
  await again.getByRole('button', { name: 'Create course', exact: true }).click();
  await expect(again.getByRole('button', { name: /Open .*Seated course/ })).toBeVisible();

  // ── and the collegeAdmin sees it, names and counts only ──
  await admin.reload();
  await openTab(admin, 'Courses');
  await expect(admin.getByRole('row').filter({ hasText: 'Seated course' })).toContainText(lecturer.name);
});

for (const theme of ['light', 'dark']) {
  test(`billing screens have no serious axe issues and fit a phone (${theme})`, async ({ browser }) => {
    const setup = await setUpCollege();
    const admin = await open(browser, setup.collegeAdmin, theme);
    await admin.setViewportSize({ width: 375, height: 800 });
    for (const tab of ['Overview', 'Subscription and payments', 'Lecturers and seats', 'Courses']) {
      await openTab(admin, tab);
      await expectAccessible(admin, '[data-testid="college-admin-console"]', `collegeAdmin ${tab} (${theme})`);
    }
    const fits = await admin.getByTestId('college-admin-console').evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    expect(fits, 'the college admin console fits a 375px screen').toBe(true);

    const sadm = await open(browser, setup.superAdmin, theme);
    for (const tab of ['Payments', 'Colleges and subscriptions', 'Plans', 'Payment settings']) {
      await openTab(sadm, tab);
      await expect(sadm.getByRole('heading', { name: tab, level: 1 })).toBeVisible();
      await expectAccessible(sadm, 'body', `superAdmin ${tab} (${theme})`);
    }
  });
}
