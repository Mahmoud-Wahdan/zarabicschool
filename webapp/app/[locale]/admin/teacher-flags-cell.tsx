"use client";

import { useLocale, useTranslations } from "next-intl";

export type TeacherFlagForDisplay = {
  id: string;
  flagType: "LATE_REPORT" | "MONTHLY_REPORT_MISSING";
  monthKey: string | null;
  session: {
    scheduledEnd: string;
    timezone: string;
    subject: { nameAr: string; nameEn: string };
  } | null;
};

function formatSessionDate(value: string, timeZone: string, locale: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ar-EG", {
      timeZone,
      dateStyle: "medium",
    }).format(date);
  } catch {
    return null;
  }
}

function formatMonth(monthKey: string | null, locale: string): string | null {
  const match = monthKey?.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const date = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ar-EG", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(date);
}

export default function TeacherFlagsCell({ flags }: { flags: TeacherFlagForDisplay[] }) {
  const locale = useLocale();
  const t = useTranslations("management.form.teacherFlags");

  if (flags.length === 0) {
    return <span className="text-on-surface-variant">{t("none")}</span>;
  }

  const countLabel = t("count", { count: flags.length });
  return (
    <details className="max-w-64">
      <summary className="cursor-pointer rounded-sm text-label-sm font-semibold text-secondary underline decoration-secondary/50 underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary">
        {countLabel}
      </summary>
      <ul className="mt-2 max-h-48 space-y-2 overflow-auto text-sm">
        {flags.map((flag) => {
          if (flag.flagType === "LATE_REPORT") {
            const date = flag.session
              ? formatSessionDate(flag.session.scheduledEnd, flag.session.timezone, locale)
              : null;
            const subject = flag.session
              ? (locale === "en" ? flag.session.subject.nameEn : flag.session.subject.nameAr)
              : "";
            return (
              <li key={flag.id}>
                <span className="font-medium text-on-surface">{t("lateReport")}</span>
                <span className="block text-on-surface-variant">
                  {subject ? `${subject} · ` : ""}{date ?? t("sessionContextUnavailable")}
                </span>
              </li>
            );
          }

          return (
            <li key={flag.id}>
              <span className="font-medium text-on-surface">{t("monthlyReportMissing")}</span>
              <span className="block text-on-surface-variant">
                {formatMonth(flag.monthKey, locale) ?? t("monthContextUnavailable")}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}