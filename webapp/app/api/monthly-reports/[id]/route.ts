import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRole, requireApiRoles } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { getMonthlyReportByIdForViewer, isMonthlyReportEditable } from "@/lib/reports/monthly";
import { isSession1ReportsReady } from "@/lib/reports/session1-ready";
import { monthlyReportUpdateSchema } from "@/lib/validation/management";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR", "TEACHER", "STUDENT", "GUARDIAN"]);
  if (error) return error;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid monthly report identifier." } },
      { status: 400 },
    );
  }

  const view = await getMonthlyReportByIdForViewer(
    { userId: user.id, academyId: user.academyId, role: user.role },
    id,
  );
  if (!view) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Monthly report not found." } }, { status: 404 });
  }

  return NextResponse.json({ data: view });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireApiRole("TEACHER");
  if (error) return error;

  if (!(await isSession1ReportsReady())) {
    return NextResponse.json(
      { error: { code: "MONTHLY_REPORTS_MIGRATION_PENDING", message: "Monthly reports arrive with the pending Session 1 migration. Ask the owner to apply it first." } },
      { status: 409 },
    );
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid monthly report identifier." } },
      { status: 400 },
    );
  }

  const parsed = monthlyReportUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid report update payload.", fields: parsed.error.flatten().fieldErrors } },
      { status: 400 },
    );
  }

  const teacher = await prisma.teacher.findUnique({
    where: { userId: user.id },
    select: { id: true, academyId: true },
  });
  if (!teacher || teacher.academyId !== user.academyId) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Teacher profile not found." } }, { status: 404 });
  }

  const report = await prisma.monthlyReport.findUnique({
    where: { id },
    select: { id: true, academyId: true, teacherId: true, submittedAt: true },
  });
  if (!report || report.academyId !== user.academyId || report.teacherId !== teacher.id) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Monthly report not found." } }, { status: 404 });
  }

  if (!isMonthlyReportEditable(report.submittedAt)) {
    return NextResponse.json(
      { error: { code: "MONTHLY_REPORT_LOCKED", message: "This monthly report is locked — the 7-day edit window after submission has passed." } },
      { status: 409 },
    );
  }

  const updated = await prisma.monthlyReport.update({
    where: { id },
    data: parsed.data,
    select: {
      id: true,
      monthKey: true,
      studentId: true,
      teacherId: true,
      submittedAt: true,
      language: true,
      achievement: true,
      learningProgress: true,
      classFocus: true,
      homeworkCompletion: true,
      punctuality: true,
      rescheduledSessions: true,
      supportAreas: true,
      nextMonthObjectives: true,
    },
  });

  return NextResponse.json({ data: updated });
}
