# Prompt — Review the uncommitted Phase 3 work, then continue Phase 3

You are working in the Zarabicschool repo (`webapp/` is the Next.js app, `docs/` is documentation).
Roles: you are the implementation partner; the owner (Mahmoud) decides product questions and must be able to explain what you build. Reply to him in Egyptian Arabic, code/identifiers in English. Be direct, no long theory.

## 0. Read first (in this order, fully)
1. `docs/specs/PROGRESS.md`
2. `docs/CONTEXT.md` (7th revision, reconciled 2026-10-07) — Sections 4, 6, 7, 10, 13, 20
3. `docs/INSTRUCTIONS.md`
4. `docs/specs/phase-03-schedules-sessions.md`, `docs/specs/database-schema.md`

If anything in code contradicts CONTEXT.md, CONTEXT.md wins; report the contradiction, don't silently pick.

## 0b. Owner decisions already made (2026-10-07) — do NOT re-ask
- Phase 3 goes ahead now; no separate full-schema "Phase 0" first. Add only the tables Phase 3 needs (notification/jobs table for the DB-polling worker) and record in PROGRESS that the rest of Phase 0 is still pending.
- Guardian receives the Zoom join link (WhatsApp at start + the guardian sessions page). Reminder and start-time messages go to teacher, student AND guardian. Host link: Admin, Supervisor and the session's teacher only.
- Teacher "request a change" button is part of Phase 3 (minimal: reason + proposed change → Admin/Supervisor queue; teacher never mutates the session).
- Timezone: detect automatically. Do NOT use IP geolocation (VPNs and travel make it wrong). Use the browser's `Intl.DateTimeFormat().resolvedOptions().timeZone` as the default when a user/application is created and for display; the user's stored `User.timezone` wins; the user can change it. Weekly recurrence is anchored to `Session.timezone` (default = the student's timezone, Admin can change it): generate each week as the same LOCAL wall-clock time converted to UTC, so DST does not shift it.
- OpenWA credential delivery (CONTEXT §5) is NOT implemented yet. Build `OpenWAProvider` behind `MessagingProvider` FIRST (selected by configuration), then use it for session messages.
- Renewals are provider-managed (not charged by OUR worker). Series extension is triggered by a provider-confirmed paid invoice/webhook and its resulting credit grant; the polling worker grants the monthly allotment for annual plans. Annual plans = the same monthly allotment, paid yearly, with no rollover. Existing subscribers keep the price agreed at subscription creation; Admin price changes apply to new subscriptions. Phase 3 does not implement payments or evaluations; just don't block them.
- Student evaluation (mandatory, filled by the student, never blocks sessions or pay) is Phase 7 — out of scope here.
- Warn Admin when two overlapping sessions share the same Zoom join link, because the academy's Zoom host/account may not support concurrent meetings.
- Recurring = a SERIES, not a one-shot batch (owner decision 2026-10-07): generate sessions only up to the available credit (first 8 for a monthly plan); the remaining weeks stay pending; when credit arrives (paid renewal) the worker CONTINUES the series automatically. Needs a new `RecurrenceSeries` table (rule, timezone, start date, total weeks, generated-through week, status ACTIVE/PAUSED/COMPLETED/CANCELLED) — `Session.recurrenceGroupId` points to it; unique (series, week_index) so concurrent/duplicate extension never creates a week twice. Each session may only reserve credit from a subscription whose period covers the session date (monthly credits expire). Group series: generate a week only if EVERY student has credit, else pause the series and flag Admin (PROPOSAL — mention it to me). Failed renewal ⇒ nothing new generated, existing sessions untouched. The existing recurrence API that rolls back the whole batch must be changed accordingly.

## 1. Secure the existing work BEFORE changing anything
A previous agent session (Copilot) produced a lot of uncommitted work that was never pushed: session APIs, `SessionReservation`, admin/teacher/student/guardian session pages, Phase 2 CRUD and Supervisor/SuperAdmin changes, dashboard data, and a new migration `phase3_session_reservations`.
1. `git status`, `git branch --show-current`, `git log --oneline -5`. Do not reset, stash-drop, or discard anything.
2. Split the working tree into small logical commits on the current feature branch (docs / schema+migration / session APIs / UI / other). Never commit `.env` or secrets. Show me the commit list.
3. Baseline from `webapp/`: `npx prisma validate`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. Record real results (do not copy the previous agent's claims — it reported build/typecheck/lint passing, and that the migration was NOT applied because Supabase was unreachable).

## 2. Review the existing Phase 3 work (read-only first, report, then fix)
Produce a review table: item / finding / severity / fix. Check at least:

**Credit reservation (highest risk)**
- Available credit = ledger sum − active reservations, computed per student across valid subscriptions. Is expiry respected (monthly credits expire, pay-per-session never)? Consumption order proposal: earliest-expiring first, pay-per-session last.
- Concurrency: two requests booking the last credit at the same time. Is the transaction `Serializable` with retry on conflict (`P2034`), or protected by row locks? Is there a DB-level guarantee (raw SQL partial unique index: one ACTIVE reservation per (session, student))?
- Group session: all-or-nothing across students. Series generation: each step atomic; a partial series is valid; extension is idempotent and race-safe.
- Cancel/release: idempotent (cancelling twice releases once). Replacement session: does it reserve a NEW credit, and is the original's reservation handled correctly?
- Lifecycle must stay compatible with CONTEXT §7 "Reservation lifecycle": reservation consumed by the `SESSION_DEDUCTION` at report approval (Phase 5/6) — do NOT implement settlement now, just make sure nothing blocks it.

**Schema findings from the owner's pasted `schema.prisma` (verify and fix)**
- `SessionReservation.status` has only RESERVED/RELEASED. Add `CONSUMED` (set inside the Phase 5/6 settlement transaction), otherwise available credit = ledger − reservations double-counts a settled session.
- `SubscriptionLedger` has no `sessionId` (nor `reportId`): the rule "one `SESSION_DEDUCTION` per (session, subscription)" cannot be enforced by a unique index. Add nullable `sessionId`/`reportId` + a partial unique index in raw SQL.
- `SubscriptionLedgerEntryType` lacks `EXPIRY` (monthly no-rollover). Add it with the migration or log it as a Phase 0 gap.
- `SessionReservation @@unique([sessionId, studentId])` also blocks re-reserving after a release: re-reserve must flip the existing row back, not insert. Add a partial unique/CHECK on status consistency (`released_at` set iff RELEASED).
- `Report` and `SessionReservation` now exist; `PayrollLedger`, `TeacherRate`, `BillingPlan`, `ExchangeRate`, `WebhookEvent` and the notification/jobs table do not. Only the jobs table is in scope now.
- Session has no `createdBy`/`cancelledBy`; add them for audit (Supervisor actions especially).
- Still no CHECK constraints / append-only trigger anywhere (e.g. `scheduled_end > scheduled_start`, ledger UPDATE/DELETE blocked).

**Authorization / data exposure**
- Every query scoped by `academyId`; every `[id]` route checks ownership (IDOR): teacher only her sessions, student only enrolled, guardian only her children's.
- Admin + Supervisor can create/edit/cancel/replace; Teacher cannot mutate (request-only); Supervisor sees no money fields and no Applications.
- Zoom links: `GET` responses must not leak join/host links to unrelated users. Join link → teacher, enrolled students, Admin/Supervisor (guardian: confirm with owner, default NO link in API unless decided). Host link → Admin, Supervisor, the session's teacher only. Links never in logs, errors, or analytics.
- Status transitions are an explicit allowlist (e.g. no editing COMPLETED/MISSED; no un-cancel).

**Schema / migration**
- Read the migration SQL. Add raw-SQL invariants inside the migration: `CHECK (scheduled_end > scheduled_start)`, CHECK on duration limits if modelled, partial unique index for active reservations, `ON DELETE RESTRICT`. Check the zoom URL is validated as `https` at the API.
- Confirm the migration applies cleanly on the DEV database only. Ask me before running `migrate deploy`/`reset`. If Supabase is unreachable (P1001) say so and stop that step; do not fake it.

**Recurrence / timezone**
- Weekly recurrence across DST: adding `7*24h` to a UTC instant shifts the local time. Decide which timezone the recurrence is anchored to (teacher's? student's? academy's?) — this is an OPEN product question: ask me with 2–3 options, do not invent.
- Display uses the viewer's IANA timezone; stored as UTC.

**Seed / no mock data**
- Demo seed must include sessions, participants and reservations consistent with the ledger. No hard-coded fake data in UI.

## 3. Tests (write them against real Postgres, not mocks)
Add DB-backed tests for: concurrent booking of the last credit; group session rollback when one student has no credit; series generation capped at available credit; series resumes after a renewal credit is granted; no duplicate week on concurrent extension; group series pauses when one student lacks credit; cancel releases once (double cancel); replacement reservation; cross-academy and cross-role access (teacher/student/guardian/supervisor); teacher cannot mutate; zoom link not exposed to unauthorized roles; status transition rejections. Use unique `demo_test_*` records and clean them up. Fix the Jest open-handle issue if you touch it.

## 4. Then continue the remaining Phase 3 scope, in this order
Write/refresh the plan in `phase-03-schedules-sessions.md` FIRST, show it, then implement in small slices:
1. Apply the migration to the dev DB (after my confirmation) and verify.
2. Zoom button via an authorized redirect route that writes `SessionJoinClick` (user, session, time). Soft evidence only. Never log the URL. Teacher page currently has NO Zoom button — add it here.
3. Admin recurring-series UI (the batch API exists but must become series-based): shows generated vs pending weeks and PAUSED status, reschedule UI, filters (date range, teacher, student, status).
4. Timezone-aware display from the viewer's profile timezone.
5. Notifications and series extension — scheduler + OpenWA (the same DB-polling worker also extends active series when credit exists):
   - DB-polling worker (CONTEXT §10: no Redis/BullMQ). Propose a minimal jobs/notification table; unique key per (session, recipient, kind) for idempotency.
   - Messages: ~2h before → teacher + student + guardian reminder; at scheduled start → Zoom join link message (same recipients). Cancelled/rescheduled sessions must cancel pending jobs.
   - Everything goes through `MessagingProvider`. Build `OpenWAProvider` first (decided, 0b); keep the fake provider for tests only.
   - A failed send is recorded as a redacted failure row, never rolls back the session, never logs the link or phone numbers beyond what the existing pattern allows. OpenWA can be banned — not the only channel for critical flows.
6. Teacher "request a change" — decided: minimal version in Phase 3 (see 0b). The full outage/absence form stays Phase 5.

## 5. Hard rules
- No Zoom API/WebSocket/embedded Zoom/recordings. No attendance inferred from clicks.
- Do not implement report settlement, payroll, or gateway logic in this task. Phase 5/6/6b and Phase 0 (full schema + seed) are separate; if you need a Phase 0 table (jobs, reports), say so instead of quietly adding half of it.
- No new dependencies without asking. No `.env` values in docs, commits, or chat.
- No claim of "done/fixed/passing" without the real command output. Never fabricate results.
- Ask me before: running migrations/seeds/resets, any NEW open product question, anything touching money.

## 6. Finish
Update `phase-03-schedules-sessions.md` (checklist + log) and `PROGRESS.md` (status line + a dated entry listing what was verified vs. what is still open). Final message to me, in Egyptian Arabic: what changed (files), what you verified (with commands), what remains, risks, and 2–3 questions I should be able to answer to prove I understand it (e.g. "ليه الحجز والخصم حاجتين مختلفتين؟", "إيه اللي بيمنع حجز آخر credit مرتين؟").
