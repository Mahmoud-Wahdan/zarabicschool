import type { Prisma } from "../../generated/prisma/client";

import { isSession1ReportsReady } from "./session1-ready";

/**
 * Shared explicit column list for reading a full `reports` row.
 *
 * The generated Prisma client requests EVERY schema column on an implicit
 * (no-select) query — including the Session 1 columns (`language`,
 * `rejection_count`) that only exist after the owner applies migration
 * 20261018190000. Until then, any implicit read/write-return would fail with
 * P2022. This select keeps the exact pre-Session-1 row shape and adds the two
 * new columns only once the migration has landed (self-healing).
 */
export async function reportRowSelect(): Promise<Prisma.ReportSelect> {
  const session1Ready = await isSession1ReportsReady();
  return {
    id: true,
    academyId: true,
    sessionId: true,
    studentId: true,
    teacherId: true,
    reportType: true,
    status: true,
    attendanceOutcome: true,
    classRemark: true,
    summary: true,
    homework: true,
    notes: true,
    operationalEvents: true,
    extraTimeMinutes: true,
    extraTimeStatus: true,
    extraTimeReviewedById: true,
    extraTimeReviewedAt: true,
    submittedAt: true,
    rejectionReason: true,
    rejectedById: true,
    rejectedAt: true,
    approvedAt: true,
    approvedById: true,
    settledAt: true,
    archivedAt: true,
    createdAt: true,
    updatedAt: true,
    ...(session1Ready ? { language: true, rejectionCount: true } : {}),
  };
}
