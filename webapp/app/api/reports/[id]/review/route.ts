import { NextResponse } from "next/server";

import { requireApiRoles } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { reportReviewSchema } from "../../../../../lib/validation/management";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const parsed = reportReviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid review decision.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  const { id } = await params;
  const report = await prisma.report.findFirst({ where: { id, academyId: user.academyId }, select: { id: true, status: true, attendanceOutcome: true, studentId: true, sessionId: true } });
  if (!report) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Report not found." } }, { status: 404 });
  if (report.status !== "SUBMITTED") return NextResponse.json({ error: { code: "CONFLICT", message: "Only submitted reports can be reviewed." } }, { status: 409 });
  if (parsed.data.action === "REJECT") {
    const updated = await prisma.report.update({
      where: { id },
      data: { status: "REJECTED", rejectionReason: parsed.data.rejectionReason, rejectedById: user.id, rejectedAt: new Date() },
    });
    return NextResponse.json({ data: updated });
  }
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.report.update({
      where: { id },
      data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date() },
    });
    await tx.sessionStudent.update({
      where: { sessionId_studentId: { sessionId: report.sessionId, studentId: report.studentId } },
      data: { attendanceStatus: report.attendanceOutcome === "ATTENDED" ? "ATTENDED" : "STUDENT_ABSENT" },
    });
    return next;
  });
  return NextResponse.json({ data: updated });
}
