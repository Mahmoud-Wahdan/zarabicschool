# PROMPT — Phase 5 implementation (Session Reports & Attendance)

You are a senior full-stack engineer implementing **Phase 5** of the ZARABICSCHOOL (Madarak) project: a Next.js (App Router) + TypeScript + Prisma/PostgreSQL (Supabase) + next-intl (Arabic RTL first) platform for a real client. The owner (Mahmoud) is learning: he must be able to explain what you build. You are an implementation assistant, not the product owner. **The owner has now said: START IMPLEMENTATION for Phase 5.** Phase 6 (money) is NOT part of this task.

## 0. Read first (in this order) — do not skip
1. `docs/CONTEXT.md` (all of it; labels CONFIRMED / PROPOSAL / OPEN / ASSUMPTION matter). Key sections: §4, §6, §7, §8, §9, §13, §17.
2. `docs/INSTRUCTIONS.md` (all rules apply: security, tests, docs, anti-vibecoding, definition of done).
3. `docs/specs/PROGRESS.md`, `docs/specs/phase-05-attendance-recordings.md`, `docs/specs/database-schema.md` (§10, §11, §17–§20, §24), `docs/specs/phase-04-live-learning-zoom.md` (patterns to reuse).
4. Inspect the repo: `git status`, current branch, recent commits, existing `Report`, `ReportAttachment`, `SessionRequest`, `TeacherFlag`, `SessionStudent`, notification/worker code (`lib/worker/*`, `lib/messaging/*`), the report submit/review API routes and teacher/admin report UIs. Work on a dedicated branch `feature/phase-5` (create it from the current work if it does not exist; never commit to main).

If anything in the code contradicts CONTEXT.md, CONTEXT.md wins — report the contradiction, do not silently pick one.

## 1. Hard rules (never violate)
- **No Zoom API of any kind, no recordings, no embedded Zoom.** Zoom links are secrets: never log them.
- **No mock data.** Screens read the real (seeded) database through server-side data functions. If a seed row is missing, extend the seed, do not fake data.
- **Money is out of scope.** Submitting or approving a report in this phase writes NO `SubscriptionLedger`/`PayrollLedger` rows. Keep ONE clearly named seam (e.g. `lib/reports/settlement-seam.ts` exporting `settleApprovedReport(tx, report)`) that currently does nothing and is documented "Phase 6 fills this in the same transaction". Approval in this phase: authorize → `SUBMITTED→APPROVED` → write explicit `SessionStudents.attendanceStatus` (ATTENDED / STUDENT_ABSENT) → call the seam → notifications AFTER commit. `settled_at`/`archived_at` stay NULL until Phase 6. Do not invent fields for money.
- **Supervisor** may review/approve/reject reports and outage requests but must NEVER receive or edit money fields (no hourly rate, no amounts, no overtime approval). Enforce in the data layer and API, not only in the UI. Overtime is only a teacher *claim* (`extra_time_minutes`, frozen after submission); approving overtime is Admin-only and belongs to Phase 6.
- Authorization on the server for every route. Zod schemas for all inputs. Consistent errors `{ error: { code, message, fieldErrors? } }` with 400/401/403/404/409/413. Never leak existence of unauthorized resources (use 404 where the Phase 4 pattern does).
- **Migrations:** you may generate migrations but you must NOT apply them to the database. Stop and tell the owner to run `npx prisma migrate deploy` (DIRECT_URL). Raw-SQL invariants (CHECKs, partial unique indexes, `ON DELETE RESTRICT`) go inside the migration. If a migration is pending, code that depends on it must degrade safely (Phase 4 `link-audit` pattern) and its tests must show a visible "PENDING MIGRATION" notice instead of silently skipping.
- **No new npm dependencies without asking the owner first** (propose: package, why, size). If Supabase Storage needs `@supabase/supabase-js`, ask before adding it.
- Do not touch Phase 1–4 behavior except where a task below requires it; do not do broad refactors. Small diffs, small commits with descriptive messages. Never commit `.env` or any secret; env var NAMES only.
- Never claim "done/fixed/passes" without running it. Never fabricate test output.

## 2. Step 1 — Review of the early-built pieces (do this BEFORE new features)
These were built early in Phase 3 and never reviewed as Phase 5 work: the late-report reminder chain (T+0 notify, T+15 reminder, `LATE_REPORT` TeacherFlag at T+30, measured from scheduled end) and the attendance write in the report-approval route. Review them against CONTEXT §6/§7/§9 and report a findings table (ID, severity, file, problem, fix) BEFORE changing code. Check at least: timing from scheduled end; idempotent job claiming/`dedup_key`; recipients; no duplicate flags (`UNIQUE(session_id, flag_type)`); a report submitted late cancels pending reminder jobs and no flag is written after a report exists; attendance written only from an APPROVED report; double-approval is a no-op not an error; teacher cannot submit before scheduled end, for an unassigned session, for a cancelled/MISSED session, or twice per (session, student); archived/approved rows immutable; rejected → edit → resubmit works on the same row; the guardian WhatsApp on approval; failed WhatsApp never rolls back the DB state. Fix High/Medium findings in small commits, with a test per fix. Wait for the owner's "ok" only if a fix changes a CONFIRMED rule.

