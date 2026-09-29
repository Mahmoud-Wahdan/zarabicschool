# Prompts for Gemini (Antigravity) — revision 3 (2026-09-29)

Run **Prompt A first, then Prompt B**. Put the updated `CONTEXT.md` and `INSTRUCTIONS.md` in the project BEFORE running them.

What changed vs revision 2: the **student side is session packages** (counted in sessions, any subject/teacher); **teacher pay is hourly and independent** of the student's price; **billable time = teacher together with at least one student**; teacher credit is **one per session** (not per student); the student's empty package must never block the teacher's pay; absence reasons are a human matter handled by Admin.

---

## PROMPT A — Fix docs/specs/database-schema.md

```
ROLE: You are a documentation/architecture assistant for the Zarabicschool project.
TASK: Fix the problems listed below in docs/specs/database-schema.md. DOCS ONLY — no code, no Prisma files, no migrations.

BEFORE EDITING, read in this order: docs/CONTEXT.md (revised 2026-09-29 — source of truth, especially Sections 6, 7, 17), INSTRUCTIONS.md, docs/specs/PROGRESS.md, docs/specs/business-model.md, docs/specs/database-schema.md.

RULES
- Edit in place. Do NOT regenerate the file.
- Never invent business rules. For any item marked DECISION REQUIRED: write 2–3 options with trade-offs and a recommendation, mark it OPEN in the file, and do NOT pick one.
- Every new/changed constraint must say WHY it exists (which failure it prevents).
- State where Prisma cannot express something (partial indexes, CHECK constraints, triggers) — it must be a raw SQL step inside a migration.
- Keep the existing table format. Number your work with the labels below (M1, M2 ...), not with bare numbers.

CONFIRMED FACTS YOU MUST REFLECT (from CONTEXT.md)
- Student side: subscription PACKAGES counted in SESSIONS (e.g. 500 package = 8 sessions), usable over one or more months, for ANY subject and ANY teacher. Each attended session consumes exactly 1 session. Student money lives on Invoices.
- Teacher side: money BY THE HOUR from actual time, independent of what the student paid.
- Billable time = the time when the teacher AND at least one student were in the meeting together (union of overlaps; in a group one student is enough). No overlap → zero pay, zero deduction, session MISSED.
- Settlement = ONE DB transaction: one SESSION_DEDUCTION per attending student + ONE SESSION_CREDIT for the teacher + the session settlement marker.
- The teacher report is mandatory for REVIEW only; it never triggers or gates money.
- SMS is post-MVP and may never be built.

PROBLEMS TO FIX

Money safety
M1. Subscriptions: keep sessions_purchased and the package price (total_amount_minor + currency). REMOVE per_session_price_minor (it only existed to compute teacher pay, which is now independent). Do not add any hourly rate to Subscriptions. Mark "package has no time-based expiry" as OPEN (confirm with owner).
M2. SubscriptionLedger is counted in sessions: sessions_delta is the balance (+N on INITIAL_PURCHASE, -1 on SESSION_DEDUCTION). DECISION REQUIRED: what to do with amount_minor (remove / keep informational / keep with a consistency CHECK). Recommend keeping money only on Invoices.
M3. Teacher hourly rate: it is missing from the schema. DECISION REQUIRED: options (rate columns on Teachers / an effective-dated TeacherRates table / per subject). Recommend an effective-dated table so history is auditable. Also record the open questions: same rate for private and group? one currency per teacher or several?
M4. PayrollLedger: teacher credit is ONE per session. Replace the partial unique index (session_id, student_id) with a partial unique index on (session_id) WHERE entry_type='SESSION_CREDIT'. student_id is no longer meaningful on SESSION_CREDIT rows — make it NULL for those rows or remove it, and explain why.
M5. SubscriptionLedger double-deduction guard: partial unique index on (session_id, subscription_id) WHERE entry_type='SESSION_DEDUCTION'. Explain that each ledger protects its own invariant (defense in depth) instead of relying on the other ledger.
M6. Append-only enforcement: document a trigger that raises on UPDATE and DELETE for payroll_ledger and subscription_ledger, plus ON DELETE RESTRICT on every ledger foreign key.
M7. CHECK constraints: SESSION_CREDIT amount > 0; SESSION_DEDUCTION sessions_delta = -1; DISBURSEMENT amount < 0; currency length = 3.
M8. Audit snapshot on every SESSION_CREDIT: billable_seconds, the hourly rate used (rate snapshot), currency, zoom_event_id, source (LIVE_WEBSOCKET / RECONCILIATION / ADMIN). Do NOT add report_id (the report has no financial role).
M9. Settlement marker: add Sessions.financially_settled_at (nullable TIMESTAMPTZ). Document: set only inside the settlement transaction; never editable from a UI; never cleared to retry; corrections are ADMIN_ADJUSTMENT/REFUND entries; ledgers are the truth, the marker is an index. Document the claim step (UPDATE ... WHERE financially_settled_at IS NULL, continue only if 1 row changed) and the consistency queries "marker without ledger rows" / "ledger rows without marker".
M10. Balance-query indexes: PayrollLedger (teacher_id, currency, created_at), SubscriptionLedger (subscription_id, created_at). Decide INTEGER vs BIGINT for amounts and state why.
M11. DECISION REQUIRED: student has zero sessions left when a session is scheduled or settled. Options: block scheduling / allow a negative balance with an Admin flag / both. Hard requirement to state in the file: the teacher's SESSION_CREDIT must never fail because of the student's package. Recommend "block scheduling at zero (Admin override) + allow negative at settlement".

Billable time and attendance
T1. Attendance keeps only the first join, last leave and a cumulative duration, so it cannot compute "teacher and at least one student together". Add AttendanceSegments (attendance_id, joined_at, left_at, zoom_event_id) — one row per join/leave interval, CHECK left_at >= joined_at. Document the computation: for each student segment intersect with teacher segments, then take the UNION over all students (so overlapping students are not counted twice). Mark OPEN with proposals: cap at the scheduled duration, rounding per minute, a missing "left" event closed at meeting end.
T2. Attendance: UNIQUE(session_id, user_id); add overridden_by (FK Users) and override_reason, required when source = 'MANUAL'.
T3. DECISION REQUIRED: minimum attended time for a student's session to count as consumed (today: joined within the first 25% for private). Do not pick.

Reports, red marks, notifications
R1. Reports: partial unique index (session_id, author_id) WHERE report_type='SESSION_COMPLETION_REPORT'. State clearly it has NO financial role.
R2. Add TeacherFlags (PROPOSAL for the "red mark"): id, academy_id, teacher_id, session_id, flag_type ('LATE_REPORT'), created_at, UNIQUE(session_id, flag_type). Informational, visible to Admin. Mark the trigger rule OPEN (CONTEXT §6: T+0 notify, T+15 reminder, T+30 red mark is a PROPOSAL; ask whether late JOINING also produces a mark).
R3. Evaluations: UNIQUE(session_id, evaluator_id); state they are OPTIONAL for the student.
R4. NotificationLog: content is NOT NULL but passwords must never be stored — define what is stored for type CREDENTIALS (template key + redacted content). Add session_id (nullable) and a unique idempotency key (notification_type + session_id + recipient_id [+ sequence for reminders]) so queue retries never send twice. Keep the SMS enum value but note "post-MVP, may never be built".

Integrity gaps
I1. Sessions: UNIQUE on zoom_meeting_id and zoom_meeting_uuid (when not null); CHECK scheduled_end > scheduled_start; CHECK duration_minutes matches the interval; recurrence_group_id (UUID) linking a weekly series.
I2. ZoomEvents.processed_at means "event ingested and attendance processed" ONLY. Add processing_attempts and an index on (processed_at) WHERE processed_at IS NULL.
I3. Event naming: schema says participant.joined, Phase 5 says meeting.participant_joined. Standardize to Zoom's real names (mark "verify in the Phase 4 spike"). event_key must come from ONE shared function used by both the live WebSocket path and the REST reconciliation path.

Missing / misplaced
X1. Missing table Enrollments (student_id, teacher_id, subject_id, status PENDING/CONFIRMED/REJECTED/ENDED, confirmed_by, confirmed_at, UNIQUE(student_id, teacher_id, subject_id)). Note that Subscriptions are NOT tied to an enrollment (any subject/any teacher).
X2. Remove zoom_registrant_id from Students and Teachers (a registrant exists per meeting; it lives in SessionStudents). Document how the teacher is identified as host and how a Zoom participant maps to a platform User — mark "verify in the Phase 4 spike".
X3. Move timezone (IANA name) to Users.
X4. Applications: add application_type (GUARDIAN/STUDENT/TEACHER) and a link to the records created on approval.
X5. Recordings: mark DEFERRED / POST-MVP, provider-neutral storage columns, no migration in the MVP.
X6. Sensitive URLs (Sessions.zoom_start_url, SessionStudents.zoom_join_url): add a "Security notes" line per table (who may read them, never logged); evaluate fetching a fresh start URL via REST instead of storing it (options, OPEN).
X7. Users: add password_changed_at. OPEN QUESTION for the owner: students/guardians may not have emails — is email always the login identifier?
X8. Sessions status/cancellation: keep replacement_for_session_id and cancellation_reason (free text written by Admin). Do NOT add an outage-request table (in-app request form is OPEN/Post-MVP per CONTEXT §6).

Housekeeping
H1. Fix the table of contents (Evaluations is numbered 19 but its anchor says #18; check every anchor; add new tables).
H2. Add a "Prisma notes" section (everything needing raw SQL) and a "Delete policy" section (no hard deletes on anything referenced by a ledger; use is_active/status).
H3. Add a final "Open decisions" list in this file (M2, M3, M11, T1 rules, T3, R2, X6, X7).

WHEN DONE
- Output a short change summary per label (what changed, why).
- List the DECISION REQUIRED items as questions for the owner.
- Append a dated entry to docs/specs/PROGRESS.md; update docs/specs/business-model.md ONLY where it is now inconsistent (it still describes per-session pricing and report-gated payroll — fix those statements to match CONTEXT.md).
- Do not touch the phase-0X files in this task.
```

