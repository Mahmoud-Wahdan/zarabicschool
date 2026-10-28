jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { randomInt } from "node:crypto";

import { getServerSession } from "next-auth";

import { GET as listRoute } from "../../app/api/billing/subscriptions/route";
import { POST as cancelRoute } from "../../app/api/billing/subscriptions/[id]/cancel/route";
import { prisma } from "../../lib/prisma";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * Payer-facing automatic renewal routes (D52): list and cancel. Finance wall: the
 * Admin of the academy or the student's payer (linked guardian, or an adult student
 * without a guardian); Supervisor, Teacher and a child student never. Paymob is never
 * reached here: the rows either have no Paymob id, or the API key is removed so the
 * client stops before any network call.
 */
jest.setTimeout(240_000);

const getServerSessionMock = getServerSession as jest.Mock;
let fx: SessionFixtures;
let planId: string;

const as = (userId: string) => getServerSessionMock.mockResolvedValue({ user: { id: userId } });
const cancel = (id: string, headers = sameOriginHeaders()) =>
  cancelRoute(new Request(`http://localhost:3000/api/billing/subscriptions/${id}/cancel`, { method: "POST", headers }), { params: Promise.resolve({ id }) });
const list = () => listRoute();

async function billingSubscription(studentKey: string, providerSubscriptionId: string | null = null) {
  return prisma.billingSubscription.create({
    data: {
      academyId: fx.academyId, studentId: fx.studentProfileIds[studentKey], payerUserId: fx.guardianUserId, planId,
      currency: "EGP", status: "ACTIVE", providerSubscriptionId, lockedPriceMinor: BigInt(100000),
      currentPeriodStart: new Date("2026-10-10T12:00:00Z"), currentPeriodEnd: new Date("2026-11-09T22:00:00Z"), billingAnchorDay: 10,
    },
  });
}

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

describe("billing subscription routes", () => {
  it("BS-01: the guardian cancels: 200 cancel_scheduled, auto-renew off, the paid period kept", async () => {
    const sub = await billingSubscription("student1");
    as(fx.guardianUserId);
    const response = await cancel(sub.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "cancel_scheduled", periodEnd: "2026-11-09T22:00:00.000Z" });
    expect(await prisma.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } })).toMatchObject({ autoRenew: false, status: "ACTIVE" });
  });

  it("BS-02: Supervisor, Teacher, the child student and another academy's Admin cannot cancel; nothing changes", async () => {
    const sub = await billingSubscription("student2");
    for (const userId of [fx.supervisorUserId, fx.teacherUserId, fx.studentUserIds.student2, fx.foreignAdminUserId]) {
      as(userId);
      const response = await cancel(sub.id);
      expect([403, 404]).toContain(response.status);
    }
    expect(await prisma.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } })).toMatchObject({ autoRenew: true, canceledAt: null });
  });

  it("BS-03: a cross-origin cancel is 403 ORIGIN_NOT_ALLOWED; a bad id is 400", async () => {
    const sub = await billingSubscription("student3");
    as(fx.adminUserId);
    const crossOrigin = await cancel(sub.id, { origin: "https://evil.example", host: "localhost:3000" });
    expect(crossOrigin.status).toBe(403);
    expect((await cancel("not-a-uuid")).status).toBe(400);
    expect((await prisma.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } })).autoRenew).toBe(true);
  });

  it("BS-04: when Paymob cannot be called the cancel fails visibly (503) and nothing changes locally", async () => {
    const sub = await billingSubscription("student4", String(randomInt(1_000_000, 2_000_000_000)));
    const saved = process.env.PAYMOB_API_KEY;
    delete process.env.PAYMOB_API_KEY;
    try {
      as(fx.adminUserId);
      const response = await cancel(sub.id);
      expect(response.status).toBe(503);
      expect(await response.text()).not.toMatch(/\n\s+at |prisma/i);
    } finally {
      if (saved !== undefined) process.env.PAYMOB_API_KEY = saved;
    }
    expect((await prisma.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } })).autoRenew).toBe(true);
  });

  it("BS-05: the list shows the guardian their children's subscriptions and the Admin the academy's; Supervisor 403; foreign Admin sees none", async () => {
    const sub = await billingSubscription("student5");
    as(fx.guardianUserId);
    const mine = await (await list()).json();
    expect(mine.subscriptions.map((row: { id: string }) => row.id)).toContain(sub.id);
    const row = mine.subscriptions.find((entry: { id: string }) => entry.id === sub.id);
    expect(row).toMatchObject({ status: "ACTIVE", autoRenew: true, planName: expect.any(String), studentName: expect.any(String) });
    expect(row).not.toHaveProperty("providerSubscriptionId");
    as(fx.adminUserId);
    expect((await (await list()).json()).subscriptions.map((entry: { id: string }) => entry.id)).toContain(sub.id);
    as(fx.supervisorUserId);
    expect((await list()).status).toBe(403);
    as(fx.foreignAdminUserId);
    expect((await (await list()).json()).subscriptions).toEqual([]);
    as(fx.studentUserIds.student5);
    expect((await list()).status).toBe(403);
  });
});
