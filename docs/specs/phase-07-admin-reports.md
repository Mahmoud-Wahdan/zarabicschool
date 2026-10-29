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
   - Admin or Supervisor reviews every unified teacher `Reports` row and approves or rejects it. Approval invokes the Phase 6 settlement; submission only queues the report.
   - Rejected reports return to the teacher for correction and resubmission; approved reports settle in Phase 6 and then become immutable `ARCHIVED` records.
   - A completed session may have a missing report without changing session status.
   - Student/Guardian evaluations remain a separate entity and flow.
4. **General Complaints & Feedback System:**
   - In-app button on student, guardian, and teacher dashboards to submit general complaints or suggestions.
   - Admin inbox to review, respond, and resolve complaints.
5. **Post-session evaluations:**
   - OPTIONAL for students and guardians (owner, 2026-10-26); in-app non-blocking prompt after COMPLETED, no WhatsApp.
   - Per-teacher summary (average, count, recent comments) for Admin and Supervisor only.
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

| Role | Review reports/requests | Own report view | Submit evaluation | Publish announcement |
|---|---:|---:|---:|---:|
| Supervisor | Yes (no money fields) | Operational fields only | Review | No |
| Admin | Yes | All | Review | Yes |
| Teacher | No | Own | No | No |
| Student/Guardian | No | Confirmed visibility | Optional student evaluation | No |

Archived teacher reports are visible to Admin or Supervisor, the teacher, the linked guardian when present, or the student directly when no guardian exists. Student evaluations remain separate and Admin-only.

## Security

Authorize every queue action, validate audience, protect minor data, avoid sensitive logs, and reuse signed attachment access.

## Transactions & failure handling

Review status changes and announcement publication are atomic; aggregation failures show an error state without partial visibility changes.

## Tests

Unit audience filters; real-Postgres report visibility, Admin-only evaluation, queue authorization, duplicate flag prevention, and announcement scoping; Playwright Admin queues and role feeds.

## Learning checkpoint

- Why is a teacher report visible to a guardian but a student evaluation Admin-only?

## Open decisions

- ~~Evaluation fields, whether evaluation is mandatory, whether evaluations/announcements remain MVP~~ — decided 2026-10-26 (see "Owner decisions (2026-10-26)" below).
- **OPEN (owner):** announcement opt-out / unsubscribe handling (WhatsApp).
- **OPEN (owner):** maximum announcement frequency (per day/week).
- **OPEN (owner):** any MONEY consequence for a missing monthly report (payroll deduction/adjustment amount, deadline). Not built.

## Owner decisions (2026-10-26)

