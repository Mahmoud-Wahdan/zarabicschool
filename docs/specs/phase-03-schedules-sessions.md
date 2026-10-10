# Phase 3 — Schedules & Sessions

## Goal

Schedule creation, upcoming sessions, session log. (CONTEXT.md §13, Phase 3.)

Build the session scheduling engine: Admin creates private (1:1) and group (1:N) sessions, configures weekly recurring schedules, assigns teachers, subjects, and students, handles replacement sessions for technical outages, and provides role-scoped schedule views.

## Proposed approach

1. **Database Migrations:** Add `Sessions` and `SessionStudents` tables to Prisma schema, with fields for recurring schedules (`is_recurring`, `recurrence_rule`) and replacement sessions (`replacement_for_session_id`, `cancellation_reason`).
2. **Session Creation Workflow (Admin):**
   - Single session creation: select teacher, subject, type (private vs. group), students, date/time, and duration.
   - **Weekly Recurring Schedule Engine:** Admin defines a weekly pattern (e.g. Mon & Thu at 18:00 for 8 weeks), generating session batches automatically.
3. **Replacement Session Management:**
   - Admin UI to mark an unheld session as missed due to technical outage or absence.
   - Admin creates a replacement session linked via `replacement_for_session_id` to ensure audit integrity.
4. **Schedule Views by Role:**
   - **Admin:** Comprehensive calendar and list view, filterable by teacher, student, subject, status, or date.
   - **Teacher:** Personal schedule of upcoming and past sessions with assigned students.
   - **Student:** Upcoming sessions, past attendance records, and direct session access.
   - **Guardian:** Consolidated calendar across all linked children.
5. **Timezone Localization:** Convert and display all session times according to the viewer's local timezone.

Delivery stage: Stage 1.

## Acceptance criteria

- Admin can create private/group sessions with a required pasted Zoom link, valid duration, participant assignments, status, replacement link, and recurrence group.
- Scheduling/generation blocks beyond prepaid balance or requires an audited Admin override; all viewers see UTC-converted times in their IANA timezone.

## Frontend

Routes: `/admin/sessions/new`, `/admin/sessions`, `/teacher/sessions`, `/student/sessions`, `/guardian/sessions`. Forms expose link secrecy, loading/empty/error states, recurrence, replacement, filters, and mobile calendar/list views with RTL/i18n.

## Backend

POST `/api/sessions`, POST `/api/sessions/recurrences`, POST `/api/sessions/:id/replacement`, PATCH `/api/sessions/:id`, GET role-scoped lists. Zod validates time intervals, URL, participants, recurrence, and status transitions. Return consistent 400/401/403/404/409 errors.

## Database

Touches `Sessions` and `SessionStudents`: required `zoom_join_url`, optional `zoom_host_url` (OPEN), `recurrence_group_id`, replacement fields, attendance status, and duration checks. Recurrence copies links as a proposal. No Zoom API fields or event tables.

## Auth & Authorization

| Role | Create/edit sessions | View assigned sessions | View Zoom link | Create replacement |
|---|---:|---:|---:|---:|
| Admin | Yes | Yes | Yes | Yes |
| Teacher | No | Assigned only | Assigned only | Request only |
| Student/Guardian | No | Authorized only | Student link only | Request only |

Enforce ownership and academy scope on the server.

## Security

Never log Zoom links; validate URL and participant ownership; prevent unauthorized recurrence access; use UTC storage and IANA display; protect minor/student data; rate-limit mutations.

## Transactions & failure handling

Create a session and its participants atomically. A recurrence batch either records its audited result or reports which generated rows failed. A replacement must reference an existing missed/cancelled session.

## Tests

Unit: duration/status/recurrence validation. Integration: unauthorized link access, invalid status transition, recurrence link copying, replacement linkage, prepaid-limit block, and Admin override audit. Playwright: Admin creation and role-scoped schedules on mobile.

## Learning checkpoint

- Why store UTC while keeping an IANA timezone on Users?
- What must be audited when an Admin schedules beyond remaining sessions?

