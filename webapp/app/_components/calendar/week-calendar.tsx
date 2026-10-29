import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";
import type { CalendarSession } from "../../../lib/calendar/data";
import { buildWeek, shiftWeek, teacherEntryLabel } from "../../../lib/calendar/week";
import { formatDateTime } from "../../../lib/schedules/display";

/**
 * View-only weekly calendar (S-10; D13, D27, D30). Seven columns from Saturday on
 * wide screens, one stacked list per day on phones. Entries show the time in the
 * viewer's zone, the subject and the teacher; the teacher sees the student's name
 * (private) or "Group (n)" with the names in a native <details> (D30). No Zoom link
 * and no session creation here — joining stays on the sessions pages.
 */
export default async function WeekCalendar({
  sessions,
  weekStart,
  timeZone,
  locale,
  role,
  basePath,
  extraQuery = {},
}: {
  sessions: CalendarSession[];
  weekStart: string;
  timeZone: string;
  locale: string;
  role: "TEACHER" | "STUDENT" | "GUARDIAN";
  basePath: string;
  extraQuery?: Record<string, string>;
}) {
  const t = await getTranslations("calendar");
  const tSessions = await getTranslations("sessions");
  const week = buildWeek(sessions, weekStart, timeZone);
  const href = (week: string) => ({ pathname: basePath, query: { ...extraQuery, week } });
  // A calendar date (not an instant): rendered from UTC noon so no zone can shift the day.
  const dayLabel = (ymd: string) => formatDateTime(`${ymd}T12:00:00Z`, "UTC", locale, { weekday: "long", day: "numeric", month: "short" });
  const subject = (session: CalendarSession) => (locale === "ar" ? session.subject.nameAr : session.subject.nameEn);

  return (
    <section className="mt-6 flex flex-col gap-4" aria-label={t("weekOf", { date: dayLabel(weekStart) })}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body-sm text-on-surface-variant">
          {t("weekOf", { date: dayLabel(weekStart) })} · {t("zone", { zone: timeZone })}
        </p>
        <nav className="flex flex-wrap gap-2" aria-label={t("weekNav")}>
          <Link href={href(shiftWeek(weekStart, -1))} className="rounded-lg border border-outline-variant px-3 py-1.5 text-label-md">{t("previous")}</Link>
          <Link href={{ pathname: basePath, query: extraQuery }} className="rounded-lg border border-outline-variant px-3 py-1.5 text-label-md">{t("thisWeek")}</Link>
          <Link href={href(shiftWeek(weekStart, 1))} className="rounded-lg border border-outline-variant px-3 py-1.5 text-label-md">{t("next")}</Link>
        </nav>
      </div>
      <ol className="grid grid-cols-1 gap-3 md:grid-cols-7">
        {week.days.map((day) => (
          <li key={day.ymd} className="flex min-w-0 flex-col gap-2 rounded-xl border border-outline-variant bg-surface-container-lowest p-3">
            <h2 className="text-label-md font-bold text-primary">{dayLabel(day.ymd)}</h2>
            {day.entries.length === 0 ? (
              <p className="text-label-sm text-on-surface-variant">{t("free")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {day.entries.map((entry) => {
                  const cancelled = entry.status === "CANCELLED" || entry.status === "MISSED";
                  const names = entry.students.map((row) => row.student.user.displayName);
                  const label = teacherEntryLabel(entry.sessionType, names);
                  return (
                    <li key={entry.id} className={`rounded-lg bg-surface-container-low p-2 text-label-sm ${cancelled ? "text-on-surface-variant" : ""}`}>
                      <p className="font-bold tabular-nums" dir="ltr">
                        <time dateTime={entry.scheduledStart.toISOString()}>{entry.startTime}</time>–<time dateTime={entry.scheduledEnd.toISOString()}>{entry.endTime}</time>
                      </p>
                      <p className={`font-semibold text-primary ${cancelled ? "line-through" : ""}`}>{subject(entry)}</p>
                      {role === "TEACHER" ? (
                        label.kind === "GROUP" ? (
                          <details>
                            <summary className="cursor-pointer">{t("group", { count: label.count })}</summary>
                            <ul className="mt-1 ps-3">
                              {label.names.map((name) => <li key={name}>{name}</li>)}
                            </ul>
                          </details>
                        ) : (
                          <p>{label.name}</p>
                        )
                      ) : (
                        <p>{entry.teacher.user.displayName}</p>
                      )}
                      {entry.status !== "SCHEDULED" ? <p className="text-on-surface-variant">{tSessions(`statuses.${entry.status}`)}</p> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
