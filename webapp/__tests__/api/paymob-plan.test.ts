jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { randomInt } from "node:crypto";

import { getServerSession } from "next-auth";

import { POST as paymobPlanRoute } from "../../app/api/admin/billing/plans/[id]/paymob-plan/route";
import { PaymobSubscriptionClient } from "../../lib/payments/paymob-subscriptions";
import { prisma } from "../../lib/prisma";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * Admin: create the Paymob subscription plan behind a monthly plan (D53). Paymob is
 * replaced at the client boundary (spy), so nothing reaches Paymob from a test.
 */
jest.setTimeout(240_000);

const getServerSessionMock = getServerSession as jest.Mock;
let fx: SessionFixtures;
let createPlan: jest.SpyInstance;

const as = (userId: string) => getServerSessionMock.mockResolvedValue({ user: { id: userId } });
const link = (id: string, headers = sameOriginHeaders()) =>
  paymobPlanRoute(new Request(`http://localhost:3000/api/admin/billing/plans/${id}/paymob-plan`, { method: "POST", headers }), { params: Promise.resolve({ id }) });
const plan = (data: Record<string, unknown> = {}) =>
  prisma.billingPlan.create({ data: { academyId: fx.academyId, nameAr: "شهري", nameEn: "Monthly 8", packageType: "MONTHLY_PLAN", sessionsPerMonth: 8, basePriceMinor: BigInt(100000), ...data } as never });

beforeAll(async () => {
  fx = await createSessionFixtures();
  createPlan = jest.spyOn(PaymobSubscriptionClient.prototype, "createPlan").mockImplementation(async () => String(randomInt(1_000_000, 2_000_000_000)));
});

afterAll(async () => {
  jest.restoreAllMocks();
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("Admin: Paymob plan for a monthly plan", () => {
  it("PP-01: the Admin links a monthly EGP plan; the Paymob plan id is stored once with our webhook URL and price", async () => {
    const row = await plan();
    as(fx.adminUserId);
    const response = await link(row.id);
    expect(response.status).toBe(201);
    const stored = await prisma.billingPlan.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.providerPlanId).toMatch(/^\d+$/);
    expect(await response.json()).toEqual({ providerPlanId: stored.providerPlanId });
    expect(createPlan.mock.calls.at(-1)[0]).toMatchObject({ amountMinor: BigInt(100000), webhookUrl: expect.stringMatching(/\/api\/payments\/paymob\/subscription-webhook$/) });
    const again = await link(row.id);
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("ALREADY_LINKED");
  });

  it("PP-02: a plan that is not monthly, not EGP or inactive is refused without calling Paymob", async () => {
    as(fx.adminUserId);
    const calls = createPlan.mock.calls.length;
    for (const data of [{ packageType: "PAY_PER_SESSION" }, { currency: "USD" }, { isActive: false }]) {
      expect((await link((await plan(data)).id)).status).toBe(409);
    }
    expect(createPlan.mock.calls.length).toBe(calls);
  });

  it("PP-03: Supervisor 403, a foreign Admin 404, cross-origin 403, bad id 400", async () => {
    const row = await plan();
    as(fx.supervisorUserId);
    expect((await link(row.id)).status).toBe(403);
    as(fx.foreignAdminUserId);
    expect((await link(row.id)).status).toBe(404);
    as(fx.adminUserId);
    expect((await link(row.id, { origin: "https://evil.example", host: "localhost:3000" })).status).toBe(403);
    expect((await link("nope")).status).toBe(400);
    expect((await prisma.billingPlan.findUniqueOrThrow({ where: { id: row.id } })).providerPlanId).toBeNull();
  });
});
