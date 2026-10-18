# Peerlytics repository audit and gap report

PEER-3 · 12 Oct 2026, completed in PEER-5 on 14 Oct 2026 · Sangay Tshokyee Tshering (project lead)

Audited: branch `peer-3-claude-md-audit`, based on `main` at commit 26b3311 (after PEER-2 was merged). No application code, workflows or dependencies were changed for this audit.

Jira: the real project key is **PEER** (team-managed Scrum project, live since 13 Oct). Branch names, commits and PR titles use `PEER-<n>`, and CI's Jira key check enforces it.

**Update 13 Oct:** PR #1 has since been merged, so CI runs on every PR. `scripts/setup-github.sh` has been run: `develop` exists; `develop` and `main` require a PR, 1 approval and the three CI checks; `main` also needs the code owner; `v*` tags are admin-only; `staging` deploys from `develop` and `production` from `v*` tags with Sangay's approval. Only the PostgreSQL secrets are set so far. The settings are written up in `scripts/github-setup.md`.

**Update 14 Oct:** step 0.5 (PEER-4, Tshewang) is merged into `develop`: ESLint for both packages, a first backend test, Firestore rules tests on the emulator, and the Jira check moved to `jira-check.yml` with the same job name. `firestore.rules` itself has not changed, so every rules finding below still stands. Sections 1 and 2 describe the code as audited on 12 Oct; sections 4 to 7 were added on 14 Oct.

## Executive summary

Peerlytics today is a working Firebase prototype: a React + TipTap editor, Firestore for all data, email and password sign-in, and a small Express backend that runs Hugging Face and Virtual Writing Tutor analysis. Most of the target system in `CLAUDE.md` is still planned: PostgreSQL, OpenAI, Yjs, the college and course hierarchy, feature flags, Docker, staging, monitoring and backups do not exist yet.

The biggest risk is trust, not missing features. The Firestore rules let a signed-in user make themselves a lecturer or admin, add themselves to any group as its lecturer, and edit their own AI report, submission and effort numbers. Grades are then computed in the browser from those editable inputs. These are fixable in `firestore.rules` (step 1.8) before the rebuild, and should be fixed first.

On 14 Oct two new findings were added: the lecturer's "View submitted file" window renders student HTML unsanitised (a stored XSS, High), and the reminder job wrote student email addresses to the server log (Medium, fixed in PEER-5 by masking them).

The engineering base is now in place: CI with lint, unit tests and rules tests on every PR, branch protection, environments, and 21 passing unit tests (14 frontend, 7 backend). Next: the rules lock-down, then roles and backend auth, then PostgreSQL and the course hierarchy (section 6).
**Update 13 Oct:** PR #1 has since been merged, so `ci.yml` and `pr-title.yml` now run on every PR. `scripts/setup-github.sh` has been run: `develop` exists; `develop` and `main` require a PR, 1 approval and the three CI checks; `main` also needs the code owner; `v*` tags are admin-only; `staging` deploys from `develop` and `production` from `v*` tags with Sangay's approval. Only the PostgreSQL secrets are set so far. The CI rows below describe the state on 12 Oct.

**Status values:** Done, Partial, Missing, Blocked. The Evidence column also says what *kind* of thing exists:

- **Implemented:** working code with a real data path.
- **UI only:** a screen or label with no real data or enforcement behind it.
- **Planned only:** described in `CLAUDE.md` or the team guide, with no code.
- **Not verifiable:** it can't be checked from the repo, for example a hosted service.

## 1. The real system

