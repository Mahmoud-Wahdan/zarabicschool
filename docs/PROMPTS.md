# Prompts for Gemini (Antigravity) — revision 5 (2026-10-06)

Run **Prompt A first, then Prompt B**. Put the updated `CONTEXT.md` and `INSTRUCTIONS.md` in `docs/` BEFORE running them. **Documentation only — no code, no migrations, no dependency changes.**

What changed vs revision 4: **Admin or Supervisor approval is the settlement gate**. Submission only enters the queue. Reports are per student (including group sessions), approved attendance updates `SessionStudents`, and an approved attended report creates the student deduction plus the one-per-session teacher credit in one transaction. Zoom opening/click evidence is optional audit data only; it never determines attendance or pay.

---

## PROMPT A — Fix docs/specs/database-schema.md

```
ROLE: You are a documentation/architecture assistant for the Zarabicschool project.
TASK: Rewrite the affected parts of docs/specs/database-schema.md so it matches the latest business logic. DOCS ONLY — no code, no Prisma files, no migrations.

BEFORE EDITING, read in this order: docs/CONTEXT.md (5th revision, 2026-09-29 — source of truth, especially Sections 4, 6, 7, 17), docs/INSTRUCTIONS.md, docs/specs/PROGRESS.md, docs/specs/business-model.md, docs/specs/database-schema.md.

RULES
- Edit in place; do not regenerate the whole file. Keep the existing table format.
- Never invent business rules. For every DECISION REQUIRED: write 2–3 options with trade-offs and a recommendation, mark it OPEN, and do NOT pick one.
- Every new/changed constraint must say WHY it exists (which failure it prevents).
- State where Prisma cannot express something (partial indexes, CHECK constraints, triggers) — raw SQL inside a migration.
- Label your work S1, S2 ... and refer to those labels in the summary.

CONFIRMED FACTS (from CONTEXT.md)
- NO Zoom API, no Zoom events/WebSocket, no meeting registration, no recordings, no embedded interface. Admin creates the meeting in Zoom and pastes the link into the session.
- The platform cannot verify attendance: the teacher's report is evidence for an explicit attendance write, and Admin or Supervisor approval is required before pay settlement.
- Student side = prepaid packages counted in SESSIONS (e.g. 8), any subject/teacher, never expire. Teacher side = hourly pay = scheduled duration × her hourly rate, independent of the student's price.
- Settlement happens only after Admin or Supervisor approves a submitted report: one idempotent transaction writes one SESSION_DEDUCTION (−1) for that student's subscription + ONE SESSION_CREDIT per session (created by the first approved attended report) + the report's settled/archived marks.
- Overtime: the teacher states it in the report; Admin decides; approved extra time is an ADMIN_ADJUSTMENT.
- SMS is post-MVP and may never be built.

PROBLEMS TO FIX

Remove (obsolete because of "no Zoom API")
S1. Delete the ZoomEvents table and everything about event_key / processed_at / processing_attempts / event naming / reconciliation.
S2. Delete AttendanceSegments (if present) and the Attendance table. Replace with an explicit attendance_status on SessionStudents (`PENDING`, `ATTENDED`, `STUDENT_ABSENT`) that is set by an approved report outcome or by Admin override with overridden_by + override_reason. Evaluation existence must never dynamically infer attendance. DECISION REQUIRED: confirm removing Attendance vs keeping it as a derived history table — recommend removal.
S3. Delete Recordings entirely (not deferred — out of scope). Delete zoom_meeting_id, zoom_meeting_uuid, zoom_registrant_id, registrant/join-URL-per-participant columns.
S4. PayrollLedger.source: replace LIVE_WEBSOCKET/RECONCILIATION with REPORT / ADMIN.

Sessions and Zoom links
S5. Sessions: keep a required-before-start zoom_join_url (pasted by Admin) and an optional zoom_host_url (only if the teacher needs a host link — OPEN). Note both are secrets: never logged, readable only by the session's teacher, its students (guardians: OPEN) and Admin. Recurring series: recurrence_group_id links generated sessions; PROPOSAL: the same link is copied to every generated session and is editable per session.
S6. Sessions: UNIQUE constraints only where still meaningful; CHECK scheduled_end > scheduled_start; CHECK duration_minutes matches the interval; status values SCHEDULED / COMPLETED / MISSED / CANCELLED with the transitions written down. Keep replacement_for_session_id and cancellation_reason.
S7. OPTIONAL small table SessionJoinClicks (session_id, user_id, clicked_at) written by the redirect behind the Zoom button — soft evidence for Admin, not proof. Mark PROPOSAL/OPTIONAL.

Reports (the payment trigger)
S8. Reports for type SESSION_COMPLETION_REPORT: one unified row per (session_id, student_id) — UNIQUE, with explicit teacher_id. Lifecycle is SUBMITTED → REJECTED → SUBMITTED or APPROVED → ARCHIVED. Columns: attendance_outcome (ATTENDED / STUDENT_ABSENT), class_remark (required String, dropdown values OPEN), summary, homework, notes, extra-time fields, submitted_at, approved_at, archived_at, rejection metadata, and settled_at. Rejected reports may be edited/resubmitted; archived reports are immutable. No revision/version table.
S9. ReportAttachments (report_id, file_path, mime_type, size_bytes, original_name): private Supabase Storage bucket, signed URLs, DB stores path only. Allowed types and size cap = DECISION REQUIRED (recommend allowlist images + PDF, size cap, no executables).
S10. Visibility is CONFIRMED: the teacher's report is visible to the guardian and Admin (not to the student — whether the student sees the homework part is OPEN); the student's evaluation of the teacher is visible to Admin only. Document it as a permission matrix. Reports are per student in group sessions too (CONFIRMED).
S11. TeacherFlags (PROPOSAL for the red mark): id, academy_id, teacher_id, session_id, flag_type ('LATE_REPORT'), created_at, UNIQUE(session_id, flag_type). Informational, visible to Admin. Timing rule OPEN (T+0 notify, T+15 reminder, T+30 mark is a PROPOSAL, measured from the scheduled end).
S12. SessionRequests (outage/absence request form — IN the MVP): id, academy_id, session_id, requested_by, reason, status PENDING/APPROVED/REJECTED, reviewed_by, reviewed_at, replacement_session_id (nullable), created_at. Explain that the reason is handled between Admin and the teacher humanly; the system only stores and routes the request.
S13. Evaluations: UNIQUE(session_id, evaluator_id); state they are OPTIONAL.

Money safety
S14. Subscriptions: package = sessions_purchased + package price (total_amount_minor + currency); REMOVE per_session_price_minor; no expiry date. SubscriptionLedger counts SESSIONS: sessions_delta is the balance (+N on INITIAL_PURCHASE, −1 on SESSION_DEDUCTION). DECISION REQUIRED: what to do with amount_minor (remove / informational). Recommend money only on Invoices.
S15. SubscriptionLedger: partial unique index (session_id, subscription_id) WHERE entry_type='SESSION_DEDUCTION'; add report_id (FK Reports) on deduction rows.
S16. PayrollLedger: ONE SESSION_CREDIT per session — partial unique index on (session_id) WHERE entry_type='SESSION_CREDIT'; student_id not needed on those rows. Add report_id (the report that triggered it), minutes_credited (= scheduled duration snapshot) and hourly_rate_minor snapshot + currency, so a later rate change never rewrites history. entry types: SESSION_CREDIT, ADMIN_ADJUSTMENT (fines, bonus, approved overtime), DISBURSEMENT.
S17. Append-only enforcement: trigger raising on UPDATE and DELETE for both ledgers; ON DELETE RESTRICT on every ledger foreign key.
S18. CHECK constraints: SESSION_CREDIT amount > 0; SESSION_DEDUCTION sessions_delta = −1; DISBURSEMENT amount < 0; currency length = 3.
S19. Settlement marker: the settled mark now lives on the REPORT (Reports.settled_at), set in the same transaction as the ledger rows. Document: never cleared to retry; corrections are ADMIN_ADJUSTMENT/REFUND rows; the unique report per (session, student) is the "claim" that stops a double submit; a periodic consistency query finds "report settled but no ledger rows" and "ledger rows but no settled report". Remove Sessions.financially_settled_at unless a reason is written.
S20. Teacher hourly rate is missing. DECISION REQUIRED: effective-dated TeacherRates table (teacher_id, hourly_rate_minor, currency, effective_from, created_by) vs a single field on Teachers. RECOMMEND the table (owner asked for a recommendation; the credit already stores the rate it used). Assumption: one rate per teacher (private = group); one currency per teacher — OPEN.
S21. Balance-query indexes: PayrollLedger (teacher_id, currency, created_at), SubscriptionLedger (subscription_id, created_at). Decide INTEGER vs BIGINT for amounts and state why. Rounding of hourly amounts to minor units = OPEN.
S22. DECISION REQUIRED: zero sessions left. CONFIRMED principle: prepaid, scheduling beyond remaining sessions is blocked (audited Admin override), scheduled-unsettled sessions count against the balance. Document the mechanism options; hard requirement: the teacher's SESSION_CREDIT must never fail because of the student's package (if the balance would go negative, settle and flag Admin).

Users, applications, other
S23. Enrollments (student_id, teacher_id, subject_id, status PENDING/CONFIRMED/REJECTED/ENDED, confirmed_by, confirmed_at, UNIQUE(student_id, teacher_id, subject_id)). Subscriptions are NOT tied to an enrollment.
S24. Applications: three types (GUARDIAN / STUDENT / TEACHER) — application_type + type-specific details. DECISION REQUIRED: one table with a Zod-validated JSONB details column vs separate nullable columns vs one table per type (recommend one table + JSONB since the fields are not final). Statuses NEW → REVIEWED (validated) → APPROVED / REJECTED. Link to the records created on approval. A student application carries guardian name/phone/relationship so Admin can link or create the guardian first. Teacher application may carry an expected hourly rate + currency (informational only; the agreed rate goes to TeacherRates). The form fields per type are OPEN.
S25. Users: timezone (IANA) lives here; password_changed_at; DECISION REQUIRED: login identifier — the agreed flow says "username and password" → recommend a unique username, email optional. must_change_password stays.
S26. NotificationLog: content is NOT NULL but passwords must never be stored — define what is stored for CREDENTIALS (template key + redacted content). Add session_id (nullable) and a unique idempotency key (notification_type + session_id + recipient_id + sequence) so retries never send the same message twice. Keep the SMS enum value with the note "post-MVP, may never be built".
S27. Housekeeping: fix the table of contents anchors and add new tables; add a "Prisma notes" section (everything needing raw SQL) and a "Delete policy" section (no hard deletes on anything referenced by a ledger); finish with an "Open decisions" list.
S28. SaaS hygiene (CONTEXT §19, documentation only): confirm academy_id is on every tenant-owned table; list which uniqueness should be per academy later (e.g. username, subject names) — DECISION REQUIRED on UNIQUE(academy_id, username) vs global; note that NO RLS or tenant switching is built now.

WHEN DONE
- Output a short change summary per label (what changed, why) and the list of DECISION REQUIRED items as questions for the owner.
- Append a dated entry to docs/specs/PROGRESS.md; update docs/specs/business-model.md ONLY where it is inconsistent with CONTEXT.md (it still describes Zoom events, overlap-based billable time, per-session teacher price, recordings).
- Do not touch the phase-0X files in this task.
```

