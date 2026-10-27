/**
 * Join window (D4, owner 2026-10-27; replaces the Phase 4 constant of 15): the join
 * button/redirect opens this many minutes before the scheduled start and stays open
 * until the scheduled end, for every role except Admin and Supervisor (they manage
 * links at any time). The Admin sets it per academy (AcademySettings
 * `join_window_minutes`, read by `lib/sessions/join-window.ts`); this default applies
 * when no setting exists. Range OQ-4: 5–120 whole minutes.
 */
export const DEFAULT_JOIN_WINDOW_MINUTES = 30;
export const MIN_JOIN_WINDOW_MINUTES = 5;
export const MAX_JOIN_WINDOW_MINUTES = 120;

export type JoinWindowState = "before" | "open" | "after";

/** Where `now` sits in a session's join window (used by the UI to render the button state;
 *  the /join route re-checks server-side as the authority). */
export function joinWindowState(
  scheduledStart: Date,
  scheduledEnd: Date,
  now = new Date(),
  windowMinutes = DEFAULT_JOIN_WINDOW_MINUTES,
): JoinWindowState {
  const instant = now.getTime();
  if (instant < scheduledStart.getTime() - windowMinutes * 60 * 1000) return "before";
  if (instant > scheduledEnd.getTime()) return "after";
  return "open";
}
