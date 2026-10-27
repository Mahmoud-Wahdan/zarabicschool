import "server-only";

import type { InvoiceStatus } from "../../generated/prisma/client";
import { prisma } from "../prisma";

/**
 * Supervisor-safe finance read model (S-09 / D11 + D29, owner 2026-10-27). Two
 * numbers per student and nothing else — never an amount, a currency or an invoice:
 * - `remainingSessions`: credit left in the ACTIVE package(s) (ledger sum) minus the
 *   sessions currently RESERVED against them;
 * - `paymentStatus`: the status of the student's latest invoice (PAID / PENDING /
 *   FAILED / CANCELLED), or null when there is none.
 * Read-only; acting on finance stays behind `canActOnStudentFinance`.
 */
export type StudentFinanceStatus = { remainingSessions: number; paymentStatus: InvoiceStatus | null };

export async function getStudentFinanceStatus(
  academyId: string,
  studentIds: string[],
): Promise<Map<string, StudentFinanceStatus>> {
  const result = new Map<string, StudentFinanceStatus>(
    studentIds.map((id) => [id, { remainingSessions: 0, paymentStatus: null }]),
  );
  if (studentIds.length === 0) return result;
  const [subscriptions, latestInvoices] = await Promise.all([
    prisma.subscription.findMany({
      where: { academyId, studentId: { in: studentIds }, status: "ACTIVE" },
      select: {
        studentId: true,
        ledgerEntries: { select: { sessionsDelta: true } },
        _count: { select: { reservations: { where: { status: "RESERVED" } } } },
      },
    }),
    prisma.invoice.findMany({
      where: { academyId, studentId: { in: studentIds } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      distinct: ["studentId"],
      select: { studentId: true, status: true },
    }),
  ]);
  for (const subscription of subscriptions) {
    const entry = result.get(subscription.studentId);
    if (!entry) continue;
    const credit = subscription.ledgerEntries.reduce((total, row) => total + row.sessionsDelta, 0);
    entry.remainingSessions += credit - subscription._count.reservations;
  }
  for (const invoice of latestInvoices) {
    const entry = result.get(invoice.studentId);
    if (entry) entry.paymentStatus = invoice.status;
  }
  return result;
}
