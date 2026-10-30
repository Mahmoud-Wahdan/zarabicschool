import { getTranslations } from "next-intl/server";

import { Link } from "../../../i18n/navigation";
import { shiftMonth, type CalendarView } from "../../../lib/calendar/month";
import { buildWeek, shiftWeek } from "../../../lib/calendar/week";
import { zonedYmd } from "../../../lib/schedules/recurrence";
import DataTable, { type DataColumn, type DataRow } from "../ui/data-table";
import Icon from "../ui/icon";
import { type BadgeTone } from "../ui/status-badge";

/**
 * Shared sessions calendar for the dashboards (owner, 2026-10-31: a week or a month
 * is a calendar, not a list). Three views in the URL (`?view=week|month|table`):
 * a week of seven day columns (Saturday first), a month grid (a day opens its week),
 * and the sortable table with quick filters and the Excel export. Times are in the
 * viewer's zone. View only: joining and editing stay on the sessions pages.
 */
type CalendarSession = {
  id: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  status: string;
  sessionType: string;
  subject: { nameAr: string; nameEn: string };
  teacher: { user: { displayName: string } };
  students: { student: { user: { displayName: string } } }[];
};

const CHIP: Record<string, string> = {
  SCHEDULED: "bg-primary-fixed/60 text-on-surface",
  COMPLETED: "bg-secondary-fixed/40 text-on-surface",
  MISSED: "bg-error-container/70 text-on-error-container",
  CANCELLED: "bg-surface-container text-on-surface-variant line-through",
};
const TONE: Record<string, BadgeTone> = { SCHEDULED: "info", COMPLETED: "success", MISSED: "danger", CANCELLED: "neutral" };
const MONTH_CELL_LIMIT = 3;

