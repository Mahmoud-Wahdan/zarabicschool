jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

// Paymob is mocked ONLY at the provider boundary (plan rule: the provider is
// mocked, the database is real). No network call is ever made; the fake records
// its inputs and can simulate a webhook settling the invoice mid-flight.
jest.mock("../../lib/payments", () => {
  const actual = jest.requireActual<typeof import("../../lib/payments")>("../../lib/payments");
  const state = {
    calls: [] as { invoiceId: string; idempotencyKey: string; firstName: string; lastName: string; phone: string }[],
    settleDuringCheckoutInvoiceId: null as string | null,
    settleEvent: null as import("../../lib/payments/types").VerifiedPaymentEvent | null,
  };
  class FakePaymobProvider {
    async createCheckout(input: import("../../lib/payments/types").PaymentCheckoutInput, idempotencyKey: string) {
      state.calls.push({
        invoiceId: input.invoiceId,
        idempotencyKey,
        firstName: input.customer.firstName,
        lastName: input.customer.lastName,
        phone: input.customer.phone,
      });
      if (state.settleDuringCheckoutInvoiceId === input.invoiceId && state.settleEvent) {
        await actual.settlePaidInvoice(state.settleEvent);
      }
      return {
        providerReference: `fake-ref-${idempotencyKey}`,
        checkoutUrl: `https://paymob.test/checkout/${encodeURIComponent(idempotencyKey)}`,
        idempotencyKey,
      };
    }
  }
  return { ...actual, PaymobProvider: FakePaymobProvider, __checkoutTestState: state };
});

import * as paymentsModule from "../../lib/payments";
import { getServerSession } from "next-auth";

import { prisma } from "../../lib/prisma";
import { settlePaidInvoice } from "../../lib/payments/settlement";
import { __setStorageProviderForTests } from "../../lib/storage";
import { FakeStorageProvider } from "../../lib/storage/fake-storage";
import {
  cleanupSessionFixtures,
  createSessionFixtures,
  closePrisma,
  type SessionFixtures,
} from "../helpers/session-fixtures";

const getServerSessionMock = getServerSession as jest.Mock;
const checkoutState = (paymentsModule as unknown as {
  __checkoutTestState: {
    calls: { invoiceId: string; idempotencyKey: string; firstName: string; lastName: string; phone: string }[];
    settleDuringCheckoutInvoiceId: string | null;
    settleEvent: import("../../lib/payments/types").VerifiedPaymentEvent | null;
  };
}).__checkoutTestState;

jest.setTimeout(180_000);

let fx: SessionFixtures;
let adultUser: { id: string };
let adultStudent: { id: string };
const storage = new FakeStorageProvider();

function asActor(userId: string) {
  getServerSessionMock.mockResolvedValue({ user: { id: userId } });
}

/** Checkout is a same-origin-guarded state-changing route: origin + host must match. */
function postRequest(path: string, body?: FormData | unknown) {
  const isForm = body instanceof FormData;
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      host: "localhost:3000",
      ...(isForm ? undefined : body === undefined ? undefined : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : (isForm ? (body as FormData) : JSON.stringify(body)),
  });
}

async function createInvoice(options: { studentProfileId: string; provider?: "PAYMOB" | "USD_GATEWAY"; currency?: "EGP" | "USD" }) {
  return prisma.invoice.create({
    data: {
      academyId: fx.academyId,
      studentId: options.studentProfileId,
      amountMinor: BigInt(80000),
      currency: options.currency ?? "EGP",
      provider: options.provider ?? "PAYMOB",
      packageType: "MONTHLY_PLAN",
      sessionsPurchased: 8,
      status: "PENDING",
    },
    select: { id: true, amountMinor: true, provider: true },
  });
}

type ApiErrorShape = { error?: { code?: string; message?: string } };
type RouteResponse = { status: number; body: ApiErrorShape & Record<string, unknown> };

