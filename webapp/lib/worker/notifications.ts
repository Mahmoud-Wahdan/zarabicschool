import "server-only";

import type { NotificationJob, Prisma } from "../../generated/prisma/client";

import { runSerializable } from "../credits/reservation";
import { getMessagingProvider } from "../messaging/provider";
import { prisma } from "../prisma";
import { addWeeksInTimeZone } from "../schedules/recurrence";
import { generateSeriesWeek, parseSeriesRule, SeriesRuleError, type SeriesForGeneration } from "../schedules/series";

const POLL_BATCH = 50;
const EXTENSION_HORIZON_MS = 14 * 24 * 60 * 60 * 1000;
// 24h scan window (owner decision 2026-10-14, Phase 5 review F-10): a worker outage no
// longer silently drops reminders and the red flag; unique dedup keys still guarantee
// each nudge/flag happens exactly once.
const LATE_REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;
const LATE_REPORT_FOLLOWUP_MS = 15 * 60 * 1000;
const LATE_REPORT_FLAG_MS = 30 * 60 * 1000;

function isReportNudgeKind(kind: string) {
  return kind === "REPORT_REMINDER" || kind === "REPORT_REMINDER_FOLLOWUP";
}

function formatSessionTime(instant: Date, timeZone: string, language: "ar" | "en"): string {
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "ar-EG", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(instant);
}

type JobWithRelations = NotificationJob & {
  recipientUser: { id: string; phone: string | null; isActive: boolean; preferredLanguage: string; timezone: string };
  session: {
    scheduledStart: Date;
    scheduledEnd: Date;
    timezone: string;
    zoomJoinUrl: string;
    status: string;
    subject: { nameAr: string; nameEn: string };
  } | null;
};

// Exported for the late-report chain unit tests (message/time assertions).
export function composeJobMessage(job: JobWithRelations): string {
  // Templates in Arabic + English by the RECIPIENT's language; times rendered in the
  // RECIPIENT's IANA timezone when known, falling back to the session's (Batch D).
  const language: "ar" | "en" = job.recipientUser.preferredLanguage === "en" ? "en" : "ar";
  if (job.session) {
    const subject = language === "en" ? job.session.subject.nameEn : job.session.subject.nameAr;
    const timeZone = job.recipientUser.timezone || job.session.timezone;
    // Late-report nudges reference the scheduled END ("the session that ended at …");
    // session reminders reference the start (Phase 5 review F-08).
    const anchor = isReportNudgeKind(job.kind) ? job.session.scheduledEnd : job.session.scheduledStart;
    const time = formatSessionTime(anchor, timeZone, language);
    if (language === "en") {
      if (job.kind === "SESSION_START") {
        return `Your session (${subject}) has started. Join link: ${job.session.zoomJoinUrl}`;
      }
      if (job.kind === "REPORT_REMINDER") {
        return `The report for ${subject} (ended ${time}, ${timeZone}) is still missing. Please submit it.`;
      }
      if (job.kind === "REPORT_REMINDER_FOLLOWUP") {
        return `Reminder: the report for ${subject} (ended ${time}) is still missing.`;
      }
      return `Reminder: your session (${subject}) starts at ${time} (${timeZone}).`;
    }
    if (job.kind === "SESSION_START") {
      return `حصتك (${subject}) بدأت الآن. رابط الحضور: ${job.session.zoomJoinUrl}`;
    }
    if (job.kind === "REPORT_REMINDER") {
      return `لديك تقرير غير مسجل لحصة ${subject} التي انتهت في ${time} (${timeZone}).`;
    }
    if (job.kind === "REPORT_REMINDER_FOLLOWUP") {
      return `التقرير ما زال ناقصاً لحصة ${subject} المنتهية في ${time}. يرجى تسجيله.`;
    }
    return `تذكير: حصتك (${subject}) تبدأ في ${time} (${timeZone}).`;
  }
  if (job.kind === "SESSION_REQUEST") {
    // Outage/absence requests land in the Admin/Supervisor queue (CONTEXT §6);
    // these jobs carry no session link, so no join URL or schedule is involved.
    return language === "en"
      ? "A new outage/absence request is waiting for review."
      : "طلب غياب/عطل جديد في انتظار مراجعة الإدارة.";
  }
  if (job.kind === "BALANCE_NEGATIVE") {
    // Admin-only flag (Phase 6): a settlement drove a subscription negative.
    // No amounts are included — the Admin reviews the ledger in the dashboard.
    return language === "en"
      ? "A student package balance went negative after a session settlement. Please review it in the payroll dashboard."
      : "أصبح رصيد باقة أحد الطلاب سالبًا بعد تسوية حصة. يرجى مراجعته من لوحة الرواتب.";
  }
  if (job.kind === "OVERTIME_DECISION") {
    // Teacher notice after the Admin reviews an overtime claim — no amounts.
    return language === "en"
      ? "Your overtime claim was reviewed by the Admin. See the payroll page for your updated earnings."
      : "تمت مراجعة طلب الوقت الإضافي من قبل الإدارة. يمكنك مراجعة أرباحك المحدثة في صفحة الرواتب.";
  }
  if (job.kind === "REPORT_APPROVED") {
    return language === "en"
      ? "The session report has been approved. You can review the homework and attachments on the dashboard."
      : "تم اعتماد تقرير الحصة. يمكنك مراجعة الواجب والمرفقات من لوحة التحكم.";
  }
  if (job.kind === "REPORT_REJECTED") {
    return language === "en"
      ? "Your session report was rejected. Please edit it and resubmit."
      : "تم رفض تقرير الحصة. يرجى تعديله وإعادة إرساله.";
  }
  if (job.kind === "SERIES_PAUSED") {
    return language === "en"
      ? "A recurring schedule paused temporarily because a student ran out of credit; it resumes automatically when credit is available."
      : "توقّف جدول حصص متكرر مؤقتاً لعدم توفر رصيد أحد الطلاب، وسيُستكمل تلقائياً عند توفر الرصيد.";
  }
  return language === "en" ? "You have a notification from the academy." : "لديك إشعار من الأكاديمية.";
}

