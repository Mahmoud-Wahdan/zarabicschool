/**
 * CONFIRMED (Phase 4): the join button/redirect opens this many minutes before the
 * scheduled start and stays open until the scheduled end. Admin and Supervisor are
 * exempt (they manage links at any time).
 */
export const JOIN_OPENS_BEFORE_START_MINUTES = 15;

export const JOIN_OPENS_BEFORE_START_MS = JOIN_OPENS_BEFORE_START_MINUTES * 60 * 1000;

export type JoinWindowState = "before" | "open" | "after";

/** Where `now` sits in a session's join window (used by the UI to render the button state;
 *  the /join route re-checks server-side as the authority). */
export function joinWindowState(scheduledStart: Date, scheduledEnd: Date, now = new Date()): JoinWindowState {
  const instant = now.getTime();
  if (instant < scheduledStart.getTime() - JOIN_OPENS_BEFORE_START_MS) return "before";
  if (instant > scheduledEnd.getTime()) return "after";
  return "open";
}

