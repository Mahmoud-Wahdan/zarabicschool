"use client";

import { useTranslations } from "next-intl";

import { Link } from "../../../i18n/navigation";
import { utcToWallClockInput, zonedDayRangeUtc } from "../../../lib/schedules/recurrence";

/**
 * Teacher schedule board grid (S-16, D91): one row per teacher (day view) or per day
 * (week view), hours running across, each session placed at its real start/end in the
 * viewer's zone. Logical inset properties, so the grid mirrors in RTL. Below `md` it
 * becomes one card per row with a time-ordered list. Never a Zoom link; a session
 * opens its admin page. The data comes from lib/calendar/board.ts (or its API).
 */
export type BoardGridSession = {
  id: string;
  start: string;
  end: string;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "MISSED";
  type: string;
  studentNames: string[];
  studentCount: number;
  href: string;
  /** The session being entered in the form (outlined, not saved yet). */
  draft?: boolean;
};
export type BoardGridRow = {
  teacherId: string;
  teacherName: string;
  day: string;
  totals: { sessions: number; minutes: number; overThreshold: boolean };
  sessions: BoardGridSession[];
};

const HOUR = 60;
const DEFAULT_FIRST_HOUR = 8;
const DEFAULT_LAST_HOUR = 22;

function minutesFrom(dayStart: Date, iso: string) {
  return (Date.parse(iso) - dayStart.getTime()) / 60_000;
}

