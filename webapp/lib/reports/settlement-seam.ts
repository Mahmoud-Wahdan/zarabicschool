import "server-only";

import type { Prisma } from "../../generated/prisma/client";

import { SettlementError, creditAmountMinor, getRateForSession } from "../payroll/rates";

/**
 * The ONE settlement (Phase 6 replaces the Phase 5 no-op; same signature, same
 * transaction). Called from the report-approval route inside its approval
 * transaction — every write here commits or rolls back with the approval:
 *
 * ATTENDED:
 *  1. consume the (session, student) reservation;
 *  2. one SubscriptionLedger SESSION_DEDUCTION (−1) — P2002 means already done;
 *  3. negative post-deduction balance → ADMIN-only flag notification (deduped);
 *  4. one PayrollLedger SESSION_CREDIT = scheduled minutes × effective rate
 *     (half-up, integer minor units) — the partial unique index guarantees once
 *     per session; a missing rate fails the whole settlement (NO_TEACHER_RATE);
 *  5. Reports.settled_at + archived_at.
 *
 * STUDENT_ABSENT: release the reservation, zero financial entries, the report is
 * still settled+archived (the session happened; the student did not attend).
 * Missed/cancelled sessions never reach this function (submit-time gates).
 *
 * Replay safety: the approval route claims the SUBMITTED row conditionally first,
 * so exactly one caller reaches here; the unique indexes are the idempotency
 * backstop for a retried transaction.
 */
export async function settleApprovedReport(
  tx: Prisma.TransactionClient,
  report: {
    id: string;
    academyId: string;
    sessionId: string;
    studentId: string;
    teacherId: string;
    attendanceOutcome: "ATTENDED" | "STUDENT_ABSENT";
  },
): Promise<void> {
  const session = await tx.session.findUnique({
    where: { id: report.sessionId },
    select: { id: true, scheduledStart: true, durationMinutes: true, teacherId: true },
  });
  if (!session) {
    throw new SettlementError("SESSION_NOT_FOUND", "The reported session no longer exists.", 409);
  }

  const reservation = await tx.sessionReservation.findUnique({
    where: { sessionId_studentId: { sessionId: report.sessionId, studentId: report.studentId } },
    select: { id: true, status: true, subscriptionId: true },
  });

  if (report.attendanceOutcome === "ATTENDED") {
    // 1. Consume the reservation (idempotent on replay: CONSUMED stays CONSUMED).
    if (reservation && reservation.status === "RESERVED") {
      await tx.sessionReservation.update({
        where: { id: reservation.id },
        data: { status: "CONSUMED" },
      });
    }

    // 2. Deduction — the reservation's subscription, else the student's latest ACTIVE one.
    const subscriptionId =
      reservation?.subscriptionId ??
      (
        await tx.subscription.findFirst({
          where: { studentId: report.studentId, status: "ACTIVE" },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        })
      )?.id ??
      null;
    if (subscriptionId) {
      const existingDeduction = await tx.subscriptionLedger.findFirst({
        where: { sessionId: report.sessionId, reportId: report.id, entryType: "SESSION_DEDUCTION" },
        select: { id: true },
      });
      if (!existingDeduction) {
        await tx.subscriptionLedger.create({
          data: {
            academyId: report.academyId,
            subscriptionId,
            sessionId: report.sessionId,
            reportId: report.id,
            entryType: "SESSION_DEDUCTION",
            sessionsDelta: -1,
          },
        });
        // 3. Negative balance → ADMIN review flag (Supervisor never sees money).
        const total = await tx.subscriptionLedger.aggregate({
          where: { subscriptionId },
          _sum: { sessionsDelta: true },
        });
        if ((total._sum.sessionsDelta ?? 0) < 0) {
          const admins = await tx.user.findMany({
            where: { academyId: report.academyId, role: "ADMIN", isActive: true },
            select: { id: true },
          });
          if (admins.length > 0) {
            await tx.notificationJob.createMany({
              data: admins.map((admin) => ({
                academyId: report.academyId,
                sessionId: null,
                recipientUserId: admin.id,
                kind: "BALANCE_NEGATIVE",
                dedupKey: `BALANCE_NEGATIVE:${subscriptionId}`,
                scheduledFor: new Date(),
              })),
              skipDuplicates: true,
            });
          }
        }
      }
    }

    // 4. One SESSION_CREDIT per session — rate snapshot from the effective-dated table.
    const rate = await getRateForSession(tx, session.teacherId, session.scheduledStart);
    const existingCredit = await tx.payrollLedger.findFirst({
      where: { sessionId: report.sessionId, entryType: "SESSION_CREDIT" },
      select: { id: true },
    });
    if (!existingCredit) {
      await tx.payrollLedger.create({
        data: {
          academyId: report.academyId,
          teacherId: session.teacherId,
          sessionId: report.sessionId,
          reportId: report.id,
          teacherRateId: rate.id,
          entryType: "SESSION_CREDIT",
          amountMinor: creditAmountMinor(session.durationMinutes, rate.hourlyRateMinor),
          currency: rate.currency,
          minutesCredited: session.durationMinutes,
          hourlyRateSnapshotMinor: rate.hourlyRateMinor,
        },
      });
    }
  } else if (reservation && reservation.status === "RESERVED") {
    // STUDENT_ABSENT — the approved absence releases the reservation (CONTEXT §7).
    await tx.sessionReservation.update({
      where: { id: reservation.id },
      data: { status: "RELEASED", releasedAt: new Date() },
    });
  }

  // 5. Settlement markers — archival happens exactly here, never on approval alone.
  await tx.report.update({
    where: { id: report.id },
    data: { settledAt: new Date(), archivedAt: new Date() },
    select: { id: true },
  });
}