| Layer | What is actually there | Evidence |
|---|---|---|
| Frontend | React 18 + Vite 4 SPA, Tailwind 3, TipTap 2 editor, Recharts, React Router 6 | `package.json`, `vite.config.js`, `src/` |
| Routing | Three routes only: `/login`, `/signup`, `/dashboard`. Everything else is tabs inside `src/components/peerlytics-app.jsx` (2,616 lines). | `src/App.jsx` |
| Backend | Express 4 on Node, 3 endpoints, no auth, in-memory rate limit (20 requests/min per IP), optional node-cron email reminders | `backend/server.js`, `backend/routes/*`, `backend/services/*` |
| Database | Cloud Firestore only. **No PostgreSQL, no migrations, no SQL.** | `src/firebase/firestoreService.js`, `firestore.rules`, `firestore.indexes.json` |
| Auth | Firebase Auth, email and password only. Role is a plain field in `users/{uid}` that the user picks at sign-up. No custom claims. | `src/firebase/authService.js`, `src/components/Signup.jsx`, `src/context/AuthContext.jsx` |
| Collaboration | Not real-time. Each editor autosaves HTML to `documents/{fileId}`; presence docs show who is in a file; the last write wins. **No Yjs or Hocuspocus.** | `WorkspacePanel.jsx`, `firestoreService.js` (`saveDocumentContent`, `savePresence`) |
| AI analysis | Hugging Face router (a Llama 3.1 chat model asked to rate AI likelihood) and Virtual Writing Tutor (grammar), called from the backend. **No OpenAI.** | `backend/services/huggingFaceService.js`, `vwtService.js`, `routes/check.js` |
| Grading | Computed **in the browser** by `src/utils/behaviorGrade.js`, from report and analytics documents | `WorkspacePanel.jsx:866-884`, `peerlytics-app.jsx:697-704` |
| Hosting and deploy | None in the repo. `firebase.json` only deploys Firestore rules and indexes. No Dockerfile, compose, k8s or Hosting config. A comment mentions Render. | `firebase.json`; `git ls-files` shows no Docker or infra files |
| CI | `main` has only GitHub's demo workflow. `ci.yml` and `pr-title.yml` are in open PR #1. A Snyk GitHub app reports on PRs ("No manifest changes detected"). | `.github/workflows/`, checks on PRs #1 to #3 |
| Config | One root `.env` for both packages; **no `.env.example`** (the README says to copy it) | `backend/server.js:8`, `src/firebase/config.js` |

### Check results (12 Oct 2026, Windows, Node 22.21)

| Command | Result |
|---|---|
| `npm test` (frontend, `node --test`) | 14 tests, 14 pass, 0 fail. The tests cover only `behaviorGrade.js` and `scoring.js`. |
| `npm run lint` | Fails with "Missing script: lint". No ESLint or Prettier is configured. |
| `npm run build` | Passes in 21 s. Warnings: a chunk over 500 kB, and `config.js` and `firestoreService.js` are both statically and dynamically imported, so the code split does nothing. |
| Backend `node --check` on all 8 tracked `.js` files | Pass |
| Backend `npm test` | No test script. **The backend has no tests.** |
| Firestore rules tests | None. No emulator test setup exists. |

### Check results (14 Oct 2026, Windows, Node 22.21, branch `feature/0.4-setup-and-audit`)

| Command | Result |
|---|---|
| `npm run lint` (frontend) | Passes: 0 errors, 13 warnings |
| `npm test` (frontend) | 14 tests, 14 pass |
| `npm run build` | Not rerun; no frontend code changed since 12 Oct |
| `cd backend && npm run lint` | Passes, no problems |
| `cd backend && npm test` | 7 tests, 7 pass (report generator 2, email masking 5) |
| `npm run test:rules` | **Blocked locally:** the Firestore emulator download timed out on this network. The same 4 rules tests passed in CI on PR #8 ("Firestore rules tests"). They cover member reads, outsider denial, the lecturer unlock and immutable versions; none of the Critical or High rules findings below is tested yet. |

## 2. Requirement-by-requirement gap table

Owners follow the phase split in the team guide. Phase 1 is Kezang (roles, deadlines, PostgreSQL). Phase 2 is Sonam (courses, analysis, grading). Phase 3 is Tshewang (security, CI, scans). Phase 4 is Ngawang (privacy, polish, staging). Release work is Sangay's.

