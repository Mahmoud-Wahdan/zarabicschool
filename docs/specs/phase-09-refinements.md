# Phase 9 — Refinements & UI/UX Polish

> **Superseded for planning (2026-10-27).** Current sources: decisions `phase-09-decisions.md` (D1–D27), plan + traceability `phase-09-plan.md` (slices S-00..S-14), open questions + SQL `phase-09-open-questions.md`. Everything below is HISTORY (owner requests 2026-10-14..26, the drafts and Q1–Q16); where it disagrees with the register, the register wins (e.g. D3 replaces `users.country`, D15 removes trials).

> Status: **Not Started — documented only (owner, 2026-10-14).** Starts AFTER the system is functionally complete (Phases 5–8 done). Nothing here is built early. Everything is PROPOSAL until the owner confirms it; items marked OPEN need an owner decision. No mock data (CONTEXT §13/§21): every screen reads the real database through `lib/data/*`.
> Supervisor rule applies everywhere: Supervisor never receives money fields (CONTEXT §4, §21.5).

## Goal

Raise the existing dashboards and management screens to a finished, client-ready product: richer Admin home, full teacher/student/guardian management tables, calendar views, a notifications inbox, teacher performance monitoring, a deductions/bonuses page, and safe roster changes on scheduled sessions (9.13).

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
  - Update 2026-10-26: WhatsApp now carries the platform join URL (never the Zoom link) and only while the window is open at send time; the T−2h reminder says when the link opens. If the window becomes 30 minutes, the text follows the constant automatically.
- OPEN: should the 30 minutes be Admin-configurable in AcademySettings instead of a code constant? PROPOSAL: yes, default 30.

### 9.13 Roster changes after scheduling (owner, 2026-10-26 — CONFIRMED, NOT implemented)
- **Base requirement:** Admin and Supervisor can ADD or REMOVE a student on a scheduled **GROUP** session. Removal **releases that student's reservation** (credit returns). A **PRIVATE** session is not edited student-by-student — they CANCEL it (existing cancel flow, which frees the credit).
- **(i) CONFIRMED:** removing a student from a group session is **blocked once that student has a SUBMITTED or APPROVED report** for the session (the report drives attendance and pay; history is never rewritten).
- **(ii) CONFIRMED:** when an Admin **cancels or reduces a subscription** that still has upcoming RESERVED sessions, the screen **lists the affected sessions** and requires removing the student from them first (no silent orphaned reservations).
- Adding a student reserves credit like a new booking (the same assignment, credit and override rules as session creation).
- Touches attendance/financial tables (`session_students`, `session_reservations`, subscriptions) → the slice plan shows its queries and any migration for the owner's OK before code.

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
- [ ] 9.13 Roster changes after scheduling: add/remove a student on a GROUP session (removal releases the reservation; PRIVATE = cancel); (i) removal blocked once the student has a SUBMITTED/APPROVED report; (ii) cancelling/reducing a subscription with upcoming reservations lists them and requires removal first
- [ ] Tests, lint, typecheck, build, spec log

