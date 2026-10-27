# Phase 7 — Admin & Reports

> **Session 5 status (2026-10-26):** announcements, complaints, link click timeline, evaluation summaries, post-session prompt and the teacher late-start rules implemented and committed — see "2026-10-26 — Phase 7 implemented" and "Owner follow-ups". "2 announcements per day" = rolling 24 hours (CONFIRMED). OPEN: self-service announcement opt-out; punctuality metric (Phase 9). Tests deferred (`test-backlog.md`).

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
5. **Monthly report** — 7-day edit window CONFIRMED. Missing report: the teacher gets the existing WhatsApp reminders (1st and 3rd; timing CONFIRMED by the owner later on 2026-10-26) plus an in-app card on the teacher dashboard; the Admin sees a `MONTHLY_REPORT_MISSING` teacher flag (existing teacher-flags mechanism). No money penalty is built (see the Phase 5 spec, "Missing monthly report — what the system can do").
6. **OWASP Top 10 (latest edition: 2025 — edition to be re-verified at the dedicated pass)** — each slice is checked against the relevant categories before it is finished; a dedicated pass at the end of Phase 7 writes `docs/specs/security-review.md`.

## Deferred / Post-MVP

- [DEFERRED] Evaluation prompt, announcements, and student attendance dispute if the owner chooses a smaller MVP.

## Definition of Done

Requirements, authorization, validation, failure paths, tests, lint, typecheck, build, reviewed diff, and execution log are complete.

## Tasks

- [x] Add Prisma schema: `Reports`, `Evaluations`, `Announcements`, `Complaints` — **[audit 2026-10-26] DONE**: `prisma/schema.prisma`; migrations 20261026170000–190000.
- [x] Run migration — **[audit 2026-10-26] DONE**: applied by the owner.
- [~] Build admin overview dashboard with operational and financial metrics — **[audit 2026-10-26] PARTIAL**: operational KPIs on `app/[locale]/admin/page.tsx`; financial charts are Phase 9 item 9.1.
- [x] Build teacher-to-student progress report form and listing — **[audit 2026-10-26] DONE**: monthly reports `app/[locale]/teacher/monthly-reports/*`; `monthly-reports.test.ts`.
- [x] Build guardian/student view of student progress reports — **[audit 2026-10-26] DONE**: `app/[locale]/student/monthly-reports/page.tsx`, `app/[locale]/guardian/monthly-reports/page.tsx`; visibility in `monthly-reports.test.ts`.
- [x] Build student/guardian teacher evaluation submission interface — **[audit 2026-10-26] DONE**: `app/_components/evaluations/*`; API tests `evaluations.test.ts` EV-01..07 (2026-10-26).
- [x] Build general complaints submission form on user dashboards and Admin resolution view (2026-10-26)
- [x] Implement the post-session evaluation prompt (in-app, non-blocking, optional evaluations — 2026-10-26)
- [x] Build admin evaluation review and rating summaries (Admin + Supervisor, 2026-10-26)
- [x] Build admin announcements composer (audience = everyone per owner decision, 2026-10-26)
- [x] Build dashboard announcements widget for every role (2026-10-26)
- [x] Write tests: reporting authorization, evaluation submission, announcement scoping, complaints flow — **[audit 2026-10-26] DONE**: `visibility.test.ts`, `evaluations.test.ts`, `announcements.test.ts`, `phase7-visibility.test.ts`, `late-start-and-monthly-flag.test.ts` (2026-10-26).

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
  1. ~~The `SESSION_START` WhatsApp at T+0 carries the raw Zoom join link~~ — **fixed 2026-10-26 (owner follow-up 1):** no WhatsApp message carries a Zoom link any more; they carry the platform join URL, which logs the click. Click data is reliable **only for joins through the platform**: a teacher starting from the Zoom app, a bookmark or a link copied earlier still leaves NO click.
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
  - `SESSION_START` at T+0 (with the join link — the raw Zoom link until the 2026-10-26 follow-up, the platform join URL since) to the same people.
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
  - A teacher who starts from the Zoom app or a saved link (not through the platform) still gets a false reminder/alert. The WhatsApp link no longer causes this (follow-up 1).
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
  - ~~the WhatsApp `SESSION_START` join link that bypasses the click log~~ — fixed in the follow-ups below (security-review G-A06-1);
  - the announcement confirmation checks the count, not the exact recipient set; there is no server idempotency key.
- **OWASP dedicated pass:** `docs/specs/security-review.md`.

### 2026-10-26 — Owner follow-ups (after the Phase 7 report)

