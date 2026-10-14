import "server-only";

import type { NotificationJob, Prisma } from "../../generated/prisma/client";

import { runSerializable } from "../credits/reservation";
import { getMessagingProvider } from "../messaging/provider";
import { prisma } from "../prisma";
import { addWeeksInTimeZone } from "../schedules/recurrence";
import { generateSeriesWeek, type SeriesForGeneration, type SeriesRecurrenceRule } from "../schedules/series";

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

function formatSessionTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("ar-EG", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(instant);
}

type JobWithRelations = NotificationJob & {
  recipientUser: { id: string; phone: string | null; isActive: boolean };
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
  if (job.session) {
    const subject = job.session.subject.nameAr;
    // Late-report nudges reference the scheduled END ("the session that ended at …");
    // session reminders reference the start (Phase 5 review F-08).
    const anchor = isReportNudgeKind(job.kind) ? job.session.scheduledEnd : job.session.scheduledStart;
    const time = formatSessionTime(anchor, job.session.timezone);
    if (job.kind === "SESSION_START") {
      return `حصتك (${subject}) بدأت الآن. رابط الحضور: ${job.session.zoomJoinUrl}`;
    }
    if (job.kind === "REPORT_REMINDER") {
      return `لديك تقرير غير مسجل لحصة ${subject} التي انتهت في ${time} (${job.session.timezone}).`;
    }
    if (job.kind === "REPORT_REMINDER_FOLLOWUP") {
      return `التقرير ما زال ناقصاً لحصة ${subject} المنتهية في ${time}. يرجى تسجيله.`;
    }
    return `تذكير: حصتك (${subject}) تبدأ في ${time} (${job.session.timezone}).`;
  }
  if (job.kind === "SERIES_PAUSED") {
    return "توقّف جدول حصص متكرر مؤقتاً لعدم توفر رصيد أحد الطلاب، وسيُستكمل تلقائياً عند توفر الرصيد.";
  }
  return "لديك إشعار من الأكاديمية.";
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
      recipientUser: { select: { id: true, phone: true, isActive: true } },
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
    const nextWeekIndex = series.generatedThroughWeek + 1;
    if (nextWeekIndex >= series.totalWeeks) continue;
    const rule = series.recurrenceRule as unknown as SeriesRecurrenceRule;
    const nextStart = addWeeksInTimeZone(new Date(rule.scheduledStart), nextWeekIndex, series.timezone);
    if (nextStart.getTime() > now.getTime() + EXTENSION_HORIZON_MS) continue;
    try {
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
          recurrenceRule: rule,
        };
        return generateSeriesWeek(tx, seriesRecord, nextWeekIndex);
      });
    } catch {
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
