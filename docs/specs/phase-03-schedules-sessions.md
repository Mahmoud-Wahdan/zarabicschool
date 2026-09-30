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

- [ ] Add Prisma schema: `Sessions`, `SessionStudents`
- [ ] Run migration
- [ ] Build Admin single session creation UI (1:1 and group 1:N)
- [ ] Build Admin weekly recurring session generator (batch scheduling)
- [ ] Build Admin replacement session creation flow (`replacement_for_session_id`)
- [ ] Build Admin session management list (filter, cancel, reschedule)
- [ ] Build Teacher schedule dashboard
- [ ] Build Student schedule dashboard
- [ ] Build Guardian consolidated schedule dashboard
- [ ] Implement timezone-aware schedule display for all roles
- [ ] Add Zod validation schemas for single and recurring session inputs
- [ ] Write tests: session CRUD, recurring generation, replacement session linking, authorization
- [ ] REMOVED — Zoom REST meeting creation, registration, participant-specific links, and event-derived attendance.

## Execution log (updated as soon as real work happens)

(empty for now)
