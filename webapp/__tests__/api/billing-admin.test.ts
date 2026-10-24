jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

// INT-BILL-04 mocks the Phase 6b readiness flag; every other test pins it true
// (the real migration is applied, so this matches production behavior).
jest.mock("../../lib/billing/readiness", () => ({
  isPhase6bReady: jest.fn().mockResolvedValue(true),
}));

import { randomUUID } from "node:crypto";

import { getServerSession } from "next-auth";

import { isPhase6bReady } from "../../lib/billing/readiness";
import { GET as listPlansRoute, POST as createPlanRoute } from "../../app/api/admin/billing/plans/route";
import { PATCH as updatePlanRoute } from "../../app/api/admin/billing/plans/[id]/route";
import { GET as listRatesRoute, POST as createRateRoute } from "../../app/api/admin/billing/exchange-rates/route";
import { GET as getPayPerSessionRoute, POST as setPayPerSessionRoute } from "../../app/api/admin/billing/settings/pay-per-session/route";
import { prisma } from "../../lib/prisma";
import {
  cleanupSessionFixtures,
  createSessionFixtures,
  closePrisma,
  type SessionFixtures,
} from "../helpers/session-fixtures";

const getServerSessionMock = getServerSession as jest.Mock;
const readinessMock = isPhase6bReady as jest.Mock;

jest.setTimeout(180_000);

let fx: SessionFixtures;

function asActor(userId: string | null) {
  getServerSessionMock.mockResolvedValue(userId ? { user: { id: userId } } : null);
}

function apiRequest(method: string, body?: unknown) {
  return new Request(`http://localhost:3000/api/admin/billing`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const planPayload = {
  nameAr: "خطة تجريبية",
  nameEn: "Test plan",
  packageType: "MONTHLY_PLAN",
  sessionsPerMonth: 8,
  basePriceMinor: "80000",
  currency: "EGP",
};

const ratePayload = { fromCurrency: "USD", toCurrency: "EGP", rate: "48.5" };
const payPerSessionPayload = { minSessions: 1, maxSessions: 16 };

type ApiErrorShape = { error?: { code?: string; message?: string } };
type CallResult = { status: number; body: ApiErrorShape & Record<string, unknown> };

async function callPlans(actorId: string | null, method: "GET" | "POST", payload?: unknown): Promise<CallResult> {
  asActor(actorId);
  const response = method === "GET" ? await listPlansRoute() : await createPlanRoute(apiRequest("POST", payload ?? planPayload));
  return { status: response.status, body: (await response.json()) as CallResult["body"] };
}

async function callPlanPatch(actorId: string | null, planId: string, payload?: unknown): Promise<CallResult> {
  asActor(actorId);
  const response = await updatePlanRoute(apiRequest("PATCH", payload ?? { basePriceMinor: "90000" }), {
    params: Promise.resolve({ id: planId }),
  });
  return { status: response.status, body: (await response.json()) as CallResult["body"] };
}

async function callRates(actorId: string | null, method: "GET" | "POST", payload?: unknown): Promise<CallResult> {
  asActor(actorId);
  const response = method === "GET" ? await listRatesRoute() : await createRateRoute(apiRequest("POST", payload ?? ratePayload));
  return { status: response.status, body: (await response.json()) as CallResult["body"] };
}

async function callPayPerSession(actorId: string | null, method: "GET" | "POST", payload?: unknown): Promise<CallResult> {
  asActor(actorId);
  const response = method === "GET"
    ? await getPayPerSessionRoute()
    : await setPayPerSessionRoute(apiRequest("POST", payload ?? payPerSessionPayload));
  return { status: response.status, body: (await response.json()) as CallResult["body"] };
}

beforeEach(() => {
  readinessMock.mockResolvedValue(true);
});

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) {
    // Billing rows (RESTRICT FKs to the academy) are not covered by the shared
    // fixture cleanup — remove subscriptions, then plans.
    await prisma.billingSubscription.deleteMany({ where: { academyId: { in: [fx.academyId, fx.foreignAcademyId] } } });
    await prisma.billingPlan.deleteMany({ where: { academyId: { in: [fx.academyId, fx.foreignAcademyId] } } });
    await prisma.exchangeRate.deleteMany({ where: { academyId: { in: [fx.academyId, fx.foreignAcademyId] } } });
    await cleanupSessionFixtures(fx);
  }
  await closePrisma();
});

