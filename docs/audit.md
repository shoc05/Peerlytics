# Peerlytics repo audit

PEER-3 · 11 Oct 2026 · audit of `main` after PEER-2 was merged. No code was changed.

## 1. What exists

### Frontend (repo root: React 18, Vite 4, Tailwind, TipTap, Recharts)

| Area | Files | Notes |
|---|---|---|
| Routing | `src/App.jsx` | Only `/login`, `/signup`, `/dashboard`; everything else is tabs inside the dashboard |
| Dashboard shell | `src/components/peerlytics-app.jsx` (2.6k lines) | Tabs, groups, notifications, grading view; lazy-loads the panels below |
| Workspace and editor | `WorkspacePanel.jsx` (2k lines), `WorkspaceDrive.jsx`, `WorkspaceEditor.jsx`, `SheetsEditor.jsx`, `SlidesEditor.jsx`, `Toolbar.jsx` | TipTap docs, simple sheets and slides, autosave, versions, paste tracking, presence, submit, auto-submit |
| Lecturer and admin | `AnalyticsPanel.jsx`, `ReportsPanel.jsx`, `ReportCard.jsx`, `AdminPanel.jsx` | Contribution charts, AI reports, grade override with reason, CSV export, read-only admin audit |
| Other panels | `CalendarPanel.jsx`, `StoragePanel.jsx`, `ProfilePanel.jsx` | Deadline calendar, storage, profile |
| Auth | `Login.jsx`, `Signup.jsx`, `ProtectedRoute.jsx`, `GuestRoute.jsx`, `FirebaseGate.jsx`, `context/AuthContext.jsx`, `firebase/authService.js` | Email and password only |
| Logic | `utils/behaviorGrade.js`, `utils/scoring.js`, `utils/pasteDetection.js`, `utils/difficultyDetection.js` | Grade engine, roster helpers, paste and difficulty detection |

### Firebase

| Part | How it is used |
|---|---|
| Auth | Email and password. The role (`student`, `lecturer`, `admin`) is a field in `users/{uid}` that the user picks at sign-up. No custom claims. |
| Firestore | Every read and write goes through `src/firebase/firestoreService.js`. Collections: `users`; `groups/{id}` with `folders`, `files`, `versions`, `activity`, `pasteEvents`, `grades`, `notifications`, `presence`; plus `documents`, `reports`, `submissions`, `analytics`. |
| Rules | `firestore.rules` checks group membership. Lecturers can read a workspace only after a submission (`submittedToLecturers`). Admins get read-only access. |
| Hosting | Not configured. `firebase.json` only deploys rules and indexes. |

### Backend (`backend/`, Express 4)

| Route | What it does |
|---|---|
| `GET /api/health` | Liveness check |
| `POST /api/check` | Submission analysis. Calls Hugging Face (Llama 3.1 asked to rate AI likelihood) and Virtual Writing Tutor (grammar) in parallel. "Plagiarism" is pasted characters divided by total characters. Builds the report. |
| `POST /api/analyze` | The same two providers, without building a report |
| `GET /api/check/health` | Liveness check for the check route |
| Cron (`reminderService.js`) | Every 15 minutes, emails offline members whose deadline is near. Needs `FIREBASE_SERVICE_ACCOUNT` and SMTP settings, otherwise stays dormant. |

All routes share an in-memory limit of 20 requests a minute per IP. No route checks who is calling.

### Scripts, workflows and root files

