import "server-only";

import type { NotificationJob, Prisma } from "../../generated/prisma/client";

import {
  ANNOUNCEMENT_MAX_PER_BATCH,
  ANNOUNCEMENT_MAX_PER_HOUR,
  ANNOUNCEMENT_SEND_JITTER_MS,
  ANNOUNCEMENT_SEND_SPACING_MS,
} from "../config/announcements";
import {
  ADMIN_LATE_ALERT_MINUTES,
  LATE_START_SCAN_WINDOW_MINUTES,
  TEACHER_LATE_REMINDER_MINUTES,
} from "../config/lateness";
import { sessionJoinPlatformUrl } from "../config/platform-url";
import { JOIN_OPENS_BEFORE_START_MINUTES, joinWindowState } from "../config/session-join";
import { runSerializable } from "../credits/reservation";
import { processMonthlyCreditExpiry } from "./credits";
import { getMessagingProvider } from "../messaging/provider";
import { isWhatsAppDeliveryReady } from "../messaging/readiness";
import { prisma } from "../prisma";
import { monthKeyRangeUtc, previousMonthKey } from "../reports/month-key";
import { resolveReportLanguage, type ReportLanguageCode } from "../reports/report-language";
import { isSession1ReportsReady } from "../reports/session1-ready";
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
// Monthly-report missing reminders fire on the 1st and 3rd of each month, in the
// TEACHER's local calendar (CONFIRMED by the owner 2026-10-26 — CONTEXT §9).
const MONTHLY_REPORT_REMINDER_DAYS = [1, 3];
// Still missing after the last reminder → a MONTHLY_REPORT_MISSING teacher flag for
// the Admin (owner decision 7; timing CONFIRMED 2026-10-26). Days 4–7 of the
// teacher's local month form a scan window so a worker outage on the 4th does not
// drop the flag; the partial unique index keeps it to one flag per teacher and month.
const MONTHLY_REPORT_FLAG_FIRST_DAY = 4;
const MONTHLY_REPORT_FLAG_LAST_DAY = 7;
// Delivery hardening (WhatsApp slice, 2026-10-25). A TRANSIENT provider failure
// (network, OpenWA busy/paced, engine not ready, 5xx) is retried with a growing
// delay up to MAX_SEND_ATTEMPTS sends in total; a permanent failure (bad number,
// auth, missing config) goes straight to FAILED. CREDENTIALS jobs are never
// produced here (the approval route sends them directly), so the worker can
// never re-send a password.
const MAX_SEND_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2 * 60 * 1000, 10 * 60 * 1000];
// A job left in PROCESSING this long means the process died mid-send. It is
// marked FAILED, never re-sent automatically (the message may have gone out).
const STALE_PROCESSING_MS = 10 * 60 * 1000;
// Pause between two sends of one tick: OpenWA is unofficial and bursts raise
// the ban risk (CONTEXT §8).
const SEND_SPACING_MS = 1500;

function isReportNudgeKind(kind: string) {
  return kind === "REPORT_REMINDER" || kind === "REPORT_REMINDER_FOLLOWUP";
}

/** Late-start steps (a) teacher reminder and (b) Admin alert — lib/config/lateness.ts. */
function isLateStartKind(kind: string) {
  return kind === "TEACHER_LATE_START" || kind === "TEACHER_LATE_START_ADMIN";
}

function formatSessionTime(instant: Date, timeZone: string, language: "ar" | "en"): string {
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "ar-EG", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(instant);
}

function formatMonthLabel(monthKey: string, language: string): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  if (!year || !month) return monthKey;
  const instant = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : language === "ar" ? "ar-EG" : language, { timeZone: "UTC", month: "long", year: "numeric" }).format(instant);
}

/** Local calendar day for a teacher's timezone (DST-safe via Intl, CONTEXT §6). */
function localDayOfMonth(instant: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, day: "2-digit" }).formatToParts(instant);
    const day = parts.find((part) => part.type === "day")?.value;
    return day ? Number(day) : null;
  } catch {
    return null;
  }
}

