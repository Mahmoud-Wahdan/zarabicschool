import { NextResponse } from "next/server";
import type { Prisma } from "../../../../../../../generated/prisma/client";

import { requireApiRole, requireApiRoles } from "../../../../../../../lib/dal";
import { prisma } from "../../../../../../../lib/prisma";
import { sessionReportSchema } from "../../../../../../../lib/validation/management";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; studentId: string }> },
) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR", "TEACHER", "STUDENT", "GUARDIAN"]);
  if (error) return error;
  const { id: sessionId, studentId } = await params;
  const report = await prisma.report.findFirst({
    where: { sessionId, studentId, academyId: user.academyId },
    include: {
      student: { select: { userId: true, guardianId: true } },
      teacher: { select: { userId: true } },
    },
  });
  if (!report) return NextResponse.json({ data: null });
  const allowed =
    user.role === "ADMIN" ||
    user.role === "SUPERVISOR" ||
    (user.role === "TEACHER" && report.teacher.userId === user.id) ||
    (user.role === "STUDENT" && report.student.userId === user.id && report.status === "ARCHIVED") ||
    (user.role === "GUARDIAN" && report.status === "ARCHIVED" && report.student.guardianId !== null &&
      Boolean(await prisma.guardian.findFirst({ where: { userId: user.id, id: report.student.guardianId }, select: { id: true } })));
  if (!allowed) return NextResponse.json({ error: { code: "FORBIDDEN", message: "You do not have access to this report." } }, { status: 403 });
  return NextResponse.json({ data: report });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; studentId: string }> },
) {
  const { user, error } = await requireApiRole("TEACHER");
  if (error) return error;
  const { id: sessionId, studentId } = await params;
  const parsed = sessionReportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Please complete the session report.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
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
  const existing = await prisma.report.findFirst({ where: { sessionId, studentId, reportType: "SESSION_COMPLETION_REPORT" }, select: { id: true, status: true } });
  if (existing && !["REJECTED"].includes(existing.status)) {
    return NextResponse.json({ error: { code: "CONFLICT", message: "A report already exists for this session and student." } }, { status: 409 });
  }
  const data = {
    ...parsed.data,
    notes: parsed.data.notes || null,
    operationalEvents: parsed.data.operationalEvents as Prisma.InputJsonValue | undefined,
    extraTimeStatus: parsed.data.extraTimeMinutes > 0 ? "PENDING" as const : "NONE" as const,
    submittedAt: new Date(),
    status: "SUBMITTED" as const,
  };
  const report = existing
    ? await prisma.report.update({
        where: { id: existing.id },
        data: { ...data, rejectionReason: null, rejectedAt: null, rejectedById: null },
      })
    : await prisma.report.create({
        data: {
          academyId: user.academyId,
          sessionId,
          studentId,
          teacherId: (await prisma.teacher.findUniqueOrThrow({ where: { userId: user.id }, select: { id: true } })).id,
          reportType: "SESSION_COMPLETION_REPORT",
          ...data,
        },
      });
  return NextResponse.json({ data: report }, { status: existing ? 200 : 201 });
}
