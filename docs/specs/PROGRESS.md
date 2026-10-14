# Zarabicschool — Project Progress

> **Protocol:** Always read this file first in any new session. After completing any meaningful chunk of work, update the status table and the current phase's spec file. Never regenerate this file from scratch — extend it.
>
> Last updated: 2026-10-13

## Phase Status

| # | Phase | Status | Last Updated | Note |
|---|-------|--------|--------------|------|
| 1 | Foundation | Complete | 2026-10-06 | Auth/RBAC, username login, forced-password and Supervisor boundaries verified; development DB seeded; 40 tests, clean handle exit, static checks, and build pass |
| 2 | Educational Management | Complete | 2026-10-06 | CRUD, relationships, enrollment UI, migration, and development seed verified; Supervisor application access removed; database-backed tests deferred |
| 3 | Schedules & Sessions | Complete | 2026-10-11 | Closed by the owner after the manual test. Batches 1-4 verified: scheduling-assignments schema/migration (owner-applied), detailed error codes with offending ids, shared Zoom format validation, smart session forms, assignments hub, approval-time teachers, worker, demo seed (4× idempotent), clear-demo verified, E2E spec staged; final checks green (validate/typecheck/lint 10 suites / 111 tests/build) |
| 4 | Live Learning (Zoom links) | In Progress | 2026-10-13 | Implementation + tests complete (12 suites / 149 tests green; gap review in review-before-phase-04.md); owner steps pending: apply migration `20261012000000_phase4_link_audit` (activates link-change audit writes + their test assertions) and the manual test |
| 5 | Session Reports & Attendance | In Progress | 2026-10-11 | Teacher per-student submission and review API/UI implemented; late-report reminders + LATE_REPORT red mark were built early in Phase 3 and are NOT yet reviewed as Phase 5 work; queue, tests, and settlement handoff remain |
| 6 | Financial Management | In Progress | 2026-10-06 | Paymob EGP checkout/webhook and initial subscription settlement slice verified; reports/payroll and migration remain |
| 7 | Admin & Reports | Not Started | 2026-09-28 | — |
| 8 | Testing & Launch | In Progress | 2026-10-11 | Playwright installed (owner-approved exception), e2e/ specs + config + CI workflow staged; owner completed the E2E test round; full suite 10 suites / 111 tests green |

## Current Active Task

**Phase 4 (Live Learning via manual Zoom links) is implemented and verified — awaiting the owner's closing steps.** Everything from the 2026-10-12 gap review is built: 15-minute join window (config constant, Admin/Supervisor exempt) in the redirect and the role UIs; click-log failure isolation; 30/min per-user join rate limit; `?host=1` host-link variant (assigned teacher/Admin/Supervisor only, students/guardians get the generic 404); dedicated audited `PATCH /api/sessions/:id/link` plus the same audit on the general PATCH; series "apply link to upcoming" (`PATCH /api/sessions/recurrences/:id/link`) touching only future non-cancelled sessions and the recurrence rule; same-link overlap warnings (save-time + admin list, never blocking); role session pages rebuilt with i18n/RTL, window-aware buttons, teacher today's classes with a Zoom button beside each student, per-child guardian view, and loading/error routes. The new tests exposed and fixed a latent Phase 3 bug (operator joins 404'd — `OR: [{}]` matches nothing in Prisma's query compiler). Verification 2026-10-13 from `webapp/`: `prisma validate` valid; `typecheck` clean; `lint` clean; `npm test` 12 suites / 149 tests; `npm run build` succeeds. **Owner to do:** (1) apply migration `20261012000000_phase4_link_audit` from `webapp/` (`npx prisma migrate deploy`, DIRECT_URL) — until then audit writes and the audit test assertions stay deactivated with a visible warning; (2) run the manual test of the join/link flows, then close Phase 4. Next after closure: Phase 5 (session reports & attendance review of the early-built reminder/red-mark chain) and Phase 6 settlement handoff.

Verification on 2026-10-05: `webapp` typecheck and ESLint pass. The initial Jest run exposed a concurrent approval timeout, two application tests receiving `400` instead of the expected honeypot/rate-limit success, and an empty `lib/request.test.ts`; these were recorded as integration/test follow-ups.

Verification on 2026-10-06: Prisma client generation and schema validation pass after adding the initial payment models; `webapp` typecheck and ESLint pass; focused Paymob tests pass (3/3). No migration or seed command was run.

