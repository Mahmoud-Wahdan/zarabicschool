/**
 * The payer's charge dates on one rail (D55/D56): today pays month 1, then the same
 * day each month. Real dates in an ordered list — the sequence is the content.
 * Calendar dates are formatted from UTC noon so no zone shifts the day.
 */
export default function ChargeDateRail({ dates, locale, firstLabel, laterLabel }: { dates: string[]; locale: string; firstLabel: string; laterLabel: string }) {
  const format = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
  return (
    <ol className="charge-rail relative grid gap-3 sm:grid-cols-3">
      {dates.map((date, index) => (
        <li key={date} className="relative flex items-center gap-3 sm:flex-col sm:items-start sm:gap-2">
          <span
            aria-hidden="true"
            className={`relative z-10 h-3 w-3 shrink-0 rounded-full border-2 ${index === 0 ? "border-secondary bg-secondary" : "border-secondary bg-surface-container-lowest"}`}
          />
          <span>
            <time dateTime={date} className="block text-base font-semibold tabular-nums text-primary">
              {format.format(new Date(`${date}T12:00:00Z`))}
            </time>
            <span className="text-label-sm text-on-surface-variant">{index === 0 ? firstLabel : laterLabel}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
