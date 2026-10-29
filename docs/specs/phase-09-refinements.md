# Phase 9 — Refinements & UI/UX Polish

> Status: **Not Started — documented only (owner, 2026-10-14).** Starts AFTER the system is functionally complete (Phases 5–8 done). Nothing here is built early. Everything is PROPOSAL until the owner confirms it; items marked OPEN need an owner decision. No mock data (CONTEXT §13/§21): every screen reads the real database through `lib/data/*`.
> Supervisor rule applies everywhere: Supervisor never receives money fields (CONTEXT §4, §21.5).

## Goal

Raise the existing dashboards and management screens to a finished, client-ready product: richer Admin home, full teacher/student/guardian management tables, calendar views, a notifications inbox, teacher performance monitoring, and a deductions/bonuses page.

## Known issue carried in (owner)

- **Assignments** (student ↔ teacher ↔ subject) have problems to be reported by the owner. OPEN: owner lists the exact problems; they are triaged at the start of this phase (bugs vs. new features).

## Items (as requested by the owner, 2026-10-14)

### 9.1 Admin home page
- Add cards: number of students, number of teachers, this week's sessions — on top of the existing cards.
- Financial charts (collections vs. teacher payroll liabilities, per currency). Admin only; Supervisor sees no money charts.

### 9.2 Teachers page (Admin)
- Table: teacher name, hourly rate, WhatsApp number, status, and an actions column (edit, delete/deactivate, settings…). Hourly rate is Admin-only (hidden from Supervisor).
- "Add teacher manually" form (not via application): full name, specialization (subject), WhatsApp number, hourly rate + currency, plus all fields that exist on the teacher application form. The rate is written to `TeacherRates` (effective-dated, Phase 6).
- Delete = soft deactivate (`is_active=false`) — hard delete is forbidden by the ledger FK policy (database-schema §27).

### 9.3 Students page (Admin/Supervisor)
- "Add student manually" form: all application-form fields plus **account type: Trial / Active-paying**. OWNER DECISION 2026-10-14: "trial" means a **free trial session** — this REVERSES the earlier CONFIRMED "no trial-session type" (CONTEXT §7/§17). Still OPEN before any build: is the teacher paid for a trial session, how many trials per student, does a trial consume credit, how a trial converts to a paying account, and how the settlement transaction treats it (Phase 6 is built WITHOUT trials; trials are added here), full name, age (decides guardian-or-not, already built), WhatsApp number, **country** (new field), and the teacher-per-subject / subject-per-teacher assignment.

### 9.4 Notifications page (new; Admin + Supervisor)
- Inbox of: teacher/student session-cancellation (outage) requests; sessions whose report is missing; sessions whose attendance was not recorded (present/absent/cancelled); each item shows the session, teacher and student context and links to the action.
- Builds on the Phase 5 queues (`SessionRequests`, reports queue, `TeacherFlags`); it is an aggregation view, not new business rules. OPEN: read/unread state and a badge counter.

### 9.5 Teacher performance page (new)
- Per teacher: evaluation rating (from the OPTIONAL student/guardian evaluations — owner, 2026-10-26; Admin/Supervisor-only data), on-time report rate, attendance in sessions, plus edit/delete/actions. Depends on Phase 7 evaluations and Phase 5 `TeacherFlags` (incl. `MONTHLY_REPORT_MISSING`, 2026-10-26). OPEN: exact metric definitions (e.g. "on time" = report before T+15).
- **Teacher punctuality metric (owner, 2026-10-26 — NOT built):** based on the platform link-click log (`session_join_clicks`), which Phase 7 shows read-only to Admin/Supervisor as "link click time". **Lateness threshold OPEN for the owner.** Known reliability gaps to solve first (Phase 7 log): the T+0 WhatsApp start message carries the raw Zoom join link (joins from WhatsApp/Zoom app leave no click); join vs host clicks are not distinguished; a click does not prove presence. Operational late-start alerts (T+5 teacher reminder, T+10 Admin alert) already exist since 2026-10-26 — this item is the METRIC/rating, not the alerts.
- **Teacher performance ANALYSIS (owner, 2026-10-26):** moved here from Phase 7. Phase 7 builds only the per-teacher evaluation SUMMARY (average, count, recent comments; Admin + Supervisor; no automatic action; the teacher never sees it). Trends, comparisons and any combined score belong to this page. OPEN: which metrics, periods and whether any score is shown.

### 9.6 Calendar views
- Sessions shown as a calendar (week/month/day) for Student, Teacher, Admin and Supervisor, for both viewing and creating sessions. Times in the viewer's timezone (already stored in UTC). OPEN: calendar library vs. hand-built (no new dependency without asking — CONTEXT §21.5).

### 9.7 Guardians page (new)
- List all guardians with status and totals; open a guardian to see their family: number of children, each child's sessions/paid-or-not status. Payment status is a money-adjacent read for Admin; Supervisor sees status only if the owner allows (OPEN).