1. **No Zoom link in any WhatsApp message.**
   - `SESSION_START`, `SESSION_REMINDER` and `TEACHER_LATE_START` now carry the platform join URL `<NEXTAUTH_URL>/api/sessions/<id>/join` (`lib/config/platform-url.ts`). That route checks role and join window, **logs the click**, then redirects to Zoom.
   - A link is included only when the join window is open at send time (`joinWindowState`). The T−2h reminder is before the window, so its text says the link opens on the platform 15 minutes before the start (no dead link).
   - Without `NEXTAUTH_URL` no link is built and the text says "join from the platform".
   - A signed-out reader who opens the link is redirected to the login page instead of a JSON 401.
   - The worker no longer loads `zoomJoinUrl` at all. Lateness rules unchanged (T+5 teacher, T+10 Admin).
   - Remaining gap: `GET /api/sessions` still returns the raw `zoomJoinUrl` to participants (review-before-phase-04 F3), so a link can still be copied from the platform; joins that way leave no click.
2. **Dependency upgrades** — see the session report / security-review §A03 (each upgrade verified separately).
3. **Complaints — "another participant in this session".**
   - Students and guardians still NAME only the session's teacher. They may also choose "Another participant in this session", with no names shown. It is offered only when the session has someone outside the filer's own family (another student or that student's guardian).
   - Stored with `concerned_user_id`/`concerned_role` both NULL (migration `20261026190000_complaints_unnamed_participant`, CHECK `complaints_concerned_pair_check`). The Admin/Supervisor detail shows "not named by the filer" plus the session roster (students + guardians) to identify the person.
   - Teachers keep naming students/guardians of their own session.
4. **Announcements.**
   - "Everyone" = active TEACHER, STUDENT and GUARDIAN users. Admin and Supervisor are excluded from WhatsApp delivery (the in-app history stays visible to all roles).
   - Per-user "no announcements" flag `users.announcements_opt_out` (migration `20261026180000_users_announcements_opt_out`). Set by an **ADMIN only** (Students/Teachers/Guardians lists, `PATCH /api/admin/profiles/:id`, 403 for a Supervisor). A flagged user gets no WhatsApp; the in-app copy stays. The composer shows how many are switched off.
   - **OPEN:** self-service opt-out by the user.
   - Frequency: `ANNOUNCEMENT_MAX_PER_DAY = 2` per academy in any rolling 24 hours (`lib/config/announcements.ts`), checked inside the send transaction under a per-academy advisory lock → 429 `ANNOUNCEMENT_DAILY_LIMIT`, nothing written. "Per day" = a rolling 24 hours (not a calendar day) — CONFIRMED by the owner 2026-10-26.
5. **Monthly-report timing CONFIRMED:** reminders on the 1st and 3rd, Admin flag from the 4th. Money penalty stays OPEN.
6. **Security headers** (`next.config.ts`, all paths): `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`. No CSP and no HSTS (launch items in `deploy-checklist.md` §8).
- Migrations touch only `users`, `announcements` (id default drift fix) and `complaints`. **No financial or attendance table.**

### 2026-10-26 — Phase 8 audit
(Legend: [x] done, [~] partial, [-] obsolete/deferred, [ ] missing — verified against the code and tests on 2026-10-26.) Real defect found and fixed: the evaluations API answered 200 instead of 201 on every first submission (Date objects compared with ===); `submitEvaluation` now reports `created`.

### 2026-10-27 — Code-review slices (owner decisions, test-first)
- **#1 Late-start reminder per assigned teacher:** dedup key is now `TEACHER_LATE_START:<sessionId>:<teacherUserId>`, so a teacher who replaces another after T+5 is reminded once too; the old teacher's pending reminder is still cancelled at send time. Test LS-05. Transition note: a session that is mid-lateness at deploy time may remind its teacher once more (old key format).
- **#4 Announcement repeat cap:** the 5-per-hour cap per author now counts ACCEPTED announcements only (from the `announcements` table, durable across restarts) — refused attempts (stale count, bad expiry, validation) never use it up. Constant `ANNOUNCEMENT_MAX_PER_AUTHOR_PER_HOUR = 5`. Test AN-13.
- **#5 Dashboard flag counts (option a):** the Admin/Supervisor red-mark tile counts LATE session-report flags only (matching the reports queue it links to); missing monthly reports are a separate line linking to the monthly-reports page (`lib/reports/teacher-flag-counts.ts`). Test FLG-01.
- **#6 Monthly-flag scan cost:** same rule (days 4–7 of the teacher's local month, one flag per teacher and month), now batched: 3 queries per tick per previous-month key instead of 3 per teacher. Tests MR-02 (cost) + MR-01/INT-MON-05 (rule unchanged).
- **#3 and #8:** plans shown to the owner; no code until approved.