## Open decisions

- Zero-session reservation/blocking mechanism.
- Whether `zoom_host_url` is stored and whether guardians see links.
- Whole-series edit behavior.

## Deferred / Post-MVP

- [DEFERRED] Edit-whole-series tools if they exceed MVP scope.

## Definition of Done

Requirements, authorization, validation, failure paths, tests, lint, typecheck, build, reviewed diff, and this phase's execution log are complete.

## Tasks

- [x] Add Prisma schema: `Sessions`, `SessionStudents` *(existing session slice plus credit reservation model)*
- [x] Run migration *(all Phase 3 migrations applied and verified on the development database 2026-10-07: `phase3_session_reservations`, `phase3_integrity` (edited before apply: nullable `notification_jobs.session_id` + unique `dedup_key`), `phase3_worker_support` (TeacherFlags))*
- [x] Build Admin single session creation UI (1:1 and group 1:N)
- [x] Build Admin weekly recurring session generator (series-based: `RecurrenceSeries` + per-week generation capped at available credit, PAUSED + admin flag)
- [x] Build Admin replacement session creation flow (`replacement_for_session_id`; releases the source's active reservations for carried-over students inside the same transaction)
- [x] Build Admin session management list (filters by date range/teacher/student/status, reschedule UI that moves reminder jobs, cancel flow that cancels pending jobs)
- [x] Build Teacher schedule dashboard (Zoom button through the authorized `/api/sessions/[id]/join` redirect)
- [x] Build Student schedule dashboard (join link through the authorized redirect; no raw Zoom links)
- [x] Build Guardian consolidated schedule dashboard (join link visible per owner decision 2026-10-07)
- [x] Implement timezone-aware schedule display for all roles (viewer's `User.timezone` via `Intl.DateTimeFormat`; UTC storage unchanged)
- [x] Add Zod validation schemas for single and recurring session inputs (https-only Zoom URLs; status enum limited to SCHEDULED/CANCELLED)
- [x] Write tests: session CRUD, recurring generation, replacement session linking, authorization (database-backed Jest against the development database: `__tests__/api/sessions.test.ts`, `__tests__/worker/scheduling-worker.test.ts`, shared fixtures in `__tests__/helpers/session-fixtures.ts`)
- [x] Scheduling worker (`instrumentation.ts` → `lib/worker/start.ts`, 60s DB polling, no Redis): due notification jobs (idempotent `dedup_key` claim), session reminder/start messages through `MessagingProvider`, late-report reminders (T+0/T+15) + LATE_REPORT TeacherFlag at T+30, recurring-series continuation when credit exists (14-day horizon, unique `(series, week_index)` guard)
- [ ] REMOVED — Zoom REST meeting creation, registration, participant-specific links, and event-derived attendance.

## Execution log (updated as soon as real work happens)

### 2026-10-06 reconciliation

- Phase 3 is now In Progress. The Prisma schema contains the initial `Session`, `SessionStudent`, and optional `SessionJoinClick` models with explicit attendance status, session status/type, manual Zoom links, recurrence/replacement fields, and restrictive relations.
- 2026-10-06 database verification: the session/payment migration was applied during the confirmed development reset, and the demo seed created one future session with one explicit `PENDING` student assignment and one optional click-audit row. No scheduling behavior is claimed complete from seed data alone.
- 2026-10-06 implementation slice: added session create/list/update/replacement/recurrence APIs, prepaid credit reservation persistence, Admin/Supervisor session management UI, and role-scoped Teacher/Student/Guardian schedule pages.

### 2026-10-07 implementation pass (review + continuation)

- Review of the uncommitted Phase 3 work produced a 30-item findings table (R1–R30) and the owner approved the fixes and continuation decisions (Admin flag = UI + WhatsApp, replacement releases source reservations, R1 period fix touches `lib/payments/settlement.ts` as a dependency fix only, worker via `instrumentation.ts`, dedicated `feature/phase-3` branch).
- Prior uncommitted work was secured on `feature/phase-3` in logical commits (schema+migration, session APIs, messaging, UI) before any changes.
- R1 fixed: `settlePaidInvoice` now sets `periodStartsAt`/`periodEndsAt` (monthly and annual = one-month window, pay-per-session = none) via `lib/credits/period.ts`; the demo seed creates subscriptions with periods, a reservation consistent with the ledger, and notification jobs.
- Database invariants applied to the development database and verified directly (tables, partial unique indexes incl. `dedup_key`, CHECKs incl. `scheduled_end > scheduled_start`, reservation status-consistency CHECK, append-only trigger on `subscription_ledger`, enums `CONSUMED`/`EXPIRY`/`ANNUAL_PLAN`).
- R9 fixed: weekly generation is DST-safe — each week is the same LOCAL wall-clock time in `Session.timezone` converted to UTC (`lib/schedules/recurrence.ts`); the naive `+7*24h` UTC addition is gone. Series race (R5): a week whose reservation fails inside the transaction rolls the week back atomically and pauses the series instead of throwing the whole creation away.
- R6/R7/R21 fixed: cancellation is idempotent (first canceller kept, release runs once), pending notification jobs are cancelled on cancellation, rescheduling moves reminder jobs by the same delta, and replacement sessions release the missed source's active reservations in the same transaction.
- R22/R23/R24 fixed: the approval route uses `getMessagingProvider()` (OpenWA selected by configuration), the OpenWA provider reads its env at call time, sends are timezone-aware Arabic messages, and failed credential delivery records a redacted `notification_jobs` failure row without rolling back approval.
- R10/R17/R18 fixed: Zoom URLs must be https at validation and at the join redirect; the join route requires a SCHEDULED session; the update schema only allows SCHEDULED→CANCELLED.
- R26 fixed: the four session pages render times in the viewer's `User.timezone` (server-side `Intl.DateTimeFormat`, locale-aware).
- R27/R28/R16 implemented: teacher change requests get an Admin/Supervisor review API (`PATCH /api/session-change-requests/[id]`) plus a queue section in the admin sessions page; the admin sessions panel gained the recurring-series creation form (weekday derived from the local start, timezone, duration, teacher, subject, students, Zoom link, total weeks), a series list showing generated/pending weeks and PAUSED status, date-range/teacher/student/status filters, and a reschedule UI; the student and guardian pages now use the authorized join redirect.
- Verification (2026-10-07, from `webapp/`): `npx prisma validate` valid; `npx prisma migrate status` up to date (8 migrations); `npm run typecheck` clean; `npm run lint` clean; `npm test` 8 suites / 71 tests passing with a clean exit (no open handles); `npm run build` succeeds (Next.js 16.3.7).
- Database-backed tests cover: concurrent booking of the last credit (exactly one), group rollback when one student lacks credit, series capped at available credit + admin pause flag, series resume after a renewal credit, no duplicate week on concurrent extension, group series pause, double cancel idempotency, replacement reservation behavior (MISSED source release), cross-academy and teacher scoping, teacher cannot mutate (request-only), Zoom link exposure matrix and join guards, status transition allowlist, https validation, reschedule job moves, consumption order (earliest-expiring first), reserveCredit re-reserve flip, and R1 settlement periods with webhook idempotency.
- Test cleanup deletes only per-run `demo_test_*` academies in FK-safe order; `subscription_ledger` rows are removed with a transaction-scoped trigger disable (the append-only trigger is never dropped or disabled globally), matching the documented Phase 6 exception pattern.
- Still open (out of Phase 3 scope, recorded in PROGRESS.md): report settlement/CONSUMED writes (Phase 5/6), monthly EXPIRY writer + annual-plan monthly grant wiring (Phase 6b/0), payroll-ledger append-only trigger (Phase 0/6 when PayrollLedger exists), full NotificationLog audit store (Phase 0/5), failed-send retry/backoff (accepted MVP gap), and Playwright E2E journeys (Phase 8).
