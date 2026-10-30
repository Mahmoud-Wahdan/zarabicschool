import type { Prisma } from "../../generated/prisma/client";

/**
 * D80 / D89 (owner, 2026-10-29/30): while a student's automatic renewal is PAST_DUE
 * (the grace after a period ended without a verified payment), no NEW booking is
 * made for that student — pay-per-session credit included. Booked sessions stay;
 * a verified renewal (status ACTIVE again) lifts it. Pure: takes the transaction.
 */
export async function studentsInRenewalGrace(
  tx: Prisma.TransactionClient,
  academyId: string,
  studentIds: string[],
): Promise<string[]> {
  if (studentIds.length === 0) return [];
  const rows = await tx.billingSubscription.findMany({
    where: { academyId, studentId: { in: studentIds }, status: "PAST_DUE" },
    select: { studentId: true },
  });
  return [...new Set(rows.map((row) => row.studentId))];
}
