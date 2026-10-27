import "server-only";

import { prisma } from "../prisma";
import { zonedDayRangeUtc, zonedYmd } from "../schedules/recurrence";

/**
 * Teacher performance indicators (S-11 / D7, owner 2026-10-27), per calendar month
 * in the viewer's zone. Indicators, not a verdict — no combined score:
 * - late start: the teacher's FIRST platform join click is later than start + 5 min;
 *   a session with no teacher click is counted apart ("no click"), never guessed;
 * - report on time: the FIRST submission (`created_at`; `submitted_at` moves on a
 *   corrected resubmission) is at most 15 min after the scheduled end; one report
 *   is expected per roster student;
 * - monthly reports submitted for the month.
 * Only ended, held sessions count (not CANCELLED/MISSED). Every number comes with
 * its underlying rows (start, first click, first submissions).
 */
export const LATE_START_GRACE_MINUTES = 5;
export const REPORT_ON_TIME_MINUTES = 15;
const MINUTE = 60_000;

export type IndicatorSession = {
  id: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  firstClickAt: Date | null;
  rosterCount: number;
  reportFirstSubmittedAt: Date[];
};

export function computeIndicators(input: { sessions: IndicatorSession[]; monthlyReportsSubmitted: number }) {
  const details = input.sessions.map((session) => {
    const lateStart = session.firstClickAt !== null && session.firstClickAt.getTime() > session.scheduledStart.getTime() + LATE_START_GRACE_MINUTES * MINUTE;
    const deadline = session.scheduledEnd.getTime() + REPORT_ON_TIME_MINUTES * MINUTE;
    const onTime = session.reportFirstSubmittedAt.filter((at) => at.getTime() <= deadline).length;
    const submitted = Math.min(session.reportFirstSubmittedAt.length, session.rosterCount);
    return {
      ...session,
      lateStart,
      reportsOnTime: Math.min(onTime, session.rosterCount),
      reportsLate: submitted - Math.min(onTime, session.rosterCount),
      reportsMissing: session.rosterCount - submitted,
    };
  });
  const sum = (pick: (detail: (typeof details)[number]) => number) => details.reduce((total, detail) => total + pick(detail), 0);
  return {
    sessionsHeld: details.length,
    lateStarts: details.filter((detail) => detail.lateStart).length,
    noClick: details.filter((detail) => detail.firstClickAt === null).length,
    reportsExpected: sum((detail) => detail.rosterCount),
    reportsOnTime: sum((detail) => detail.reportsOnTime),
    reportsLate: sum((detail) => detail.reportsLate),
    reportsMissing: sum((detail) => detail.reportsMissing),
    monthlyReportsSubmitted: input.monthlyReportsSubmitted,
    details,
  };
}

/** `YYYY-MM` → [start, end) of that calendar month in `timeZone`. */
export function monthRangeUtc(monthKey: string, timeZone: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  return { start: zonedDayRangeUtc(`${monthKey}-01`, timeZone).start, end: zonedDayRangeUtc(`${next}-01`, timeZone).start };
}

export function parseMonthParam(value: string | undefined, now: Date, timeZone: string): string {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value;
  return zonedYmd(now, timeZone).slice(0, 7);
}

async function indicatorsFor(academyId: string, teacherIds: string[], monthKey: string, timeZone: string, now: Date) {
  const range = monthRangeUtc(monthKey, timeZone);
  const sessions = await prisma.session.findMany({
    where: {
      academyId,
      teacherId: { in: teacherIds },
      status: { notIn: ["CANCELLED", "MISSED"] },
      scheduledStart: { gte: range.start, lt: range.end },
      scheduledEnd: { lte: now },
    },
    orderBy: { scheduledStart: "asc" },
    select: {
      id: true,
      teacherId: true,
      scheduledStart: true,
      scheduledEnd: true,
      teacher: { select: { userId: true } },
      _count: { select: { students: true } },
      reports: { where: { reportType: "SESSION_COMPLETION_REPORT" }, select: { createdAt: true } },
    },
  });
  const clicks = sessions.length
    ? await prisma.sessionJoinClick.groupBy({
        by: ["sessionId", "userId"],
        where: { sessionId: { in: sessions.map((session) => session.id) } },
        _min: { clickedAt: true },
      })
    : [];
  const firstClick = new Map(clicks.map((click) => [`${click.sessionId}:${click.userId}`, click._min.clickedAt]));
  const monthly = await prisma.monthlyReport.groupBy({
    by: ["teacherId"],
    where: { academyId, teacherId: { in: teacherIds }, monthKey },
    _count: { _all: true },
  });
  const monthlyByTeacher = new Map(monthly.map((entry) => [entry.teacherId, entry._count._all]));
  return new Map(
    teacherIds.map((teacherId) => [
      teacherId,
      computeIndicators({
        sessions: sessions
          .filter((session) => session.teacherId === teacherId)
          .map((session) => ({
            id: session.id,
            scheduledStart: session.scheduledStart,
            scheduledEnd: session.scheduledEnd,
            firstClickAt: firstClick.get(`${session.id}:${session.teacher.userId}`) ?? null,
            rosterCount: session._count.students,
            reportFirstSubmittedAt: session.reports.map((report) => report.createdAt),
          })),
        monthlyReportsSubmitted: monthlyByTeacher.get(teacherId) ?? 0,
      }),
    ]),
  );
}

export async function getTeacherIndicators(academyId: string, teacherId: string, monthKey: string, timeZone: string, now = new Date()) {
  return (await indicatorsFor(academyId, [teacherId], monthKey, timeZone, now)).get(teacherId)!;
}

/** Admin view: every active teacher of the academy (D7 — the Admin sees everything). */
export async function getAcademyIndicators(academyId: string, monthKey: string, timeZone: string, now = new Date()) {
  const teachers = await prisma.teacher.findMany({
    where: { academyId, user: { isActive: true } },
    orderBy: { user: { displayName: "asc" } },
    select: { id: true, user: { select: { displayName: true } } },
  });
  const byTeacher = await indicatorsFor(academyId, teachers.map((teacher) => teacher.id), monthKey, timeZone, now);
  return teachers.map((teacher) => ({ teacherId: teacher.id, displayName: teacher.user.displayName, ...byTeacher.get(teacher.id)! }));
}