| Requirement | Current implementation and path | Status | Evidence or test result | Risk if left unfinished | Recommended next action | Owner |
|---|---|---|---|---|---|---|
| Four roles: superAdmin, collegeAdmin, lecturer, student | Three roles (`student`, `lecturer`, `admin`) stored in `users/{uid}.role`; the user picks student or lecturer at sign-up; `admin` is set by hand | Partial | **Implemented** for three roles. `firestore.rules:80-82` lets a user update their own profile with no field limits, so **any user can set `role: 'admin'` or `'lecturer'`**. `Signup.jsx:106-110` offers a lecturer radio button to anyone. | Any student can read every group as admin, or act as a lecturer and write grades | Move roles to Firebase custom claims, set by a backend admin endpoint; block `role` in the users update rule now | Kezang |
| Backend checks the role on every request | None. `/api/check` and `/api/analyze` accept any caller. | Missing | **Implemented:** no auth middleware in `backend/server.js`. CORS defaults to reflecting any origin (`origin: process.env.CORS_ORIGIN \|\| true`). | Anyone can spend the Hugging Face and VWT quota and generate reports | Add Firebase ID-token verification middleware; set `CORS_ORIGIN` explicitly | Kezang |
| College, course, assignment, group hierarchy | Only `groups/{groupId}` (the "workspace"). A group has a name, `deadline`, `memberIds` and `lecturerIds`. | Missing | **Planned only.** No college, course or assignment collections or tables. `createProjectGroup` in `firestoreService.js:84`. | Every later feature (course tabs, rubrics, licensing) has nowhere to attach | Design the PostgreSQL schema first, then map groups under assignments | Kezang (schema), Sonam (UI) |
| Course tabs and join codes | None | Missing | **Planned only.** No join code or course in `src/`. Students join only by email invite (`inviteMemberByEmail`). | No way for a class to self-enrol | Build after the hierarchy exists | Sonam |
| Secure submission | `createWorkspaceSubmission` / `saveFullSubmission` write the submission, report and grade inputs from the browser | Partial | **Implemented** but client-trusted. `firestore.rules:248-253` lets the author **update their own submission after submitting**. `rules:222-226` lets any group member **update any report**. Nothing locks `documents` or `files` after submission (`rules:132-136, 199-212`). | Students can change submitted work, their AI report and their grade inputs after the deadline | Make reports and submissions immutable in the rules now; move submission to a backend endpoint later | Tshewang (rules), Sonam (endpoint) |
| Server-enforced deadlines | The deadline is a field on the group. Auto-submit runs in the open browser tab 30 minutes before. The server only emails reminders. | Partial | **Implemented in the browser only:** `WorkspacePanel.jsx:419-440`, `CalendarPanel.jsx:40`. `firestore.rules:112-120` lets any member update the group, **including `deadline`**. | A student with the tab closed is never auto-submitted; any member can move the deadline | Block `deadline` edits by students in the rules; add a server job that locks work at the deadline | Kezang |
| Lecturer sees a workspace only after submission | `submittedToLecturers` gate in the rules and UI | Partial | **Implemented**, but `firestore.rules:112-120` lets *any signed-in user* add themselves to `lecturerIds` and `submittedToLecturers`. With a self-set lecturer role, that opens any group whose ID is known. | Workspace content leaks before submission | Only let the backend (Admin SDK) set `lecturerIds` and `submittedToLecturers` | Tshewang |
| Real-time collaboration | Firestore autosave + presence; last write wins | Missing | **Implemented** as autosave only. No Yjs, Hocuspocus or `collab/`. | Two students typing at once overwrite each other | Build `collab/` (Hocuspocus) behind a feature flag | Sonam |
| Optional offline editing | Offline banner only | Missing | **UI only:** `peerlytics-app.jsx:176-183` listens for `online` and `offline`; no Firestore persistence or service worker | Work typed offline is lost | Keep behind a disabled flag until Yjs exists | Tshewang |
| Contribution tracking | Edits and time in `analytics/{groupId}/members/{uid}`; activity feed | Partial | **Implemented**, but `firestore.rules:188-194` lets each user **update their own analytics entry**. Grades read `edits` and `timeSpent` from it. `taskCompletion` goes up by 2 on every activity (`firestoreService.js:315`), so it is not task data. | Students can inflate their own effort metrics; the Tasks score is fake | Write metrics from the backend only; drop the fake `taskCompletion` | Sonam |
| Paste events | `groups/{id}/pasteEvents`, classified by `utils/pasteDetection.js`; write-once in the rules | Partial | **Implemented.** Create only, no update or delete (`rules:150-157`). But `savePasteEvent` stores up to **20,000 characters of the pasted text** (`firestoreService.js:330`). | Conflicts with the "never record content" rule unless the privacy notice says so | Decide: store length and hash only, or disclose it in the privacy notice | Ngawang |
| Analysis only on the backend | `/api/check` calls Hugging Face and VWT server-side | Partial | **Implemented** for HF + VWT; the keys are only in backend env, and only `VITE_FIREBASE_*` and `VITE_API_URL` reach the browser. **OpenAI is planned only**, and there is no `ai_provider` flag. The browser then writes the report itself. | Without OpenAI, analysis quality is limited; client-written reports can be forged | Backend writes the report to the database; add an OpenAI provider behind `ai_provider` | Sonam |
| Immutable raw analysis | `reports/{id}` in Firestore | Missing | **Implemented** as mutable: any group member can update (`rules:225-226`), lecturers can delete (`rules:227`) | Analysis results can be edited, so grades are not trustworthy | Firestore: `allow update: if false`. Later: a PostgreSQL `analysis_results` table with an UPDATE/DELETE trigger. | Tshewang (rules), Kezang (trigger) |
| Separate lecturer overrides | `groups/{id}/grades/{memberId}` holds grade, suggested grade, reason, lecturer, time | Partial | **Implemented**, but each override **overwrites** the last (`setDoc`, `firestoreService.js:748`); there is no history | No audit trail of who changed a grade, or when | Append-only overrides table or collection | Sonam |
| Rubrics | Fixed formula; only `timeCapMinutes` is per group | Missing | **Planned only.** `behaviorGrade.js` uses a writing base minus penalties; no weights | Lecturers cannot set marking criteria | Add per-assignment weights with server-side grading | Sonam |
| Group tasks | None | Missing | **Planned only.** "% tasks" in the UI shows the fake counter. | The Tasks part of the grade is meaningless | Build tasks, then compute Tasks from them | Sonam |
| Grading | `behaviorGrade.js`, unit-tested (14 tests) | Partial | **Implemented and tested**, but computed in the browser from student-writable inputs (rows above) | A grade can be manipulated by editing its inputs | Run the same function on the backend from locked inputs | Sonam |
| Reports | AI report card, reports panel, lecturer note | Done (UI) | **Implemented:** `ReportCard.jsx`, `ReportsPanel.jsx`; shows "AI is a signal" text | Only as trustworthy as the data (rows above) | Keep; switch the data source once reports are locked | Sonam |
| Exports | CSV grade export | Partial | **Implemented:** `ReportsPanel.jsx:99-109`. No XML/XSLT, no .docx. | Missing course deliverables (XML/XSLT) | Add XML/XSLT; .docx behind a flag | Sonam (XML), Ngawang (.docx) |
| Privacy notice | None | Missing | **Planned only.** No `docs/privacy-notice.md`, no in-app page | Tracking students without a notice; a likely judging and ethics issue | Write the notice from what the code actually records | Ngawang |
| Data deletion | None usable | Missing | `deleteUserProfile` exists but is never called, and `rules:87` (`allow delete: if false`) would block it. Any member can delete a whole group (`rules:122-125`), but subcollections stay. | No way to honour a deletion request; students can wipe a group's workspace | Add a backend deletion endpoint (Admin SDK); stop students deleting groups | Ngawang |
| Role-specific access | Firestore rules per collection | Partial | **Implemented**, with the gaps above. Also: any signed-in user can **read every user profile, including emails** (`rules:74`), and **create notifications for any user** (`rules:91`). Reports with `groupId == null` are readable by everyone (`rules:216`). | Personal data exposure; spoofed notifications | Tighten the rules and add emulator rule tests | Tshewang |
| No mock or seed data in the app | The app has none; the unused root prototype does | Done | `src/` has no sample data. Root `peerlytics-app.jsx:22-39` has hard-coded members (`Pema Choden` and others) and files, but nothing imports it. | Someone may wire the old file in by mistake | Archive the root prototype (section 3.4) | Sangay |
| Safe rendering of student HTML | Two places set raw HTML: the lecturer's file viewer and the AI report's document view | Partial | **Checked 14 Oct.** `ReportCard.jsx:182` is safe: `injectHighlightsIntoHtml` strips every tag (`highlightHelpers.js:27-33`) and escapes the text and author names (`escapeHtml`, lines 11, 82-99) before adding highlight spans. `peerlytics-app.jsx:1179` is **not** safe: it renders `fileViewer.html`, the stored document HTML from `documents/{fileId}`, with no sanitiser. Finding S3. | A student can run script in the lecturer's browser | Sanitise with DOMPurify, or reuse the report card's strip-and-escape path (step 3.4) | Ngawang |
| Personal data in server logs | The reminder job logs each email it sends or fails to send | Done (14 Oct) | **Fixed in PEER-5:** `reminderService.js` now logs `maskEmail(email)`, for example `s****@rub.edu.bt`, and masks any address inside SMTP error text (`backend/services/maskEmail.js`, 5 tests). Other backend logs print only config names and error messages. Finding S9. | Student emails in hosting logs | Keep using `maskEmail` when the reminders move to `notifier/` (step 2.5) | Sangay |
| Exposed secrets | None found | Done | No secret files tracked now or in history. `.env` and `serviceAccountKey.json` are git-ignored. `src/firebase/firebase.js` contains the Firebase **web** config, which is public by design. | Low | Add `.env.example` with names only | Tshewang |
| Feature flags | None | Missing | **Planned only.** No Remote Config in `src/`. | Unfinished features can't be shipped dark | Add a small flag reader (Remote Config) before Phase 2 features land | Ngawang |
| Security scans | Snyk GitHub app on PRs | Partial | **Not verifiable** from the repo. A Snyk check appears on PRs; no `security.yml`; no code, image or IaC scans | Vulnerable packages go unnoticed | Add a `security.yml` workflow | Tshewang |
| CI | `ci.yml` (website, backend, Firestore rules tests) and `jira-check.yml` on every PR | Done | Merged in PR #1 and PR #8; all jobs green on PR #8. Branch protection requires 3 of the 4 checks | Rules tests not yet required | Rerun `scripts/setup-github.sh` so "Firestore rules tests" becomes required; add the remaining secrets as accounts are created | Sangay |
| CI | Demo workflow on `main`; real CI in open PR #1 | Partial | PR #1 ran: backend pass, Jira key pass, website pass after PEER-2 | Merges are not gated on tests | Done 13 Oct: PR #1 merged and `scripts/setup-github.sh` run. Next: add the remaining secrets as accounts are created | Sangay |
| Staging | None | Missing | **Planned only.** No Docker, k3s or deploy workflow. | No safe place to test before production | Dockerfiles, then a k3s staging deploy from `develop` | Ngawang |
| Monitoring | Console logs only | Missing | **Planned only.** No Prometheus, Grafana or Uptime Kuma config. | Outages go unnoticed | Health endpoint exists; add uptime checks first | Kezang |
| Backups | None | Missing | **Planned only.** No Firestore export or database dump job | Data loss cannot be recovered | Scheduled Firestore export, then a PostgreSQL dump with a restore drill | Kezang |
| Rollback | None | Missing | **Planned only.** No versioned deploys or tags | A bad release can't be undone quickly | Tag releases (`v*`) and deploy images by tag | Tshewang |
| Hosting | Unknown | Blocked | **Not verifiable.** No Hosting config in the repo; a server comment mentions Render. Where the live app runs needs confirming with the team. | The deploy steps in the guide can't be checked | Confirm the current host, then add `hosting` to `firebase.json` | Tshewang |

