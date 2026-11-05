# Phase 6 spec: courses-first projects and subscriptions

Status: **waiting for Sangay's approval. No code until then.**

Behaviour reference: `docs/prototypes/peerlytics-roles.html`. Our design system wins wherever the two differ. Everything is behind the Remote Config flags `courses_v2` and `billing_enabled`.

## Decisions needed

Section numbers below assume the recommendation until these are answered.

| # | Question | Options | Recommendation |
|---|---|---|---|
| D1 | Who can buy? An earlier answer said only college admins pay. This brief and the prototype also have lecturers paying | (a) Both (b) College only | **(a)**, as the brief says. Hide lecturer plans by simply not creating any |
| D2 | Payment screenshots: an earlier answer said no screenshot, and this brief has an optional one. Firebase Storage appears to need the paid Blaze plan | (a) Leave out for now (b) Firebase Storage on Blaze (c) Private folder on the server | **(a)**. The journal number and the mBoB statement are the real check, and a screenshot can be faked anyway. Add it later without changing the rest |
| D3 | What stops at read-only? An earlier answer blocked marking and project work. This brief says grading still works and doesn't mention project work | (a) Block new courses, projects, AI and project editing; grading stays (b) Also block grading | **(a)**. Students' marks shouldn't be held up by a late payment |
| D4 | Standalone workspaces: see section 3.3 | A or B | **A** |
| D5 | Notifications: the brief says `notifier/`, which doesn't exist, and an earlier answer said `backend/` | (a) `backend/` (b) New service | **(a)**, with one module that can move later |
| D6 | AI limits: the code on `develop` has no OpenAI provider, and `ai_provider` isn't read. Sonam's OpenAI work is on an unmerged branch | (a) Bring in Sonam's 2.4 first (b) Count analyses and block at the limit | **(a)**, as its own step, so "fall back to backup" means something |
| D7 | Real payments need a public backend, and the tunnel is on hold | Keep `billing_enabled` off in production until it's live | **Yes** |

## 1. Current state (Step 0)

### Frontend

- `src/App.jsx` has three routes. Everything after login is tabs in `src/components/peerlytics-app.jsx`, with panels lazy-loaded.
- Tailwind has `brand`, `ink`, `info`, `warn`, `danger` and `darkMode: 'class'`, but many screens still use inline styles. `src/courses/` uses Tailwind classes and has English and Dzongkha strings, so new screens should follow it.
- `Logo.jsx` picks the light or dark logo. The header and sidebar live in `peerlytics-app.jsx`.
- Roles come from custom claims, with `users/{uid}.role` as a fallback (`src/utils/authRole.js`). A superAdmin gets only `AdminArea`. A collegeAdmin has no screen of their own yet.

### How workspaces work today

- A workspace is a Firestore `groups/{groupId}` document, created **in the browser** by `createProjectGroup` (`src/firebase/firestoreService.js:85`) with the id `group-<timestamp>`.
- There is no PostgreSQL row for it, and no course. On 5 November production had 2 groups and 9 users.

### Places that assume a workspace without a course

| Place | Assumption |
|---|---|
| `peerlytics-app.jsx:240` | The active workspace is `activeWorkspaceId`, a lecturer's `selectedGroup`, or `user.groupId` |
| `peerlytics-app.jsx:351`, `:2254`, `:2270`, `:2438`, `:2543` | `createGroup` and the "+ New Workspace" buttons |
| `peerlytics-app.jsx:391` | A lecturer is put on their first group automatically |
| `users/{uid}.groupId` | One current group per user, set by `createProjectGroup` and invites |
| `firestoreService.js:261`, `:286` | Inviting by email adds someone straight to a group, with no enrolment |
| `firestore.rules` `groups` | Any signed-in user can create a group. Members can add lecturers and delete it until it's locked |
| `WorkspacePanel.jsx`, `ReportsPanel.jsx`, `AdminPanel.jsx`, `src/collab/*`, `src/api/endpoints.js` | Take a `groupId`. No change needed if the id stays the same |
| `backend/src/jobs/deadlines/` | Reads PostgreSQL deadlines for course workspaces and keeps Firestore-only groups working |

### What already exists, to extend rather than duplicate