Focused verification on 2026-10-06: from `webapp`, `npm run typecheck`, `npm run lint`, `npx prisma validate`, `npm run build`, and the Paymob Jest suite (3/3) pass. The full Jest suite was not rerun in this review; its previously recorded failures remain open and are unrelated to the payment slice. No migration or seed command was run.

Foundation/application verification on 2026-10-06: full Jest now passes (`4` suites, `33` tests) after allowing filled honeypots to reach the route's silent fake-success branch, adding request helper tests, and giving the deliberately multi-round concurrent provisioning test a suitable timeout. Jest still reports open handles after completion; the suite exits successfully, so handle cleanup remains a test-harness follow-up. `npm run typecheck` and `npm run lint` also pass after these changes.

Phase 1 implementation pass on 2026-10-06: proxy now enforces the `must_change_password` gate before protected localized routes, in addition to DAL/server checks. A stray test-file token was removed; the full Jest suite remains green at 33/33, and Prisma validation, typecheck, and lint pass. Dedicated Auth.js/RBAC integration coverage and seed/migration execution remain open.

Owner status clarification on 2026-10-06: phases are closed only after their documented requirements, migrations, authorization boundaries, tests, and review are actually verified. The current repository evidence does not support marking all prior phases complete: Phases 1–2 still have recorded verification/integration gaps, Phases 3–5 and 7–8 have not been implemented as complete slices, and Phase 6 remains in progress.

Documentation reconciliation on 2026-10-06: phase specifications now explicitly record the current gaps and Context alignment. Supervisor is operational-only without money or Admin/Supervisor-management permissions; manual Zoom links and optional click evidence are non-authoritative; reports are per student and approval-gated; Paymob is MVP scope rather than deferred. No implementation status was promoted to complete by this documentation pass.

Implementation update on 2026-10-06: added the initial Phase 3 Prisma session slice (`Session`, `SessionStudent`, `SessionJoinClick`, status/type/attendance enums, manual Zoom link fields, replacement/recurrence metadata, and restrictive relations). `npx prisma validate` and `npm run typecheck` pass; no migration was generated or applied.

Development database reset and seed verification on 2026-10-06: after explicit owner confirmation, `prisma migrate reset --force` rebuilt the confirmed development database and applied all four migrations. Base seed created the academy/Admin from environment-provided credentials; the demo seed populated 1 academy, 5 users (Admin, Supervisor, Guardian, Student, Teacher), 5 subjects, linked profiles, 1 teacher-subject assignment, 1 subscription, 1 subscription-ledger entry, 1 pending invoice, 1 payment attempt, 1 session, 1 session-student row, 1 join-click audit row, and 1 application. No production database was targeted.

Final Phase 1 closure on 2026-10-06: added focused Auth.js/RBAC coverage for username-only authentication, inactive users, username+IP throttling, forced-password gates, Supervisor operational boundaries, and proxy redirects. Added explicit Prisma client/pool cleanup for integration suites and hardened provisioning-test cleanup for stale development records. Migration status and Prisma validation pass; typecheck, lint, full Jest with `--detectOpenHandles` (`5` suites/`40` tests), and production build pass. Phase 1 is Complete. Playwright journeys and shared rate-limit infrastructure remain Phase 8/deferred scope.

Post-closure auth fix on 2026-10-06: fixed the forced-password redirect loop caused by a stale Auth.js JWT after the password update; the change-password form now refreshes the credentials session before redirecting to the role dashboard. Added a request-level in-memory limiter in `proxy.ts` for dynamic page and API requests (120 requests per IP per minute), while endpoint-specific limiters remain in place.

Role dashboard data pass on 2026-10-06: replaced the Supervisor placeholder cards with academy-scoped application status counts, active profile counts, active subject count, and a recent application table. Admin now fetches open applications and active profile/subject totals; Teacher fetches assigned subjects and upcoming sessions with enrolled students; Student fetches upcoming session attendance rows; Guardian fetches linked children, upcoming sessions, and remaining sessions computed from active subscription ledger entries. Reports, homework, salary history, and other features without models remain explicitly unavailable until their documented phases add the required schema.

