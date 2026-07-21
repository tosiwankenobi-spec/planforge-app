# PlanForge server (you deploy this once)

Express + Postgres backend serving every organization that redeems a license key. One
deployment, many isolated orgs — not one deployment per customer.

## Before running
1. Get `public.pem` from `licensing/keygen.js` (yours) and put it at `server/keys/public.pem`.
2. Have a Postgres database ready — a free tier on Neon, Supabase, or Railway works, or
   run one locally (`docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres`).
3. `cp .env.example .env` and fill in:
   - `DATABASE_URL` — your Postgres connection string.
   - `JWT_SECRET` — any long random string.
   - `ENCRYPTION_KEY` — 32 random bytes as hex (`openssl rand -hex 32`). Encrypts every
     organization's Anthropic key at rest. Back this up — losing it makes existing
     stored keys undecryptable, and every org would need to re-enter theirs.
   - `ALLOWED_ORIGINS` — origins allowed to call this API: your hosted PWA's domain,
     plus `https://localhost` for the Android app's webview.
   - `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`MAIL_FROM` — any SMTP provider
     (Gmail app password, SES, Postmark, Mailgun...). Powers email password reset.
     Leave `SMTP_HOST` blank to skip it — the app falls back to offline recovery codes.
   - `PORT` — defaults to 3000.

There's also an optional `LICENSE_PUBLIC_KEY_PATH` env var (defaults to
`server/keys/public.pem` if unset) — mainly useful for pointing the test suite at an
isolated throwaway keypair instead of your real one.

Notice there's no `ANTHROPIC_API_KEY` here anymore — each organization brings its own
at signup, stored per-org in Postgres, and used only for that org's `/api/plan` calls.

## Run
```
npm install
npm start
```
Tables are created automatically on first boot. `GET /health` should return `{"ok":true}`.

## How organizations get created
`POST /api/orgs/activate` takes a license key plus the new owner's email/password/org
name and their Anthropic API key. It verifies the key's signature, checks it hasn't
been redeemed before (each key works exactly once, tracked in `redeemed_licenses`),
and creates the organization + owner account together in one transaction.

## Data model
- `organizations` — one row per customer, holds their own `anthropic_api_key`.
- `users` — belongs to exactly one org (`org_id`); email is unique across the whole
  server, so login never needs an org picker.
- `tasks` — belongs to exactly one org; `scope` is `personal` (only its `user_id` can
  see/edit it) or `team` (anyone in that org can).

Every query that touches `users` or `tasks` filters by `org_id` pulled from the
authenticated user's JWT — there's no code path that reads across organizations.

## Passwords
- **Email reset** (needs SMTP configured): anyone — owner or member — can request a
  code from the login screen's "Forgot password?" link (`POST /api/auth/forgot-password`
  emails an 8-character code, unambiguous alphabet, expires in 30 minutes, single-use;
  `POST /api/auth/reset-password` redeems it). The endpoint always responds the same way
  whether or not the email has an account, so it can't be used to enumerate users.
- **Offline recovery code** (no SMTP needed): issued once at org creation, shown again
  after each use. Works via `POST /api/auth/recover`. Exists specifically for owners —
  nobody above them to reset their password otherwise — but anyone can regenerate their
  own anytime while logged in (`POST /api/auth/recovery-code/regenerate`).
- Anyone can also just change their own password while logged in
  (`POST /api/auth/password`), and the owner can reset a member's from "Manage team"
  (`POST /api/team/members/:id/reset-password`) without touching that member's tasks.

## Data protection
Each organization's Anthropic API key is encrypted at rest with AES-256-GCM
(`server/crypto.js`) using `ENCRYPTION_KEY`, not stored as plaintext. Recovery codes
and passwords are bcrypt-hashed, never stored raw.

## API surface
- `POST /api/orgs/activate` — redeem a license key, create an org + owner
- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/password`
- `POST /api/auth/recover`, `POST /api/auth/recovery-code/regenerate`
- `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`
- `GET/PATCH /api/org` — view org info, rename it, rotate the Anthropic key (owner only)
- `GET/POST /api/team/members`, `POST /api/team/members/:id/reset-password`,
  `DELETE /api/team/members/:id` (all owner only, scoped to their org)
- `GET/POST /api/tasks`, `PATCH/DELETE /api/tasks/:id`, `DELETE /api/tasks/series/:recurrenceId`
- `POST /api/plan` — AI scheduling, uses the caller's org's own (decrypted) Anthropic key

## Hardening in place
- `helmet` sets standard security headers on every response.
- Login has its own rate limit (10 attempts / 15 min / IP) separate from the general
  120/min limiter, and forgot-password has its own (5/hour/IP).
- Task titles are capped at 200 characters, org names at 100, both server-side.
- Every write is scoped to `req.user.org_id` pulled from the verified JWT — there's no
  endpoint that trusts an org or user ID from the request body for authorization.

## Automated tests
```
npm test
```
Spins up the real server as a child process against a real Postgres database (set
`TEST_DATABASE_URL` to point elsewhere; defaults to `planforge_test` on localhost) and a
real local SMTP relay, then drives it entirely over HTTP — license activation and reuse
rejection, cross-org isolation, auth, task CRUD and permissions, team management, both
password-reset paths (including asserting the actual reset code by parsing the real
received email), and org settings. 15 tests, all passing as of this build. Uses a fresh,
disposable keypair each run — never touches your real production keys.

## Deploy
Any Node host works — Render, Railway, Fly.io, or your own box. Set the env vars above,
point every customer's `app/src/config.js` at this one deployed URL, and you're serving
all of them from it.