export default async function SessionsCalendar({
  title,
  subtitle,
  view,
  weekStart,
  month,
  monthDays,
  sessions,
  now,
  timeZone,
  locale,
  basePath,
  show,
  scheduleHref,
  scheduleLabel,
  exportName,
}: {
  title: string;
  subtitle: string;
  view: CalendarView;
  /** Saturday of the shown week (week and table views). */
  weekStart: string | null;
  /** `YYYY-MM` of the shown month (also where the month tab opens). */
  month: string;
  /** The month grid days (month view). */
  monthDays: string[] | null;
  sessions: CalendarSession[];
  now: Date;
  timeZone: string;
  locale: string;
  basePath: string;
  /** What each entry names besides the subject. */
  show: "teacher" | "students" | "both";
  scheduleHref: string;
  scheduleLabel: string;
  /** Excel export in the table view; omit to hide it. */
  exportName?: string;
}) {
  const t = await getTranslations("sessionsCalendar");
  const tStatus = await getTranslations("sessions");
  const dateLocale = locale === "ar" ? "ar-EG" : "en-GB";
  const time = new Intl.DateTimeFormat(dateLocale, { timeZone, hour: "numeric", minute: "2-digit" });
  // Calendar dates (not instants) render from UTC noon so no zone can shift the day.
  const dayName = new Intl.DateTimeFormat(dateLocale, { timeZone: "UTC", weekday: "short" });
  const dayNumber = new Intl.DateTimeFormat(dateLocale, { timeZone: "UTC", day: "numeric" });
  const fullDay = new Intl.DateTimeFormat(dateLocale, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
  const monthLabel = new Intl.DateTimeFormat(dateLocale, { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${month}-15T12:00:00Z`));
  const noon = (ymd: string) => new Date(`${ymd}T12:00:00Z`);
  const today = zonedYmd(now, timeZone);
  const separator = locale === "ar" ? "، " : ", ";
  const subject = (session: CalendarSession) => (locale === "ar" ? session.subject.nameAr : session.subject.nameEn);
  const studentsOf = (session: CalendarSession) => session.students.map((row) => row.student.user.displayName).join(separator) || "—";
  const who = (session: CalendarSession) => {
    const students = session.students.map((row) => row.student.user.displayName).join(separator);
    if (show === "teacher") return session.teacher.user.displayName;
    if (show === "students") return students || "—";
    return [session.teacher.user.displayName, students].filter(Boolean).join(" · ");
  };
  const href = (query: Record<string, string>) => ({ pathname: basePath, query });
  // "Previous" points toward the start of the reading direction.
  const rtl = locale === "ar";

  const week = weekStart ? buildWeek(sessions, weekStart, timeZone) : null;
  const byDay = new Map<string, CalendarSession[]>();
  for (const session of sessions) {
    const ymd = zonedYmd(session.scheduledStart, timeZone);
    byDay.set(ymd, [...(byDay.get(ymd) ?? []), session]);
  }

  const period =
    view === "month"
      ? monthLabel
      : t("weekOf", { date: fullDay.format(noon(weekStart!)) });
  const prev = view === "month" ? href({ view, month: shiftMonth(month, -1) }) : href({ view, week: shiftWeek(weekStart!, -1) });
  const next = view === "month" ? href({ view, month: shiftMonth(month, 1) }) : href({ view, week: shiftWeek(weekStart!, 1) });
  const current = href(view === "week" ? {} : { view });

  const tabs: { key: CalendarView; label: string; icon: "date_range" | "calendar_month" | "table_rows" }[] = [
    { key: "week", label: t("week"), icon: "date_range" },
    { key: "month", label: t("month"), icon: "calendar_month" },
    { key: "table", label: t("table"), icon: "table_rows" },
  ];

  return (
    <section className="z-card flex min-w-0 flex-col overflow-hidden rounded-xl" aria-labelledby="sessions-calendar">
      <div className="flex flex-col gap-3 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="sessions-calendar" className="text-headline-sm font-bold text-primary">{title}</h2>
            <p className="text-body-sm text-on-surface-variant">{subtitle}</p>
          </div>
          <Link href={scheduleHref} className="btn btn-soft">
            <Icon name="calendar_month" size={18} />
            <span>{scheduleLabel}</span>
          </Link>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav className="inline-flex rounded-lg border border-outline-variant bg-surface-container-low p-0.5" aria-label={t("views")}>
            {tabs.map((tab) => (
              <Link
                key={tab.key}
                href={href(tab.key === "week" ? {} : tab.key === "month" ? { view: "month", month } : { view: "table" })}
                aria-current={view === tab.key ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-label-md ${view === tab.key ? "bg-surface-container-lowest font-semibold text-primary shadow-sm" : "text-on-surface-variant hover:text-on-surface"}`}
              >
                <Icon name={tab.icon} size={16} />
                {tab.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <span className="text-title-md font-semibold text-on-surface tabular-nums">{period}</span>
            <nav className="flex items-center gap-1" aria-label={t("periodNav")}>
              <Link href={prev} className="rounded-md border border-outline-variant px-2 py-1 text-label-md" aria-label={t("previous")}>
                <Icon name={rtl ? "chevron_right" : "chevron_left"} size={18} />
              </Link>
              <Link href={current} className="rounded-md border border-outline-variant px-2.5 py-1 text-label-md">{t("today")}</Link>
              <Link href={next} className="rounded-md border border-outline-variant px-2 py-1 text-label-md" aria-label={t("next")}>
                <Icon name={rtl ? "chevron_left" : "chevron_right"} size={18} />
              </Link>
            </nav>
          </div>
        </div>
        <p className="text-label-sm text-on-surface-variant">{t("zone", { zone: timeZone })}</p>
      </div>

      {view === "week" && week ? (
        <ol className="grid grid-cols-1 border-t border-outline-variant md:grid-cols-7 md:divide-x md:divide-outline-variant md:rtl:divide-x-reverse">
          {week.days.map((day) => {
            const isToday = day.ymd === today;
            return (
              <li key={day.ymd} className={`flex min-w-0 flex-col gap-2 border-b border-outline-variant p-3 md:min-h-56 md:border-b-0 ${isToday ? "bg-secondary-fixed/15" : ""}`}>
                <h3 className="flex items-baseline gap-1.5">
                  <span className={`text-label-md ${isToday ? "font-semibold text-secondary" : "text-on-surface-variant"}`}>{dayName.format(noon(day.ymd))}</span>
                  <span className={`text-headline-sm font-bold tabular-nums ${isToday ? "text-secondary" : "text-on-surface"}`}>{dayNumber.format(noon(day.ymd))}</span>
                  {isToday ? <span className="sr-only">{t("todayMark")}</span> : null}
                </h3>
                {day.entries.length === 0 ? (
                  <p className="text-label-sm text-on-surface-variant">{t("free")}</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {day.entries.map((entry) => (
                      <li key={entry.id} className={`rounded-md px-2 py-1.5 text-label-sm ${CHIP[entry.status] ?? CHIP.SCHEDULED}`}>
                        <p className="font-semibold tabular-nums">{time.format(entry.scheduledStart)} – {time.format(entry.scheduledEnd)}</p>
                        <p className="font-semibold">{subject(entry)}</p>
                        {show !== "students" ? <p className="truncate opacity-80" title={entry.teacher.user.displayName}>{entry.teacher.user.displayName}</p> : null}
                        {show !== "teacher" ? <p className="truncate opacity-80" title={studentsOf(entry)}>{studentsOf(entry)}</p> : null}
                        {entry.status !== "SCHEDULED" ? <p className="opacity-80">{tStatus(`statuses.${entry.status}`)}</p> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      ) : null}

      {view === "month" && monthDays ? (
        <div className="border-t border-outline-variant">
          <div className="grid grid-cols-7 border-b border-outline-variant bg-surface-container-low" aria-hidden="true">
            {monthDays.slice(0, 7).map((ymd) => (
              <span key={ymd} className="px-2 py-2 text-center text-label-sm font-semibold text-on-surface-variant">{dayName.format(noon(ymd))}</span>
            ))}
          </div>
          <ol className="grid grid-cols-7">
            {monthDays.map((ymd) => {
              const inMonth = ymd.startsWith(month);
              const entries = byDay.get(ymd) ?? [];
              const isToday = ymd === today;
              return (
                <li key={ymd} className={`flex min-h-16 min-w-0 flex-col gap-1 border-b border-e border-outline-variant p-1.5 sm:min-h-28 ${inMonth ? "" : "bg-surface-container-low/60"} ${isToday ? "bg-secondary-fixed/15" : ""}`}>
                  <Link
                    href={href({ week: ymd })}
                    className={`self-start rounded-full px-1.5 text-label-md tabular-nums hover:bg-surface-container-high ${isToday ? "bg-secondary font-bold text-on-secondary" : inMonth ? "text-on-surface" : "text-on-surface-variant/60"}`}
                    aria-label={t("openDay", { date: fullDay.format(noon(ymd)), count: entries.length })}
                  >
                    {dayNumber.format(noon(ymd))}
                  </Link>
                  {entries.length ? (
                    <>
                      <span className="self-start sm:hidden"><span className="badge badge--info tabular-nums">{entries.length}</span></span>
                      <ul className="hidden flex-col gap-1 sm:flex">
                        {entries.slice(0, MONTH_CELL_LIMIT).map((entry) => (
                          <li key={entry.id} className={`truncate rounded px-1.5 py-0.5 text-label-sm ${CHIP[entry.status] ?? CHIP.SCHEDULED}`} title={`${subject(entry)} · ${who(entry)}`}>
                            <span className="tabular-nums">{time.format(entry.scheduledStart)}</span> {subject(entry)}
                          </li>
                        ))}
                      </ul>
                      {entries.length > MONTH_CELL_LIMIT ? (
                        <Link href={href({ week: ymd })} className="hidden text-label-sm text-secondary hover:underline sm:block">{t("more", { count: entries.length - MONTH_CELL_LIMIT })}</Link>
                      ) : null}
                    </>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {view === "table" ? <TableView sessions={sessions} show={show} subject={subject} who={who} time={time} timeZone={timeZone} dateLocale={dateLocale} exportName={exportName} /> : null}

      <ul className="flex flex-wrap gap-3 border-t border-outline-variant px-4 py-3 text-label-sm text-on-surface-variant sm:px-6" aria-label={t("legend")}>
        {(["SCHEDULED", "COMPLETED", "MISSED", "CANCELLED"] as const).map((status) => (
          <li key={status} className="flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded-sm ${CHIP[status]}`} aria-hidden="true" />
            {tStatus(`statuses.${status}`)}
          </li>
        ))}
      </ul>
    </section>
  );
}

async function TableView({
  sessions,
  show,
  subject,
  who,
  time,
  timeZone,
  dateLocale,
  exportName,
}: {
  sessions: CalendarSession[];
  show: "teacher" | "students" | "both";
  subject: (session: CalendarSession) => string;
  who: (session: CalendarSession) => string;
  time: Intl.DateTimeFormat;
  timeZone: string;
  dateLocale: string;
  exportName?: string;
}) {
  const t = await getTranslations("sessionsCalendar");
  const tStatus = await getTranslations("sessions");
  const day = new Intl.DateTimeFormat(dateLocale, { timeZone, weekday: "short", day: "numeric", month: "short" });
  const columns: DataColumn[] = [
    { key: "day", label: t("colDay") },
    { key: "time", label: t("colTime") },
    { key: "subject", label: t("colSubject") },
    { key: "who", label: show === "teacher" ? t("colTeacher") : show === "students" ? t("colStudents") : t("colWho"), sortable: show === "teacher" },
    { key: "type", label: t("colType") },
    { key: "status", label: t("colStatus") },
  ];
  const rows: DataRow[] = sessions.map((session) => ({
    id: session.id,
    filter: session.status,
    cells: {
      day: { text: day.format(session.scheduledStart), sort: session.scheduledStart.toISOString(), strong: true, numeric: true },
      time: { text: `${time.format(session.scheduledStart)} – ${time.format(session.scheduledEnd)}`, sort: session.scheduledStart.toISOString(), numeric: true },
      subject: { text: subject(session) },
      who: { text: who(session) },
      type: { text: tStatus(`types.${session.sessionType}`) },
      status: { text: tStatus(`statuses.${session.status}`), tone: TONE[session.status] ?? "neutral" },
    },
  }));
  return (
    <div className="border-t border-outline-variant pt-3">
      <DataTable
        caption={t("table")}
        columns={columns}
        rows={rows}
        quickFilters={["SCHEDULED", "COMPLETED", "MISSED", "CANCELLED"].map((status) => ({ key: status, label: tStatus(`statuses.${status}`) }))}
        exportName={exportName}
        emptyTitle={t("empty")}
        emptyIcon="event_available"
        initialSort={{ key: "day", direction: "asc" }}
      />
    </div>
  );
}
