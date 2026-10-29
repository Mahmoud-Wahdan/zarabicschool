jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { randomInt, randomUUID } from "node:crypto";

import { getServerSession } from "next-auth";

import { POST as refundRoute } from "../../app/api/invoices/[id]/refunds/route";
import { PaymobSubscriptionClient } from "../../lib/payments/paymob-subscriptions";
import { PaymentProviderError } from "../../lib/payments/types";
import { prisma } from "../../lib/prisma";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * S-13 (c) Admin partial refund (D19, D42; SQL S-6 approved 2026-10-28). By sessions:
 * amount = floor(sessions × amount ÷ sessions bought); limited by the unreserved
 * remaining credit and by (paid − refunds so far, FAILED not counted). PENDING before
 * the Paymob call, SUCCEEDED/FAILED once after; the REFUND ledger row only on
 * SUCCEEDED; idempotent by key; teacher pay untouched; Admin only. Paymob is a spy
 * on the client (never reached).
 */
jest.setTimeout(240_000);

const getServerSessionMock = getServerSession as jest.Mock;
let fx: SessionFixtures;
let refundSpy: jest.SpyInstance;

const as = (userId: string) => getServerSessionMock.mockResolvedValue({ user: { id: userId } });
async function refund(invoiceId: string, body: unknown, key: string | null = randomUUID(), headers = sameOriginHeaders({ "content-type": "application/json" })) {
  const response = await refundRoute(
    new Request(`http://localhost:3000/api/invoices/${invoiceId}/refunds`, { method: "POST", headers: { ...headers, ...(key ? { "idempotency-key": key } : {}) }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: invoiceId }) },
  );
  return { status: response.status, body: await response.json() };
}

/** A PAID Paymob invoice with its package and INITIAL_PURCHASE, as settlement writes them. */
async function paidPackage(studentKey: string, amountMinor = 80000, sessions = 8) {
  const sub = await prisma.subscription.create({
    data: { academyId: fx.academyId, studentId: fx.studentProfileIds[studentKey], packageType: "MONTHLY_PLAN", sessionsPurchased: sessions, totalAmountMinor: BigInt(amountMinor), currency: "EGP", periodStartsAt: new Date(), periodEndsAt: new Date(Date.now() + 20 * 86_400_000), status: "ACTIVE" },
  });
  const invoice = await prisma.invoice.create({
    data: { academyId: fx.academyId, studentId: fx.studentProfileIds[studentKey], subscriptionId: sub.id, amountMinor: BigInt(amountMinor), currency: "EGP", provider: "PAYMOB", packageType: "MONTHLY_PLAN", sessionsPurchased: sessions, status: "PAID", paidAt: new Date(), providerReference: String(randomInt(100_000_000, 999_999_999)) },
  });
  await prisma.subscriptionLedger.create({ data: { academyId: fx.academyId, subscriptionId: sub.id, invoiceId: invoice.id, entryType: "INITIAL_PURCHASE", sessionsDelta: sessions } });
  return { sub, invoice };
}
const refundLedger = (subscriptionId: string) => prisma.subscriptionLedger.findMany({ where: { subscriptionId, entryType: "REFUND" } });

beforeAll(async () => {
  fx = await createSessionFixtures();
  refundSpy = jest.spyOn(PaymobSubscriptionClient.prototype, "refundTransaction").mockImplementation(async () => ({ providerRefundId: String(randomInt(1_000_000, 9_999_999)), outcome: "SUCCEEDED" }));
});

