import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRoles } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { settleApprovedReport } from "../../../../../lib/reports/settlement-seam";
import { reportReviewSchema } from "../../../../../lib/validation/management";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireApiRoles(["ADMIN", "SUPERVISOR"]);
  if (error) return error;
  const parsed = reportReviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid review decision.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid report identifier." } }, { status: 400 });
  }
  const report = await prisma.report.findFirst({ where: { id, academyId: user.academyId }, select: { id: true, status: true, attendanceOutcome: true, studentId: true, sessionId: true } });
  if (!report) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Report not found." } }, { status: 404 });
  if (report.status !== "SUBMITTED") {
    // Repeating the same decision is a clean no-op, not an error (Phase 5 review F-04):
    // a second click, a retry, or a parallel reviewer gets "already handled".
    const sameDecision =
      (parsed.data.action === "APPROVE" && report.status === "APPROVED") ||
      (parsed.data.action === "REJECT" && report.status === "REJECTED");
    if (sameDecision) {
      const full = await prisma.report.findUniqueOrThrow({ where: { id } });
      return NextResponse.json({ data: full, alreadyHandled: true });
    }
    return NextResponse.json({ error: { code: "CONFLICT", message: "Only submitted reports can be reviewed." } }, { status: 409 });
  }
  if (parsed.data.action === "REJECT") {
    // Conditional update: exactly one reviewer wins a concurrent review; the loser
    // re-reads and reports "already handled" or a clean conflict.
    const claimed = await prisma.report.updateMany({
      where: { id, status: "SUBMITTED" },
      data: { status: "REJECTED", rejectionReason: parsed.data.rejectionReason, rejectedById: user.id, rejectedAt: new Date() },
    });
    if (claimed.count === 1) {
      const updated = await prisma.report.findUniqueOrThrow({ where: { id } });
      return NextResponse.json({ data: updated });
    }
    const current = await prisma.report.findUniqueOrThrow({ where: { id } });
    if (current.status === "REJECTED") return NextResponse.json({ data: current, alreadyHandled: true });
    return NextResponse.json({ error: { code: "CONFLICT", message: "Only submitted reports can be reviewed." } }, { status: 409 });
  }
  // APPROVE — one transaction: claim the row conditionally (only one concurrent
  // approval wins), then write attendance from the approved outcome. The settlement
  // seam is the single hook point where Phase 6 money writes will join THIS
  // transaction; no money moves in Phase 5.
  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.report.updateMany({
      where: { id, status: "SUBMITTED" },
      data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date() },
    });
    if (claimed.count === 0) return null;
    await tx.sessionStudent.update({
      where: { sessionId_studentId: { sessionId: report.sessionId, studentId: report.studentId } },
      data: { attendanceStatus: report.attendanceOutcome === "ATTENDED" ? "ATTENDED" : "STUDENT_ABSENT" },
    });
    await settleApprovedReport(tx, {
      id: report.id,
      sessionId: report.sessionId,
      studentId: report.studentId,
      attendanceOutcome: report.attendanceOutcome,
    });
    return tx.report.findUnique({ where: { id } });
  });
  if (updated) return NextResponse.json({ data: updated });
  const current = await prisma.report.findUniqueOrThrow({ where: { id } });
  if (current.status === "APPROVED") return NextResponse.json({ data: current, alreadyHandled: true });
  return NextResponse.json({ error: { code: "CONFLICT", message: "Only submitted reports can be reviewed." } }, { status: 409 });
}
