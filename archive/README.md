# archive/

Old files kept for reference only. **Nothing here is part of the app**: nothing imports these files, Vite does not build them and ESLint does not check them. Do not wire them back in.

| File | Was | Why archived |
|---|---|---|
| `peerlytics-app.jsx` | Repo-root standalone prototype | Hard-coded sample members and files (no sample data allowed in the app). The real dashboard is `src/components/peerlytics-app.jsx`. |
| `peerlytics-demo.html` | Fragment of the same prototype | Not referenced by `index.html` or Vite |
| `SETUP-prototype.md` | Repo-root `SETUP.md` | A guide to running the prototype above, not the real app. See `README.md` and `CLAUDE.md` for setup. |
| `useTheme.js` | `src/hooks/useTheme.js` | Never imported; the app uses `src/hooks/useThemePreference.js`. |
| `firebase-console-snippet.js` | `src/firebase/firebase.js` | The Firebase console's setup snippet with a hard-coded web config. The app uses `src/firebase/config.js`, which reads `VITE_FIREBASE_*`. |

Archived in step 1.3 (audit finding S14).