type JobWithRelations = NotificationJob & {
  recipientUser: { id: string; phone: string | null; isActive: boolean; preferredLanguage: string; timezone: string };
  session: {
    scheduledStart: Date;
    scheduledEnd: Date;
    timezone: string;
    status: string;
    subject: { nameAr: string; nameEn: string };
    teacher?: { userId: string; user: { displayName: string } };
  } | null;
  report?: {
    language: string;
    student: { user: { displayName: string } };
    session: { scheduledEnd: Date; timezone: string; subject: { nameAr: string; nameEn: string } };
  } | null;
  monthlyReport?: {
    id: string;
    monthKey: string;
    language: string;
    student: { user: { displayName: string } };
  } | null;
  /** ADMIN_MESSAGE body, loaded from admin_messages at send time (never stored on the job). */
  adminMessageBody?: string | null;
  /** ANNOUNCEMENT text, loaded from announcements at send time (never stored on the job). */
  announcement?: { title: string; body: string } | null;
};

// Exported for the late-report chain unit tests (message/time assertions).
export function composeJobMessage(job: JobWithRelations): string {
  // Templates in Arabic + English by the RECIPIENT's language; times rendered in the
  // RECIPIENT's IANA timezone when known, falling back to the session's (Batch D).
  const language: "ar" | "en" = job.recipientUser.preferredLanguage === "en" ? "en" : "ar";

  // Session 1 (owner, 2026-10-18 — CONTEXT §8/§9): the report notice is composed
  // in the REPORT's language when a template exists (all five today), else the
  // recipient's locale. Never any hardcoded minutes or free text from the job row.
  if (job.kind === "REPORT_SUBMITTED" && job.report) {
    const reportLanguage = resolveReportLanguage(job.report.language);
    const subject = reportLanguage === "ar" ? job.report.session.subject.nameAr : job.report.session.subject.nameEn;
    const studentName = job.report.student.user.displayName;
    const timeZone = job.recipientUser.timezone || job.report.session.timezone;
    const time = new Intl.DateTimeFormat(
      reportLanguage === "ar" ? "ar-EG" : reportLanguage === "en" ? "en-GB" : reportLanguage,
      { timeZone, dateStyle: "medium", timeStyle: "short" },
    ).format(job.report.session.scheduledEnd);
    const templates: Record<ReportLanguageCode, string> = {
      ar: `تقرير جديد متاح للطالب ${studentName} بعد حصة ${subject} التي انتهت في ${time}. يمكنك مراجعته من لوحة التحكم.`,
      en: `A new report for ${studentName} is available after the ${subject} session that ended at ${time}. Review it on your dashboard.`,
      fr: `Un nouveau rapport pour ${studentName} est disponible après le cours de ${subject} qui s'est terminé à ${time}. Consultez-le sur votre tableau de bord.`,
      de: `Ein neuer Bericht für ${studentName} ist nach der ${subject}-Unterrichtsstunde verfügbar, die um ${time} endete. Sehen Sie ihn sich im Dashboard an.`,
      tr: `${studentName} için ${subject} dersi sona erdikten sonra (${time}) yeni bir rapor hazır. Panelden inceleyebilirsiniz.`,
    };
    return templates[reportLanguage];
  }
  if (job.kind === "MONTHLY_REPORT_SUBMITTED" && job.monthlyReport) {
    // Composed in the report's language (CONTEXT §9); the month label follows it.
    const reportLanguage = resolveReportLanguage(job.monthlyReport.language);
    const studentName = job.monthlyReport.student.user.displayName;
    const month = formatMonthLabel(job.monthlyReport.monthKey, reportLanguage);
    const templates: Record<ReportLanguageCode, string> = {
      ar: `التقرير الشهري لـ ${studentName} لشهر ${month} أصبح متاحًا. يمكنك مراجعته من لوحة التحكم.`,
      en: `The monthly report for ${studentName} (${month}) is now available. Review it on your dashboard.`,
      fr: `Le rapport mensuel de ${studentName} (${month}) est disponible. Consultez-le sur votre tableau de bord.`,
      de: `Der Monatsbericht für ${studentName} (${month}) ist jetzt verfügbar. Sehen Sie ihn sich im Dashboard an.`,
      tr: `${studentName} için aylık rapor (${month}) hazır. Panelden inceleyebilirsiniz.`,
    };
    return templates[reportLanguage];
  }
  if (job.kind === "ANNOUNCEMENT" && job.announcement) {
    // Admin/Supervisor announcement to everyone: their own text, verbatim.
    return `${job.announcement.title}\n\n${job.announcement.body}`;
  }
  if (job.kind === "ADMIN_MESSAGE" && job.adminMessageBody) {
    // Admin individual message: the Admin's own text, verbatim (Admin-only feature).
    return job.adminMessageBody;
  }
  if (job.kind === "MONTHLY_REPORT_REMINDER") {
    // Operational nudge to the TEACHER (recipient locale ar/en): missing monthly
    // reports for the previous month. The month/count come from the redacted
    // payload (ids/keys only — never message content, CONTEXT §5/§24).
    const payload = (job.payload as { monthKey?: unknown; missingCount?: unknown } | null) ?? null;
    const monthKey = typeof payload?.monthKey === "string" ? payload.monthKey : "";
    const missingCount = typeof payload?.missingCount === "number" ? payload.missingCount : 0;
    const month = monthKey ? formatMonthLabel(monthKey, language) : "";
    return language === "en"
      ? `Reminder: ${missingCount} monthly report${missingCount === 1 ? "" : "s"} for ${month} still missing. Please submit them from the monthly reports page.`
      : `تذكير: لديك ${missingCount} تقرير شهري مفقود لشهر ${month}. يرجى إرسالها من صفحة التقارير الشهرية.`;
  }
  if (job.session) {
    const subject = language === "en" ? job.session.subject.nameEn : job.session.subject.nameAr;
    const timeZone = job.recipientUser.timezone || job.session.timezone;
    // Late-report nudges reference the scheduled END ("the session that ended at …");
    // session reminders reference the start (Phase 5 review F-08).
    const anchor = isReportNudgeKind(job.kind) ? job.session.scheduledEnd : job.session.scheduledStart;
    const time = formatSessionTime(anchor, timeZone, language);
    // Join links (owner, 2026-10-26): NEVER the raw Zoom link in any WhatsApp message.
    // Only the platform's join redirect, and only while its join window is open at
    // send time — before the window the text says when it opens instead of a link
    // that would answer "not yet open".
    const windowOpen = joinWindowState(job.session.scheduledStart, job.session.scheduledEnd) === "open";
    const joinUrl = windowOpen && job.sessionId ? sessionJoinPlatformUrl(job.sessionId) : null;
    if (job.kind === "TEACHER_LATE_START") {
      return language === "en"
        ? `Your session (${subject}) started at ${time} (${timeZone}) and the session link has not been opened yet. Please join now from the platform${joinUrl ? `: ${joinUrl}` : "."}`
        : `بدأت حصتك (${subject}) في ${time} (${timeZone}) ولم يتم فتح رابط الحصة بعد. يرجى الدخول الآن من المنصة${joinUrl ? `: ${joinUrl}` : "."}`;
    }
    if (job.kind === "TEACHER_LATE_START_ADMIN") {
      const teacherName = job.session.teacher?.user.displayName ?? "";
      return language === "en"
        ? `Teacher ${teacherName} has not opened the link of the ${subject} session that started at ${time} (${timeZone}).`
        : `المعلم ${teacherName} لم يفتح رابط حصة ${subject} التي بدأت في ${time} (${timeZone}).`;
    }
    if (language === "en") {
      if (job.kind === "SESSION_START") {
        return joinUrl
          ? `Your session (${subject}) has started. Join from the platform: ${joinUrl}`
          : `Your session (${subject}) has started. Please join from the platform.`;
      }
      if (job.kind === "REPORT_REMINDER") {
        return `The report for ${subject} (ended ${time}, ${timeZone}) is still missing. Please submit it.`;
      }
      if (job.kind === "REPORT_REMINDER_FOLLOWUP") {
        return `Reminder: the report for ${subject} (ended ${time}) is still missing.`;
      }
      return joinUrl
        ? `Reminder: your session (${subject}) starts at ${time} (${timeZone}). Join from the platform: ${joinUrl}`
        : `Reminder: your session (${subject}) starts at ${time} (${timeZone}). The join link opens on the platform ${JOIN_OPENS_BEFORE_START_MINUTES} minutes before the start.`;
    }
    if (job.kind === "SESSION_START") {
      return joinUrl
        ? `حصتك (${subject}) بدأت الآن. ادخل من المنصة: ${joinUrl}`
        : `حصتك (${subject}) بدأت الآن. يرجى الدخول من المنصة.`;
    }
    if (job.kind === "REPORT_REMINDER") {
      return `لديك تقرير غير مسجل لحصة ${subject} التي انتهت في ${time} (${timeZone}).`;
    }
    if (job.kind === "REPORT_REMINDER_FOLLOWUP") {
      return `التقرير ما زال ناقصاً لحصة ${subject} المنتهية في ${time}. يرجى تسجيله.`;
    }
    return joinUrl
      ? `تذكير: حصتك (${subject}) تبدأ في ${time} (${timeZone}). ادخل من المنصة: ${joinUrl}`
      : `تذكير: حصتك (${subject}) تبدأ في ${time} (${timeZone}). يُفتح رابط الدخول على المنصة قبل البداية بـ ${JOIN_OPENS_BEFORE_START_MINUTES} دقيقة.`;
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
  if (job.kind === "SETTLED_WITHOUT_SUBSCRIPTION") {
    // Admin-only flag (Phase 6 A5/P8): an attended session was approved for a student
    // with no active package — the teacher was credited, nothing was deducted.
    return language === "en"
      ? "A session report was approved for a student without an active package: the teacher was credited, no session was deducted. Please review it."
      : "تم اعتماد تقرير حصة لطالب ليس لديه باقة نشطة: تمت إضافة أجر المعلم ولم يُخصم أي رصيد. يرجى المراجعة.";
  }
  if (job.kind === "PAYMENT_ANOMALY") {
    // Admin-only flag (Phase 6 A1): a signed payment event that did not move money
    // and needs a human look. Reason code only — no amounts, no payer data.
    return language === "en"
      ? "A payment event needs your review (no money was moved automatically). Check the payments audit page."
      : "حدث دفع يحتاج إلى مراجعتك (لم تُنفَّذ أي حركة مالية تلقائيًا). راجع صفحة سجل المدفوعات.";
  }
  if (job.kind === "OVERTIME_DECISION") {
    // Teacher notice after the Admin reviews an overtime claim — no amounts.
    return language === "en"
      ? "Your overtime claim was reviewed by the Admin. See the payroll page for your updated earnings."
      : "تمت مراجعة طلب الوقت الإضافي من قبل الإدارة. يمكنك مراجعة أرباحك المحدثة في صفحة الرواتب.";
  }
  if (job.kind === "REPORT_APPROVED") {
    // Kept for historical job rows enqueued before the Session 1 change (the family
    // is now notified on SUBMIT instead — owner, 2026-10-18).
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Session reminders/start notices are pointless once the session has ended. */
function isSessionNoticeKind(kind: string) {
  return kind === "SESSION_REMINDER" || kind === "SESSION_START";
}

export async function recoverStaleProcessingJobs(now = new Date(), academyId?: string) {
  await prisma.notificationJob.updateMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lt: new Date(now.getTime() - STALE_PROCESSING_MS) },
      ...(academyId ? { academyId } : {}),
    },
    data: { status: "FAILED", lastError: "Worker interrupted during send; not retried automatically." },
  });
}

