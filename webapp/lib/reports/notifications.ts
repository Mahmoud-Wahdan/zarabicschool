import "server-only";

import { prisma } from "../prisma";
import { isSession1ReportsReady } from "./session1-ready";

/**
 * Post-commit notification enqueue for report events.
 *
 * Session 1 (owner, 2026-10-18 — CONTEXT §6 chain item 3b / §8 / §9):
 * - SUBMITTED → the guardian AND the student (per the visibility rules) are
 *   notified immediately. The notice is composed in the REPORT's language when
 *   a template exists, else the recipient's locale (worker-side).
 *   Admin/Supervisor review has NO effect on visibility or delivery.
 * - APPROVE → nothing. Approval concerns teacher pay only; the family was
 *   already notified on submission. (Supersedes the old guardian notice.)
 * - REJECTED → the teacher gets the rejection notice so she can fix and resubmit.
 *
 * If a report is rejected and corrected, it is the same row: viewers see the
 * latest content, and NO second WhatsApp is sent for the same report
 * (PROPOSAL — enforced by the per-report+recipient dedup key below).
 *
 * Jobs are created AFTER the submit/reject transaction commits and a failure
 * here never rolls anything back (the caller wraps this in try/catch). The
 * jobs carry no session link, so the worker's session guards never suppress
 * them, and they store no message content (redacted by omission; the worker
 * composes the text at send time).
 */
export async function enqueueReportSubmittedNotifications(input: { reportId: string }): Promise<void> {
  // Deferred (not lost) if the Session 1 migration is not applied yet: once it
  // lands, the next submission (or resubmission) enqueues normally.
  if (!(await isSession1ReportsReady())) return;
  const report = await prisma.report.findFirst({
    where: { id: input.reportId },
    select: {
      id: true,
      academyId: true,
      language: true,
      student: { select: { userId: true, guardianId: true } },
    },
  });
  if (!report) return;

  // Recipients: the guardian (whole report) and the student (homework, notes,
  // attachments when the student has a guardian; whole report when adult
  // without a guardian). One job per recipient, deduped per report+recipient
  // so a rejection/correction cycle never re-sends the same report.
  const recipientUserIds = new Set<string>([report.student.userId]);
  if (report.student.guardianId) {
    const guardian = await prisma.guardian.findFirst({
      where: { id: report.student.guardianId },
      select: { userId: true },
    });
    if (guardian) recipientUserIds.add(guardian.userId);
  }

  await prisma.notificationJob.createMany({
    data: [...recipientUserIds].map((recipientUserId) => ({
      academyId: report.academyId,
      sessionId: null,
      // The worker composes the notice in the REPORT's language (CONTEXT §9);
      // the job row stores only the ids — no message content (redacted by omission).
      reportId: report.id,
      recipientUserId,
      kind: "REPORT_SUBMITTED",
      dedupKey: `REPORT_SUBMITTED:${report.id}:${recipientUserId}`,
      scheduledFor: new Date(),
    })),
    skipDuplicates: true,
  });
}

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
      teacher: { select: { userId: true } },
    },
  });
  if (!report) return;

  if (input.action === "APPROVE") {
    // Nothing to send: the family was notified on SUBMIT (owner, 2026-10-18);
    // approval concerns teacher pay only.
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
    select: { id: true },
  });
}

/**
 * Monthly-report submit notice (Session 1 — CONTEXT §4A/§9): the same
 * delivery rule as session reports — the guardian and the student (per the
 * visibility rules) are notified the moment the monthly report is submitted.
 * Deduped per report+recipient; edits inside the 7-day window never re-send.
 * The worker composes the text in the REPORT's language.
 */
export async function enqueueMonthlyReportSubmittedNotifications(input: { monthlyReportId: string }): Promise<void> {
  if (!(await isSession1ReportsReady())) return;
  const report = await prisma.monthlyReport.findFirst({
    where: { id: input.monthlyReportId },
    select: {
      id: true,
      academyId: true,
      monthKey: true,
      student: { select: { userId: true, guardianId: true } },
    },
  });
  if (!report) return;

  const recipientUserIds = new Set<string>([report.student.userId]);
  if (report.student.guardianId) {
    const guardian = await prisma.guardian.findFirst({
      where: { id: report.student.guardianId },
      select: { userId: true },
    });
    if (guardian) recipientUserIds.add(guardian.userId);
  }

  await prisma.notificationJob.createMany({
    data: [...recipientUserIds].map((recipientUserId) => ({
      academyId: report.academyId,
      sessionId: null,
      recipientUserId,
      kind: "MONTHLY_REPORT_SUBMITTED",
      dedupKey: `MONTHLY_REPORT_SUBMITTED:${report.id}:${recipientUserId}`,
      scheduledFor: new Date(),
      // Redacted composition context: ids/keys only (CONTEXT §5/§24).
      payload: { monthlyReportId: report.id, monthKey: report.monthKey },
    })),
    skipDuplicates: true,
  });
}
