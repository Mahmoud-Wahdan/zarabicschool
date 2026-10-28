jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { createHash, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getServerSession } from "next-auth";

import { POST as signupRoute } from "../../app/api/billing/subscriptions/route";
import { POST as checkoutRoute } from "../../app/api/invoices/[id]/checkout/route";
import { activateSignup, processRenewals } from "../../lib/billing/renewal";
import { PaymobSubscriptionClient } from "../../lib/payments/paymob-subscriptions";
import { settlePaidInvoice } from "../../lib/payments/settlement";
import { prisma } from "../../lib/prisma";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";
import { cleanupTrackedWebhookEvents, testPaymobId } from "../helpers/webhook-events";

/**
 * Automatic-renewal sign-up (D55: the sign-up payment is month 1; D57 consent and
 * receipt; SQL S-7b INCOMPLETE). Paymob is replaced at the client boundary (spies on
 * PaymobSubscriptionClient) and the keys are dummy test values, so nothing reaches
 * Paymob. The database is the real dev DB in a per-run test academy.
 */
jest.setTimeout(300_000);

const getServerSessionMock = getServerSession as jest.Mock;
const PRICE = BigInt(120000);
const KEY_NAMES = ["PAYMOB_SECRET_KEY", "PAYMOB_PUBLIC_KEY", "PAYMOB_INTEGRATION_ID_EGP", "APP_PUBLIC_URL", "FEATURE_AUTO_RENEWAL"] as const;
const savedEnv: Record<string, string | undefined> = {};
let fx: SessionFixtures;
let monthlyPlanId: string;
let paygPlanId: string;
let unlinkedPlanId: string;
let providerPlanId: string;

const as = (userId: string) => getServerSessionMock.mockResolvedValue({ user: { id: userId } });
const signup = (body: unknown, headers = sameOriginHeaders({ "content-type": "application/json" })) =>
  signupRoute(new Request("http://localhost:3000/api/billing/subscriptions", { method: "POST", headers, body: JSON.stringify(body) }));

function setFakeKeys() {
  process.env.PAYMOB_SECRET_KEY = "sk_test_dummy_signup";
  process.env.PAYMOB_PUBLIC_KEY = "pk_test_dummy_signup";
  process.env.PAYMOB_INTEGRATION_ID_EGP = "111";
  process.env.APP_PUBLIC_URL = "https://app.test";
}

/** The signed transaction callback settling a month-1 invoice (through its attempt's order id). */
async function settleSignupInvoice(invoiceId: string): Promise<string> {
  const attempt = await prisma.paymentAttempt.findFirstOrThrow({ where: { invoiceId } });
  const txnId = testPaymobId();
  const settled = await settlePaidInvoice({
    provider: "PAYMOB", providerEventId: txnId, providerReference: txnId, providerOrderId: attempt.providerOrderId!,
    amountMinor: PRICE, currency: "EGP", succeeded: true, outcome: "SUCCESS", eventType: "PAYMENT_SUCCESS",
    rawEventHash: createHash("sha256").update(`signup-${txnId}`).digest("hex"),
  });
  expect(settled.status).toBe("settled");
  return txnId;
}

const orderIds: string[] = [];
beforeAll(async () => {
  for (const name of KEY_NAMES) savedEnv[name] = process.env[name];
  fx = await createSessionFixtures();
  providerPlanId = String(randomInt(1_000_000, 2_000_000_000));
  const plan = (data: Record<string, unknown>) =>
    prisma.billingPlan.create({ data: { academyId: fx.academyId, nameAr: "شهري", nameEn: "Monthly", packageType: "MONTHLY_PLAN", sessionsPerMonth: 8, basePriceMinor: PRICE, ...data } as never });
  monthlyPlanId = (await plan({ providerPlanId })).id;
  paygPlanId = (await plan({ packageType: "PAY_PER_SESSION", providerPlanId: String(randomInt(1_000_000, 2_000_000_000)) })).id;
  unlinkedPlanId = (await plan({})).id;
  jest.spyOn(PaymobSubscriptionClient.prototype, "createSignupIntention").mockImplementation(async () => {
    const orderId = testPaymobId();
    orderIds.push(orderId);
    return { providerOrderId: orderId, checkoutUrl: `https://paymob.test/unifiedcheckout/?publicKey=pk&clientSecret=${orderId}` };
  });
});

// A6: automatic renewal is behind a flag that is OFF by default; this suite tests the feature itself.
beforeEach(() => {
  process.env.FEATURE_AUTO_RENEWAL = "true";
});

afterEach(() => {
  for (const name of KEY_NAMES) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});