## Execution log
- 2026-10-14: spec created from the owner's list. No code written.
- 2026-10-18: added 9.9 (timezone by country) and 9.10 (join 30 minutes before) from the owner. Documentation only.
- 2026-10-26: 9.13 roster changes after scheduling added and CONFIRMED by the owner (base requirement + (i) + (ii)); not implemented. Planned as slice S16 (after S7 students page; needs the owner's OK on the queries/migration because it touches attendance and credit tables).
- 2026-10-26: "Plan (draft)" written (slice roadmap + owner questions, end of this file). Planning only; Phase 8 runs first.
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

## Plan (draft) — 2026-10-26, PLANNING ONLY (no code, no migrations, no commits)

> Made with the superpowers brainstorming + writing-plans skills. Phase 9 spans several independent subsystems, so this is a **slice roadmap**: each slice gets its own detailed, test-first task plan only after the owner answers that slice's questions. **Phase 8 (testing & launch) runs BEFORE Phase 9** (owner, 2026-10-26). Nothing that depends on the Paymob **MOTO** answer is planned. Money items list questions only — no rules are invented.

### Global constraints (every slice)
- Real data only through `lib/data/*` / server queries (CONTEXT §21.1); Arabic + English, RTL, mobile + desktop; loading / empty / error states.
- Server-side authorization on every route (`requireApiRoles` + academy scope + `requireSameOrigin` on mutations). Supervisor never receives money fields (data layer omits them).
- Ledgers are append-only: no UPDATE/DELETE of `subscription_ledger` / `payroll_ledger` / `payment_audit`; corrections only by new entries.
- Minors' data: no student/guardian names, phones or report content in logs or notification payloads (ids only); WhatsApp never carries Zoom links or provider/payment URLs/tokens; never send finance messages to a student who has a guardian.
- No new dependency without the owner's OK (CONTEXT §21.5). New migrations = new file, no BOM, owner applies; **financial/attendance tables need the owner's explicit OK**.
- No live WhatsApp sends until the WhatsApp live test (last); `OPENWA_SEND_ALLOWLIST` guard stays.
- Tests are written in the slice that builds the feature (IDs below are logged in `test-backlog.md` § "Phase 9 (planned)").

### Item inventory

| # | Item | Goal | Status | Owner must decide | Dependencies | Security / minors' data | Risk |
|---|---|---|---|---|---|---|---|
| A | Assignments fixes | Fix the student↔teacher↔subject problems the owner reported | OPEN — problem list not given | The exact problems (bugs vs new features) | — | Assignment changes affect who sees which student: keep academy scope + audit | Med (unknown scope) |
| D | New design / UI polish | Apply the new design across shell + pages | OPEN | What "the new design" is (new Stitch export? Figma? same tokens?), and whether it lands before or after the new pages | Design files from the owner | None new; never put money widgets on Supervisor screens | High if done after the new pages (double work); breaks Playwright UI journeys (Phase 8 defers them) |
| 9.10 | Join window 30 min | Join button/redirect opens 30 min before start (today 15) | CONFIRMED (value); scope OPEN | All roles or students only? Code constant or Admin setting? Keep Supervisor access to the Zoom links (CONTEXT §4 vs 9.12 wording)? | Phase 4 tests (`phase4-live-links`, `sessions` scenario 11) change with it | Window widens WHEN, never WHO; link stays secret; click log unchanged | Low |
| 9.9 / 9.12 / C.1 | Timezone by country | Every time shown in the viewer's own zone, derived from their country; storage stays UTC | CONFIRMED (from country); details OPEN | Country field for ALL roles or students only? Multi-zone countries: default + override or forced choice? Who may edit (self / Admin / Supervisor)? Guardian vs student each see their own (confirm) | Migration `users.country` (users table, not financial) | Country is personal data of minors: shown only to Admin/Supervisor and the user; never logged | Med (touches every time display + WhatsApp templates; DST) |
| 9.11 | Teacher daily WhatsApp schedule | At 00:00 in the teacher's zone, one WhatsApp with today's sessions; make-ups listed separately; teacher's language; academy name from settings; no Zoom links | CONFIRMED (content); 3 details OPEN | Group sessions: one line per session or per student? Changes after midnight: update message / in-app only / nothing? Cut-off (e.g. not after 08:00 local) or generic retry? | 9.9 (timezone), OpenWA (no live send), in-app "Today" card as fallback | Student names go to the teacher only (already their students); payload `{localDate}` only; no links | Med (unofficial provider; DST midnight) |
| 9.1 | Admin home cards + charts | Student/teacher counts, this week's sessions; finance charts (collections vs payroll liabilities per currency) | PROPOSAL | Which finance metrics + periods; chart approach (hand-built SVG recommended, no dependency) | Phase 6 ledgers | Finance charts Admin-only; Supervisor home gets the non-money cards only (data layer) | Low–Med |
| 9.2 | Teachers page | Table (name, rate, WhatsApp, status, actions) + add-teacher manually; delete = deactivate | PROPOSAL | Fields of the add form (same as the teacher application?); can a Supervisor add teachers (without the rate)? | Writes the rate via the existing effective-dated `teacher_rates` API (financial table — existing path, no schema change) | Rate Admin-only; phone shown to Admin/Supervisor only | Med (money field on a shared page) |
| 9.3 | Students page + add-student | Add student manually (application fields + country + assignment); **account type Trial / Active-paying** | PROPOSAL; **trial = OPEN (money)** | All trial rules (questions M1–M5 below) — trial is NOT built until answered | 9.9 (country); trial changes settlement (financial) | Minor without guardian: Admin can still create one (reported 2026-10-26) — decide whether the form forbids it | High for trial (touches settlement), Low for the rest |
| 9.7 | Guardians page | List guardians + family view (children, sessions, paid-or-not) | PROPOSAL | May a Supervisor see a child's paid/unpaid status? | — | Payment status is money-adjacent: Admin only unless the owner allows | Low |
| 9.4 | Notifications inbox | One Admin/Supervisor inbox: outage requests, missing reports, unrecorded attendance, flags, new complaints | PROPOSAL | Read/unread state per user or shared? Badge counter? Include complaints? | Optional migration `notification_reads` (new table, not financial) | Complaint titles only to Admin/Supervisor; no money items for Supervisor | Low–Med |
| 9.6 | Calendar views | Week/month/day calendar for Student, Teacher, Admin, Supervisor; create sessions from it (Admin/Supervisor) | PROPOSAL | Library vs hand-built (recommend hand-built CSS grid, no dependency); create from the calendar in v1 or view-only first? | 9.9 (timezone) | Students/guardians see only their own sessions; no Zoom link in markup (redirect only) | Med (timezone/DST rendering) |
| 9.5 | Teacher performance page | Per teacher: evaluation average (existing summary), on-time report rate, attendance, rejection count, **punctuality from link-click times** | PROPOSAL; **lateness threshold OPEN** | Threshold (minutes after start = late); metric definitions ("on time" report = before T+15?); periods; is any combined score shown? Does the teacher see her own metrics? | Phase 7 click timeline + evaluations; click data reliable only for joins through the platform (2026-10-26) | Admin/Supervisor only; evaluation authors by type only; label "link click time", never "arrival" | Med (misleading metric if clicks are missed) |
| E | Admin payment-link message | Admin sends the payer a WhatsApp with the amount + link to the platform invoice page (login required) | Design E (phase-06) — **money: rules to confirm** | Questions P1–P6 below | Migration: `LINK_SENT` in `payment_audit` CHECK (financial table → owner OK); NOT MOTO-dependent (platform page, not a Paymob link) | Finance wall: guardian, or adult student without guardian; never a provider URL/token | Med |
| 9.8 | Deductions & bonuses page | Admin page over `payroll_ledger` `ADMIN_ADJUSTMENT` (fines, bonuses, overtime): create, list, filter | PROPOSAL — **money: rules needed** | Questions B1–B8 below | Existing `/api/payroll/adjustments` (A5 idempotency); possible migration for a category column (financial → owner OK) | Admin only; teacher sees own entries (reason text?) | Med–High (money) |

### Slices (proposed order)

Each slice = a small vertical cut (data → API → UI → tests → docs) with its own plan, review and commit set. "Mig" = migration needed (owner applies).

| # | Slice | Covers | Mig | Blocked on | Test IDs (planned) | Docs |
|---|---|---|---|---|---|---|
| S0 | Assignments triage | A | ? | Owner's problem list | P9-AS-* | phase-09, phase-02 |
| S1 | Join window 30 min | 9.10 | No (Yes if Admin-configurable: `academy_settings` key only, no schema) | Q4 | P9-JW-01..03 | phase-04, phase-09, CONTEXT §6 note |
| S2 | Country + timezone foundation | 9.9 data + profile/admin edit + country→IANA defaults | `users.country` (+ optional `timezone_source`) — users table | Q3 | P9-TZ-01..04 | database-schema, phase-09 |
| S3 | Timezone everywhere | session lists, dashboards, invoices, WhatsApp templates in the recipient's zone | No | S2 | P9-TZ-05..08 | phase-09 |
| S4 | Design foundation | new tokens/shell/components (if the new design changes them) | No | Q1 (design files) | Playwright smoke after the redesign (Phase 8 defers UI journeys) | phase-09, CONTEXT §21 |
| S5 | Admin home cards + charts | 9.1 (+ Supervisor non-money cards) | No | Q8 (finance metrics) | P9-HM-01..03 | phase-09 |
| S6 | Teachers page | 9.2 | No | Q9 | P9-TC-01..04 | phase-09 |
| S7 | Students page (no trial) | 9.3 without trial | No (uses S2 country) | Q10 | P9-ST-01..03 | phase-09 |
| S8 | Guardians page | 9.7 | No | Q11 | P9-GD-01..02 | phase-09 |
| S9 | Notifications inbox | 9.4 | `notification_reads` (new table) if read-state is wanted | Q12 | P9-NT-01..03 | phase-09, database-schema |
| S10 | Calendar views | 9.6 | No | Q13, S3 | P9-CA-01..03 | phase-09 |
| S11 | Teacher daily schedule | 9.11 (+ in-app "Today" card) | No (job kind is free text) | Q5, S2 | the 9.11 test list → P9-DS-01..06 | phase-09, phase-05 worker notes |
| S12 | Teacher performance | 9.5 incl. punctuality metric | No | Q7 (threshold + definitions) | P9-PF-01..04 | phase-09 |
| S13 | Payment-link message | E | `LINK_SENT` audit value (**financial — owner OK**) | P1–P6 | PL-01..05 (existing) | phase-06 E, phase-09 |
| S14 | Deductions & bonuses | 9.8 | maybe category column (**financial — owner OK**) | B1–B8 | P9-DB-01..05 | phase-06, phase-09 |
| S16 | Roster changes after scheduling | 9.13 (base + i + ii, CONFIRMED) | Probably none (reservation release exists); show queries — **attendance/financial tables → owner OK** | — | P9-RC-01..05 | phase-03, phase-09 |
| S15 | Trial accounts | 9.3 trial | likely students/settlement (**financial — owner OK**) | M1–M5 | P9-TR-* | CONTEXT §7, phase-06 |

Rationale: smallest confirmed item first (S1); the timezone foundation early because 9.11, the calendar and every new page display times; the design foundation BEFORE the new pages so nothing is styled twice; read-only pages before money; money slices last and only with explicit rules.

### Questions for the owner (most blocking first)

**Q1 — Design (blocks S4 and the order of every UI slice):** what is "the new design" (new Stitch export, Figma file, or polish of the current Stitch tokens)? Please share the files. Should it land before the new pages (recommended) or after?
**Q2 — Assignments:** list the exact problems (steps, expected vs actual).
**Q3 — Timezone:** (a) country field for all roles or students only? (b) multi-zone countries: default zone + user override, or forced choice at first login? (c) who may edit country/zone — the user, Admin, Supervisor? (d) confirm each viewer sees their own zone (guardian ≠ student is fine).
**Q4 — Join window:** (a) 30 min for all roles (teacher, student, guardian) or students only? (b) code constant or Admin setting (default 30)? (c) keep Supervisor access to Zoom links (CONTEXT §4) or remove it (9.12 wording)?
**Q5 — Daily schedule:** (a) group session = one line "Group: n students" or one line per student? (b) changes after midnight: update WhatsApp, in-app only, or nothing? (c) cut-off time after which the message is not sent (e.g. 08:00 local)?
**Q6 — Money rules for the payment link (E):** P1 confirm recipient = guardian, or adult student without guardian, never a student with a guardian; P2 limits 1 per invoice per 24 h and 3 in total? P3 invoices have no due date today — omit it, or add a due date (invoices = financial table)? P4 link to the platform invoice page with login (no Paymob link) — confirm; P5 OK to add `LINK_SENT` to `payment_audit` (migration on a financial table)? P6 which languages (recipient's preferred language)?
**Q7 — Teacher performance:** lateness threshold (minutes after start); "on-time report" definition (before T+15 after the end?); periods (month / 3 months?); show a combined score or only separate metrics? does the teacher see her own metrics?
**Q8 — Admin home finance charts:** which series (collections by currency, payroll owed, disbursed) and which period (last 6 months?).
**Q9 — Teachers page:** add-teacher fields = the teacher application fields + rate? may a Supervisor add a teacher (rate left to the Admin)?
**Q10 — Students page:** may the add-student form create a minor WITHOUT a guardian (today possible, and then nobody can pay)? Recommend: forbid it in the form.
**Q11 — Guardians page:** may a Supervisor see a child's paid/unpaid status?
**Q12 — Notifications:** read/unread per user or shared by all Admins/Supervisors? badge? include complaints?
**Q13 — Calendar:** hand-built (recommended) or a library (new dependency)? create sessions from the calendar in v1 or view-only first?
**Q14 — Deductions & bonuses (money):** B1 categories (fine, bonus, overtime, other)? B2 is a reason mandatory and does the TEACHER see it? B3 limits (max amount per entry / per month)? B4 currency = the teacher's currency only? B5 can an entry be reversed — only by an opposite entry with a reason? B6 does an entry apply to a month (payroll month) or just to the date it is written? B7 notify the teacher (WhatsApp/in-app)? B8 Admin only — confirm no Supervisor access at all.
**Q15 — Trial accounts (money, 9.3):** M1 is the teacher paid for a trial session (rate?)? M2 how many trials per student? M3 does a trial consume or need credit? M4 how does a trial convert to a paying account? M5 how does settlement treat a trial report?

### Recommended first slice
**S1 — Join window 30 minutes**: confirmed by the owner, smallest change, independent of the design and of money; needs only Q4 (a–c). If Q1 (design) is answered quickly, S2 (country + timezone foundation) follows, then S4.

## Plan (draft) — revision 2 (2026-10-26, after Phase 8 session 1) — PLANNING ONLY, no code

Phase 9 starts after Phase 8. This revision adds, for every item, its status, its data/schema impact and its test strategy, and shows the SQL for every change to a financial or attendance table. **Nothing here is applied:** each migration is a new file, without a BOM, applied by the owner, and financial/attendance ones need the owner's explicit OK first.

### Status of every item

| Item | Status | Decided | Still OPEN |
|---|---|---|---|
| A Assignments fixes | OPEN | — | the problem list |
| D New design / UI polish | OPEN | — | what "the new design" is; before or after the new pages |
| 9.1 Admin home cards + charts | PROPOSAL | non-money cards for Admin + Supervisor; finance Admin-only | finance series + period; chart approach (hand-built SVG proposed) |
| 9.2 Teachers page | PROPOSAL | delete = deactivate; rate written through `teacher_rates` | add-form fields; may a Supervisor add teachers |
| 9.3 Students page | PROPOSAL; trial = OPEN | country field | trial rules M1–M5; minor without guardian in the form |
| 9.4 Notifications inbox | PROPOSAL | aggregation of existing queues | read state; badge; include complaints |
| 9.5 Teacher performance | PROPOSAL | punctuality from platform clicks only | threshold; metric definitions; combined score; teacher sees own |
| 9.6 Calendar views | PROPOSAL | viewer's timezone | library vs hand-built; create from calendar in v1 |
| 9.7 Guardians page | PROPOSAL | — | Supervisor sees paid/unpaid |
| 9.8 Deductions & bonuses | PROPOSAL (money) | Admin-only, append-only (existing) | B1–B8 |
| 9.9/9.12/C.1 Timezone by country | CONFIRMED (from country) | storage UTC; each viewer sees own zone (proposal) | country for all roles; multi-zone choice; who edits |
| 9.10 Join window 30 min | CONFIRMED (value) | link stays secret | all roles?; constant vs setting; Supervisor link access |
| 9.11 Daily WhatsApp schedule | CONFIRMED (content) | midnight local, no Zoom links, make-ups separate | group line; post-midnight changes; cut-off |
| 9.13 Roster changes after scheduling | **CONFIRMED** (owner 2026-10-26) | add/remove on GROUP (removal releases the reservation); PRIVATE = cancel; blocked once a report is SUBMITTED/APPROVED; subscription cancel/reduce lists affected reservations first | — |
| E Admin payment-link message | PROPOSAL (money; design E in phase-06) | platform invoice page link, never a Paymob link | P1–P6 |

### Slices with data impact and test strategy

| # | Slice | Data / schema impact | Financial/attendance table? | Test strategy (Jest, per-run test academy; Playwright only after the redesign) |
|---|---|---|---|---|
| S1 | Join window 30 min | none (constant) or one `academy_settings` key | no | window boundary tests T−31/T−30 (P9-JW-01..03); update the Phase 4 tests that assume 15 |
| S2 | Country + timezone foundation | `users.country` (+ optional `timezone_source`) — SQL A | no (users) | country→IANA mapping unit tests; edit rights per role (P9-TZ-01..04) |
| S3 | Timezone everywhere | none | no | render tests per viewer zone incl. a DST day (P9-TZ-05..08) |
| S4 | Design foundation | none | no | visual review; Playwright smoke after it lands |
| S5 | Admin home | none (reads ledgers) | reads only | Supervisor payload has no money (P9-HM-01..03) |
| S6 | Teachers page | none (uses `teacher_rates` API) | writes `teacher_rates` via the existing route | rate Admin-only; deactivate never deletes (P9-TC-01..04) |
| S7 | Students page (no trial) | none (uses S2 country) | no | role/tenancy tests (P9-ST-01..03) |
| S8 | Guardians page | none | reads only | Supervisor money rule (P9-GD-01..02) |
| S9 | Notifications inbox | `notification_reads` (only if read state is wanted) — SQL B | no | aggregation counts; per-user read state (P9-NT-01..03) |
| S10 | Calendar views | none | no | own-sessions-only; no Zoom URL in markup; timezone (P9-CA-01..03) |
| S11 | Teacher daily schedule | none (job kind is text) | no | idempotent planner, DST midnight, no URL (P9-DS-01..06) |
| S12 | Teacher performance | none (reads clicks/flags/evaluations) | reads only | threshold applied to platform clicks only (P9-PF-01..04) |
| S13 | Payment-link message | `payment_audit` event `LINK_SENT` — **SQL C** | **yes (payment_audit)** | PL-01..05 (Supervisor 403, finance wall, PAID 409, rate limit, no provider URL) |
| S14 | Deductions & bonuses | maybe a category on `payroll_ledger` — **SQL D (only if B1 asks for categories)** | **yes (payroll_ledger)** | P9-DB-01..05 + existing PAY-* |
| S15 | Trial accounts | unknown until M1–M5 are answered | **yes (students/subscriptions/settlement)** | written with the rules |
| S16 | Roster changes after scheduling (9.13) | **no schema change expected**: existing `session_students`, `session_reservations` (RELEASED), `reports` — the slice will show its queries for the owner's OK | **yes (attendance + credit tables, writes)** | P9-RC-01..05: add reserves credit; remove releases; blocked after a SUBMITTED/APPROVED report; PRIVATE has no per-student removal; subscription cancel/reduce lists reservations and refuses until removed |

### SQL sketches (NOT applied; shown for review)

**SQL A — S2, users table (not financial):**
```sql
ALTER TABLE "users" ADD COLUMN "country" VARCHAR(2);           -- ISO 3166-1 alpha-2, NULL until set
ALTER TABLE "users" ADD CONSTRAINT "users_country_format_check" CHECK ("country" IS NULL OR "country" ~ '^[A-Z]{2}$');
```
**SQL B — S9, only if per-user read state is chosen (not financial):**
```sql
CREATE TABLE "notification_reads" (
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "item_key" VARCHAR(200) NOT NULL,        -- e.g. "SESSION_REQUEST:<id>"
  "read_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "item_key")
);
```
**SQL C — S13, FINANCIAL (payment_audit), owner OK required:**
```sql
ALTER TABLE "payment_audit" DROP CONSTRAINT "payment_audit_event_type_check";
ALTER TABLE "payment_audit" ADD CONSTRAINT "payment_audit_event_type_check" CHECK (
  "event_type" IN ('CREATED', 'PAID', 'FAILED', 'CANCELLED', 'REJECTED', 'REFUNDED', 'LINK_SENT')
);
-- Additive: existing rows stay valid; the append-only trigger is untouched.
```
**SQL D — S14, FINANCIAL (payroll_ledger), ONLY if the owner wants categories (B1):**
```sql
ALTER TABLE "payroll_ledger" ADD COLUMN "adjustment_category" VARCHAR(20);
ALTER TABLE "payroll_ledger" ADD CONSTRAINT "payroll_ledger_adjustment_category_check" CHECK (
  "adjustment_category" IS NULL
  OR ("entry_type" = 'ADMIN_ADJUSTMENT' AND "adjustment_category" IN ('BONUS', 'FINE', 'OVERTIME', 'OTHER'))
);
-- Existing rows stay NULL (no history rewrite; append-only trigger untouched).
```
**S16 — no SQL:** the slice reuses the reservation lifecycle. Its read/write queries (lock session row, check report status, release reservation in one transaction) are shown to the owner before code.

### Questions (most blocking first)
Unchanged from the first draft: Q1 design, Q2 assignments, Q3 timezone, Q4 join window, Q5 daily schedule, Q6 payment link (P1–P6), Q7 performance metrics, Q8 home charts, Q9 teachers page, Q10 students page, Q11 guardians page, Q12 notifications, Q13 calendar, Q14 deductions (B1–B8), Q15 trials (M1–M5). New: **Q16** — S16 roster changes: when a student is ADDED to a group session that is already in the past (but not yet reported), allow it or refuse (proposal: refuse; scheduling past sessions is already refused)?

### Recommended first slice
Unchanged: **S1 (join window 30 min)** — confirmed, smallest, no schema; needs Q4. **S16** is the first money/attendance slice that is fully CONFIRMED and can follow once its queries are approved.

### Owner decisions (2026-10-27)
- **Q16 APPROVED:** a student is never added to a session that has already ended without a report. Already enforced NOW in the existing enrollment route (`POST /api/admin/enrollments` → 409 `SESSION_ALREADY_ENDED`, test MG-06), since a session stays SCHEDULED after its end until its reports arrive. S16 (9.13) reuses the same rule.
- **E2E accounts APPROVED:** dedicated E2E accounts in a per-run test academy, built AFTER Phase 9 (the redesign), so Playwright journeys never write into the seed academy.
