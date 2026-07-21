# PlanForge — multi-tenant, license-key-gated planner

You host `server/` once. Every organization that buys a license redeems it inside that
same server to create their own isolated org — separate users, separate tasks, separate
Anthropic key. Nobody deploys anything themselves except you.

## Pieces
- `licensing/` — **for you.** Generates the signing keypair and issues license keys
  after a sale. Never ships to customers.
- `server/` — **for you, deployed once.** Express + Postgres backend: license
  redemption (creates an org), owner/member auth, personal + team task storage per
  org, and an AI proxy that uses *that org's own* Anthropic key.
- `app/` — **for customers.** The planner UI, wrapped with Capacitor for Android or
  built as an installable PWA. Everyone points at the one server you're running.

## Setting yourself up to sell this

**Already done for you in this package:** a real production keypair has been generated —
`server/keys/public.pem` is in place, and the matching `private.pem` was delivered as a
*separate* download (`PRIVATE-KEEP-SECRET-private.pem`). Move it somewhere safe (a
password manager, not this folder) and never commit or share it — anyone holding it can
mint license keys. See `licensing/README.md` for how to use it with `issue-license.js`.

**Still yours to do — needs your accounts/credentials, not more code:**
1. Deploy `server/`. Fastest path: Render's Blueprint feature reading the included
   `render.yaml` at the repo root — it also provisions the Postgres database for you.
   `server/Dockerfile` works if you'd rather use Railway, Fly.io, or your own host.
   Either way you'll fill in `ENCRYPTION_KEY`, `ALLOWED_ORIGINS`, and `SMTP_*` in the
   platform's environment-variables panel (see `server/.env.example` for what each does).
2. Put that deployed URL into `app/src/config.js` (still a placeholder right now).
3. Optionally replace `app/public/icon-192.png` / `icon-512.png` — generated placeholders
   in your brand colors are already there so nothing's broken, but you'll likely want
   your real logo before shipping.
4. Optionally change `capacitor.config.json`'s `appId` (currently `com.planforgeapp.planner`)
   to your own reverse-domain — only load-bearing if/when you publish to the Play Store,
   where it becomes permanent.

## What a sale looks like
1. Customer pays however you collect payment (Payment Link, Gumroad, etc.).
2. You run `node issue-license.js their@email.com` and send them the printed key.
3. They open the app, choose "Create an organization," paste the key, name their org,
   set an owner email/password, and paste in **their own** Anthropic API key.
4. That both redeems the license (one-time — the same key can't create a second org)
   and logs them in as the owner of a brand-new, fully isolated organization.
5. From "Manage team" they add coworkers by email — the app shows a one-time temporary
   password to hand off; members sign in and can change it themselves. From "Org
   settings" they can rename their org or rotate their Anthropic key if it's ever revoked.

## Design reference
**https://www.figma.com/design/pa9wdykS2Vez3Z40R2ABcp** — every screen (desktop + mobile),
a real component library, and the polish pass (shadows, the rotated AI stamp tag). Code's
`THEME` object is the source of truth for exact values; Figma is the layout/visual reference.

## Personal vs. team calendars
Every task is tagged `personal` or `team` (sidebar switch: My Day / Team), scoped to
the signed-in user's organization. Personal tasks are only visible to whoever created
them; team tasks are visible and editable by everyone in that org. Nothing crosses
organization boundaries — verified directly against Postgres, not just in the UI.

## Build the web app / Android APK
```
cd app
npm install
npm run build        # dist/ is a working, installable PWA on its own
npx cap add android
npx cap sync android
npx cap open android  # Android Studio: Build → Generate Signed Bundle/APK
```
Everything through `npm run build` has been run and confirmed working. `npx cap add
android` onward has never actually been executed against this project — it needs the
real Android SDK and Gradle, which don't exist in a sandboxed chat environment. That
step, and creating/storing the signing keystore, has to happen on a machine with
Android Studio installed.

## Before this serves real customers
- Email reset (`SMTP_HOST` etc.) needs a real SMTP provider configured to actually send.
  Without it, the app still works — it just falls back to offline recovery codes — but
  you'll want real email before real customers rely on it.
- Review Anthropic's Usage Policy and commercial terms (anthropic.com/legal) for
  building a paid product on the API — that's your call to make, not mine.

## What's been verified, not just written
- `server/test/` — 15 automated tests (`npm test`), run against a real Postgres
  database and a real local SMTP relay, not mocks. Covers license single-use,
  cross-org isolation, auth, task permissions, team management, both password-reset
  paths, and org settings. Re-run these after any change before trusting it.
- Security headers (`helmet`), a login-specific rate limiter, and server-side input
  length limits were added after auditing for gaps, not requested up front.
- Mobile was broken until this pass: the sidebar (personal/team switch, team
  management, sign out) was completely unreachable on small screens — no menu, no
  fallback. Found during audit, fixed with a proper mobile menu.
- Task duration and priority could only be set at creation, never edited afterward.
  Fixed — the backend already supported it, only the UI was missing.
- Org settings (view org info, rotate the Anthropic key if it's revoked or changed)
  didn't exist at all. Added `GET/PATCH /api/org` and a settings screen for it.
