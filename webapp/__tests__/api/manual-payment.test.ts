jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { getServerSession } from "next-auth";

import { POST as confirmRoute } from "../../app/api/invoices/[id]/confirm/route";
import { prisma } from "../../lib/prisma";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * Manual payment (Phase 8, backlog PA-03/PA-04): the dormant-but-reachable Admin
 * confirm route `POST /api/invoices/:id/confirm` performs the SAME atomic transition
 * as the signed webhook — invoice PAID + subscription + ONE INITIAL_PURCHASE + one
 * PAID audit row — and is idempotent. Per-run test academy only.
 */
jest.setTimeout(180_000);

const getServerSessionMock = getServerSession as jest.Mock;
let fx: SessionFixtures;

function asActor(userId: string) {
  getServerSessionMock.mockResolvedValue({ user: { id: userId } });
}

async function confirm(actorId: string, invoiceId: string, body: Record<string, unknown> = { reference: "demo_test_bank_transfer" }) {
  asActor(actorId);
  const response = await confirmRoute(
    new Request(`http://localhost:3000/api/invoices/${invoiceId}/confirm`, {
      method: "POST",
      headers: sameOriginHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: invoiceId }) },
  );
  return { status: response.status, body: await response.json() };
}

async function pendingInvoice(options: { packageType?: "MONTHLY_PLAN" | "PAY_PER_SESSION"; status?: "PENDING" | "CANCELLED"; studentKey?: string } = {}) {
  return prisma.invoice.create({
    data: {
      academyId: fx.academyId,
      studentId: fx.studentProfileIds[options.studentKey ?? "student1"],
      amountMinor: BigInt(160000),
      currency: "EGP",
      provider: "PAYMOB",
      packageType: options.packageType ?? "MONTHLY_PLAN",
      sessionsPurchased: 8,
      status: options.status ?? "PENDING",
    },
    select: { id: true },
  });
}

async function proof(invoiceId: string, status: "PENDING" | "REJECTED") {
  return prisma.paymentProof.create({
    data: {
      academyId: fx.academyId,
      invoiceId,
      uploadedById: fx.guardianUserId,
      filePath: `demo_test/${invoiceId}/proof`,
      mimeType: "image/png",
      sizeBytes: BigInt(10),
      originalName: "receipt.png",
      storageProvider: "cloudinary",
      status,
      // payment_proofs_review_check: a reviewed (REJECTED) proof carries its reviewer.
      ...(status === "REJECTED" ? { reviewedById: fx.adminUserId, reviewedAt: new Date() } : {}),
    },
    select: { id: true },
  });
}

