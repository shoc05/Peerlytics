# Phase 6 spec: courses-first projects and subscriptions

Status: **approved by Sangay on 6 November 2026, with the decisions below.**

Behaviour reference: `docs/prototypes/peerlytics-roles.html`. Our design system wins wherever the two differ. Everything is behind the Remote Config flags `courses_v2` and `billing_enabled`.

## Decisions

| # | Question | Decision |
|---|---|---|
| D1 | Who can buy? | **Colleges only.** A collegeAdmin pays and assigns seats to lecturers. Lecturers and students never pay. The brief's lecturer plans and lecturer Subscribe flow are not built |
| D2 | Payment screenshots? | **None.** The journal number and payment method are what get checked. No Firebase Storage |
| D3 | What stops at read-only? | **New courses, projects, AI analysis, project editing and marking.** Viewing and export continue. This replaces the brief's "grading still works" |
| D4 | Existing standalone workspaces? | **Add them to courses,** so students enrolled in the course have them as projects. See section 3.3 |
| D5 | Where do notifications go? | **`backend/`**, in one module that can move later |
| D6 | AI provider? | **Bring in Sonam's OpenAI work now.** The API key is bought and added later. Until then every analysis uses the legacy provider, with the reason recorded |
| D7 | Real payments before the backend is public? | **No.** `billing_enabled` stays off in production until the backend has a public address |
| D8 | Rejected journal numbers? | **Can be used again.** The unique rule ignores `rejected` and `cancelled` requests. Pending and approved numbers can't be reused. Chosen by Claude as recommended; Sangay can overrule it |

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
| (new) | `pending` | collegeAdmin | Amount equals the plan price, `paid_on` isn't in the future, fewer than 3 pending |
| `pending` | `approved` | superAdmin | Row locked, one transaction, creates or extends the subscription and issues a receipt |
| `pending` | `rejected` | superAdmin | Reason required |
| `pending` | `cancelled` | the paying collegeAdmin, superAdmin | Before review |

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

A course is covered when its owner has an open seat on a college subscription that is `active` or `grace`. A lecturer with no seat can't create courses or projects. When a seat is removed, that lecturer's courses become read-only after `grace_days`, unless they get a seat again. A superAdmin's manual grant, for a pilot for example, goes to a college too.

## 3. Access and data

### 3.1 Access table

R read, C create, U update, D delete. "Own" means their own record; "college" means their own college only.