async function postCheckout(actorId: string, invoiceId: string): Promise<RouteResponse> {
  asActor(actorId);
  const { POST: checkoutRoute } = await import("../../app/api/invoices/[id]/checkout/route");
  const response = await checkoutRoute(postRequest(`/api/invoices/${invoiceId}/checkout`), {
    params: Promise.resolve({ id: invoiceId }),
  });
  return { status: response.status, body: (await response.json()) as RouteResponse["body"] };
}

async function postProof(actorId: string, invoiceId: string): Promise<RouteResponse> {
  asActor(actorId);
  const { POST: proofsRoute } = await import("../../app/api/invoices/[id]/proofs/route");
  const form = new FormData();
  form.append("reference", "TRX-TEST-1");
  form.append("file", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])], "proof.png", { type: "image/png" }));
  const response = await proofsRoute(postRequest(`/api/invoices/${invoiceId}/proofs`, form), {
    params: Promise.resolve({ id: invoiceId }),
  });
  return { status: response.status, body: (await response.json()) as RouteResponse["body"] };
}

function activeAttemptCount(invoiceId: string) {
  return prisma.paymentAttempt.count({ where: { invoiceId, status: { in: ["CREATED", "REDIRECTED"] } } });
}

beforeAll(async () => {
  fx = await createSessionFixtures();
  __setStorageProviderForTests(storage);
  adultUser = await prisma.user.create({
    data: {
      academyId: fx.academyId,
      username: `demo_test_adult_${fx.suffix}`,
      displayName: "Demo Test Checkout Adult",
      passwordHash: "x".repeat(60),
      role: "STUDENT",
      phone: "+201000000044",
      timezone: "Africa/Cairo",
      isActive: true,
      mustChangePassword: false,
    },
    select: { id: true },
  });
  adultStudent = await prisma.student.create({
    data: { userId: adultUser.id, academyId: fx.academyId, guardianId: null, isAdult: true, enrollmentDate: new Date() },
    select: { id: true },
  });
});

afterEach(() => {
  checkoutState.calls.length = 0;
  checkoutState.settleDuringCheckoutInvoiceId = null;
  checkoutState.settleEvent = null;
});

afterAll(async () => {
  __setStorageProviderForTests(null);
  if (fx) {
    // PaymentProof rows (RESTRICT FK to invoices) are not covered by the shared
    // fixture cleanup â€” remove them first.
    await prisma.paymentProof.deleteMany({ where: { academyId: { in: [fx.academyId, fx.foreignAcademyId] } } });
    await cleanupSessionFixtures(fx);
  }
  await closePrisma();
});

describe("Session 1 â€” finance wall on checkout and proofs (INT-FIN)", () => {
  it("INT-FIN-01 / INT-CO-06: a student WITH a guardian gets 403 on checkout before any attempt is created", async () => {
    const invoice = await createInvoice({ studentProfileId: fx.studentProfileIds.student1 });
    const { status, body } = await postCheckout(fx.studentUserIds.student1, invoice.id);
    expect(status).toBe(403);
    expect(body.error?.code).toBe("FORBIDDEN");
    // Regression assertion kept per plan INT-CO-06: no attempt of any state exists.
    expect(await prisma.paymentAttempt.count({ where: { invoiceId: invoice.id } })).toBe(0);
  });

  it("INT-FIN-02: an adult student without a guardian may check out â€” attempt created with a checkout URL", async () => {
    const invoice = await createInvoice({ studentProfileId: adultStudent.id });
    const { status, body } = await postCheckout(adultUser.id, invoice.id);
    expect(status).toBe(200);
    expect(typeof body.checkoutUrl).toBe("string");
    const attempt = await prisma.paymentAttempt.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    expect(attempt.status).toBe("REDIRECTED");
    expect(attempt.checkoutUrl).toBe(body.checkoutUrl);
  });

  it("INT-FIN-03: a student WITH a guardian gets 403 on proof upload â€” nothing stored", async () => {
    const invoice = await createInvoice({ studentProfileId: fx.studentProfileIds.student1 });
    const { status, body } = await postProof(fx.studentUserIds.student1, invoice.id);
    expect(status).toBe(403);
    expect(body.error?.code).toBe("FORBIDDEN");
    expect(await prisma.paymentProof.count({ where: { invoiceId: invoice.id } })).toBe(0);
  });

  it("INT-FIN-04: an adult student without a guardian may upload a proof â€” 201 with a PENDING PaymentProof", async () => {
    const invoice = await createInvoice({ studentProfileId: adultStudent.id });
    const { status, body } = await postProof(adultUser.id, invoice.id);
    expect(status).toBe(201);
    const proof = await prisma.paymentProof.findUniqueOrThrow({ where: { id: (body.data as { id: string }).id } });
    expect(proof.status).toBe("PENDING");
    expect(proof.mimeType).toBe("image/png");
    expect(proof.invoiceId).toBe(invoice.id);
    expect(proof.reference).toBe("TRX-TEST-1");
  });
});

