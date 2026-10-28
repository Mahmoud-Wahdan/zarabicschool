import type { Prisma } from "../../generated/prisma/client";

/**
 * Who may see or cancel an automatic renewal (finance wall, CONTEXT §12 — the same
 * rule as canActOnStudentFinance): the Admin of the academy, the student's linked
 * guardian, or an adult student without a guardian. Supervisor and Teacher never
 * reach this (route role guards); a child student matches nothing.
 */
export function billingSubscriptionScope(user: { id: string; role: string; academyId: string }): Prisma.BillingSubscriptionWhereInput {
  if (user.role === "ADMIN") return { academyId: user.academyId };
  if (user.role === "GUARDIAN") return { academyId: user.academyId, student: { guardian: { userId: user.id } } };
  if (user.role === "STUDENT") return { academyId: user.academyId, student: { userId: user.id, guardianId: null, isAdult: true } };
  return { id: { in: [] } };
}