## 3. Step 2 — Remaining Phase 5 scope (build in this order, one batch at a time)

**Batch A — Report completeness**
1. **Attachments:** private Supabase Storage bucket, images + PDF only, max 10 MB each, no executables, validate MIME by content signature (not only extension), server-generated storage path (never the user's file name), `original_name` only for display, short-lived signed URLs, authorization identical to the report's visibility. Rejection codes 400/413. A report with attachments rolls back its DB rows if the upload fails (or vice versa: no orphan DB rows; document the order you chose and why). If Supabase credentials are not in `.env`, build against a storage interface (`StorageProvider`) with a real implementation and a test fake — ask the owner for the missing env NAMES.
2. **Class remark list:** default `excellent / good / acceptable / needs follow-up`, editable by Admin (not Supervisor? — treat as Admin AND Supervisor config only if CONTEXT allows; otherwise Admin-only and note it). Propose the smallest storage (a settings table or JSON setting) and ask before adding a table.
3. **Visibility (CONFIRMED, CONTEXT §9):** guardian, Admin, Supervisor see the whole report; the student sees ONLY homework, notes and attachments (an adult student without a guardian sees the whole report); evaluations are separate and Admin-only. Implement in the data layer so restricted fields never leave the server for the wrong role.
4. **Teacher UI:** per-student report form (group sessions: pick a student first), mobile-first, RTL, shown only after the scheduled end; loading/empty/error states; i18n ar/en; no raw enums on screen.

**Batch B — Approval queue (Admin + Supervisor)**
5. Queue UI + API: list SUBMITTED reports with filters (teacher, date, group/private), detail view with attachments, approve / reject (reason required). Rejection returns the same row to the teacher with the reason; teacher edits and resubmits. Show `operational_events` (late entry, early exit, disconnect…) as evidence only — never auto-decide attendance.
6. Concurrency: two admins approving the same report simultaneously → exactly one wins, the other gets a clean "already handled" response; covered by a test.

**Batch C — Outage / absence requests ("أبلغ عن عطل")**
7. Form on each session for Student, Guardian (for their child), and Teacher → `SessionRequest` (PENDING). Rate-limited, reason required, one open request per (session, requester).
8. Admin/Supervisor queue: approve/reject; on approval schedule a **replacement session linked via `replacement_for_session_id`** (reuse the existing scheduling service and its credit-reservation rules; the original session's reservations are released per the existing Phase 3 replacement logic — verify, do not duplicate). No money moves; Admin coordinates the reason humanly.
9. Teacher/student request notifications go to Admin/Supervisor per CONTEXT; failures never roll back.

**Batch D — Attendance views & notifications**
10. Teacher, Student, Guardian attendance views (per session status: PENDING / ATTENDED / STUDENT_ABSENT, report status incl. MISSING). A completed session may have a missing report; that does not change session status.
11. Notifications through `MessagingProvider` (OpenWA): report-needed (T+0), reminder (T+15), guardian notice on approval, rejection notice to the teacher. Templates in Arabic (+English where the user's language says so), timezone-aware, no secrets/links in logs, redacted `NotificationLog` rows, idempotency keys.
12. Admin visibility of `TeacherFlags` (red mark) in the queue/teacher view.

## 4. Tests (real Postgres dev DB; mock only the HTTP boundary of OpenWA/Supabase)
Create per-run `demo_test_*` data and delete it afterwards; follow existing fixtures. Required: before-end submit rejected; unassigned teacher 403/404; duplicate submit → "already submitted"; concurrent submit/approve; edit after approval blocked; rejection → resubmit; approval writes attendance exactly once; ABSENT outcome writes STUDENT_ABSENT and nothing else; visibility matrix per role (student sees only homework/notes/attachments; guardian full; other guardian/student 404); Supervisor receives no money fields; attachment rejects (type, size, spoofed MIME); outage request authorization + replacement linkage; notification failure doesn't roll back; reminder cancellation when a report arrives; no secret/link in console output or `NotificationLog`. Then run from `webapp/`: `npx prisma validate`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` — all must be green, baseline is 12 suites / 149 tests (do not reduce it).

## 5. Working protocol
- Use a task list. After each batch: stop, summarize (what changed, why, files, tests run with real results, remaining risks), update `docs/specs/phase-05-attendance-recordings.md` (checklist + execution log) and `docs/specs/PROGRESS.md`, then wait for the owner before the next batch. If a business rule is missing or OPEN, ASK as a multiple-choice question with a recommendation; never invent it.
- End each batch with ONE short learning checkpoint question for the owner (e.g. "why must notifications wait for commit?").
- Final report must list: owner steps (migrations to apply, env names to add, manual tests to run), anything deferred, and anything you were unsure about.
