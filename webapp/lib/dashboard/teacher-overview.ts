import "server-only";

import { prisma } from "../prisma";
import { zonedDayRangeUtc, zonedYmd } from "../schedules/recurrence";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back a missing report is still listed on the home page (the sessions page lists all). */
const REPORT_LOOKBACK_DAYS = 30;

const sessionSelect = {
  id: true,
  scheduledStart: true,
  scheduledEnd: true,
  status: true,
  sessionType: true,
  subject: { select: { nameAr: true, nameEn: true } },
  students: { select: { studentId: true, student: { select: { user: { select: { displayName: true } } } } } },
} as const;

/**
 * Teacher home (owner, 2026-10-31): the next session with its join button, the reports
 * still to write and the week's sessions. Scoped to this teacher only.
 */
export async function getTeacherNextSession(teacherId: string, now: Date) {
  return prisma.session.findFirst({
    where: { teacherId, status: "SCHEDULED", scheduledEnd: { gt: now } },
    orderBy: { scheduledStart: "asc" },
    select: sessionSelect,
  });
}

export async function getTeacherWeekSessions(teacherId: string, now: Date, timeZone: string) {
  const start = zonedDayRangeUtc(zonedYmd(now, timeZone), timeZone).start;
  return prisma.session.findMany({
    where: { teacherId, scheduledStart: { gte: start, lt: new Date(start.getTime() + 7 * DAY_MS) } },
    orderBy: { scheduledStart: "asc" },
    select: sessionSelect,
  });
}

export type ReportToWrite = {
  sessionId: string;
  studentId: string;
  studentName: string;
  subject: { nameAr: string; nameEn: string };
  scheduledStart: Date;
  state: "missing" | "rejected";
  rejectionReason: string | null;
};

/** Ended sessions (not cancelled or missed) with no report for a roster student, or a rejected one. */
export async function getTeacherReportsToWrite(teacherId: string, now: Date): Promise<ReportToWrite[]> {
  const sessions = await prisma.session.findMany({
    where: {
      teacherId,
      status: { in: ["SCHEDULED", "COMPLETED"] },
      scheduledEnd: { lte: now, gte: new Date(now.getTime() - REPORT_LOOKBACK_DAYS * DAY_MS) },
    },
    orderBy: { scheduledStart: "desc" },
    select: {
      ...sessionSelect,
      reports: {
        where: { teacherId, reportType: "SESSION_COMPLETION_REPORT" },
        select: { studentId: true, status: true, rejectionReason: true },
      },
    },
  });
  const items: ReportToWrite[] = [];
  for (const session of sessions) {
    const byStudent = new Map(session.reports.map((report) => [report.studentId, report]));
    for (const row of session.students) {
      const report = byStudent.get(row.studentId);
      if (report && report.status !== "REJECTED") continue;
      items.push({
        sessionId: session.id,
        studentId: row.studentId,
        studentName: row.student.user.displayName,
        subject: session.subject,
        scheduledStart: session.scheduledStart,
        state: report ? "rejected" : "missing",
        rejectionReason: report?.rejectionReason ?? null,
      });
    }
  }
  // Rejected first (they were already written once and need a fix), then oldest first.
  return items.sort((a, b) => (a.state === b.state ? a.scheduledStart.getTime() - b.scheduledStart.getTime() : a.state === "rejected" ? -1 : 1));
}
