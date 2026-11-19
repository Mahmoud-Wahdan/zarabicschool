import "server-only";

import type { Prisma } from "../../generated/prisma/client";
import type { AuthUser } from "../dal";
import { summarizeActivity } from "./summarize-activity";
import { prisma } from "../prisma";
import { monthRangeUtc } from "../performance/teacher-indicators";
import { previousMonthKey } from "../reports/month-key";

/** Count last month's reported attendees who also attended during the selected month. */
export async function getReturningLearners(user: AuthUser, month: string) {
  if (user.role !== "ADMIN") return null;
  const attendance = (key: string) => {
    const { start, end } = monthRangeUtc(key, user.timezone || "Africa/Cairo");
    return { reports: { some: { academyId: user.academyId, attendanceOutcome: "ATTENDED" as const,
      session: { scheduledStart: { gte: start, lt: end } } } } };
  };
  const cohort = { academyId: user.academyId, ...attendance(previousMonthKey(month)) };
  const [prior, returning] = await prisma.$transaction([
    prisma.student.count({ where: cohort }),
    prisma.student.count({ where: { AND: [cohort, attendance(month)] } }),
  ], { isolationLevel: "RepeatableRead" });
  return { prior, returning };
}

/** Each bucket is a whole calendar month in the viewer's timezone, by lesson start. */
export async function getActivity(user: AuthUser, month: string, now: Date, childId?: string) {
  const zone = user.timezone || "Africa/Cairo";
  const range = monthRangeUtc(month, zone);
  const scheduledStart = { gte: range.start, lt: range.end };
  if (user.role === "GUARDIAN" && !childId) return null;
  const learner = user.role === "STUDENT" ? { userId: user.id }
    : user.role === "GUARDIAN" ? { id: childId, guardian: { userId: user.id } } : undefined;
  const session = {
    academyId: user.academyId, scheduledStart,
    ...(user.role === "TEACHER" && { teacher: { userId: user.id } }),
    ...(learner && { students: { some: { student: learner } } }),
  };
  const staff = user.role === "ADMIN" || user.role === "SUPERVISOR";
  const ended: Prisma.SessionWhereInput = { ...session, status: { in: ["SCHEDULED", "COMPLETED"] }, scheduledEnd: { lte: now } };
  const [sessions, reports, [expected, submitted]] = await Promise.all([
    prisma.session.groupBy({ by: ["status"], where: session, _count: true, _sum: { durationMinutes: true } }),
    prisma.report.groupBy({
      by: ["attendanceOutcome"],
      where: { academyId: user.academyId, reportType: "SESSION_COMPLETION_REPORT", session, student: learner,
        ...(user.role === "TEACHER" && { teacher: { userId: user.id } }) },
      _count: true,
    }),
    staff ? prisma.$transaction([
      prisma.sessionStudent.count({ where: { session: ended } }),
      prisma.report.count({ where: { academyId: user.academyId, session: ended, reportType: "SESSION_COMPLETION_REPORT" } }),
    ], { isolationLevel: "RepeatableRead" }) : [0, 0],
  ]);
  return summarizeActivity(sessions, reports, expected, submitted);
}