Phase 2 control-surface pass on 2026-10-06: retained `ADMIN` as the internal full-control role and presented it as SuperAdmin in the UI. Added academy-scoped SuperAdmin CRUD for Admin/Supervisor accounts with direct privileged provisioning, activation/deactivation, self-lockout protection, and last-active-SuperAdmin protection. Fixed Supervisor application actions by allowing the already-authorized operational `/admin/applications` routes through the proxy. Added centralized dashboard status/metric tokens and metrics-first SuperAdmin/Supervisor presentation. Educational profile CRUD and Teacher–Subject relationship management remain open.

Phase 2 subject CRUD slice on 2026-10-06: added academy-scoped Subject creation, update, activation/deactivation, duplicate-slug conflict handling, localized Admin UI, and management validation tests. Student/guardian/teacher CRUD and Teacher–Subject relationship management remain open.

Phase 2 profile/relationship pass on 2026-10-06: added academy-scoped Student, Guardian, and Teacher CRUD surfaces with temporary-password account creation and safe activation/deactivation, guarded Guardian–Student linking, duplicate-protected Teacher–Subject assignment with UI, and SessionStudent enrollment APIs with academy/subject/unique-pair safeguards. Management Zod schemas, typecheck, lint, build, and focused validation tests pass. Enrollment management UI and database-backed authorization/relationship tests remain.

Brand alignment pass on 2026-10-06: reconciled the Context with the supplied logo variations, clear-space rule, 60/30/10 color guidance, and typography guidance. Added nullable logo-variation slots in site configuration and removed the code-drawn mihrab fallback; approved brand exports remain required before real logo assets are wired.

## 2026-10-07 Phase 3 review + continuation

- [VERIFIED] Review of the uncommitted Phase 3 work produced a 30-item findings table (R1–R30). The owner approved: Admin PAUSED flag = UI + WhatsApp, replacement releases source reservations, R1 period fix as a dependency-only change to `lib/payments/settlement.ts`, worker via `instrumentation.ts`, dedicated `feature/phase-3` branch.
- [VERIFIED] Prior uncommitted work secured in logical commits on `feature/phase-3`; baseline recorded (validate/typecheck/lint/test/build).
- [VERIFIED] R1: `settlePaidInvoice` sets `periodStartsAt`/`periodEndsAt` (monthly and annual = one-month window; pay-per-session = none) via `lib/credits/period.ts`; seed subscriptions now carry periods, a ledger-consistent reservation, and notification jobs.
- [VERIFIED] Migrations applied to the development database and verified directly: `phase3_session_reservations`, `phase3_integrity` (edited before apply: nullable `notification_jobs.session_id`, unique `dedup_key`), `phase3_worker_support` (TeacherFlags). Partial unique indexes, CHECKs, reservation status-consistency CHECK, append-only trigger on `subscription_ledger`, and enums `CONSUMED`/`EXPIRY`/`ANNUAL_PLAN` confirmed in the DB.
- [VERIFIED] R9: weekly generation is DST-safe (same LOCAL wall clock in `Session.timezone` converted to UTC; the `+7*24h` addition is gone). R5: a failed week rolls back atomically and pauses the series. R6/R7/R21: idempotent cancellation, pending-job cancellation on cancel, reminder-job moves on reschedule, replacement releases the missed source's reservations.
- [VERIFIED] R22/R23/R24: approval route uses `getMessagingProvider()`, OpenWA reads env at call time, timezone-aware Arabic messages, redacted credential-failure rows. R10/R17/R18: https-only Zoom URLs, join route requires SCHEDULED, update schema allows only SCHEDULED→CANCELLED. R26: viewer-timezone display on the four session pages. R27/R28/R16: change-request review API + admin queue, admin recurring-series UI (created/pending weeks, PAUSED, reschedule, filters), student/guardian join links via the authorized redirect.
- [VERIFIED] Worker: `instrumentation.ts` → `lib/worker/start.ts` (60s DB polling, no Redis): due jobs (idempotent `dedup_key` claim), session reminder/start via `MessagingProvider`, late-report reminders T+0/T+15 + LATE_REPORT flag at T+30, series continuation when credit exists (14-day horizon, unique `(series, week_index)`).
- [VERIFIED] Final checks from `webapp/`: `npx prisma validate` valid; `npx prisma migrate status` up to date (8 migrations); `npm run typecheck` clean; `npm run lint` clean; `npm test` 8 suites / 71 tests passing with a clean exit (no open handles); `npm run build` succeeds (Next.js 16.3.7).
- [VERIFIED] Database-backed tests (`__tests__/api/sessions.test.ts`, `__tests__/worker/scheduling-worker.test.ts`) cover the 12 required scenarios plus review regressions (concurrent last-credit booking, group rollback, series cap/pause/resume, duplicate-week guard, double cancel, replacement, cross-academy/role, teacher request-only, Zoom exposure, status transitions, https, reschedule job moves, consumption order, re-reserve flip, R1 settlement idempotency). Cleanup deletes only per-run `demo_test_*` academies; `subscription_ledger` cleanup uses a transaction-scoped trigger disable (never disabled globally).
- [OPEN/DEFERRED — out of Phase 3 scope]: settlement/CONSUMED writes (Phase 5/6), monthly EXPIRY writer + annual-plan monthly-grant wiring (Phase 6b/0), payroll append-only trigger (Phase 0/6), full NotificationLog audit store (Phase 0/5), failed-send retry/backoff (accepted MVP gap), Playwright E2E journeys (Phase 8).

