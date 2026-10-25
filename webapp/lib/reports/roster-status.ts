import "server-only";

import { prisma } from "../prisma";

export type RosterReportStatus = {
  status: "SUBMITTED" | "REJECTED" | "APPROVED" | "ARCHIVED";
  rejectionReason: string | null;
};

export function rosterKey(sessionId: string, studentId: string) {
  return `${sessionId}:${studentId}`;
}

/**
 * The calling teacher's OWN session-report status per (session, student), for the
 * roster buttons on the teacher's session lists. Scoped to the teacher's user id —
 * a teacher never reads another teacher's reports (CONTEXT §9).
 */
export async function getTeacherRosterReportStatuses(
  teacherUserId: string,
  academyId: string,
  sessionIds: string[],
): Promise<Map<string, RosterReportStatus>> {
  if (sessionIds.length === 0) return new Map();
  const reports = await prisma.report.findMany({
    where: {
      academyId,
      sessionId: { in: sessionIds },
      reportType: "SESSION_COMPLETION_REPORT",
      teacher: { userId: teacherUserId },
    },
    select: { sessionId: true, studentId: true, status: true, rejectionReason: true },
  });
  return new Map(
    reports.map((report) => [
      rosterKey(report.sessionId, report.studentId),
      { status: report.status, rejectionReason: report.rejectionReason },
    ]),
  );
}
