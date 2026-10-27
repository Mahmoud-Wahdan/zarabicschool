import { writePaymentAudit } from "../../lib/payments/audit";
import { getPaymentReturnView } from "../../lib/payments/return-status";
import { prisma } from "../../lib/prisma";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * Paymob return page (D19a, owner 2026-10-27): display-only. The browser return
 * NEVER settles; the page shows only what the database says, looked up by the
 * Paymob ORDER id, for the payer (checkout authorization) — everyone else, and
 * every unknown/missing/garbled order, gets the same generic answer.
 * Per-run test academy only.
 */
jest.setTimeout(120_000);

let fx: SessionFixtures;
let orderSeq = 0;

function nextOrderId() {
  orderSeq += 1;
  return `9${Date.now().toString().slice(-8)}${orderSeq}`;
}

type Actor = { id: string; role: "ADMIN" | "SUPERVISOR" | "TEACHER" | "STUDENT" | "GUARDIAN"; academyId: string };

function actor(id: string, role: Actor["role"], academyId = fx.academyId): Actor {
  return { id, role, academyId };
}

async function invoiceWithAttempt(status: "PENDING" | "PAID" | "FAILED" | "CANCELLED" = "PENDING") {
  const invoice = await prisma.invoice.create({
    data: {
      academyId: fx.academyId,
      studentId: fx.studentProfileIds.student1,
      amountMinor: BigInt(80000),
      currency: "EGP",
      provider: "PAYMOB",
      packageType: "MONTHLY_PLAN",
      sessionsPurchased: 8,
      status,
      paidAt: status === "PAID" ? new Date() : null,
    },
    select: { id: true },
  });
  const orderId = nextOrderId();
  await prisma.paymentAttempt.create({
    data: {
      invoiceId: invoice.id,
      provider: "PAYMOB",
      idempotencyKey: `invoice:${invoice.id}:v1`,
      status: status === "PAID" ? "SUCCEEDED" : "REDIRECTED",
      providerOrderId: orderId,
      providerReference: orderId,
    },
  });
  return { invoiceId: invoice.id, orderId };
}

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("Paymob return page status (D19a)", () => {
  it("RET-01: the payer sees the DATABASE status — PENDING shows as processing, PAID as paid", async () => {
    const pending = await invoiceWithAttempt("PENDING");
    const guardian = actor(fx.guardianUserId, "GUARDIAN");
    const view = await getPaymentReturnView(guardian, { order: pending.orderId });
    expect(view).toMatchObject({ kind: "invoice", invoiceId: pending.invoiceId, state: "PROCESSING" });

    const paid = await invoiceWithAttempt("PAID");
    expect(await getPaymentReturnView(guardian, { order: paid.orderId })).toMatchObject({ kind: "invoice", state: "PAID" });

    const cancelled = await invoiceWithAttempt("CANCELLED");
    expect(await getPaymentReturnView(guardian, { order: cancelled.orderId })).toMatchObject({ kind: "invoice", state: "CANCELLED" });
  });

  it("RET-02: tampered query params (success=true, amount, merchant order) change nothing — only the DB decides", async () => {
    const pending = await invoiceWithAttempt("PENDING");
    const view = await getPaymentReturnView(actor(fx.guardianUserId, "GUARDIAN"), {
      order: pending.orderId,
      success: "true",
      pending: "false",
      amount_cents: "1",
      merchant_order_id: `${pending.invoiceId}:v9`,
      hmac: "forged",
    });
    expect(view).toMatchObject({ kind: "invoice", state: "PROCESSING" });
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: pending.invoiceId }, select: { status: true } });
    expect(invoice.status).toBe("PENDING");
    expect(await prisma.subscriptionLedger.count({ where: { invoiceId: pending.invoiceId } })).toBe(0);
  });

  it("RET-03: a signed decline recorded by the webhook shows as DECLINED (invoice stays PENDING)", async () => {
    const pending = await invoiceWithAttempt("PENDING");
    await writePaymentAudit({
      academyId: fx.academyId,
      invoiceId: pending.invoiceId,
      eventType: "FAILED",
      actorId: null,
      actorRole: "WEBHOOK",
      metadata: { provider: "PAYMOB", webhookStatus: "IGNORED", reason: "DECLINED" },
    });
    expect(await getPaymentReturnView(actor(fx.guardianUserId, "GUARDIAN"), { order: pending.orderId })).toMatchObject({
      kind: "invoice",
      state: "DECLINED",
    });
  });

  it("RET-04: missing, garbled or unknown order → generic", async () => {
    const guardian = actor(fx.guardianUserId, "GUARDIAN");
    expect(await getPaymentReturnView(guardian, {})).toEqual({ kind: "generic" });
    expect(await getPaymentReturnView(guardian, { order: "abc' OR 1=1" })).toEqual({ kind: "generic" });
    expect(await getPaymentReturnView(guardian, { order: ["1", "2"] })).toEqual({ kind: "generic" });
    expect(await getPaymentReturnView(guardian, { order: "1".repeat(40) })).toEqual({ kind: "generic" });
    expect(await getPaymentReturnView(guardian, { order: "123456789012" })).toEqual({ kind: "generic" });
  });

  it("RET-05: anyone but the payer (student with a guardian, teacher, supervisor, other academy, signed out) → generic; the Admin may look", async () => {
    const pending = await invoiceWithAttempt("PENDING");
    const params = { order: pending.orderId };
    expect(await getPaymentReturnView(null, params)).toEqual({ kind: "generic" });
    expect(await getPaymentReturnView(actor(fx.studentUserIds.student1, "STUDENT"), params)).toEqual({ kind: "generic" });
    expect(await getPaymentReturnView(actor(fx.teacherUserId, "TEACHER"), params)).toEqual({ kind: "generic" });
    expect(await getPaymentReturnView(actor(fx.supervisorUserId, "SUPERVISOR"), params)).toEqual({ kind: "generic" });
    expect(await getPaymentReturnView(actor(fx.foreignAdminUserId, "ADMIN", fx.foreignAcademyId), params)).toEqual({ kind: "generic" });
    expect(await getPaymentReturnView(actor(fx.adminUserId, "ADMIN"), params)).toMatchObject({ kind: "invoice", state: "PROCESSING" });
  });
});