export async function processDueNotificationJobs(now = new Date(), academyId?: string) {
  // REPORT_SUBMITTED jobs (Session 1) carry a report link; the relation only exists
  // after the owner applies migration 20261018190000. Before that, no such jobs
  // exist (the enqueue gates on the same readiness check), so the include is
  // conditional and pre-migration sends keep working unchanged.
  const session1Ready = await isSession1ReportsReady();
  // Announcements never compete with time-critical kinds (session start notices,
  // late-start reminders): ordinary jobs get the full batch; announcement jobs are
  // fetched SEPARATELY and only up to the throttle budget (lib/config/announcements.ts:
  // per-tick cap + rolling-hour cap). Jobs over budget simply stay PENDING.
  const sentLastHour = await prisma.notificationJob.count({
    where: { kind: "ANNOUNCEMENT", status: "SENT", sentAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) } },
  });
  const announcementBudget = Math.max(0, Math.min(ANNOUNCEMENT_MAX_PER_BATCH, ANNOUNCEMENT_MAX_PER_HOUR - sentLastHour));
  const findDue = (kind: Prisma.StringFilter, take: number) => prisma.notificationJob.findMany({
    where: {
      status: "PENDING",
      scheduledFor: { lte: now },
      kind,
      ...(academyId ? { academyId } : {}),
    },
    orderBy: { scheduledFor: "asc" },
    take,
    // Explicit select (never `include`): the generated client requests every schema
    // column on implicit queries, and `payload`/`report_id` only exist once the
    // owner applies the Session 1 migration. The loop only needs these fields.
    select: {
      id: true,
      sessionId: true,
      kind: true,
      attempts: true,
      ...(session1Ready ? { payload: true } : {}),
      recipientUser: { select: { id: true, phone: true, isActive: true, preferredLanguage: true, timezone: true } },
      session: {
        select: {
          scheduledStart: true,
          scheduledEnd: true,
          timezone: true,
          status: true,
          subject: { select: { nameAr: true, nameEn: true } },
          teacher: { select: { userId: true, user: { select: { displayName: true } } } },
        },
      },
      ...(session1Ready
        ? {
            report: {
              select: {
                language: true,
                student: { select: { user: { select: { displayName: true } } } },
                session: {
                  select: {
                    scheduledEnd: true,
                    timezone: true,
                    subject: { select: { nameAr: true, nameEn: true } },
                  },
                },
              },
            },
          }
        : {}),
    },
  });
  const due = [
    ...(await findDue({ not: "ANNOUNCEMENT" }, POLL_BATCH)),
    ...(announcementBudget > 0 ? await findDue({ equals: "ANNOUNCEMENT" }, announcementBudget) : []),
  ];
  if (!due.length) return;
  const provider = getMessagingProvider();
  const deliveryReady = await isWhatsAppDeliveryReady();
  let sendsThisTick = 0;
  const announcementTally = { sent: 0, failed: 0 };
  for (const job of due as JobWithRelations[]) {
    const claimed = await prisma.notificationJob.updateMany({
      where: { id: job.id, status: "PENDING" },
      data: { status: "PROCESSING", attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;
    if (job.sessionId && !job.session) {
      await prisma.notificationJob.update({ where: { id: job.id }, data: { status: "CANCELLED" }, select: { id: true } });
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
        await prisma.notificationJob.update({ where: { id: job.id }, data: { status: "CANCELLED" }, select: { id: true } });
        continue;
      }
      if (isLateStartKind(job.kind)) {
        // Re-check at send time: the session must still be SCHEDULED and running,
        // and the assigned teacher must still have no link click.
        const clicked = job.session.teacher
          ? await prisma.sessionJoinClick.count({ where: { sessionId: job.sessionId!, userId: job.session.teacher.userId } })
          : 0;
        // A teacher replaced after enqueue never gets the old teacher's reminder.
        const teacherChanged = job.kind === "TEACHER_LATE_START" && job.session.teacher?.userId !== job.recipientUser.id;
        // Real clock: the tick may have slept between sends since `now` was taken.
        if (job.session.status !== "SCHEDULED" || job.session.scheduledEnd.getTime() <= Date.now() || clicked > 0 || teacherChanged) {
          await prisma.notificationJob.update({ where: { id: job.id }, data: { status: "CANCELLED" }, select: { id: true } });
          continue;
        }
      }
      if (isSessionNoticeKind(job.kind) && job.session.scheduledEnd.getTime() <= now.getTime()) {
        // After a worker outage, never send "starts at …" or a join link for a
        // session that is already over.
        await prisma.notificationJob.update({
          where: { id: job.id },
          data: { status: "CANCELLED", lastError: "Session already ended before the notice was sent." },
          select: { id: true },
        });
        continue;
      }
      if (isReportNudgeKind(job.kind) && job.sessionId && (await sessionFullyReported(job.sessionId))) {
        // Every roster student already has a report — cancel instead of sending
        // (Phase 5 review F-07; backstop for the submit-route cancellation).
        await prisma.notificationJob.update({ where: { id: job.id }, data: { status: "CANCELLED" }, select: { id: true } });
        continue;
      }
    }
    if (!job.recipientUser.isActive) {
      await prisma.notificationJob.update({ where: { id: job.id }, data: { status: "CANCELLED" }, select: { id: true } });
      continue;
    }
    // MONTHLY_REPORT_SUBMITTED composes from its report (linked via the redacted
    // payload — ids only, CONTEXT §5/§24). These jobs only exist post-migration.
    let monthlyReport: JobWithRelations["monthlyReport"] = null;
    if (job.kind === "MONTHLY_REPORT_SUBMITTED") {
      const payload = (job.payload as { monthlyReportId?: unknown } | null) ?? null;
      if (typeof payload?.monthlyReportId === "string") {
        monthlyReport = await prisma.monthlyReport.findUnique({
          where: { id: payload.monthlyReportId },
          select: {
            id: true,
            monthKey: true,
            language: true,
            student: { select: { user: { select: { displayName: true } } } },
          },
        });
      }
    }
    let adminMessageBody: string | null = null;
    if (job.kind === "ADMIN_MESSAGE") {
      const payload = (job.payload as { adminMessageId?: unknown } | null) ?? null;
      if (deliveryReady && typeof payload?.adminMessageId === "string") {
        const row = await prisma.adminMessage.findFirst({
          where: { id: payload.adminMessageId, recipientUserId: job.recipientUser.id },
          select: { body: true },
        });
        adminMessageBody = row?.body ?? null;
      }
      if (!adminMessageBody) {
        await prisma.notificationJob.update({
          where: { id: job.id },
          data: { status: "FAILED", lastError: "Admin message not found." },
          select: { id: true },
        });
        continue;
      }
    }
    let announcement: JobWithRelations["announcement"] = null;
    if (job.kind === "ANNOUNCEMENT") {
      const payload = (job.payload as { announcementId?: unknown } | null) ?? null;
      if (typeof payload?.announcementId === "string") {
        announcement = await prisma.announcement.findUnique({
          where: { id: payload.announcementId },
          select: { title: true, body: true },
        });
      }
      if (!announcement) {
        await prisma.notificationJob.update({
          where: { id: job.id },
          data: { status: "FAILED", lastError: "Announcement not found." },
          select: { id: true },
        });
        announcementTally.failed += 1;
        continue;
      }
    }
    const message = composeJobMessage({ ...job, monthlyReport, adminMessageBody, announcement });
    if (job.kind === "ANNOUNCEMENT") {
      // Heavier spacing + random jitter for bulk sends (ban risk, CONTEXT §8).
      await sleep(ANNOUNCEMENT_SEND_SPACING_MS + Math.floor(Math.random() * ANNOUNCEMENT_SEND_JITTER_MS));
    } else if (sendsThisTick > 0) {
      await sleep(SEND_SPACING_MS);
    }
    sendsThisTick += 1;
    // The job id is the provider idempotency key: a retried job is never delivered twice.
    const result = await provider.sendText(
      { userId: job.recipientUser.id, phone: job.recipientUser.phone },
      message,
      { idempotencyKey: `notification-job:${job.id}` },
    );
    const attemptsSoFar = job.attempts + 1;
    const retryDelay = RETRY_DELAYS_MS[Math.min(attemptsSoFar - 1, RETRY_DELAYS_MS.length - 1)];
    const willRetry = !result.ok && result.transient === true && attemptsSoFar < MAX_SEND_ATTEMPTS;
    await prisma.notificationJob.update({
      where: { id: job.id },
      data: result.ok
        ? {
            status: "SENT",
            sentAt: new Date(),
            lastError: null,
            ...(deliveryReady && result.providerMessageId
              ? { providerMessageId: result.providerMessageId, deliveryStatus: "SENT", deliveryUpdatedAt: new Date() }
              : {}),
          }
        : willRetry
          ? {
              status: "PENDING",
              scheduledFor: new Date(Date.now() + retryDelay),
              lastError: result.error ?? "Messaging provider failed.",
            }
          : { status: "FAILED", lastError: result.error ?? "Messaging provider failed." },
      select: { id: true },
    });
    if (job.kind === "ANNOUNCEMENT") {
      if (result.ok) announcementTally.sent += 1;
      else if (!willRetry) announcementTally.failed += 1;
    }
  }
  if (announcementTally.sent || announcementTally.failed) {
    // Redacted delivery summary: counts only — no text, no numbers, no names.
    console.info(`[announcements] tick: sent ${announcementTally.sent}, failed ${announcementTally.failed}.`);
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

/**
 * Monthly-report missing reminders (Session 1 — CONTEXT §9; 1st/3rd timing CONFIRMED by the owner 2026-10-26):
 * on the 1st and 3rd of each month (the TEACHER's local calendar), every active
 * teacher with at least one missing monthly report for the PREVIOUS month gets ONE
 * reminder. Eligible (teacher, student) pairs = students on at least one of that
 * teacher's non-cancelled sessions in that month; missing = eligible minus already
 * reported. Dedup keys make repeated scans within the same day harmless.
 * From the 4th to the 7th, a teacher still missing reports gets one
 * MONTHLY_REPORT_MISSING flag for that month (owner decision 7 — no money effect).
 */
export async function processMonthlyReportReminders(now = new Date(), academyId?: string) {
  if (!(await isSession1ReportsReady())) return;

  const teachers = await prisma.teacher.findMany({
    where: { user: { isActive: true }, ...(academyId ? { academyId } : {}) },
    select: { id: true, academyId: true, user: { select: { id: true, timezone: true } } },
  });
  const jobs: Prisma.NotificationJobCreateManyInput[] = [];
  const flags: Prisma.TeacherFlagCreateManyInput[] = [];

  // Same rule as before; batched (owner 2026-10-27, review #6): the scan runs every
  // tick, so instead of 3 queries PER TEACHER it runs 3 queries per previous-month key
  // (normally one key: all teachers share it) — existing flags, eligible pairs, reports.
  type Due = { teacherId: string; academyId: string; userId: string; day: number; flagToday: boolean };
  const dueByMonth = new Map<string, Due[]>();
  for (const teacher of teachers) {
    const day = localDayOfMonth(now, teacher.user.timezone || "Africa/Cairo");
    if (day === null) continue;
    const remindToday = MONTHLY_REPORT_REMINDER_DAYS.includes(day);
    const flagToday = day >= MONTHLY_REPORT_FLAG_FIRST_DAY && day <= MONTHLY_REPORT_FLAG_LAST_DAY;
    if (!remindToday && !flagToday) continue;

    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: teacher.user.timezone || "Africa/Cairo", year: "numeric", month: "2-digit" }).formatToParts(now);
    const year = parts.find((part) => part.type === "year")?.value ?? "";
    const month = parts.find((part) => part.type === "month")?.value ?? "";
    const monthKey = previousMonthKey(`${year}-${month}`);
    const group = dueByMonth.get(monthKey) ?? [];
    group.push({ teacherId: teacher.id, academyId: teacher.academyId, userId: teacher.user.id, day, flagToday });
    dueByMonth.set(monthKey, group);
  }

  for (const [monthKey, group] of dueByMonth) {
    // Already flagged for this month → nothing left to do for that teacher today.
    const flagDayIds = group.filter((due) => due.flagToday).map((due) => due.teacherId);
    const alreadyFlagged = new Set(
      flagDayIds.length
        ? (
            await prisma.teacherFlag.findMany({
              where: { teacherId: { in: flagDayIds }, flagType: "MONTHLY_REPORT_MISSING", monthKey },
              select: { teacherId: true },
            })
          ).map((row) => row.teacherId)
        : [],
    );
    const candidates = group.filter((due) => !(due.flagToday && alreadyFlagged.has(due.teacherId)));
    if (!candidates.length) continue;
    const candidateIds = candidates.map((due) => due.teacherId);

    const { start, end } = monthKeyRangeUtc(monthKey);
    const eligible = await prisma.sessionStudent.findMany({
      where: {
        session: {
          teacherId: { in: candidateIds },
          status: { notIn: ["CANCELLED", "MISSED"] },
          scheduledStart: { gte: start, lt: end },
        },
      },
      select: { studentId: true, session: { select: { teacherId: true } } },
    });
    const reported = new Set(
      (
        await prisma.monthlyReport.findMany({
          where: { teacherId: { in: candidateIds }, monthKey },
          select: { teacherId: true, studentId: true },
        })
      ).map((row) => `${row.teacherId}:${row.studentId}`),
    );
    const missingByTeacher = new Map<string, Set<string>>();
    for (const row of eligible) {
      const pair = `${row.session.teacherId}:${row.studentId}`;
      if (reported.has(pair)) continue;
      const missing = missingByTeacher.get(row.session.teacherId) ?? new Set<string>();
      missing.add(row.studentId);
      missingByTeacher.set(row.session.teacherId, missing);
    }

    for (const due of candidates) {
      const missingCount = missingByTeacher.get(due.teacherId)?.size ?? 0;
      if (missingCount === 0) continue;
      if (due.flagToday) {
        flags.push({ academyId: due.academyId, teacherId: due.teacherId, flagType: "MONTHLY_REPORT_MISSING", monthKey });
        continue;
      }
      jobs.push({
        academyId: due.academyId,
        sessionId: null,
        recipientUserId: due.userId,
        kind: "MONTHLY_REPORT_REMINDER",
        dedupKey: `MONTHLY_REPORT_REMINDER:${due.teacherId}:${monthKey}:d${due.day}`,
        scheduledFor: now,
        // Redacted composition context: month key + count only (CONTEXT §5/§24 —
        // ids/keys, never message content).
        payload: { monthKey, missingCount },
      });
    }
  }

  if (jobs.length) {
    await prisma.notificationJob.createMany({ data: jobs, skipDuplicates: true });
  }
  if (flags.length) {
    // ON CONFLICT DO NOTHING against teacher_flags_teacher_type_month_key.
    await prisma.teacherFlag.createMany({ data: flags, skipDuplicates: true });
  }
}

/**
 * Teacher late start (owner decision 2026-10-26, lib/config/lateness.ts): for every
 * SCHEDULED, still-running session that started 5–60 minutes ago and whose ASSIGNED
 * teacher has no platform link click yet:
 *  (a) from T+5 → one TEACHER_LATE_START WhatsApp job to the teacher;
 *  (b) from T+10 → one TEACHER_LATE_START_ADMIN job per active Admin.
 * Idempotent per session through the unique dedup keys (createMany skipDuplicates).
 * Students and guardians are never involved. No link is ever put in these jobs.
 */
export async function processLateStartAlerts(now = new Date(), academyId?: string) {
  const minute = 60 * 1000;
  const sessions = await prisma.session.findMany({
    where: {
      status: "SCHEDULED",
      scheduledStart: {
        gte: new Date(now.getTime() - LATE_START_SCAN_WINDOW_MINUTES * minute),
        lte: new Date(now.getTime() - TEACHER_LATE_REMINDER_MINUTES * minute),
      },
      scheduledEnd: { gt: now },
      ...(academyId ? { academyId } : {}),
    },
    select: {
      id: true,
      academyId: true,
      scheduledStart: true,
      teacher: { select: { userId: true, user: { select: { isActive: true } } } },
    },
  });
  if (!sessions.length) return;
  const clicked = new Set(
    (
      await prisma.sessionJoinClick.findMany({
        where: { OR: sessions.map((session) => ({ sessionId: session.id, userId: session.teacher.userId })) },
        select: { sessionId: true },
      })
    ).map((click) => click.sessionId),
  );
  const adminsByAcademy = new Map<string, string[]>();
  const jobs: Prisma.NotificationJobCreateManyInput[] = [];
  for (const session of sessions) {
    if (clicked.has(session.id)) continue;
    const lateMs = now.getTime() - session.scheduledStart.getTime();
    // (a) only to an active teacher; (b) still alerts the Admins either way.
    if (session.teacher.user.isActive) {
      jobs.push({
        academyId: session.academyId,
        sessionId: session.id,
        recipientUserId: session.teacher.userId,
        kind: "TEACHER_LATE_START",
        // Per (session, ASSIGNED teacher) — owner 2026-10-27: a teacher replaced
        // after the T+5 reminder is reminded once too (the old one is cancelled at send).
        dedupKey: `TEACHER_LATE_START:${session.id}:${session.teacher.userId}`,
        scheduledFor: now,
      });
    }
    if (lateMs >= ADMIN_LATE_ALERT_MINUTES * minute) {
      let admins = adminsByAcademy.get(session.academyId);
      if (!admins) {
        admins = (
          await prisma.user.findMany({ where: { academyId: session.academyId, role: "ADMIN", isActive: true }, select: { id: true } })
        ).map((admin) => admin.id);
        adminsByAcademy.set(session.academyId, admins);
      }
      for (const adminId of admins) {
        jobs.push({
          academyId: session.academyId,
          sessionId: session.id,
          recipientUserId: adminId,
          kind: "TEACHER_LATE_START_ADMIN",
          dedupKey: `TEACHER_LATE_START_ADMIN:${session.id}:${adminId}`,
          scheduledFor: now,
        });
      }
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
    await recoverStaleProcessingJobs(now);
  } catch (cause) {
    console.error("[worker] stale job recovery failed.", cause instanceof Error ? cause.message : cause);
  }
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
    await processLateStartAlerts(now);
  } catch (cause) {
    console.error("[worker] late start processing failed.", cause instanceof Error ? cause.message : cause);
  }
  try {
    await processMonthlyReportReminders(now);
  } catch (cause) {
    console.error("[worker] monthly report reminder processing failed.", cause instanceof Error ? cause.message : cause);
  }
  try {
    await processMonthlyCreditExpiry(now);
  } catch (cause) {
    console.error("[worker] monthly credit expiry failed.", cause instanceof Error ? cause.message : cause);
  }
  try {
    await extendDueSeries(now);
  } catch (cause) {
    console.error("[worker] series extension failed.", cause instanceof Error ? cause.message : cause);
  }
}
