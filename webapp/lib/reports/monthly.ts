import "server-only";

import type { Prisma } from "../../generated/prisma/client";

import { prisma } from "../prisma";
import { monthKeyRangeUtc } from "./month-key";
import { resolveReportLanguage, type ReportLanguageCode } from "./report-language";

/** PROPOSAL (owner, 2026-10-18 — CONTEXT §9): the teacher may edit a monthly report for 7 days after submission, then it locks. */
export const MONTHLY_REPORT_EDIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type Viewer = {
  userId: string;
  academyId: string;
  role: "ADMIN" | "SUPERVISOR" | "TEACHER" | "STUDENT" | "GUARDIAN";
};

export type MonthlyReportView = {
  id: string;
  studentId: string;
  teacherId: string;
  monthKey: string;
  achievement: string | null;
  learningProgress: string | null;
  classFocus: string | null;
  homeworkCompletion: string | null;
  punctuality: string | null;
  rescheduledSessions: number;
  supportAreas: string | null;
  // Field-level visibility (PROPOSAL, owner 2026-10-18 — CONTEXT §9): a student WITH
  // a guardian sees ONLY this field; the guardian, the assigned teacher, an adult
  // student without a guardian, and Admin/Supervisor see the whole report.
  nextMonthObjectives: string | null;
  language: ReportLanguageCode;
  submittedAt: Date;
  submittedByViewerTeacher: boolean;
  editable: boolean;
};

const MONTHLY_REPORT_SELECT = {
  id: true,
  studentId: true,
  teacherId: true,
  monthKey: true,
  achievement: true,
  learningProgress: true,
  classFocus: true,
  homeworkCompletion: true,
  punctuality: true,
  rescheduledSessions: true,
  supportAreas: true,
  nextMonthObjectives: true,
  language: true,
  submittedAt: true,
  student: { select: { userId: true, guardianId: true, isAdult: true } },
  teacher: { select: { userId: true } },
} satisfies Prisma.MonthlyReportSelect;

type MonthlyReportRow = {
  id: string;
  studentId: string;
  teacherId: string;
  monthKey: string;
  achievement: string;
  learningProgress: string;
  classFocus: string;
  homeworkCompletion: string;
  punctuality: string;
  rescheduledSessions: number;
  supportAreas: string | null;
  nextMonthObjectives: string | null;
  language: string;
  submittedAt: Date;
  student: { userId: string; guardianId: string | null; isAdult: boolean };
  teacher: { userId: string };
};

export function isMonthlyReportEditable(submittedAt: Date, now = new Date()): boolean {
  return now.getTime() - submittedAt.getTime() <= MONTHLY_REPORT_EDIT_WINDOW_MS;
}

/**
 * "Sessions rescheduled in the month" (CONTEXT §9): computed from real data — the
 * student's sessions in that month that ARE replacement sessions (created when an
 * outage/absence request was approved; replacements only exist through that flow).
 * Stored pre-filled and read-only for the teacher.
 */
export async function computeRescheduledSessions(teacherId: string, studentId: string, monthKey: string): Promise<number> {
  const { start, end } = monthKeyRangeUtc(monthKey);
  const rows = await prisma.sessionStudent.findMany({
    where: {
      studentId,
      session: {
        teacherId,
        replacementForSessionId: { not: null },
        status: { notIn: ["CANCELLED", "MISSED"] },
        scheduledStart: { gte: start, lt: end },
      },
    },
    select: { sessionId: true },
    distinct: ["sessionId"],
  });
  return rows.length;
}

/**
 * Eligible (teacher, student) pairs for a monthly report: students on at least one
 * of the teacher's non-cancelled sessions in that month (the same pair set the
 * worker's missing-report reminders use).
 */
export async function eligibleMonthlyStudents(
  teacherId: string,
  monthKey: string,
): Promise<{ studentId: string; displayName: string; reportLanguage: ReportLanguageCode }[]> {
  const { start, end } = monthKeyRangeUtc(monthKey);
  const rows = await prisma.sessionStudent.findMany({
    where: {
      session: {
        teacherId,
        status: { notIn: ["CANCELLED", "MISSED"] },
        scheduledStart: { gte: start, lt: end },
      },
    },
    select: {
      student: {
        select: { id: true, reportLanguage: true, user: { select: { displayName: true } } },
      },
    },
    distinct: ["studentId"],
  });
  return rows.map((row) => ({
    studentId: row.student.id,
    displayName: row.student.user.displayName,
    reportLanguage: resolveReportLanguage(row.student.reportLanguage),
  }));
}

function toView(row: MonthlyReportRow, viewer: Viewer, full: boolean, now: Date): MonthlyReportView {
  const ownTeacher = row.teacher.userId === viewer.userId;
  return {
    id: row.id,
    studentId: row.studentId,
    teacherId: row.teacherId,
    monthKey: row.monthKey,
    achievement: full ? row.achievement : null,
    learningProgress: full ? row.learningProgress : null,
    classFocus: full ? row.classFocus : null,
    homeworkCompletion: full ? row.homeworkCompletion : null,
    punctuality: full ? row.punctuality : null,
    rescheduledSessions: full ? row.rescheduledSessions : 0,
    supportAreas: full ? row.supportAreas : null,
    // Field-level visibility (PROPOSAL, owner 2026-10-18 — CONTEXT §9): a student
    // WITH a guardian sees ONLY this field; everyone else allowed sees the whole report.
    nextMonthObjectives: row.nextMonthObjectives,
    language: resolveReportLanguage(row.language),
    submittedAt: row.submittedAt,
    submittedByViewerTeacher: ownTeacher && viewer.role === "TEACHER",
    editable: ownTeacher && viewer.role === "TEACHER" && isMonthlyReportEditable(row.submittedAt, now),
  };
}

/**
 * Single server-side entry point for reading one monthly report as a specific
 * viewer (same pattern as lib/reports/visibility.ts): null for missing OR
 * unauthorized, so callers answer with a generic 404 (no existence leak).
 * Teachers never see other teachers' reports.
 */
export async function getMonthlyReportForViewer(
  viewer: Viewer,
  studentId: string,
  monthKey: string,
): Promise<MonthlyReportView | null> {
  const row = (await prisma.monthlyReport.findFirst({
    where: { studentId, monthKey, academyId: viewer.academyId },
    select: MONTHLY_REPORT_SELECT,
  })) as MonthlyReportRow | null;
  if (!row) return null;

  const now = new Date();
  if (viewer.role === "ADMIN" || viewer.role === "SUPERVISOR") {
    return toView(row, viewer, true, now);
  }
  if (viewer.role === "TEACHER") {
    if (row.teacher.userId !== viewer.userId) return null;
    return toView(row, viewer, true, now);
  }
  if (viewer.role === "STUDENT") {
    if (row.student.userId !== viewer.userId) return null;
    // A student WITH a guardian sees ONLY the next-month objectives (PROPOSAL);
    // an adult student without a guardian sees the whole report (CONTEXT §9).
    return toView(row, viewer, row.student.guardianId === null, now);
  }
  // GUARDIAN — must be the linked guardian of this student; sees the whole report.
  if (row.student.guardianId === null) return null;
  const linked = await prisma.guardian.findFirst({
    where: { userId: viewer.userId, id: row.student.guardianId },
    select: { id: true },
  });
  if (!linked) return null;
  return toView(row, viewer, true, now);
}
