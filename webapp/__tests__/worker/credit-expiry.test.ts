import { prisma } from "../../lib/prisma";
import { processMonthlyCreditExpiry } from "../../lib/worker/credits";
import { settleApprovedReport } from "../../lib/reports/settlement-seam";
import {
  cleanupSessionFixtures,
  createSessionFixtures,
  closePrisma,
  type SessionFixtures,
} from "../helpers/session-fixtures";

jest.setTimeout(180_000);

let fx: SessionFixtures;

type SubscriptionSpec = {
  studentProfileId: string;
  packageType: "MONTHLY_PLAN" | "ANNUAL_PLAN" | "PAY_PER_SESSION";
  sessions: number;
  status?: "ACTIVE" | "EXPIRED" | "EXHAUSTED";
  periodEndsAt?: Date | null;
  withLedger?: boolean;
};

async function createFundedSubscription(spec: SubscriptionSpec) {
  const invoice = await prisma.invoice.create({
    data: {
      academyId: fx.academyId,
      studentId: spec.studentProfileId,
      amountMinor: BigInt(80000),
      currency: "EGP",
      provider: "PAYMOB",
      packageType: spec.packageType,
      sessionsPurchased: spec.sessions,
      status: "PAID",
      paidAt: new Date(),
    },
    select: { id: true },
  });
  const subscription = await prisma.subscription.create({
    data: {
      academyId: fx.academyId,
      studentId: spec.studentProfileId,
      packageType: spec.packageType,
      sessionsPurchased: spec.sessions,
      totalAmountMinor: BigInt(80000),
      currency: "EGP",
      status: spec.status ?? "ACTIVE",
      periodStartsAt: new Date(Date.now() - 31 * 24 * 3600 * 1000),
      periodEndsAt: spec.periodEndsAt === undefined ? new Date(Date.now() - 24 * 3600 * 1000) : spec.periodEndsAt,
    },
    select: { id: true },
  });
  if (spec.withLedger !== false) {
    await prisma.subscriptionLedger.create({
      data: {
        academyId: fx.academyId,
        subscriptionId: subscription.id,
        invoiceId: invoice.id,
        entryType: "INITIAL_PURCHASE",
        sessionsDelta: spec.sessions,
      },
    });
  }
  return { subscriptionId: subscription.id, invoiceId: invoice.id };
}

async function createPastSession(studentProfileId: string) {
  const end = new Date(Date.now() - 60 * 60 * 1000);
  return prisma.session.create({
    data: {
      academyId: fx.academyId,
      teacherId: fx.teacherProfileId,
      subjectId: fx.subjectId,
      sessionType: "PRIVATE",
      scheduledStart: new Date(end.getTime() - 60 * 60 * 1000),
      scheduledEnd: end,
      durationMinutes: 60,
      timezone: "Africa/Cairo",
      zoomJoinUrl: "https://zoom.us/j/345678901234",
      createdById: fx.adminUserId,
      status: "SCHEDULED",
      students: { create: [{ studentId: studentProfileId }] },
    },
    select: { id: true },
  });
}

async function createReservation(sessionId: string, studentProfileId: string, subscriptionId: string) {
  return prisma.sessionReservation.create({
    data: { academyId: fx.academyId, sessionId, studentId: studentProfileId, subscriptionId },
    select: { id: true },
  });
}

/** A real APPROVED report row so settleApprovedReport can finalize it (same pattern as reports.test.ts). */
async function createApprovedReportRow(sessionId: string, studentProfileId: string) {
  const report = await prisma.report.create({
    data: {
      academyId: fx.academyId,
      sessionId,
      studentId: studentProfileId,
      teacherId: fx.teacherProfileId,
      reportType: "SESSION_COMPLETION_REPORT",
      status: "APPROVED",
      attendanceOutcome: "ATTENDED",
      classRemark: "good",
      summary: "Credit expiry settlement test report.",
      homework: "Do the exercises.",
      approvedById: fx.adminUserId,
      approvedAt: new Date(),
    },
    select: { id: true },
  });
  return report.id;
}

