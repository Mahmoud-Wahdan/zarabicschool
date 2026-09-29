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

## Execution log (updated as soon as real work happens)

(empty for now)
