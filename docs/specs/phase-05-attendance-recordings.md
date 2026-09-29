# Phase 5 — Attendance & Recordings

## Goal

Attendance tracking (Zoom-event-driven), session log, recordings access (if/when available from Zoom). (CONTEXT.md §13, Phase 5.)

Build the attendance evaluation engine that consumes Zoom events, calculates teacher and student attendance durations, enforces the 25% student absence threshold for private sessions, provides a teacher post-session report submission flow (the prerequisite for payroll), and handles outage claims.

## Proposed approach

1. **Database Migrations:** Add `Attendance` table to Prisma schema, recording participant role, join/leave timestamps, attended seconds, and absence flags.
2. **Attendance Event Processing:**
   - Listen for `meeting.participant_joined` and `meeting.participant_left` events.
   - Aggregate cumulative attended duration per participant.
   - Flag teacher arrival >3 minutes late as informational `is_late = true` (no financial penalty).
3. **Absence Threshold Engine (Private Sessions):**
   - Calculate threshold = 25% of scheduled session duration (e.g. 15 min for 60-min session).
   - If a private student does not join within the threshold window:
     - Mark student `is_absent = true`.
     - Update session status to `MISSED`.
     - **Zero Financial Impact:** Do not debit student quota; do not credit teacher.
4. **Group Session Attendance:**
   - Evaluate attendance individually per student. Only attending students are marked present and billed.
5. **Teacher Mandatory Session Report (`SESSION_COMPLETION_REPORT`):**
   - Provide Teacher UI to submit the required session report upon meeting completion.
   - **Business Rule:** The post-session report is mandatory for educational quality and admin review, but does **NOT** gate payroll (payroll settles automatically from Zoom attendance). Overdue reports trigger WhatsApp reminders (T+0, T+15m) and record a red mark on the teacher at T+30m.
6. **Technical Outage / Replacement Request Flow ("أبلغ عن عطل"):**
   - In-app form for Student or Teacher to report an outage (internet cutoff, electricity, Zoom crash) that prevented or disrupted attendance.
   - Admin review queue to inspect outage claims and schedule linked replacement sessions (`replacement_for_session_id`).
7. **WhatsApp Notifications (OpenWA):**
   - Teacher joined $\rightarrow$ notify students.
   - Teacher >3 min late $\rightarrow$ send teacher reminder.

## Tasks

- [ ] Add Prisma schema: `Attendance` table with duration and absence columns
- [ ] Run migration
- [ ] Implement participant join/leave event consumer to compute attendance duration
- [ ] Implement 25% duration absence threshold timer for private sessions
- [ ] Implement group session per-student attendance tracking
- [ ] Build Teacher UI for mandatory post-session completion report submission
- [ ] Build Student/Teacher technical outage request submission form
- [ ] Build Admin outage claim review & replacement session scheduling queue
- [ ] Build Teacher, Student, and Guardian attendance views
- [ ] Integrate OpenWA notifications (teacher joined $\rightarrow$ students; late teacher alert)
- [ ] Write tests: 25% threshold calculation, absence marking, duration computation, outage request flow

## Execution log (updated as soon as real work happens)

(empty for now)
