# Staging runbook — temporary staging through an ngrok tunnel (D95)

> **What this is:** a short-lived staging for testers, on the owner's PC, behind an ngrok **static free domain**.
> It is **not** the production hosting decision; that is still OPEN (CONTEXT §17).
>
> **Never in this file:** secret values, the ngrok token, or the real domain. Variable names only.
>
> Rehearsed on 2026-10-30 in a cloud session with a local HTTPS proxy standing in for ngrok (ngrok itself was
> not run). The results are at the end. Commands are given for PowerShell (the owner's PC) and bash.

## 0. What runs, and what is exposed

| Process | Port | Exposed through the tunnel? |
|---|---|---|
| Web app (`next start`, production build) | 3000 | **yes — the only thing exposed** |
| Worker (`npm run worker`) | none | no |
| PostgreSQL (separate staging database) | 5432 | **never** |
| OpenWA | its own port | **never; kept OFF for staging** |

**Never run the dev server (`next dev`) for staging.**

## 1. Pre-deploy (once per staging round)

- [ ] **A separate staging database**, used for nothing else and never one with real data.
  - Option A: a new free Supabase project.
  - Option B: a new database on the local PostgreSQL, e.g. `zarabic_staging`.
  - It is seeded with the **demo seed only**: the demo seed creates its own Admin and refuses a non-empty database.
- [ ] **ngrok:** account; claim the free static domain (ngrok dashboard → Domains); add the token once
      (`ngrok config add-authtoken <token>`, typed in the terminal, never saved in a file in the repo).
- [ ] **Create `webapp/.env.staging`** (already git-ignored by the `.env*` rule):
      **copy `webapp/.env.example` and set EVERY key**, empty where unused. Next.js, Prisma and the seed load the
      dev `.env` too, but never over a value that is already set. So any key missing from `.env.staging` would
      silently take the developer value.
      Quote values that contain spaces (`SEED_ADMIN_NAME="Staging Admin"`).

| Key | Staging value |
|---|---|
| `DATABASE_URL`, `DIRECT_URL` | the staging database |
| `NEXTAUTH_URL`, `APP_PUBLIC_URL`, `ALLOWED_ORIGINS` | `https://<static-domain>` (the same origin, no trailing slash) |
| `NEXTAUTH_SECRET` | a NEW random value for staging only (e.g. `openssl rand -base64 48`) |
| `TRUSTED_PROXY_HOPS` | `1` (ngrok is the one proxy; it appends each visitor's address to `X-Forwarded-For`, so the login lockout counts each tester separately; test LT-07) |
| `WORKER_MODE` | `separate` |
| `SEED_ADMIN_USERNAME`, `SEED_ADMIN_NAME` | your choice |
| `SEED_ADMIN_PASSWORD`, `SEED_DEMO_PASSWORD` | NEW staging-only passwords (≥ 12 characters) |
| `SEED_TEST_PHONE_GUARDIAN`, `SEED_TEST_PHONE_TEACHER` | fictional numbers (WhatsApp is off) |
| **keep EMPTY** | `MESSAGING_PROVIDER`, all `OPENWA_*`, all `PAYMOB_*` keys except `PAYMOB_API_URL`, `FEATURE_AUTO_RENEWAL`, `CLOUDINARY_*`, `SUPABASE_*`, `USD_GATEWAY_*`, `CSP_REPORT_ONLY`, `HSTS_MAX_AGE` (the HSTS default of 300 s stays) |

- **WhatsApp stays OFF.** With `OPENWA_*` empty, every message becomes a redacted FAILED job: nothing is sent and
  nothing crashes. The dev allowlist (`OPENWA_SEND_ALLOWLIST`) does **not** apply to a production start, so
  pointing OpenWA at a real gateway here would message every demo phone number. Do that only after every demo
  user's phone has been replaced with your own test numbers.
- **Paymob stays OFF** until you say "go" (section 6). With empty keys, checkout answers NOT_CONFIGURED.
- **Uploads stay OFF** (no Cloudinary keys). Attachments answer "storage not configured".

**Secrets to ROTATE before the link is shared** (staging-only values, never reused anywhere else):
1. `NEXTAUTH_SECRET`
2. the staging database password
3. `SEED_ADMIN_PASSWORD` and `SEED_DEMO_PASSWORD` (the Admin is also forced to change it at first sign-in)
4. the OpenWA API key, if OpenWA is ever switched on for staging

Also never share the ngrok authtoken. Afterwards, rotate the production secrets as well: a launch blocker in
`deploy-checklist.md` (D21).

## 2. Load the staging env into the terminal (every terminal you use)

PowerShell (in `webapp`):
```powershell
Get-Content .env.staging | ForEach-Object {
  if ($_ -match '^\s*([A-Z][A-Z0-9_]*)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim('"'), 'Process')
  }
}
node -e "console.log('database:', new URL(process.env.DATABASE_URL).pathname)"   # must print the STAGING database name
```

bash (in `webapp`):
```bash
set -a; . ./.env.staging; set +a
node -e "console.log('database:', new URL(process.env.DATABASE_URL).pathname)"
```

**Do not use `node --env-file`** with `next build`: Next.js passes it to its build workers, and they refuse it.

## 3. Deploy (start order)

Terminal 1, with the env loaded and inside `webapp`:
```
npx prisma migrate deploy        # creates every table in the staging database
npx tsx prisma/seed-demo.ts      # demo seed ONLY (it refuses a non-empty database; NODE_ENV must not be "production" here)
npm run db:verify                # read-only checks; must end "all 24 checks passed"
npm run build                    # production build with the staging NEXTAUTH_URL
npm run start -- -p 3000         # the web app; WORKER_MODE=separate keeps the worker out of it
```

Terminal 2, with the env loaded and inside `webapp`:
```
npm run worker                   # the worker as its own process; Ctrl+C stops it after the current tick
```

Terminal 3 (ngrok; exposes port 3000 only):
```
ngrok http 3000 --url=https://<static-domain>          # ngrok v3 (older versions: --domain=<static-domain>)
```

**Never point ngrok at 5432 (database) or the OpenWA port.**

## 4. Smoke test through the tunnel (before sharing)

- [ ] `https://<static-domain>/ar` and `/en` open.
  - ngrok's free plan shows a one-time "You are about to visit…" page to browsers; testers click "Visit Site".
- [ ] Sign in as the seed Admin: you are sent to **change password**, and `/en/admin` stays blocked until the change.
- [ ] After the change, the Admin dashboard opens.
- [ ] Sign in as `demo_teacher` (forced change too), `demo_guardian` and a demo student: each sees only their dashboard.
- [ ] `https://<static-domain>/api/sessions` (signed in) contains no `zoom.us`.
- [ ] Terminal 2 shows `[worker] started.` and no errors.

**Login lockout and rate limits (D90):** 3 wrong passwords block that username from that address for 15 minutes.
The counters live in the web app's memory: **restarting the web app clears every counter and block.** That is
accepted for staging only. If a tester is locked out, wait 15 minutes (or restart the app). Run ONE web app
instance: a second one would keep its own counters.

## 5. Post-deploy and stop

- Share the link and the demo usernames, plus the passwords (by a private channel, never in the repo).
- **Stop, in this order:** ngrok (Ctrl+C) → web app → worker.
- After the test round:
  - drop or reset the staging database;
  - delete `webapp/.env.staging`, or keep it only on your PC;
  - change the ngrok domain's settings only if the link was shared publicly.

**Rollback triggers (stop the tunnel at once):**
- a page answers 500;
- a login loop happens;
- anyone reports seeing another family's data;
- the worker log repeats errors;
- you see any real phone number or real person's data in the demo database.

## 6. Paymob test mode — PREPARED ONLY, runs after the owner writes "go"

URLs to paste into the Paymob dashboard (test mode) for staging:

| Paymob setting | Value |
|---|---|
| Transaction **processed** callback (webhook) | `https://<static-domain>/api/payments/paymob/webhook` |
| Transaction **response** callback (browser return) | `https://<static-domain>/ar/payments/paymob/return` |
| Subscription callback (automatic renewal; FEATURE_AUTO_RENEWAL stays off) | `https://<static-domain>/api/payments/paymob/subscription-webhook` |

- **HMAC:**
  - The webhook verifies `hmac` (the `?hmac=` query first, then the header) with HMAC-SHA512 over Paymob's
    documented field order, using a timing-safe compare, before anything is stored.
  - A missing `PAYMOB_HMAC_SECRET` answers 503 and accepts nothing.
- **Covered by tests** (Jest `__tests__/api/payments-webhook.test.ts`, plus the E2E OWASP A08 checks over HTTP):
  - INT-WH-07: a bad or missing HMAC answers 401, with nothing stored or settled.
  - INT-WH-02 / INT-WH-03: an exact replay answers `already_processed`, and two concurrent identical events settle once.
  - INT-WH-04 / INT-WH-04b: an amount or currency mismatch answers 200 `mismatch`, moves no money, and flags the Admin.
- **For the "go" run:** fill `PAYMOB_API_KEY`, `PAYMOB_INTEGRATION_ID_EGP`, `PAYMOB_IFRAME_ID_EGP` and
  `PAYMOB_HMAC_SECRET` with the **test-mode** values in `.env.staging`, then `npm run build` again and restart.
  Then follow the Layer 2 checklist in `phase-08-testing-launch.md`.

## Rehearsal results (2026-10-30, cloud session; local HTTPS proxy as the ngrok stand-in)

- **Setup:**
  - Separate database `zarabic_staging`: 44 migrations applied, demo seed only, `db:verify` 24/24.
  - Production build and `next start` on 3000 with `NEXTAUTH_URL=https://<test host>`; worker as its own process;
    `OPENWA_*`, `PAYMOB_*` and `CLOUDINARY_*` empty.
- **Through HTTPS with the public hostname:**
  - Admin sign-in redirected to `/en/change-password`, and `/en/admin` was refused until the change.
  - After the change, `/en/admin` opened ("Academy Operations Dashboard").
  - The session cookie was `__Secure-next-auth.session-token` with the Secure flag; HSTS `max-age=300`, CSP and
    `X-Frame-Options: DENY` were present.
  - `/api/sessions` contained no Zoom link; there were no console or page errors.
- **Worker:** one process, ticking with no errors. No message was sent: the only SENT job rows are demo-seed
  history; new jobs failed redacted ("Recipient has no phone number"), as designed with WhatsApp off.
- **Found and fixed during the rehearsal:**
  - `.env.example` was missing six names the code reads (ENV-01, commit 05edaf8).
  - The standalone worker did not exit after SIGTERM (commit a0a0c33).
- **Not rehearsed:** the real ngrok tunnel and its browser warning page, and a phone on the public internet.
