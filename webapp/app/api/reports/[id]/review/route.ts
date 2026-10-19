import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRoles } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { enqueueReportDecisionNotifications } from "../../../../../lib/reports/notifications";
import { reportRowSelect } from "../../../../../lib/reports/selects";
import { isSession1ReportsReady } from "../../../../../lib/reports/session1-ready";
import { settleApprovedReport } from "../../../../../lib/reports/settlement-seam";
import { SettlementError } from "../../../../../lib/payroll/rates";
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
  const report = await prisma.report.findFirst({ where: { id, academyId: user.academyId }, select: { id: true, academyId: true, status: true, attendanceOutcome: true, studentId: true, sessionId: true, teacherId: true } });
  if (!report) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Report not found." } }, { status: 404 });
  if (report.status !== "SUBMITTED") {
    // Repeating the same decision is a clean no-op, not an error (Phase 5 review F-04):
    // a second click, a retry, or a parallel reviewer gets "already handled".
    const sameDecision =
      (parsed.data.action === "APPROVE" && report.status === "APPROVED") ||
      (parsed.data.action === "REJECT" && report.status === "REJECTED");
    if (sameDecision) {
      const full = await prisma.report.findUniqueOrThrow({ where: { id }, select: await reportRowSelect() });
      return NextResponse.json({ data: full, alreadyHandled: true });
    }
    return NextResponse.json({ error: { code: "CONFLICT", message: "Only submitted reports can be reviewed." } }, { status: 409 });
  }
  if (parsed.data.action === "REJECT") {
    const rejectedAt = new Date();
    // Conditional update: exactly one reviewer wins a concurrent review; the loser
    // re-reads and reports "already handled" or a clean conflict. The rejection
    // counter (Session 1, PROPOSAL — CONTEXT §6/§7) increments on each rejection;
    // it is informational for Admin/Supervisor only — never an automatic red mark
    // or penalty. It is written only once the Session 1 migration is applied.
    const session1Ready = await isSession1ReportsReady();
    const claimed = await prisma.report.updateMany({
      where: { id, status: "SUBMITTED" },
      data: {
        status: "REJECTED",
        rejectionReason: parsed.data.rejectionReason,
        rejectedById: user.id,
        rejectedAt,
        ...(session1Ready ? { rejectionCount: { increment: 1 } } : {}),
      },
    });
    if (claimed.count === 1) {
      // Rejection notice to the teacher (Batch D) — after commit, never rolls back.
      try {
        await enqueueReportDecisionNotifications({ reportId: id, action: "REJECT", rejectedAt });
      } catch {
        // Notification bookkeeping must never fail the review decision.
      }
      const updated = await prisma.report.findUniqueOrThrow({ where: { id }, select: await reportRowSelect() });
      return NextResponse.json({ data: updated });
    }
    const current = await prisma.report.findUniqueOrThrow({ where: { id }, select: await reportRowSelect() });
    if (current.status === "REJECTED") return NextResponse.json({ data: current, alreadyHandled: true });
    return NextResponse.json({ error: { code: "CONFLICT", message: "Only submitted reports can be reviewed." } }, { status: 409 });
  }
  // APPROVE — one transaction: claim the row conditionally (only one concurrent
  // approval wins), then write attendance from the approved outcome. The settlement
  // seam writes the deduction, the once-per-session teacher credit, and the
  // settled/archived markers in THIS transaction (Phase 6); any failure rolls
  // everything back.
  let updated: Awaited<ReturnType<typeof prisma.report.findUnique>> = null;
  try {
    updated = await prisma.$transaction(async (tx) => {
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
        academyId: report.academyId,
        sessionId: report.sessionId,
        studentId: report.studentId,
        teacherId: report.teacherId,
        attendanceOutcome: report.attendanceOutcome,
      });
      return tx.report.findUnique({ where: { id }, select: await reportRowSelect() });
    });
  } catch (cause) {
    if (cause instanceof SettlementError) {
      return NextResponse.json({ error: { code: cause.code, message: cause.message } }, { status: cause.status });
    }
    throw cause;
  }
  if (updated) {
    // Nothing is sent on approval (owner, 2026-10-18): the family was notified on
    // SUBMIT; approval concerns teacher pay only. The call stays as a no-op guard.
    try {
      await enqueueReportDecisionNotifications({ reportId: id, action: "APPROVE" });
    } catch {
      // Notification bookkeeping must never fail the review decision.
    }
    return NextResponse.json({ data: updated });
  }
  const current = await prisma.report.findUniqueOrThrow({ where: { id }, select: await reportRowSelect() });
  if (current.status === "APPROVED") return NextResponse.json({ data: current, alreadyHandled: true });
  return NextResponse.json({ error: { code: "CONFLICT", message: "Only submitted reports can be reviewed." } }, { status: 409 });
}