| Area | Exists | Missing |
|---|---|---|
| Tables | `colleges`, `college_domains`, `users`, `courses`, `enrolments`, `announcements`, `assignments`, `workspaces`, `workspace_members`, `grades`, `overrides`, `usage`, `audit_log` (append-only), `licences` | All billing tables |
| Course API | PR #82 (Sonam): courses, members, announcements, assignments, groups, workspaces. Mirrors each workspace to `groups/{id}` with `courseId` and `assignmentId` | Random groups, email and CSV invites, submissions |
| Join codes | 8 characters without look-alikes, case-insensitive, 10 tries a minute per user, regenerate route | Nothing |
| Course screens | `src/courses/` with the tabs. Connected in #82 | A Projects tab, a Groups tab that can act |
| Admin | `AdminArea` with users, workspaces, colleges and licences (`/api/admin/colleges`) | Everything billing. Suspend user |
| Usage | `usage` table | Nothing writes to it |
| Grading | PostgreSQL `grades` and `overrides` exist, but the app grades in the browser and stores in Firestore | The Grades tab stays empty until this is connected |
| Email | `reminderService.js`, SMTP | Billing messages |

Also not on `develop`: `pdfkit` or similar for receipts, `@axe-core/playwright`, `storage.rules`.

## 2. Status tables

### payment_request

| From | To | Who | When |
|---|---|---|---|
| (new) | `pending` | lecturer, collegeAdmin | Amount equals the plan price, `paid_on` isn't in the future, fewer than 3 pending |
| `pending` | `approved` | superAdmin | Row locked, one transaction, creates or extends the subscription and issues a receipt |
| `pending` | `rejected` | superAdmin | Reason required |
| `pending` | `cancelled` | the payer, superAdmin | Before review |

`approved`, `rejected` and `cancelled` are final. A corrected payment is a new request.

### subscription

Only `revoked_at` is stored. The rest is worked out from the dates, so no job can leave a status wrong.

| Status | When | Who moves it |
|---|---|---|
| `active` | now ≤ `ends_at` | superAdmin approval or manual grant |
| `grace` | `ends_at` < now ≤ `ends_at` + `grace_days` | Time |
| `read_only` | Later than that | Time |
| `revoked` | `revoked_at` is set | superAdmin, reason required |

- **Renewal while `active` or `grace`:** new period starts at the current `ends_at`. If `read_only`, it starts at approval.
- **Extend:** superAdmin, reason required. From `ends_at`, or from now if already `read_only`.
- **Revoked** is final. A new grant makes a new row.
- `grace_days` comes from `payment_settings`, default 7.

### A course's access

A course is covered when its owner has an `active` or `grace` subscription of their own, or an open seat on a college subscription that is `active` or `grace`. The better of the two counts. When a seat is removed, the lecturer's courses become read-only after `grace_days` unless they have another plan.

## 3. Access and data

### 3.1 Access table

R read, C create, U update, D delete. "Own" means their own record; "college" means their own college only.

