# collab — live co-editing server

Hocuspocus + Yjs server for step 2.2. The website connects to it only when the `yjs_enabled` flag is on and `VITE_COLLAB_URL` is set (see `docs/feature-flags.md`).

```bash
cd collab && npm install
npm run dev        # ws://localhost:1234, health check at http://localhost:1234/health
npm run lint
npm test           # real server + real providers; Firebase is faked, storage in memory
docker build -t peerlytics-collab .
```

Configuration comes from the repo-root `.env`: `FIREBASE_SERVICE_ACCOUNT`, `COLLAB_PORT` (default 1234) and `COLLAB_DEBOUNCE_MS` (default 2000).

How it works:

- **Documents.** There is one Yjs document per workspace file, named `group:<groupId>:file:<fileId>`. The editor uses its `default` XML fragment.
- **On connect.** The server verifies the Firebase ID token, revoked tokens included, and reads the group and file from Firestore (`src/access.js`):
  - Student members can write until the file is submitted or the workspace is locked.
  - A lecturer of the group can read only after a student has submitted to them, and can never write.
  - Everyone else is refused.
- **Storage.** Each document's state is stored in Firestore at `collabDocs/{name}`, two seconds after the last edit and when the last person leaves. Clients can't read or write that collection.
- **First open.** A file that has text from the old sync but no Yjs state yet is seeded exactly once: the server asks one writable client to load the text (`src/seed.js`).
- **Tracking.** Time, edit and paste tracking stays in the browser and counts only the local student's own changes. Remote changes are recognised by their Yjs origin.