const purchases = (invoiceId: string) => prisma.subscriptionLedger.count({ where: { invoiceId, entryType: "INITIAL_PURCHASE" } });
const paidAudits = (invoiceId: string) => prisma.paymentAudit.findMany({ where: { invoiceId, eventType: "PAID" }, select: { actorId: true, actorRole: true } });

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("Manual payment — Admin confirm (same atomic transition as the webhook)", () => {
  it("MP-01: an Admin confirms a PENDING invoice — PAID, one monthly subscription, one INITIAL_PURCHASE of 8, attempt SUCCEEDED, one PAID audit row by that Admin", async () => {
    const invoice = await pendingInvoice();
    const { status, body } = await confirm(fx.adminUserId, invoice.id);
    expect(status).toBe(200);
    expect(body.data.status).toBe("settled");
    const paid = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { status: true, paidAt: true, subscriptionId: true, providerReference: true } });
    expect(paid.status).toBe("PAID");
    expect(paid.paidAt).not.toBeNull();
    expect(paid.providerReference).toBe("demo_test_bank_transfer");
    const subscription = await prisma.subscription.findUniqueOrThrow({ where: { id: paid.subscriptionId! } });
    expect(subscription.status).toBe("ACTIVE");
    expect(subscription.periodStartsAt).not.toBeNull();
    expect(subscription.periodEndsAt).not.toBeNull();
    expect(await purchases(invoice.id)).toBe(1);
    const ledger = await prisma.subscriptionLedger.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    expect(ledger.sessionsDelta).toBe(8);
    const attempt = await prisma.paymentAttempt.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    expect(attempt).toMatchObject({ status: "SUCCEEDED", idempotencyKey: `manual:${invoice.id}` });
    expect(await paidAudits(invoice.id)).toEqual([{ actorId: fx.adminUserId, actorRole: "ADMIN" }]);
  });

  it("MP-02 (PA-03): confirming again answers already_settled — no second subscription, ledger row or audit row", async () => {
    const invoice = await pendingInvoice({ studentKey: "student2" });
    expect((await confirm(fx.adminUserId, invoice.id)).body.data.status).toBe("settled");
    const again = await confirm(fx.adminUserId, invoice.id);
    expect(again.status).toBe(200);
    expect(again.body.data.status).toBe("already_settled");
    expect(await prisma.subscription.count({ where: { invoices: { some: { id: invoice.id } } } })).toBe(1);
    expect(await purchases(invoice.id)).toBe(1);
    expect(await paidAudits(invoice.id)).toHaveLength(1);
  });

  it("MP-03: two concurrent confirms (double click) settle exactly once", async () => {
    const invoice = await pendingInvoice({ studentKey: "student3" });
    const results = await Promise.all([confirm(fx.adminUserId, invoice.id), confirm(fx.adminUserId, invoice.id)]);
    expect(results.map((result) => result.body.data.status).sort()).toEqual(["already_settled", "settled"]);
    expect(await purchases(invoice.id)).toBe(1);
    expect(await paidAudits(invoice.id)).toHaveLength(1);
  });

  it("MP-04: only an ADMIN may confirm — Supervisor, teacher, student and guardian get 403 and nothing moves; a foreign Admin gets 404", async () => {
    const invoice = await pendingInvoice({ studentKey: "student4" });
    for (const actor of [fx.supervisorUserId, fx.teacherUserId, fx.studentUserIds.student4, fx.guardianUserId]) {
      expect((await confirm(actor, invoice.id)).status).toBe(403);
    }
    expect((await confirm(fx.foreignAdminUserId, invoice.id)).status).toBe(404);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("PENDING");
    expect(await purchases(invoice.id)).toBe(0);
    expect(await prisma.paymentAttempt.count({ where: { invoiceId: invoice.id } })).toBe(0);
  });

  it("MP-05: a CANCELLED invoice is not payable — 409, no money", async () => {
    const invoice = await pendingInvoice({ status: "CANCELLED", studentKey: "student5" });
    const { status } = await confirm(fx.adminUserId, invoice.id);
    expect(status).toBe(409);
    expect(await purchases(invoice.id)).toBe(0);
    expect(await paidAudits(invoice.id)).toHaveLength(0);
  });

  it("MP-06 (PA-04): a REJECTED proof cannot confirm (409 PROOF_REJECTED); a PENDING proof is marked CONFIRMED by the confirming Admin with no extra audit row", async () => {
    const rejectedInvoice = await pendingInvoice({ studentKey: "student6" });
    const rejected = await proof(rejectedInvoice.id, "REJECTED");
    const refused = await confirm(fx.adminUserId, rejectedInvoice.id, { paymentProofId: rejected.id });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("PROOF_REJECTED");
    expect(await purchases(rejectedInvoice.id)).toBe(0);

    const invoice = await pendingInvoice({ studentKey: "student7" });
    const pending = await proof(invoice.id, "PENDING");
    expect((await confirm(fx.adminUserId, invoice.id, { paymentProofId: pending.id })).body.data.status).toBe("settled");
    const reviewed = await prisma.paymentProof.findUniqueOrThrow({ where: { id: pending.id }, select: { status: true, reviewedById: true } });
    expect(reviewed).toEqual({ status: "CONFIRMED", reviewedById: fx.adminUserId });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).providerReference).toBe(pending.id);
    expect((await prisma.paymentAudit.findMany({ where: { invoiceId: invoice.id } })).map((row) => row.eventType)).toEqual(["PAID"]);
  });

  it("MP-07: a pay-per-session invoice creates a subscription WITHOUT a period (credits never expire)", async () => {
    const invoice = await pendingInvoice({ packageType: "PAY_PER_SESSION", studentKey: "student8" });
    expect((await confirm(fx.adminUserId, invoice.id)).body.data.status).toBe("settled");
    const paid = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { subscriptionId: true } });
    const subscription = await prisma.subscription.findUniqueOrThrow({ where: { id: paid.subscriptionId! } });
    expect(subscription.periodStartsAt).toBeNull();
    expect(subscription.periodEndsAt).toBeNull();
    expect(await purchases(invoice.id)).toBe(1);
  });
});
