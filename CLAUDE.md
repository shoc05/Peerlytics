# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install && (cd backend && npm install)   # two separate packages: root (frontend) and backend/
npm run dev            # Vite dev server on :3000, proxies /api to :5000
npm run dev:server     # Express API on :5000 (or: cd backend && npm run dev for --watch)
npm run lint           # ESLint checks for the frontend
npm test               # node:test, runs src/**/*.test.js (no Jest/Vitest)
npm run test:rules     # Firestore rules tests in the local emulator
cd backend && npm test # backend node:test suite
cd backend && npm run lint
node --test src/utils/scoring.test.js                                  # one file
node --test --test-name-pattern="high AI alone" src/utils/scoring.test.js   # one test
npm run build          # vite build -> dist/
firebase deploy --only firestore:rules,firestore:indexes   # see DEPLOY-FIREBASE.md
```

CI (`.github/workflows/ci.yml`) runs frontend and backend lint/tests, builds the frontend, and tests Firestore rules in the emulator. Its job names are required status checks used by `scripts/setup-github.sh`, so renaming a job breaks branch protection. `.github/workflows/jira-check.yml` checks the required PEER key prefix without connecting to Jira or requiring Jira credentials.

Config: a single `.env` at the repo root serves both packages. Vite reads `VITE_*` (Firebase web config, `VITE_API_URL`); `backend/server.js` explicitly loads `../.env` for `HF_API_KEY`, `VWT_API_KEY`, `PORT`, `CORS_ORIGIN`, `FIREBASE_SERVICE_ACCOUNT`, `SMTP_*`. There is no `.env.example` yet.

## Architecture (current code)

**Frontend shell.** `src/App.jsx` has only three routes: `/login`, `/signup`, `/dashboard`. Everything after login lives in one large component, `src/components/peerlytics-app.jsx`, which switches between tabs and lazy-loads the heavy panels (`WorkspacePanel`, `WorkspaceDrive`, `AnalyticsPanel`, `ReportsPanel`, `AdminPanel`, ...). `FirebaseGate` shows a setup screen when the `VITE_FIREBASE_*` vars are missing; `AuthContext` loads the user's Firestore profile and exposes `isLecturer` / `isStudent` / `isAdmin` from `users/{uid}.role`.

**Data access.** All Firestore reads and writes go through `src/firebase/firestoreService.js` (initialised lazily in `src/firebase/config.js`). Components should call its functions rather than the Firestore SDK directly. The workspace/group collection is `groups/{groupId}` (README still says `projects`), with subcollections `folders`, `files`, `versions`, `activity`, `pasteEvents`, `grades`, `notifications`, `presence`. Top-level: `users`, `documents` (bodies), `reports`, `submissions`, `analytics/{groupId}/members`. Access control, including "lecturers see a workspace only after a submission" (`submittedToLecturers`), is enforced in `firestore.rules`, so data-model changes usually need a rules change too.

**Submission flow.** `WorkspacePanel.jsx` owns the editor session: TipTap editing, paste classification (`utils/pasteDetection.js`), difficulty (`utils/difficultyDetection.js`), and the browser-side auto-submit 30 minutes before the deadline. On submit it calls `submitForCheck` in `src/services/api.js` -> `POST /api/check`. The backend runs Hugging Face AI detection and Virtual Writing Tutor grammar in parallel (`backend/services/*`), derives "plagiarism" from the paste events, and returns a report built by `reportGenerator.js`. The browser then computes the grade with `utils/behaviorGrade.js` and writes report + submission to Firestore.

**Graceful degradation is deliberate.** Every provider returns `{ available:false, reason }` instead of throwing, and `submitForCheck` returns an "AI evaluation unavailable" report if the backend is unreachable. A submission must never fail because analysis failed. Keep this contract when touching analysis code.

**Grading.** `utils/behaviorGrade.js` is the single source of the grade (0-10 writing base minus time/edit/paste/AI penalties; AI is a weak signal, max -4). `utils/scoring.js` only keeps roster helpers (effort score, ranks, badges, free-rider detection) used by the dashboard and analytics; do not add a second grading path there.

**Backend.** `backend/server.js` is a small Express app: `/api/health`, `/api/check`, `/api/analyze`, an in-memory per-IP rate limiter, and an optional node-cron deadline-reminder emailer (`services/reminderService.js`, Firebase Admin + SMTP) that stays dormant without credentials. Endpoints are currently unauthenticated.

**Not part of the app.** `peerlytics-app.jsx` and `peerlytics-demo.html` at the repo root are an old standalone prototype with hard-coded sample members; nothing imports them. `src/firebase/firebase.js` is the unused Firebase console snippet. `scripts/*.cjs|js` are one-off codemods that rewrote `peerlytics-app.jsx`/`WorkspacePanel.jsx` during earlier refactors; don't run them.

See `docs/audit.md` for what is done, partly done and missing against the rules below.

## Peerlytics rules

The rules below describe the target system for the team project. Parts of it (`collab/`, `notifier/`, `infra/`, PostgreSQL, Zod/Ajv, feature flags, four roles) do not exist in the code yet.

Peerlytics is a working prototype: students co-write in a TipTap editor,
the app tracks each student's typing, edits and pastes, and on submission
the backend analyses the work (OpenAI for AI likelihood, writing quality,
difficulty and feedback, with Hugging Face + Virtual Writing Tutor as a
backup chosen by the ai_provider flag; paste events for copy-paste) and
suggests a per-student grade the lecturer can override.

Structure
- Repo root: frontend (React + Vite + Tailwind, TipTap, Recharts)
- backend/: Node + Express API (courses, analysis, grading, reports)
- collab/: Hocuspocus + Yjs server for real-time co-editing
- notifier/: deadline emails, in-app and push notifications
- infra/: ansible/, k8s/, scripts/   - docs/: audit, diagrams
- Firebase: Auth, Firestore (documents, presence, notifications),
  firestore.rules, Hosting, Remote Config (feature flags)
- PostgreSQL: colleges, courses, enrolments, assignments, submissions,
  analysis_results (append-only), grades, overrides, audit_log

Decisions
- Roles: superAdmin, collegeAdmin, lecturer, student (Firebase custom
  claims, checked by the backend on every request except /health).
- College -> course -> assignment -> group workspace. Students join a
  course with a join code or an invite. Workspace = project = group.
- A course opens as a small site with tabs: Overview (announcements),
  Assignments, Groups, Members, Grades.
- Documents have Google Docs-style tabs and sub-tabs; each tab is its
  own part (XmlFragment) of the Yjs document.
- Lecturers see a workspace only after submission.
- analysis_results is write-once (a database trigger blocks UPDATE and
  DELETE); lecturer overrides are stored separately with who/when/why.
- Grade = Time, Edits, Writing, Tasks with weights set per assignment
  (rubric; default 0.25 each), 0-10; Tasks = share of the student's
  group tasks done by the deadline;
  then per-author deductions; the lecturer's override is final.
- Penalties go only to the student responsible, never the whole group.
- AI detection is "a signal, not proof" and the UI must say so.
- Every advanced feature (Yjs, offline, push, CSV invite, .docx,
  licensing, document tabs) sits behind a feature flag.

Hard rules
- No mock, sample or seed data in the app; no default workspaces.
- Never record keystroke contents; only time, counts, paste events and
  version history, as described in docs/privacy-notice.md.
- Never commit secrets; config comes from environment variables;
  keep .env.example up to date.
- Validate request bodies with Zod and external API results and
  tracking events with JSON Schema (Ajv).
- Every change has tests; tests stub Hugging Face, Virtual Writing
  Tutor, OpenAI, email and push; integration tests use a real PostgreSQL.
- Stay inside the folders the task names.
- Branch feature/PEER-<n>-<name> from develop; commits start PEER-<n>.
- Propose a short plan and wait for approval before coding; run lint
  and tests afterwards and report the results.
