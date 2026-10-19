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
- Per teacher: evaluation rating (from mandatory student evaluations, Admin-only data), on-time report rate, attendance in sessions, plus edit/delete/actions. Depends on Phase 7 evaluations and Phase 5 `TeacherFlags`. OPEN: exact metric definitions (e.g. "on time" = report before T+15).

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