async function sessionFullyReported(sessionId: string): Promise<boolean> {
  const [rosterCount, reportCount] = await Promise.all([
    prisma.sessionStudent.count({ where: { sessionId } }),
    prisma.report.count({ where: { sessionId, reportType: "SESSION_COMPLETION_REPORT" } }),
  ]);
  return rosterCount > 0 && reportCount >= rosterCount;
}

export async function processDueNotificationJobs(now = new Date(), academyId?: string) {
  const due = await prisma.notificationJob.findMany({
    where: {
      status: "PENDING",
      scheduledFor: { lte: now },
      ...(academyId ? { academyId } : {}),
    },
    orderBy: { scheduledFor: "asc" },
    take: POLL_BATCH,
    include: {
      recipientUser: { select: { id: true, phone: true, isActive: true, preferredLanguage: true, timezone: true } },
      session: {
        select: {
          scheduledStart: true,
          scheduledEnd: true,
          timezone: true,
          zoomJoinUrl: true,
          status: true,
          subject: { select: { nameAr: true, nameEn: true } },
        },
      },
    },
  });
  if (!due.length) return;
  const provider = getMessagingProvider();
  for (const job of due as JobWithRelations[]) {
    const claimed = await prisma.notificationJob.updateMany({
      where: { id: job.id, status: "PENDING" },
      data: { status: "PROCESSING", attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;
    if (job.sessionId && !job.session) {
      await prisma.notificationJob.update({ where: { id: job.id }, data: { status: "CANCELLED" } });
      continue;
    }
    if (job.session) {
      // Session nudges only fire while the session is SCHEDULED; late-report nudges also
      // fire for COMPLETED sessions because a completed session still owes its reports
      // (Phase 5 review F-09). Cancelled and missed sessions never owe reports.
      const sessionEligible =
        job.session.status === "SCHEDULED" ||
        (isReportNudgeKind(job.kind) && job.session.status === "COMPLETED");
      if (!sessionEligible) {
        await prisma.notificationJob.update({ where: { id: job.id }, data: { status: "CANCELLED" } });
        continue;
      }
      if (isReportNudgeKind(job.kind) && job.sessionId && (await sessionFullyReported(job.sessionId))) {
        // Every roster student already has a report — cancel instead of sending
        // (Phase 5 review F-07; backstop for the submit-route cancellation).
        await prisma.notificationJob.update({ where: { id: job.id }, data: { status: "CANCELLED" } });
        continue;
      }
    }
    if (!job.recipientUser.isActive) {
      await prisma.notificationJob.update({ where: { id: job.id }, data: { status: "CANCELLED" } });
      continue;
    }
    const message = composeJobMessage(job);
    const result = await provider.sendText({ userId: job.recipientUser.id, phone: job.recipientUser.phone }, message);
    await prisma.notificationJob.update({
      where: { id: job.id },
      data: result.ok
        ? { status: "SENT", sentAt: new Date(), lastError: null }
        : { status: "FAILED", lastError: result.error ?? "Messaging provider failed." },
    });
  }
}

export async function processLateReportNotifications(now = new Date(), academyId?: string) {
  // Re-arm report nudges that failed once (transient provider outage) so a single
  // failure never permanently silences the chain — exactly ONE retry (attempts < 2;
  // owner decision 2026-10-14, Phase 5 review F-13). The sender re-checks session
  // and report state before sending, so re-armed jobs for handled sessions are
  // cancelled, never mis-sent.
  await prisma.notificationJob.updateMany({
    where: {
      kind: { in: ["REPORT_REMINDER", "REPORT_REMINDER_FOLLOWUP"] },
      status: "FAILED",
      attempts: { lt: 2 },
      ...(academyId ? { academyId } : {}),
    },
    data: { status: "PENDING", scheduledFor: now, lastError: null },
  });
  const windowStart = new Date(now.getTime() - LATE_REPORT_WINDOW_MS);
  const sessions = await prisma.session.findMany({
    where: {
      status: { in: ["SCHEDULED", "COMPLETED"] },
      scheduledEnd: { gte: windowStart, lte: now },
      ...(academyId ? { academyId } : {}),
    },
    select: {
      id: true,
      academyId: true,
      scheduledEnd: true,
      timezone: true,
      teacher: { select: { id: true, user: { select: { id: true, phone: true, isActive: true } } } },
      students: { select: { studentId: true } },
    },
  });
  if (!sessions.length) return;
  const sessionIds = sessions.map((session) => session.id);
  const reports = await prisma.report.findMany({
    where: { sessionId: { in: sessionIds } },
    select: { sessionId: true, studentId: true },
  });
  const reported = new Set(reports.map((report) => `${report.sessionId}:${report.studentId}`));
  const flagged = new Set(
    (
      await prisma.teacherFlag.findMany({
        where: { sessionId: { in: sessionIds }, flagType: "LATE_REPORT" },
        select: { sessionId: true },
      })
    ).map((flag) => flag.sessionId),
  );
  const jobs: Prisma.NotificationJobCreateManyInput[] = [];
  for (const session of sessions) {
    if (session.students.every((student) => reported.has(`${session.id}:${student.studentId}`))) continue;
    if (!session.teacher.user.isActive) continue;
    const sinceEndMs = now.getTime() - session.scheduledEnd.getTime();
    if (sinceEndMs >= LATE_REPORT_FLAG_MS && !flagged.has(session.id)) {
      await prisma.teacherFlag.upsert({
        where: { sessionId_flagType: { sessionId: session.id, flagType: "LATE_REPORT" } },
        create: {
          academyId: session.academyId,
          teacherId: session.teacher.id,
          sessionId: session.id,
          flagType: "LATE_REPORT",
        },
        update: {},
      });
    }
    const base = {
      academyId: session.academyId,
      sessionId: session.id,
      recipientUserId: session.teacher.user.id,
      scheduledFor: now,
    };
    jobs.push({ ...base, kind: "REPORT_REMINDER", dedupKey: `REPORT_REMINDER:${session.id}` });
    if (sinceEndMs >= LATE_REPORT_FOLLOWUP_MS) {
      jobs.push({ ...base, kind: "REPORT_REMINDER_FOLLOWUP", dedupKey: `REPORT_REMINDER_FOLLOWUP:${session.id}` });
    }
  }
  if (jobs.length) {
    await prisma.notificationJob.createMany({ data: jobs, skipDuplicates: true });
  }
}

export async function extendDueSeries(now = new Date(), academyId?: string) {
  const seriesList = await prisma.recurrenceSeries.findMany({
    where: { status: { in: ["ACTIVE", "PAUSED"] }, ...(academyId ? { academyId } : {}) },
  });
  for (const series of seriesList) {
    try {
      const nextWeekIndex = series.generatedThroughWeek + 1;
      if (nextWeekIndex >= series.totalWeeks) continue;
      // Validate BEFORE touching the database: a persisted rule with missing or
      // malformed scheduledStart/scheduledEnd (e.g. legacy seed data) is skipped
      // with a specific warning instead of killing the whole loop with
      // "Invalid time value" from Intl (Phase 5 completion, 2026-10-18).
      const parsed = parseSeriesRule(series.recurrenceRule);
      const nextStart = addWeeksInTimeZone(parsed.anchorStart, nextWeekIndex, series.timezone);
      if (Number.isNaN(nextStart.getTime())) continue;
      if (nextStart.getTime() > now.getTime() + EXTENSION_HORIZON_MS) continue;
      await runSerializable(async (tx) => {
        const fresh = await tx.recurrenceSeries.findUnique({ where: { id: series.id } });
        if (
          !fresh ||
          fresh.generatedThroughWeek !== series.generatedThroughWeek ||
          fresh.status === "COMPLETED" ||
          fresh.status === "CANCELLED"
        ) {
          return null;
        }
        const seriesRecord: SeriesForGeneration = {
          id: fresh.id,
          academyId: fresh.academyId,
          teacherId: fresh.teacherId,
          subjectId: fresh.subjectId,
          sessionType: fresh.sessionType,
          timezone: fresh.timezone,
          totalWeeks: fresh.totalWeeks,
          createdById: fresh.createdById,
          recurrenceRule: parsed.rule,
        };
        return generateSeriesWeek(tx, seriesRecord, nextWeekIndex);
      });
    } catch (cause) {
      if (cause instanceof SeriesRuleError) {
        console.error(`[worker] recurring series ${series.id} has a malformed rule and was skipped (${cause.message}).`);
        continue;
      }
      console.error("[worker] a recurring series extension attempt failed.");
    }
  }
}

export async function runWorkerTick(now = new Date()) {
  try {
    await processDueNotificationJobs(now);
  } catch (cause) {
    console.error("[worker] notification job processing failed.", cause instanceof Error ? cause.message : cause);
  }
  try {
    await processLateReportNotifications(now);
  } catch (cause) {
    console.error("[worker] late report processing failed.", cause instanceof Error ? cause.message : cause);
  }
  try {
    await extendDueSeries(now);
  } catch (cause) {
    console.error("[worker] series extension failed.", cause instanceof Error ? cause.message : cause);
  }
}
