import type { Prisma } from "../../generated/prisma/client";

/**
 * D80 / D89, corrected by the owner on 2026-10-30 (CONTEXT §7, §20.6): a PAST_DUE
 * automatic renewal keeps booking open until its stored `grace_ends_at`. From that
 * moment (inclusive), while still PAST_DUE, no NEW booking is made for the student —
 * pay-per-session credit included. A PAST_DUE row without a grace end is treated as
 * past the grace (never an endless grace). Booked sessions stay; a verified renewal
 * (ACTIVE again) lifts it. Pure: takes the transaction.
 */
export async function studentsPastRenewalGrace(
  tx: Prisma.TransactionClient,
  academyId: string,
  studentIds: string[],
  now: Date = new Date(),
): Promise<string[]> {
  if (studentIds.length === 0) return [];
  const rows = await tx.billingSubscription.findMany({
    where: {
      academyId,
      studentId: { in: studentIds },
      status: "PAST_DUE",
      OR: [{ graceEndsAt: null }, { graceEndsAt: { lte: now } }],
    },
    select: { studentId: true },
  });
  return [...new Set(rows.map((row) => row.studentId))];
}
