# Auth contract: roles, claims and tokens

Step 1.2 · Owner: Kezang · Status: agreed contract, implementation in progress

This is the contract between the frontend, the backend, `collab/`, `notifier/` and `firestore.rules`. Build against it now; the implementation lands in `backend/src/auth/` in the next step 1.2 PR. If anything here has to change, change this file in its own PR first.

## 1. Roles

| Role | Who | How they get it |
|---|---|---|
| `student` | Writes in group workspaces | Chooses it once at sign-up |
| `lecturer` | Runs courses, reads submitted workspaces, grades | Chooses it once at sign-up |
| `collegeAdmin` | Manages one college's courses and lecturers | Set by a superAdmin |
| `superAdmin` | Runs the whole platform | Set by a superAdmin (the first one by script, section 6) |

Rules:

- A new account has **no role** until it picks `student` or `lecturer`. It can do that **once**.
- Only a superAdmin can set `collegeAdmin` or `superAdmin`, or change a role that is already set.
- **Nobody can change their own role** after it is set, including a superAdmin. This stops self-promotion and stops the last superAdmin locking themselves out.
- The old `admin` role becomes `superAdmin` during migration (section 6).

## 2. Claim shape

Roles live in Firebase Auth **custom claims**. Only the backend sets them, through the Admin SDK.

```json
{ "role": "student", "collegeId": null }
```

| Claim | Type | Meaning |
|---|---|---|
| `role` | `"superAdmin" \| "collegeAdmin" \| "lecturer" \| "student"`, or absent | Absent means the user has not picked a role yet |
| `collegeId` | string or `null` | The user's college. `null` for everyone until the college tables in `docs/db-schema.md` exist. Required for `collegeAdmin` once they do. Always `null` for `superAdmin`. |

No other custom claims. Don't put names, emails or group IDs in claims: they would go stale, and they make every token larger.

**Mirror field.** Until K3 (step 1.8) moves `firestore.rules` onto `request.auth.token.role`, the backend also writes the same role to `users/{uid}.role`. Clients can't write that field (the rules block it). The claim is the source of truth; the mirror exists only so today's rules keep working.

## 3. Frontend: getting and sending the ID token

- Sign-in methods: email and password, and Google (Firebase Auth's `GoogleAuthProvider`, an OpenID Connect provider). Keep Firebase's "one account per email address" setting on, so a student who uses both methods with the same email keeps one account.
- Read the role from the token, not from Firestore:

  ```js
  const { claims } = await auth.currentUser.getIdTokenResult();
  const role = claims.role ?? null;          // null => show the role picker
  const collegeId = claims.collegeId ?? null;
  ```

- Send the token on every backend call except `/api/health`:

  ```js
  const token = await auth.currentUser.getIdToken();   // the SDK refreshes it automatically
  fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  ```

- After `POST /api/auth/role` succeeds, call `getIdToken(true)` once to force a refresh, because the old token doesn't contain the new claim yet.
- If a call returns `401` with code `TOKEN_REVOKED`, the user's role was changed by an admin. Sign them out and ask them to sign in again.
- Never decide what someone may do from the UI alone. The UI hides things based on the role; the backend and the rules enforce them.

## 4. Backend: reading the token

Middleware in `backend/src/auth/`:

- `requireAuth`:
  1. Reads `Authorization: Bearer <idToken>`.
  2. Calls `admin.auth().verifyIdToken(idToken, true)`. The `true` also rejects revoked tokens.
  3. Sets `req.user = { uid, email, role, collegeId }`, where `role` and `collegeId` come from the claims (`null` when absent).
- `requireRole(...roles)`: runs after `requireAuth` and returns `403` unless `req.user.role` is one of `roles`.
- Every route uses `requireAuth` except `GET /api/health`. Every route except the two `/api/auth/*` routes below also needs a role.
- Other services (`collab/`, `notifier/`) verify tokens the same way. `collab/` receives the token in the Hocuspocus `token` field instead of a header.

Errors are JSON with the HTTP status below. `error` is the human-readable message the existing frontend already shows; `code` is for programs to check.

```json
{ "error": "Your session has expired. Please sign in again.", "code": "TOKEN_EXPIRED" }
```

| Status | `code` | When |
|---|---|---|
| 401 | `NO_TOKEN` | No `Authorization: Bearer` header |
| 401 | `TOKEN_INVALID` | The token fails verification |
| 401 | `TOKEN_EXPIRED` | The token has expired |
| 401 | `TOKEN_REVOKED` | The user's tokens were revoked (role changed) |
| 403 | `NO_ROLE` | Signed in but no role picked yet |
| 403 | `FORBIDDEN` | The role isn't allowed on this route |
| 400 | `INVALID_BODY` | The body fails the Zod schema |
| 409 | `ROLE_ALREADY_SET` | Tried to pick a role a second time |
| 403 | `CANNOT_CHANGE_OWN_ROLE` | An admin tried to change their own role |
| 404 | `USER_NOT_FOUND` | The target uid doesn't exist |

## 5. Endpoints

### `GET /api/auth/me`

Requires `requireAuth` only, so it works before a role is picked.

`200` `{ "uid": "…", "email": "…", "role": "student" | null, "collegeId": null }`

### `POST /api/auth/role`: pick a role at sign-up

Requires `requireAuth` only.

Body: `{ "role": "student" | "lecturer" }`. No other fields are accepted.

- `200` `{ "role": "student", "collegeId": null }`. It sets the claim and the `users/{uid}.role` mirror. The client then calls `getIdToken(true)`.
- `409 ROLE_ALREADY_SET` if the caller already has any role.
- `400 INVALID_BODY` for any other role, including `collegeAdmin` and `superAdmin`.

### `POST /api/admin/users/:uid/role`: set anyone's role

Requires `requireAuth` and `requireRole('superAdmin')`.

Body: `{ "role": "superAdmin" | "collegeAdmin" | "lecturer" | "student", "collegeId": string | null }`. `collegeId` is optional and defaults to `null`.

- `200` `{ "uid": "…", "role": "…", "collegeId": … }`. It sets the claim and the mirror, then revokes the target's refresh tokens so their old role stops working straight away.
- `403 CANNOT_CHANGE_OWN_ROLE` if `:uid` is the caller.
- `404 USER_NOT_FOUND` if `:uid` doesn't exist.
- Once the PostgreSQL `audit_log` exists, every change there records who, whom, the old role, the new role and when.

## 6. Setup and migration

- **First superAdmin:** a one-off script in `backend/src/auth/` run with `FIREBASE_SERVICE_ACCOUNT` set, for example `node backend/src/auth/set-role.js <uid> superAdmin`. It is not an HTTP route.
- **Existing accounts:** a one-off migration copies `users/{uid}.role` into claims, mapping `admin` to `superAdmin`. Accounts without a valid role get no claim and see the role picker.

## 7. Config

| Variable | Used by | Purpose |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | backend, collab, notifier | Service-account JSON for the Admin SDK (already used by the reminder emails) |
| `CORS_ORIGIN` | backend | The website origin. No longer defaults to "any origin". |
| `FIREBASE_AUTH_EMULATOR_HOST` | tests only | Points the Admin SDK at the Auth emulator |

## 8. Out of scope here

- Allowed email domains per college and the domain check at sign-up: K7 (step 3.6).
- Rules that read `request.auth.token.role` directly: K3 (step 1.8).
- Course-level permissions (which lecturer teaches which course): they will come from PostgreSQL enrolments, not from claims.
