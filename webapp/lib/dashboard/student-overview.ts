import "server-only";

import { prisma } from "../prisma";
import { zonedDayRangeUtc, zonedYmd } from "../schedules/recurrence";

const DAY_MS = 24 * 60 * 60 * 1000;

const sessionSelect = {
  id: true,
  scheduledStart: true,
  scheduledEnd: true,
  status: true,
  sessionType: true,
  subject: { select: { nameAr: true, nameEn: true } },
  teacher: { select: { user: { select: { displayName: true } } } },
} as const;

/**
 * Student home (owner, 2026-10-31): the next session with its join button, the
 * homework and notes of the latest submitted session report, and the week's sessions.
 * The student's own sessions and reports only; nothing about money or credit.
 */
export async function getStudentNextSession(studentId: string, now: Date) {
  return prisma.session.findFirst({
    where: { status: "SCHEDULED", scheduledEnd: { gt: now }, students: { some: { studentId } } },
    orderBy: { scheduledStart: "asc" },
    select: sessionSelect,
  });
}

export async function getStudentWeekSessions(studentId: string, now: Date, timeZone: string) {
  const start = zonedDayRangeUtc(zonedYmd(now, timeZone), timeZone).start;
  return prisma.session.findMany({
    where: { students: { some: { studentId } }, scheduledStart: { gte: start, lt: new Date(start.getTime() + 7 * DAY_MS) } },
    orderBy: { scheduledStart: "asc" },
    select: sessionSelect,
  });
}

/**
 * Submit-time visibility (CONTEXT §9, owner 2026-10-18): homework and notes are the
 * student's from the moment the teacher submits, in every status (REJECTED included).
 */
export async function getStudentLatestHomework(studentId: string) {
  return prisma.report.findFirst({
    where: { studentId, reportType: "SESSION_COMPLETION_REPORT" },
    orderBy: { submittedAt: "desc" },
    select: {
      homework: true,
      notes: true,
      sessionId: true,
      session: { select: { scheduledStart: true, subject: { select: { nameAr: true, nameEn: true } }, teacher: { select: { user: { select: { displayName: true } } } } } },
    },
  });
}
