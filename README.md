# Peerlytics AI Workspace System

[![CI](https://github.com/shoc05/Peerlytics/actions/workflows/ci.yml/badge.svg)](https://github.com/shoc05/Peerlytics/actions/workflows/ci.yml)

Production-ready academic collaboration platform with Firebase auth, Firestore data, TipTap workspace, and AI + plagiarism checks.

## Features

- **Firebase Authentication** — email/password signup and login with Student / Lecturer roles
- **Firestore database** — users, projects (workspace = group), documents, versions, activity, analytics, reports, submissions, grades
- **Invite-only projects** — new users see “No projects yet”; create a project or get invited (no default data)
- **Lecturer gating** — lecturers only see projects after student submission
- **Protected routes** — `/dashboard` requires login; unauthenticated users go to `/login`
- **Workspace** — Google Docs–style TipTap editor with autosave, version history, paste detection
- **Check & Submit** — backend EyeSift + AI scoring pipeline (`POST /api/check`)
- **Lecturer tools** — analytics, submission reports, grade overrides (existing UI preserved)

## Setup

You need Node.js 22, Git and [Docker Desktop](https://www.docker.com/products/docker-desktop/). All commands run from the repo root unless a step says otherwise.

### 1. Install dependencies

The frontend (repo root) and the backend (`backend/`) are two separate packages, so install both:

```bash
npm install
cd backend
npm install
cd ..
```

Run this again **after every `git pull` that changes a `package.json`**. Otherwise Vite stops with errors like `Failed to resolve import "dompurify"`, and tests fail with `Cannot find package 'jsdom'`.

### 2. Firebase project

The team project is **peerlytics-4367c** (`.firebaserc`). Ask Sangay for access. If you are setting up a new project instead:

1. Create a project at [Firebase Console](https://console.firebase.google.com/).
2. Authentication → Sign-in method: turn on **Email/Password** and **Google**.
3. Create a **Firestore Database**.
4. Register a **Web app** and copy its config values into `.env` (step 3).
5. Deploy the rules: `firebase deploy --only firestore:rules,firestore:indexes` (see `DEPLOY-FIREBASE.md`).

**Service account key (backend).** The role routes, Google sign-up, the server deadline lock and the reminder emails need it.

1. Firebase Console → ⚙ Project settings → **Service accounts** → **Generate new private key**.
2. Save the file as `backend/serviceAccountKey.json`. Git ignores it; never commit it or send it in chat.

The key must come from the same project as the `VITE_FIREBASE_*` values. A key from another project makes Google sign-up fail with "Your sign-in could not be verified".

### 3. Environment variables

Copy `.env.example` to `.env` in the repo root. One file serves the frontend and the backend.

```bash
cp .env.example .env
```

Then fill in:

| Variable | Where it comes from |
|---|---|
| `VITE_FIREBASE_*` | The web app config from step 2 |
| `FIREBASE_SERVICE_ACCOUNT` | `./serviceAccountKey.json` (the path is relative to `backend/`) |
| `CORS_ORIGIN` | `http://localhost:3000` |
| `HF_API_KEY`, `VWT_API_KEY` | Hugging Face and Virtual Writing Tutor keys. Without them, analysis shows "unavailable" and submissions still work |
| `SMTP_USER`, `SMTP_PASS` | Optional, for reminder emails. With Gmail, `SMTP_PASS` is an **App Password**, not your normal password |
| `POSTGRES_PASSWORD`, `DATABASE_URL`, `TEST_DATABASE_URL` | See step 4 |

Leave the other values as they are in `.env.example`. Each one has a comment that explains it.

### 4. PostgreSQL

Courses, assignments, the server deadline lock and grades use PostgreSQL (`docs/db-schema.md`). Without `DATABASE_URL`, the API still starts, but those features are off.

1. Make a password with letters and digits only:

   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```

2. Put it in `.env` in three places (replace `YOURPASS`):

   ```env
   POSTGRES_PASSWORD=YOURPASS
   DATABASE_URL=postgres://peerlytics:YOURPASS@127.0.0.1:5433/peerlytics
   TEST_DATABASE_URL=postgres://peerlytics:YOURPASS@127.0.0.1:5433/postgres
   ```

3. Open Docker Desktop and wait for **Engine running**. Then start the database and check that it says `healthy`:

   ```bash
   docker compose up -d postgres
   docker compose ps
   ```

4. Create the tables:

   ```bash
   cd backend
   npm run migrate:up
   cd ..
   ```

**Looking inside the database.** Run `docker compose exec postgres psql -U peerlytics -d peerlytics`. Then `\dt` lists the tables, `\d workspaces` shows a table's columns, `SELECT * FROM workspaces;` shows its rows, and `\q` quits. A GUI such as pgAdmin, DBeaver or the VS Code PostgreSQL extension also works: host `127.0.0.1`, port **5433**, database and user `peerlytics`, password `YOURPASS`.

**Stopping and starting.** `docker compose stop postgres` stops it and keeps the data. `docker compose up -d postgres` starts it again. Don't run `docker compose down -v`: `-v` deletes the database.

### 5. Run locally

**Terminal 1 — frontend:**

```bash
npm run dev
```

**Terminal 2 — API:**

```bash
npm run dev:server
```

Check the API's start-up lines. With everything set up, there is no "is not set" warning, and it prints `Server deadline lock ON (… PostgreSQL deadlines for course workspaces)`. http://localhost:5000/api/health should show the database as up.

- Sign up: http://localhost:3000/signup
- Sign in: http://localhost:3000/login
- App: http://localhost:3000/dashboard

### 6. Lint and tests

```bash
npm run lint
npm test
cd backend
npm run lint
npm test
npm run test:db
cd ..
```

`npm run test:db` needs the database from step 4. Each run creates its own throwaway database and drops it afterwards, so your data is never touched.

### After every `git pull`

```bash
npm install
cd backend
npm install
npm run migrate:up
cd ..
```

Then restart both terminals.

## Firestore collections

| Collection | Purpose |
|------------|---------|
| `users/{uid}` | Profile: name, email, role, groupId |
| `projects/{projectId}` | Project metadata, memberIds, lecturerIds, hasSubmissions |
| `projects/{id}/folders`, `files`, `versions`, `activity`, `grades`, `pasteEvents` | Workspace & collaboration |
| `analytics/{projectId}/members/{uid}` | Contribution metrics |
| `documents/{fileId}` | HTML/text document bodies |
| `reports/{reportId}` | AI + plagiarism reports |
| `submissions/{fileId_uid}` | Locked submission records |

New users start with no project. Students must either create a project or be invited into one by a lecturer before their workspace becomes available.

## Auth flows

- **Student signup** — creates user with empty workspace membership; students must create or be invited into a project before submitting.
- **Lecturer signup** — lecturer role; can create project groups and invite students for submission review.
- **Invite member** — Groups tab: invite by email (user must already have an account)

## Branding

Logo: `public/logo.png` — used on Login, Signup, navbar, and loading screen.

## Production build

```bash
npm run build
npm run preview
```

## API

`POST /api/check` — body: `{ text, html, fileId, userId, groupId, fileName }` — returns structured integrity report.

## Direct pushes

Every change to `develop` and `main` goes through a pull request. Two guards check this:

- **On GitHub:** the *Push guard* workflow (`.github/workflows/push-guard.yml`) runs on every push to `develop` and `main`. If any pushed commit did not come through a merged pull request, the run fails, an issue titled "Direct push to &lt;branch&gt; by &lt;user&gt;" is opened with the `direct-push` label, and the job summary lists the commits. Bots and anyone in the repository variable `ALLOWED_DIRECT_PUSHERS` (comma-separated usernames, empty by default) are skipped.
- **On your computer:** the `pre-push` hook in `.githooks/` refuses a push to `develop` or `main` with "Push to your feature branch and open a PR instead." `npm install` turns it on (`git config core.hooksPath .githooks`).

The local hook can be skipped with `git push --no-verify`, but the workflow still catches the push.

**If you pushed to `develop` or `main` by mistake:**

1. Don't force-push. Create a branch from `develop` (or `main`) and revert the commit there: `git revert <sha>`.
2. Push that branch and open a PR to undo the change.
3. Redo your change on a feature branch and open a normal PR. Mention the `direct-push` issue so Sangay can close it.
