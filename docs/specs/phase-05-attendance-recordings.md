# Phase 5 — Attendance & Teacher Reports

## Goal

Explicit per-student attendance, unified teacher reports, and Admin review. Video recording storage and playback are out of the MVP. (CONTEXT.md §13, Phase 5.)

Build the teacher report flow, explicit attendance writes, Admin approval/rejection, immutable archival, and outage claims. Evaluations remain separate and do not dynamically determine attendance.

## Proposed approach

1. **Database Migrations:** Add `Reports`, `ReportAttachments`, `TeacherFlags`, and `SessionRequests`; attendance remains on `SessionStudents.attendance_status`. Do not add recording models.
2. **Explicit Attendance:**
   - Write `SessionStudents.attendance_status` from the approved report outcome or an audited Admin override.
   - Do not infer attendance from an evaluation row; missing evaluation is not absence.
5. **Teacher Mandatory Session Report (`SESSION_COMPLETION_REPORT`):**
   - Provide Teacher UI to submit the required session report upon meeting completion; for group sessions, select the student from a list before writing that student's report.
   - Lifecycle: `SUBMITTED → APPROVED → ARCHIVED`; Admin or Supervisor rejection is `SUBMITTED → REJECTED → SUBMITTED` after Teacher correction. The same Reports row is edited before archival; no revision/version table exists. Admin or Supervisor approval is required before Phase 6 settlement; submission never changes money.
   - A completed Session can have a missing report; missing status does not make the Session incomplete.
6. **Technical Outage / Replacement Request Flow ("أبلغ عن عطل"):**
   - In-app form for Student or Teacher to report an outage (internet cutoff, electricity, Zoom crash) that prevented or disrupted attendance. Teacher reports also record operational facts such as late entry, early exit, disconnection, and reconnection for review; facts do not automatically decide attendance.
   - Admin review queue to inspect outage claims and schedule linked replacement sessions (`replacement_for_session_id`).
7. **WhatsApp Notifications (OpenWA):**
   - Teacher joined $\rightarrow$ notify students.
   - Teacher >3 min late $\rightarrow$ send teacher reminder.

Delivery stage: Stage 2.

## Acceptance criteria

- Assigned teachers submit one report per student after scheduled end; Admin or Supervisor approves or rejects every report before it updates attendance or reaches settlement.
- Rejected reports return to the teacher for correction; approved reports archive only after settlement succeeds. A completed session may have a missing report.

## Frontend

Routes: `/teacher/today`, `/teacher/sessions/:id/report`, `/student/attendance`, `/guardian/reports`, `/admin/reports`, `/admin/session-requests`. Include loading/empty/error states, mobile RTL forms, attachments, metrics, and role visibility.

## Backend

POST `/api/sessions/:id/students/:studentId/report`; POST `/api/session-requests`; Admin queue endpoints; signed attachment URLs. Zod validation and `{ error: { code, message, fieldErrors? } }` errors with 400/401/403/404/409/413.

## Database

Touches `Reports`, `ReportAttachments`, `SessionStudents`, `TeacherFlags`, `SessionRequests`, and `NotificationLog`; private Supabase Storage stores paths only. No event attendance or recordings.

## Auth & Authorization

| Role | Submit/edit report | Read archived report | Review/approve reports | Request outage |
|---|---:|---:|---:|---:|
| Teacher | Assigned only before archive | Own | No | Yes |
| Guardian | Linked child | Linked child | No | Yes |
| Student | No | Only if no guardian | No | Yes |
| Supervisor | No money actions; review/reject/approve | All operational fields, no money | Yes | Review |
| Admin | Unlock/override | All | Yes | Review |

## Security

Server validation, assignment checks, Admin approval authorization, immutable archived rows, private bucket, signed URLs, image/PDF allowlist and size cap OPEN, no executables, no sensitive logs, and rate limits.

## Transactions & failure handling

Report submission/rejection/approval state changes are authorized and atomic. Approval invokes Phase 6 settlement; attendance, ledgers, settled_at, and archived_at must commit together or roll back. Notifications occur after commit.

## Tests

Unit schemas; real-Postgres integration for before-end rejection, duplicate report, unauthorized teacher, Admin approval boundary, rejection/resubmission, completed-plus-missing-report, archive immutability, attachment rejection, visibility, outage queue, and rollback; Playwright report, guardian/student visibility, Admin review, and mobile upload.

## Learning checkpoint

- Why is attendance stored per student in a group session?
- Why must notifications wait for commit?

## Open decisions

Attachment rules, homework visibility, notification timing/recipients, evaluation fields, and whether evaluation is mandatory after every completed session.

## Deferred / Post-MVP

- [DEFERRED] Recordings, Zoom-derived attendance, 25% timer, join/leave alerts, participant mapping, reconciliation, and student disputes.

## Definition of Done

Requirements, authorization, validation, failure paths, tests, lint, typecheck, build, reviewed diff, and execution log are complete.

## Tasks

- [ ] Add/maintain `Reports` with teacher/student FKs, lifecycle timestamps, rejection metadata, and no revision table
- [ ] Run migration
- [ ] REMOVED — Participant join/leave event consumer and duration computation; Zoom is not an attendance source.
- [ ] REMOVED — 25% duration absence threshold timer; attendance comes from the teacher report.
- [ ] Write explicit attendance only from approved report outcomes or audited Admin override
- [ ] Build Teacher mobile UI for mandatory post-session report submission with student selection for group sessions
- [ ] Build Student/Teacher technical outage request submission form
- [ ] Build Admin outage claim review & replacement session scheduling queue
- [ ] Build Teacher, Student, and Guardian attendance views
- [ ] Integrate report-status notifications and late-report flags; reminders run after commit and approval notices go to the configured recipients.
- [ ] Write tests: approval boundary, rejection/resubmission, completed-plus-missing-report, archive immutability, rollback, visibility, and outage flow

## Execution log (updated as soon as real work happens)

### Scope corrections

- REMOVED — Zoom event processing, 25% absence timer, attendance segments, join/leave alerts, and recordings.
- [MVP] Report submission is per student, including groups; Admin or Supervisor approval calls Phase 6 settlement, then archives the report.
- [MVP] Outage/absence requests and the Admin queue remain in scope.

### 2026-10-06 reconciliation

- Phase 5 remains Not Started. Reports, explicit `SessionStudents.attendance_status`, attachments, outage requests, review queues, visibility endpoints, and atomic settlement handoff are not implemented in the current code.
- The required lifecycle is `SUBMITTED → REJECTED → SUBMITTED` or `APPROVED → ARCHIVED`; submission has no financial effect.
- Student visibility follows Context: students see homework, notes, and attachments; guardians and Admin see the teacher report; evaluations remain Admin-only.