describe("Session 2 â€” checkout concurrency (INT-CO, Paymob mocked at the boundary)", () => {
  it("INT-CO-01: a single checkout on a PENDING EGP invoice creates a REDIRECTED attempt with the deterministic v1 key", async () => {
    const invoice = await createInvoice({ studentProfileId: adultStudent.id });
    const { status, body } = await postCheckout(adultUser.id, invoice.id);
    expect(status).toBe(200);
    expect(body.checkoutUrl).toContain("paymob.test");
    const attempt = await prisma.paymentAttempt.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    expect(attempt.idempotencyKey).toBe(`invoice:${invoice.id}:v1`);
    expect(attempt.status).toBe("REDIRECTED");
    expect(attempt.checkoutUrl).toBe(body.checkoutUrl);
  });

  it("INT-CO-02: two concurrent checkouts never leave two active attempts â€” one wins, the loser is 409 or gets the same URL", async () => {
    const invoice = await createInvoice({ studentProfileId: adultStudent.id });
    const [first, second] = await Promise.all([
      postCheckout(adultUser.id, invoice.id),
      postCheckout(adultUser.id, invoice.id),
    ]);
    expect(first.status).toBe(200);
    // The loser either lost the claim (409 CHECKOUT_IN_PROGRESS) or reused the
    // same URL â€” never a second provider order.
    if (second.status === 409) {
      expect(second.body.error?.code).toBe("CHECKOUT_IN_PROGRESS");
    } else {
      expect(second.status).toBe(200);
      expect(second.body.checkoutUrl).toBe(first.body.checkoutUrl);
    }
    expect(await activeAttemptCount(invoice.id)).toBe(1);
  });

  it("INT-CO-03: a sequential retry after success reuses the same checkout URL and creates no new attempt", async () => {
    const invoice = await createInvoice({ studentProfileId: adultStudent.id });
    const first = await postCheckout(adultUser.id, invoice.id);
    expect(first.status).toBe(200);
    const retry = await postCheckout(adultUser.id, invoice.id);
    expect(retry.status).toBe(200);
    expect(retry.body.checkoutUrl).toBe(first.body.checkoutUrl);
    expect(await prisma.paymentAttempt.count({ where: { invoiceId: invoice.id } })).toBe(1);
    // The provider was called exactly once for this invoice.
    expect(checkoutState.calls.filter((call) => call.invoiceId === invoice.id)).toHaveLength(1);
  });

  it("INT-CO-04: a young in-flight CREATED attempt answers 409 CHECKOUT_IN_PROGRESS and is not failed", async () => {
    const invoice = await createInvoice({ studentProfileId: adultStudent.id });
    await prisma.paymentAttempt.create({
      data: { invoiceId: invoice.id, provider: "PAYMOB", idempotencyKey: `invoice:${invoice.id}:v1`, status: "CREATED" },
    });
    const { status, body } = await postCheckout(adultUser.id, invoice.id);
    expect(status).toBe(409);
    expect(body.error?.code).toBe("CHECKOUT_IN_PROGRESS");
    const attempt = await prisma.paymentAttempt.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    expect(attempt.status).toBe("CREATED");
  });

  it("INT-CO-05: a stale CREATED attempt is failed and taken over with the next deterministic key", async () => {
    const invoice = await createInvoice({ studentProfileId: adultStudent.id });
    await prisma.paymentAttempt.create({
      data: {
        invoiceId: invoice.id,
        provider: "PAYMOB",
        idempotencyKey: `invoice:${invoice.id}:v1`,
        status: "CREATED",
        createdAt: new Date(Date.now() - 3 * 60 * 1000),
      },
    });
    const { status, body } = await postCheckout(adultUser.id, invoice.id);
    expect(status).toBe(200);
    expect(body.checkoutUrl).toContain("paymob.test");
    const attempts = await prisma.paymentAttempt.findMany({ where: { invoiceId: invoice.id }, orderBy: { createdAt: "asc" } });
    expect(attempts).toHaveLength(2);
    expect(attempts[0].status).toBe("FAILED");
    expect(attempts[1].idempotencyKey).toBe(`invoice:${invoice.id}:v2`);
    expect(attempts[1].status).toBe("REDIRECTED");
    expect(await activeAttemptCount(invoice.id)).toBe(1);
    expect(checkoutState.calls).toHaveLength(1);
  });

  it("INT-CO-07: the linked guardian may check out and the payer identity comes from the guardian", async () => {
    const invoice = await createInvoice({ studentProfileId: fx.studentProfileIds.student1 });
    const { status, body } = await postCheckout(fx.guardianUserId, invoice.id);
    expect(status).toBe(200);
    expect(typeof body.checkoutUrl).toBe("string");
    // The fake provider captured the billing identity: the GUARDIAN's, not the student's.
    const call = checkoutState.calls.find((entry) => entry.invoiceId === invoice.id);
    expect(call).toBeDefined();
    expect(call?.lastName).toBe("Test guardian");
    expect(call?.phone).toBe("+201000000005");
    const attempt = await prisma.paymentAttempt.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    expect(attempt.status).toBe("REDIRECTED");
  });

  it("INT-CO-08: an invoice paid by a webhook between the claim and the provider call stays honest and replay-safe", async () => {
    const invoice = await createInvoice({ studentProfileId: adultStudent.id });
    // Simulate the signed webhook landing while the checkout provider call is in flight.
    checkoutState.settleDuringCheckoutInvoiceId = invoice.id;
    checkoutState.settleEvent = {
      provider: "PAYMOB",
      providerEventId: `demo_test_${fx.suffix}_co08`,
      providerReference: `demo_test_${fx.suffix}_co08`,
      invoiceId: invoice.id,
      amountMinor: BigInt(80000),
      currency: "EGP",
      succeeded: true,
      eventType: "PAYMENT_SUCCESS",
      rawEventHash: `demo_test_${fx.suffix}_co08-hash`,
      rawPayload: { redacted: true },
    };
    const { status, body } = await postCheckout(adultUser.id, invoice.id);
    expect(status).toBe(200);
    // The attempt rows stay honest: the checkout redirect happened AND the webhook
    // settled the invoice â€” two attempt rows, one per real event.
    const attempts = await prisma.paymentAttempt.findMany({ where: { invoiceId: invoice.id } });
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual(["REDIRECTED", "SUCCEEDED"]);
    const paid = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { status: true } });
    expect(paid.status).toBe("PAID");
    // No second settlement: replaying the same event is already_processed.
    await expect(settlePaidInvoice(checkoutState.settleEvent)).resolves.toEqual({ status: "already_processed" });
    const purchases = await prisma.subscriptionLedger.count({
      where: { invoiceId: invoice.id, entryType: "INITIAL_PURCHASE" },
    });
    expect(purchases).toBe(1);
    expect(body.checkoutUrl).toContain("paymob.test");
  });

  it("INT-CO-09: a USD invoice checkout answers NOT_CONFIGURED 503 and fails the attempt â€” no provider is invented", async () => {
    const invoice = await createInvoice({ studentProfileId: adultStudent.id, provider: "USD_GATEWAY", currency: "USD" });
    const { status, body } = await postCheckout(adultUser.id, invoice.id);
    expect(status).toBe(503);
    expect(body.error?.code).toBe("NOT_CONFIGURED");
    const attempt = await prisma.paymentAttempt.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    expect(attempt.status).toBe("FAILED");
  });
});
