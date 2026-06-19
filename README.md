# Peerlytics AI Workspace System

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

### 1. Install dependencies
npm install
cd backend && npm install && cd ..
```

### 2. Firebase project

1. Create a project at [Firebase Console](https://console.firebase.google.com/)
2. Enable **Authentication** → Email/Password
3. Create **Firestore Database**
4. Register a **Web app** and copy config values
5. Deploy rules from `firestore.rules` (Firestore → Rules → publish)

### 3. Environment variables

Copy `.env.example` to `.env` in the project root:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Optional backend:

```env
PORT=5000
CORS_ORIGIN=http://localhost:3000
```

### 4. Run locally

**Terminal 1 — frontend:**

```bash
npm run dev
```

**Terminal 2 — API (plagiarism / AI checks):**

```bash
npm run dev:server
```

- Sign up: http://localhost:3000/signup  
- Sign in: http://localhost:3000/login  
- App: http://localhost:3000/dashboard  

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