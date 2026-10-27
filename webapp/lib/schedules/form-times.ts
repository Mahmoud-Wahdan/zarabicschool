import { utcToWallClockInput, wallClockInputToUtc } from "./recurrence";

/**
 * datetime-local form helpers (time-zone audit, 2026-10-27): a form pre-fills the
 * stored UTC instants as the VIEWER's wall clock and parses the inputs back in the
 * same zone, so opening a form and saving it unchanged never moves a session.
 */
export function rangeToInputs(start: string | Date, end: string | Date, timeZone: string): { start: string; end: string } {
  return { start: utcToWallClockInput(new Date(start), timeZone), end: utcToWallClockInput(new Date(end), timeZone) };
}

/**
 * Parses the inputs back to UTC. A field left exactly as pre-filled keeps its stored
 * instant: in the repeated hour of a DST end (Cairo 2026-10-29, 23:00–24:00 happens
 * twice) the wall clock alone is ambiguous and would otherwise pick the later one.
 */
export function rangeFromInputs(
  start: string,
  end: string,
  timeZone: string,
  original?: { start: string | Date; end: string | Date },
): { start: string; end: string } {
  const parse = (value: string, stored?: string | Date) =>
    stored !== undefined && utcToWallClockInput(new Date(stored), timeZone) === value
      ? new Date(stored).toISOString()
      : wallClockInputToUtc(value, timeZone).toISOString();
  return { start: parse(start, original?.start), end: parse(end, original?.end) };
}