describe("Session 2 — billing route authorization (Admin-only money surfaces)", () => {
  it("INT-BILL-01: a supervisor gets 403 on every plans/exchange-rates/pay-per-session route", async () => {
    const supervisor = fx.supervisorUserId;
    const supervisorCalls = [
      () => callPlans(supervisor, "GET"),
      () => callPlans(supervisor, "POST"),
      () => callPlanPatch(supervisor, randomUUID()),
      () => callRates(supervisor, "GET"),
      () => callRates(supervisor, "POST"),
      () => callPayPerSession(supervisor, "GET"),
      () => callPayPerSession(supervisor, "POST"),
    ];
    for (const call of supervisorCalls) {
      const { status, body } = await call();
      expect(status).toBe(403);
      expect(body.error?.code).toBe("FORBIDDEN");
    }
  });

  it("INT-BILL-02: teacher, student and guardian get 403 on the same routes; anonymous callers get 401", async () => {
    const restrictedCalls = [
      (actorId: string) => callPlans(actorId, "GET"),
      (actorId: string) => callPlans(actorId, "POST"),
      (actorId: string) => callPlanPatch(actorId, randomUUID()),
      (actorId: string) => callRates(actorId, "GET"),
      (actorId: string) => callRates(actorId, "POST"),
      (actorId: string) => callPayPerSession(actorId, "GET"),
      (actorId: string) => callPayPerSession(actorId, "POST"),
    ];
    for (const actorId of [fx.teacherUserId, fx.studentUserIds.student1, fx.guardianUserId]) {
      for (const call of restrictedCalls) {
        const { status } = await call(actorId);
        expect(status).toBe(403);
      }
    }
    const anonymous = await callPlans(null, "GET");
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error?.code).toBe("UNAUTHORIZED");
  });

  it("INT-BILL-03: a plan price update changes the plan row only — an existing subscriber keeps the locked price", async () => {
    const created = await callPlans(fx.adminUserId, "POST");
    expect(created.status).toBe(201);
    const planId = (created.body.data as { id: string }).id;

    const subscription = await prisma.billingSubscription.create({
      data: {
        academyId: fx.academyId,
        studentId: fx.studentProfileIds.student1,
        payerUserId: fx.guardianUserId,
        planId,
        currency: "EGP",
        status: "ACTIVE",
        provider: "PAYMOB",
        lockedPriceMinor: BigInt(80000),
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
      select: { id: true, lockedPriceMinor: true },
    });
    expect(subscription.lockedPriceMinor).toBe(BigInt(80000));

    const updated = await callPlanPatch(fx.adminUserId, planId, { basePriceMinor: "90000" });
    expect(updated.status).toBe(200);
    expect((updated.body.data as { basePriceMinor: string }).basePriceMinor).toBe("90000");

    const planRow = await prisma.billingPlan.findUniqueOrThrow({ where: { id: planId }, select: { basePriceMinor: true } });
    expect(planRow.basePriceMinor).toBe(BigInt(90000));
    // The subscriber's price was locked at subscription creation and is untouched.
    const subscriptionRow = await prisma.billingSubscription.findUniqueOrThrow({
      where: { id: subscription.id },
      select: { lockedPriceMinor: true },
    });
    expect(subscriptionRow.lockedPriceMinor).toBe(BigInt(80000));
  });

  it("INT-BILL-04: pre-migration, GET returns migrationPending with empty data and POST/PATCH answer 409 MIGRATION_PENDING", async () => {
    readinessMock.mockResolvedValue(false);
    const plansGet = await callPlans(fx.adminUserId, "GET");
    expect(plansGet.status).toBe(200);
    expect(plansGet.body.data).toEqual([]);
    expect(plansGet.body.migrationPending).toBe(true);

    const plansPost = await callPlans(fx.adminUserId, "POST");
    expect(plansPost.status).toBe(409);
    expect(plansPost.body.error?.code).toBe("MIGRATION_PENDING");

    const plansPatch = await callPlanPatch(fx.adminUserId, randomUUID());
    expect(plansPatch.status).toBe(409);
    expect(plansPatch.body.error?.code).toBe("MIGRATION_PENDING");

    const ratesGet = await callRates(fx.adminUserId, "GET");
    expect(ratesGet.status).toBe(200);
    expect(ratesGet.body.data).toEqual([]);
    expect(ratesGet.body.migrationPending).toBe(true);

    const ratesPost = await callRates(fx.adminUserId, "POST");
    expect(ratesPost.status).toBe(409);
    expect(ratesPost.body.error?.code).toBe("MIGRATION_PENDING");
  });
});
