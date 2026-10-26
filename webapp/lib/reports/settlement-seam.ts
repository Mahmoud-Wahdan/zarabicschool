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
 * Missed/cancelled sessions are refused here (409 SESSION_NOT_SETTLEABLE, A2): the
 * submit-time gate alone misses a session cancelled AFTER its report was submitted.
 *
 * Replay safety: the approval route claims the SUBMITTED row conditionally first,
 * so exactly one caller reaches here; the unique indexes are the idempotency
 * backstop for a retried transaction.
 */
/** Admin-only flag job, one per active Admin (the dedup key includes the Admin, so every Admin gets it). */
async function enqueueAdminFlag(
  tx: Prisma.TransactionClient,
  academyId: string,
  kind: "BALANCE_NEGATIVE" | "SETTLED_WITHOUT_SUBSCRIPTION",
  dedupBase: string,
  payload?: Prisma.InputJsonValue,
) {
  const admins = await tx.user.findMany({ where: { academyId, role: "ADMIN", isActive: true }, select: { id: true } });
  if (!admins.length) return;
  await tx.notificationJob.createMany({
    data: admins.map((admin) => ({
      academyId,
      sessionId: null,
      recipientUserId: admin.id,
      kind,
      dedupKey: `${dedupBase}:${admin.id}`,
      scheduledFor: new Date(),
      ...(payload ? { payload } : {}),
    })),
    skipDuplicates: true,
  });
}

/** P8 fallback when the attended student has no reservation: reserveCredit's order. */
async function fallbackSubscriptionId(
  tx: Prisma.TransactionClient,
  report: { academyId: string; studentId: string },
  sessionDate: Date,
): Promise<string | null> {
  const subscriptions = await tx.subscription.findMany({
    where: {
      academyId: report.academyId,
      studentId: report.studentId,
      status: "ACTIVE",
      OR: [
        { packageType: "PAY_PER_SESSION" },
        { periodStartsAt: { lte: sessionDate }, periodEndsAt: { gt: sessionDate } },
      ],
    },
    orderBy: [{ periodEndsAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      ledgerEntries: { select: { sessionsDelta: true } },
      reservations: { where: { status: "RESERVED" }, select: { id: true } },
    },
  });
  // Same "free credit" rule as reserveCredit: balance minus credits held by other bookings.
  const withCredit = subscriptions.find(
    (item) => item.ledgerEntries.reduce((sum, entry) => sum + entry.sessionsDelta, 0) - item.reservations.length > 0,
  );
  return (withCredit ?? subscriptions[0])?.id ?? null;
}

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
  // A2 (owner, 2026-10-26): a CANCELLED or MISSED session ("did not take place",
  // CONTEXT §7) is never settled. The session row is share-locked first, so a
  // concurrent cancellation either commits before this read (and is refused here) or
  // waits for this transaction — no check-then-act gap. The thrown error rolls back
  // the approval claim and the attendance write in the caller's transaction.
  await tx.$queryRaw`SELECT id FROM sessions WHERE id = ${report.sessionId}::uuid FOR SHARE`;
  const session = await tx.session.findUnique({
    where: { id: report.sessionId },
    select: { id: true, scheduledStart: true, durationMinutes: true, teacherId: true, status: true },
  });
  if (!session) {
    throw new SettlementError("SESSION_NOT_FOUND", "The reported session no longer exists.", 409);
  }
  if (session.status === "CANCELLED" || session.status === "MISSED") {
    throw new SettlementError(
      "SESSION_NOT_SETTLEABLE",
      `The session is ${session.status}; its report cannot be approved. The Admin may reject it instead.`,
      409,
    );
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

    // 2. Deduction — the reservation's subscription; without a reservation (P8), the
    // SAME order the booking uses (reserveCredit): subscriptions valid on the session
    // date, earliest-expiring first, preferring one with credit left.
    // A RELEASED reservation no longer holds credit, so it does not pick the package.
    const heldSubscriptionId = reservation && reservation.status !== "RELEASED" ? reservation.subscriptionId : null;
    const subscriptionId = heldSubscriptionId ?? (await fallbackSubscriptionId(tx, report, session.scheduledStart));
    if (!subscriptionId) {
      // P8: nothing to deduct from — the teacher side still settles (the session
      // happened); the Admin decides what to do with the student side.
      await enqueueAdminFlag(tx, report.academyId, "SETTLED_WITHOUT_SUBSCRIPTION", `SETTLED_WITHOUT_SUBSCRIPTION:${report.id}`, { reportId: report.id });
    }
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
          await enqueueAdminFlag(tx, report.academyId, "BALANCE_NEGATIVE", `BALANCE_NEGATIVE:${subscriptionId}`);
        }
      }
    }

    // 4. One SESSION_CREDIT per session — rate snapshot from the effective-dated table.
    const rate = await getRateForSession(tx, session.teacherId, session.scheduledStart);
    // P9: ON CONFLICT DO NOTHING against payroll_ledger_one_session_credit_key. A
    // concurrent approval of another student of the same group session that credited
    // first is "already credited" (CONTEXT §7: one credit per session) — the student
    // side above still settles, and the transaction is never aborted by a P2002.
    await tx.payrollLedger.createMany({
      data: [{
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
      }],
      skipDuplicates: true,
    });
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
