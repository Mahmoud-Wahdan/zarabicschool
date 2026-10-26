// INT-WH-10 needs the Phase 6b readiness flag mocked; every other test pins it to
// the real (true) state. The settlement and webhook routes receive the same mock.
jest.mock("../../lib/billing/readiness", () => ({
  isPhase6bReady: jest.fn().mockResolvedValue(true),
}));

import { createHash, createHmac } from "node:crypto";

import { isPhase6bReady } from "../../lib/billing/readiness";
import { buildPaymobHmacPayload } from "../../lib/payments";
import { POST as paymobWebhookRoute } from "../../app/api/payments/paymob/webhook/route";
import { prisma } from "../../lib/prisma";
import {
  cleanupSessionFixtures,
  createSessionFixtures,
  closePrisma,
  type SessionFixtures,
} from "../helpers/session-fixtures";
import { cleanupTrackedWebhookEvents, testPaymobId, trackInvalidShapeHash } from "../helpers/webhook-events";

const readinessMock = isPhase6bReady as jest.Mock;

jest.setTimeout(180_000);

let fx: SessionFixtures;
let originalHmacSecret: string | undefined;

/**
 * The HMAC secret is a TEST-ONLY value set in the test process env (never read
 * from .env, never printed). The original value is restored in afterAll.
 */
const TEST_HMAC_SECRET = `demo_test_hmac_${Math.random().toString(36).slice(2)}`;

/**
 * A1 (2026-10-26): a callback is matched ONLY through the Paymob ORDER id that the
 * checkout stored on our payment attempt (HMAC-covered) — never merchant_order_id.
 * So every test invoice gets an attempt carrying a tracked order id.
 */
async function createPendingInvoice(options: { amountMinor?: number; currency?: string } = {}) {
  const invoice = await prisma.invoice.create({
    data: {
      academyId: fx.academyId,
      studentId: fx.studentProfileIds.student1,
      amountMinor: BigInt(options.amountMinor ?? 80000),
      currency: options.currency ?? "EGP",
      provider: "PAYMOB",
      packageType: "MONTHLY_PLAN",
      sessionsPurchased: 8,
      status: "PENDING",
    },
    select: { id: true, amountMinor: true },
  });
  const orderId = testPaymobId();
  await prisma.paymentAttempt.create({
    data: {
      invoiceId: invoice.id,
      provider: "PAYMOB",
      idempotencyKey: `demo_test_${fx.suffix}_${orderId}`,
      providerReference: orderId,
      providerOrderId: orderId,
      status: "REDIRECTED",
    },
  });
  return { ...invoice, orderId };
}

/** A Paymob processed-callback transaction (the fields the HMAC covers). */
function transaction(orderId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: testPaymobId(),
    amount_cents: 80000,
    created_at: new Date().toISOString(),
    currency: "EGP",
    error_occured: false,
    has_parent_transaction: false,
    integration_id: 77,
    is_3d_secure: false,
    is_auth: false,
    is_capture: false,
    is_refunded: false,
    is_standalone_payment: true,
    is_voided: false,
    order: { id: orderId, merchant_order_id: `demo_test_${fx.suffix}` },
    owner: 1,
    pending: false,
    source_data: { pan: "1234", sub_type: "Visa", type: "card" },
    success: true,
    ...overrides,
  };
}

function sign(txn: Record<string, unknown>) {
  return createHmac("sha512", TEST_HMAC_SECRET).update(buildPaymobHmacPayload(txn)).digest("hex");
}

type WebhookResponse = { status: number; body: { status?: string; error?: { code?: string; message?: string } } & Record<string, unknown> };

