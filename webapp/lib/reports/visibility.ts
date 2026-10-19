import "server-only";

import type { AttendanceOutcome, ExtraTimeStatus, ReportStatus } from "../../generated/prisma/client";

import { prisma } from "../prisma";
import { resolveReportLanguage, type ReportLanguageCode } from "./report-language";
import { isSession1ReportsReady } from "./session1-ready";
import { isAttachmentsReady } from "../storage/attachment-ready";

export type Viewer = {
  userId: string;
  academyId: string;
  role: "ADMIN" | "SUPERVISOR" | "TEACHER" | "STUDENT" | "GUARDIAN";
};

export type ReportAttachmentMeta = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
};

export type ReportView = {
  id: string;
  sessionId: string;
  studentId: string;
  teacherId: string;
  status: ReportStatus;
  attendanceOutcome: AttendanceOutcome;
  submittedAt: Date;
  approvedAt: Date | null;
  rejectionReason: string | null;
  // Field-level visibility (CONTEXT §9, owner decisions 2026-10-14 + 2026-10-18): a
  // student WITH a guardian sees ONLY homework/notes/attachments; an adult student
  // without a guardian, the guardian, the assigned teacher, and Admin/Supervisor see
  // the full report. Money-affecting fields (extra time) are teacher/ops-only; none
  // of these are amounts.
  classRemark: string | null;
  summary: string | null;
  homework: string | null;
  notes: string | null;
  operationalEvents: unknown;
  extraTimeMinutes: number | null;
  extraTimeStatus: ExtraTimeStatus | null;
  attachments: ReportAttachmentMeta[];
  // Session 1 (owner, 2026-10-18): the language this report was written in. Viewers
  // render the report in this language with the correct dir (rtl for ar), regardless
  // of their UI locale. Undefined while the Session 1 migration is not applied yet.
  language?: ReportLanguageCode;
};

/**
 * Single server-side entry point for reading one report as a specific viewer.
 * Returns null when the report does not exist OR the viewer may not see it —
 * callers answer with a generic 404 so existence never leaks (Phase 4 pattern).
 *
 * VISIBILITY ON SUBMIT (owner, 2026-10-18 — CONTEXT §9): the guardian and the
 * student (per the field-level rules) see the report the moment the teacher
 * submits it, in EVERY status. Admin/Supervisor review has no effect on
 * visibility — approval gates pay only. A rejected-and-corrected report stays
 * the same row and viewers always see the latest content. The teacher sees her
 * own report in every state (she must be able to fix a rejected one).
 */
export async function getReportForViewer(viewer: Viewer, sessionId: string, studentId: string): Promise<ReportView | null> {
  // `language` only exists once the owner applies the Session 1 migration; until
  // then the view stays exactly the pre-Session-1 shape (self-healing).
  const session1Ready = await isSession1ReportsReady();
  const report = await prisma.report.findFirst({
    where: { sessionId, studentId, academyId: viewer.academyId },
    select: {
      id: true,
      sessionId: true,
      studentId: true,
      teacherId: true,
      status: true,
      attendanceOutcome: true,
      submittedAt: true,
      approvedAt: true,
      rejectionReason: true,
      classRemark: true,
      summary: true,
      homework: true,
      notes: true,
      operationalEvents: true,
      extraTimeMinutes: true,
      extraTimeStatus: true,
      ...(session1Ready ? { language: true } : {}),
      student: { select: { userId: true, guardianId: true, isAdult: true } },
      teacher: { select: { userId: true } },
    },
  });
  if (!report) return null;

  let full: boolean;
  if (viewer.role === "ADMIN" || viewer.role === "SUPERVISOR") {
    full = true;
  } else if (viewer.role === "TEACHER") {
    if (report.teacher.userId !== viewer.userId) return null;
    full = true;
  } else if (viewer.role === "STUDENT") {
    if (report.student.userId !== viewer.userId) return null;
    // An adult student without a guardian sees the whole report (CONTEXT §9);
    // a student WITH a guardian sees homework/notes/attachments only.
    full = report.student.guardianId === null;
  } else {
    // GUARDIAN — must be the linked guardian of this student.
    if (report.student.guardianId === null) return null;
    const linked = await prisma.guardian.findFirst({
      where: { userId: viewer.userId, id: report.student.guardianId },
      select: { id: true },
    });
    if (!linked) return null;
    full = true;
  }

  // Degrade safely before the owner applies migration 20261015093512 (link-audit pattern):
  // without the table, reports read fine with an empty attachment list.
  const attachmentRows = (await isAttachmentsReady())
    ? await prisma.reportAttachment.findMany({
        where: { reportId: report.id },
        orderBy: { createdAt: "asc" },
        select: { id: true, originalName: true, mimeType: true, sizeBytes: true },
      })
    : [];

  return {
    id: report.id,
    sessionId: report.sessionId,
    studentId: report.studentId,
    teacherId: report.teacherId,
    status: report.status,
    attendanceOutcome: report.attendanceOutcome,
    submittedAt: report.submittedAt,
    approvedAt: report.approvedAt,
    rejectionReason: full ? report.rejectionReason : null,
    classRemark: full ? report.classRemark : null,
    summary: full ? report.summary : null,
    homework: report.homework,
    notes: report.notes,
    operationalEvents: full ? report.operationalEvents : null,
    extraTimeMinutes: full ? report.extraTimeMinutes : null,
    extraTimeStatus: full ? report.extraTimeStatus : null,
    attachments: attachmentRows.map((row) => ({
      id: row.id,
      originalName: row.originalName,
      mimeType: row.mimeType,
      sizeBytes: Number(row.sizeBytes),
    })),
    ...(session1Ready ? { language: resolveReportLanguage(report.language) } : {}),
  };
}