---

## PROMPT B — Upgrade every docs/specs/phase-0X-*.md

```
ROLE: You are a documentation/architecture assistant for the Zarabicschool project.
TASK: Upgrade each docs/specs/phase-0X-*.md so an engineer can implement the phase full-stack from that single file. Keep ONE file per phase — do not create new spec files.

BEFORE EDITING, read: docs/CONTEXT.md (revised 2026-09-29 — source of truth), INSTRUCTIONS.md (§4 workflow, §5 testing, §6 security, §7 financial, §17 definition of done), docs/specs/PROGRESS.md, docs/specs/business-model.md, docs/specs/database-schema.md (already corrected by Prompt A).

RULES
- Extend each file in place. KEEP the existing Goal, Proposed approach, Tasks and Execution log. Add and adjust; never regenerate or delete.
- Where an existing phase text contradicts CONTEXT.md (per-session teacher pricing, report-gated payroll, teacher credit per student, SMS, embedded-first Zoom, an outage-request form as a required MVP item), FIX it to match CONTEXT.md and list every such fix in your final summary.
- MVP FIRST: anything that would take disproportionate time goes into that phase's "Deferred / Post-MVP" section, NOT into the task checklist. Tag tasks [MVP] or [DEFERRED]. Deferred items are documented well enough to be built later but must not be executed now.
- Never invent business rules. Undecided items go into "Open decisions" (CONTEXT §7 and §17). If an open decision blocks the phase, write "BLOCKED until owner decides".
- Do not duplicate the schema: reference docs/specs/database-schema.md and list only what the phase touches.
- Secrets: env var NAMES only.
- Be concrete: real route names, Zod field names, named test cases. No generic filler.
- Add to each phase a line "Delivery stage:" using CONTEXT §14 (PROPOSAL: Stage 1 = phases 1–3, Stage 2 = phases 4–5, Stage 3 = phases 6–7, phase 8 spans all).

ADD THESE SECTIONS TO EVERY PHASE FILE (after "Proposed approach", before "Tasks"):
1. Acceptance criteria — observable, testable.
2. Frontend — routes/pages, components, states (loading/empty/error), forms + client validation, RTL/i18n notes, per-role visibility.
3. Backend — endpoints or server actions (method, path, purpose), Zod request/response schemas, service-layer responsibilities, one consistent error shape + status codes, background jobs.
4. Database — tables/columns/constraints/indexes touched, migration notes (raw SQL steps), seed data.
5. Auth & Authorization — table Role × Action → allowed?, plus ownership rules (a teacher sees only her own students). Authorization is enforced server-side next to the protected operation.
6. Security — checklist answering INSTRUCTIONS §6 for this phase: who can call it, validation, replay/idempotency, transaction need, what is logged (no passwords, no student-identifying data), rate limits, minors' data, secrets.
7. Transactions & failure handling — REQUIRED for phases 4, 5, 6 and any multi-write operation: which writes are one transaction; locking/claim approach; a unique-constraint violation = "already done", not an error; partial-failure behavior; retry policy and processing_error recording; side effects (WhatsApp notifications) happen AFTER commit, never inside the transaction.
8. Tests — unit / integration (real Postgres test DB) / E2E (Playwright), NAMED cases including failure cases and security boundaries.
9. Learning checkpoint — 1–2 short questions for the owner (INSTRUCTIONS §3.4).
10. Open decisions and Deferred / Post-MVP — two separate lists.
11. Definition of Done — derived from INSTRUCTIONS §17.

PHASE-SPECIFIC INSTRUCTIONS

Phase 1: Server-side enforcement of must_change_password AND is_active on every request (not only a redirect); how a deactivated user's session is invalidated. Add tasks for a Postgres test database and a CI workflow (lint, typecheck, test, build). Present options (OPEN) for repo/process structure: single Next.js app vs monorepo with a shared Prisma package + a separate worker app. Login rate limiting keyed by email AND IP. MVP credential fallback = Admin sees the temporary password ONCE in the UI (PROPOSAL).

Phase 2: Protect the public application form (rate limit, honeypot/captcha, validation) — it is unauthenticated. Reflect the per-type tabs (guardian/student/teacher). Enrollments flow (student/admin proposes, admin confirms). Tasks for temp-password generation and credential delivery through MessagingProvider with NotificationLog that never contains a password. Add the teacher hourly-rate entry to the teacher creation flow (BLOCKED until the rate location is decided). SMS: [DEFERRED — may never be built].

Phase 3: Timezone handling (IANA on Users, store UTC, display per viewer). Recurring generation with recurrence_group_id. Replacement sessions created by Admin with a free-text reason (the reason itself is handled between Admin, student side and teacher as a human matter). OPEN: student has zero sessions left when scheduling (CONTEXT §7 item 4). "Edit a whole series" tools = [DEFERRED] if large.

Phase 4: The Zoom technical spike is the FIRST task and must list exactly what it verifies: plan, Server-to-Server OAuth, registration, WebSocket, the REST endpoints for reconciliation, concurrent meetings, rate limits, real event payload fields for event_key, participant→user mapping, join/leave event fields needed for AttendanceSegments, Meeting SDK requirements for the embedded view. Order: (1) token service, (2) REST meeting creation + registration + join links, (3) WebSocket consumer + ZoomEvents, (4) join-link UI incl. mobile "Launch in Zoom App", (5) LAST: embedded Meeting SDK view — tag [MVP-LAST / MAY SLIP], signature generated server-side, no secret in the browser. Add tasks for Redis + BullMQ + worker bootstrap, health check, graceful shutdown, basic monitoring/error logging (the worker handles money). Zod validation of every event; events are untrusted input. Handling of start_url/join_url.

Phase 5: Participant→user mapping; AttendanceSegments filled from join/leave events (an open interval is closed at meeting end — PROPOSAL); attendance uniqueness; the 25% absence rule for private sessions as an idempotent BullMQ delayed job that survives a restart. The teacher is paid for time with at least one student; a session with no teacher+student overlap is MISSED with zero effect. Notification chain from CONTEXT §6 as tasks: session created→teacher, 2h reminder, teacher joined→students, teacher late-join alert, student joined→guardian, MEETING ENDED→teacher "write the report" and student "write an evaluation (optional)", report late +15 min→second reminder, still late→red mark (TeacherFlags; the rule is a PROPOSAL). The teacher report is mandatory but review-only — say so in the acceptance criteria and add a test that payment does NOT depend on it. Admin sees a list of sessions without a report. The in-app student/teacher outage-request form is [DEFERRED] unless the owner decides otherwise (CONTEXT §7 item 10). Minimal reconciliation job skeleton: propose moving it here as an OPEN decision — do not move it without the owner. Recordings = [DEFERRED].

Phase 6: Settlement is triggered by the session ending with Zoom-verified attendance, NOT by the report. Document, under "Transactions & failure handling": the exact transaction (N student deductions + ONE teacher credit + marker); the claim step (UPDATE sessions SET financially_settled_at = now() WHERE id = ? AND financially_settled_at IS NULL, continue only if 1 row changed, or SELECT ... FOR UPDATE); unique-constraint violations = already settled; queue job id = session id; the teacher's credit must not fail because the student's package is empty; the failure modes of the marker (marker set without money; money moved without marker; check-then-act race between two workers; someone clearing the marker to retry; settled data edited later; Zoom reporting a different duration after settlement → adjustment entry, never re-settle); the periodic consistency checker job. Document the billable-time calculation (union of teacher∩student overlaps) so that each open rule (cap, rounding, missing leave) is a small change; BLOCKED for the parts the owner has not decided. Teacher hourly rate location = OPEN (BLOCKED). Zero sessions left = OPEN (BLOCKED). No currency conversion. Reconciliation writes with source = RECONCILIATION. Low-balance alert = [DEFERRED] candidate (it is now "sessions remaining", e.g. 2 of 8 left). Tests MUST include: duplicate settlement; two workers settling the same session at once; rollback when the second insert fails; replayed meeting.ended; marker-without-ledger and ledger-without-marker detection; group session where only one student attends (teacher paid once, one deduction); group where two students overlap (time not counted twice); private session with only the teacher (zero pay, zero deduction, MISSED); empty student package (teacher still credited); payment NOT blocked by a missing teacher report.

Phase 7: Admin dashboard, reports, evaluations (OPTIONAL for students), announcements. Admin view of TeacherFlags and of sessions without reports. Tag the evaluation prompt and announcements as [DEFERRED] candidates if the owner wants a smaller MVP. Role-scoped report visibility matrix (minors' data care).

Phase 8: Security audit checklist, secrets-rotation verification, database backup/restore check, deployment runbook (VPS process manager, reverse proxy, HTTPS, Redis). Hosting is OPEN until the app works locally. Staged-delivery checklist: what must pass before each stage is handed to the client.

WHEN DONE
- Print, per phase file: sections added, tasks changed/moved, contradictions fixed, and every OPEN decision found.
- Update docs/specs/PROGRESS.md: add the OPEN decisions to Action Items and a dated note.
- Do NOT modify CONTEXT.md, INSTRUCTIONS.md or database-schema.md in this task; list any inconsistency you find for the owner instead of fixing it silently.
```
