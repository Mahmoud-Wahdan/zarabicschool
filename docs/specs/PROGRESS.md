# Zarabicschool — Project Progress

> **Protocol:** Always read this file first in any new session. After completing any meaningful chunk of work, update the status table and the current phase's spec file. Never regenerate this file from scratch — extend it.
>
> Last updated: 2026-10-06

## Phase Status

| # | Phase | Status | Last Updated | Note |
|---|-------|--------|--------------|------|
| 1 | Foundation | Complete | 2026-10-06 | Auth/RBAC, username login, forced-password and Supervisor boundaries verified; development DB seeded; 40 tests, clean handle exit, static checks, and build pass |
| 2 | Educational Management | In Progress | 2026-10-06 | Application/provisioning slice and profile migration verified on development DB; CRUD/profile surfaces and integration coverage remain |
| 3 | Schedules & Sessions | In Progress | 2026-10-06 | Initial Session/SessionStudent schema slice added; APIs/UI, migration, recurrence, replacement, and tests remain |
| 4 | Live Learning (Zoom links) | Not Started | 2026-09-30 | Reduced to manual links and authorized redirect |
| 5 | Session Reports & Attendance | Not Started | 2026-09-30 | Reports are attendance evidence and pay trigger |
| 6 | Financial Management | In Progress | 2026-10-06 | Paymob EGP checkout/webhook and initial subscription settlement slice verified; reports/payroll and migration remain |
| 7 | Admin & Reports | Not Started | 2026-09-28 | — |
| 8 | Testing & Launch | Not Started | 2026-09-28 | — |

## Current Active Task

Current work is the schema-first implementation and payment-gateway slice on branch `feature/phase-1-foundation`. Phase 1 is closed. The public application forms/API and Admin review/provisioning slice remain in the working tree. Paymob EGP checkout/webhook code and the USD provider abstraction are implemented and verified with focused tests. Implementation target is `webapp/`; root `docs/` contains project documentation.

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

## Action Items

- [ ] Rotate any exposed secrets before real data is stored; no Zoom API secrets are required.
- [ ] Confirm `NEXTAUTH_SECRET` is configured; `JWT_SECRET` is not used because authentication is Auth.js only.
- [ ] Decide the timed-notification scheduler: BullMQ + Redis versus database polling.
- [x] Confirm Supabase as the final Postgres host: Confirmed.
- [x] Ensure `.env` is in `.gitignore` and create `.env.example` with variable names only.
- [x] Align context/spec documentation with external Zoom links, no video recordings, and teacher mobile dashboard requirements.
- [x] Update payroll rule: Admin/Supervisor-approved teacher report triggers scheduled-duration hourly credit and student deduction in one transaction; submission alone has no financial effect.
- [x] Remove Zoom event, attendance threshold, overlap-billing, recording, and reconciliation requirements from the documentation.
- [x] Confirm application fields (FINAL, 2026-10-03) and TeacherRates design (effective-dated table, Phase 6). Still open: login identifier (username PROPOSAL), report values, attachment cap, rounding, zero-session mechanism.
- [x] Confirm unified immutable Reports: Teacher + Student + Session FKs; `SUBMITTED → REJECTED → SUBMITTED` or `APPROVED → ARCHIVED`; Admin/Supervisor approval gates settlement; no revision/version table.
- [x] Confirm SessionStudents is the persisted attendance source; evaluations are separate and missing evaluation is not absence.
- [ ] Decide whether student evaluation is mandatory after every completed session.
- [ ] Confirm the development database before applying `20261004000000_phase2_profiles`.

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
