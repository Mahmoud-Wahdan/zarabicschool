/**
 * Every date/time shown in the app goes through here with an EXPLICIT zone — the
 * viewer's stored zone (or the recipient's for messages). A bare Intl call would use
 * the host's or the browser's zone (time-zone audit, 2026-10-27; test ZF-03).
 */
export function formatDateTime(
  instant: Date | string,
  timeZone: string,
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { ...options, timeZone }).format(new Date(instant));
}

export function formatSessionDateTime(instant: Date | string, timeZone: string, locale: string): string {
  return formatDateTime(instant, timeZone, locale);
}
