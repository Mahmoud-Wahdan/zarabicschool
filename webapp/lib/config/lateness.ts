/**
 * Teacher late-start rules (owner decision, final — 2026-10-26). Measured from the
 * session's SCHEDULED START against the assigned teacher's platform link clicks
 * (session_join_clicks; join or host button):
 *  (a) no click by T+TEACHER_LATE_REMINDER_MINUTES → WhatsApp reminder to the teacher;
 *  (b) still no click by T+ADMIN_LATE_ALERT_MINUTES → alert to every active Admin.
 * The owner said "10 to 15" for (b); 10 is the named default to change here.
 * Only SCHEDULED sessions that have not ended; each step at most once per session.
 */
export const TEACHER_LATE_REMINDER_MINUTES = 5;
export const ADMIN_LATE_ALERT_MINUTES = 10;
/** Scan window after the start, so a short worker outage does not drop a step. */
export const LATE_START_SCAN_WINDOW_MINUTES = 60;
