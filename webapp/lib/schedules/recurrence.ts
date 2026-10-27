function timezoneOffsetMs(pseudoInstant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(pseudoInstant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const wallAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wallAsUtc - pseudoInstant.getTime();
}

function zonedWallClockToUtc(wall: Date, timeZone: string): Date {
  const offset = timezoneOffsetMs(wall, timeZone);
  const instant = new Date(wall.getTime() - offset);
  const offsetAtInstant = timezoneOffsetMs(instant, timeZone);
  if (offsetAtInstant !== offset) return new Date(wall.getTime() - offsetAtInstant);
  return instant;
}

export function addWeeksInTimeZone(anchor: Date, weeks: number, timeZone: string): Date {
  const offset = timezoneOffsetMs(anchor, timeZone);
  const wallAnchor = new Date(anchor.getTime() + offset);
  const wallShifted = new Date(wallAnchor.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);
  return zonedWallClockToUtc(wallShifted, timeZone);
}

export function wallClockToUtc(wall: Date, timeZone: string): Date {
  return zonedWallClockToUtc(wall, timeZone);
}

export function wallClockInputToUtc(value: string, timeZone: string): Date {
  const wall = new Date(value.length === 16 ? `${value}:00.000Z` : `${value}.000Z`);
  return zonedWallClockToUtc(wall, timeZone);
}

export function zonedWallClock(instant: Date, timeZone: string): Date {
  const offset = timezoneOffsetMs(instant, timeZone);
  return new Date(instant.getTime() + offset);
}

/** The `YYYY-MM-DDTHH:mm` value a datetime-local input shows for `instant` in `timeZone` (inverse of wallClockInputToUtc). */
export function utcToWallClockInput(instant: Date, timeZone: string): string {
  return zonedWallClock(instant, timeZone).toISOString().slice(0, 16);
}

/** The calendar day (`YYYY-MM-DD`) of `instant` in `timeZone` — "today" for a viewer, never the host's day. */
export function zonedYmd(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(instant);
}

/** [start, end) UTC instants of a local calendar day — 23 or 25 hours on a DST change day. */
export function zonedDayRangeUtc(ymd: string, timeZone: string): { start: Date; end: Date } {
  const nextYmd = new Date(new Date(`${ymd}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { start: wallClockInputToUtc(`${ymd}T00:00`, timeZone), end: wallClockInputToUtc(`${nextYmd}T00:00`, timeZone) };
}
