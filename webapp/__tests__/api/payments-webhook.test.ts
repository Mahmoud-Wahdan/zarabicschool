// INT-WH-10 needs the Phase 6b readiness flag mocked; every other test pins it to
// the real (true) state. The settlement and webhook routes receive the same mock.
jest.mock("../../lib/billing/readiness", () => ({
  isPhase6bReady: jest.fn().mockResolvedValue(true),
}));

import { createHmac } from "node:crypto";

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

const readinessMock = isPhase6bReady as jest.Mock;

jest.setTimeout(180_000);

let fx: SessionFixtures;
let originalHmacSecret: string | undefined;
let eventCounter = 0;

/**
 * The HMAC secret is a TEST-ONLY value set in the test process env (never read
 * from .env, never printed). The original value is restored in afterAll.
 */
const TEST_HMAC_SECRET = `demo_test_hmac_${Math.random().toString(36).slice(2)}`;

async function createPendingInvoice(amountMinor = 80000) {
  return prisma.invoice.create({
    data: {
      academyId: fx.academyId,
      studentId: fx.studentProfileIds.student1,
      amountMinor: BigInt(amountMinor),
      currency: "EGP",
      provider: "PAYMOB",
      packageType: "MONTHLY_PLAN",
      sessionsPurchased: 8,
      status: "PENDING",
    },
    select: { id: true, amountMinor: true },
  });
}

function signedEventBody(invoiceId: string, overrides: Record<string, unknown> = {}) {
  eventCounter += 1;
  return {
    id: `demo_test_${fx.suffix}_${eventCounter}`,
    amount_cents: 80000,
    created_at: new Date().toISOString(),
    currency: "EGP",
    error_occured: false,
    has_parent_transaction: false,
    integration_id: 77,
    is_3d_secure: false,
    is_auth: true,
    is_capture: true,
    is_refunded: false,
    is_standalone_payment: true,
    is_voided: false,
    order: { id: 900 + eventCounter, merchant_order_id: invoiceId },
    owner: 1,
    pending: false,
    source_data: { pan: "1234", sub_type: "Visa", type: "call" },
    success: true,
    ...overrides,
  };
}

function sign(body: Record<string, unknown>) {
  return createHmac("sha512", TEST_HMAC_SECRET).update(buildPaymobHmacPayload(body)).digest("hex");
}

type WebhookResponse = { status: number; body: { error?: { code?: string; message?: string } } & Record<string, unknown> };

async function postWebhook(body: Record<string, unknown>, signature: string | null = sign(body)): Promise<WebhookResponse> {
  const response = await paymobWebhookRoute(
    new Request("http://localhost:3000/api/payments/paymob/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", ...(signature ? { hmac: signature } : {}) },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json()) as WebhookResponse["body"] };
}

function eventRow(providerEventId: string) {
  return prisma.webhookEvent.findFirst({ where: { providerEventId } });
}

beforeAll(async () => {
  originalHmacSecret = process.env.PAYMOB_HMAC_SECRET;
  process.env.PAYMOB_HMAC_SECRET = TEST_HMAC_SECRET;
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (originalHmacSecret === undefined) delete process.env.PAYMOB_HMAC_SECRET;
  else process.env.PAYMOB_HMAC_SECRET = originalHmacSecret;
  if (fx) {
    // webhook_events has no academy_id â€” tests prefix provider_event_id with
    // demo_test_ so cleanup stays scoped to test data.
    await prisma.webhookEvent.deleteMany({ where: { providerEventId: { startsWith: "demo_test_" } } });
    await cleanupSessionFixtures(fx);
  }
  await closePrisma();
});

beforeEach(() => {
  readinessMock.mockResolvedValue(true);
});

