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
import { studentsPastRenewalGrace } from "../../lib/credits/renewal-grace";
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
 * D80 / D89, corrected by the owner on 2026-10-30 (CONTEXT §7, §20.6): a PAST_DUE
 * renewal gives a grace (default 3 days, the Admin setting `billing.renewal_grace_days`).
 * DURING the grace every booking path works. Only AFTER the stored `grace_ends_at`,
 * while still PAST_DUE, every NEW booking is refused with 409 RENEWAL_PAST_DUE,
 * pay-per-session credit included; the worker's series week then pauses (reserveCredit
 * refuses). Booked sessions stay; a verified renewal (ACTIVE) unblocks. Per-run test academy.
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

const HOUR = 3_600_000;
/** "grace" = PAST_DUE with the grace still running; "expired" = PAST_DUE after the grace ended. */
const renewal = (studentKey: string, state: "grace" | "expired" | "ACTIVE") =>
  prisma.billingSubscription.create({
    data: {
      academyId: fx.academyId, studentId: fx.studentProfileIds[studentKey], payerUserId: fx.guardianUserId, planId, currency: "EGP", status: state === "ACTIVE" ? "ACTIVE" : "PAST_DUE",
      provider: "PAYMOB", lockedPriceMinor: BigInt(100000), currentPeriodStart: new Date(Date.now() - 31 * 86_400_000),
      currentPeriodEnd: new Date(Date.now() - 86_400_000), consentTimestamp: new Date(), autoRenew: true,
      ...(state === "grace" ? { graceEndsAt: new Date(Date.now() + 2 * 86_400_000) } : {}),
      ...(state === "expired" ? { graceEndsAt: new Date(Date.now() - HOUR) } : {}),
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

describe("D80 / D89 — new bookings are blocked only after the renewal grace ends", () => {
  it("GR-01: DURING the grace, single session, series and enrollment all book (pay-per-session credit)", async () => {
    await credit("student1", 6, "PAY_PER_SESSION");
    await renewal("student1", "grace");
    as(fx.adminUserId);
    expect((await createSessionRoute(request("/api/sessions", payload("student1", 26, 6)))).status).toBe(201);
    expect((await recurrencesRoute(request("/api/sessions/recurrences", { ...payload("student1", 26, 8), weekCount: 2 }))).status).toBe(201);
    await credit("student2", 4, "PAY_PER_SESSION");
    const group = await createSessionRoute(request("/api/sessions", payload("student2", 26, 10, "GROUP")));
    expect(group.status).toBe(201);
    const groupId = (await group.json()).data.id as string;
    expect((await enrollRoute(request("/api/admin/enrollments", { sessionId: groupId, studentId: fx.studentProfileIds.student1 }))).status).toBe(201);
    // The worker's series extension books too (no SERIES_PAUSED during the grace).
    const other = await createSessionRoute(request("/api/sessions", payload("student2", 26, 12)));
    const otherId = (await other.json()).data.id as string;
    const otherSession = await prisma.session.findUniqueOrThrow({ where: { id: otherId } });
    expect(await prisma.$transaction((tx) => reserveCredit(tx, fx.academyId, fx.studentProfileIds.student1, otherId, otherSession.scheduledStart))).toBe(true);
  });

  it("GR-02: AFTER the grace, still PAST_DUE: single, series and enrollment get 409 RENEWAL_PAST_DUE and the worker's reservation refuses", async () => {
    await credit("student5", 4, "PAY_PER_SESSION");
    await renewal("student5", "expired");
    as(fx.adminUserId);
    const single = await createSessionRoute(request("/api/sessions", payload("student5", 27, 6)));
    expect(single.status).toBe(409);
    expect((await single.json()).error.code).toBe("RENEWAL_PAST_DUE");
    const series = await recurrencesRoute(request("/api/sessions/recurrences", { ...payload("student5", 27, 8), weekCount: 2 }));
    expect(series.status).toBe(409);
    expect((await series.json()).error.code).toBe("RENEWAL_PAST_DUE");
    await credit("student8", 1, "PAY_PER_SESSION");
    const group = await createSessionRoute(request("/api/sessions", payload("student8", 27, 10, "GROUP")));
    expect(group.status).toBe(201);
    const groupId = (await group.json()).data.id as string;
    const enroll = await enrollRoute(request("/api/admin/enrollments", { sessionId: groupId, studentId: fx.studentProfileIds.student5 }));
    expect(enroll.status).toBe(409);
    expect((await enroll.json()).error.code).toBe("RENEWAL_PAST_DUE");
    const groupSession = await prisma.session.findUniqueOrThrow({ where: { id: groupId } });
    expect(await prisma.$transaction((tx) => reserveCredit(tx, fx.academyId, fx.studentProfileIds.student5, groupId, groupSession.scheduledStart))).toBe(false);
    expect(await prisma.sessionReservation.count({ where: { studentId: fx.studentProfileIds.student5 } })).toBe(0);
  });

  it("GR-03: sessions booked before stay after the grace ends; a verified renewal (ACTIVE) unblocks booking", async () => {
    await credit("student3", 4, "MONTHLY_PLAN");
    as(fx.adminUserId);
    expect((await createSessionRoute(request("/api/sessions", payload("student3", 26, 14)))).status).toBe(201);
    const sub = await renewal("student3", "expired");
    expect(await prisma.sessionReservation.count({ where: { studentId: fx.studentProfileIds.student3, status: "RESERVED" } })).toBe(1);
    expect((await createSessionRoute(request("/api/sessions", payload("student3", 26, 16)))).status).toBe(409);
    await prisma.billingSubscription.update({ where: { id: sub.id }, data: { status: "ACTIVE", graceEndsAt: null } });
    expect((await createSessionRoute(request("/api/sessions", payload("student3", 26, 18)))).status).toBe(201);
  });

  it("GR-04: a student without a past-due renewal books normally", async () => {
    await credit("student4", 1, "PAY_PER_SESSION");
    await renewal("student4", "ACTIVE");
    as(fx.adminUserId);
    expect((await createSessionRoute(request("/api/sessions", payload("student4", 26, 20)))).status).toBe(201);
  });

  it("GR-05: boundary — one millisecond before the stored grace end books; at the exact grace end it is blocked", async () => {
    const sub = await renewal("student6", "grace");
    const graceEndsAt = new Date(Date.now() + 2 * 86_400_000);
    await prisma.billingSubscription.update({ where: { id: sub.id }, data: { graceEndsAt } });
    const at = (now: Date) => prisma.$transaction((tx) => studentsPastRenewalGrace(tx, fx.academyId, [fx.studentProfileIds.student6], now));
    expect(await at(new Date(graceEndsAt.getTime() - 1))).toEqual([]);
    expect(await at(graceEndsAt)).toEqual([fx.studentProfileIds.student6]);
    expect(await at(new Date(graceEndsAt.getTime() + 1))).toEqual([fx.studentProfileIds.student6]);
  });

  it("GR-06: a PAST_DUE row with no stored grace end is treated as past the grace (never an endless grace)", async () => {
    const sub = await renewal("student7", "grace");
    await prisma.billingSubscription.update({ where: { id: sub.id }, data: { graceEndsAt: null } });
    expect(await prisma.$transaction((tx) => studentsPastRenewalGrace(tx, fx.academyId, [fx.studentProfileIds.student7]))).toEqual([fx.studentProfileIds.student7]);
  });
});
