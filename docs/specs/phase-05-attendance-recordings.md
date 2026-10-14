# Phase 5 — Attendance & Teacher Reports

## Goal

Explicit per-student attendance, unified teacher reports, and Admin review. Video recording storage and playback are out of the MVP. (CONTEXT.md §13, Phase 5.)

Build the teacher report flow, explicit attendance writes, Admin approval/rejection, immutable archival, and outage claims. Evaluations remain separate and do not dynamically determine attendance.

## Proposed approach

1. **Database Migrations:** `Reports` and `TeacherFlags` exist (Phase 3); `ReportAttachments` and `SessionRequests` are added by Phase 5 migrations (owner applies); attendance remains on `SessionStudents.attendance_status`. Do not add recording models.
2. **Explicit Attendance:**
   - Write `SessionStudents.attendance_status` from the approved report outcome or an audited Admin override.
   - Do not infer attendance from an evaluation row; missing evaluation is not absence.
3. **Teacher Mandatory Session Report (`SESSION_COMPLETION_REPORT`):**
   - Provide Teacher UI to submit the required session report upon meeting completion; for group sessions, select the student from a list before writing that student's report.
   - Lifecycle: `SUBMITTED → APPROVED → ARCHIVED`; Admin or Supervisor rejection is `SUBMITTED → REJECTED → SUBMITTED` after Teacher correction. The same Reports row is edited before archival; no revision/version table exists. Admin or Supervisor approval is required before Phase 6 settlement; submission never changes money.
   - A completed Session can have a missing report; missing status does not make the Session incomplete.
4. **Technical Outage / Replacement Request Flow ("أبلغ عن عطل"):**
   - In-app form for Student or Teacher to report an outage (internet cutoff, electricity, Zoom crash) that prevented or disrupted attendance. Teacher reports also record operational facts such as late entry, early exit, disconnection, and reconnection for review; facts do not automatically decide attendance.
   - Admin review queue to inspect outage claims and schedule linked replacement sessions (`replacement_for_session_id`).
5. **WhatsApp Notifications (OpenWA):**
   - Late-report chain (built in Phase 3, reviewed as Phase 5 work — see Step 1 findings): T+0 "report needed" + T+15 reminder to the teacher, `LATE_REPORT` red mark at T+30, all measured from the scheduled end.
   - Guardian notice on report approval (adult student without a guardian receives it instead — owner, 2026-10-14); teacher notice on rejection (Phase 5, Batch D).
   - REMOVED with the Zoom events (CONTEXT §6): "teacher joined → notify students" and "teacher >3 min late → teacher reminder".

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

- ~~Attachment rules, homework visibility, notification timing/recipients, evaluation fields, mandatory evaluation~~ — all resolved: attachments = images + PDF, 10 MB, private (CONTEXT §9); student visibility = homework/notes/attachments (CONTEXT §9); late-report timing = T+0/T+15/T+30 from scheduled end (owner, 2026-10-07); evaluation mandatory, Admin-only, Phase 7 (owner, 2026-10-07). Phase 5 build decisions: see "Owner decisions" below.

## Step 1 review (2026-10-14) — findings on the early-built pieces + report routes

Reviewed against CONTEXT §6/§7/§9. Already correct: thresholds measured from `scheduledEnd`; CAS job claiming + unique `dedup_key`; `UNIQUE(session_id, flag_type)` on TeacherFlags + upsert; teacher-only reminder recipients; attendance written only in the APPROVE branch; zero money writes in the report path; `settled_at`/`archived_at` never written; rejection reason required by Zod.