| Resource | superAdmin | collegeAdmin | lecturer | student |
|---|---|---|---|---|
| College | R C U | R (own) | R (own name) | none |
| Course | R | R (college: names, lecturer, counts) | R C U (own). Archive, no delete | R (enrolled) |
| Project | R | R (college: count only) | R C U D (own course, D only without submissions) | R (enrolled) |
| Group workspace | Group details R; **no content unless submitted**, as today | none | Group details R C U in own course. Content R only after submission. Marking only while covered | R U (own group, while the course is covered; otherwise R and export). Others none |
| Payment request | R U | R C (college's own), cancel own | none | none |
| Subscription | R C U (grant, extend, revoke) | R (college), seats U within limit | R (own seat and status) | none. Sees only "ended" |
| Plan | R C U (hide, no delete if used) | R (shown plans) | none | none |
| Payment settings and methods | R U (methods C too) | R (the payment step's fields) | none | none |
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
| `plans` | `id`, `name`, `price_nu`, `duration_days`, `seats`, `max_courses` per seat, `monthly_ai_analyses`, `is_active`, `manual_only`, `created_by`, timestamps. Colleges only, so no `kind` |
| `payment_methods` | `id`, `name` unique, `is_active`, timestamps |
| `payment_settings` | One row (enforced by a check): `account_name`, `account_number`, `bank`, `qr_image_path`, `verification_message`, `refund_policy`, `grace_days` default 7, `updated_by`, `updated_at` |
| `payment_requests` | `id`, `payer_id`, `college_id` required, `plan_id`, `reference_code` unique, `amount_nu`, `payment_method_id`, `journal_number`, `paid_on`, `status`, `reject_reason`, `reviewed_by`, `reviewed_at`, `created_at`. **Unique index on (`payment_method_id`, `journal_number`) where status is `pending` or `approved`** |
| `subscriptions` | `id`, `college_id`, `plan_id`, `payment_request_id` nullable and unique, `starts_at`, `ends_at`, `grant_type` (paid, manual), `note`, `revoked_at`, `created_by`, `created_at` |
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

Each one becomes a project's group workspace inside a course, so enrolled students reach it from that course. Nothing is created automatically, and no default or sample course or workspace is made.

1. A dry-run script lists standalone groups, their members and lecturers, and changes nothing.
2. On a course's Projects tab, the lecturer chooses **Add existing workspace** and picks one of the workspaces they're on, then the project it belongs to.
3. The backend adds the `workspaces` and `workspace_members` rows with the same id, enrols its students in the course, and sets `courseId` and `assignmentId` on the Firestore document. Documents and history stay where they are, because the id doesn't change.
4. A group with no lecturer appears to the superAdmin, who picks the lecturer who should take it on.
5. Until it's added, a standalone workspace stays visible to its members as today, so nobody loses work. Creating a new one is blocked once `courses_v2` is on.

On 5 November there were 2 such groups.

## 4. Threats in the manual payment flow

| Threat | Handling |
|---|---|
| Reused journal number | The database's unique index refuses it, giving 409. The app's own check is only for a nicer message |
| Rejected number used again | Allowed after rejection or cancellation (D8). A number that is pending or approved can't be reused |
| Two admins or two clicks approving | `SELECT … FOR UPDATE` on the request, check it's still `pending`, one transaction. The second gets 409. `subscriptions.payment_request_id` is unique as a backstop |
| Wrong amount | The API compares it with the plan price and refuses. The stored amount comes from the plan. The superAdmin still compares it with the statement |
| Fake screenshot | There are no screenshots (D2). The request is only a claim until checked |
| Fake journal number | Nothing activates until the superAdmin finds it in the statement and approves |
| Another bank's payment showing late | The method is shown in the queue with a note that interbank payments can take longer. The request stays pending, with no timeout. The verification message sets expectations |
| Plan ending mid-project | Banners from 7 days before, then grace. Then read-only (D3): nothing is deleted and work can still be viewed and exported, but editing, submitting, marking and new AI stop until the college renews |
| collegeAdmin or lecturer trying to approve | `requireRole('superAdmin')` on the backend, tested with real requests. Hidden buttons aren't relied on |
| Lecturer trying to buy | No route accepts it (D1), tested |
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
| 6.2 | Sonam | `backend/services`, `backend/routes` | Port Sonam's 2.4 tests, PostgreSQL, OpenAI stubbed. With no API key, legacy runs and the reason is recorded | 6.2 Bring back OpenAI analysis with the legacy fallback, key added later |
| 6.3 | Kezang | `firestore.rules`, `backend/`, `test/` | Rules emulator: non-enrolled student, other group, lecturer before submission, browser group creation refused | 6.3 Server-only workspace creation and tighter rules behind courses_v2 |
| 6.4 | Ngawang | `src/courses`, `src/components` | Unit, Playwright: course, project, join by code, own group only; axe | 6.4 Course-first home, Projects tab and removal of New Workspace |
| 6.5 | Sonam | `backend/routes`, `src/courses` | PostgreSQL | 6.5 Random groups, email or CSV invites, and submit through the new route |
| 6.6 | Sangay | `scripts/`, `backend/routes`, `src/courses` | Dry-run test, PostgreSQL, rules emulator | 6.6 Add existing workspaces to courses |
| 6.7 | Tshewang | `backend/db/migrations`, `docs/db-schema.md`, `backend/openapi.yaml`, flags | Migrations on PostgreSQL, constraints | 6.7 Billing tables, API contract and billing_enabled |
| 6.8 | Tshewang | `backend/src/billing` | PostgreSQL: duplicate journal by the DB, retry after rejection, wrong amount, two concurrent approvals give one subscription, renewal from current end, audit rows; lecturer and collegeAdmin can't approve; lecturer can't buy | 6.8 Payment requests, approve and reject, with manual_mbob method interface |
| 6.9 | Kezang | `backend/src/billing`, `firestore.rules` | PostgreSQL: grace to read-only, seat limits. Rules: entitlements | 6.9 Subscription rules, seats and requireActiveSubscription |
| 6.10 | Tshewang | `backend/src/billing` | Unit, PostgreSQL: sequential numbers | 6.10 PDF receipts with sequential numbers |
| 6.11 | Sonam | `backend/routes`, `backend/src/billing` | Stubbed providers, PostgreSQL | 6.11 Count AI analyses and apply plan limits |
| 6.12 | Ngawang | `src/billing` | Banner and read-only tests; axe | 6.12 Lecturer plan status, banners and student message |
| 6.13 | Ngawang | `src/admin` | axe; Playwright: approve and reject journeys | 6.13 superAdmin console |
| 6.14 | Kezang | `src/admin`, `backend/src/billing` | Payment form tests, PostgreSQL scoping: own college only; axe; Playwright: collegeAdmin pays, assigns a seat | 6.14 collegeAdmin console, payment flow and seats |
| 6.15 | Tshewang | `backend/src/billing`, `src/` | Stubbed email; no emails in logs | 6.15 Billing notifications and expiry reminders |
| 6.16 | Sangay | `e2e/`, `docs/`, `.env.example` | All four Playwright journeys, axe on every screen, full CI | 6.16 End-to-end journeys, docs/billing.md and final checks |

## 6. How we prove it works

Required before a step counts as done, as in the brief.

1. **Real PostgreSQL:** duplicate journal refused by the database; two concurrent approvals give one subscription; renewal extends from the current end; grace then read-only; seat limits; collegeAdmin and lecturer can't approve; audit rows written.
2. **Firestore emulator:** non-enrolled student can't read a course, project or workspace; student can't read another group's workspace; lecturer can't read a workspace before submission.
3. **Playwright:** collegeAdmin pays, superAdmin approves, the college is active and a lecturer gets a seat; superAdmin rejects and the collegeAdmin sees the reason and resubmits; lecturer creates a course and project and a student joins by code and sees only their group; read-only disables create and marking buttons and export still works. These need the Auth and Firestore emulators, a new setup in CI.
4. **axe:** no serious or critical issues on any new screen.
5. **lint, unit tests, build and CI** green, with `.env.example` and `docs/billing.md` updated.
