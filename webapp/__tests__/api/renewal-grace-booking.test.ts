jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { getServerSession } from "next-auth";

import { POST as createSessionRoute } from "../../app/api/sessions/route";
import { POST as recurrencesRoute } from "../../app/api/sessions/recurrences/route";
import { POST as enrollRoute } from "../../app/api/admin/enrollments/route";
import { reserveCredit } from "../../lib/credits/reservation";
import { prisma } from "../../lib/prisma";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * D80 / D89 (owner, 2026-10-29/30): while a student's automatic renewal is PAST_DUE
 * (grace), every NEW booking is refused — pay-per-session credit included — with
 * 409 RENEWAL_PAST_DUE; booked sessions stay; a verified renewal (ACTIVE) unblocks.
 * The worker's series extension uses reserveCredit, which refuses the same way (the
 * series pauses). Per-run test academy.
 */
jest.setTimeout(180_000);

const getServerSessionMock = getServerSession as jest.Mock;
const as = (userId: string) => getServerSessionMock.mockResolvedValue({ user: { id: userId } });
let fx: SessionFixtures;
let planId: string;

const JOIN_URL = "https://zoom.us/j/555444333222";
const request = (path: string, body: unknown) =>
  new Request(`http://localhost:3000${path}`, { method: "POST", headers: sameOriginHeaders({ "content-type": "application/json" }), body: JSON.stringify(body) });
const slot = (day: number, hour: number) => {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + day);
  start.setUTCHours(hour, 0, 0, 0);
  return { scheduledStart: start.toISOString(), scheduledEnd: new Date(start.getTime() + 3_600_000).toISOString() };
};
const payload = (studentKey: string, day: number, hour: number, sessionType = "PRIVATE") => ({
  teacherId: fx.teacherProfileId, subjectId: fx.subjectId, sessionType, timezone: "Africa/Cairo", zoomJoinUrl: JOIN_URL,
  studentIds: [fx.studentProfileIds[studentKey]], ...slot(day, hour),
});

async function credit(studentKey: string, sessions: number, packageType: "MONTHLY_PLAN" | "PAY_PER_SESSION") {
  const subscription = await prisma.subscription.create({
    data: {
      academyId: fx.academyId, studentId: fx.studentProfileIds[studentKey], packageType, sessionsPurchased: sessions,
      totalAmountMinor: BigInt(100000), currency: "EGP", status: "ACTIVE",
      ...(packageType === "MONTHLY_PLAN" ? { periodStartsAt: new Date(Date.now() - 86_400_000), periodEndsAt: new Date(Date.now() + 30 * 86_400_000) } : {}),
    },
  });
  const invoice = await prisma.invoice.create({
    data: { academyId: fx.academyId, studentId: fx.studentProfileIds[studentKey], subscriptionId: subscription.id, amountMinor: BigInt(100000), currency: "EGP", provider: "PAYMOB", packageType, sessionsPurchased: sessions, status: "PAID", paidAt: new Date() },
  });
  await prisma.subscriptionLedger.create({ data: { academyId: fx.academyId, subscriptionId: subscription.id, invoiceId: invoice.id, entryType: "INITIAL_PURCHASE", sessionsDelta: sessions } });
}

const renewal = (studentKey: string, status: "PAST_DUE" | "ACTIVE") =>
  prisma.billingSubscription.create({
    data: {
      academyId: fx.academyId, studentId: fx.studentProfileIds[studentKey], payerUserId: fx.guardianUserId, planId, currency: "EGP", status,
      provider: "PAYMOB", lockedPriceMinor: BigInt(100000), currentPeriodStart: new Date(Date.now() - 31 * 86_400_000),
      currentPeriodEnd: new Date(Date.now() - 86_400_000), consentTimestamp: new Date(), autoRenew: true,
      ...(status === "PAST_DUE" ? { graceEndsAt: new Date(Date.now() + 2 * 86_400_000) } : {}),
    },
  });

beforeAll(async () => {
  fx = await createSessionFixtures();
  planId = (await prisma.billingPlan.create({
    data: { academyId: fx.academyId, nameAr: "شهري", nameEn: "Monthly", packageType: "MONTHLY_PLAN", sessionsPerMonth: 8, basePriceMinor: BigInt(100000) },
  })).id;
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("D80 / D89 — no new booking during the renewal grace", () => {
  it("GR-01: single session, series and enrollment are refused with 409 RENEWAL_PAST_DUE, pay-per-session credit included", async () => {
    await credit("student1", 4, "PAY_PER_SESSION");
    await renewal("student1", "PAST_DUE");
    as(fx.adminUserId);
    const single = await createSessionRoute(request("/api/sessions", payload("student1", 26, 6)));
    expect(single.status).toBe(409);
    expect((await single.json()).error.code).toBe("RENEWAL_PAST_DUE");
    const series = await recurrencesRoute(request("/api/sessions/recurrences", { ...payload("student1", 26, 8), weekCount: 2 }));
    expect(series.status).toBe(409);
    expect((await series.json()).error.code).toBe("RENEWAL_PAST_DUE");
    // Enrollment into an existing GROUP session of another student.
    await credit("student2", 2, "PAY_PER_SESSION");
    const group = await createSessionRoute(request("/api/sessions", payload("student2", 26, 10, "GROUP")));
    expect(group.status).toBe(201);
    const groupId = (await group.json()).data.id as string;
    const enroll = await enrollRoute(request("/api/admin/enrollments", { sessionId: groupId, studentId: fx.studentProfileIds.student1 }));
    expect(enroll.status).toBe(409);
    expect((await enroll.json()).error.code).toBe("RENEWAL_PAST_DUE");
    expect(await prisma.sessionReservation.count({ where: { studentId: fx.studentProfileIds.student1 } })).toBe(0);
  });

  it("GR-02: the worker's credit reservation refuses too (a series week pauses)", async () => {
    const session = await prisma.session.findFirstOrThrow({ where: { academyId: fx.academyId, students: { some: { studentId: fx.studentProfileIds.student2 } } } });
    const outcome = await prisma.$transaction((tx) => reserveCredit(tx, fx.academyId, fx.studentProfileIds.student1, session.id, session.scheduledStart));
    expect(outcome).toBe(false);
  });

  it("GR-03: sessions booked before the grace stay; a verified renewal (ACTIVE) unblocks booking", async () => {
    await credit("student3", 4, "MONTHLY_PLAN");
    as(fx.adminUserId);
    const before = await createSessionRoute(request("/api/sessions", payload("student3", 26, 12)));
    expect(before.status).toBe(201);
    const sub = await renewal("student3", "PAST_DUE");
    expect(await prisma.sessionReservation.count({ where: { studentId: fx.studentProfileIds.student3, status: "RESERVED" } })).toBe(1);
    expect((await createSessionRoute(request("/api/sessions", payload("student3", 26, 14)))).status).toBe(409);
    await prisma.billingSubscription.update({ where: { id: sub.id }, data: { status: "ACTIVE", graceEndsAt: null } });
    expect((await createSessionRoute(request("/api/sessions", payload("student3", 26, 16)))).status).toBe(201);
  });

  it("GR-04: a student without a past-due renewal books normally", async () => {
    await credit("student4", 1, "PAY_PER_SESSION");
    await renewal("student4", "ACTIVE");
    as(fx.adminUserId);
    expect((await createSessionRoute(request("/api/sessions", payload("student4", 26, 18)))).status).toBe(201);
  });
});