describe("Session 2 â€” webhook settlement and event table (real dev DB)", () => {
  it("INT-WH-01: a valid signed success event settles atomically â€” one PROCESSED event, invoice PAID, subscription, exactly one INITIAL_PURCHASE, attempt SUCCEEDED", async () => {
    const invoice = await createPendingInvoice();
    const body = signedEventBody(invoice.id);
    const { status, body: responseBody } = await postWebhook(body);
    expect(status).toBe(200);
    expect(responseBody.status).toBe("settled");

    const row = await eventRow(String(body.id));
    expect(row?.status).toBe("PROCESSED");

    const paid = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { status: true, subscriptionId: true, paidAt: true } });
    expect(paid.status).toBe("PAID");
    expect(paid.subscriptionId).not.toBeNull();
    expect(paid.paidAt).not.toBeNull();

    const subscription = await prisma.subscription.findFirstOrThrow({ where: { invoices: { some: { id: invoice.id } } } });
    expect(subscription.academyId).toBe(fx.academyId);
    expect(subscription.status).toBe("ACTIVE");
    const purchases = await prisma.subscriptionLedger.findMany({ where: { invoiceId: invoice.id, entryType: "INITIAL_PURCHASE" } });
    expect(purchases).toHaveLength(1);
    expect(purchases[0].sessionsDelta).toBe(8);

    const attempt = await prisma.paymentAttempt.findFirstOrThrow({ where: { invoiceId: invoice.id, status: "SUCCEEDED" } });
    expect(attempt.providerReference).toBe(String(body.id));
  });

  it("INT-WH-02: an exact replay answers already_processed â€” no second subscription, ledger entry, or attempt", async () => {
    const invoice = await createPendingInvoice();
    const body = signedEventBody(invoice.id);
    const first = await postWebhook(body);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("settled");

    const replay = await postWebhook(body);
    expect(replay.status).toBe(200);
    expect(replay.body.status).toBe("already_processed");

    expect(await prisma.subscription.count({ where: { invoices: { some: { id: invoice.id } } } })).toBe(1);
    expect(await prisma.subscriptionLedger.count({ where: { invoiceId: invoice.id, entryType: "INITIAL_PURCHASE" } })).toBe(1);
    expect(await prisma.paymentAttempt.count({ where: { invoiceId: invoice.id } })).toBe(1);
  });

  it("INT-WH-03: two concurrent identical events settle exactly once", async () => {
    const invoice = await createPendingInvoice();
    const body = signedEventBody(invoice.id);
    const [first, second] = await Promise.all([postWebhook(body), postWebhook(body)]);
    const statuses = [first.body.status, second.body.status].sort();
    expect(statuses).toEqual(["already_processed", "settled"]);
    expect(await prisma.subscriptionLedger.count({ where: { invoiceId: invoice.id, entryType: "INITIAL_PURCHASE" } })).toBe(1);
  });

  it("INT-WH-04: an amount mismatch rejects with INVALID_WEBHOOK, leaves the invoice PENDING, and persists no event row", async () => {
    const invoice = await createPendingInvoice(80000);
    const body = signedEventBody(invoice.id, { amount_cents: 90000 });
    const { status, body: responseBody } = await postWebhook(body);
    expect(status).toBe(400);
    expect(responseBody.error?.code).toBe("INVALID_WEBHOOK");
    expect(responseBody.error?.message).toBe("Payment does not match the invoice.");
    const fresh = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { status: true } });
    expect(fresh.status).toBe("PENDING");
    expect(await eventRow(String(body.id))).toBeNull();
    expect(await prisma.subscriptionLedger.count({ where: { invoiceId: invoice.id, entryType: "INITIAL_PURCHASE" } })).toBe(0);
  });

  it("INT-WH-05: a signed non-success event is IGNORED â€” recorded, but the invoice stays PENDING", async () => {
    const invoice = await createPendingInvoice();
    const body = signedEventBody(invoice.id, { success: false });
    const { status, body: responseBody } = await postWebhook(body);
    expect(status).toBe(200);
    expect(responseBody.status).toBe("ignored");
    const row = await eventRow(String(body.id));
    expect(row?.status).toBe("IGNORED");
    const fresh = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { status: true } });
    expect(fresh.status).toBe("PENDING");
    expect(await prisma.subscriptionLedger.count({ where: { invoiceId: invoice.id, entryType: "INITIAL_PURCHASE" } })).toBe(0);
  });

  it("INT-WH-06: a signed success event without merchant_order_id is UNMATCHED â€” recorded, nothing settles", async () => {
    await createPendingInvoice();
    const subscriptionsBefore = await prisma.subscription.count({ where: { academyId: fx.academyId } });
    const body = signedEventBody("no-invoice-linked", { order: { id: 424242 } });
    const { status } = await postWebhook(body);
    expect(status).toBe(400);
    const row = await eventRow(String(body.id));
    expect(row?.status).toBe("UNMATCHED");
    // Nothing settled by THIS event: no new subscription appeared for the academy.
    const subscriptions = await prisma.subscription.count({ where: { academyId: fx.academyId } });
    expect(subscriptions).toBe(subscriptionsBefore);
  });

  it("INT-WH-07: a bad HMAC signature rejects 401 â€” nothing recorded, nothing settled", async () => {
    const invoice = await createPendingInvoice();
    const body = signedEventBody(invoice.id);
    const { status, body: responseBody } = await postWebhook(body, "not-a-valid-signature");
    expect(status).toBe(401);
    expect(responseBody.error?.code).toBe("INVALID_WEBHOOK");
    expect(await eventRow(String(body.id))).toBeNull();
    const fresh = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { status: true } });
    expect(fresh.status).toBe("PENDING");
  });

  it("INT-WH-09: the stored payload is allowlist-redacted â€” source_data, owner and pan are absent", async () => {
    const invoice = await createPendingInvoice();
    const body = signedEventBody(invoice.id);
    await postWebhook(body);
    const row = await eventRow(String(body.id));
    expect(row).not.toBeNull();
    const payload = row?.payload as Record<string, unknown>;
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("source_data");
    expect(serialized).not.toContain("pan");
    expect(serialized).not.toContain('"owner"');
    expect(serialized).not.toContain("Visa");
    expect(payload.redacted).toBe(true);
    expect(payload.id).toBe(body.id);
    expect(payload.amount_cents).toBe(80000);
    expect((payload.order as Record<string, unknown>).merchant_order_id).toBe(invoice.id);
  });

  it("INT-WH-10: with the Phase 6b readiness flag off, settlement still works via the row lock and PAID guard â€” replay answers already_settled", async () => {
    readinessMock.mockResolvedValue(false);
    const invoice = await createPendingInvoice();
    const body = signedEventBody(invoice.id);
    const first = await postWebhook(body);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("settled");
    const paid = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { status: true } });
    expect(paid.status).toBe("PAID");
    expect(await prisma.subscriptionLedger.count({ where: { invoiceId: invoice.id, entryType: "INITIAL_PURCHASE" } })).toBe(1);
    // Pre-migration duplicate protection: no webhook_events claim exists, so the
    // PAID-state guard answers already_settled and no event row is ever written.
    const replay = await postWebhook(body);
    expect(replay.status).toBe(200);
    expect(replay.body.status).toBe("already_settled");
    expect(await eventRow(String(body.id))).toBeNull();
    expect(await prisma.subscriptionLedger.count({ where: { invoiceId: invoice.id, entryType: "INITIAL_PURCHASE" } })).toBe(1);
  });
});
