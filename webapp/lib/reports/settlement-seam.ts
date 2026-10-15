import "server-only";

import type { Prisma } from "../../generated/prisma/client";

/**
 * The ONE settlement seam (Phase 5 hard rule: no money moves in Phase 5).
 *
 * Phase 6 fills this in the SAME transaction: the SubscriptionLedger
 * `SESSION_DEDUCTION` (only when the outcome is ATTENDED), the PayrollLedger
 * `SESSION_CREDIT` (scheduled duration × hourly rate, once per session, rate
 * snapshot), and `Reports.settled_at` + `archived_at`. Until Phase 6 this is a
 * deliberate no-op so the approval transaction already runs through the exact
 * hook point where settlement will land — nothing else may write money.
 */
export async function settleApprovedReport(
  _tx: Prisma.TransactionClient,
  _report: { id: string; sessionId: string; studentId: string; attendanceOutcome: "ATTENDED" | "STUDENT_ABSENT" },
): Promise<void> {
  // Intentionally empty — Phase 6 replaces this body in the same transaction.
  void _tx;
  void _report;
}
