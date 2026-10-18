import "server-only";

import { prisma } from "../prisma";

/**
 * Post-commit notification enqueue for report decisions (Batch D):
 * - APPROVED → the guardian gets the WhatsApp notice (CONFIRMED, CONTEXT §8); an adult
 *   student without a guardian receives it instead (owner decision 2026-10-14).
 * - REJECTED → the teacher gets the rejection notice so she can fix and resubmit.
 * Jobs are created AFTER the approval/rejection transaction commits and a failure here
 * never rolls the decision back (the caller wraps this in try/catch). The jobs carry no
 * session link, so the worker's session guards never suppress them, and they store no
 * message content (redacted by omission; the worker composes the text at send time).
 */
export async function enqueueReportDecisionNotifications(input: {
  reportId: string;
  action: "APPROVE" | "REJECT";
  rejectedAt?: Date;
}): Promise<void> {
  const report = await prisma.report.findFirst({
    where: { id: input.reportId },
    select: {
      id: true,
      academyId: true,
      student: { select: { userId: true, guardianId: true } },
      teacher: { select: { userId: true } },
    },
  });
  if (!report) return;

  if (input.action === "APPROVE") {
    let recipientUserId = report.student.userId;
    if (report.student.guardianId) {
      const guardian = await prisma.guardian.findFirst({
        where: { id: report.student.guardianId },
        select: { userId: true },
      });
      if (guardian) recipientUserId = guardian.userId;
    }
    await prisma.notificationJob.create({
      data: {
        academyId: report.academyId,
        sessionId: null,
        recipientUserId,
        kind: "REPORT_APPROVED",
        dedupKey: `REPORT_APPROVED:${report.id}`,
        scheduledFor: new Date(),
      },
    });
    return;
  }

  // REJECTED — a report can be rejected again after a resubmission, so the dedup key
  // includes the rejection timestamp.
  await prisma.notificationJob.create({
    data: {
      academyId: report.academyId,
      sessionId: null,
      recipientUserId: report.teacher.userId,
      kind: "REPORT_REJECTED",
      dedupKey: `REPORT_REJECTED:${report.id}:${(input.rejectedAt ?? new Date()).toISOString()}`,
      scheduledFor: new Date(),
    },
  });
}
