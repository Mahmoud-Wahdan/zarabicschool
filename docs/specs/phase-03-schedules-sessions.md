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
- [ ] PLAN (2026-10-10, awaiting owner approval): migration `scheduling_assignments` — `student_subjects` + `student_teacher_assignments` (partial unique `(student_id, subject_id)` WHERE `status='ACTIVE'` — owner-reviewed 2026-10-10: one ACTIVE teacher per student+subject; `ended_at` lifecycle CHECK; unique `(student_id, subject_id)`, `ON DELETE RESTRICT`, `academy_id`, composite FK `(teacher_id, subject_id)` → `teacher_subjects`), plus nullable `assignment_overridden_by_id`/`assignment_override_reason` on `sessions` with a CHECK making the reason mandatory and non-blank exactly when an override happened. The migration is schema-only and is NOT applied until the owner applies it. The StudentSubject backfill is a SEPARATE idempotent statement (NOT inside the migration) — proposed rows were shown to the owner on 2026-10-10 (1 row: Demo Student ↔ demo-quran from the existing roster) and it is applied only on the owner's explicit instruction. No assignment backfill ever.
- [ ] PLAN (2026-10-10, awaiting owner approval): approval changes — teacher approval already creates `TeacherSubject` (verified; no fix needed); student/guardian approval gains `StudentSubject` creation + optional per-subject teacher selection (first `StudentTeacherAssignment`), else "Needs Teacher".
- [ ] PLAN (2026-10-10, awaiting owner approval): assignment APIs (Admin/Supervisor, academy-scoped, no Zoom/payments) — create, terminate (ENDED + `ended_at`), list with filters, and `GET /api/admin/teachers/:id/context?from=&to=` returning `{ subjects, busySlots, assignedStudents }`.
- [ ] PLAN (2026-10-10, awaiting owner approval): `POST /api/sessions`, `/api/sessions/recurrences`, `/api/sessions/:id/replacement` validate assignment + conflicts + links inside the transaction; error codes `TEACHER_SUBJECT_NOT_ASSIGNED`, `STUDENT_NOT_ASSIGNED_TO_TEACHER_SUBJECT` (with offending IDs), `STUDENT_NOT_FOUND_OR_INACTIVE`, `TEACHER_TIME_CONFLICT`, `INVALID_ZOOM_URL`; `scheduledStart` in the future for creation and series; series conflict/pause = `PAUSED` status + admin notification.
- [ ] PLAN (2026-10-10, awaiting owner approval): shared Zoom-URL validation in `lib/validation/zoom-url.ts` used by create/recurrence/replacement/update (both `zoomJoinUrl` and `zoomHostUrl`) and by the join redirect; existing non-compliant links are rejected at the redirect with 409 `INVALID_ZOOM_URL` (no data modification).
- [ ] PLAN (2026-10-10, awaiting owner approval): UI at `/admin/sessions` (smart teacher→subject→students flow, teacher busy slots for the selected day, real-time Zoom link feedback) + one simple `/admin/assignments` page (assignments + "Needs Teacher"), shared form hook, Arabic/English `next-intl` strings, loading/empty/error states.
- [ ] PLAN (2026-10-10, awaiting owner approval): seed additions — `StudentSubject` rows and the Demo Student ↔ Demo Teacher ↔ Quran assignment (seed is NOT executed without the owner's instruction).

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

### 2026-10-10 scheduling-assignments plan (Step 0 — documented, awaiting owner approval before any migration/code)

**Confirmed decisions (owner):** `SessionStudent` tracks only who is booked (attendance comes from the approved report; the scheduler never writes `attendanceStatus` — verified: it is written only in the report-approval route `app/api/reports/[id]/review/route.ts` and the demo seed's `PENDING` defaults). `StudentSubject` is created automatically on approving a student application (same transaction, idempotent, unique per pair). `StudentTeacherAssignment(student, teacher, subject, status ACTIVE/ENDED, created_by, ended_at)` is required for scheduling (session/series/replacement); overrides only for Admin/Supervisor with a reason, logged on the created session. Only Admin/Supervisor manage assignments.

**Migration (raw SQL + Prisma, not applied; owner-reviewed 2026-10-10):** tables `student_subjects` and `student_teacher_assignments`; partial unique `(student_id, subject_id)` WHERE `status='ACTIVE'` (**owner choice: one ACTIVE teacher per student+subject** — changing the teacher ends the old row and creates the new one in one transaction; a second active teacher for the same student+subject is impossible at the DB level); lifecycle CHECK `(status='ACTIVE' AND ended_at IS NULL) OR (status='ENDED' AND ended_at IS NOT NULL)`; unique `(student_id, subject_id)` on `student_subjects`; all FKs `ON DELETE RESTRICT`; `academy_id` on both; composite FK `(teacher_id, subject_id)` → `teacher_subjects(teacher_id, subject_id)` (verified: `teacher_subjects_teacher_id_subject_id_key` is a unique index); nullable `assignment_overridden_by_id` + `assignment_override_reason` on `sessions` (override audit) with a CHECK requiring a non-blank reason exactly when an override actor is set. The audit is per session, not per student; students added to an existing session afterwards get no separate override record yet. The composite FK matches ANY assignment history (ACTIVE or ENDED), so removing a subject from a teacher who ever had an assignment is blocked — the API returns a clean 409 and the UI must explain it. The migration is schema-only. Backfill (owner decision 2026-10-10): NOT inside the migration — a separate idempotent `INSERT … ON CONFLICT DO NOTHING` statement for `student_subjects` from existing session rosters, with the proposed rows shown to the owner for review and applied only on explicit instruction; **no assignments are auto-created** for old sessions. The demo seed (not run) adds Demo Student ↔ Demo Teacher ↔ Quran. API consequence of the one-active-teacher rule: `POST /api/admin/assignments` returns `409 DUPLICATE_ASSIGNMENT` when the student already has an ACTIVE teacher for that subject (any teacher), and the change-teacher action = end old + create new in ONE transaction.

**Smart form flow (`/admin/sessions`, single + series share one hook):** teacher select → the teacher's subjects (`TeacherSubject`, via `GET /api/admin/teachers/:id/context`) → after subject selection, only students with an ACTIVE assignment for that (teacher, subject) → the teacher's busy slots for the selected day (only `SCHEDULED` sessions count as busy; `CANCELLED`/`MISSED` never block). Subject/student fields reset when the teacher or subject changes. Real-time Zoom link feedback in the form; the API remains the final authority. Loading/empty/error states; Arabic/English `next-intl` strings.

**Conflict prevention (API, inside the transaction):** an overlap query against the teacher's `SCHEDULED` sessions (overlap = `existing.start < newEnd AND existing.end > newStart`; boundary touch `end == start` allowed) returns `409 TEACHER_TIME_CONFLICT` on conflict. For a series, a conflicting week is a **pause** (`status=PAUSED`, `generated_through_week` rolls back, admin notification enqueued) — the same mechanism as the credit pause. "Free slots" (`TeacherAvailability`) are explicitly NOT built now. `scheduledStart` must be in the future for single creation and series (replacement is exempt).

**Zoom link validation (format check only — it does NOT verify that the meeting actually exists):** one shared function in `lib/validation/zoom-url.ts` used by create, recurrence, replacement, and update (both `zoomJoinUrl` and `zoomHostUrl`) and by the join redirect **before** redirecting. Rules: HTTPS only; hostname must be `zoom.us` or end with `.zoom.us` (compared against the hostname parsed via `new URL`, never `.includes()`); no username/password (userinfo) in the URL; no non-default ports; path must be `/j/<digits>`, `/s/<digits>`, or `/wc/<digits>[/...]`; `/my/<name>` personal-room links are **rejected** (owner decision 2026-10-10); the meeting ID must be 9–13 digits (owner decision 2026-10-10); maximum URL length 2000 (aligned with the existing schema limit). `zoomHostUrl` is optional, follows the same rules, and is visible only to Admin, Supervisor, and the class instructor. Links and passwords are never logged in logs, error messages, or `lastError`. Failures return `400 INVALID_ZOOM_URL` on create/update input (generic reason, never echoes the link) and `409 INVALID_ZOOM_URL` at the join redirect for legacy stored links. Existing non-compliant links in the database are rejected at the join redirect instead of redirecting; existing data is not modified.

**Assignment APIs (Admin/Supervisor, academy-scoped, no Zoom links or payments):** `POST /api/admin/assignments` (create: active student/teacher/subject, `TeacherSubject` must exist — also enforced by the composite FK; `409 DUPLICATE_ASSIGNMENT` when an ACTIVE trio exists), `PATCH /api/admin/assignments/:id` (terminate → `ENDED`, `ended_at=now`), `GET /api/admin/assignments` (filters: `studentId`, `teacherId`, `subjectId`, `status`), and `GET /api/admin/teachers/:id/context?from=&to=` returning `{ subjects, busySlots, assignedStudents }`. One simple `/admin/assignments` page covers assignments and "Needs Teacher" requests (students with a `StudentSubject` but no ACTIVE assignment for that subject), reusing the context endpoint.

**Enrollment side-door hardening (owner decision 2026-10-10):** `POST /api/admin/enrollments` — only `SCHEDULED` sessions, require an ACTIVE assignment (Admin/Supervisor override with reason only, logged on the session), and reserve the credit inside the same transaction (currently it books without any credit reservation); `DELETE` releases the student's reservation (currently it leaves a stale `RESERVED` credit blocking the balance).

**Session API error codes:** `TEACHER_SUBJECT_NOT_ASSIGNED`, `STUDENT_NOT_ASSIGNED_TO_TEACHER_SUBJECT` (includes offending IDs), `STUDENT_NOT_FOUND_OR_INACTIVE`, `TEACHER_TIME_CONFLICT`, `INVALID_ZOOM_URL` — replacing the ambiguous merged `SESSION_PARTICIPANTS_INVALID` path (Step 0a found the observed "Fatima Ahmed/Quran" 409 was most likely `INSUFFICIENT_SESSION_CREDIT` or the merged student check, since her `teacher_subjects` row for Quran exists).

**Tests planned:** unit link validation (`zoom.us/j/123` ✓, `us02web.zoom.us` ✓, `zoom.us.evil.com` ✗, `zoom-us.com` ✗, `http` ✗, `user:pass@` ✗, non-default port ✗, `javascript:` ✗, non-meeting path ✗, `/my` ✗, >2000 chars ✗); approval with/without teacher; approval idempotency; rollback when an assignment insert fails; duplicate assignment; unassigned student (offending IDs); different academy; ENDED status (student no longer bookable; re-assign creates a new ACTIVE row); override without reason rejected; teacher conflicts (exact overlap, partial overlap, boundary `end==start` allowed, `CANCELLED`/`MISSED` not blocking); series pause + notification on a conflicting week; permissions (Teacher/Student forbidden on assignment APIs and session creation); join redirect rejects non-compliant stored links with 409. Existing session tests that create sessions without assignments are updated to create the fixtures' assignments.

**Execution status:** documentation only. No migration, schema change, code change, or seed has run; everything above starts after the owner approves.

### 2026-10-10 Batch 2 implementation (backend complete; schema-only migration applied by the owner beforehand)

- [VERIFIED] Migration `20261010120000_scheduling_assignments` was reviewed and applied by the owner on the development database; `prisma validate`, `migrate status` (9 migrations applied), typecheck, lint, and the full Jest suite pass.
- [IMPLEMENTED] `lib/validation/zoom-url.ts`: single shared format-only validator (https only, parsed-hostname allowlist `zoom.us`/`*.zoom.us`, no userinfo, no non-default ports, paths `/j/`, `/s/`, `/wc/` only, `/my` rejected, 9–13 digit meeting IDs, max length 2000, generic reasons that never echo the link). Wired into `POST /api/sessions`, `/api/sessions/recurrences`, `/api/sessions/:id/replacement`, `PATCH /api/sessions/:id` (join + host), and the join redirect (legacy stored links → `409 INVALID_ZOOM_URL`, no redirect, no data modification).
- [IMPLEMENTED] `lib/scheduling/checks.ts`: shared in-transaction checks — `resolveParticipants` (teacher-subject link → `TEACHER_SUBJECT_NOT_ASSIGNED`; active students → `STUDENT_NOT_FOUND_OR_INACTIVE` with offending ids; ACTIVE assignment unless an Admin/Supervisor override reason is provided → `STUDENT_NOT_ASSIGNED_TO_TEACHER_SUBJECT` with offending ids) and `assertTeacherFree` (only `SCHEDULED` sessions block; strict overlap so `end == start` is allowed; `CANCELLED`/`MISSED` never block → `TEACHER_TIME_CONFLICT`). The merged `SESSION_PARTICIPANTS_INVALID` is gone from all four routes.
- [IMPLEMENTED] Detailed errors with ids: `INSUFFICIENT_SESSION_CREDIT` now lists the students without credit; future-start enforced for creation and series only; series `paused` flag returned in the response payload.
- [IMPLEMENTED] Series pause on teacher conflict inside `generateSeriesWeek` (before the week is created; `PAUSED` + `SERIES_PAUSED` admin notification; rule JSON carries the override audit so worker-continued weeks inherit it).
- [IMPLEMENTED] Assignment APIs (Admin/Supervisor, academy-scoped, explicit selects, no Zoom/money fields): `GET/POST /api/admin/assignments` (create validates active participants + `TeacherSubject`, rejects a second ACTIVE teacher per student+subject with `409 DUPLICATE_ASSIGNMENT`), `PATCH /api/admin/assignments/:id` (`END`, and `CHANGE_TEACHER` = end old + create new in ONE transaction), `GET /api/admin/assignments/needs-teacher` (StudentSubject without an ACTIVE assignment), `GET /api/admin/teachers/:id/context?from=&to=` returning `{ teacher, subjects, busySlots, assignedStudents }` (SCHEDULED-only busy slots, overlap window).
- [IMPLEMENTED] `DELETE /api/admin/teacher-subjects` surfaces the composite-FK block as `409 TEACHER_SUBJECT_IN_USE` (any assignment history keeps the link).
- [IMPLEMENTED] Enrollment hardening (the only reservation-touching exception): `POST /api/admin/enrollments` runs inside `runSerializable` — SCHEDULED-only (`409 SESSION_NOT_SCHEDULED`), assignment check with Admin/Supervisor override reason, credit reservation via the existing `reserveCredit`, duplicate row → `409 CONFLICT`; `DELETE` releases the student's `RESERVED` reservation with the existing lifecycle fields only.
- [IMPLEMENTED] Approval changes in `lib/provisioning.ts`: `StudentSubject` rows are created from `subjects[]` inside the approval transaction (idempotent `createMany … skipDuplicates`), optional per-subject teacher selection (validated pre-transaction: active teacher + `TeacherSubject`) creates the first ACTIVE `StudentTeacherAssignment` in the same transaction; no selection → approval succeeds and the student lands in "Needs Teacher". The approve route/schema pass the optional `teachers` map.
- [TESTED] `__tests__/validation/zoom-url.test.ts` (18 unit tests: the full owner matrix incl. lookalike hosts, credentials, ports, `javascript:`, `/my`, short/long ids, oversize). `__tests__/api/assignments.test.ts` (9 DB-backed: needs-teacher, permissions, create/duplicate/one-active-teacher, ENDED + re-assign, change-teacher atomicity, context endpoint busy-slot matrix, `TEACHER_SUBJECT_IN_USE`, supervisor allowed). `sessions.test.ts` extended: detailed codes with offending ids, override with/without reason (logged on the session), conflict matrix (exact/partial/boundary/cancelled/missed/other-teacher), past-start rejection, INVALID_ZOOM_URL on create+PATCH, series pause with notification, hardened enrollment flow. `applications-admin.test.ts` extended: StudentSubject created on approval, no assignment without teacher, idempotency, unknown-teacher and not-teaching-teacher rollbacks. `scheduling-worker.test.ts` updated for compliant links and distinct slots.
- [CONFIG] `jest.config.js`: excluded the owner-provided `__tests__/Phase3.e2e.test.ts` from Jest (it is a Playwright suite for Batch 4) and set `maxWorkers: 1` because parallel workers repeatedly caused serializable-transaction write conflicts against the single shared development database (observed as `P2034/40001` in `reserveCredit` when two suites ran concurrently).
- Verification (2026-10-10, from `webapp/`): `npm run typecheck` clean; `npm run lint` clean (0 problems); `npm test` 10 suites / 111 tests passing; `npx prisma validate` valid; build deferred to Batch 4 per the batch plan.
