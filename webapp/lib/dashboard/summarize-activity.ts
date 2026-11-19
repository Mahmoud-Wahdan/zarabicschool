import type { AttendanceOutcome, SessionStatus } from "../../generated/prisma/client";

type SessionGroup = { status: SessionStatus; _count: number; _sum: { durationMinutes: number | null } };
type ReportGroup = { attendanceOutcome: AttendanceOutcome; _count: number };

export function summarizeActivity(sessions: SessionGroup[], reports: ReportGroup[], expected: number, submitted: number) {
  const completed = sessions.find(row => row.status === "COMPLETED");
  const total = sessions.filter(row => row.status !== "CANCELLED").reduce((sum, row) => sum + row._count, 0);
  const reported = reports.reduce((sum, row) => sum + row._count, 0);
  const attended = reports.find(row => row.attendanceOutcome === "ATTENDED")?._count ?? 0;
  return {
    missing: expected - submitted,
    submission: expected ? submitted / expected : null,
    total, completed: completed?._count ?? 0, missed: sessions.find(row => row.status === "MISSED")?._count ?? 0,
    hours: (completed?._sum.durationMinutes ?? 0) / 60,
    completion: total ? (completed?._count ?? 0) / total : null,
    attendance: reported ? attended / reported : null,
  };
}
