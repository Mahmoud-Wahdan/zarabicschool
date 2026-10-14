jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { prisma } from "../../lib/prisma";
import { composeJobMessage, processDueNotificationJobs, processLateReportNotifications } from "../../lib/worker/notifications";
import {
  cleanupSessionFixtures,
  createSessionFixtures,
  closePrisma,
  type SessionFixtures,
} from "../helpers/session-fixtures";

jest.setTimeout(180_000);

let fx: SessionFixtures;

function formatCairo(instant: Date) {
  return new Intl.DateTimeFormat("ar-EG", { timeZone: "Africa/Cairo", dateStyle: "medium", timeStyle: "short" }).format(instant);
}

async function createPastSession(options: {
  studentProfileIds: string[];
  minutesAgoEnded?: number;
  status?: "SCHEDULED" | "COMPLETED";
}) {
  const end = new Date(Date.now() - (options.minutesAgoEnded ?? 10) * 60 * 1000);
  const start = new Date(end.getTime() - 60 * 60 * 1000);
  return prisma.session.create({
    data: {
      academyId: fx.academyId,
      teacherId: fx.teacherProfileId,
      subjectId: fx.subjectId,
      sessionType: options.studentProfileIds.length > 1 ? "GROUP" : "PRIVATE",
      scheduledStart: start,
      scheduledEnd: end,
      durationMinutes: 60,
      timezone: "Africa/Cairo",
      zoomJoinUrl: "https://zoom.us/j/456789012345",
      createdById: fx.adminUserId,
      status: options.status ?? "SCHEDULED",
      students: { create: options.studentProfileIds.map((studentId) => ({ studentId })) },
    },
    select: { id: true },
  });
}

async function createReport(sessionId: string, studentId: string) {
  await prisma.report.create({
    data: {
      academyId: fx.academyId,
      sessionId,
      studentId,
      teacherId: fx.teacherProfileId,
      reportType: "SESSION_COMPLETION_REPORT",
      status: "SUBMITTED",
      attendanceOutcome: "ATTENDED",
      classRemark: "good",
      summary: "Test summary",
      homework: "Test homework",
      submittedAt: new Date(),
    },
    select: { id: true },
  });
}

async function createManualJob(sessionId: string, kind: string, status: "PENDING" | "FAILED", attempts = 0) {
  return prisma.notificationJob.create({
    data: {
      academyId: fx.academyId,
      sessionId,
      recipientUserId: fx.teacherUserId,
      kind,
      dedupKey: `${kind}:${sessionId}`,
      scheduledFor: new Date(Date.now() - 1000),
      status,
      attempts,
      ...(status === "FAILED" ? { lastError: "OpenWA is not configured." } : {}),
    },
    select: { id: true },
  });
}

async function withProviderUnconfigured(run: () => Promise<void>) {
  const previous = {
    provider: process.env.MESSAGING_PROVIDER,
    url: process.env.OPENWA_URL,
    apiKey: process.env.OPENWA_API_KEY,
    sessionId: process.env.OPENWA_SESSION_ID,
  };
  process.env.MESSAGING_PROVIDER = "openwa";
  delete process.env.OPENWA_URL;
  delete process.env.OPENWA_API_KEY;
  delete process.env.OPENWA_SESSION_ID;
  try {
    await run();
  } finally {
    if (previous.provider === undefined) delete process.env.MESSAGING_PROVIDER; else process.env.MESSAGING_PROVIDER = previous.provider;
    if (previous.url === undefined) delete process.env.OPENWA_URL; else process.env.OPENWA_URL = previous.url;
    if (previous.apiKey === undefined) delete process.env.OPENWA_API_KEY; else process.env.OPENWA_API_KEY = previous.apiKey;
    if (previous.sessionId === undefined) delete process.env.OPENWA_SESSION_ID; else process.env.OPENWA_SESSION_ID = previous.sessionId;
  }
}

