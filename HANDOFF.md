# PlanForge — handoff status

If you're picking this back up later, or handing it to Claude Code, start here.

## What this is
A self-hosted, multi-tenant AI planner. You deploy `server/` once; every customer who
buys a license key creates their own isolated organization inside it — separate users,
tasks, and their own Anthropic API key. Personal + shared team calendars, AI-assisted
scheduling, recurring tasks, drag-to-reschedule, and full account recovery (email code
or offline recovery code).

## Design reference
The visual design lives in Figma, not just in `App.jsx`'s inline styles:
**https://www.figma.com/design/pa9wdykS2Vez3Z40R2ABcp**

- **Desktop Screens** — all 6 screens (Login, Setup, Day Planner, Week, Team, Org
  Settings), polished with shadows and the rotated "AI stamp" tag treatment
- **Components** — a real component library (`Button`, `Input`, `Priority Badge`,
  `Nav Item`) as actual Figma `COMPONENT`/`COMPONENT_SET` nodes, not styled frames.
  Deliberately lightweight — no dark mode, no multi-brand tokens, because the app
  doesn't need either yet
- **Mobile** — phone-width versions of Day Planner (menu open) and Team, matching the
  mobile-nav fix in the actual code

If the visual design and the code ever drift, Figma is downstream of the code's
`THEME` object (pine `#2F6F5E`, paper `#FBFAF6`, Fraunces/Inter/IBM Plex Mono) — treat
the code as the source of truth for color/type values, and Figma as the layout/polish
reference.

There's also a standalone interactive demo (mocked backend, real UI) if you want to
click through the app without deploying anything — ask for it to be regenerated from
current `App.jsx` if it's gone stale.

## Confirmed working, as of this build
Re-run yourself with the commands below — don't take this list on faith.

- **Backend logic**: `cd server && npm test` → 15/15 passing. Runs the real server
  against a real Postgres database and a real local SMTP relay (not mocks): license
  single-use enforcement, cross-org data isolation, auth, task permissions, team
  management, both password-reset paths (asserted against the actual received email),
  org settings.
- **Security**: `npm audit` → 0 vulnerabilities. Helmet headers, login-specific rate
  limiting, server-side input length limits all in place.
- **Frontend build**: `cd app && npm run build` → succeeds cleanly, produces a working
  `dist/` (also a valid installable PWA on its own, no Android needed for that path).
- **Encryption**: org Anthropic keys are AES-256-GCM encrypted at rest — confirmed by
  inspecting the database directly, not just trusting the code.

## Never verified — needs your machine, not more code
`npx cap add android` onward has never been executed against this project. No sandboxed
environment has the Android SDK/Gradle. This is the one real unknown left. Everything
through `npm run build` is solid; Android Studio picks up from there
(`server/README.md` and the top-level `README.md` have the exact commands).

## Exact next steps, in order
1. `cd licensing && node keygen.js` if you haven't already — keep `private.pem` secret,
   `public.pem` goes in `server/keys/`.
2. Deploy `server/` (Render Blueprint via `render.yaml` is the fastest path; `Dockerfile`
   works anywhere else). Fill in the env vars per `server/.env.example`.
3. Put that URL in `app/src/config.js`.
4. `cd app && npm install && npm run build`.
5. `npx cap add android && npx cap sync android && npx cap open android` — this is
   where you're on your own hardware, and where anything genuinely new could surface.
6. In Android Studio: generate a signed bundle/APK, keep the keystore safe.

## If something breaks at step 5 or 6
That's the first real-world test of the one untested seam in this whole project. It's
not a sign anything upstream was wrong — it's just the part no sandbox could confirm in
advance. Come back with the actual error and I can help from there.
