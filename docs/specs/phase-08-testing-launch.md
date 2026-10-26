# Phase 8 — Testing & Launch

> **Session 5 (2026-10-26):** OWASP Top 10:2025 review in `security-review.md`; launch steps in `deploy-checklist.md` (ALLOWED_ORIGINS, Paymob path, npm install scripts, CSP/HSTS, `fast-uri` audit finding deferred to this phase); all Session 5 test ideas in `test-backlog.md`.

## Goal

Bug fixing, UX polish, performance, launch prep. (CONTEXT.md §13, Phase 8.)

Execute comprehensive end-to-end testing across onboarding, manual Zoom links, teacher reports, Admin approval, atomic settlement, manual billing, and launch readiness.

## Proposed approach

1. **End-to-End test suite:**
   - Playwright test flows for application submission -> approval -> credential login.
   - Report submission -> Admin approval -> explicit attendance -> ledger settlement tests.
   - Idempotency stress test: replay duplicate settlement requests to verify zero duplicate ledger rows.
   - Rollback test when the second ledger insert fails; retry must be safe.
   - Rejection/resubmission, completed-session-plus-missing-report, and archived-report immutability tests.
2. **UX & accessibility audit:**
   - Arabic RTL polish across all viewports (mobile, tablet, desktop).
   - Typography consistency (Cairo/Tajawal for Arabic, Montserrat for English).
   - Brand color compliance check (#1B365D Navy, #00897B Emerald, #D4AF37 Gold).
3. **Security & secret audit:**
   - Ensure zero secrets committed in Git history or environment files.
   - Verify server-side authorization checks on all mutations and API endpoints.
   - Verify rate limiting and input sanitization (Zod).
4. **Production deployment:**
   - Finalize production hosting setup for Next.js web application and required long-running worker process.
   - Verify Supabase production connection pooling (`DATABASE_URL` with transaction mode, `DIRECT_URL` for migrations).
   - Execute dry-run migration and seed in staging/production.

Delivery stage: Spans Stages 1–3.

## Acceptance criteria

- Each stage has a documented handoff gate; auth, reports, ledgers, uploads, backups, and authorization tests pass.

## Frontend

Run Playwright across login, applications, sessions, reports, invoices, payroll, and Admin queues at mobile/desktop Arabic RTL and English states, including loading/empty/error paths.

## Backend

Run authorization, Zod validation, rate-limit, idempotency, health-check, notification-after-commit, and error-shape checks. Hosting is decided at deployment.

## Database

Use real Postgres; verify raw SQL indexes/triggers/checks, backup/restore, `DIRECT_URL` migrations, and ledger consistency queries.

## Auth & Authorization

Audit every route by Role × Action, including deactivated sessions, minor data, signed uploads, Zoom redirects, reports, and financial mutations.

## Security

Verify no passwords, Zoom links, secrets, or student-identifying data in logs; rotate secrets; review uploads, rate limits, dependencies, authorization, and backups.

## Transactions & failure handling

Run concurrent report submits, unique-violation behavior, rollback injection, post-commit notifications, and restore verification.

## Tests

Unit, real-Postgres integration, RTL/component, and Playwright E2E suites include Admin approval before settlement, rejection/resubmission, completed-plus-missing-report, archive immutability, duplicate settlement, and rollback. No Zoom API/event lifecycle tests.

## Learning checkpoint

- Which checks must pass before handing Stage 2 to the client?
- Why is restore verification different from checking that backups exist?

## Open decisions

Hosting, stage dates, scheduler, and unresolved domain choices from earlier phases.

## Deferred / Post-MVP

- [DEFERRED] SaaS roadmap, Zoom verification, SMS, and recordings. Payment gateways are MVP scope: Paymob is the EGP provider and USD remains unavailable until a concrete provider is configured.

## Definition of Done

Requirements, authorization, validation, failure paths, tests, lint, typecheck, build, deployment runbook, backup/restore evidence, and execution log are complete.

## Tasks

- [~] Write Playwright E2E tests for student onboarding flow — **[audit 2026-10-26] PARTIAL**: one spec (`e2e/phase3.e2e.spec.ts`); writing journeys deferred until after the Phase 9 redesign; not run this session.
- [x] Write integration test suite for report submission -> Admin/Supervisor approval -> attendance -> settlement — **[audit 2026-10-26] DONE**: `reports.test.ts`, `edge-cases.test.ts` GRP-*, `integration/layer1-full-cycle.test.ts`.
- [x] Run automated idempotency verification for duplicate settlement requests — **[audit 2026-10-26] DONE**: reports concurrency, WH-02/03, MP-02/03, PAY-02..04, OT-02.
- [x] Run rejection/resubmission, missing-report, archive-immutability, and rollback tests — **[audit 2026-10-26] DONE**: reports.test.ts (incl. forced second-ledger-insert failure), WH-08, late-report-chain.
- [ ] Conduct full Arabic RTL responsive UI audit — **[audit 2026-10-26] MISSING** (after the Phase 9 redesign).
- [~] Audit application for proper error boundaries and user feedback — **[audit 2026-10-26] PARTIAL**: `app/[locale]/error.tsx` + `not-found.tsx` exist, no `app/global-error.tsx`; API never 500s on malformed ids/bodies (VAL-01..03); UI feedback not audited.
- [x] Run security check on role authorization barriers across all routes — **[audit 2026-10-26] DONE**: `owasp.test.ts` (role matrix derived from every handler), `same-origin-guard.test.ts`.
- [x] Audit environment variables and ensure `.env.example` is complete — **[audit 2026-10-26] DONE**: names only; `APP_PUBLIC_URL` and `MESSAGING_PROVIDER` added; `NEXTAUTH_URL` is not set in the dev `.env` (owner).
- [ ] Set up production monitoring, error logging, and health checks — **[audit 2026-10-26] MISSING** (launch; G-A09-2).
- [ ] Execute production deployment and verify live end-to-end functionality — **[audit 2026-10-26] MISSING** (launch; Layer 2 real payment only when the owner says).

## Execution log (updated as soon as real work happens)

### Scope corrections

- REMOVED — Zoom WebSocket lifecycle, event replay, and reconciliation tests.
- [MVP] Launch verification centers on approval-gated settlement, explicit attendance, immutable archives, manual links, authorization, uploads, backups, and staged handoffs.

### 2026-10-06 reconciliation

- Phase 8 remains Not Started. Playwright coverage, real-Postgres settlement/idempotency/rollback evidence, RTL/accessibility review, security audit, backup/restore verification, monitoring, and deployment runbook are not complete.
- Payment gateway verification belongs to the launch gate; it is not deferred. The browser checkout return is not authoritative, and signed provider events must be verified before invoice settlement.

### 2026-10-26 — Phase 8 session 1: gap list, priorities, test data safety, first runs

**Order:** Phase 8 runs BEFORE Phase 9 (owner). Tests may create/delete only per-run test academies and `demo_test_*` rows; the demo seed and its ledgers are never touched; no DB reset without the owner's OK; tests never call OpenWA.

**(a) Gap list — what Phase 8 needs vs what exists**

| Item | Before this session | Now |
|---|---|---|
| Jest suites (real dev DB, sequential) | 26 suites / 263 tests; 125 failing (stale after B3, H1–H7, A1, follow-up 1, new seed) | 30 suites; stale tests fixed without weakening any rule (see "Run results") |
| Known failing legacy tests (backlog 1–4) | report visibility, remark-list payload, worker FAILED-vs-SENT, INT-MON-02 | fixed: confirmed submit-time visibility; slug+labels payload; fake MessagingProvider; INT-MON-02 accepts the two documented race outcomes (409, or a 200 edit of the same row) |
| INT-WH-08 (webhook rollback) | needed a code seam (owner approval) | done WITHOUT a seam: the H5 one-INITIAL_PURCHASE-per-invoice index forces the ledger insert to fail inside settlement |
| Settlement rollback (2nd ledger insert) | none | done: 32-bit `payroll_ledger.amount_minor` overflow forces the teacher-credit insert to fail after the student deduction |
| Playwright | 1 spec (not 5); `E2E_*` credentials not set; depends on the OLD seed usernames; writes sessions in the SEED academy | not run — see (c) |
| Backlog IDs | Session 3–5 IDs unwritten | written now: CP-01/03/05/06/07/08, EV-08/10, CT-01, SS-05, JL-02, SO-03 (sweep), A1 webhook set (WH-01..12), Phase 7 page gates; the rest stay in `test-backlog.md` in priority order |
| Not started | RTL/UX audit, monitoring/health checks, deploy runbook, backup/restore drill, `fast-uri` audit | unchanged (later Phase 8 steps) |

**(b) Priority coverage (critical domains first)**

| Priority item | Test(s) |
|---|---|
| Duplicate claims / repeated approval | reports "repeated approval … alreadyHandled"; WH-02/03 |
| Concurrent approvals | reports "exactly one of two concurrent approvals wins", "approve vs reject race" |
| Teacher not assigned | reports "generic 404 for an unassigned teacher and a foreign teacher" |
| Report before scheduled end | reports "rejects a submission before the scheduled end" |
| Money fields locked after submission | reports "freezes the money-affecting fields", "REPORT_IMMUTABLE" |
| Absent ⇒ no ledger rows | reports "absent approval writes STUDENT_ABSENT with no ledger rows", "absent reports settle with zero money" |
| Rollback when the second ledger insert fails | reports "Phase 8 — settlement rollback" (NEW) |
| Late settlement / no package (CONFIRMED rule) | INT-EXP-08, SS-05 (NEW) |
| Paymob HMAC | WH-07 (bad and missing signature → 401, nothing stored) |
| order.id match | WH-01/01b; WH-06 (unknown order, merchant_order_id ignored) |
| Amount / currency | WH-04 / WH-04b (200 mismatch, no money, audit + Admin flag) |
| Replay / idempotency | WH-02, WH-03, WH-10 |
| Declined ⇒ no money | WH-05; WH-11 (pending, voided, refunded, invalid shape) |
| Anomaly ⇒ audit row + Admin flag | WH-04/04b, WH-12 |
| Complaints invisible to the concerned party | CP-01/03/05/07/08 + page gates (auth-rbac) |
| Evaluations never visible to the teacher | EV-08 (API 403), EV-10 (static: no teacher-reachable reader) |
| Click timeline Admin/Supervisor only | CT-01 |
| Supervisor never sees money | reports "supervisor … no money fields"; INT-BILL-01; INT-RATE-03; auth-rbac |
| Cross-origin guard | `same-origin-guard.test.ts`: every mutation route × (missing, foreign, wrong-port Origin) → 403 ORIGIN_NOT_ALLOWED before any session lookup |
| Login rate limits | auth-rbac "rate-limits both the username and IP" |
| Credentials never in URLs | `credentials-not-in-url.test.tsx` (login + change-password render `method="post"`) |

**(c) Playwright (`e2e/phase3.e2e.spec.ts`)** — UI-heavy journeys wait until after the Phase 9 redesign.
- Stable flows worth keeping (read-only, no data written): "landing page loads in English and Arabic", "protected pages redirect anonymous users", "anonymous API access is rejected", "wrong password does not log in"; role-boundary checks that only read/refuse ("teacher cannot open the admin sessions page", "a student who is not in the session cannot get its Zoom link", "students never receive the host link").
- Wait / rework: "Admin: create a session (UI)" and every test that CREATES or CANCELS sessions — they write into the seed academy through the running app (conflicts with the data rule) and use old-seed usernames. Needs dedicated E2E accounts in a test academy (owner decision) before they run again.

**(d) Test data safety — guards confirmed before the first run**
- `jest.setup.js`: refuses to run unless `DATABASE_URL`'s host is a Supabase dev host or exactly `TEST_ALLOWED_DB_HOST` (not set in `.env`).
- Per-run academies "Zarabicschool Test/Foreign <8 hex>"; cleanup now REFUSES any other academy (`assertTestAcademy`) before deleting anything; append-only tables use the in-transaction, per-academy trigger exception only.
- `applications-admin` must use the seed academy "Zarabicschool" (the public application route is hard-wired to it); it only creates/deletes `demo_test_`/`demo-test-` users and applications with its own test phone — proven by the seed snapshots.
- `webhook_events` (no academy) are tracked by exact id (18-digit test ids starting with 9).
- Seed snapshot (count + md5 of every seed-academy table, seed ledgers) before/after each run: unchanged in runs 1, 2 (and 3, see results).
- No test phone is on `OPENWA_SEND_ALLOWLIST`; a fake MessagingProvider is installed for every suite.

**(e) Real app bugs found and fixed (owner told)**
1. Login/change-password/two Admin create forms had no `method` → a pre-hydration submit would put credentials in the URL. Fixed: `method="post"`.
2. `admin/messages` POST and `admin/settings/whatsapp-number` PUT answered `FORBIDDEN` instead of `ORIGIN_NOT_ALLOWED` on a cross-origin request (still protected). Fixed: shared `requireSameOrigin`.
3. Complaints "another participant": a student's own siblings counted as another family. Fixed in `lib/complaints/service.ts`.
4. INT-EXP-08: a late settlement against a still-ACTIVE package outside its period wrote no deduction. Fixed per the owner's CONFIRMED option (a) in `settlement-seam.ts`.

**(f) Paymob checkout E2E — owner decision pending.** Proposal: keep a manual checklist for the hosted page now, and do ONE Paymob test-mode run when test keys exist (it also confirms the A1 callback shape, HMAC field order and the 3-DS pending→success sequence — the open A1 sandbox items).

### Decision: transaction timeouts (owner, 2026-10-26)
- **Decision:** the app keeps Prisma's default interactive-transaction limits (maxWait 2 s, timeout 5 s). Only the TEST configuration raises them (`__tests__/helpers/db-timeouts.setup.ts`: maxWait 15 s, timeout 30 s, via jest `setupFilesAfterEnv`).
- **Reason:** tests run from the dev machine against the remote dev database. Measured round trip ≈ 64 ms per statement (pooled `DATABASE_URL` and `DIRECT_URL`, 20 samples, 2026-10-26). A stall (busy pooler, a dev server worker on the same DB) pushed one settlement to 7.7 s in run 3. Settlement is atomic and idempotent, so a timeout is SAFE: the transaction rolls back completely and a retry (Paymob redelivery, or the Admin pressing approve again) settles once.
- **Statements per settlement transaction (counted from the code, readiness probes cached):**
  - Paymob webhook, success: 8 statements (event claim, invoice lock, invoice read, subscription, INITIAL_PURCHASE, invoice update, attempt update, PAID audit) + BEGIN/COMMIT = 10 round trips ≈ 0.65 s.
  - Report approval, attended with reservation: 14 statements (session share-lock ×2, report claim, attendance, session read, reservation read + update, deduction check + insert, balance aggregate, rate lookup, teacher credit, report markers, re-read) + BEGIN/COMMIT = 16 ≈ 1.0 s; +2 per Admin flag, +1–2 for the no-reservation fallback → up to ~20 ≈ 1.3 s.
  - Headroom against 5 s: about 4–7× in normal conditions. Production latency (app and DB in the same region) is expected to be far lower — to be measured at deploy (deploy checklist).

### 2026-10-26 — Coverage matrix (risk-ranked: money and attendance → permissions → the rest)
All automated tests run against per-run test academies (`demo_test_*` users) on the dev DB; tests never call OpenWA or Paymob. "Gap" = not covered by an automated test.

| Area | Edge cases | Tests | Status |
|---|---|---|---|
| **Ledgers — student credits** | idempotent purchase, one INITIAL_PURCHASE per invoice, concurrency, rollback when a ledger insert fails, negative balance + flag, no package, expiry/no rollover, pay-per-session never expires | WH-01..12, MP-01..07, INT-EXP-01..08, SS-05, reports "settlement rollback", L1-01 | Covered |
| **Ledgers — teacher pay** | one SESSION_CREDIT per session (group, sequential and concurrent), rate snapshot, per-minute rounding half-up, 32-bit limit, adjustments/disbursements idempotency + currency, append-only, overtime once + rollback | GRP-01..03, PAY-01..09, OT-01..05, reports settlement tests | Covered |
| Ledgers — student ADMIN_ADJUSTMENT / REFUND writers | — | — | **Gap by design**: no API writes them yet (refund family OPEN) |
| **Reports** | before end, unassigned teacher, cancelled/missed sessions, duplicate, freeze money fields, edit after approval, rejection/resubmit, concurrent approvals, absent ⇒ no money, group sessions, submit-time visibility | reports.test.ts, visibility, report-attachments, GRP-*, MG-03/04 | Covered |
| **Monthly reports** | 7-day window (lock), concurrent duplicate, reminders 1st/3rd, Admin flag days 4–7, field visibility | monthly-reports.test.ts, MR-01 | Covered (group-session pairs: covered only through distinct students per teacher) |
| **Scheduling** | overlaps/boundary touch, past dates, assignment rules, credit reservation + release, consumption order, recurrence across DST, cancel + reschedule moving jobs, Zoom link format | sessions.test.ts, session-requests, scheduling-worker, phase4 | Covered; **gap**: display formatting in non-Cairo timezones is not asserted (Phase 9 item 9.9) |
| **Roles / cross-academy** | every handler × every disallowed role → 403; unauthenticated → 401; money routes Admin-only; foreign-academy ids → 404; subject list tenancy | OW-A01-0..4, sweeps, per-suite foreign-academy tests | Covered (API). **Gap**: page-level rendering per role only for Phase 7 pages + Supervisor admin redirect |
| **Payments** | HMAC bad/missing, order-id match, unknown order, merchant_order_id ignored, amount/currency mismatch, declined/pending/void/refund, replay, concurrency, double payment, unexpected shape, rollback, annual plan disabled | WH-01..12, MG-01, INT-CO-* | Covered. **Gap**: the real Paymob callback shape/3-DS sequence (sandbox, Layer 2) |
| **Notifications** | retries 2/10 min + FAILED after 3, permanent failure, stale PROCESSING never re-sent, late-report chain, late start T+5/T+10, announcement per-tick + per-hour caps + daily limit, no Zoom link in WhatsApp | RTY-01..03, late-report-chain, LS-01..04, AN-*, MG-05, JL-01 | Covered |
| **Complaints / evaluations / click timeline** | concerned party never sees/handles, unnamed participant, no notification, evaluation window/lock/concurrency, teacher never sees evaluations, timeline operators only | CP-*, EV-01..08/10, CT-01 | Covered |
| **Input validation** | malformed/injection/over-long ids on every `[id]` route, empty/malformed/huge bodies, Arabic/RTL/emoji/HTML text stored literally, unicode control chars | VAL-01..03, EV-04 | Covered |
| **Security** | same-origin sweep, credentials not in URLs, headers, bcrypt cost, constant-time signatures, log redaction, no stack traces | OWASP suite (see security-review.md) | Covered (automatable part) |
| UI / browser | RTL layouts, forms, loading/empty/error states | — | **Gap**: Playwright UI journeys deferred until after the Phase 9 redesign (owner) |
| Operations | backups/restore, monitoring, production deploy | — | **Gap**: later Phase 8 steps (deploy checklist) |

### 2026-10-26 — Phase 8 session 1 result (run 4, dev stopped)
- **Full suite: 41 suites / 465 tests — 465 passed, 0 failed, 0 skipped, 1162.5 s** (`npm test -- --ci`, real dev DB, per-run test academies; tsc 0, lint 0).
- Seed data after the run: 190 seed rows, ledgers unchanged (subscription 8 rows sum 28; payroll 4 rows sum 47250); 0 test academies, 0 test users, 0 webhook_events left.
- Real defects found and fixed this session: credentials in URLs (forms without `method`), 10 routes 500 on malformed ids, payroll amount overflow 500, subjects listed across academies, two routes with the wrong cross-origin error code, evaluations 201 contract, complaint siblings rule, INT-EXP-08 settlement (owner option a).
- **NOT covered (honestly):** browser/UI journeys and RTL layout (Playwright waits for the Phase 9 redesign); timezone display outside Cairo; the real Paymob callback shape and 3-DS sequence (Layer 2 / sandbox); OpenWA end-to-end (live WhatsApp test is last); backups/restore, monitoring, production deploy; `npm audit` `fast-uri` (deferred); performance/load. "Everything is tested" is NOT claimed.

### Owner decisions (2026-10-27)
- **Paymob:** a manual checklist PLUS ONE real Paymob test-mode run (Layer 2) — APPROVED; Layer 2 starts only when the owner says so. The run also settles the open A1 sandbox questions (callback envelope + `?hmac=`, HMAC field order, 3-DS pending→success).
- **E2E accounts:** dedicated accounts in a per-run test academy, after Phase 9 — APPROVED.
- **X-Powered-By:** disabled (`poweredByHeader: false`), test OW-A02-2.
- **Console provider:** full message body in dev with temporary passwords and raw Zoom links masked; recipient = user id + last 3 digits; production start FAILS with `MESSAGING_PROVIDER=console|fake` (`lib/config/messaging-mode.ts`, called from `instrumentation.ts`); tests MSG-04..08.

**Paymob manual checklist (before/at Layer 2):**
- [ ] Paymob dashboard: integration "Transaction processed callback" = `https://<public host>/api/payments/paymob/webhook`; "Transaction response callback" = the platform return page.
- [ ] `PAYMOB_HMAC_SECRET` in the env equals the dashboard HMAC secret (compare without printing).
- [ ] `APP_PUBLIC_URL` / tunnel running and reachable at payment time; `next dev` running.
- [ ] One test-card payment: webhook row PROCESSED, invoice PAID, one INITIAL_PURCHASE, PAID audit row.
- [ ] One declined test card: `<txn>:FAILED` IGNORED row, invoice PENDING, no money.
- [ ] Reconcile order 640087357 (invoice 2e4ca7e1…) in the dashboard first (charged or not).