| ID | Sev | Where | Problem → Fix |
|---|---|---|---|
| F-01 | High | report submit route | CANCELLED/MISSED sessions reportable (status selected, never checked) → block; test |
| F-02 | High | report submit route | Resubmit wipes `rejection_reason/at/by` → preserve + surface in the teacher form; test |
| F-03 | High | report submit route + schema | `attendanceOutcome`/`extraTimeMinutes` editable on resubmit (CONTEXT §7 protection 4) → strict freeze; homework not required though CONTEXT says required → `min(1)`; classRemark free text vs CONTEXT §9 list → settings dropdown (Batch A); tests |
| F-04 | High | review route | Double-approve = 409 error + read-then-write race → conditional `WHERE status='SUBMITTED'`, loser gets clean "already handled"; test |
| F-05 | High | review route | No guardian WhatsApp on approval (CONFIRMED CONTEXT §8) → Batch D after-commit notice |
| F-06 | High | report GET + student page | Existence oracle (403 vs null), full row to students/guardians, student sees classRemark/summary, ARCHIVED gate dead until Phase 6 → role-shaped data layer + APPROVED gate; tests |
| F-07 | High | worker + submit route | Report submission doesn't cancel pending reminders; sender lacks report-exists guard → cancel + guard; test |
| F-08 | Med | worker templates | Renders `scheduledStart` but text says "ended at" → render `scheduledEnd`; test |
| F-09 | Med | worker sender | Send guard cancels jobs of non-SCHEDULED sessions → allow REPORT_REMINDER kinds for COMPLETED; test |
| F-10 | Med | worker scan | 90-min window loses reminders+flag on downtime → 24h (owner); test |
| F-11 | Med | submit route | Concurrent first-submit race → P2002 500 → catch → 409; test |
| F-12 | Med | replacement route | Replacements/late enrollments get no notification jobs → enqueue in Batch C path |
| F-13 | Med | worker | FAILED reminder never retried; dedup key blocks re-creation → re-arm once (attempts<2) (owner); test |
| F-14 | Med | both report routes | Non-UUID path params → 500 → Zod uuid → 400 |
| F-15 | Low | submit route | "Already exists" 409 reused for APPROVED/ARCHIVED immutability → distinct code/message |
| F-16 | Low | teacher UI | Hardcoded English, no prefill/reason, no after-end gating → Batch A rebuild |
| F-17 | Low | report GET | Internal IDs leaked → role-shaped select removes them |
| F-18 | Info | migration 20261006161159 | reports unique index FULL not partial — equivalent (single report type); document only |
| F-19 | Info | schema | No `NotificationLog` table — `NotificationJob` doubles as the redacted log (Phase 3 accepted design; PROGRESS defers the full audit store); Phase 5 keeps this mapping |
| F-20 | Info | this spec | Stale Zoom-era notification items contradicted CONTEXT §6 → removed in this commit |
| F-21 | Med | reports queue | `operational_events` stored but never shown to reviewers → Batch B detail view (evidence only, never auto-decides) |

Contradictions with CONTEXT (reported per protocol): F-02, F-03, F-05, F-06 — CONTEXT wins.

## Owner decisions (MCQ, 2026-10-14)

