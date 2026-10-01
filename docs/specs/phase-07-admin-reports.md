# Phase 7 — Admin & Reports

## Goal

Full admin dashboard, reporting, the evaluation/report feature (Section 9). (CONTEXT.md §13, Phase 7.)

Build the central analytics and administration dashboard, the report approval queue, announcements, and the separate qualitative feedback loop. Reports, attendance, approval, settlement, and evaluations remain distinct concepts.

## Proposed approach

1. **Database migrations:** Add `Reports`, `Evaluations`, `Announcements`, and `Complaints` tables to Prisma schema.
2. **Admin central dashboard:**
   - Operational metrics: active students, teachers, scheduled/completed sessions, pending applications, pending invoices.
   - Financial overview: total subscription collections vs. accrued teacher payroll liabilities.
3. **Report review system:**
   - Admin reviews every unified teacher `Reports` row and approves or rejects it.
   - Rejected reports return to the teacher for correction and resubmission; approved reports settle in Phase 6 and then become immutable `ARCHIVED` records.
   - A completed session may have a missing report without changing session status.
   - Student/Guardian evaluations remain a separate entity and flow.
4. **General Complaints & Feedback System:**
   - In-app button on student, guardian, and teacher dashboards to submit general complaints or suggestions.
   - Admin inbox to review, respond, and resolve complaints.
5. **Post-session evaluations:**
   - Automated trigger is optional pending the owner decision on whether evaluation is mandatory after every completed session.
   - Aggregated teacher evaluation ratings visible to Admin.
6. **Announcements management:**
   - Admin UI to compose announcements with target audience filters (`ALL`, `STUDENTS`, `TEACHERS`, `GUARDIANS`).
   - Feed component displayed on user dashboards according to role.

Delivery stage: Stage 3.

## Acceptance criteria

- Admin can review and approve reports, outage requests, overtime claims, TeacherFlags, separate evaluations, and announcements with server-side visibility rules.

## Frontend

Routes: `/admin`, `/admin/reports`, `/admin/session-requests`, `/admin/overtime`, `/admin/teacher-flags`, `/admin/evaluations`, `/admin/announcements`. Include loading/empty/error states, RTL/i18n, mobile tables, and role feeds.

## Backend

Admin queue GET/PATCH endpoints, optional evaluation POST, announcement CRUD, and dashboard aggregation. Zod filters/content; consistent 400/401/403/404/409 errors.

## Database

Touches `Reports`, `SessionRequests`, `TeacherFlags`, optional `Evaluations`, `Announcements`, and `Complaints`; reference the schema rather than duplicating it.

## Auth & Authorization

| Role | Admin queues | Own report view | Submit evaluation | Publish announcement |
|---|---:|---:|---:|---:|
| Admin | Yes | All | Review | Yes |
| Teacher | No | Own | No | No |
| Student/Guardian | No | Confirmed visibility | Optional student evaluation | No |

Archived teacher reports are visible to Admin, the teacher, the linked guardian when present, or the student directly when no guardian exists. Student evaluations remain separate and Admin-only.

## Security

Authorize every queue action, validate audience, protect minor data, avoid sensitive logs, and reuse signed attachment access.

## Transactions & failure handling

Review status changes and announcement publication are atomic; aggregation failures show an error state without partial visibility changes.

## Tests

Unit audience filters; real-Postgres report visibility, Admin-only evaluation, queue authorization, duplicate flag prevention, and announcement scoping; Playwright Admin queues and role feeds.

## Learning checkpoint

- Why is a teacher report visible to a guardian but a student evaluation Admin-only?

## Open decisions

Evaluation fields, whether evaluation is mandatory after every completed session, and whether evaluations/announcements remain MVP.

## Deferred / Post-MVP

- [DEFERRED] Evaluation prompt, announcements, and student attendance dispute if the owner chooses a smaller MVP.

## Definition of Done

Requirements, authorization, validation, failure paths, tests, lint, typecheck, build, reviewed diff, and execution log are complete.

## Tasks

- [ ] Add Prisma schema: `Reports`, `Evaluations`, `Announcements`, `Complaints`
- [ ] Run migration
- [ ] Build admin overview dashboard with operational and financial metrics
- [ ] Build teacher-to-student progress report form and listing
- [ ] Build guardian/student view of student progress reports
- [ ] Build student/guardian teacher evaluation submission interface
- [ ] Build general complaints submission form on user dashboards and Admin resolution view
- [ ] Implement automated post-session evaluation prompt for students
- [ ] Build admin evaluation review and rating summaries
- [ ] Build admin announcements composer (target audience selection)
- [ ] Build dashboard announcements widget for Student, Guardian, and Teacher
- [ ] Write tests: reporting authorization, evaluation submission, announcement scoping, complaints flow

## Execution log (updated as soon as real work happens)

(empty for now)