## 2026-10-13 Phase 4 implementation + verification

- [VERIFIED] Gap review first (`review-before-phase-04.md`): redirect core, URL validation, host-link filtering, and click logging already existed from Phase 3; only the gaps were built.
- [VERIFIED] Join window (T-15min → scheduled end, `JOIN_OPENS_BEFORE_START_MINUTES` config constant; Admin/Supervisor exempt) in `GET /api/sessions/[id]/join` and window-aware UI controls (`SessionJoinLink`) so users never land on the JSON 403.
- [VERIFIED] Click-log isolation: failed insert logs without the link and never blocks the redirect; 30/min per-user join rate limit (429 RATE_LIMITED); `?host=1` variant for the assigned teacher/Admin/Supervisor only (students/guardians get the generic 404).
- [VERIFIED] Audited link editing: `PATCH /api/sessions/[id]/link` + the same audit on the general PATCH; series apply `PATCH /api/sessions/recurrences/[id]/link` updates only future non-cancelled sessions and the recurrence rule (worker weeks inherit); overlap warnings (`ZOOM_LINK_OVERLAP`) returned at save time and shown in the admin list — never a block.
- [VERIFIED] Role UIs: teacher today's classes (viewer-timezone day) with a Zoom button beside each student + host-start; student + per-child guardian views; admin link editor + series apply + overlap chips; localized statuses/types; loading/error routes; i18n ar/en + RTL.
- [FOUND+FIXED] Latent Phase 3 bug surfaced by the new matrix tests: operator joins always 404'd because `OR: [...(operator ? [{}] : [])]` matches nothing in Prisma's query compiler — fixed with the list route's top-level conditional-spread scoping. Scenario 11 in `sessions.test.ts` moved its join-eligible sessions into the window (commented) to keep testing authorization under the CONFIRMED window contract.
- [VERIFIED] Final checks from `webapp/`: `npx prisma validate` valid; `npm run typecheck` clean; `npm run lint` clean; `npm test` 12 suites / 149 tests green (baseline 10/111 — +38); `npm run build` compiles successfully.
- [OPEN — owner] Migration `20261012000000_phase4_link_audit` (SessionLinkAudits, URL-less, source CHECK, RESTRICT FKs, no append-only trigger by design — database-schema.md §11) is generated but NOT applied. Until applied: audit writes are skipped with a visible warning (`lib/scheduling/link-audit.ts`), audit test assertions deactivate with a `[phase4-test] PENDING MIGRATION` notice, and gated cleanup in the test fixtures + `db:clear:demo` keeps working. After applying, re-run `npm test` to see the audit assertions activate.
- [OPEN — owner] Manual test of the join/link flows, then close Phase 4.

## Action Items

