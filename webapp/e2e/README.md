# Whole-site E2E (Playwright)

Browser and HTTP tests of the running app: every page for every role in Arabic and English,
the Session 1 and Session 2 test-plan journeys, and OWASP Top 10:2025 checks. Unit and
integration tests stay in `__tests__/` (Jest).

## What runs

| Spec | Covers |
|---|---|
| `auth.setup.ts` | One real sign-in through the login form per role (Admin, Supervisor, Teacher, Guardian, student with a guardian, adult student); the specs reuse these sessions. |
| `site/crawl.spec.ts` | Every page of every role and the public pages, ar (RTL) and en (LTR): status < 400, no redirect away, heading, no error boundary, no 404 view, no raw translation key, no uncaught exception; locale negotiation; the 404 page. |
| `security/access-control.spec.ts` | A01 over HTTP: each role area refuses the other roles and anonymous visitors (proxy redirects); every API handler refuses anonymous callers; every state-changing handler refuses a foreign or missing `Origin` (CSRF); the role matrix read from each handler's own guard. Routes are read from `app/api` at run time. |
| `security/owasp-top10.spec.ts` | A01–A10: IDOR and tenancy, Supervisor money wall, open redirect, Zoom-link validation; security headers, served files, cookie flags, framing; `npm audit` and the lockfile; secrets in browser bundles, bcrypt cost; SQL-looking input, stored XSS (complaint, announcement), enum injection; insecure-design rules; login limits, enumeration, credentials in URLs, sign-out, request limit; forged webhook signatures; secrets and phones in the server log; malformed JSON, hostile ids, oversized bodies. |
| `reports/report-lifecycle.spec.ts` | Session 1 §5.1 (French report in English UI, French LTR body inside Arabic RTL chrome), §3.3 visibility, §5.3 decision workspace, §4.4 page guard, reject with mandatory reason → resubmit → approve → settlement rows. |
| `finance/*.spec.ts` | Session 1 §5.2 finance wall (scenarios A and B, guardian pays); Session 2 §3 checkout → provider page → same attempt reused → concurrent checkouts → signed callback settles once, replay is a no-op. |
| `billing/admin-billing.spec.ts` | Session 2 §3 admin billing: Arabic page, plan create/deactivate, exchange rate, pay-per-session, annual invoices refused, Supervisor kept out. |
| `sessions/session-lifecycle.spec.ts` | Booking through the smart form (Cairo wall clock), booking rules and their codes, teacher cannot book, join redirect + click log, idempotent cancel frees the credit. |
| `family/*.spec.ts` | Complaint through the form → handled → resolved (nobody notified); the inbox; evaluations the teacher can never see. |
| `public/apply.spec.ts` | The public application form, duplicates, honeypot, academy scoping. |
| `whatsapp/openwa.spec.ts` | Against the **real** OpenWA: Admin health check, OpenWA's own signed test delivery, an Admin message from queue to the worker to OpenWA. Skips when OpenWA is not reachable. |

Tests marked `test.fail()` pin a **known open gap** by its id (now only G-WA-1: OpenWA's
"session not active" 400 treated as permanent). They pass while the gap is open and fail once
it is fixed, so the marker is removed with the fix. G-A02-1 (CSP/HSTS/Permissions-Policy) and
G-A07-5 (X-Forwarded-For) were fixed on 2026-10-29 and are ordinary tests now.

Client addresses: the specs send `X-Forwarded-For: <address>` as the reverse proxy would
(`TRUSTED_PROXY_HOPS=1`, the default), one address per role, so each role has its own
rate-limit budget the way separate people would.

## Data safety

- Everything runs in a **per-run test academy** (`e2e/support/fixture.ts`, the Jest fixture
  helper), created by global setup and deleted by global teardown. The seed academy is only
  touched by the public apply spec, whose application carries the run marker and is deleted.
- Every fixture user has a **fictional +1-202-555-01xx phone**, so nothing can reach a person
  even when OpenWA is linked to a phone.
- Paymob is never called: the server Playwright starts uses the local test double
  (`e2e/support/paymob-double.mjs`, port 4010).
- The worker runs (the WhatsApp spec needs it) and, on a production start, sends due jobs of
  **every** academy in the database through OpenWA. Point the run at a database whose only
  real phones are your own test phones, or use `E2E_WHATSAPP=off`.

## Before the first run

1. A development PostgreSQL with all migrations applied (`npx prisma migrate deploy`) and the
   demo seed (`npm run db:seed:demo`; the apply spec needs the seed academy "Zarabicschool").
2. `.env` as for development (`DATABASE_URL`, `NEXTAUTH_SECRET`, …). Playwright overrides
   for the server it starts: `PAYMOB_API_URL` (the double), `ALLOWED_ORIGINS` (the run's
   origin), `MESSAGING_PROVIDER` (empty: a production start refuses `console`).
3. A production build: `npm run build`.
4. Optional, for the WhatsApp spec: OpenWA running from `../OpenWA` (`node dist/main`, port
   2785) with `SSRF_ALLOWED_HOSTS=localhost,127.0.0.1` in `OpenWA/.env`, the session id in
   `OPENWA_SESSION_ID`, and the webhook registered to `http://localhost:3000/api/whatsapp/status`
   with `OPENWA_WEBHOOK_SECRET` (phase-06 § "Session 5 Part 1" has the curl commands).

## Run

```sh
npx playwright test                    # everything (starts the app and the Paymob double)
npx playwright test e2e/security       # one folder
npx playwright show-report             # the HTML report (playwright-report/)
```

Switches:

| Variable | Effect |
|---|---|
| `E2E_SERVER=dev` | start `next dev` instead of `next start` |
| `E2E_BASE_URL=…` | test an app that is already running (its own env applies) |
| `E2E_WHATSAPP=off` | OpenWA at a closed port; the WhatsApp spec skips |
| `E2E_REUSE_FIXTURE=1` / `E2E_KEEP_FIXTURE=1` | keep the same test academy between runs (debugging) |
| `E2E_REUSE_STATE=1` | reuse saved sign-ins younger than 7 h (quicker re-runs) |
| `E2E_CHROMIUM_PATH=…` | a Chromium binary when Playwright's own build is not installed |

A repeated run against the **same** server can hit the app's in-memory limits (3 failed logins per
username and address block it for 15 min, 10 complaints per user per hour). A fresh server resets them.
