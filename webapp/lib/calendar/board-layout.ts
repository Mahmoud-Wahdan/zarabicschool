import { COUNTED_BOARD_STATUSES, type BoardStatus } from "../config/schedule-board";

/**
 * Pure helpers for the schedule board (S-16): totals in scheduled minutes inside one
 * local day (a session crossing midnight is split), and the threshold flag. Client-safe.
 */
export type BoardEntry = { start: Date; end: Date; status: BoardStatus };

/** Minutes of [start, end) that fall inside [dayStart, dayEnd). */
export function minutesInside(start: Date, end: Date, dayStart: Date, dayEnd: Date): number {
  const from = Math.max(start.getTime(), dayStart.getTime());
  const to = Math.min(end.getTime(), dayEnd.getTime());
  return to > from ? Math.round((to - from) / 60_000) : 0;
}

export function dayTotals(entries: BoardEntry[], day: { start: Date; end: Date }, thresholdMinutes: number) {
  let sessions = 0;
  let minutes = 0;
  for (const entry of entries) {
    if (!COUNTED_BOARD_STATUSES.includes(entry.status)) continue;
    const inside = minutesInside(entry.start, entry.end, day.start, day.end);
    if (inside === 0) continue;
    sessions += 1;
    minutes += inside;
  }
  return { sessions, minutes, overThreshold: minutes > thresholdMinutes };
}