| File | What it is |
|---|---|
| `scripts/fix-peerlytics.cjs`, `migrate-dashboard-auth.cjs`, `migrate-workspace-firebase.cjs`, `patch-analytics.js`, `patch-analytics2.cjs`, `patch-workspace.js` | One-off codemods that rewrote `peerlytics-app.jsx` and `WorkspacePanel.jsx` during earlier refactors. No longer used. |
| `scripts/setup-github.sh` | Step 0.2 GitHub settings script (PR #1, not merged yet) |
| `.github/workflows/github-actions-demo.yml` | GitHub's quickstart demo. Runs on every push and checks nothing. |
| `.github/workflows/ci.yml`, `pr-title.yml` | Added in PR #1 (not merged yet): website lint, test and build; backend checks; Jira key in PR title |
| `peerlytics-app.jsx` (root) | Old standalone prototype with hard-coded sample members. Nothing imports it. |
| `peerlytics-demo.html` | A broken 2.5 KB fragment of that prototype. Not served. |

## 2. Problems

| # | Problem | Where | Severity |
|---|---|---|---|
| 1 | Any user can change their own `role` to `lecturer` or `admin`, because updates to your own profile are unrestricted. Sign-up also lets anyone choose `lecturer`. | `firestore.rules` (`match /users`), `Signup.jsx` | High |
| 2 | Any group member can update a report, so a student can edit their own AI analysis after submitting | `firestore.rules` (`match /reports`, `allow update`) | High |
| 3 | The grade is computed in the browser and written by the client | `WorkspacePanel.jsx` calling `behaviorGrade.js` | High |
| 4 | Backend routes are unauthenticated, so anyone can use up the Hugging Face and VWT quota | `backend/server.js` | Medium |
| 5 | Paste events store up to 20,000 characters of the pasted text. This conflicts with "never record keystroke contents" unless the privacy notice covers it. | `firestoreService.js` (`savePasteEvent`) | Medium |
| 6 | `taskCompletion` is not real task data. It goes up by 2 on every activity. | `firestoreService.js` (`bumpMemberActivity`) | Medium |
| 7 | Hard-coded sample data in the root prototype (`Pema Choden`, `CS101-Group1`, and others) | `peerlytics-app.jsx`, `peerlytics-demo.html` | Low (unused; delete) |
| 8 | Unused Firebase console snippet with the web config written inline | `src/firebase/firebase.js` | Low (the web API key is public by design; delete the file) |
| 9 | No `.env.example`, although the README says to copy it | repo root | Low |
| 10 | Stale docs and comments. The README says `projects` (the code uses `groups`) and mentions EyeSift. `check.js` mentions GPTZero. Comments mention OpenAI, which is never called. | various | Low |
| 11 | No ESLint or Prettier config | repo root | Low |
| 12 | One JavaScript bundle chunk is over 500 KB (Vite warning) | build | Low |

No secret files are tracked in git, now or in history. `.env` and `serviceAccountKey.json` are git-ignored.

**Build and tests:** `npm install` works. `npm run build` works, taking about 50 seconds with only a chunk-size warning. `npm test` passes all 14 tests after PEER-2.

## 3. Features against the Peerlytics rules

| Feature | Status | Notes |
|---|---|---|
| Google sign-in | Missing | Email and password only |
| Four roles as custom claims, checked by the backend | Missing | Three roles in a Firestore field; the backend checks nothing |
| College, course, assignment, group | Missing | Only groups (`groups/{id}`); no colleges, courses or join codes |
| Course site with tabs | Missing | |
| Lecturers see a workspace only after submission | Done | Enforced in the rules and the UI |
| Real-time co-editing (Yjs + Hocuspocus) | Missing | Firestore autosave plus presence; the last write wins |
| Document tabs and sub-tabs | Missing | |
| Server-side deadlines and auto-submit | Partly done | Auto-submit runs only in an open browser tab. The server only sends reminder emails. |
| Deadline extensions | Missing | |
| OpenAI analysis with HF + VWT as backup (`ai_provider` flag) | Partly done | Hugging Face and VWT only; no OpenAI and no flag |
| Analysis called from the backend | Done | The browser calls `/api/check`; provider keys stay on the server |
| Hugging Face or VWT keys exposed to the browser | Not exposed | Only `VITE_FIREBASE_*` and `VITE_API_URL` reach the browser |
| `analysis_results` write-once | Missing | Group members can update reports (problem 2) |
| Lecturer override stored with who, when and why | Partly done | Stored in `groups/{id}/grades` with the lecturer and reason, but each decision overwrites the previous one |
| Grade = Time, Edits, Writing, Tasks with a per-assignment rubric | Partly done | `behaviorGrade.js` uses a writing base minus penalties; no rubric weights; Tasks are not real |
| Group tasks | Missing | |
| Penalties only for the responsible student | Done | Grades are per member |
| "AI is a signal, not proof" in the UI | Done | Shown in the report and the lecturer note |
| CSV grade export | Done | `ReportsPanel.jsx` |
| XML / XSLT | Missing | |
| PostgreSQL | Missing | All data is in Firestore |
| Feature flags (Remote Config) | Missing | |
| Offline editing | Missing | Only an offline banner |
| Push notifications | Missing | In-app notifications in Firestore only; email reminders are optional |
| CSV invite, random groups | Missing | Invites are by email, one at a time |
| .docx export | Missing | |
| Inline feedback, peer evaluation, course dashboard | Missing | |
| Privacy notice | Missing | No `docs/privacy-notice.md` |
| Zod / Ajv validation | Missing | The backend only checks text length |
| No mock data in the app | Done | Apart from the unused root prototype (problem 7) |