### 9.8 Deductions & Bonuses page (last)
- Admin-only page over `PayrollLedger` `ADMIN_ADJUSTMENT` entries (fines/bonuses/approved overtime): create, list, filter by teacher/currency. Corrections only by new entries (append-only). Supervisor: no access.

### 9.9 Timezone by country — automatic session times (owner, 2026-10-18)
- Every session time is shown automatically in the viewer's own timezone, derived from the viewer's **country/region**, for the Student, the Guardian and the Teacher (Admin/Supervisor too). Storage stays UTC (CONTEXT §6); only display and input change.
- Builds on the existing `User.timezone` (IANA) and the student `country` field added in 9.3. PROPOSAL: choosing a country sets a default IANA timezone; countries with several zones (US, Canada, Russia...) require picking the zone; the user can override it in their profile. Admin/Supervisor can edit it for any user.
- Applies to: session lists and calendars (9.6), the Zoom join button window, WhatsApp reminders (the 2h reminder and the start message are formatted in the RECIPIENT's timezone), report deadlines shown to the teacher, invoice/renewal dates. DST changes are handled by IANA rules, never by fixed offsets.
- Admin scheduling forms keep one explicit "session timezone" (the wall-clock the series was created in, DST-safe per Phase 3) and show the teacher's and each student's local time next to it. Weekly series keep the SAME local time in the series timezone; recipients see the converted time.
- OPEN: does the guardian's timezone or the student's timezone win when they differ? PROPOSAL: each person sees their own. OPEN: Admin form shows one preview row per participant or only a hover.
- Dependency: existing timezone rendering from Phase 3/4/5 is reused; no new library (use `Intl`).

### 9.10 Join the session 30 minutes before the start (owner, 2026-10-18)
- The Zoom join button/redirect opens **30 minutes before the scheduled start** (until the scheduled end). Admin/Supervisor stay exempt.
- This CHANGES the Phase 4 contract: `JOIN_OPENS_BEFORE_START_MINUTES` in `lib/config/session-join.ts` is 15 today (Phase 4 spec/acceptance criteria, `phase4-live-links.test.ts` window tests, and `sessions.test.ts` scenario 11 assume 15). Change the constant to 30 and update the Phase 4 spec text, the localized button hint ("opens N minutes before") and the affected tests in the same change.
- Note: the Stitch design file (`DESIGN.md`) says the "Enter Classroom" button appears at T-10 minutes; the owner's 30-minute rule wins, and the screens must show 30.
- OPEN: should the reminder WhatsApp with the join link (currently at the scheduled start, CONTEXT §6) move to the moment the window opens (T-30)? PROPOSAL: keep the 2h reminder, and send the link message at T-30 so it matches the button. Owner confirms.
- OPEN: should the 30 minutes be Admin-configurable in AcademySettings instead of a code constant? PROPOSAL: yes, default 30.

## Acceptance criteria
- Each screen works on seeded real data in Arabic/English, RTL, mobile and desktop, with loading/empty/error states.
- Server-side authorization for every action; money fields absent for Supervisor in the data layer.
- No ledger history edited or deleted by any new action.

## Database
Expected additions (to be designed in the phase's own plan, owner confirms before migration): student `country`, student account type (trial/active, OPEN), notification read-state (OPEN). Everything else reuses existing tables.

## Tests
Real-DB authorization tests per new endpoint (Admin/Supervisor/others), Supervisor money-field absence, soft-delete behavior, calendar timezone rendering, Playwright smoke per page.

## Tasks
- [ ] Owner lists the Assignments problems → triage
- [ ] 9.1 Admin home cards + finance charts
- [ ] 9.2 Teachers table + add-teacher form
- [ ] 9.3 Add-student form (country, account type, assignment)
- [ ] 9.4 Notifications page
- [ ] 9.5 Teacher performance page
- [ ] 9.6 Calendar views (4 roles)
- [ ] 9.7 Guardians page
- [ ] 9.8 Deductions & Bonuses page
- [ ] 9.9 Timezone by country (display, forms, WhatsApp times)
- [ ] 9.10 Join window 30 minutes (constant + Phase 4 spec + tests)
- [ ] Tests, lint, typecheck, build, spec log

## Execution log
- 2026-10-14: spec created from the owner's list. No code written.
- 2026-10-18: added 9.9 (timezone by country) and 9.10 (join 30 minutes before) from the owner. Documentation only.
- 2026-10-24: Session 3 addendum (owner, document only — do NOT implement here): owner re-stated 9.9 + 9.10 with two sharpened constraints and open questions, recorded below. 9.9/9.10 remain the canonical entries; this addendum adds the owner's exact framing.

## Session 3 addendum (owner, 2026-10-24 — document only, not implemented)

### C.1 Session times in each user's own timezone (extends 9.9)
- Session times are DISPLAYED in each user's own timezone — student, teacher, guardian — derived from their country; stored times stay UTC (CONTEXT §6); only display (and input) change.
- Open questions (owner to answer before any build):
  1. Where does a user's timezone come from — the `Users.timezone` column set at application/approval time, the `country` field proposed in 9.3, or a profile setting the user can change? Who may edit it (self? Admin/Supervisor?)?
  2. For countries spanning several IANA zones, does the system pick a default and let the user override, or force an explicit choice at first login?
  3. When the guardian's and the student's timezones differ, does each viewer simply see their own (PROPOSAL in 9.9) — confirm.

### C.2 Join button 30 minutes before the start (extends 9.10)
- The join button/link becomes enabled 30 minutes before the session start (changes `JOIN_OPENS_BEFORE_START_MINUTES` in `lib/config/session-join.ts` from 15 to 30 when its time comes).
- Security invariant to keep when this changes: the Zoom link itself stays SECRET — visible only to the session's teacher, its students (and their guardians), and Admin/Supervisor. Enabling the window earlier never widens WHO can read the link, only WHEN the button works.
- Open questions (owner to answer before any build):
  1. Does the 30-minute window apply to ALL roles (student, teacher, guardian) or only students? (Admin/Supervisor are exempt today by design.)
  2. Should the 30 minutes be Admin-configurable in AcademySettings instead of a code constant (9.10 PROPOSAL), and should the WhatsApp link message move to T-30 to match the button?
## Session 5 addendum (owner, 2026-10-25 — document only, NOT implemented)

### 9.11 Teacher daily schedule on WhatsApp (owner, 2026-10-25)
- **What:** at **midnight in each user's own timezone** the teacher receives that day's sessions by WhatsApp. Session times are converted to the teacher's timezone; the text is in the teacher's preferred language; the academy name comes from the database/AcademySettings (no hardcoded brand); **no Zoom links** in this message.
- **Message format (placeholders, rendered per language):**
  1. Greeting with the teacher's name — "Good morning, <teacher name>".
  2. "Here is your schedule for <weekday, date>:".
  3. Numbered list, one line per session: "<n>. <student> - <minutes> min at <time>".
  4. A separate "Make-up sessions" list for replacement sessions (`replacement_for_session_id IS NOT NULL`), same line format.
  5. Closing line (e.g. "Have a blessed day.").
  6. Sign-off with the academy name.
- **Design (PROPOSAL):**
  - A **planner tick** in the existing DB-polling worker (`lib/worker/notifications.ts`). For each active teacher whose local clock has passed 00:00 of local date D, create ONE `notification_jobs` row, kind `TEACHER_DAILY_SCHEDULE`, `dedup_key = TEACHER_DAILY_SCHEDULE:<teacherId>:<YYYY-MM-DD local>` — unique, so re-scans and restarts are idempotent (`createMany … skipDuplicates`).
  - Payload = `{ localDate }` only (redaction rule: no names, no times, no links in the row). The worker composes the list at send time from the sessions table.
  - Skip teachers with no sessions that day (no job at all). Exclude `CANCELLED` sessions (and `MISSED`).
  - Missing OpenWA config → the normal FAILED row, no crash, nothing rolled back (INSTRUCTIONS §10).
  - OpenWA is unofficial (can be banned): consider an **in-app fallback** — the same list as a "Today" card on the teacher dashboard (the dashboard already lists today's classes), so WhatsApp is never the only channel.
- **Decided:** the user's timezone comes from the user's **country** (see 9.9 / C.1).
- **Open questions (owner):**
  1. Group sessions: one line per session ("Group: <n> students") or one line per student?
  2. Sessions added, moved or cancelled AFTER midnight: send an update message, show only in-app, or nothing?
  3. Retry policy: the generic worker retry (transient failures, 3 sends, 2 m / 10 m backoff) — or a cut-off (e.g. do not send after 08:00 local)?
- **Tests (later):** idempotent planner (two ticks → one job); DST day; teacher with only cancelled sessions → no job; replacement sessions in the separate list; no Zoom URL in the composed text; missing config → FAILED.

### 9.12 Session times in each user's own timezone + join 30 minutes before (owner, 2026-10-25 — restates C.1/C.2)
- Every session time is shown in **the viewer's own timezone** (derived from the user's country); storage stays UTC.
- The join button becomes enabled **30 minutes before** the session start (`JOIN_OPENS_BEFORE_START_MINUTES` 15 → 30).
- The Zoom link stays SECRET: only that session's teacher, its students, their guardians and Admin. **Question for the owner:** the current code (and CONTEXT §6) also lets the **Supervisor** see/edit the links (Supervisor manages schedules and Zoom links, CONTEXT §4). Keep Supervisor access, or remove it as this wording implies?
