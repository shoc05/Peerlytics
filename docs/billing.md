# Billing: college plans, manual payments and seats

Steps 6.7 to 6.14 of `docs/phase6-spec.md`. Everything about money is behind the `billing_enabled` flag, which stays **off in production** until the backend has a public address (D7).

## Who does what

| Role | Gets | Can |
|---|---|---|
| superAdmin | The admin area, with **Payments**, **Colleges and subscriptions**, **Plans** and **Payment settings** tabs | Add colleges, plans and payment methods; set the bank details and grace period; approve or reject payments; grant, extend or revoke a plan with a reason; give anyone a role and a college |
| collegeAdmin | Their college's console: **Overview**, **Subscription and payments**, **Lecturers and seats**, **Courses** | Pay for a plan by sending a journal number, cancel a pending payment, add their lecturers by email, give and remove seats. They see course names and counts, never content |
| lecturer | The course site, with a banner when they have no seat or the plan has ended | Create courses, projects and groups while they hold a seat on an active or grace plan |
| student | The course site | Join with a code; submit while the course's lecturer is covered |

People choose **student** or **lecturer** when they sign up, and nothing else. A superAdmin gives the other roles in **Users and roles**: pick the role and, for a collegeAdmin, the college, then **Save**. The person is signed out and signs in again with the new role.

Lecturers and students never pay (D1). No route accepts a payment from them.

## Setting it up (superAdmin)

1. Turn on `billing_enabled` (Remote Config, or `FLAG_BILLING_ENABLED=true` and `VITE_FLAG_BILLING_ENABLED=true` locally).
2. **Colleges and subscriptions:** add each college.
3. **Users and roles:** make someone the college's collegeAdmin, choosing the college.
4. **Payment settings:** enter the account name, number and bank, what happens after paying, the refund policy and the grace period (default 7 days). Add the payment methods (for example mBoB, BNB mPay, TPay, DK Bank, BDBL, bank transfer). The lists start empty because the app has no seed data.
5. **Plans:** add what colleges can buy: price in ngultrum, length in days, lecturer seats, optional courses per seat and AI analyses a month. Tick "Only granted by a superAdmin" for pilots.

## A payment, start to finish

1. The collegeAdmin pays by bank transfer, then on **Subscription and payments** chooses the plan and method and enters the journal number and date. The amount is the plan's price. They get a reference such as `PL-7F3K9Q`.
2. The superAdmin finds the journal number in the bank statement and, on **Payments**, approves it, or rejects it with a reason the collegeAdmin sees. Payments from another bank can take longer to show; they stay pending, with no time limit.
3. On approval the college is **active** until the plan's end. Renewing while active or in grace starts at the current end, so no days are lost; renewing after that starts on the day of approval.
4. The collegeAdmin adds lecturers by email (they must already have a lecturer account; they are signed out once) and gives them seats, up to the plan's seat count.

Rejected or cancelled journal numbers can be sent again (D8). A pending or approved number cannot be reused on the same method: a unique index in PostgreSQL enforces it, so two requests at once can't both get in. Each collegeAdmin can have at most 3 pending payments.

## Status

Worked out from the subscription rows every time (`backend/src/billing/status.js`), so no job can leave it wrong.

| Status | When | What works |
|---|---|---|
| Active | A subscription covers today | Everything |
| Grace period | The last one ended less than `grace_days` ago | Everything; lecturers see a banner |
| Read-only | Later than that | Viewing and export. Creating courses, projects and groups, adding members, submitting and new AI analysis are refused with `SUBSCRIPTION_INACTIVE` (D3) |
| Revoked | Only revoked subscriptions | As read-only |
| No subscription | Never had one | Lecturers can't create anything (`NO_SEAT`) |

A removed seat still counts for `grace_days`, so a lecturer's courses don't stop mid-week.

## Where it lives

| Part | Files |
|---|---|
| Tables | `backend/db/migrations/1792368000003_billing.js`, documented in `docs/db-schema.md` |
| Routes | `backend/src/billing/routes.js`, contract in `backend/openapi.yaml` (tag Billing) |
| Rules and data | `backend/src/billing/store.js`, `status.js`, `schemas.js` (Zod) |
| Seat check on course routes | `backend/src/billing/coverage.js`, used through `requireCovered` in `backend/routes/courseContext.js` |
| superAdmin screens | `src/admin/SuperAdminBilling.jsx`, `src/components/AdminArea.jsx` |
| collegeAdmin screens | `src/admin/CollegeAdminConsole.jsx` |
| Lecturer banner | `PlanBanner` in `src/courses/CoursesPanel.jsx` |
| Tests | `backend/src/billing/status.test.js`, `billing.pg.itest.js` (real PostgreSQL), `src/admin/billingFormat.test.js`, `e2e/journeys/billing.spec.js` (Playwright and axe) |

Every approve, reject, cancel, grant, extend, revoke, plan, method, settings, lecturer and seat change writes an `audit_log` row with who did it, in the same transaction.

## Not done yet

- **Firestore entitlements (rest of 6.9):** while read-only, the backend refuses the actions above, but the rules still let group members type in the workspace document.
- **Receipts (6.10), AI limits per plan (6.11), billing emails and expiry reminders (6.15).**
- **Change from the spec:** seats belong to the college, not to one subscription row, so a renewal keeps them.
