jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { randomUUID } from "node:crypto";

import { getServerSession } from "next-auth";

import { prisma } from "../../lib/prisma";
import { settlePaidInvoice } from "../../lib/payments/settlement";
import { extendDueSeries, processDueNotificationJobs, processLateReportNotifications } from "../../lib/worker/notifications";
import { POST as createSessionRoute } from "../../app/api/sessions/route";
import { POST as recurrencesRoute } from "../../app/api/sessions/recurrences/route";
import {
  cleanupSessionFixtures,
  createSessionFixtures,
  closePrisma,
  type SessionFixtures,
} from "../helpers/session-fixtures";

const getServerSessionMock = getServerSession as jest.Mock;

jest.setTimeout(180_000);

let fx: SessionFixtures;

function asActor(userId: string) {
  getServerSessionMock.mockResolvedValue({ user: { id: userId } });
}

function apiRequest(path: string, method: string, body: unknown) {
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createSessionViaApi(studentProfileId: string, overrides: Record<string, unknown> = {}) {
  asActor(fx.adminUserId);
  const start = new Date(Date.now() + 2 * 3600 * 1000);
  start.setUTCMinutes(0, 0, 0);
  const response = await createSessionRoute(
    apiRequest("/api/sessions", "POST", {
      teacherId: fx.teacherProfileId,
      subjectId: fx.subjectId,
      sessionType: "PRIVATE",
      scheduledStart: start.toISOString(),
      scheduledEnd: new Date(start.getTime() + 3600 * 1000).toISOString(),
      timezone: "Africa/Cairo",
      zoomJoinUrl: "https://zoom.us/j/worker-test",
      studentIds: [studentProfileId],
      ...overrides,
    }),
  );
  const payload = await response.json();
  if (response.status !== 201) {
    throw new Error(`Session creation failed: ${JSON.stringify(payload)}`);
  }
  return payload.data as { id: string; scheduledStart: string };
}

async function grantCredit(studentProfileId: string, sessionsDelta: number) {
  const subscription = await prisma.subscription.create({
    data: {
      academyId: fx.academyId,
      studentId: studentProfileId,
      packageType: "MONTHLY_PLAN",
      sessionsPurchased: Math.max(sessionsDelta, 0),
      totalAmountMinor: BigInt(100000),
      currency: "EGP",
      status: "ACTIVE",
      periodStartsAt: new Date(Date.now() - 24 * 3600 * 1000),
      periodEndsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    },
    select: { id: true },
  });
  if (sessionsDelta !== 0) {
    await prisma.subscriptionLedger.create({
      data: { academyId: fx.academyId, subscriptionId: subscription.id, entryType: "INITIAL_PURCHASE", sessionsDelta },
    });
  }
  return subscription;
}

async function createPrismaSession(studentProfileId: string, scheduledEnd: Date) {
  return prisma.session.create({
    data: {
      academyId: fx.academyId,
      teacherId: fx.teacherProfileId,
      subjectId: fx.subjectId,
      sessionType: "PRIVATE",
      scheduledStart: new Date(scheduledEnd.getTime() - 3600 * 1000),
      scheduledEnd,
      durationMinutes: 60,
      timezone: "Africa/Cairo",
      zoomJoinUrl: "https://zoom.us/j/late-report",
      createdById: fx.adminUserId,
      status: "SCHEDULED",
      students: { create: [{ studentId: studentProfileId }] },
    },
    select: { id: true },
  });
}

beforeAll(async () => {
  process.env.MESSAGING_PROVIDER = "fake";
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("Phase 3 — scheduling worker (database-backed)", () => {
  it("sends due reminder jobs through the messaging provider and leaves future jobs pending", async () => {
    await grantCredit(fx.studentProfileIds.student1, 2);
    const session = await createSessionViaApi(fx.studentProfileIds.student1);
    await prisma.notificationJob.updateMany({
      where: { sessionId: session.id, kind: "SESSION_REMINDER" },
      data: { scheduledFor: new Date(Date.now() - 1000) },
    });
    await processDueNotificationJobs(new Date(), fx.academyId);
    const sent = await prisma.notificationJob.findMany({
      where: { sessionId: session.id, kind: "SESSION_REMINDER" },
      select: { status: true, sentAt: true },
    });
    expect(sent.length).toBeGreaterThan(0);
    for (const job of sent) {
      expect(job.status).toBe("SENT");
      expect(job.sentAt).not.toBeNull();
    }
    const pendingStart = await prisma.notificationJob.findFirst({
      where: { sessionId: session.id, kind: "SESSION_START" },
      select: { status: true },
    });
    expect(pendingStart?.status).toBe("PENDING");
  });

  it("cancels jobs whose session is no longer scheduled instead of sending them", async () => {
    await grantCredit(fx.studentProfileIds.student2, 2);
    const session = await createSessionViaApi(fx.studentProfileIds.student2);
    await prisma.session.update({ where: { id: session.id }, data: { status: "CANCELLED" } });
    await prisma.notificationJob.updateMany({
      where: { sessionId: session.id },
      data: { status: "PENDING", scheduledFor: new Date(Date.now() - 1000) },
    });
    await processDueNotificationJobs(new Date(), fx.academyId);
    const jobs = await prisma.notificationJob.findMany({
      where: { sessionId: session.id },
      select: { status: true },
    });
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.status).toBe("CANCELLED");
    }
  });

  it("records a redacted failure row when the provider is not configured", async () => {
    await grantCredit(fx.studentProfileIds.student3, 2);
    const session = await createSessionViaApi(fx.studentProfileIds.student3);
    await prisma.notificationJob.updateMany({
      where: { sessionId: session.id, kind: "SESSION_REMINDER" },
      data: { scheduledFor: new Date(Date.now() - 1000) },
    });
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
      await processDueNotificationJobs(new Date(), fx.academyId);
    } finally {
      if (previous.provider === undefined) delete process.env.MESSAGING_PROVIDER; else process.env.MESSAGING_PROVIDER = previous.provider;
      if (previous.url === undefined) delete process.env.OPENWA_URL; else process.env.OPENWA_URL = previous.url;
      if (previous.apiKey === undefined) delete process.env.OPENWA_API_KEY; else process.env.OPENWA_API_KEY = previous.apiKey;
      if (previous.sessionId === undefined) delete process.env.OPENWA_SESSION_ID; else process.env.OPENWA_SESSION_ID = previous.sessionId;
    }
    const failed = await prisma.notificationJob.findFirst({
      where: { sessionId: session.id, kind: "SESSION_REMINDER" },
      select: { status: true, lastError: true },
    });
    expect(failed?.status).toBe("FAILED");
    expect(failed?.lastError).toBe("OpenWA is not configured.");
  });

  it("notifies the teacher about late reports at T+0 and T+15 and flags at T+30 with dedup", async () => {
    await grantCredit(fx.studentProfileIds.student4, 2);
    const early = await createPrismaSession(fx.studentProfileIds.student4, new Date(Date.now() - 10 * 60 * 1000));
    await processLateReportNotifications(new Date(), fx.academyId);
    expect(await prisma.notificationJob.count({ where: { sessionId: early.id, kind: "REPORT_REMINDER" } })).toBe(1);
    expect(await prisma.notificationJob.count({ where: { sessionId: early.id, kind: "REPORT_REMINDER_FOLLOWUP" } })).toBe(0);
    expect(await prisma.teacherFlag.count({ where: { sessionId: early.id } })).toBe(0);

    const late = await createPrismaSession(fx.studentProfileIds.student4, new Date(Date.now() - 40 * 60 * 1000));
    await processLateReportNotifications(new Date(), fx.academyId);
    expect(await prisma.notificationJob.count({ where: { sessionId: late.id, kind: "REPORT_REMINDER" } })).toBe(1);
    expect(await prisma.notificationJob.count({ where: { sessionId: late.id, kind: "REPORT_REMINDER_FOLLOWUP" } })).toBe(1);
    expect(await prisma.teacherFlag.count({ where: { sessionId: late.id, flagType: "LATE_REPORT" } })).toBe(1);

    await processLateReportNotifications(new Date(), fx.academyId);
    expect(await prisma.notificationJob.count({ where: { sessionId: late.id, kind: "REPORT_REMINDER" } })).toBe(1);
    expect(await prisma.teacherFlag.count({ where: { sessionId: late.id, flagType: "LATE_REPORT" } })).toBe(1);

    await prisma.report.create({
      data: {
        academyId: fx.academyId,
        sessionId: late.id,
        studentId: fx.studentProfileIds.student4,
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
    await processLateReportNotifications(new Date(), fx.academyId);
    expect(await prisma.teacherFlag.count({ where: { sessionId: late.id, flagType: "LATE_REPORT" } })).toBe(1);
    expect(await prisma.notificationJob.count({ where: { sessionId: late.id, kind: "REPORT_REMINDER" } })).toBe(1);
  });

  it("resumes a paused series when credit becomes available", async () => {
    await grantCredit(fx.studentProfileIds.student7, 2);
    const anchor = new Date(Date.now() + 2 * 3600 * 1000);
    anchor.setUTCMinutes(0, 0, 0);
    asActor(fx.adminUserId);
    const response = await recurrencesRoute(
      apiRequest("/api/sessions/recurrences", "POST", {
        teacherId: fx.teacherProfileId,
        subjectId: fx.subjectId,
        sessionType: "PRIVATE",
        scheduledStart: anchor.toISOString(),
        scheduledEnd: new Date(anchor.getTime() + 3600 * 1000).toISOString(),
        timezone: "Africa/Cairo",
        zoomJoinUrl: "https://zoom.us/j/resume-test",
        studentIds: [fx.studentProfileIds.student7],
        weekCount: 5,
      }),
    );
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.data.sessions).toHaveLength(2);
    const seriesId = payload.data.seriesId as string;
    const subscription = await prisma.subscription.findFirstOrThrow({
      where: { academyId: fx.academyId, studentId: fx.studentProfileIds.student7 },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    await prisma.subscriptionLedger.create({
      data: { academyId: fx.academyId, subscriptionId: subscription.id, entryType: "INITIAL_PURCHASE", sessionsDelta: 6 },
    });
    await extendDueSeries(new Date(Date.now() + 3 * 24 * 3600 * 1000), fx.academyId);
    const series = await prisma.recurrenceSeries.findUniqueOrThrow({ where: { id: seriesId } });
    expect(series.status).toBe("ACTIVE");
    expect(series.generatedThroughWeek).toBe(2);
    const sessionCount = await prisma.session.count({ where: { recurrenceGroupId: seriesId } });
    expect(sessionCount).toBe(3);
  });

  it("never creates a duplicate week when two workers extend the same series concurrently", async () => {
    await grantCredit(fx.studentProfileIds.student5, 4);
    const anchor = new Date(Date.now() + 2 * 3600 * 1000);
    anchor.setUTCMinutes(0, 0, 0);
    const series = await prisma.recurrenceSeries.create({
      data: {
        academyId: fx.academyId,
        teacherId: fx.teacherProfileId,
        subjectId: fx.subjectId,
        sessionType: "PRIVATE",
        recurrenceRule: {
          scheduledStart: anchor.toISOString(),
          scheduledEnd: new Date(anchor.getTime() + 3600 * 1000).toISOString(),
          zoomJoinUrl: "https://zoom.us/j/dup-test",
          zoomHostUrl: null,
          studentIds: [fx.studentProfileIds.student5],
        },
        timezone: "Africa/Cairo",
        startDate: anchor,
        totalWeeks: 3,
        generatedThroughWeek: 0,
        status: "ACTIVE",
        createdById: fx.adminUserId,
      },
      select: { id: true },
    });
    await Promise.all([
      extendDueSeries(new Date(Date.now() + 3 * 24 * 3600 * 1000)),
      extendDueSeries(new Date(Date.now() + 3 * 24 * 3600 * 1000)),
    ]);
    const weekOneSessions = await prisma.session.count({
      where: { recurrenceGroupId: series.id, recurrenceWeekIndex: 1 },
    });
    expect(weekOneSessions).toBe(1);
    const updated = await prisma.recurrenceSeries.findUniqueOrThrow({ where: { id: series.id } });
    expect(updated.generatedThroughWeek).toBe(1);
  });

  it("R1: settlePaidInvoice sets monthly credit periods and is idempotent", async () => {
    const invoice = await prisma.invoice.create({
      data: {
        academyId: fx.academyId,
        studentId: fx.studentProfileIds.student6,
        amountMinor: BigInt(80000),
        currency: "EGP",
        provider: "PAYMOB",
        packageType: "MONTHLY_PLAN",
        sessionsPurchased: 8,
        status: "PENDING",
      },
      select: { id: true },
    });
    const event = {
      providerReference: `ref-${randomUUID()}`,
      invoiceId: invoice.id,
      amountMinor: BigInt(80000),
      currency: "EGP" as const,
      succeeded: true,
      rawEventHash: `hash-${randomUUID()}`,
    };
    const result = await settlePaidInvoice(event);
    expect(result.status).toBe("settled");
    const subscription = await prisma.subscription.findFirstOrThrow({
      where: { academyId: fx.academyId, studentId: fx.studentProfileIds.student6 },
      orderBy: { createdAt: "desc" },
    });
    expect(subscription.periodStartsAt).not.toBeNull();
    expect(subscription.periodEndsAt).not.toBeNull();
    const periodDays = (subscription.periodEndsAt!.getTime() - subscription.periodStartsAt!.getTime()) / (24 * 3600 * 1000);
    expect(periodDays).toBeGreaterThanOrEqual(28);
    expect(periodDays).toBeLessThanOrEqual(31);
    const ledger = await prisma.subscriptionLedger.findFirstOrThrow({
      where: { subscriptionId: subscription.id },
      select: { sessionsDelta: true, entryType: true },
    });
    expect(ledger.entryType).toBe("INITIAL_PURCHASE");
    expect(ledger.sessionsDelta).toBe(8);
    const settledInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { status: true } });
    expect(settledInvoice.status).toBe("PAID");
    const replay = await settlePaidInvoice(event);
    expect(replay.status).toBe("already_settled");

    const payPerSessionInvoice = await prisma.invoice.create({
      data: {
        academyId: fx.academyId,
        studentId: fx.studentProfileIds.student6,
        amountMinor: BigInt(20000),
        currency: "EGP",
        provider: "PAYMOB",
        packageType: "PAY_PER_SESSION",
        sessionsPurchased: 2,
        status: "PENDING",
      },
      select: { id: true },
    });
    await settlePaidInvoice({
      providerReference: `ref-${randomUUID()}`,
      invoiceId: payPerSessionInvoice.id,
      amountMinor: BigInt(20000),
      currency: "EGP",
      succeeded: true,
      rawEventHash: `hash-${randomUUID()}`,
    });
    const payPerSessionSubscription = await prisma.subscription.findFirstOrThrow({
      where: { academyId: fx.academyId, studentId: fx.studentProfileIds.student6, packageType: "PAY_PER_SESSION" },
      select: { periodStartsAt: true, periodEndsAt: true },
    });
    expect(payPerSessionSubscription.periodStartsAt).toBeNull();
    expect(payPerSessionSubscription.periodEndsAt).toBeNull();
  });
});