beforeAll(async () => {
  process.env.MESSAGING_PROVIDER = "fake";
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("Phase 5 — late-report chain hardening (database-backed)", () => {
  it("renders the scheduled END time in late-report nudges (F-08)", () => {
    // Start and end land on different Cairo calendar days so the formatted strings differ.
    const start = new Date("2026-01-01T10:00:00Z");
    const end = new Date("2026-01-02T22:30:00Z");
    const job = {
      id: "job",
      kind: "REPORT_REMINDER",
      session: {
        scheduledStart: start,
        scheduledEnd: end,
        timezone: "Africa/Cairo",
        zoomJoinUrl: "https://zoom.us/j/111111111111",
        status: "SCHEDULED",
        subject: { nameAr: "قرآن", nameEn: "Quran" },
      },
    } as unknown as Parameters<typeof composeJobMessage>[0];
    const message = composeJobMessage(job);
    expect(message).toContain(formatCairo(end));
    expect(message).not.toContain(formatCairo(start));

    const sessionJob = {
      ...job,
      kind: "SESSION_REMINDER",
    } as unknown as Parameters<typeof composeJobMessage>[0];
    const sessionMessage = composeJobMessage(sessionJob);
    expect(sessionMessage).toContain(formatCairo(start));
  });

  it("sends nudges for a COMPLETED session instead of cancelling them, while session nudges stay cancelled (F-09)", async () => {
    const session = await createPastSession({
      studentProfileIds: [fx.studentProfileIds.student1],
      status: "COMPLETED",
      minutesAgoEnded: 40,
    });
    await createManualJob(session.id, "SESSION_REMINDER", "PENDING");
    await processLateReportNotifications(new Date(), fx.academyId);
    await processDueNotificationJobs(new Date(), fx.academyId);
    const jobs = await prisma.notificationJob.findMany({ where: { sessionId: session.id } });
    const byKind = Object.fromEntries(jobs.map((job) => [job.kind, job.status]));
    expect(byKind.REPORT_REMINDER).toBe("SENT");
    expect(byKind.REPORT_REMINDER_FOLLOWUP).toBe("SENT");
    expect(byKind.SESSION_REMINDER).toBe("CANCELLED");
  });

  it("sends nudges while reports are missing and cancels them once every roster student has one (F-07)", async () => {
    const session = await createPastSession({
      studentProfileIds: [fx.studentProfileIds.student2, fx.studentProfileIds.student3],
      minutesAgoEnded: 40,
    });
    await processLateReportNotifications(new Date(), fx.academyId);
    await processDueNotificationJobs(new Date(), fx.academyId);
    let reminder = await prisma.notificationJob.findFirstOrThrow({
      where: { sessionId: session.id, kind: "REPORT_REMINDER" },
    });
    expect(reminder.status).toBe("SENT");

    // One of two students reported: still a missing report — the nudge fires again.
    await createReport(session.id, fx.studentProfileIds.student2);
    await prisma.notificationJob.update({
      where: { id: reminder.id },
      data: { status: "PENDING", attempts: 0 },
    });
    await processDueNotificationJobs(new Date(), fx.academyId);
    reminder = await prisma.notificationJob.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(reminder.status).toBe("SENT");

    // Last roster student reported: the pending nudge is cancelled, never sent.
    await createReport(session.id, fx.studentProfileIds.student3);
    await prisma.notificationJob.update({
      where: { id: reminder.id },
      data: { status: "PENDING", attempts: 0 },
    });
    await processDueNotificationJobs(new Date(), fx.academyId);
    reminder = await prisma.notificationJob.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(reminder.status).toBe("CANCELLED");

    // The scan itself stops creating new nudges for the fully reported session.
    await processLateReportNotifications(new Date(), fx.academyId);
    expect(await prisma.notificationJob.count({ where: { sessionId: session.id, kind: "REPORT_REMINDER_FOLLOWUP" } })).toBe(1);
  });

  it("still creates reminders and the red flag after long worker downtime, and nothing beyond 24h (F-10)", async () => {
    const inside = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student4], minutesAgoEnded: 20 * 60 });
    await processLateReportNotifications(new Date(), fx.academyId);
    expect(await prisma.notificationJob.count({ where: { sessionId: inside.id, kind: "REPORT_REMINDER" } })).toBe(1);
    expect(await prisma.notificationJob.count({ where: { sessionId: inside.id, kind: "REPORT_REMINDER_FOLLOWUP" } })).toBe(1);
    expect(await prisma.teacherFlag.count({ where: { sessionId: inside.id, flagType: "LATE_REPORT" } })).toBe(1);

    const outside = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student5], minutesAgoEnded: 25 * 60 });
    await processLateReportNotifications(new Date(), fx.academyId);
    expect(await prisma.notificationJob.count({ where: { sessionId: outside.id } })).toBe(0);
    expect(await prisma.teacherFlag.count({ where: { sessionId: outside.id } })).toBe(0);
  });

  it("re-arms a failed nudge exactly once and never touches session-reminder failures (F-13)", async () => {
    const session = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student6], minutesAgoEnded: 5 });
    const other = await createPastSession({ studentProfileIds: [fx.studentProfileIds.student7], minutesAgoEnded: 20 });
    const nudge = await createManualJob(session.id, "REPORT_REMINDER", "FAILED", 1);
    const sessionReminder = await createManualJob(other.id, "SESSION_REMINDER", "FAILED", 1);

    await processLateReportNotifications(new Date(), fx.academyId);
    let row = await prisma.notificationJob.findUniqueOrThrow({ where: { id: nudge.id } });
    expect(row.status).toBe("PENDING");

    await withProviderUnconfigured(async () => {
      await processDueNotificationJobs(new Date(), fx.academyId);
    });
    row = await prisma.notificationJob.findUniqueOrThrow({ where: { id: nudge.id } });
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(2);

    await processLateReportNotifications(new Date(), fx.academyId);
    row = await prisma.notificationJob.findUniqueOrThrow({ where: { id: nudge.id } });
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(2);

    const untouched = await prisma.notificationJob.findUniqueOrThrow({ where: { id: sessionReminder.id } });
    expect(untouched.status).toBe("FAILED");
    expect(untouched.attempts).toBe(1);
  });
});
