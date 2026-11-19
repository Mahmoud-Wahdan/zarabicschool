import "server-only";

import { getTodaySessions } from "./today-sessions";
import { zonedDayRangeUtc, zonedYmd } from "../schedules/recurrence";
import { prisma } from "../prisma";
import { daysRangeUtc, monthGrid, type CalendarView } from "../calendar/month";
import { buildWeek, parseWeekParam } from "../calendar/week";

/** Whose sessions a dashboard calendar shows: the academy (Admin/Supervisor), one teacher or one student. */
export type CalendarScope = { academyId: string } | { teacherId: string } | { studentId: string };

function scopeWhere(scope: CalendarScope) {
  if ("academyId" in scope) return { academyId: scope.academyId };
  if ("teacherId" in scope) return { teacherId: scope.teacherId };
  return { students: { some: { studentId: scope.studentId } } };
}

/**
 * The visible period of a dashboard calendar (owner, 2026-10-31): the week of `week`
 * (week and table views) or the whole grid of `month`, in the viewer's zone.
 */
export function calendarPeriod(view: CalendarView, params: { week?: string; month: string }, now: Date, timeZone: string) {
  if (view === "month") {
    const grid = monthGrid(params.month);
    return { weekStart: null, grid, range: daysRangeUtc(grid.days, timeZone) };
  }
  const weekStart = parseWeekParam(params.week, now, timeZone);
  return { weekStart, grid: null, range: buildWeek([], weekStart, timeZone).range };
}

export async function getCalendarRangeSessions(scope: CalendarScope, range: { start: Date; end: Date }) {
  return prisma.session.findMany({
    where: { ...scopeWhere(scope), scheduledStart: { gte: range.start, lt: range.end } },
    orderBy: { scheduledStart: "asc" },
    select: {
      id: true,
      scheduledStart: true,
      scheduledEnd: true,
      status: true,
      sessionType: true,
      subject: { select: { nameAr: true, nameEn: true } },
      teacher: { select: { user: { select: { displayName: true } } } },
      students: { ...("studentId" in scope && { where: { studentId: scope.studentId } }), select: { student: { select: { user: { select: { displayName: true } } } } } },
    },
  });
}

/** The visible calendar usually contains today. Reuse its rows for the daily summary. */
export async function getOperationsCalendar(academyId: string, range: { start: Date; end: Date }, now: Date, zone: string) {
  const day = zonedDayRangeUtc(zonedYmd(now, zone), zone);
  const calendar = getCalendarRangeSessions({ academyId }, range);
  const today = range.start <= day.start && day.end <= range.end
    ? calendar.then(rows => rows.filter(row => row.scheduledStart >= day.start && row.scheduledStart < day.end))
    : getTodaySessions(academyId, now, zone).then(result => result.sessions);
  const [sessions, todaySessions] = await Promise.all([calendar, today]);
  return { sessions, todaySessions };
}