export default function BoardGrid({
  rows,
  timeZone,
  locale,
  view,
  thresholdMinutes,
  compact = false,
}: {
  rows: BoardGridRow[];
  timeZone: string;
  locale: string;
  view: "day" | "week";
  thresholdMinutes: number;
  /** The one-row strip under the session form: no totals column, no links. */
  compact?: boolean;
}) {
  const t = useTranslations("scheduleBoard");
  const statusLabel = {
    SCHEDULED: t("status.scheduled"),
    COMPLETED: t("status.completed"),
    CANCELLED: t("status.cancelled"),
    MISSED: t("status.missed"),
  } as const;
  const time = (iso: string) => utcToWallClockInput(new Date(iso), timeZone).slice(11, 16);
  const hours = (minutes: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(minutes / HOUR);
  const dayLabel = (ymd: string) =>
    new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${ymd}T12:00:00Z`));
  const label = (session: BoardGridSession) =>
    session.type === "GROUP" ? t("group", { count: session.studentCount }) : session.studentNames[0] ?? "";

  // Visible window: 08:00–22:00, widened to hold every session (minutes since local midnight).
  const ranges = new Map(rows.map((row) => [row.day, zonedDayRangeUtc(row.day, timeZone)]));
  let first = DEFAULT_FIRST_HOUR * HOUR;
  let last = DEFAULT_LAST_HOUR * HOUR;
  for (const row of rows) {
    const range = ranges.get(row.day)!;
    const length = (range.end.getTime() - range.start.getTime()) / 60_000;
    for (const session of row.sessions) {
      first = Math.min(first, Math.max(0, Math.floor(minutesFrom(range.start, session.start) / HOUR) * HOUR));
      last = Math.max(last, Math.min(length, Math.ceil(minutesFrom(range.start, session.end) / HOUR) * HOUR));
    }
  }
  const span = last - first;
  const tickDay = ranges.get(rows[0]?.day ?? "") ?? null;
  const ticks = tickDay
    ? Array.from({ length: Math.floor(span / HOUR) + 1 }, (_, index) => {
        const offset = first + index * HOUR;
        return { offset, text: time(new Date(tickDay.start.getTime() + offset * 60_000).toISOString()) };
      })
    : [];
  const percent = (value: number) => `${(Math.min(Math.max(value, 0), span) / span) * 100}%`;

  const blockClass = (session: BoardGridSession) =>
    session.draft
      ? "border-2 border-dashed border-primary bg-surface-container-lowest text-on-surface"
      : session.status === "CANCELLED" || session.status === "MISSED"
        ? "border border-dashed border-outline bg-surface-container-high text-on-surface-variant line-through"
        : session.status === "COMPLETED"
          ? "bg-surface-container-high text-on-surface"
          : "bg-secondary-container text-on-secondary-container";

  const rowTitle = (row: BoardGridRow) => (view === "week" ? dayLabel(row.day) : row.teacherName);

  const block = (row: BoardGridRow, session: BoardGridSession) => {
    const range = ranges.get(row.day)!;
    const startOffset = minutesFrom(range.start, session.start) - first;
    const endOffset = minutesFrom(range.start, session.end) - first;
    const content = (
      <>
        <span className="block truncate font-semibold">{label(session)}</span>
        <bdi dir="ltr" className="block truncate">{time(session.start)}–{time(session.end)}</bdi>
      </>
    );
    const title = `${label(session)} · ${time(session.start)}–${time(session.end)} · ${statusLabel[session.status]}${session.type === "GROUP" ? ` · ${session.studentNames.join("، ")}` : ""}`;
    const style = { insetInlineStart: percent(startOffset), width: `calc(${percent(endOffset)} - ${percent(startOffset)})` };
    const className = `absolute inset-y-1 overflow-hidden rounded-md px-1.5 py-0.5 text-label-sm leading-tight ${blockClass(session)}`;
    return compact || session.draft ? (
      <div key={session.id} className={className} style={style} title={title}>
        {content}
      </div>
    ) : (
      <Link key={session.id} href={session.href} prefetch={false} className={`${className} hover:ring-2 hover:ring-primary`} style={style} title={title}>
        {content}
      </Link>
    );
  };

  return (
    <div className="space-y-3">
      {/* Wide screens: the timeline grid. */}
      <div className="hidden overflow-x-auto md:block">
        <div className="min-w-[720px]">
          <div className={`grid gap-2 ${compact ? "grid-cols-[minmax(0,1fr)]" : "grid-cols-[10rem_minmax(0,1fr)_7rem]"}`}>
            {compact ? null : <div className="text-label-sm text-on-surface-variant">{view === "week" ? t("columns.day") : t("columns.teacher")}</div>}
            <div className="relative h-5 text-label-sm text-on-surface-variant" aria-hidden="true">
              {ticks.map((tick) => (
                <span key={tick.offset} className="absolute -translate-x-1/2 rtl:translate-x-1/2" style={{ insetInlineStart: percent(tick.offset - first) }}>
                  <bdi dir="ltr">{tick.text}</bdi>
                </span>
              ))}
            </div>
            {compact ? null : <div className="text-label-sm text-on-surface-variant">{t("columns.totals")}</div>}
            {rows.map((row) => (
              <div key={`${row.teacherId}-${row.day}`} className="contents">
                {compact ? null : (
                  <div className="flex items-center gap-1 truncate text-body-sm font-semibold text-on-surface">
                    {rowTitle(row)}
                    {row.totals.overThreshold ? (
                      <span className="rounded-full bg-error-container px-1.5 text-label-sm text-on-error-container" title={t("overThreshold", { hours: hours(thresholdMinutes) })}>
                        !
                      </span>
                    ) : null}
                  </div>
                )}
                <div className="relative h-14 rounded-md bg-surface-container-lowest outline outline-1 outline-outline-variant">
                  {ticks.map((tick) => (
                    <span key={tick.offset} className="absolute inset-y-0 w-px bg-outline-variant" style={{ insetInlineStart: percent(tick.offset - first) }} aria-hidden="true" />
                  ))}
                  {row.sessions.map((session) => block(row, session))}
                </div>
                {compact ? null : (
                  <div className={`rounded-md px-2 py-1 text-label-sm ${row.totals.overThreshold ? "bg-error-container text-on-error-container" : "text-on-surface-variant"}`}>
                    {t("totals", { sessions: row.totals.sessions, hours: hours(row.totals.minutes) })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Phones: one card per row, sessions in time order. */}
      <ul className="space-y-2 md:hidden">
        {rows.map((row) => (
          <li key={`${row.teacherId}-${row.day}-card`} className="z-card rounded-xl p-3">
            {compact ? null : (
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-semibold text-on-surface">{rowTitle(row)}</span>
                <span className={`rounded-md px-2 py-0.5 text-label-sm ${row.totals.overThreshold ? "bg-error-container text-on-error-container" : "text-on-surface-variant"}`}>
                  {t("totals", { sessions: row.totals.sessions, hours: hours(row.totals.minutes) })}
                </span>
              </div>
            )}
            {row.sessions.length === 0 ? (
              <p className="text-body-sm text-on-surface-variant">{t("free")}</p>
            ) : (
              <ul className="space-y-1">
                {row.sessions.map((session) => (
                  <li key={session.id} className={`rounded-md px-2 py-1 text-body-sm ${blockClass(session)}`}>
                    <bdi dir="ltr">{time(session.start)}–{time(session.end)}</bdi> · {label(session)} · {statusLabel[session.status]}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