## PROMPT C — Final consistency sweep for all remaining docs

```
ROLE: You are a documentation consistency assistant for Zarabicschool.
TASK: Audit and update every affected file under `docs/` in place. Documentation only:
do not modify application code, Prisma schema, migrations, package manifests, or seed data.

SOURCE OF TRUTH
- Read `docs/CONTEXT.md` first, then `docs/INSTRUCTIONS.md`, `docs/specs/PROGRESS.md`,
  `docs/specs/business-model.md`, and `docs/specs/database-schema.md`.
- Treat the owner's confirmed decisions from 2026-10-06 as CONFIRMED:
  1. Only the teacher assigned to a session submits its report.
  2. A report is idempotent: one row per (session, student).
  3. Submission enters an approval queue; it does not create money.
  4. Admin OR Supervisor reviews and approves/rejects the report.
  5. Only approval settles an attended report. The settlement transaction writes the
     explicit per-student attendance, one student SESSION_DEDUCTION, the first
     session-level SESSION_CREDIT for the teacher, and report settled/archive markers.
  6. An approved MISSED/STUDENT_ABSENT outcome creates no teacher earning and no
     student deduction. A group session can complete while one student is absent.
  7. Teacher reports record facts such as late entry, early exit, outages, and
     reconnection for review; these facts are not automatic attendance decisions.
  8. Zoom links are externally opened. Optional click/join logs are soft audit evidence,
     never a source of attendance, payroll, or quota truth.
  9. Archived reports and both ledgers are immutable; corrections use the documented
     adjustment/reversal path.

AUDIT AND EDIT RULES
- Search all docs for obsolete claims that submission raises salary, Zoom events prove
  attendance, recordings exist, reconciliation/overlap billing exists, or a Supervisor
  can view/edit money. Replace them with the confirmed model and explain removals in
  the relevant execution log.
- Preserve each file's structure, labels, OPEN decisions, and historical execution
  entries. Do not silently turn an OPEN/PROPOSAL into a decision.
- In phase specs, keep removed work as `REMOVED — <reason>`, and ensure acceptance
  criteria, routes, authorization tables, transactions, tests, and tasks agree.
- State why every uniqueness constraint, append-only rule, transaction boundary, and
  authorization check exists. Use raw SQL migration notes where Prisma cannot express it.
- Keep report visibility precise: Admin/Supervisor and the linked guardian see the
  teacher report; the student sees only the confirmed fields; student evaluations are
  Admin-only.

OUTPUT
- Append a dated change entry to `docs/specs/PROGRESS.md`.
- End with a concise file-by-file summary, remaining OPEN decisions, and a list of
  obsolete statements removed or corrected.
- If two confirmed statements conflict, stop and report the conflict instead of
  inventing a resolution.
```

