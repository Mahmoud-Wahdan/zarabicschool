import { wallClockInputToUtc, zonedYmd } from "../schedules/recurrence";

/**
 * D56 (owner, 2026-10-27): renewals fall on the same day of the month as the first
 * payment; in a shorter month a missing day moves to that month's last day. A period
 * ends at local midnight on the next anchor date; `nextBilling` is that local date,
 * sent to Paymob as the subscription's `next_billing` (it only bills in fixed day
 * counts otherwise).
 */
export type RenewalPeriod = {
  anchorDay: number;
  start: Date;
  /** Local calendar date the period starts on (invoices.billing_period_start). */
  startDate: string;
  end: Date;
  /** Local calendar date the next charge falls on (Paymob `next_billing`). */
  nextBilling: string;
};

const pad = (value: number) => String(value).padStart(2, "0");

export function anchorDayOf(paidAt: Date, timeZone: string): number {
  return Number(zonedYmd(paidAt, timeZone).slice(8, 10));
}

/** The next anchor date strictly after the month of `ymd`. */
function nextAnchorDate(ymd: string, anchorDay: number): string {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7)); // 1-12
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const daysInMonth = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  return `${nextYear}-${pad(nextMonth)}-${pad(Math.min(anchorDay, daysInMonth))}`;
}

export function nextPeriodAfter(start: Date, anchorDay: number, timeZone: string): RenewalPeriod {
  if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) {
    throw new RangeError("Billing anchor day must be 1-31.");
  }
  const startDate = zonedYmd(start, timeZone);
  const nextBilling = nextAnchorDate(startDate, anchorDay);
  return { anchorDay, start, startDate, end: wallClockInputToUtc(`${nextBilling}T00:00`, timeZone), nextBilling };
}

/** Month 1 (D55): starts at the verified sign-up payment. */
export function firstPeriod(paidAt: Date, timeZone: string): RenewalPeriod {
  return nextPeriodAfter(paidAt, anchorDayOf(paidAt, timeZone), timeZone);
}

/** Today plus the next automatic charge dates (local YYYY-MM-DD), for the consent card. */
export function upcomingChargeDates(from: Date, timeZone: string, count: number): string[] {
  const dates: string[] = [];
  let period = firstPeriod(from, timeZone);
  dates.push(period.startDate);
  while (dates.length < count) {
    dates.push(period.nextBilling);
    period = nextPeriodAfter(period.end, period.anchorDay, timeZone);
  }
  return dates;
}