| Resource | superAdmin | collegeAdmin | lecturer | student |
|---|---|---|---|---|
| College | R C U | R (own) | R (own name) | none |
| Course | R | R (college: names, lecturer, counts) | R C U (own). Archive, no delete | R (enrolled) |
| Project | R | R (college: count only) | R C U D (own course, D only without submissions) | R (enrolled) |
| Group workspace | Group details R; **no content unless submitted**, as today | none | Group details R C U in own course. Content R only after submission | R U (own group). Others none |
| Payment request | R U | R C (college's own), cancel own | R C (own), cancel own | none |
| Subscription | R C U (grant, extend, revoke) | R (college), seats U within limit | R (own) | none. Sees only "ended" |
| Plan | R C U (hide, no delete if used) | R (shown college plans) | R (shown lecturer plans) | none |
| Payment settings and methods | R U (methods C too) | R (the payment step's fields) | R (the payment step's fields) | none |
| Audit log | R | none | none | none |

**Note:** the brief's "enforced in both" only applies directly to data in Firestore (workspaces, members, documents). Firestore rules can't see PostgreSQL. So:

| Data | Backend | Firestore rules |
|---|---|---|
| In PostgreSQL | `requireAuth`, `requireRole`, then row checks | Not stored there. No matching rule, so denied |
| Workspaces in Firestore | Backend is the only creator when `courses_v2` is on | Enforce membership, and block browser-created groups |
| Subscription status | `requireActiveSubscription` | A server-written `entitlements/{ownerUid}` that rules read to block editing |

Rules also can't read Remote Config. So `courses_v2` is mirrored to a server-written `config/flags` document for the rules.

### 3.2 Data model (new migrations, no seed rows)

`payment_methods` starts empty: the superAdmin enters the list from the brief on the Payment methods screen, because seed rows aren't allowed.

| Table | Columns |
|---|---|
| `plans` | `id`, `name`, `kind` (lecturer, college), `price_nu`, `duration_days`, `max_courses`, `monthly_ai_analyses`, `seats` (college only), `is_active`, `manual_only`, `created_by`, timestamps |
| `payment_methods` | `id`, `name` unique, `is_active`, timestamps |
| `payment_settings` | One row (enforced by a check): `account_name`, `account_number`, `bank`, `qr_image_path`, `verification_message`, `refund_policy`, `grace_days` default 7, `updated_by`, `updated_at` |
| `payment_requests` | `id`, `payer_id`, `college_id`, `plan_id`, `reference_code` unique, `amount_nu`, `payment_method_id`, `journal_number`, `paid_on`, `screenshot_path`, `status`, `reject_reason`, `reviewed_by`, `reviewed_at`, `created_at`. **UNIQUE (`payment_method_id`, `journal_number`)** |
| `subscriptions` | `id`, `owner_type` (lecturer, college), `owner_id`, `plan_id`, `payment_request_id` nullable, `starts_at`, `ends_at`, `grant_type` (paid, manual), `note`, `revoked_at`, `created_by`, `created_at` |
| `seat_assignments` | `subscription_id`, `lecturer_id`, `assigned_by`, `assigned_at`, `removed_at`. One open seat per lecturer |
| `receipts` | `id`, `receipt_number` unique (`PL-YYYY-NNNN`), `payment_request_id` unique, `issued_at` |
| `receipt_counters` | `year` primary key, `last_number`, updated under a row lock so numbers don't skip or repeat |
| `users` (change) | Add `suspended_at` |

Rules:
- `journal_number` is stored uppercase without spaces.
- `reference_code` is random and server-made, for example `PL-7F3K`.
- `amount_nu` is copied from the plan at submission, so a later price change doesn't affect it.
- Every approve, reject, grant, extend, revoke, role, suspend, plan and settings change writes to `audit_log` with who, when, why, before and after, in the same transaction.
- `audit_log.actor_id` uses `ensureUser` from #82, so admins always have a row. This replaces the `NULL` actor in #74's admin store.
- `licences` stays but isn't used when `billing_enabled` is on. Its tab is replaced by Colleges and Plans.

### 3.3 Existing standalone workspaces

Neither option creates a default or sample workspace.

| | **Option A (recommended):** keep as "Older workspaces" | Option B: export, then remove |
|---|---|---|
| What happens | Stay in Firestore untouched. Members and lecturers see them in a separate list and keep access. No new ones can be made. A lecturer can attach one to a project in their course, which adds the PostgreSQL rows | Users get a notice and a date to export. Then they're archived and hidden |
| Data risk | None | Real, and against "never delete data" in spirit |
| Cost | Keeps the old code path for reading | Removes it sooner |
| Who's affected | 2 groups on 5 November, so either is small | Same |

The migration is a dry-run script that lists them first. It adds nothing to Firestore unless a lecturer attaches one.

## 4. Threats in the manual payment flow

| Threat | Handling |
|---|---|
| Reused journal number | The database's UNIQUE (`payment_method_id`, `journal_number`) refuses it, giving 409. The app's own check is only for a nicer message |
| Rejected number used again | Decision needed in review: as written, the unique rule blocks a genuine retry after a typo. **I recommend making it a partial unique index that ignores `rejected` and `cancelled`.** Reuse of an approved number stays impossible |
| Two admins or two clicks approving | `SELECT … FOR UPDATE` on the request, check it's still `pending`, one transaction. The second gets 409. `subscriptions.payment_request_id` is unique as a backstop |
| Wrong amount | The API compares it with the plan price and refuses. The stored amount comes from the plan. The superAdmin still compares it with the statement |
| Fake screenshot | Never evidence. The queue says to check the statement. Approval requires seeing the journal in the statement |
| Fake journal number | Same: nothing activates until the superAdmin approves |
| Another bank's payment showing late | The method is shown in the queue with a note that interbank payments can take longer. The request stays pending, with no timeout. The verification message sets expectations |
| Plan ending mid-project | Warning from 7 days before, then grace. Then read-only: nothing is deleted, work can still be viewed and exported, grading continues. Submitting is decided by D3 |
| collegeAdmin or lecturer trying to approve | `requireRole('superAdmin')` on the backend, tested with real requests. Buttons being hidden isn't relied on |
| Student guessing a join code | 31^8 possible codes, 10 tries a minute per user, the same answer for any wrong code, regenerate at any time, can be switched off |
| Payer changes the plan to a cheaper one | The plan and amount are fixed at submission, and the approval screen shows both |
| Submission flooding | Maximum 3 pending per user, plus a rate limit on the route |
| Someone else's reference code | Codes are server-made and tied to the request. A mismatch in the remarks is a reason to reject |
| superAdmin mistake | Revoke and extend need reasons, and everything is in the append-only audit log |
| Account number tampering | Settings are superAdmin-only and every change is audited |
| Emails in logs | Log user ids only. A test checks the notifier's log output |

## 5. Build steps

Each step is one PR into `develop`, on `feature/6.<n>-<name>`. Owners are suggestions. Each must pass lint, unit tests, build and CI.

| Step | Owner | Folder | Tests | Jira summary |
|---|---|---|---|---|
| 6.1 | Sonam | `backend/routes`, `src/api`, `src/courses` | PR #82: 172 unit, 70 PostgreSQL | 6.1 Bring back the courses API and connect the Courses tab |
| 6.2 | Sonam | `backend/services`, `backend/routes` | Port Sonam's 2.4 tests, PostgreSQL | 6.2 Bring back OpenAI analysis with the legacy fallback (D6) |
| 6.3 | Kezang | `firestore.rules`, `backend/`, `test/` | Rules emulator: non-enrolled student, other group, lecturer before submission, browser group creation refused | 6.3 Server-only workspace creation and tighter rules behind courses_v2 |
| 6.4 | Ngawang | `src/courses`, `src/components` | Unit, Playwright: course, project, join by code, own group only; axe | 6.4 Course-first home, Projects tab and removal of New Workspace |
| 6.5 | Sonam | `backend/routes`, `src/courses` | PostgreSQL | 6.5 Random groups and email or CSV invites |
| 6.6 | Sangay | `scripts/`, `src/components` | Dry-run test | 6.6 Older workspaces list and attach to a project |
| 6.7 | Tshewang | `backend/db/migrations`, `docs/db-schema.md`, `backend/openapi.yaml`, flags | Migrations on PostgreSQL, constraints | 6.7 Billing tables, API contract and billing_enabled |
| 6.8 | Tshewang | `backend/src/billing` | PostgreSQL: duplicate journal by the DB, wrong amount, two concurrent approvals give one subscription, renewal from current end, audit rows, role checks | 6.8 Payment requests, approve and reject, with manual_mbob method interface |
| 6.9 | Kezang | `backend/src/billing`, `firestore.rules` | PostgreSQL: grace to read-only, seat limits. Rules: entitlements | 6.9 Subscription rules, seats and requireActiveSubscription |
| 6.10 | Tshewang | `backend/src/billing` | Unit, PostgreSQL: sequential numbers | 6.10 PDF receipts with sequential numbers |
| 6.11 | Sonam | `backend/routes`, `backend/src/billing` | Stubbed providers, PostgreSQL | 6.11 Count AI analyses and apply plan limits |
| 6.12 | Ngawang | `src/billing` | Payment form and banner tests; axe | 6.12 Lecturer billing page, subscribe flow and banners |
| 6.13 | Ngawang | `src/admin` | axe; Playwright: approve and reject journeys | 6.13 superAdmin console |
| 6.14 | Kezang | `src/admin`, `backend/src/billing` | PostgreSQL scoping: own college only; axe | 6.14 collegeAdmin console and college plans |
| 6.15 | Tshewang | `backend/src/billing`, `src/` | Stubbed email; no emails in logs | 6.15 Billing notifications and expiry reminders |
| 6.16 | Sangay | `e2e/`, `docs/`, `.env.example` | All four Playwright journeys, axe on every screen, full CI | 6.16 End-to-end journeys, docs/billing.md and final checks |

Screenshots (D2) would add one step after 6.10 if chosen.

## 6. How we prove it works

Required before a step counts as done, as in the brief.

1. **Real PostgreSQL:** duplicate journal refused by the database; two concurrent approvals give one subscription; renewal extends from the current end; grace then read-only; seat limits; collegeAdmin and lecturer can't approve; audit rows written.
2. **Firestore emulator:** non-enrolled student can't read a course, project or workspace; student can't read another group's workspace; lecturer can't read a workspace before submission.
3. **Playwright:** lecturer pays and superAdmin approves; superAdmin rejects and lecturer resubmits; lecturer creates a course and project and a student joins by code and sees only their group; read-only disables create buttons and export still works. These need the Auth and Firestore emulators, a new setup in CI.
4. **axe:** no serious or critical issues on any new screen.
5. **lint, unit tests, build and CI** green, with `.env.example` and `docs/billing.md` updated.
