import "server-only";

import { prisma } from "../prisma";
import { parseMonthParam, shiftMonth } from "../calendar/month";
import { parseWeekParam, shiftWeek } from "../calendar/week";
import { zonedDayRangeUtc, zonedYmd } from "../schedules/recurrence";

/**
 * Academy analytics (owner, 2026-10-31: "focus on analysis, add more charts").
 * Computed from existing rows only — no money here (revenue stays Admin-only in its
 * own chart). Every bucket is in the viewer's zone; weeks start on Saturday.
 */
export const ANALYTICS_WEEKS = 12;
export const ANALYTICS_MONTHS = 6;
const HOUR_MS = 60 * 60 * 1000;

export type WeekBucket = { weekStart: string; completed: number; missed: number; scheduled: number; cancelled: number; attended: number; reported: number };

function monthStartUtc(month: string, timeZone: string) {
  return zonedDayRangeUtc(`${month}-01`, timeZone).start;
}

export async function getAcademyAnalytics(academyId: string, now: Date, timeZone: string) {
  const currentWeek = parseWeekParam(undefined, now, timeZone);
  const weeks = Array.from({ length: ANALYTICS_WEEKS }, (_, index) => shiftWeek(currentWeek, index - (ANALYTICS_WEEKS - 1)));
  const rangeStart = zonedDayRangeUtc(weeks[0], timeZone).start;
  const rangeEnd = zonedDayRangeUtc(shiftWeek(currentWeek, 1), timeZone).start;
  const month = parseMonthParam(undefined, now, timeZone);
  const monthStart = monthStartUtc(month, timeZone);
  const monthEnd = monthStartUtc(shiftMonth(month, 1), timeZone);
  const months = Array.from({ length: ANALYTICS_MONTHS }, (_, index) => shiftMonth(month, index - (ANALYTICS_MONTHS - 1)));
  const firstMonthStart = monthStartUtc(months[0], timeZone);
  const sessionsFrom = monthStart < rangeStart ? monthStart : rangeStart;

  const [sessions, reports, students] = await Promise.all([
    prisma.session.findMany({
      where: { academyId, scheduledStart: { gte: sessionsFrom, lt: monthEnd > rangeEnd ? monthEnd : rangeEnd } },
      select: {
        scheduledStart: true,
        scheduledEnd: true,
        status: true,
        teacherId: true,
        subjectId: true,
        teacher: { select: { user: { select: { displayName: true } } } },
        subject: { select: { nameAr: true, nameEn: true } },
      },
    }),
    prisma.report.findMany({
      where: { academyId, reportType: "SESSION_COMPLETION_REPORT", session: { scheduledStart: { gte: rangeStart, lt: rangeEnd } } },
      select: { attendanceOutcome: true, session: { select: { scheduledStart: true } } },
    }),
    prisma.student.findMany({
      where: { academyId, OR: [{ enrollmentDate: { gte: firstMonthStart, lt: monthEnd } }, { enrollmentDate: null, createdAt: { gte: firstMonthStart, lt: monthEnd } }] },
      select: { enrollmentDate: true, createdAt: true },
    }),
  ]);

  const weekOf = (instant: Date) => parseWeekParam(zonedYmd(instant, timeZone), now, timeZone);
  const byWeek = new Map<string, WeekBucket>(weeks.map((weekStart) => [weekStart, { weekStart, completed: 0, missed: 0, scheduled: 0, cancelled: 0, attended: 0, reported: 0 }]));
  for (const session of sessions) {
    if (session.scheduledStart < rangeStart || session.scheduledStart >= rangeEnd) continue;
    const bucket = byWeek.get(weekOf(session.scheduledStart));
    if (!bucket) continue;
    if (session.status === "COMPLETED") bucket.completed += 1;
    else if (session.status === "MISSED") bucket.missed += 1;
    else if (session.status === "CANCELLED") bucket.cancelled += 1;
    else bucket.scheduled += 1;
  }
  for (const report of reports) {
    const bucket = byWeek.get(weekOf(report.session.scheduledStart));
    if (!bucket) continue;
    bucket.reported += 1;
    if (report.attendanceOutcome === "ATTENDED") bucket.attended += 1;
  }

  // This month: hours actually taught (completed sessions) per teacher, and sessions per subject.
  const inMonth = sessions.filter((session) => session.scheduledStart >= monthStart && session.scheduledStart < monthEnd);
  const teacherHours = new Map<string, { name: string; hours: number }>();
  for (const session of inMonth.filter((row) => row.status === "COMPLETED")) {
    const entry = teacherHours.get(session.teacherId) ?? { name: session.teacher.user.displayName, hours: 0 };
    entry.hours += (session.scheduledEnd.getTime() - session.scheduledStart.getTime()) / HOUR_MS;
    teacherHours.set(session.teacherId, entry);
  }
  const subjectSessions = new Map<string, { nameAr: string; nameEn: string; count: number }>();
  for (const session of inMonth.filter((row) => row.status !== "CANCELLED")) {
    const entry = subjectSessions.get(session.subjectId) ?? { ...session.subject, count: 0 };
    entry.count += 1;
    subjectSessions.set(session.subjectId, entry);
  }

  const newStudents = new Map(months.map((key) => [key, 0]));
  for (const student of students) {
    const key = student.enrollmentDate ? student.enrollmentDate.toISOString().slice(0, 7) : zonedYmd(student.createdAt, timeZone).slice(0, 7);
    if (newStudents.has(key)) newStudents.set(key, (newStudents.get(key) ?? 0) + 1);
  }

  const monthReports = reports.filter((report) => report.session.scheduledStart >= monthStart && report.session.scheduledStart < monthEnd);
  return {
    month,
    weeks: [...byWeek.values()],
    teacherHours: [...teacherHours.values()].sort((a, b) => b.hours - a.hours),
    subjectSessions: [...subjectSessions.values()].sort((a, b) => b.count - a.count),
    newStudents: months.map((key) => ({ month: key, count: newStudents.get(key) ?? 0 })),
    summary: {
      completed: inMonth.filter((row) => row.status === "COMPLETED").length,
      missed: inMonth.filter((row) => row.status === "MISSED").length,
      hours: [...teacherHours.values()].reduce((total, entry) => total + entry.hours, 0),
      attendanceRate: monthReports.length ? monthReports.filter((row) => row.attendanceOutcome === "ATTENDED").length / monthReports.length : null,
      newStudents: newStudents.get(month) ?? 0,
    },
  };
}
