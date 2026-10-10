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

export function zonedWallClock(instant: Date, timeZone: string): Date {
  const offset = timezoneOffsetMs(instant, timeZone);
  return new Date(instant.getTime() + offset);
}