- [ ] Rotate any exposed secrets before real data is stored; no Zoom API secrets are required.
- [ ] Confirm `NEXTAUTH_SECRET` is configured; `JWT_SECRET` is not used because authentication is Auth.js only.
- [x] Decide the timed-notification scheduler: database-polling worker confirmed (CONTEXT §10, 2026-10-06); implemented in Phase 3 via `instrumentation.ts` (no Redis/BullMQ).
- [x] Confirm Supabase as the final Postgres host: Confirmed.
- [x] Ensure `.env` is in `.gitignore` and create `.env.example` with variable names only.
- [x] Align context/spec documentation with external Zoom links, no video recordings, and teacher mobile dashboard requirements.
- [x] Update payroll rule: Admin/Supervisor-approved teacher report triggers scheduled-duration hourly credit and student deduction in one transaction; submission alone has no financial effect.
- [x] Remove Zoom event, attendance threshold, overlap-billing, recording, and reconciliation requirements from the documentation.
- [x] Confirm application fields (FINAL, 2026-10-03) and TeacherRates design (effective-dated table, Phase 6). Still open: login identifier (username PROPOSAL), report values, attachment cap, rounding, zero-session mechanism.
- [x] Confirm unified immutable Reports: Teacher + Student + Session FKs; `SUBMITTED → REJECTED → SUBMITTED` or `APPROVED → ARCHIVED`; Admin/Supervisor approval gates settlement; no revision/version table.
- [x] Confirm SessionStudents is the persisted attendance source; evaluations are separate and missing evaluation is not absence.
- [x] Decide whether student evaluation is mandatory after every completed session: MANDATORY, filled by the student (owner, 2026-10-07 — CONTEXT §7.7); Phase 7 scope.
- [ ] Confirm the development database before applying `20261004000000_phase2_profiles`. *(Resolved: applied during the confirmed 2026-10-06 reset.)*

## 2026-10-03 Confirmed owner decisions (all marked CONFIRMED in CONTEXT.md §7 and the phase-02 spec)

1. **Application fields (FINAL):** Guardian: `full_name`, `phone_whatsapp`, `email` (optional), `timezone`, `preferred_language`, `children[] {name, age, subjects[]}`, `preferred_times` (optional), `notes` (optional). Student: `full_name`, `date_of_birth`, `phone_whatsapp`, `timezone`, `preferred_language`, `subjects[]`, `level`, `preferred_times` (optional), `notes` (optional); if under 18: `guardian_name`, `guardian_phone`, `guardian_relationship` (father|mother) required. Teacher: `full_name`, `phone_whatsapp`, `email` (optional), `timezone`, `preferred_language`, `subjects[]`, `years_experience`, `qualifications`, `available_times` (optional), `notes` (optional) — `expected_hourly_rate`/`currency` removed (pay agreed with Admin by human contact, entered by Admin later). Honeypot, size limit, per-IP rate limit kept.
2. **Provisioning:** every child gets their own username + temporary password; a guardian application with N children = 1 guardian user + N student users, created in ONE transaction (all or nothing) and idempotent.
3. **Guardian linking:** Admin links a student to an existing guardian or creates the guardian in the same approval step; manual adds from the dashboard any time (guardian, student, teacher, subject, another admin); credentials shown to Admin ONCE, delivery by WhatsApp later via `MessagingProvider` (fake provider only).
4. **Site config:** logo still being made and contact info comes later — clearly marked placeholders in a site config module; invent nothing (no claims, no prices).
5. **Database for tests:** NO Docker and NO separate test database — the owner's Supabase DB used directly (contains no real data). `db:seed:demo` (academy, admin, demo guardians/students/teachers; every demo username starts with `demo_`), `db:clear:demo` deletes ONLY `demo_*` records, tests create unique `demo_test_*` records and delete them afterwards. **Phase 6 exception (documented, implemented only in Phase 6):** after append-only ledgers exist, demo data can still be cleared with these guards: (1) only records linked to `demo_*` users/teachers; (2) only via the dedicated `db:clear:demo` script — the append-only trigger is NEVER dropped or disabled globally; (3) abort if any non-demo record references the same session/report/subscription; (4) explicit `--confirm` flag and print the counts first; (5) refuse to run when `NODE_ENV=production`.
6. **TeacherRates = effective-dated table** (`id, teacher_id, hourly_rate_minor, currency, effective_from, created_by`) — CONFIRMED. Built in Phase 6, NOT now. Rate rule CONFIRMED: a session is paid with the row whose `effective_from <=` the SESSION's scheduled start (not the approval time); the ledger credit stores `hourly_rate_snapshot_minor`.

## 2026-10-05 Applications slice status

- The current working tree contains the confirmed application fields, public submission form/API protections (same-origin, size limit, honeypot, rate limit, duplicate check, subject validation), the Phase 2 profile schema, and the un-applied profile migration.
- The Admin list is available at `/[locale]/admin/applications`; the Admin dashboard card links to it. The detail page renders contact/application data and provides localized review, rejection, approval, and one-time credential surfaces.
- Approval is intended to create the guardian/student/teacher profiles and all child accounts in one transaction. Real-Postgres integration verification remains pending because the migration has not been applied.
- The fake messaging provider is used for the current slice. Passwords are returned only in the approval response for the Admin's one-time display and are not written to logs or notification content.
- Remaining before this slice is complete: fix the failing tests, apply and verify the migration after database confirmation, verify rollback/concurrency behavior, and add the remaining Admin CRUD/profile management surfaces.