afterAll(async () => {
  jest.restoreAllMocks();
  await cleanupTrackedWebhookEvents();
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("automatic renewal sign-up", () => {
  it("SU-00 (A6): with the flag off (the default) sign-up answers 404 FEATURE_DISABLED and creates nothing", async () => {
    delete process.env.FEATURE_AUTO_RENEWAL;
    as(fx.guardianUserId);
    const response = await signup({ studentId: fx.studentProfileIds.student1, planId: monthlyPlanId, consent: true });
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("FEATURE_DISABLED");
    expect(await prisma.billingSubscription.count({ where: { academyId: fx.academyId } })).toBe(0);
  });

  it("SU-01: without PAYMOB_SECRET_KEY / PAYMOB_PUBLIC_KEY sign-up answers 503 NOT_CONFIGURED and creates nothing", async () => {
    delete process.env.PAYMOB_SECRET_KEY;
    delete process.env.PAYMOB_PUBLIC_KEY;
    as(fx.guardianUserId);
    const response = await signup({ studentId: fx.studentProfileIds.student1, planId: monthlyPlanId, consent: true });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("NOT_CONFIGURED");
    expect(await prisma.billingSubscription.count({ where: { academyId: fx.academyId } })).toBe(0);
    expect(await prisma.invoice.count({ where: { academyId: fx.academyId } })).toBe(0);
  });

  it("SU-02: the guardian signs up: INCOMPLETE subscription with consent, month-1 invoice PENDING and linked, attempt with the Paymob order, Unified Checkout URL", async () => {
    setFakeKeys();
    as(fx.guardianUserId);
    const before = Date.now();
    const response = await signup({ studentId: fx.studentProfileIds.student1, planId: monthlyPlanId, consent: true });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.checkoutUrl).toMatch(/^https:\/\/paymob\.test\/unifiedcheckout\//);
    const sub = await prisma.billingSubscription.findFirstOrThrow({ where: { academyId: fx.academyId, studentId: fx.studentProfileIds.student1 } });
    expect(sub).toMatchObject({ status: "INCOMPLETE", payerUserId: fx.guardianUserId, lockedPriceMinor: PRICE, providerSubscriptionId: null, autoRenew: true });
    expect(sub.consentTimestamp.getTime()).toBeGreaterThanOrEqual(before - 1000);
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { billingSubscriptionId: sub.id } });
    expect(invoice).toMatchObject({ status: "PENDING", amountMinor: PRICE, packageType: "MONTHLY_PLAN", sessionsPurchased: 8, provider: "PAYMOB" });
    const attempt = await prisma.paymentAttempt.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    expect(attempt.providerOrderId).toBe(orderIds.at(-1));
    const call = (PaymobSubscriptionClient.prototype.createSignupIntention as jest.Mock).mock.calls.at(-1)[0];
    expect(call).toMatchObject({ planProviderId: providerPlanId, amountMinor: PRICE, specialReference: invoice.id, notificationUrl: "https://app.test/api/payments/paymob/webhook" });
    expect(call.redirectionUrl).toMatch(/^https:\/\/app\.test\/ar\/payments\/paymob\/return/);
  });

  it("SU-03: refused: no consent (400), a plan that is not monthly or has no Paymob plan (409), a second live sign-up (409)", async () => {
    setFakeKeys();
    as(fx.guardianUserId);
    expect((await signup({ studentId: fx.studentProfileIds.student2, planId: monthlyPlanId, consent: false })).status).toBe(400);
    expect((await signup({ studentId: fx.studentProfileIds.student2, planId: paygPlanId, consent: true })).status).toBe(409);
    expect((await signup({ studentId: fx.studentProfileIds.student2, planId: unlinkedPlanId, consent: true })).status).toBe(409);
    const again = await signup({ studentId: fx.studentProfileIds.student1, planId: monthlyPlanId, consent: true });
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("ALREADY_SUBSCRIBED");
    expect(await prisma.billingSubscription.count({ where: { academyId: fx.academyId, studentId: fx.studentProfileIds.student2 } })).toBe(0);
  });

  it("SU-04: Admin, Supervisor, Teacher, the child student and a foreign Admin cannot sign up; cross-origin is 403", async () => {
    setFakeKeys();
    for (const userId of [fx.adminUserId, fx.supervisorUserId, fx.teacherUserId, fx.studentUserIds.student3, fx.foreignAdminUserId]) {
      as(userId);
      const response = await signup({ studentId: fx.studentProfileIds.student3, planId: monthlyPlanId, consent: true });
      expect([403, 404]).toContain(response.status);
    }
    as(fx.guardianUserId);
    expect((await signup({ studentId: fx.studentProfileIds.student3, planId: monthlyPlanId, consent: true }, { origin: "https://evil.example", host: "localhost:3000", "content-type": "application/json" })).status).toBe(403);
    expect(await prisma.billingSubscription.count({ where: { academyId: fx.academyId, studentId: fx.studentProfileIds.student3 } })).toBe(0);
  });

  it("SU-05: the month-1 invoice cannot be paid through the ordinary (non-enrolling) checkout", async () => {
    const sub = await prisma.billingSubscription.findFirstOrThrow({ where: { academyId: fx.academyId, studentId: fx.studentProfileIds.student1 } });
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { billingSubscriptionId: sub.id } });
    as(fx.guardianUserId);
    const response = await checkoutRoute(new Request(`http://localhost:3000/api/invoices/${invoice.id}/checkout`, { method: "POST", headers: sameOriginHeaders() }), { params: Promise.resolve({ id: invoice.id }) });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("RENEWAL_SIGNUP_INVOICE");
  });

  it("SU-06: after the signed payment settles, activation links the Paymob subscription, sets the D56 period and next_billing, and sends the terms receipt", async () => {
    const sub = await prisma.billingSubscription.findFirstOrThrow({ where: { academyId: fx.academyId, studentId: fx.studentProfileIds.student1 } });
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { billingSubscriptionId: sub.id } });
    const attempt = await prisma.paymentAttempt.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    const txnId = testPaymobId();
    const settled = await settlePaidInvoice({
      provider: "PAYMOB", providerEventId: txnId, providerReference: txnId, providerOrderId: attempt.providerOrderId!,
      amountMinor: PRICE, currency: "EGP", succeeded: true, outcome: "SUCCESS", eventType: "PAYMENT_SUCCESS",
      rawEventHash: createHash("sha256").update(`signup-${txnId}`).digest("hex"),
    });
    expect(settled.status).toBe("settled");
    const providerSubscriptionId = String(randomInt(1_000_000, 2_000_000_000));
    const client = {
      findByTransaction: jest.fn().mockResolvedValue({ id: Number(providerSubscriptionId), plan_id: Number(providerPlanId), state: "active" }),
      updateNextBilling: jest.fn().mockResolvedValue({}),
    };
    await expect(activateSignup(invoice.id, txnId, { client })).resolves.toEqual({ status: "activated" });
    await expect(activateSignup(invoice.id, txnId, { client })).resolves.toEqual({ status: "already_active" });
    const active = await prisma.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    const paid = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(active).toMatchObject({ status: "ACTIVE", providerSubscriptionId });
    expect(active.billingAnchorDay).toBeGreaterThanOrEqual(1);
    expect(active.currentPeriodStart.getTime()).toBe(paid.paidAt!.getTime());
    const pkg = await prisma.subscription.findUniqueOrThrow({ where: { id: paid.subscriptionId! } });
    expect(pkg.periodEndsAt?.getTime()).toBe(active.currentPeriodEnd.getTime());
    expect(client.updateNextBilling).toHaveBeenCalledTimes(1);
    expect(client.updateNextBilling.mock.calls[0][0]).toBe(providerSubscriptionId);
    const receipts = await prisma.notificationJob.findMany({ where: { academyId: fx.academyId, kind: "RENEWAL_SIGNUP" } });
    expect(receipts.map((job) => job.recipientUserId)).toEqual([fx.guardianUserId]);
  });

  it("SU-07: a paid sign-up whose Paymob subscription is for another plan is not linked (Admin flag); an unpaid sign-up abandoned for 24 h is cancelled", async () => {
    setFakeKeys();
    as(fx.guardianUserId);
    expect((await signup({ studentId: fx.studentProfileIds.student4, planId: monthlyPlanId, consent: true })).status).toBe(201);
    const paidSub = await prisma.billingSubscription.findFirstOrThrow({ where: { academyId: fx.academyId, studentId: fx.studentProfileIds.student4 } });
    const paidInvoice = await prisma.invoice.findFirstOrThrow({ where: { billingSubscriptionId: paidSub.id } });
    const txnId = await settleSignupInvoice(paidInvoice.id);
    const client = { findByTransaction: jest.fn().mockResolvedValue({ id: 5, plan_id: 1 }), updateNextBilling: jest.fn() };
    await expect(activateSignup(paidInvoice.id, txnId, { client })).resolves.toEqual({ status: "not_linked" });
    expect((await prisma.billingSubscription.findUniqueOrThrow({ where: { id: paidSub.id } })).status).toBe("INCOMPLETE");
    const flags = await prisma.notificationJob.findMany({ where: { academyId: fx.academyId, kind: "PAYMENT_ANOMALY", recipientUserId: fx.adminUserId } });
    expect(flags.some((job) => (job.payload as { reason?: string }).reason === "RENEWAL_SIGNUP_NOT_LINKED")).toBe(true);
    expect(client.updateNextBilling).not.toHaveBeenCalled();

    setFakeKeys();
    expect((await signup({ studentId: fx.studentProfileIds.student5, planId: monthlyPlanId, consent: true })).status).toBe(201);
    const sub = await prisma.billingSubscription.findFirstOrThrow({ where: { academyId: fx.academyId, studentId: fx.studentProfileIds.student5 } });
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { billingSubscriptionId: sub.id } });
    await processRenewals(new Date(Date.now() + 25 * 60 * 60 * 1000), { academyId: fx.academyId, client: { listTransactions: jest.fn(), updateNextBilling: jest.fn(), cancel: jest.fn(), findByTransaction: jest.fn().mockResolvedValue(null) } });
    expect((await prisma.billingSubscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe("CANCELED");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("CANCELLED");
    // The paid one is never closed as abandoned.
    expect((await prisma.billingSubscription.findUniqueOrThrow({ where: { id: paidSub.id } })).status).toBe("INCOMPLETE");
  });

  it("SU-08 (static): the transaction webhook activates a sign-up after it settles the month-1 invoice", () => {
    const route = readFileSync(join(process.cwd(), "app/api/payments/paymob/webhook/route.ts"), "utf8");
    expect(route).toMatch(/activateSignup\(result\.invoiceId, event\.providerReference\)/);
  });
});