## 3. Priorities

### 3.1 Release blockers

These could expose data, produce wrong grades or break submissions. Every one of them except the last is a Firestore rules or trust problem. Most can be fixed in `firestore.rules` alone, before the larger rebuild. Section 4 ranks them, together with the XSS finding added on 14 Oct.

1. **Self-promotion to admin or lecturer.** The users update rule has no field limits (`rules:80-82`), and sign-up offers a lecturer option.
2. **Self-granted lecturer access to any group.** The group update rule lets any user add themselves to `lecturerIds` and `submittedToLecturers` (`rules:112-120`).
3. **Editable analysis and submissions.** Reports can be updated by any member, and submissions by their author, after submitting (`rules:225-226, 248-253`). Documents and files are not locked after submission.
4. **Student-writable grade inputs.** Students can update their own analytics (`rules:188-194`), and the grade is computed in the browser from it. `taskCompletion` is a fake counter.
5. **Any member can move the deadline or delete the group** (`rules:112-125`).
6. **Unauthenticated analysis API with open CORS** (`backend/server.js`).
7. **Every user's profile and email is readable by any signed-in user** (`rules:74`), and anyone can create notifications for anyone (`rules:91`).
8. **No tests for the rules or the backend.** None of the fixes above can be proven without Firestore emulator tests. *14 Oct: the test setup now exists (PR #8), but none of these cases is tested yet.*
9. **Stored XSS in the lecturer's file viewer** (`peerlytics-app.jsx:1179`), added 14 Oct.

### 3.2 Critical for the minimum viable release

1. Roles as custom claims, plus backend token checks (Kezang).
2. Locked submission: a backend endpoint writes the report, submission and grade inputs. Rules make them read-only for clients (Sonam, Tshewang).
3. A server-side deadline job that locks work and auto-submits (Kezang).
4. Server-side grading from locked inputs, plus append-only overrides (Sonam).
5. The college, course, assignment and group hierarchy with join codes. Without it, a class can't enrol (Kezang, Sonam).
6. A privacy notice that matches what is recorded, and a data deletion path (Ngawang).
7. `.env.example` and a lint config (Tshewang). CI and branch protection were done on 13 Oct.
8. A deployable build: Docker plus staging, and a confirmed host (Ngawang, Tshewang).

### 3.3 Can stay behind a disabled feature flag

These are safe to ship off, provided the flag system exists first:

- Real-time co-editing with Yjs. Today's autosave keeps working while the flag is off.
- Document tabs and sub-tabs.
- Offline editing.
- Push notifications. In-app notifications and email reminders already exist.
- CSV invite and random groups. Email invites work.
- .docx export.
- Licensing and usage limits.
- The OpenAI provider. Hugging Face and VWT stay the default until it is tested. The `ai_provider` flag decides.

### 3.4 Duplicate or obsolete files to archive later

None of these were deleted in this issue.

| File | Evidence it is unused |
|---|---|
| `peerlytics-app.jsx` (repo root) | No import anywhere; `App.jsx` imports `src/components/peerlytics-app.jsx`. It contains hard-coded sample members and files (lines 22-39). |
| `peerlytics-demo.html` | A 2.5 KB fragment of the same prototype; not referenced by `index.html` or Vite |
| `src/firebase/firebase.js` | Never imported. `config.js` is the real initialiser. It is the Firebase console snippet with the web config inline, and it pulls in Analytics. |
| `src/hooks/useTheme.js` | Never imported. `useThemePreference.js` is used by Login, Signup, GuestRoute and ProtectedRoute. |
| `scripts/fix-peerlytics.cjs`, `migrate-dashboard-auth.cjs`, `migrate-workspace-firebase.cjs`, `patch-analytics.js`, `patch-analytics2.cjs`, `patch-workspace.js` | One-off codemods that rewrite `peerlytics-app.jsx` and `WorkspacePanel.jsx` with string replacement. They are not in any npm script or workflow, and running them now would corrupt the current files. |
| `.github/workflows/github-actions-demo.yml` | GitHub's quickstart demo. It runs on every push and checks nothing. Remove it once `ci.yml` is merged. |
| `deleteUserProfile` in `src/firebase/firestoreService.js:77` | Exported, never called, and blocked by the rules (`allow delete: if false`). Replace it with a backend deletion endpoint. |

Stale documentation that should be corrected later:

- The README says `projects`, but the code uses `groups`.
- The README mentions EyeSift, which was removed.
- `routes/check.js` mentions GPTZero.
- Comments in `scoring.js` and `behaviorGrade.js` mention OpenAI, which is never called.

## 4. Security and privacy findings, ranked

**How severity is set.** Two questions decide it: who can do it, and what it affects.

| Severity | Rule |
|---|---|
| Critical | Any signed-in user, with no special access, can gain privileges, read other groups' data, or change grades and analysis |
| High | A group member can tamper with grades or analysis, or personal data is exposed |
| Medium | Needs extra conditions, has limited impact, or breaks a privacy promise without an exploit |
| Low | Hygiene: no direct exploit path |

**Confidence** is labelled separately. *Confirmed by code reading* means the path was traced through the code and `firestore.rules`, but not exploited. No finding is "confirmed by test" yet, because no rules test covers them (section 1, 14 Oct results).

| ID | Severity | Finding | Evidence | Confidence | Fix and owner |
|---|---|---|---|---|---|
| S1 | Critical | Any user can make themselves `lecturer` or `admin` by editing their own profile | `firestore.rules:80-82` allows unrestricted updates of your own `users/{uid}`; `Signup.jsx:106-110` offers "lecturer" to anyone | Confirmed by code reading | Block `role` in the users update rule now (1.8, Kezang); move roles to custom claims (1.2, Kezang) |
| S2 | Critical | A signed-in user can add themselves to any group's `lecturerIds` and `submittedToLecturers`. With S1 that unlocks the workspace, reports and grades of any group whose ID they know | `firestore.rules:112-120` | Confirmed by code reading | Only the backend (Admin SDK) sets these fields (1.8, Kezang) |
| S3 | High | Stored XSS: "View submitted file" renders the student's document HTML unsanitised in the lecturer's browser. A student can write a `documents/{fileId}` body with a script-carrying tag directly through the Firestore SDK; it runs with the lecturer's session, for example to write grades | `peerlytics-app.jsx:1179` (`dangerouslySetInnerHTML={{ __html: fileViewer.html }}`), source set at `peerlytics-app.jsx:1789-1793`; `firestore.rules:203-209` let members write any `html` | Confirmed by code reading | Sanitise with DOMPurify or reuse the report card's strip-and-escape path (3.4, Ngawang; move it earlier) |
| S4 | High | Reports stay editable by any group member, and a submission by its author, after submitting | `firestore.rules:225-226`, `248-253`; `documents` and `files` are not locked after submission | Confirmed by code reading | Reports write-once, submissions locked (1.8, Kezang); backend submission endpoint (2.4, Sonam) |
| S5 | High | Students can change their own effort numbers, and the grade is computed in the browser from them | `firestore.rules:189-193`; `WorkspacePanel.jsx:866-884`; `taskCompletion` +2 per activity at `firestoreService.js:315` | Confirmed by code reading | Metrics written by the backend only (1.8, 2.8); grading on the server (2.8, Sonam) |
| S6 | High | Any member, including a student, can change the group deadline or delete the whole group | `firestore.rules:112-125` | Confirmed by code reading | Restrict `deadline` and delete to lecturers (1.8, Kezang) |
| S7 | High | Every signed-in user can read every user profile, including email addresses | `firestore.rules:74` (`allow read: if signedIn()`) | Confirmed by code reading | Read only profiles of people in your groups (1.8, Kezang) |
| S8 | Medium | The analysis API has no authentication and CORS reflects any origin, so anyone can spend the Hugging Face and VWT quota | `backend/server.js:42` and the routes | Confirmed by code reading | Token middleware, CORS allow-list (1.4, Tshewang) |
| S9 | Medium | The reminder job wrote student email addresses to the server log on every send and failure | `reminderService.js:183-184` before 14 Oct | Confirmed; **fixed in PEER-5** | Masked with `maskEmail` and `maskEmailsIn`; 5 unit tests (Sangay) |
| S10 | Medium | Any signed-in user can create notifications for any user, so notifications can be spoofed | `firestore.rules:91` | Confirmed by code reading | Only the backend or group members create them (1.8, Kezang) |
| S11 | Medium | Paste events store up to 20,000 characters of the pasted text | `firestoreService.js:330` | Confirmed | Keep and disclose it in the privacy notice, as the guide's step 4.5 plans, or store length only (4.5, Sangay) |
| S12 | Medium | Reports saved without a `groupId` are readable by every signed-in user | `firestore.rules:216` | Potential: no code path found that saves one, but the rule allows it | Require `groupId` on reports (1.8, Kezang) |
| S13 | Low | The reminder job remembers sent emails only in memory and sweeps 10 s after start, so a restart re-sends | `reminderService.js:39`, `:118` | Confirmed | Persistent sent-log in `notifier/` (2.5, Sangay) |
| S14 | Low | Unused files: the root prototype with sample members, and the Firebase console snippet with the (public) web config | Section 3.4 | Confirmed | Archive them (1.3, Ngawang) |
| S15 | Low | No `.env.example` | Repo root | Confirmed | Add it with names only (1.1, Sonam) |
| — | None | The AI report's document view (`ReportCard.jsx:182`) sets raw HTML but is safe: tags are stripped and text escaped first | `highlightHelpers.js:11-33, 82-99, 208-211` | Confirmed by code reading | Keep; add a test with a script tag when 3.4 lands |

## 5. External setup done by hand

None of these can be done from the repo. Secret values never go into code, chat or prompts; secret names are listed in `scripts/github-setup.md`.

| Service | What to set up | Needed for | Owner | Status 14 Oct |
|---|---|---|---|---|
| GitHub | Branch protection, rulesets, environments | Every PR | Sangay | Done (13 Oct) |
| GitHub | Rerun `scripts/setup-github.sh` so "Firestore rules tests" becomes required | 1.8 onwards | Sangay | Not done |
| GitHub secrets | VPS, OpenAI, Hugging Face, VWT, SMTP, Firebase service account, Snyk, Gitleaks | 1.9, 2.4, 2.5, 3.5 | Sangay | Only PostgreSQL set |
| Firebase console | Enable Google sign-in provider; add the staging and production domains to authorised domains | 1.2 | Kezang | Unknown |
| Firebase console | Deploy `firestore.rules` after every rules change (`firebase deploy --only firestore:rules`); the live rules may differ from the file | 1.8 | Kezang | Not verifiable from the repo |
| Firebase console | Create a service account key for the backend, notifier and collab | 2.5, 1.6 | Sangay | Not done |
| Firebase console | Remote Config parameters for every flag | 4.2 | Kezang | Not done |
| Firebase console | Cloud Messaging web push key (VAPID) | 3.8, 4.4 | Ngawang | Not done |
| Firebase Hosting | Decide where the frontend is hosted today and add `hosting` to `firebase.json` | 1.9 | Tshewang | Blocked: host unknown |
| Gmail (Peerlytics mailbox) | Two-step verification on, then a 16-character app password for `SMTP_PASS` | 2.5 | Sangay | Not done |
| Hugging Face | Access token for `HF_API_KEY` | Current analysis | Sonam | Unknown |
| Virtual Writing Tutor | API key for `VWT_API_KEY` | Current analysis | Sonam | Unknown |
| OpenAI | API key and a monthly spending limit | 2.4 | Sonam | Not done |
| VPS | Server, deploy user and SSH key (Ansible, 3.3), domain and DNS for staging, production and `status.` | 1.9, 4.3, 5.1, 5.5 | Sonam, Tshewang | Not done |
| Cloudflare | Turnstile site key and secret | 3.1, 3.4 | Tshewang | Not done |
| Snyk | Account, import the repo, turn on Snyk Code, token for `SNYK_TOKEN` | 3.5 | Tshewang | Snyk app reports on PRs; token not set |
| Gitleaks | Free licence for `GITLEAKS_LICENSE` | 3.5 | Tshewang | Not done |
| Jira | Site, PEER project, epics and work items (`jira-import.csv`), GitHub for Jira, one automation rule | Every step | Sangay | On hold |

## 6. Dependency order and parallel work

**Do first, in this order.** Each line needs the one before it.

1. **1.1 Tidy the backend** (Sonam). Others build on its routes, config and `/health`.
2. **1.2 Roles as custom claims, then 1.4 token middleware** (Kezang, Tshewang). Every protected route and the course API need them.
3. **1.5 PostgreSQL tables** (Sonam). Courses, assignments, analysis results, overrides, tasks and the audit log live there.
4. **2.1 Courses API** (Sonam), then **2.6 connect the course site** (Ngawang), **2.8 grading and tasks** (Sonam) and **2.5 notifier with assignment deadlines** (Sangay).
5. **0.6 Docker, then 1.9 staging** (Sonam, Tshewang). Needs the VPS secrets from section 5. Every phase demo runs on staging.
6. **4.1 Kubernetes, then 4.3 staging on k3s, then 5.1 production and 5.2 restore drill.**

**Can start now, in parallel.** None of these waits for anything.

- **1.8 Firestore rules lock-down and its tests** (Kezang). Fixes S1, S2, S4, S6, S7, S10 and S12 on today's app.
- **3.4 sanitise the file viewer** (Ngawang). Fixes S3; a small frontend change.
- 1.3 Google button and clean-up, 1.7 course site layouts (Ngawang).
- 4.5 privacy notice and data policy drafts (Sangay); they only describe what the code records.
- 2.5 notifier skeleton with the sent-log, `/health` and Dockerfile (Sangay); switch to assignment deadlines when 1.5 lands.

**Order problems in the guide to resolve.**

- **Feature flags come too late.** Flags are step 4.2, but flagged features start at 2.2. Until 4.2 lands, each flagged feature reads its flag from an env variable that defaults to off, and 4.2 replaces that with Remote Config.
- **Push before tokens.** Push (3.8) sends to tokens that Ngawang's 4.4 saves. Build 3.8 against `users/{uid}/fcmTokens` behind `push_enabled`, and test it end to end after 4.4.
- **Privacy notice before the screens that show it.** 4.5 must be merged before 4.8 (privacy screen) and 4.9 (data deletion), as the guide says.

## 7. Task list per person

Steps from the team guide in order, with the audit findings each one must close.

**Sangay** (owner and coordinator)
- 0.2 GitHub settings (done; rerun the script for the rules check), 0.3 CLAUDE.md (done), 0.4 audit (this PEER-5)
- 0.1 Jira import (on hold)
- 2.5 notifier service: sent-log fixes S13, keep `maskEmail` (S9)
- 3.8 push notifications behind `push_enabled`
- 4.5 privacy notice and data policy: disclose S11
- 1.10, 2.11, 3.11, 4.10 sign-offs; 5.4 acceptance test; 5.7 release v1.0
- Report: introduction, method, conclusion, final merge

**Kezang** (Phase 1)
- 1.8 Firestore rules and tests first: S1, S2, S4, S6, S7, S10, S12, each with a failing-then-passing rules test
- 1.2 Google sign-in and custom-claim roles (S1)
- 1.6 server-side deadlines and auto-submit
- 2.2 Yjs, 2.3 document tabs data, 3.2 offline, 3.6 CSV invite and email domains
- 4.2 feature flags, 4.6 extensions and inline feedback, 5.3 monitoring, 5.5 status page

**Sonam** (Phase 2)
- 1.1 tidy the backend and `.env.example` (S15), 0.6 Docker
- 1.5 PostgreSQL with the write-once `analysis_results` trigger
- 2.1 courses API and `backend/openapi.yaml`
- 2.4 OpenAI analysis with a backend submission endpoint (S4)
- 2.8 grading on the server, real tasks, rubric, CSV (S5); 2.10 XML/XSLT
- 3.3 Ansible and Postman, 3.7 random groups and peer evaluation, 4.1 Kubernetes, 4.7 course comparison, 5.2 restore script

**Tshewang** (Phase 3)
- 0.5 first workflows (done, PEER-4)
- 1.4 token middleware, Helmet and CORS allow-list (S8)
- 1.9 staging deploy, 2.7 analysis limits
- 3.1 security features and audit log, 3.5 security scans
- 3.10 usage data, 4.3 staging on k3s, 4.9 data deletion, 5.1 production deploy, 5.5 restore-drill workflow
- Confirm the current host (section 5)

**Ngawang** (Phase 4)
- 3.4 sanitise editor HTML in the file viewer first (S3), then the rest of 3.4
- 1.3 Google button, audit clean-up, archive unused files (S14)
- 1.7 and 2.6 course site, 2.9 task board and report buttons
- 3.9 admin dashboard and tabs panel, 3.10 rubric editor and random groups
- 4.4 polish, Word export, push permission; 4.8 privacy screen, dashboards, E2E; 5.6 slides
