# Phase 5 — Attendance & Teacher Reports

## Goal

Attendance tracking (Zoom-event-driven), session log, and teacher post-session reports. Video recording storage and playback are out of the MVP. (CONTEXT.md §13, Phase 5.)

Build the attendance evaluation engine that consumes Zoom events, calculates teacher and student attendance durations, enforces the 25% student absence threshold for private sessions, provides a teacher post-session report submission flow for review, and handles outage claims.

## Proposed approach

1. **Database Migrations:** Add `Reports`, `ReportAttachments`, `TeacherFlags`, and `SessionRequests`; attendance remains on `SessionStudents.attendance_status`. Do not add recording models.
2. **Attendance Event Processing:**
   - Listen for `meeting.participant_joined` and `meeting.participant_left` events.
   - Aggregate cumulative attended duration per participant.
   - Flag teacher arrival >3 minutes late as informational `is_late = true` (no financial penalty).
3. **Absence Threshold Engine (Private Sessions):**
   - Calculate threshold = 25% of scheduled session duration (e.g. 15 min for 60-min session).
   - If a private student does not join within the threshold window:
     - Mark student `is_absent = true`.
     - Update session status to `MISSED`.
     - **Zero Financial Impact:** Do not debit student quota; do not credit teacher.
4. **Group Session Attendance:**
   - Evaluate attendance individually per student. Only attending students are marked present and billed.
   - Record each attending student's `SESSION_DEDUCTION` as soon as the attendance threshold is confirmed; this does not wait for the teacher report.
5. **Teacher Mandatory Session Report (`SESSION_COMPLETION_REPORT`):**
   - Provide Teacher UI to submit the required session report upon meeting completion; for group sessions, select the student from a list before writing that student's report.
   - **Business Rule:** The post-session report is mandatory and gates teacher payroll. Zoom attendance calculates the amount, but the teacher's salary is not credited until the required report for the relevant student is submitted. In group sessions, the teacher selects each relevant student and submits the report per student. Overdue reports trigger WhatsApp reminders (T+0, T+15m) and record a red mark on the teacher at T+30m.
6. **Technical Outage / Replacement Request Flow ("أبلغ عن عطل"):**
   - In-app form for Student or Teacher to report an outage (internet cutoff, electricity, Zoom crash) that prevented or disrupted attendance.
   - Admin review queue to inspect outage claims and schedule linked replacement sessions (`replacement_for_session_id`).
7. **WhatsApp Notifications (OpenWA):**
   - Teacher joined $\rightarrow$ notify students.
   - Teacher >3 min late $\rightarrow$ send teacher reminder.

Delivery stage: Stage 2.

## Acceptance criteria

- Assigned teachers submit one report per student after scheduled end; report outcomes update `SessionStudents.attendance_status`.
- Attachments are private and the Phase 6 settlement boundary is explicit and BLOCKED until Phase 6 exists.

## Frontend

Routes: `/teacher/today`, `/teacher/sessions/:id/report`, `/student/attendance`, `/guardian/reports`, `/admin/reports`, `/admin/session-requests`. Include loading/empty/error states, mobile RTL forms, attachments, metrics, and role visibility.

## Backend

POST `/api/sessions/:id/students/:studentId/report`; POST `/api/session-requests`; Admin queue endpoints; signed attachment URLs. Zod validation and `{ error: { code, message, fieldErrors? } }` errors with 400/401/403/404/409/413.

## Database

Touches `Reports`, `ReportAttachments`, `SessionStudents`, `TeacherFlags`, `SessionRequests`, and `NotificationLog`; private Supabase Storage stores paths only. No event attendance or recordings.

## Auth & Authorization

| Role | Submit report | Read teacher report | Review reports | Request outage |
|---|---:|---:|---:|---:|
| Teacher | Assigned only | Own | No | Yes |
| Guardian | No | Linked child | No | Yes |
| Student | No | No by default | No | Yes |
| Admin | Unlock/override | All | Yes | Review |

## Security

Server validation, assignment checks, frozen money fields, private bucket, signed URLs, image/PDF allowlist and size cap OPEN, no executables, no sensitive logs, and rate limits.

## Transactions & failure handling

Report creation, attendance update, and Phase 6 settlement share one transaction once Phase 6 exists. Notifications occur after commit.

## Tests

Unit schemas; real-Postgres integration for before-end rejection, duplicate report, unauthorized teacher, attachment rejection, visibility, outage queue, and settlement boundary; Playwright report, guardian view, Admin review, and mobile upload.

## Learning checkpoint

- Why is attendance stored per student in a group session?
- Why must notifications wait for commit?

## Open decisions

Attendance outcomes, class remarks, unlock timing, attachment rules, homework visibility, notification timing/recipients, and evaluation fields.

## Deferred / Post-MVP

- [DEFERRED] Recordings, Zoom-derived attendance, 25% timer, join/leave alerts, participant mapping, reconciliation, and student disputes.

## Definition of Done

Requirements, authorization, validation, failure paths, tests, lint, typecheck, build, reviewed diff, and execution log are complete.

## Tasks

- [ ] Add Prisma schema: `Attendance` table with duration and absence columns
- [ ] Run migration
- [ ] Implement participant join/leave event consumer to compute attendance duration
- [ ] REMOVED — 25% duration absence threshold timer; attendance comes from the teacher report.
- [ ] Implement group session per-student attendance tracking
- [ ] Build Teacher mobile UI for mandatory post-session report submission with student selection for group sessions
- [ ] Build Student/Teacher technical outage request submission form
- [ ] Build Admin outage claim review & replacement session scheduling queue
- [ ] Build Teacher, Student, and Guardian attendance views
- [ ] Integrate OpenWA notifications (teacher joined $\rightarrow$ students; late teacher alert)
- [ ] Write tests: 25% threshold calculation, absence marking, duration computation, outage request flow

## Execution log (updated as soon as real work happens)

### Scope corrections

- REMOVED — Zoom event processing, 25% absence timer, attendance segments, join/leave alerts, and recordings; the teacher report is the evidence.
- [MVP] Report submission is per student, including groups, and calls Phase 6 settlement after the Phase 6 boundary is available.
- [MVP] Outage/absence requests and the Admin queue remain in scope.