1. **Money-field freeze: STRICT** — `attendanceOutcome` + `extraTimeMinutes` locked from first submission; only text fields editable after rejection; a wrong outcome is corrected by an audited Admin attendance override, never by editing the evidence.
2. **Student/guardian read-visibility gate: APPROVED** — archival stays the Phase-6 settlement marker.
3. **Storage: Supabase Storage REST via fetch, no new dependency** — env names `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`; allowlist JPEG/PNG/WebP/PDF validated by magic bytes; 10 MB cap; private bucket; short-lived signed URLs.
4. **Class-remark list: new `AcademySettings` table** (`academy_id`, `key`, `value JSONB`) — Admin-only editor (Supervisor excluded from system settings, CONTEXT §4).
5. **Late-report chain durability: 24h scan window + one re-arm of FAILED reminder jobs** (`attempts < 2`); dedup guarantees single sends.
6. **Outage approval scope: Admin chooses per approval** — whole-session (original → MISSED + full replacement) or per-student (group session stays SCHEDULED for the others; requester's reservation released + private replacement linked to the original).
7. **Approval notice recipients: guardian when the student has one; adult student without a guardian otherwise.**
8. **Branch setup: `feature/phase-5` from `feature/stitch-ui`; pending doc edits committed first.**

## Execution plan

- **Step 0** (this commit): branch + docs/spec reconciliation.
- **Step 1:** fix F-01…F-21 (small commits, one test per fix); new `__tests__/api/reports.test.ts`; full gates.
- **Batch A:** attachments (model+migration, `StorageProvider` REST impl + test fake, upload-first + compensating delete, signed URLs, 400/413) · AcademySettings remark list + submit validation · role-shaped visibility data layer · teacher UI rebuild (ar/en RTL, group student picker, after-end gating, rejection prefill) · demo seed extended with real reports.
- **Batch B:** queue filters (teacher/date/type), detail with attachments + operational events, approval tx + `lib/reports/settlement-seam.ts` (no-op; Phase 6 fills it), concurrency + Supervisor-no-money tests.
- **Batch C:** `SessionRequest` model+migration (partial unique PENDING per (session, requester)), rate-limited form (Student/Guardian/Teacher), Admin+Supervisor notify, queue, admin-chosen-scope replacement flow; no money.
- **Batch D:** teacher/student/guardian attendance views (MISSING = view state), approval/rejection notifications (ar/en, recipient timezone, dedup, after commit), TeacherFlags visibility in queue + admin teacher view.

## Deferred / Post-MVP

- [DEFERRED] Recordings, Zoom-derived attendance, 25% timer, join/leave alerts, participant mapping, reconciliation, and student disputes.

## Definition of Done

Requirements, authorization, validation, failure paths, tests, lint, typecheck, build, reviewed diff, and execution log are complete.

## Tasks

- [x] Add/maintain `Reports` with teacher/student FKs, lifecycle timestamps, rejection metadata, and no revision table
- [x] Run migration
- [ ] REMOVED — Participant join/leave event consumer and duration computation; Zoom is not an attendance source.
- [ ] REMOVED — 25% duration absence threshold timer; attendance comes from the teacher report.
- [x] Write explicit attendance only from approved report outcomes or audited Admin override
- [ ] Build Teacher mobile UI for mandatory post-session report submission with student selection for group sessions — reopened 2026-10-14 (F-16: hardcoded English, no gating/prefill; Batch A rebuild)
- [x] Step 1: fix review findings F-01…F-21 with one test per fix (F-05→Batch D, F-06/F-17→Batch A, F-12→Batch C, F-16→Batch A; F-18/F-19/F-20 documented) + Phase 3 composite-FK regression repaired
- [ ] Batch A: attachments (model, migration, StorageProvider REST + fake, magic bytes, signed URLs, 400/413)
- [ ] Batch A: AcademySettings class-remark list (Admin-only) + submit-time validation
- [ ] Batch A: role-shaped report visibility data layer (APPROVED gate) + visibility-matrix tests
- [ ] Batch A: teacher UI rebuild + demo seed extension with real reports
- [ ] Batch B: approval queue filters + detail (attachments, operational events) + settlement seam + concurrency tests
- [ ] Batch C: SessionRequest model+migration, outage form, notifications, admin queue, replacement flow
- [ ] Batch D: Teacher/Student/Guardian attendance views + approval/rejection notifications + TeacherFlags visibility
- [ ] Write tests: before-end submit, duplicate submit, concurrency, edit-after-approval, rejection/resubmission, attendance-once, absent-writes-nothing-else, visibility matrix, supervisor-no-money, attachment rejects, outage flow, notification-failure isolation, reminder cancellation, no-secrets-in-logs

## Execution log (updated as soon as real work happens)

### Scope corrections

- REMOVED — Zoom event processing, 25% absence timer, attendance segments, join/leave alerts, and recordings.
- [MVP] Report submission is per student, including groups; Admin or Supervisor approval calls Phase 6 settlement, then archives the report.
- [MVP] Outage/absence requests and the Admin queue remain in scope.

### 2026-10-06 reconciliation

- Phase 5 is In Progress. Reports, migration, teacher submission, student visibility, and Admin/Supervisor review APIs are implemented. Attachments, outage requests, review queue UI, archival after settlement, and atomic financial settlement remain.
- The required lifecycle is `SUBMITTED → REJECTED → SUBMITTED` or `APPROVED → ARCHIVED`; submission has no financial effect.
- Student visibility follows Context: students see homework, notes, and attachments; guardians and Admin see the teacher report; evaluations remain Admin-only.

### 2026-10-11 note — built early, not yet reviewed as Phase 5 work

- The late-report reminder chain (T+0 notification, T+15 follow-up, `LATE_REPORT` TeacherFlag at T+30) and the per-student report attendance write in the report-approval route (`SessionStudents.attendanceStatus` from the approved report's outcome) were built EARLY during the Phase 3 worker/scheduling work. They are recorded here but are **NOT yet reviewed as part of Phase 5**; Phase 5 must re-review their behavior, timing, recipients, and tests before this phase closes. The scheduling side never writes attendance status (verified: only the report-approval route and seed defaults do).

### 2026-10-14 — Step 0 + Step 1 review complete, implementation started

- Branch `feature/phase-5` created from `feature/stitch-ui`; pending owner doc edits committed first (17737bb).
- Full Step 1 review executed (submit/review routes, worker reminder chain, messaging, schema, UIs, tests): findings F-01…F-21 recorded above; verified-good list recorded. 8 owner decisions locked via MCQ (recorded above).
- This spec's stale Zoom-era notification items removed (F-20); tasks restructured to the Step 1 + Batches A–D plan.
- Owner steps generated later this phase: migrations (report attachments, academy settings, session requests), env names (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), private bucket creation.

### 2026-10-14 — Step 1 fixes implemented and verified

- **Phase 3 regression found and repaired:** the owner-applied migration `20261014081933_phase4` silently DROPPED the owner-reviewed composite FK `student_teacher_assignments(teacher_id, subject_id) → teacher_subjects` (database-schema §8.2 invariant #4) because the Prisma schema never modeled the relation — `migrate dev` treated it as drift. Consequences: teacher-subject removal succeeded while assignment history existed (the DELETE route relied on the DB P2003). Repair (d322b54): the relation is now modeled in `schema.prisma` (Prisma owns the FK from now on), migration `20261014183952_phase5_restore_assignment_composite_fk` re-creates it (OWNER APPLIES), and the DELETE route gained an application-level guard so the invariant holds even before the migration lands. **This is why the assignments suite was red at Step-1 start — not a Phase 5 change.**
- [fixed+tested] F-01 submit blocked for CANCELLED/MISSED (409 `SESSION_NOT_REPORTABLE`) · F-02 rejection metadata preserved on resubmit · F-03 strict freeze of `attendanceOutcome`/`extraTimeMinutes` (owner decision) + homework required · F-04 conditional-update approval, concurrent approve → one winner + clean `alreadyHandled`, approve-vs-reject race resolved · F-07 submit cancels pending nudges (fully-reported session) + sender guard · F-08 nudges render scheduled END time · F-09 nudges fire for COMPLETED sessions (session reminders still cancelled) · F-10 24h scan window · F-11 concurrent first submit → P2002 caught → 409 `ALREADY_SUBMITTED` · F-13 one re-arm of FAILED nudges (attempts < 2) · F-14 UUID path validation → 400 · F-15 distinct `REPORT_IMMUTABLE` code · F-21 operational events visible in the queue (evidence only).
- [deferred to batches] F-05 approval notices (Batch D) · F-06/F-17 visibility data layer (Batch A) · F-12 replacement jobs (Batch C) · F-16 teacher UI rebuild (Batch A).
- [verified 2026-10-14, from `webapp/`] `npx prisma validate` valid; `prisma generate` clean; `npm run typecheck` clean; `npm run lint` clean; `npm test` **14 suites / 170 tests green** (baseline 12/149 → +21, nothing reduced); `npm run build` succeeds.
- Commits: d322b54 (regression repair), c6e4cc6 (submit/review hardening + tests), 7bbaf92 (worker chain + tests), 3ee5a70 (queue evidence).
- **Owner step added:** apply migration `20261014183952_phase5_restore_assignment_composite_fk` (`npx prisma migrate deploy`, DIRECT_URL).