/** Flat body + `hmac` header (accepted), or the documented envelope + `?hmac=` query. */
async function postWebhook(
  txn: Record<string, unknown>,
  options: { signature?: string | null; envelope?: boolean } = {},
): Promise<WebhookResponse> {
  const signature = options.signature === undefined ? sign(txn) : options.signature;
  const body = options.envelope ? { type: "TRANSACTION", obj: txn } : txn;
  const query = options.envelope && signature ? `?hmac=${signature}` : "";
  const response = await paymobWebhookRoute(
    new Request(`http://localhost:3000/api/payments/paymob/webhook${query}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(!options.envelope && signature ? { hmac: signature } : {}) },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json()) as WebhookResponse["body"] };
}

function eventRow(providerEventId: string) {
  return prisma.webhookEvent.findFirst({ where: { provider: "PAYMOB", providerEventId } });
}

function initialPurchases(invoiceId: string) {
  return prisma.subscriptionLedger.count({ where: { invoiceId, entryType: "INITIAL_PURCHASE" } });
}

function anomalyJobs(invoiceId: string) {
  return prisma.notificationJob.findMany({
    where: { academyId: fx.academyId, kind: "PAYMENT_ANOMALY", payload: { path: ["invoiceId"], equals: invoiceId } },
    select: { recipientUserId: true, payload: true },
  });
}

function auditRows(invoiceId: string) {
  return prisma.paymentAudit.findMany({
    where: { invoiceId },
    orderBy: { createdAt: "asc" },
    select: { eventType: true, actorRole: true, metadata: true },
  });
}

beforeAll(async () => {
  originalHmacSecret = process.env.PAYMOB_HMAC_SECRET;
  process.env.PAYMOB_HMAC_SECRET = TEST_HMAC_SECRET;
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (originalHmacSecret === undefined) delete process.env.PAYMOB_HMAC_SECRET;
  else process.env.PAYMOB_HMAC_SECRET = originalHmacSecret;
  await cleanupTrackedWebhookEvents();
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

beforeEach(() => {
  readinessMock.mockResolvedValue(true);
});

describe("Paymob webhook (A1: signed order.id match, real dev DB)", () => {
  it("INT-WH-01: a signed success for the stored order id settles atomically — event PROCESSED, invoice PAID, one INITIAL_PURCHASE, attempt SUCCEEDED, PAID audit", async () => {
    const invoice = await createPendingInvoice();
    const txn = transaction(invoice.orderId);
    const { status, body } = await postWebhook(txn);
    expect(status).toBe(200);
    expect(body.status).toBe("settled");

    expect((await eventRow(txn.id))?.status).toBe("PROCESSED");
    const paid = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { status: true, subscriptionId: true, paidAt: true, providerReference: true } });
    expect(paid.status).toBe("PAID");
    expect(paid.subscriptionId).not.toBeNull();
    expect(paid.paidAt).not.toBeNull();
    expect(paid.providerReference).toBe(txn.id);
    expect(await initialPurchases(invoice.id)).toBe(1);

    const attempt = await prisma.paymentAttempt.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    expect(attempt.status).toBe("SUCCEEDED");
    expect(attempt.providerOrderId).toBe(invoice.orderId);
    expect(attempt.providerTransactionId).toBe(txn.id);

    const audit = await auditRows(invoice.id);
    expect(audit.map((row) => [row.eventType, row.actorRole])).toEqual([["PAID", "WEBHOOK"]]);
  });

  it("INT-WH-01b: the documented envelope {type, obj} with ?hmac= in the query settles the same way", async () => {
    const invoice = await createPendingInvoice();
    const { status, body } = await postWebhook(transaction(invoice.orderId), { envelope: true });
    expect(status).toBe(200);
    expect(body.status).toBe("settled");
    expect(await initialPurchases(invoice.id)).toBe(1);
  });

  it("INT-WH-02: an exact replay answers already_processed — no second subscription, ledger entry or audit row", async () => {
    const invoice = await createPendingInvoice();
    const txn = transaction(invoice.orderId);
    expect((await postWebhook(txn)).body.status).toBe("settled");
    const replay = await postWebhook(txn);
    expect(replay.status).toBe(200);
    expect(replay.body.status).toBe("already_processed");
    expect(await prisma.subscription.count({ where: { invoices: { some: { id: invoice.id } } } })).toBe(1);
    expect(await initialPurchases(invoice.id)).toBe(1);
    expect((await auditRows(invoice.id)).filter((row) => row.eventType === "PAID")).toHaveLength(1);
  });

  it("INT-WH-03: two concurrent identical events settle exactly once", async () => {
    const invoice = await createPendingInvoice();
    const txn = transaction(invoice.orderId);
    const [first, second] = await Promise.all([postWebhook(txn), postWebhook(txn)]);
    expect([first.body.status, second.body.status].sort()).toEqual(["already_processed", "settled"]);
    expect(await initialPurchases(invoice.id)).toBe(1);
  });

  it("INT-WH-04: an amount mismatch answers 200 mismatch — no money, invoice PENDING, claim MISMATCH, FAILED audit row + Admin PAYMENT_ANOMALY", async () => {
    const invoice = await createPendingInvoice({ amountMinor: 80000 });
    const txn = transaction(invoice.orderId, { amount_cents: 90000 });
    const { status, body } = await postWebhook(txn);
    expect(status).toBe(200);
    expect(body.status).toBe("mismatch");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("PENDING");
    expect((await eventRow(txn.id))?.status).toBe("MISMATCH");
    expect(await initialPurchases(invoice.id)).toBe(0);
    const audit = await auditRows(invoice.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].eventType).toBe("FAILED");
    expect((audit[0].metadata as Record<string, unknown>).reason).toBe("AMOUNT_MISMATCH");
    const jobs = await anomalyJobs(invoice.id);
    expect(jobs.map((job) => job.recipientUserId)).toContain(fx.adminUserId);
    expect((jobs[0].payload as Record<string, unknown>).reason).toBe("AMOUNT_MISMATCH");
  });

  it("INT-WH-04b: a currency mismatch is refused the same way (CURRENCY_MISMATCH, no money)", async () => {
    const invoice = await createPendingInvoice({ currency: "EGP" });
    const txn = transaction(invoice.orderId, { currency: "USD" });
    const { status, body } = await postWebhook(txn);
    expect(status).toBe(200);
    expect(body.status).toBe("mismatch");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("PENDING");
    expect(await initialPurchases(invoice.id)).toBe(0);
    expect(((await auditRows(invoice.id))[0].metadata as Record<string, unknown>).reason).toBe("CURRENCY_MISMATCH");
    expect(((await anomalyJobs(invoice.id))[0].payload as Record<string, unknown>).reason).toBe("CURRENCY_MISMATCH");
  });

  it("INT-WH-05: a signed DECLINED payment is IGNORED — recorded as <txn>:FAILED, no money moves, FAILED audit, no Admin flag", async () => {
    const invoice = await createPendingInvoice();
    const txn = transaction(invoice.orderId, { success: false });
    const { status, body } = await postWebhook(txn);
    expect(status).toBe(200);
    expect(body.status).toBe("ignored");
    expect((await eventRow(`${txn.id}:FAILED`))?.status).toBe("IGNORED");
    expect(await eventRow(txn.id)).toBeNull();
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("PENDING");
    expect(await initialPurchases(invoice.id)).toBe(0);
    expect((await auditRows(invoice.id)).map((row) => row.eventType)).toEqual(["FAILED"]);
    expect(await anomalyJobs(invoice.id)).toHaveLength(0);
  });

  it("INT-WH-06: an unknown order id is UNMATCHED — merchant_order_id naming a real invoice never settles it", async () => {
    const invoice = await createPendingInvoice();
    const subscriptionsBefore = await prisma.subscription.count({ where: { academyId: fx.academyId } });
    // P1: merchant_order_id is not covered by the HMAC — pointing it at a real
    // invoice must change nothing; only the stored order id links an invoice.
    const txn = transaction(testPaymobId(), { order: { id: testPaymobId(), merchant_order_id: invoice.id } });
    const { status, body } = await postWebhook(txn);
    expect(status).toBe(200);
    expect(body.status).toBe("unmatched");
    expect((await eventRow(`${txn.id}:UNMATCHED`))?.status).toBe("UNMATCHED");
    expect(await eventRow(txn.id)).toBeNull();
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("PENDING");
    expect(await prisma.subscription.count({ where: { academyId: fx.academyId } })).toBe(subscriptionsBefore);
  });

  it("INT-WH-07: a bad or missing HMAC is refused with 401 — nothing recorded, nothing settled", async () => {
    const invoice = await createPendingInvoice();
    const txn = transaction(invoice.orderId);
    const bad = await postWebhook(txn, { signature: "not-a-valid-signature" });
    expect(bad.status).toBe(401);
    expect(bad.body.error?.code).toBe("INVALID_WEBHOOK");
    const missing = await postWebhook(txn, { signature: null });
    expect(missing.status).toBe(401);
    expect(await eventRow(txn.id)).toBeNull();
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("PENDING");
  });

  it("INT-WH-08: when the INITIAL_PURCHASE insert fails inside settlement, everything rolls back — no claim, invoice PENDING, no subscription, no PAID audit", async () => {
    const invoice = await createPendingInvoice();
    // Fault injection through a REAL constraint (no code seam): H5 allows ONE
    // INITIAL_PURCHASE per invoice, so a pre-existing row makes the settlement's
    // ledger insert fail after the claim, the subscription and the lock.
    const blocker = await prisma.subscription.create({
      data: { academyId: fx.academyId, studentId: fx.studentProfileIds.student1, packageType: "PAY_PER_SESSION", sessionsPurchased: 1, totalAmountMinor: BigInt(1), currency: "EGP", status: "ACTIVE" },
      select: { id: true },
    });
    await prisma.subscriptionLedger.create({
      data: { academyId: fx.academyId, subscriptionId: blocker.id, invoiceId: invoice.id, entryType: "INITIAL_PURCHASE", sessionsDelta: 1 },
    });
    const subscriptionsBefore = await prisma.subscription.count({ where: { studentId: fx.studentProfileIds.student1 } });
    const txn = transaction(invoice.orderId);
    await expect(postWebhook(txn)).rejects.toThrow();
    expect(await eventRow(txn.id)).toBeNull();
    const fresh = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { status: true, subscriptionId: true, paidAt: true } });
    expect(fresh).toEqual({ status: "PENDING", subscriptionId: null, paidAt: null });
    expect(await prisma.subscription.count({ where: { studentId: fx.studentProfileIds.student1 } })).toBe(subscriptionsBefore);
    expect(await initialPurchases(invoice.id)).toBe(1);
    expect((await auditRows(invoice.id)).filter((row) => row.eventType === "PAID")).toHaveLength(0);
    expect((await prisma.paymentAttempt.findFirstOrThrow({ where: { invoiceId: invoice.id } })).status).toBe("REDIRECTED");
  });

  it("INT-WH-09: the stored payload is allowlist-redacted — source_data, owner and pan are absent", async () => {
    const invoice = await createPendingInvoice();
    const txn = transaction(invoice.orderId);
    await postWebhook(txn);
    const payload = (await eventRow(txn.id))?.payload as Record<string, unknown>;
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("source_data");
    expect(serialized).not.toContain("pan");
    expect(serialized).not.toContain('"owner"');
    expect(serialized).not.toContain("Visa");
    expect(payload.redacted).toBe(true);
    expect(payload.id).toBe(txn.id);
    expect(payload.amount_cents).toBe(80000);
    expect((payload.order as Record<string, unknown>).id).toBe(invoice.orderId);
  });

  it("INT-WH-10: with the Phase 6b readiness flag off, settlement still works via the row lock and PAID guard — a different success answers already_settled", async () => {
    readinessMock.mockResolvedValue(false);
    const invoice = await createPendingInvoice();
    const txn = transaction(invoice.orderId);
    const first = await postWebhook(txn);
    expect(first.body.status).toBe("settled");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("PAID");
    // No webhook_events claim exists before the migration: the PAID guard answers.
    const replay = await postWebhook(txn);
    expect(replay.status).toBe(200);
    expect(replay.body.status).toBe("already_settled");
    expect(await eventRow(txn.id)).toBeNull();
    expect(await initialPurchases(invoice.id)).toBe(1);
  });

  it("INT-WH-11: every SIGNED callback gets 200 with a status — pending (3-DS), voided, refunded and an unexpected shape never move money", async () => {
    const invoice = await createPendingInvoice();
    for (const [overrides, expected, suffix] of [
      [{ pending: true, success: false }, "ignored", "PENDING"],
      [{ is_voided: true }, "ignored", "VOIDED"],
      [{ is_refunded: true }, "ignored", "REFUNDED"],
    ] as const) {
      const txn = transaction(invoice.orderId, overrides);
      const { status, body } = await postWebhook(txn);
      expect(status).toBe(200);
      expect(body.status).toBe(expected);
      expect((await eventRow(`${txn.id}:${suffix}`))?.status).toBe("IGNORED");
    }
    // A validly signed body whose transaction id is not numeric: recorded once as
    // INVALID_SHAPE (field names only), answered 200 so Paymob stops retrying.
    const odd = transaction(invoice.orderId, { id: "not-a-number" });
    const rawBody = JSON.stringify(odd);
    trackInvalidShapeHash(createHash("sha256").update(rawBody).digest("hex"));
    const { status, body } = await postWebhook(odd);
    expect(status).toBe(200);
    expect(body.status).toBe("invalid_shape");
    const invalid = await eventRow(`invalid:${createHash("sha256").update(rawBody).digest("hex")}`);
    expect(invalid?.status).toBe("INVALID_SHAPE");
    expect(JSON.stringify(invalid?.payload)).not.toContain("not-a-number");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("PENDING");
    expect(await initialPurchases(invoice.id)).toBe(0);
  });

  it("INT-WH-12: a second, different successful payment for a PAID invoice is a double payment — already_settled, DUPLICATE_PAYMENT, audit row + Admin flag, no second purchase", async () => {
    const invoice = await createPendingInvoice();
    expect((await postWebhook(transaction(invoice.orderId))).body.status).toBe("settled");
    const second = transaction(invoice.orderId);
    const { status, body } = await postWebhook(second);
    expect(status).toBe(200);
    expect(body.status).toBe("already_settled");
    expect((await eventRow(second.id))?.status).toBe("DUPLICATE_PAYMENT");
    expect(await initialPurchases(invoice.id)).toBe(1);
    const failed = (await auditRows(invoice.id)).filter((row) => row.eventType === "FAILED");
    expect((failed[0].metadata as Record<string, unknown>).reason).toBe("SUCCESS_ON_PAID_INVOICE");
    expect(((await anomalyJobs(invoice.id))[0].payload as Record<string, unknown>).reason).toBe("SUCCESS_ON_PAID_INVOICE");
  });
});