async function settleSession(sessionId: string, studentProfileId: string) {
  const reportId = await createApprovedReportRow(sessionId, studentProfileId);
  await prisma.$transaction(async (tx) =>
    settleApprovedReport(tx, {
      id: reportId,
      academyId: fx.academyId,
      sessionId,
      studentId: studentProfileId,
      teacherId: fx.teacherProfileId,
      attendanceOutcome: "ATTENDED",
    }),
  );
}

async function balanceOf(subscriptionId: string) {
  const aggregate = await prisma.subscriptionLedger.aggregate({
    where: { subscriptionId },
    _sum: { sessionsDelta: true },
  });
  return aggregate._sum.sessionsDelta ?? 0;
}

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("Session 2 — monthly credit EXPIRY worker (no rollover, idempotent)", () => {
  it("INT-EXP-01: an ended monthly subscription with balance 3 and no reservations writes EXPIRY -3 linked to the funding invoice and finalizes EXPIRED", async () => {
    const { subscriptionId, invoiceId } = await createFundedSubscription({
      studentProfileId: fx.studentProfileIds.student1,
      packageType: "MONTHLY_PLAN",
      sessions: 3,
    });
    await processMonthlyCreditExpiry(new Date(), fx.academyId);
    const expiry = await prisma.subscriptionLedger.findFirstOrThrow({
      where: { subscriptionId, entryType: "EXPIRY" },
    });
    expect(expiry.sessionsDelta).toBe(-3);
    expect(expiry.invoiceId).toBe(invoiceId);
    const fresh = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId }, select: { status: true } });
    expect(fresh.status).toBe("EXPIRED");
  });

  it("INT-EXP-02: re-running the worker on the same subscription writes no second EXPIRY (idempotent)", async () => {
    const { subscriptionId } = await createFundedSubscription({
      studentProfileId: fx.studentProfileIds.student1,
      packageType: "MONTHLY_PLAN",
      sessions: 3,
    });
    await processMonthlyCreditExpiry(new Date(), fx.academyId);
    await processMonthlyCreditExpiry(new Date(), fx.academyId);
    const expiryCount = await prisma.subscriptionLedger.count({ where: { subscriptionId, entryType: "EXPIRY" } });
    expect(expiryCount).toBe(1);
    const fresh = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId }, select: { status: true } });
    expect(fresh.status).toBe("EXPIRED");
  });

  it("INT-EXP-03: an ended subscription with 1 RESERVED reservation and balance 2 writes EXPIRY -1 and stays ACTIVE", async () => {
    const { subscriptionId } = await createFundedSubscription({
      studentProfileId: fx.studentProfileIds.student2,
      packageType: "MONTHLY_PLAN",
      sessions: 2,
    });
    const session = await createPastSession(fx.studentProfileIds.student2);
    await createReservation(session.id, fx.studentProfileIds.student2, subscriptionId);
    await processMonthlyCreditExpiry(new Date(), fx.academyId);
    const expiry = await prisma.subscriptionLedger.findFirstOrThrow({ where: { subscriptionId, entryType: "EXPIRY" } });
    expect(expiry.sessionsDelta).toBe(-1);
    expect(await balanceOf(subscriptionId)).toBe(1);
    const fresh = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId }, select: { status: true } });
    expect(fresh.status).toBe("ACTIVE");
  });

  it("INT-EXP-04: once the reservation releases, the next pass expires the remainder and finalizes the status", async () => {
    const { subscriptionId } = await createFundedSubscription({
      studentProfileId: fx.studentProfileIds.student2,
      packageType: "MONTHLY_PLAN",
      sessions: 2,
    });
    const session = await createPastSession(fx.studentProfileIds.student2);
    const reservation = await createReservation(session.id, fx.studentProfileIds.student2, subscriptionId);
    await processMonthlyCreditExpiry(new Date(), fx.academyId);
    // Resolve the reservation (as an approved absence would), then run the next pass.
    await prisma.sessionReservation.update({
      where: { id: reservation.id },
      data: { status: "RELEASED", releasedAt: new Date() },
    });
    await processMonthlyCreditExpiry(new Date(), fx.academyId);
    const expiries = await prisma.subscriptionLedger.findMany({ where: { subscriptionId, entryType: "EXPIRY" } });
    expect(expiries).toHaveLength(2);
    expect(expiries.reduce((total, entry) => total + entry.sessionsDelta, 0)).toBe(-2);
    expect(await balanceOf(subscriptionId)).toBe(0);
    const fresh = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId }, select: { status: true } });
    expect(fresh.status).toBe("EXPIRED");
  });

  it("INT-EXP-05: a balance-0 subscription with no reservations finalizes EXHAUSTED without an EXPIRY entry", async () => {
    const { subscriptionId } = await createFundedSubscription({
      studentProfileId: fx.studentProfileIds.student3,
      packageType: "MONTHLY_PLAN",
      sessions: 0,
    });
    await processMonthlyCreditExpiry(new Date(), fx.academyId);
    expect(await prisma.subscriptionLedger.count({ where: { subscriptionId, entryType: "EXPIRY" } })).toBe(0);
    const fresh = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId }, select: { status: true } });
    expect(fresh.status).toBe("EXHAUSTED");
  });

  it("INT-EXP-06: a PAY_PER_SESSION subscription is never touched by the expiry worker", async () => {
    const { subscriptionId } = await createFundedSubscription({
      studentProfileId: fx.studentProfileIds.student4,
      packageType: "PAY_PER_SESSION",
      sessions: 5,
      periodEndsAt: null,
    });
    await processMonthlyCreditExpiry(new Date(), fx.academyId);
    expect(await prisma.subscriptionLedger.count({ where: { subscriptionId, entryType: "EXPIRY" } })).toBe(0);
    expect(await balanceOf(subscriptionId)).toBe(5);
    const fresh = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId }, select: { status: true } });
    expect(fresh.status).toBe("ACTIVE");
  });

  it("INT-EXP-07: concurrent worker runs on the same subscription produce exactly one EXPIRY entry", async () => {
    const { subscriptionId } = await createFundedSubscription({
      studentProfileId: fx.studentProfileIds.student5,
      packageType: "MONTHLY_PLAN",
      sessions: 3,
    });
    await Promise.all([
      processMonthlyCreditExpiry(new Date(), fx.academyId),
      processMonthlyCreditExpiry(new Date(), fx.academyId),
    ]);
    const expiries = await prisma.subscriptionLedger.count({ where: { subscriptionId, entryType: "EXPIRY" } });
    expect(expiries).toBe(1);
    const fresh = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId }, select: { status: true } });
    expect(fresh.status).toBe("EXPIRED");
  });

  it("INT-EXP-08: a late settlement after expiry proceeds, may drive the balance negative, and raises the BALANCE_NEGATIVE admin job", async () => {
    const { subscriptionId } = await createFundedSubscription({
      studentProfileId: fx.studentProfileIds.student6,
      packageType: "MONTHLY_PLAN",
      sessions: 3,
    });
    // One reserved session survives period end; the worker expires only the remainder.
    const reservedSession = await createPastSession(fx.studentProfileIds.student6);
    await createReservation(reservedSession.id, fx.studentProfileIds.student6, subscriptionId);
    await processMonthlyCreditExpiry(new Date(), fx.academyId);
    expect(await balanceOf(subscriptionId)).toBe(1);
    const activeAfterExpiry = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId }, select: { status: true } });
    expect(activeAfterExpiry.status).toBe("ACTIVE");

    // Late settlement #1: the reserved session settles normally (reservation consumed).
    await settleSession(reservedSession.id, fx.studentProfileIds.student6);
    expect(await balanceOf(subscriptionId)).toBe(0);

    // Late settlement #2: an override-scheduled session with NO reservation settles
    // against the still-ACTIVE subscription — balance goes negative, Admin flagged.
    const overrideSession = await createPastSession(fx.studentProfileIds.student6);
    await settleSession(overrideSession.id, fx.studentProfileIds.student6);
    expect(await balanceOf(subscriptionId)).toBe(-1);
    const adminJob = await prisma.notificationJob.findFirstOrThrow({
      where: { kind: "BALANCE_NEGATIVE", dedupKey: `BALANCE_NEGATIVE:${subscriptionId}` },
    });
    expect(adminJob.recipientUserId).toBe(fx.adminUserId);
    expect(adminJob.academyId).toBe(fx.academyId);
  });
});
