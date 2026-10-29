# S-07 — Roster changes (D18, D16, D41)

> Branch `phase9-rest`. Status: **approved as shown (owner, 2026-10-29): Q1–Q3 and SQL S-9. Answers: A yes (CONSUMED blocks removal); B no (removing the last student of a GROUP session is allowed); C WhatsApp + in-app.**

## What exists today (read 2026-10-29)

- `POST /api/admin/enrollments` adds a student to a SCHEDULED session (Admin/Supervisor).
  - It refuses an ended session (D16, `SESSION_ALREADY_ENDED`).
  - It checks assignment and credit, and reserves one session credit.
- `DELETE /api/admin/enrollments` removes the student and releases the RESERVED reservation.
- **Gaps against D18:**
  - removal doesn't check GROUP vs PRIVATE;
  - removal isn't blocked by a SUBMITTED/APPROVED report;
  - removal doesn't lock the session row;
  - removal doesn't refuse a session that is no longer SCHEDULED;
  - adding a second student to a PRIVATE session is not refused.
- **Credit reductions:** there is no admin "cancel/reduce subscription" screen. The only reduction is the S-13c refund, which already refuses to touch sessions RESERVED for upcoming classes (`NOT_ENOUGH_CREDIT`). D18's "list the reservations first" becomes: the refusal names those upcoming sessions.
- **Complaints** keep no roster (M-6 / D41).

## Q1 — Remove a student (ATTENDANCE/credit write; Admin or Supervisor, same academy)

All in one transaction:

```sql
-- lock the session row first (two removals or an add/remove race wait for each other)
SELECT id, session_type, status, scheduled_end FROM sessions
 WHERE id = $session AND academy_id = $academy FOR UPDATE;
--   not found                → 404 NOT_FOUND
--   status <> 'SCHEDULED'    → 409 SESSION_NOT_SCHEDULED
--   session_type = 'PRIVATE' → 409 PRIVATE_SESSION_CANCEL_INSTEAD   (D18: cancel the session)

-- blocked once the student has a submitted or approved report (D18)
SELECT 1 FROM reports
 WHERE session_id = $session AND student_id = $student AND status IN ('SUBMITTED', 'APPROVED');
--   found → 409 REPORT_EXISTS

-- blocked when attendance was already settled for this student (proposal, see question A)
SELECT 1 FROM session_reservations
 WHERE session_id = $session AND student_id = $student AND status = 'CONSUMED';
--   found → 409 ATTENDANCE_SETTLED

DELETE FROM session_students WHERE session_id = $session AND student_id = $student;
--   0 rows → 404 NOT_FOUND (not on the roster)
UPDATE session_reservations SET status = 'RELEASED', released_at = now()
 WHERE session_id = $session AND student_id = $student AND status = 'RESERVED';
```

No ledger row is written. Releasing a reservation gives the credit back by itself, because the balance counts RESERVED rows.

## Q2 — Add a student (existing route, two additions)

```sql
SELECT id, session_type, status, scheduled_end, teacher_id, subject_id FROM sessions
 WHERE id = $session AND academy_id = $academy FOR UPDATE;          -- new: the same lock as Q1
SELECT count(*) FROM session_students WHERE session_id = $session;  -- new
--   session_type = 'PRIVATE' AND count >= 1 → 409 PRIVATE_SESSION_FULL  (D18: add only on GROUP)
-- then unchanged: D16 ended check, assignment check, INSERT session_students, reserveCredit (one RESERVED row)
```

## Q3 — Refund refusal names the upcoming reserved sessions (read only)

```sql
SELECT s.id, s.scheduled_start FROM session_reservations r
  JOIN sessions s ON s.id = r.session_id
 WHERE r.subscription_id = $subscription AND r.status = 'RESERVED' AND s.scheduled_start > now()
 ORDER BY s.scheduled_start;
```

The `NOT_ENOUGH_CREDIT` answer gains `reservedSessions: [{ id, scheduledStart }]`. The Admin refund form shows them as links, so the Admin removes the student there first.

## SQL S-9 — Complaint roster snapshot (D41; `complaints`, not financial)

```sql
-- The session's roster student ids at the time the complaint is filed. NULL = filed
-- before this column existed (older complaints keep showing the current roster).
ALTER TABLE "complaints" ADD COLUMN "roster_student_ids" UUID[];
```

- The complaint service fills it from `session_students` in the same transaction as the INSERT.
- The Admin/Supervisor complaint page shows "another participant" against that snapshot when present, otherwise against the current roster.

## Questions for the owner

- **A.** Also block removal when attendance for that student was already settled by a manual resolution (reservation CONSUMED)? Recommended: yes, the credit was already used.
- **B.** Removing the LAST student of a GROUP session: allow it (the session stays with no students), or refuse and ask the Admin to cancel the session? Recommended: refuse (409 LAST_STUDENT_CANCEL_INSTEAD).
- **C.** Tell the removed student (or their guardian) by WhatsApp + in-app? Recommended: yes, a short "you were removed from the session on <date/time>" in their language and zone, never a link.

## Tests planned

- **RC-01..08:**
  - GROUP remove releases the reservation (credit back);
  - PRIVATE remove → 409;
  - report SUBMITTED/APPROVED → 409; CONSUMED → 409;
  - last student → 409;
  - not SCHEDULED → 409;
  - academy scope and roles; lock (two parallel removals = one success);
  - add a second student to PRIVATE → 409;
  - refund refusal lists the reserved sessions.
- Complaint snapshot: filled at filing; shown after a later roster change.

## Built (2026-10-29)
- `lib/scheduling/roster.ts` `removeStudentFromSession` (Q1): session row locked FOR UPDATE; 404 outside the academy; 409 SESSION_NOT_SCHEDULED, PRIVATE_SESSION_CANCEL_INSTEAD, REPORT_EXISTS (SUBMITTED/APPROVED), ATTENDANCE_SETTLED (CONSUMED); the roster row goes and the RESERVED reservation is RELEASED (no ledger row). The removed student and their guardian (only when no other child stays) get ROSTER_REMOVED (in-app + WhatsApp, time in the recipient zone, no link); their PENDING notices for that session are cancelled; a guardian with another child still on the roster keeps reminders and still gets the notice. Removing the last student is allowed (answer B).
- `DELETE /api/admin/enrollments` uses it; `POST` (Q2) takes the same session lock and, after the D16 ended check, refuses a second student on a PRIVATE session (409 PRIVATE_SESSION_FULL).
- Q3: the S-13c refund refusal NOT_ENOUGH_CREDIT carries `reservedSessions` (upcoming RESERVED sessions of that package); the refund form lists them as links to the session pages.
- SQL S-9 applied (`20261029110000_complaints_roster_snapshot`, 44 migrations, live DB = schema): `complaints.roster_student_ids` filled from the roster when a complaint is filed; the Admin/Supervisor complaint page shows that roster (`complaintRoster`), or the current roster for older complaints.
- Older tests updated to D18: the Phase 3 enrollment test now uses a GROUP session; MG-06 still answers SESSION_ALREADY_ENDED first (the ended check runs before the private-full check).
- Tests: `__tests__/api/roster-changes.test.ts` RC-01..09; RF-03 extended (reservedSessions); affected suites (sessions, money guards, refunds, refund requests, phase 7, i18n, OWASP, same-origin, worker, inbox) green. Impeccable detector clean.