---

## PROMPT B — Upgrade every docs/specs/phase-0X-*.md

```
ROLE: You are a documentation/architecture assistant for the Zarabicschool project.
TASK: Upgrade each docs/specs/phase-0X-*.md so an engineer can implement the phase full-stack from that single file. Keep ONE file per phase — no new spec files, no renamed files. DOCS ONLY: do not write code, do not touch package.json, Prisma, or the app.

BEFORE EDITING, read: docs/CONTEXT.md (5th revision — source of truth), docs/INSTRUCTIONS.md (§4 workflow, §5 testing, §6 security, §7 financial, §17 definition of done), docs/specs/PROGRESS.md, docs/specs/business-model.md, docs/specs/database-schema.md (already corrected by Prompt A).

RULES
- Extend each file in place. KEEP Goal, Proposed approach, Tasks and Execution log. Add and adjust; never regenerate or delete.
- Where existing phase text contradicts CONTEXT.md (Zoom API/OAuth/WebSocket/events, embedded Zoom, recordings, attendance from Zoom, overlap-based billable time, per-session teacher price, "report does not gate payroll", reconciliation job), FIX it and list every fix in your final summary. Remove obsolete tasks (mark them "REMOVED — reason") instead of silently deleting.
- MVP FIRST: anything disproportionately large goes into the phase's "Deferred / Post-MVP" section, not the task checklist. Tag tasks [MVP] or [DEFERRED].
- Never invent business rules. Undecided items go into "Open decisions" (CONTEXT §7, §17). If an open decision blocks a task write "BLOCKED until owner decides".
- Do not move tasks between phases without listing it as an OPEN decision.
- Do not duplicate the schema: reference docs/specs/database-schema.md and list only what the phase touches.
- Secrets: env var NAMES only.
- Be concrete: real route names, Zod field names, named test cases.
- Add to each phase a line "Delivery stage:" (CONTEXT §14: Stage 1 = phases 1–3, Stage 2 = 4–5, Stage 3 = 6–7, phase 8 spans all).

ADD THESE SECTIONS TO EVERY PHASE FILE (after "Proposed approach", before "Tasks"):
1. Acceptance criteria — observable, testable.
2. Frontend — routes/pages, components, states (loading/empty/error), forms + client validation, RTL/i18n notes, per-role visibility; mobile-first.
3. Backend — endpoints or server actions (method, path, purpose), Zod schemas, service responsibilities, one consistent error shape + status codes, background jobs.
4. Database — tables/columns/constraints/indexes touched, migration notes (raw SQL steps), seed data.
5. Auth & Authorization — table Role × Action → allowed?, plus ownership rules; enforced server-side.
6. Security — INSTRUCTIONS §6 checklist for this phase: who can call it, validation, replay/idempotency, transaction need, what is logged (no passwords, no student-identifying data, no Zoom links), rate limits, minors' data, file uploads, secrets.
7. Transactions & failure handling — REQUIRED for phases 5 and 6 and any multi-write operation.
8. Tests — unit / integration (real Postgres test DB) / E2E (Playwright), NAMED cases including failures and security boundaries.
9. Learning checkpoint — 1–2 short questions for the owner.
10. Open decisions and Deferred / Post-MVP — two separate lists.
11. Definition of Done — from INSTRUCTIONS §17.

PHASE-SPECIFIC INSTRUCTIONS

Phase 1: Server-side enforcement of must_change_password AND is_active on every request; how a deactivated user's session ends. Test database + CI (lint, typecheck, test, build). Login rate limiting keyed by email/username AND IP. OPEN decisions to present as options: (a) migrate the FULL schema now vs only the tables each phase needs — RECOMMEND per phase, because the business rules changed several times and unused tables would have to be redone; (b) where the public application intake lives (Phase 1 vs Phase 2 as written); (c) the scheduler for timed notifications (BullMQ + Redis vs a simple database-polling worker); (d) the login identifier. Remove every ZOOM_* item from the environment list.

Phase 2: The three application forms (guardian / student / teacher) with their fields BLOCKED until the owner lists them; adult/minor student branching and the guardian link; protect the public form (rate limit, honeypot/captcha option, validation, no logging of minors' data). Admin flow REVIEWED → APPROVED → account creation for each accepted applicant (User + profile) with a temporary password shown once to Admin (PROPOSAL fallback) and delivery through MessagingProvider; NotificationLog never contains a password. Enrollments (proposal → Admin confirms). Teacher hourly-rate entry by Admin (BLOCKED until TeacherRates vs field is decided). SMS [DEFERRED — may never be built].

Phase 3: IANA timezone on Users; store UTC; display per viewer. Session creation by Admin with the pasted Zoom link; recurring generation with recurrence_group_id copying the link (editable). Replacement sessions. Prepaid rule: block scheduling/generation beyond the student's remaining sessions (audited override) — mechanism details OPEN. Session status transitions. "Edit whole series" tools [DEFERRED] if large.

Phase 4 (now small): Admin edits the Zoom link per session/series; teacher and student session lists with the Zoom button; the button goes through a small redirect route that logs the click (PROPOSAL/OPTIONAL) and opens Zoom; links never logged, shown only to authorized users; mobile-friendly. Mark as REMOVED: Zoom technical spike, Server-to-Server OAuth, REST meeting creation, registrants, WebSocket consumer, ZoomEvents, event keys, embedded Meeting SDK, Redis/BullMQ bootstrap for Zoom, reconciliation. Note the future Zoom API verification layer under Deferred (CONTEXT §18). Because Phase 4 became small, propose (as an OPEN decision only) merging it into Phase 3 or 5.

Phase 5 (title "Session reports & attendance"; keep the file name): the teacher dashboard (total/done/remaining sessions and hours, attended percentage, approved salary per currency; pending approval may be shown separately); Today's-classes list with statuses; the report icon appears once the scheduled end has passed (PROPOSAL; Admin can unlock); the unified "End class" form: class remark, summary, homework, notes, attachments, attendance outcome, operational facts, optional extra-time claim; one report per student, also in group sessions (CONFIRMED); attachment security (private bucket, signed URLs, allowlist, size cap); who sees which field (OPEN). Attendance history views read the explicit `SessionStudents.attendance_status`. Report lifecycle is `SUBMITTED → REJECTED → SUBMITTED` or `APPROVED → ARCHIVED`; Admin or Supervisor reviews every report, and archived reports are immutable. The outage/absence request form and the Admin queue are [MVP]. Removed: the 25% absence timer, late-join detection, join/leave alerts, participant mapping, attendance segments. Settlement is Phase 6-owned and begins only after approval; it must be atomic and idempotent.

Phase 6: Settlement after Admin or Supervisor report approval: document the exact transaction (one deduction for that student, one teacher credit per session created by the first approved attended report and skipped by later ones, settled and archived marks); the unique constraints as the double-payment guard; frozen archived fields; unique-violation = "already settled"; partial failure rolls everything back and leaves the report unarchived; notifications only after commit; overtime approval by Admin creating one ADMIN_ADJUSTMENT (claim it with a conditional status update so approving twice cannot pay twice); Admin adjustments (fines/bonus) and disbursements; multi-currency without conversion; prepaid rules and the "never block the teacher's pay" requirement; the consistency-checker query. BLOCKED parts: teacher rate storage, rounding, zero-sessions mechanism. REMOVED: reconciliation job, event processing, overlap-based billable time. Low-balance alert [DEFERRED] candidate ("sessions remaining", e.g. 2 of 8). Tests MUST include: double settlement of the same approved report; two concurrent settlement requests; a teacher who is not assigned; a report before the scheduled end; editing an archived report is rejected; rollback when the second ledger insert fails; group session with two students reporting (teacher credited once, two deductions); student absent (no money, explicit attendance is STUDENT_ABSENT); empty student package (teacher still credited, Admin flagged); overtime approved twice (paid once); currency handling.

Phase 7: Admin dashboard, review queues (reports, outage requests, overtime), TeacherFlags view, evaluations (OPTIONAL for students), announcements. Tag the evaluation prompt and announcements as [DEFERRED] candidates if the owner wants a smaller MVP. Report visibility matrix as confirmed (teacher report: guardian + Admin; student evaluation: Admin only). Student "dispute this attendance" button = [DEFERRED].

Phase 8: Security audit checklist (authorization on every route, file upload review, no Zoom links or passwords in logs), secrets-rotation verification, database backup/restore check, deployment runbook (hosting decided at deployment time), staged-delivery checklist: what must pass before each stage is handed to the client.

WHEN DONE
- Print, per phase file: sections added, tasks changed/removed/moved, contradictions fixed, and every OPEN decision found.
- Update docs/specs/PROGRESS.md: add the OPEN decisions to Action Items and a dated note.
- Add a short "Post-delivery SaaS roadmap" section (copied from CONTEXT §19) to PROGRESS.md and business-model.md; create NO tasks for it in any phase.
- Do NOT modify CONTEXT.md, INSTRUCTIONS.md or database-schema.md in this task; list any inconsistency for the owner instead of fixing it silently.
```
