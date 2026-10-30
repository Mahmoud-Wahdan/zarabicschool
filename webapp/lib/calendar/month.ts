import { zonedDayRangeUtc, zonedYmd } from "../schedules/recurrence";
import { parseWeekParam } from "./week";

/**
 * Month and view helpers for the shared sessions calendar (owner, 2026-10-31: a week
 * or a month is shown as a calendar, not a list). Pure and client-safe. Weeks start on
 * Saturday, like the weekly calendar; every boundary is in the viewer's zone.
 */
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CalendarView = "week" | "month" | "table";

export function parseView(value: string | undefined): CalendarView {
  return value === "month" || value === "table" ? value : "week";
}

/** `?month=YYYY-MM` → that month; missing or invalid → the current month in `timeZone`. */
export function parseMonthParam(value: string | undefined, now: Date, timeZone: string): string {
  return value && YM.test(value) ? value : zonedYmd(now, timeZone).slice(0, 7);
}

export function shiftMonth(month: string, months: number): string {
  const [year, index] = month.split("-").map(Number);
  const total = year * 12 + (index - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function addDays(ymd: string, days: number): string {
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole weeks (Saturday to Friday) covering the month: 35 or 42 days. */
export function monthGrid(month: string): { days: string[]; first: string; last: string } {
  const first = `${month}-01`;
  const last = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const start = parseWeekParam(first, new Date(`${first}T12:00:00Z`), "UTC");
  const days: string[] = [];
  for (let day = start; day <= last || days.length % 7 !== 0; day = addDays(day, 1)) days.push(day);
  return { days, first, last };
}

/** UTC range of a list of consecutive local days. */
export function daysRangeUtc(days: string[], timeZone: string) {
  return { start: zonedDayRangeUtc(days[0], timeZone).start, end: zonedDayRangeUtc(days[days.length - 1], timeZone).end };
}
