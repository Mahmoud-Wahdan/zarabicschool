import { utcToWallClockInput, zonedDayRangeUtc, zonedYmd } from "../schedules/recurrence";

/**
 * Weekly calendar helpers (S-10, D13/D27): pure and client-safe. The week starts on
 * Saturday (Egyptian working week) and every day boundary and time is computed in
 * the viewer's zone (DST-safe: a day may be 23 or 25 hours).
 */
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const SATURDAY = 6;

function addDays(ymd: string, days: number): string {
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function saturdayOf(ymd: string): string {
  const weekday = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return addDays(ymd, -((weekday - SATURDAY + 7) % 7));
}

/** `?week=YYYY-MM-DD` → the Saturday of that week; missing/invalid → the current week in `timeZone`. */
export function parseWeekParam(value: string | undefined, now: Date, timeZone: string): string {
  const valid = value && YMD.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
  return saturdayOf(valid ? value : zonedYmd(now, timeZone));
}

export function shiftWeek(weekStart: string, weeks: number): string {
  return addDays(weekStart, weeks * 7);
}

type Timed = { id: string; scheduledStart: Date; scheduledEnd: Date };

export function buildWeek<T extends Timed>(sessions: T[], weekStart: string, timeZone: string) {
  const ymds = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const days = ymds.map((ymd) => ({ ymd, entries: [] as (T & { startTime: string; endTime: string })[] }));
  const byYmd = new Map(days.map((day) => [day.ymd, day]));
  for (const session of [...sessions].sort((a, b) => a.scheduledStart.getTime() - b.scheduledStart.getTime())) {
    byYmd.get(zonedYmd(session.scheduledStart, timeZone))?.entries.push({
      ...session,
      startTime: utcToWallClockInput(session.scheduledStart, timeZone).slice(11, 16),
      endTime: utcToWallClockInput(session.scheduledEnd, timeZone).slice(11, 16),
    });
  }
  return {
    days,
    range: { start: zonedDayRangeUtc(ymds[0], timeZone).start, end: zonedDayRangeUtc(ymds[6], timeZone).end },
  };
}

/** D30: a private session names its student; a group shows "Group (n)" and the names when expanded. */
export function teacherEntryLabel(sessionType: string, names: string[]) {
  return sessionType === "GROUP"
    ? { kind: "GROUP" as const, count: names.length, names }
    : { kind: "PRIVATE" as const, name: names[0] ?? "", names };
}
