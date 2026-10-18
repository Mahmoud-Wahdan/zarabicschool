import "server-only";

import type { Prisma } from "../../generated/prisma/client";

/**
 * The teacher credit amount for a session: scheduled duration × the effective-dated
 * hourly rate, proportional by the minute, rounded HALF-UP to the minor unit
 * (owner decisions, CONTEXT §7.9).
 *
 * `hourlyRateMinor` is per HOUR; the per-minute rate is `hourlyRateMinor / 60`.
 * To keep the arithmetic in integers: (minutes × rate + 30) / 60 floored == half-up
 * for positive values. No floating point anywhere.
 */
export function creditAmountMinor(minutes: number, hourlyRateMinor: number): number {
  return Math.floor((minutes * hourlyRateMinor + 30) / 60);
}

/**
 * The `teacher_rates` row whose `effective_from` <= the session's scheduled start
 * (never the approval time). Throws SettlementError(NO_TEACHER_RATE) when the Admin
 * has not entered a rate yet — an invented rate is never used.
 */
export async function getRateForSession(
  tx: Prisma.TransactionClient,
  teacherId: string,
  scheduledStart: Date,
): Promise<{ id: string; hourlyRateMinor: number; currency: string }> {
  const rate = await tx.teacherRate.findFirst({
    where: { teacherId, effectiveFrom: { lte: scheduledStart } },
    orderBy: { effectiveFrom: "desc" },
    select: { id: true, hourlyRateMinor: true, currency: true },
  });
  if (!rate) {
    throw new SettlementError(
      "NO_TEACHER_RATE",
      "No hourly rate is configured for this teacher at the session's start time. Ask the Admin to add a teacher rate, then approve the report again.",
      409,
    );
  }
  return rate;
}

/**
 * Typed settlement failure. Thrown inside the approval transaction so every write
 * (attendance, ledger rows, report markers) rolls back together; the review route
 * converts it into the documented error shape.
 */
export class SettlementError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "SettlementError";
    this.code = code;
    this.status = status;
  }
}
