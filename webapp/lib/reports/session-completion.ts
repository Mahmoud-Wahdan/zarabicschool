import "server-only";

import type { Prisma } from "../../generated/prisma/client";

/**
 * Session completion by reports (owner decision, 2026-10-25): each roster student
 * has an independent report; a session stays SCHEDULED until EVERY roster student
 * has a submitted session report (any status — a later rejection never reverts the
 * session), and at that moment it becomes COMPLETED.
 *
 * Runs inside the SAME transaction as the report write. Completion is a status
 * change only: it never writes SubscriptionLedger or PayrollLedger — settlement
 * stays driven by Admin/Supervisor approval of each report.
 */

/**
 * Row lock on the session for the rest of the transaction. Two concurrent "last"
 * reports would otherwise each count N-1 under READ COMMITTED (write skew) and
 * neither would complete the session; with the lock the second one waits and then
 * counts both.
 */
export async function lockSessionForReport(tx: Prisma.TransactionClient, sessionId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
}

/**
 * SCHEDULED → COMPLETED when every roster student has a session report. Idempotent:
 * the conditional update matches only a SCHEDULED session, so resubmits and replays
 * write nothing; CANCELLED/MISSED sessions are never touched. Returns true only when
 * this call performed the transition.
 */
export async function completeSessionIfFullyReported(tx: Prisma.TransactionClient, sessionId: string): Promise<boolean> {
  const [rosterCount, reportedStudents] = await Promise.all([
    tx.sessionStudent.count({ where: { sessionId } }),
    // Roster students that HAVE a report (unique per session+student+type), so a report
    // for someone no longer on the roster can never stand in for a missing one.
    tx.sessionStudent.count({
      where: { sessionId, student: { reports: { some: { sessionId, reportType: "SESSION_COMPLETION_REPORT" } } } },
    }),
  ]);
  if (rosterCount === 0 || reportedStudents < rosterCount) return false;
  const updated = await tx.session.updateMany({
    where: { id: sessionId, status: "SCHEDULED" },
    data: { status: "COMPLETED" },
  });
  return updated.count === 1;
}
