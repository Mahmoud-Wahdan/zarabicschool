import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "../../../../../../../generated/prisma/client";

import { requireApiRole, requireApiRoles } from "../../../../../../../lib/dal";
import { prisma } from "../../../../../../../lib/prisma";
import { getClassRemarks } from "../../../../../../../lib/reports/class-remarks";
import { getReportForViewer } from "../../../../../../../lib/reports/visibility";
import { sessionReportSchema } from "../../../../../../../lib/validation/management";

const REPORT_NUDGE_KINDS = ["REPORT_REMINDER", "REPORT_REMINDER_FOLLOWUP"] as const;

function isUuid(value: string) {
  return z.string().uuid().safeParse(value).success;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; studentId: string }> },
) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR", "TEACHER", "STUDENT", "GUARDIAN"]);
  if (error) return error;
  const { id: sessionId, studentId } = await params;
  if (!isUuid(sessionId) || !isUuid(studentId)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid session or student identifier." } },
      { status: 400 },
    );
  }
  // Role-shaped, field-restricted read through the data layer (CONTEXT §9; Phase 5
  // review F-06/F-17). Null for missing OR unauthorized — generic 404, no existence leak.
  const view = await getReportForViewer(
    { userId: user.id, academyId: user.academyId, role: user.role },
    sessionId,
    studentId,
  );
  if (!view) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Report not found." } }, { status: 404 });
  return NextResponse.json({ data: view });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; studentId: string }> },
) {
  const { user, error } = await requireApiRole("TEACHER");
  if (error) return error;
  const { id: sessionId, studentId } = await params;
  if (!isUuid(sessionId) || !isUuid(studentId)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid session or student identifier." } },
      { status: 400 },
    );
  }
  const parsed = sessionReportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Please complete the session report.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  }
  // The class remark must come from the academy's editable list (CONTEXT §9, Batch A).
  const remarks = await getClassRemarks(user.academyId);
  if (!remarks.includes(parsed.data.classRemark)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Class remark must be one of the academy's list.", fields: { classRemark: ["Invalid class remark."] } } },
      { status: 400 },
    );
  }
  const sessionStudent = await prisma.sessionStudent.findFirst({
    where: {
      sessionId,
      studentId,
      session: { academyId: user.academyId, teacher: { userId: user.id } },
    },
    select: { id: true, session: { select: { scheduledEnd: true, status: true } } },
  });
  if (!sessionStudent) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Assigned session student was not found." } }, { status: 404 });
  if (new Date() < sessionStudent.session.scheduledEnd) {
    return NextResponse.json({ error: { code: "SESSION_NOT_FINISHED", message: "The report can be submitted after the scheduled session end." } }, { status: 409 });
  }
  if (sessionStudent.session.status === "CANCELLED" || sessionStudent.session.status === "MISSED") {
    // A session that never took place has nothing to report (Phase 5 review F-01).
    return NextResponse.json({ error: { code: "SESSION_NOT_REPORTABLE", message: "A report can only be submitted for a session that took place." } }, { status: 409 });
  }
  const existing = await prisma.report.findFirst({ where: { sessionId, studentId, reportType: "SESSION_COMPLETION_REPORT" }, select: { id: true, status: true } });
  if (existing && existing.status === "SUBMITTED") {
    return NextResponse.json({ error: { code: "ALREADY_SUBMITTED", message: "A report has already been submitted for this session and student and is awaiting review." } }, { status: 409 });
  }
  if (existing && (existing.status === "APPROVED" || existing.status === "ARCHIVED")) {
    return NextResponse.json({ error: { code: "REPORT_IMMUTABLE", message: "This report has already been approved and can no longer be changed." } }, { status: 409 });
  }
  // Only evidence/text fields may change on resubmission. The attendance outcome and the
  // claimed extra time are frozen from the first submission (CONTEXT §7 protection 4;
  // owner decision 2026-10-14) — a rejected report returns with its original outcome.
  const editableData = {
    classRemark: parsed.data.classRemark,
    summary: parsed.data.summary,
    homework: parsed.data.homework,
    notes: parsed.data.notes || null,
    operationalEvents: parsed.data.operationalEvents as Prisma.InputJsonValue | undefined,
    submittedAt: new Date(),
    status: "SUBMITTED" as const,
  };
  let report;
  if (existing) {
    // Rejection reason, actor and timestamp stay on the row as the audit trail
    // (database-schema.md §17) — resubmission never wipes them (Phase 5 review F-02).
    report = await prisma.report.update({ where: { id: existing.id }, data: editableData });
  } else {
    try {
      report = await prisma.report.create({
        data: {
          academyId: user.academyId,
          sessionId,
          studentId,
          teacherId: (await prisma.teacher.findUniqueOrThrow({ where: { userId: user.id }, select: { id: true } })).id,
          reportType: "SESSION_COMPLETION_REPORT",
          attendanceOutcome: parsed.data.attendanceOutcome,
          extraTimeMinutes: parsed.data.extraTimeMinutes,
          extraTimeStatus: parsed.data.extraTimeMinutes > 0 ? "PENDING" : "NONE",
          ...editableData,
        },
      });
    } catch (cause) {
      // A concurrent first submission hits the unique (session, student, type) index —
      // report it as "already submitted", not as a server error (Phase 5 review F-11).
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") {
        return NextResponse.json({ error: { code: "ALREADY_SUBMITTED", message: "A report has already been submitted for this session and student." } }, { status: 409 });
      }
      throw cause;
    }
  }
  // Cancel the pending late-report nudges once every roster student has a report
  // (Phase 5 review F-07; owner rule: a submitted report stops the reminders).
  // Best effort — the worker sender re-checks before sending, so a failure here
  // never fails an accepted submission.
  try {
    const [rosterCount, reportCount] = await Promise.all([
      prisma.sessionStudent.count({ where: { sessionId } }),
      prisma.report.count({ where: { sessionId, reportType: "SESSION_COMPLETION_REPORT" } }),
    ]);
    if (rosterCount > 0 && reportCount >= rosterCount) {
      await prisma.notificationJob.updateMany({
        where: { sessionId, kind: { in: [...REPORT_NUDGE_KINDS] }, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
    }
  } catch {
    // Nudge bookkeeping must never roll back or fail the report submission.
  }
  return NextResponse.json({ data: report }, { status: existing ? 200 : 201 });
}
