# Feature flags

Step 4.2 · Owner: Kezang

Every advanced feature sits behind a flag in **Firebase Remote Config**. If a flag is off, or Remote Config can't be reached, the feature is hidden and the app behaves as it did before that feature existed.

## Flags

| Flag | Type | Default | Owner (step) | Off means |
|---|---|---|---|---|
| `ai_provider` | `openai` \| `legacy` | `legacy` | Sonam (2.4) | Hugging Face + Virtual Writing Tutor analyse submissions. `openai` also needs `OPENAI_API_KEY` and `OPENAI_MODEL`. Applies to `/api/workspaces/{id}/submission`; `/api/check` always uses the legacy providers |
| `ai_detection_enabled` | boolean | `true` | Sonam (2.4) | AI-likelihood detection is skipped; the report says it is unavailable |
| `yjs_enabled` | boolean | `false` | Kezang (2.2) | The old Firestore document sync; no collab server connection |
| `doc_tabs_enabled` | boolean | `false` | Kezang (2.3), Ngawang (3.9) | One document body, no tabs panel. Also off when `yjs_enabled` is off |
| `offline_enabled` | boolean | `false` | Kezang (3.2) | No local copy on the device and no offline badge. Also off when `yjs_enabled` is off |
| `push_enabled` | boolean | `false` | Sangay (3.8) | No push permission prompt; in-app and email notifications only |
| `csv_invite_enabled` | boolean | `false` | Kezang (3.6) | No CSV upload; invites are one by one |
| `docx_export_enabled` | boolean | `false` | Ngawang (4.4) | No "Download .docx" button |
| `courses_v2` | boolean | `false` | Sonam (6.1, 6.3) | No Courses tab, and the course and submission routes answer 404 `FEATURE_DISABLED`. The backend also copies this flag to Firestore `config/flags`: when on, the rules refuse workspaces created in the browser, so **turn it on only after step 6.4** replaces the New Workspace buttons |
| `licensing_enabled` | boolean | `false` | Tshewang (3.10) | No **Colleges and licences** tab and no `/api/admin/colleges` routes (404 `FEATURE_DISABLED`). When on, licences are recorded but limits are not enforced yet |
| `billing_enabled` | boolean | `false` | Sangay (6.7–6.14) | No plans, payments or seats: lecturers create courses without a seat and the **Payments**, **Plans** and **Payment settings** tabs and `/api/admin/billing`, `/api/college/billing`, `/api/college/payment-requests`, `/api/college/seats` routes are off (404 `FEATURE_DISABLED`). When on, a lecturer needs a seat on an active or grace college subscription to create courses, projects and groups, and students can only submit while the course is covered. Stays off in production until the backend is public (D7). See `docs/billing.md` |
| `peer_eval_enabled` | boolean | `false` | Sonam (3.7) | No peer evaluation form |
| `course_dashboard_enabled` | boolean | `false` | Ngawang (4.8) | No course dashboard or comparison |
| `dzongkha_enabled` | boolean | `false` | Ngawang (UI) | English interface only |

The defaults are kept in three places that tests check against each other:

- `remoteconfig.template.json`
- `src/flags/flags.js`
- `backend/src/flags/index.js`

To add a flag, add it to all three, add a row here, and run `npm test` and `cd backend && npm test`.

## Using a flag

Frontend (anywhere under `<FlagsProvider>`, which wraps the app in `src/App.jsx`):

```jsx
import { useFlag } from '../flags/FlagsProvider';

const yjsEnabled = useFlag('yjs_enabled');
if (!yjsEnabled) return <OldEditor />;
```

Backend:

```js
import { getFlag } from '../src/flags/index.js';

if (await getFlag('ai_detection_enabled')) { /* ... */ }
```

`useFlag` and `getFlag` throw on a misspelt name, so a typo fails in tests instead of silently hiding a feature.

## Where values come from

| Side | Order (first wins) | Refresh |
|---|---|---|
| Frontend | `VITE_FLAG_<NAME>` in `.env` (local development only), then Remote Config, then default | Fetched on load, cached on the device for 10 minutes |
| Backend | `FLAG_<NAME>` env var, then Remote Config server template (Admin SDK), then default | Cached for 1 minute; if a fetch fails, the last good values stay in use |

There are also two dependency rules: `doc_tabs_enabled` and `offline_enabled` are forced off whenever `yjs_enabled` is off.

## Changing a flag

1. Firebase console → Remote Config → edit the parameter → **Publish changes**. Clients pick it up within 10 minutes and the backend within a minute.
2. Run `firebase deploy --only remoteconfig` only to create the parameters for the first time (it uploads `remoteconfig.template.json`). After that, manage values in the console. A later deploy would overwrite them with the defaults.
3. To roll back a feature, switch its flag off. You don't need a redeploy.
