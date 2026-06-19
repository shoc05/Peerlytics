# Deploy Firestore rules & indexes

Run these commands from the **project root** (`peerlytics`), not from `src/firebase`.

## One-time setup

1. Install CLI (if needed):
   ```bash
   npm install -g firebase-tools
   ```

2. Log in:
   ```bash
   firebase login
   ```

3. Create `.firebaserc` (copy the example and set your project id from Firebase Console or `.env` → `VITE_FIREBASE_PROJECT_ID`):
   ```bash
   copy .firebaserc.example .firebaserc
   ```
   Edit `.firebaserc` and replace `YOUR_FIREBASE_PROJECT_ID` with your real project id.

## Deploy

```bash
cd D:\3IT\Peerlytics\peerlytics
firebase deploy --only firestore:rules,firestore:indexes
```

Indexes can take a few minutes to build in the Firebase Console.

## Verify

- Rules: Firebase Console → Firestore → Rules (should match `firestore.rules`)
- Indexes: Firestore → Indexes (composite indexes for `submissions` and `reports`)
