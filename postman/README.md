# Postman collection

Step 3.3 · Owner: Sonam

`peerlytics.postman_collection.json` calls every route in `backend/openapi.yaml`, in an order that runs end to end. Each request checks its status code, and saves the ids that later requests need. Run in order, the requests go:

1. create a course
2. students join
3. groups
4. tasks
5. submit
6. grade
7. override
8. CSV
9. XML report

Refusals are covered too: 401, 403, 404 and 409.

| File | What it is |
|---|---|
| `build-collection.mjs` | The source. Edit this, then run `node postman/build-collection.mjs` |
| `peerlytics.postman_collection.json` | Generated. Import it into Postman |
| `peerlytics.postman_environment.json` | The variables, all empty. Fill them in Postman and never commit the values |
| `collection.test.mjs` | Fails if a route in the contract has no request, or if the JSON is out of date |
| `ci/` | How CI runs it: emulator users with roles, then Newman |

## In Postman

1. Import the collection and the environment.
2. Set `baseUrl`, and fill `token_*` and `uid_*` with ID tokens and uids of real test accounts with the right roles. The `firestoreEmulator` variable stays empty against a real server; the two "Emulator only" requests are then skipped.
3. Run the collection with the Collection Runner.

The **Peer evaluation** and **Comparison** requests need the `peer_eval_enabled` and `course_dashboard_enabled` flags on (CI sets `FLAG_PEER_EVAL_ENABLED=true` and `FLAG_COURSE_DASHBOARD_ENABLED=true`).

The **Not built yet** folder lists routes that are in the contract but not built yet (steps 3.10, 4.6, 4.9). Each of them expects 404. When a route is built, its request fails, which is the reminder to move it into its folder and give it real checks.

## OAuth practical: Google ID token

The **OAuth practical** folder shows the OpenID Connect flow:

1. **Google ID token**: open *Authorization → Get New Access Token*. Postman runs Google's OAuth 2.0 authorization-code flow with PKCE (scope `openid email profile`). It needs a Google OAuth client ID (`googleClientId`) whose redirect URI includes Postman's callback (`https://oauth.pstmn.io/v1/callback`). Copy the returned `id_token` into `googleIdToken`.
2. **Exchange for a Firebase ID token**: sends the Google ID token to Firebase Auth (`accounts:signInWithIdp`), which checks it and returns a Firebase ID token. The test saves it as `token_google`. This needs `firebaseWebApiKey`, the project's web API key.
3. **Me with the Google account**: calls `GET /api/auth/me` with that token.

These requests are skipped when `googleIdToken` is empty, as in CI.

## In CI

The `postman (newman)` job in `.github/workflows/ci.yml`:

1. Starts PostgreSQL and migrates it.
2. Starts the Firebase Auth and Firestore emulators.
3. Creates the test users with their roles (`ci/seed-emulator.mjs`).
4. Starts the API and runs the collection with Newman 6.2.2 (`ci/run-newman.sh`).

The users exist only in the emulator.