## 2026-10-03 Phase 1 audit and gap fixes

- Phase 1 audited against the repo: typecheck, lint, build, and `prisma migrate status` verified clean; tests and next-intl were missing.
- Audit deviations: init migration includes the Phase 2 `applications`/`subjects` tables; auth is next-auth v4 with username-first login; `Users` has `username` + nullable email (differs from `database-schema.md`).
- Gap fixes committed on `feature/phase-1-foundation`: branch created; previous work committed separately (docs `16b8371`, Phase 1 `118e4d6`, Phase 2 `14ec222`); `docs.zip` removed; `!.env.example` added and `.env.example` committed; three broken npm scripts deleted (`prisma migrate status`/`reset` cover them); login now redirects to the role dashboard.
- Blocked on owner: secrets rotation (seed not run), brand logo files, landing-page copy (what the academy teaches, contact info), final application form fields.

## 2026-09-30 Documentation Update

- Prompt A: corrected the schema, business model, and progress index for manual Zoom links, report-based attendance, prepaid sessions, hourly pay, append-only ledgers, and raw SQL constraints.
- Prompt B: phase-spec upgrade is next and must consume the corrected schema without editing it.

## 2026-09-30 Report Architecture Update

- Reports are one immutable historical entity linked to Session, Teacher, and Student. Rejected reports return to the teacher for correction; approved reports settle atomically and become archived.
- Settlement requires Admin or Supervisor approval, is idempotent, and rolls back both ledger effects on failure. Completed sessions may have missing reports; group sessions may include approved absent students with no financial rows.

## 2026-10-06 Documentation Sweep

- Confirmed the final report flow across context, instructions, business model, schema, and phases: teacher submission enters an approval queue; Admin or Supervisor approval is the only settlement gate.
- Documented per-student attendance reports for group sessions, explicit `STUDENT_ABSENT` outcomes, and operational interruption facts (late entry, early exit, outage, disconnection, reconnection) as review evidence rather than automatic attendance.
- Corrected the teacher payroll uniqueness rule to one `SESSION_CREDIT` per session and retained one student deduction per `(session, subscription)`. Missed/absent approved reports create no earning and no deduction.
- Clarified Supervisor permissions: may review/approve operational reports but receives no money fields and cannot perform payroll, adjustments, reversals, refunds, or payouts.
- Added Prompt C to `docs/PROMPTS.md` for future documentation consistency sweeps. No application code, Prisma schema, migrations, dependencies, or mock data were changed.

## 2026-10-06 Phase 6 Payment Gateway Review

- [MVP] Reviewed the complete payment slice currently in the working tree: provider contracts, Paymob checkout/HMAC verification, USD provider boundary, invoice checkout authorization, webhook settlement, Prisma payment models, Supervisor routing, and focused tests.
- [VERIFIED] Paymob EGP uses hosted checkout and signed webhook settlement; the browser checkout response does not mark an invoice paid.
- [VERIFIED] Settlement validates invoice ownership fields, provider, currency, amount, and pending state, then atomically creates the subscription, writes `INITIAL_PURCHASE`, marks the invoice paid, and records the payment attempt.
- [VERIFIED] Invoice settlement uses a database row lock and paid-state idempotency guard; duplicate/concurrent delivery cannot create a second subscription for the same invoice.
- [VERIFIED] USD checkout fails explicitly with `NOT_CONFIGURED`; it has no success-shaped fallback. Supervisor routes do not expose payment or payroll actions.
- [VERIFIED] `npm run typecheck`, `npm run lint`, `npx prisma validate`, `npm run build`, and Paymob tests (3/3) pass from `webapp`.
- [BLOCKED] The full Prisma schema, raw SQL migration constraints/triggers, invoice UI, report approval settlement, payroll ledger, and real-Postgres settlement integration tests are not complete. Do not mark Phase 6 complete or run migrations/seeds yet.

## Post-delivery SaaS roadmap

Documented only for now: multi-academy onboarding and billing, tenant administration, RLS and tenant switching, tenant-scoped uniqueness, provider configuration, and an optional future Zoom verification layer. No current phase creates tasks for this roadmap.
