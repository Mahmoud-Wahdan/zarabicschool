/**
 * Pure month-key helpers for the monthly report stream (CONTEXT §9, Session 1).
 * A month key is `'YYYY-MM'` — lexically comparable, no timezone ambiguity in
 * storage. "The month that has started" is evaluated in a person's local
 * calendar (viewer/teacher timezone), DST-safe through Intl.
 */

export function isValidMonthKey(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Local calendar year-month for a timezone (DST-safe via Intl). */
export function currentMonthKey(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  return `${year}-${month}`;
}

/** `2026-01` → `2025-12`. */
export function previousMonthKey(monthKey: string): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
}

/** UTC [month start, next month start) for scheduledStart range queries. */
export function monthKeyRangeUtc(monthKey: string): { start: Date; end: Date } {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

/** Month label in the UI locale (ar/en) — e.g. "September 2026" / "سبتمبر ٢٠٢٦". */
export function formatMonthLabel(monthKey: string, locale: "ar" | "en"): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const instant = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ar-EG", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(instant);
}