afterAll(async () => {
  jest.restoreAllMocks();
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("S-13 (c) Admin partial refund", () => {
  it("RF-01: 2 of 8 sessions on 800.00 refunds 200.00 at Paymob, then SUCCEEDED with a REFUND −2 row and audit rows", async () => {
    const { sub, invoice } = await paidPackage("student1");
    as(fx.adminUserId);
    const result = await refund(invoice.id, { sessions: 2, reason: "Family moved abroad" });
    expect(result.status).toBe(201);
    expect(refundSpy).toHaveBeenLastCalledWith(invoice.providerReference, BigInt(20000));
    const row = await prisma.invoiceRefund.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    expect(row).toMatchObject({ status: "SUCCEEDED", sessionsRefunded: 2, amountMinor: BigInt(20000), createdById: fx.adminUserId });
    expect(row.providerRefundId).toMatch(/^\d+$/);
    expect((await refundLedger(sub.id)).map((entry) => entry.sessionsDelta)).toEqual([-2]);
    const audits = (await prisma.paymentAudit.findMany({ where: { invoiceId: invoice.id } })).map((entry) => entry.eventType).sort();
    expect(audits).toEqual(["REFUNDED", "REFUND_REQUESTED"]);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("PAID");
  });

  it("RF-02: the amount is rounded down to the minor unit (1 of 3 sessions on 1000.01 → 333.33)", async () => {
    const { invoice } = await paidPackage("student2", 100001, 3);
    as(fx.adminUserId);
    expect((await refund(invoice.id, { sessions: 1, reason: "Rounding check" })).status).toBe(201);
    expect(refundSpy).toHaveBeenLastCalledWith(invoice.providerReference, BigInt(33333));
  });

  it("RF-03: limited by the unreserved remaining credit (reserved sessions and earlier refunds count)", async () => {
    const { sub, invoice } = await paidPackage("student3", 80000, 4);
    const session = await prisma.session.create({
      data: { academyId: fx.academyId, teacherId: fx.teacherProfileId, subjectId: fx.subjectId, sessionType: "PRIVATE", scheduledStart: new Date(Date.now() + 86_400_000), scheduledEnd: new Date(Date.now() + 86_400_000 + 45 * 60_000), durationMinutes: 45, timezone: "Africa/Cairo", zoomJoinUrl: "https://zoom.us/j/345678901234", createdById: fx.adminUserId, status: "SCHEDULED", students: { create: [{ studentId: fx.studentProfileIds.student3 }] } },
    });
    await prisma.sessionReservation.create({ data: { academyId: fx.academyId, sessionId: session.id, studentId: fx.studentProfileIds.student3, subscriptionId: sub.id, status: "RESERVED" } });
    as(fx.adminUserId);
    const tooMany = await refund(invoice.id, { sessions: 4, reason: "Too many sessions" });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error.code).toBe("NOT_ENOUGH_CREDIT");
    // S-07 (Q3): the refusal names the upcoming reserved sessions, so the Admin removes the student first.
    expect(tooMany.body.error.reservedSessions).toEqual([{ id: session.id, scheduledStart: session.scheduledStart.toISOString() }]);
    expect((await refund(invoice.id, { sessions: 3, reason: "All unreserved" })).status).toBe(201);
    const after = await refund(invoice.id, { sessions: 1, reason: "Nothing left" });
    expect(after.status).toBe(409);
    expect(await prisma.invoiceRefund.count({ where: { invoiceId: invoice.id } })).toBe(1);
  });

  it("RF-04: the same key replays the same refund without a second Paymob call; the same key for a different refund is refused", async () => {
    const { invoice } = await paidPackage("student4");
    as(fx.adminUserId);
    const key = randomUUID();
    const calls = refundSpy.mock.calls.length;
    const first = await refund(invoice.id, { sessions: 1, reason: "Replay check" }, key);
    const second = await refund(invoice.id, { sessions: 1, reason: "Replay check" }, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(refundSpy.mock.calls.length).toBe(calls + 1);
    expect((await refund(invoice.id, { sessions: 2, reason: "Different" }, key)).status).toBe(409);
  });

  it("RF-05: a Paymob refusal ends FAILED with REFUND_FAILED, no ledger row; a failed refund does not count toward the cap", async () => {
    const { sub, invoice } = await paidPackage("student5", 80000, 2);
    refundSpy.mockImplementationOnce(async () => {
      throw new PaymentProviderError("no", "UPSTREAM_ERROR");
    });
    as(fx.adminUserId);
    const failed = await refund(invoice.id, { sessions: 2, reason: "Provider refuses" });
    expect(failed.status).toBe(502);
    expect(await prisma.invoiceRefund.findFirstOrThrow({ where: { invoiceId: invoice.id } })).toMatchObject({ status: "FAILED" });
    expect(await prisma.paymentAudit.count({ where: { invoiceId: invoice.id, eventType: "REFUND_FAILED" } })).toBe(1);
    expect(await refundLedger(sub.id)).toHaveLength(0);
    expect((await refund(invoice.id, { sessions: 2, reason: "Second try works" })).status).toBe(201);
  });

  it("RF-06: a pending refund at Paymob stays PENDING (no ledger row yet) and counts toward the cap", async () => {
    const { sub, invoice } = await paidPackage("student6", 80000, 2);
    refundSpy.mockImplementationOnce(async () => ({ providerRefundId: "4242", outcome: "PENDING" }));
    as(fx.adminUserId);
    expect((await refund(invoice.id, { sessions: 2, reason: "Pending at bank" })).status).toBe(202);
    expect(await prisma.invoiceRefund.findFirstOrThrow({ where: { invoiceId: invoice.id } })).toMatchObject({ status: "PENDING", providerRefundId: "4242" });
    expect(await refundLedger(sub.id)).toHaveLength(0);
    expect((await refund(invoice.id, { sessions: 1, reason: "Over the cap" })).status).toBe(409);
  });

  it("RF-07: teacher pay is untouched", async () => {
    const before = await prisma.payrollLedger.count({ where: { academyId: fx.academyId } });
    const { invoice } = await paidPackage("student7");
    as(fx.adminUserId);
    expect((await refund(invoice.id, { sessions: 1, reason: "Payroll check" })).status).toBe(201);
    expect(await prisma.payrollLedger.count({ where: { academyId: fx.academyId } })).toBe(before);
  });

  it("RF-08: Admin only, a PAID invoice only, a key and a reason are required, same-origin, other academies invisible", async () => {
    const { invoice } = await paidPackage("student8");
    for (const userId of [fx.supervisorUserId, fx.guardianUserId, fx.teacherUserId]) {
      as(userId);
      expect((await refund(invoice.id, { sessions: 1, reason: "Not allowed" })).status).toBe(403);
    }
    as(fx.foreignAdminUserId);
    expect((await refund(invoice.id, { sessions: 1, reason: "Other academy" })).status).toBe(404);
    as(fx.adminUserId);
    expect((await refund(invoice.id, { sessions: 1, reason: "No key" }, null)).status).toBe(400);
    expect((await refund(invoice.id, { sessions: 1, reason: "abc" })).status).toBe(400);
    expect((await refund(invoice.id, { sessions: 0, reason: "Zero sessions" })).status).toBe(400);
    expect((await refund(invoice.id, { sessions: 1, reason: "Cross origin" }, randomUUID(), { origin: "https://evil.example", host: "localhost:3000", "content-type": "application/json" })).status).toBe(403);
    const pending = await prisma.invoice.create({ data: { academyId: fx.academyId, studentId: fx.studentProfileIds.student9, amountMinor: BigInt(1000), currency: "EGP", provider: "PAYMOB", packageType: "MONTHLY_PLAN", sessionsPurchased: 1, status: "PENDING" } });
    expect((await refund(pending.id, { sessions: 1, reason: "Unpaid invoice" })).status).toBe(409);
  });
});