1. **Announcements** — posted by Admin AND Supervisor, to EVERYONE, delivered by WhatsApp (the platform's only communication channel) through the existing `notification_jobs` queue + `MessagingProvider` (never sent from the request). An in-app copy is kept too (dashboard widget + history) so a critical message never depends on OpenWA alone; optional expiry date on the in-app copy. Hard throttle (a few seconds between messages + random jitter, configurable max per batch/hour). Recipients reuse the existing recipient rules (no new ones); phone numbers are deduped (one guardian with several students gets one message). The composer shows the recipient COUNT and requires explicit confirmation; a sent announcement cannot be edited. The dev guard `OPENWA_SEND_ALLOWLIST` stays in force; no live sends until the WhatsApp live test (last). Logs: a redacted delivery summary only (no bodies, no numbers).
2. **Complaints** — written by a student, guardian or teacher. Required: the session concerned, the party concerned (teacher/student/guardian), category, title, text. The concerned party NEVER sees the complaint (server-side: lists, counts, notifications, search). Only Admin and Supervisor see and handle it: NEW → IN_PROGRESS → RESOLVED + resolution note. They inform the concerned party manually: NO automatic notification to that party.
3. **Evaluation summaries** — per teacher: average + count + recent comments; Admin and Supervisor only; no automatic action; the teacher never sees it. Teacher performance ANALYSIS (teachers-performance page) → Phase 9 (phase-09-refinements.md).
4. **Evaluations are OPTIONAL** for students and guardians. The post-session prompt is an in-app, non-blocking banner/card after the session is COMPLETED (no WhatsApp, no blocking). What is MANDATORY is the teacher's session report and the teacher's monthly report — not the evaluations. CONTEXT §7.7, the §9 "other rules" line and the decisions-table row still say "mandatory": listed for the next CONTEXT revision (PROGRESS.md → "Pending for the next CONTEXT revision").
5. **Monthly report** — 7-day edit window CONFIRMED. Missing report: the teacher gets the existing WhatsApp reminders (1st and 3rd, PROPOSAL timing) plus an in-app card on the teacher dashboard; the Admin sees a `MONTHLY_REPORT_MISSING` teacher flag (existing teacher-flags mechanism). No money penalty is built (see the Phase 5 spec, "Missing monthly report — what the system can do").
6. **OWASP Top 10 (latest edition: 2025 — edition to be re-verified at the dedicated pass)** — each slice is checked against the relevant categories before it is finished; a dedicated pass at the end of Phase 7 writes `docs/specs/security-review.md`.

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
- [x] Build general complaints submission form on user dashboards and Admin resolution view (2026-10-26)
- [x] Implement the post-session evaluation prompt (in-app, non-blocking, optional evaluations — 2026-10-26)
- [x] Build admin evaluation review and rating summaries (Admin + Supervisor, 2026-10-26)
- [x] Build admin announcements composer (audience = everyone per owner decision, 2026-10-26)
- [x] Build dashboard announcements widget for every role (2026-10-26)
- [ ] Write tests: reporting authorization, evaluation submission, announcement scoping, complaints flow

## Execution log (updated as soon as real work happens)

### 2026-10-06 reconciliation

- Phase 7 remains Not Started. Report/request queues, TeacherFlags, complaints, announcements, evaluations, dashboard aggregation, and role-safe visibility tests are not implemented.
- Supervisor may review operational queues and approve reports, but must never receive or edit money fields or perform payroll, payment, adjustment, payout, refund, or Admin/Supervisor-management actions.

### 2026-10-26 — Phase 7 implemented (Session 5 phase c, uncommitted)

Skills used: superpowers:requesting-code-review (one review pass on Phase 7 + lateness), superpowers:verification-before-completion. The plan was written directly from the owner's decisions above (no separate plan file). Migration **`20261026170000_phase7_announcements_complaints`** (announcements + complaints only, no financial/attendance table) — **owner to apply**. Until then every Phase 7 page, widget and route shows or answers "pending migration" (`lib/phase7/readiness.ts`, positive-only cache).

**Announcements**
- **Who and to whom:** ADMIN and SUPERVISOR compose at `/admin/announcements`. The message goes to EVERYONE: every active user of every role.
- **WhatsApp delivery:**
  - One `notification_jobs` row per deduped phone number (kind `ANNOUNCEMENT`, payload `{announcementId}` only). The worker loads the text at send time; nothing is ever sent from the request.
  - No new recipient rule: a student and their guardian are separate users, the same as for report notices. A shared number gets one message, kept on the earliest-created user.
  - Users without an addressable number get the in-app copy only.
- **Confirmation:** the composer first shows the server-computed counts — WhatsApp numbers, active users, users without a number, shared numbers merged — then requires an explicit checkbox. The server re-counts and refuses a stale confirmation with 409 `RECIPIENTS_CHANGED`, returning the new count.
- **No editing:** there is no edit route, and the DB row is append-only (trigger `announcements_append_only`).
- **Throttle** (`lib/config/announcements.ts`, named constants):
  - 4 s spacing + 0–3 s random jitter between announcement messages;
  - at most 8 per worker tick and 60 per rolling hour;
  - over a cap the job is pushed back 5 minutes, not claimed — nothing is dropped and other kinds are not starved.
- **Dev guard:** `OPENWA_SEND_ALLOWLIST` still applies in non-production. **No live send was made.**
- **Logs:** the request logs `id + recipient count`; the worker logs per-tick counts (sent/failed/deferred). Never text, never numbers.
- **In-app copy:**
  - A dashboard widget on all five role dashboards, plus the history page `/announcements` (every role).
  - Optional expiry date; if none is given, the default is 3 days from sending (`ANNOUNCEMENT_DEFAULT_EXPIRY_DAYS`), max 90. Expiry hides only the widget; the history keeps it and WhatsApp is unaffected.
- **Safety cap:** 5 announcements per hour per sender (an anti-double-send cap, NOT the business frequency rule).
- **OPEN for the owner:**
  - opt-out / unsubscribe handling;
  - the maximum announcement frequency;
  - whether Admin/Supervisor themselves should be excluded from "everyone" (today they are included).

**Complaints**
- **Filing:** `/complaints/new` (TEACHER, STUDENT, GUARDIAN) → `POST /api/complaints`.
  - Required fields: session, concerned party, category, title, text.
  - Categories (owner): Teaching quality / Behaviour / Punctuality / Technical / Billing / Other.
  - The filer must be a participant of the session: its teacher, a roster student, or the guardian of a roster student. Otherwise 404.
- **Minors' data choice (OPEN for the owner):**
  - A STUDENT or GUARDIAN may only name the session's TEACHER. They do not otherwise see other families' names, so the picker would leak classmates' and other guardians' names.
  - A TEACHER may name any roster student or guardian of their session.
  - Complaints between families: owner to decide.
- **Visibility rule:** the ONLY read paths are `/admin/complaints` and `/admin/complaints/:id`, both ADMIN/SUPERVISOR.
  - The filer gets a confirmation only; there is no list, count, notification or search anywhere else.
  - The concerned party therefore cannot see it by any path, and nothing is sent to anyone.
- **Workflow:** `PATCH /api/complaints/:id`, forward-only through conditional updates — `START` NEW→IN_PROGRESS, then `RESOLVE` IN_PROGRESS→RESOLVED with a required note. A DB CHECK ties RESOLVED to the note and `resolved_at`. The page reminds the handler to inform the concerned party manually.
- **Gap:** there is no unread badge for new complaints. The shell's `navBadges` is per-page and not passed centrally; the inbox shows per-status counts.

**Link click timeline** (`lib/sessions/click-timeline.ts` + `app/_components/sessions/click-timeline.tsx`)
- Read-only, ADMIN/SUPERVISOR only; the data layer itself returns nothing for any other role.
- It appears in (1) the complaint detail view and (2) the report review queue (`/admin/reports`, `/supervisor/reports`).
- Each entry shows who clicked, their role ("Assigned teacher" for the session's teacher), the click time, and minutes before/after the scheduled start.
- Wording is "link click time", never arrival/attendance. It contains no link. Nothing like it existed before (the click table had no reader).
- **What is logged today:** `session_join_clicks` stores `(session, user, time)` for every click on the platform's join button, which redirects to Zoom:
  - Students, guardians, teachers, Admin and Supervisor clicks are all logged.
  - **Join vs host is NOT recorded** — the teacher's host-link click and a join click look the same.
  - Clicks are possible only while the session is SCHEDULED, from 15 minutes before the start to the scheduled end (operators any time); rate limit 30/min.
- **Gaps that make a teacher punctuality metric unreliable:**
  1. The `SESSION_START` WhatsApp at T+0 carries the raw Zoom join link to the teacher, students and guardians. Anyone joining from WhatsApp, or a teacher starting from the Zoom app or a bookmark, leaves NO click.
  2. A click does not prove presence in Zoom.
  3. The first click is not necessarily the join (repeat clicks, Admin test clicks).
  4. If the click insert fails, the redirect still happens and only an error is logged.
  5. There is no join-vs-host distinction.
- No metric or on-time rule was built; it is moved to Phase 9 (9.5).

**Evaluation summaries** — `/admin/evaluations` (ADMIN/SUPERVISOR; nav for both).
- Per teacher: average rating, count, and the 5 most recent comments, with author TYPE only (student/guardian), rating and date.
- Teachers have no route to it; nothing automatic follows from it. Analysis is in Phase 9 (9.5).

**Post-session evaluation prompt** — `EvaluationPromptCard` on the student and guardian dashboards.
- In-app and non-blocking. It counts COMPLETED sessions that ended in the last 7 days (`EVALUATION_PROMPT_WINDOW_DAYS`) with no own evaluation, and links to `/student/sessions` or `/guardian/reports`, where the existing optional evaluation forms are.
- No WhatsApp. Evaluations stay OPTIONAL.

**Nav:**
- Admin/Supervisor: Complaints, Evaluation Summaries, Announcements.
- Teacher/Student/Guardian: Announcements, File a Complaint.

### 2026-10-26 — Teacher late-start rules (owner decision, final)

- **Audit of the worker before the change (read-only):**
  - `SESSION_REMINDER` at T−2h to the teacher, students and guardians.
  - `SESSION_START` at T+0 (with the join link) to the same people.
  - Late-REPORT nudges at the scheduled END: `REPORT_REMINDER` T_end+0, `REPORT_REMINDER_FOLLOWUP` T_end+15, `LATE_REPORT` teacher flag T_end+30 (24 h scan window).
  - Monthly-report reminders (1st/3rd) and the new month flag (4th–7th).
  - **Nothing about a teacher who has not started/joined.** So (a)/(b) did not exist and were implemented.
- **Implemented** (`lib/config/lateness.ts`, `processLateStartAlerts` in `lib/worker/notifications.ts`, run every tick):
  - **(a)** No click by the ASSIGNED teacher by T+5 (`TEACHER_LATE_REMINDER_MINUTES`) → one `TEACHER_LATE_START` WhatsApp job to the teacher (dedup `TEACHER_LATE_START:<sessionId>`).
  - **(b)** Still no click by T+10 (`ADMIN_LATE_ALERT_MINUTES`; the owner said 10–15, so 10 is the default) → one `TEACHER_LATE_START_ADMIN` job per active Admin (dedup `…:<sessionId>:<adminId>`) through the existing notification jobs (WhatsApp).
  - Only SCHEDULED sessions that have not ended, scanned 5–60 minutes after the start.
  - At send time the worker re-checks status, end and click, and CANCELS the job if the teacher clicked meanwhile or the session was cancelled or ended.
  - Teacher and Admins only, never students or guardians. The text carries no link.
  - The `OPENWA_SEND_ALLOWLIST` guard applies. No live send.
- **Known limits:**
  - The WhatsApp-start-link gap above can cause a false reminder or alert for a teacher who joined from WhatsApp or the Zoom app.
  - A session rescheduled AFTER a reminder was sent will not re-alert, because the dedup key is per session.
- **Not built:** the punctuality metric and any late/on-time rule. Moved to Phase 9 with the threshold OPEN.

### 2026-10-26 — OWASP per-slice check (Phase 7 + lateness)

| Category | What protects this slice | Status |
|---|---|---|
| A01 access control | Every new route uses `requireApiRoles` plus academy scoping. Complaints have no read path outside ADMIN/SUPERVISOR. The click-timeline data layer refuses other roles. The filer must be a session participant (404 otherwise). | Done |
| A01/CSRF | `requireSameOrigin` on POST /api/announcements, POST /api/complaints and PATCH /api/complaints/:id. | Done |
| A05 injection | Prisma plus tagged `$queryRaw` with bound parameters only. | Done |
| A06 insecure design | Recipient-count confirmation re-checked server-side; append-only announcements; forward-only complaint states; throttling; dedup keys. | Done |
| A09 logging | Counts and ids only; no bodies, numbers or links. | Done |
| Minors' data | Student and guardian filers see only the teacher's name. Evaluation authors are shown as a type. | Done |

### 2026-10-26 — Phase 7 review fixes (requesting-code-review pass)
- **Fixed — Supervisors were redirected** away from `/admin/complaints`, `/admin/evaluations` and `/admin/announcements`: `proxy.ts` sent unlisted `/admin/*` paths to ADMIN only. The paths were added to the ADMIN+SUPERVISOR list.
- **Fixed — a large announcement could delay time-critical jobs:** due jobs are now fetched in two queries. Non-announcement kinds get the full batch of 50; announcement jobs are fetched separately, limited to the throttle budget. Over-budget announcement jobs simply stay PENDING (no deferral writes).
- **Fixed — late start:**
  - The send-time re-check uses the real clock.
  - A TEACHER_LATE_START job is cancelled if the session's teacher changed after enqueue.
  - An inactive assigned teacher skips only step (a); the Admin alert (b) still fires.
- **Fixed — complaints** can only concern sessions that have already started (cancelled sessions remain allowed).
- **Lint fixes:** the complaint form gets the pre-selected session's parties server-side, so there is no setState in an effect. The prompt-card count moved to `lib/evaluations/prompt.ts`.
- **Open for the owner:**
  - the WhatsApp `SESSION_START` join link that bypasses the click log, causing false late-start alerts (security-review G-A06-1);
  - the announcement confirmation checks the count, not the exact recipient set; there is no server idempotency key.
- **OWASP dedicated pass:** `docs/specs/security-review.md`.
