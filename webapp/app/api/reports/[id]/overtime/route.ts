import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRoles } from "../../../../../lib/dal";
import { prisma } from "../../../../../lib/prisma";
import { SettlementError, creditAmountMinor, getRateForSession } from "../../../../../lib/payroll/rates";

const overtimeSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
});

function isUuid(value: string) {
  return z.string().uuid().safeParse(value).success;
}

/**
 * Admin-only overtime review (CONTEXT §7: Admin decides overtime; Supervisor never
 * sees or moves money). The claim (extraTimeMinutes) was frozen at submission; an
 * approval writes ONE PayrollLedger ADMIN_ADJUSTMENT at the same per-minute rate —
 * it never re-settles the session credit. PENDING-only conditional update makes
 * double clicks and concurrent reviews idempotent.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireApiRoles(["ADMIN"]);
  if (error) return error;
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid report identifier." } }, { status: 400 });
  }
  const parsed = overtimeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid overtime decision.", fields: parsed.error.flatten().fieldErrors } }, { status: 400 });
  }

  const report = await prisma.report.findFirst({
    where: { id, academyId: user.academyId },
    select: { id: true, status: true, extraTimeStatus: true, extraTimeMinutes: true, teacherId: true, session: { select: { scheduledStart: true, durationMinutes: true } } },
  });
  if (!report) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Report not found." } }, { status: 404 });
  if (report.extraTimeStatus !== "PENDING" || report.extraTimeMinutes <= 0) {
    const current = await prisma.report.findUniqueOrThrow({ where: { id }, select: { extraTimeStatus: true } });
    if (current.extraTimeStatus === "APPROVED" || current.extraTimeStatus === "REJECTED") {
      return NextResponse.json({ data: current, alreadyHandled: true });
    }
    return NextResponse.json({ error: { code: "NO_OVERTIME_CLAIM", message: "This report has no pending overtime claim." } }, { status: 409 });
  }
  if (report.status !== "APPROVED" && report.status !== "ARCHIVED") {
    return NextResponse.json({ error: { code: "REPORT_NOT_APPROVED", message: "Overtime is reviewed only after the report is approved." } }, { status: 409 });
  }

  const reviewedAt = new Date();
  const claimed = await prisma.report.updateMany({
    where: { id, extraTimeStatus: "PENDING" },
    data: parsed.data.action === "APPROVE"
      ? { extraTimeStatus: "APPROVED", extraTimeReviewedById: user.id, extraTimeReviewedAt: reviewedAt }
      : { extraTimeStatus: "REJECTED", extraTimeReviewedById: user.id, extraTimeReviewedAt: reviewedAt },
  });
  if (claimed.count === 0) {
    const current = await prisma.report.findUniqueOrThrow({ where: { id }, select: { extraTimeStatus: true } });
    return NextResponse.json({ data: current, alreadyHandled: true });
  }

  if (parsed.data.action === "APPROVE") {
    try {
      await prisma.$transaction(async (tx) => {
        const rate = await getRateForSession(tx, report.teacherId, report.session.scheduledStart);
        const amountMinor = creditAmountMinor(report.extraTimeMinutes, rate.hourlyRateMinor);
        if (amountMinor !== 0) {
          await tx.payrollLedger.create({
            data: {
              academyId: user.academyId,
              teacherId: report.teacherId,
              sessionId: null,
              reportId: report.id,
              teacherRateId: rate.id,
              entryType: "ADMIN_ADJUSTMENT",
              amountMinor,
              currency: rate.currency,
              minutesCredited: report.extraTimeMinutes,
              hourlyRateSnapshotMinor: rate.hourlyRateMinor,
              reason: `Approved overtime (${report.extraTimeMinutes} min) — report ${report.id}`,
              createdById: user.id,
            },
          });
        }
      });
    } catch (cause) {
      if (cause instanceof SettlementError) {
        return NextResponse.json({ error: { code: cause.code, message: cause.message } }, { status: cause.status });
      }
      throw cause;
    }
  }

  // Post-commit teacher notice (never rolls the decision back; no amounts included).
  try {
    const teacherUser = await prisma.teacher.findUnique({ where: { id: report.teacherId }, select: { userId: true, academyId: true } });
    if (teacherUser) {
      await prisma.notificationJob.create({
        data: {
          academyId: teacherUser.academyId,
          sessionId: null,
          recipientUserId: teacherUser.userId,
          kind: "OVERTIME_DECISION",
          dedupKey: `OVERTIME_DECISION:${report.id}:${parsed.data.action}`,
          scheduledFor: new Date(),
        },
        select: { id: true },
      });
    }
  } catch {
    // Notification bookkeeping must never fail the overtime decision.
  }

  const updated = await prisma.report.findUniqueOrThrow({ where: { id }, select: { id: true, extraTimeStatus: true, extraTimeMinutes: true, extraTimeReviewedAt: true } });
  return NextResponse.json({ data: updated });
}
