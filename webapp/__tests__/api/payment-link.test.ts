jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { createHash } from "node:crypto";

import { getServerSession } from "next-auth";

import { POST as sendLinkRoute } from "../../app/api/invoices/[id]/send-link/route";
import { settlePaidInvoice } from "../../lib/payments/settlement";
import { composeJobMessage } from "../../lib/worker/notifications";
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
 * S-13 (a) payment link (D6, D20) and (b) provider void/refund records (D43), SQL S-6
 * approved 2026-10-28. The link goes to the PAYER only, at most once a day (payer's
 * zone) and 3 times per invoice, points at the platform invoices page (never a Paymob
 * URL), in the payer's language, with a LINK_SENT audit row. A void/refund seen from
 * Paymob is recorded (VOIDED / PROVIDER_REFUND_SEEN) and flags the Admin; no ledger
 * change. Per-run test academy.
 */
jest.setTimeout(240_000);

const getServerSessionMock = getServerSession as jest.Mock;
let fx: SessionFixtures;
const savedUrl = process.env.APP_PUBLIC_URL;

const as = (userId: string) => getServerSessionMock.mockResolvedValue({ user: { id: userId } });
const send = (invoiceId: string, headers = sameOriginHeaders()) =>
  sendLinkRoute(new Request(`http://localhost:3000/api/invoices/${invoiceId}/send-link`, { method: "POST", headers }), { params: Promise.resolve({ id: invoiceId }) });
const invoice = (studentKey: string, status: "PENDING" | "PAID" = "PENDING") =>
  prisma.invoice.create({
    data: { academyId: fx.academyId, studentId: fx.studentProfileIds[studentKey], amountMinor: BigInt(80000), currency: "EGP", provider: "PAYMOB", packageType: "MONTHLY_PLAN", sessionsPurchased: 8, status, ...(status === "PAID" ? { paidAt: new Date() } : {}) },
  });

beforeAll(async () => {
  process.env.APP_PUBLIC_URL = "https://app.test";
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (savedUrl === undefined) delete process.env.APP_PUBLIC_URL;
  else process.env.APP_PUBLIC_URL = savedUrl;
  await cleanupTrackedWebhookEvents();
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("S-13 (a) payment link", () => {
  it("PL-01: the Admin sends the link to the guardian (the payer), with a LINK_SENT audit row", async () => {
    const row = await invoice("student1");
    as(fx.adminUserId);
    const response = await send(row.id);
    expect(response.status).toBe(201);
    const jobs = await prisma.notificationJob.findMany({ where: { academyId: fx.academyId, kind: "INVOICE_PAYMENT_LINK" } });
    expect(jobs.map((job) => job.recipientUserId)).toEqual([fx.guardianUserId]);
    expect(await prisma.paymentAudit.count({ where: { invoiceId: row.id, eventType: "LINK_SENT" } })).toBe(1);
  });

  it("PL-02: the message links the platform invoices page in the payer's language, never Paymob, no amount", async () => {
    const job = await prisma.notificationJob.findFirstOrThrow({ where: { academyId: fx.academyId, kind: "INVOICE_PAYMENT_LINK" } });
    for (const language of ["ar", "en"] as const) {
      const text = composeJobMessage({ ...job, recipientUser: { id: fx.guardianUserId, phone: null, isActive: true, preferredLanguage: language, timezone: "Africa/Cairo" }, session: null } as never);
      expect(text).toContain(`https://app.test/${language}/guardian/invoices`);
      expect(text).not.toMatch(/paymob|accept\.|800|٨٠٠/i);
    }
  });

  it("PL-03: at most once a day per invoice — a second send the same day is 429", async () => {
    const row = await invoice("student2");
    as(fx.adminUserId);
    expect((await send(row.id)).status).toBe(201);
    const again = await send(row.id);
    expect(again.status).toBe(429);
    expect((await again.json()).error.code).toBe("LINK_ALREADY_SENT_TODAY");
  });

  it("PL-04: at most 3 links per invoice", async () => {
    const row = await invoice("student3");
    for (const daysAgo of [3, 2, 1]) {
      await prisma.paymentAudit.create({ data: { academyId: fx.academyId, invoiceId: row.id, eventType: "LINK_SENT", actorId: fx.adminUserId, actorRole: "ADMIN", createdAt: new Date(Date.now() - daysAgo * 86_400_000) } });
    }
    as(fx.adminUserId);
    const response = await send(row.id);
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe("LINK_LIMIT_REACHED");
  });

  it("PL-05: only a PENDING invoice; only the Admin; same-origin; another academy is invisible", async () => {
    const paid = await invoice("student4", "PAID");
    as(fx.adminUserId);
    expect((await send(paid.id)).status).toBe(409);
    const row = await invoice("student5");
    for (const userId of [fx.supervisorUserId, fx.guardianUserId, fx.teacherUserId]) {
      as(userId);
      expect((await send(row.id)).status).toBe(403);
    }
    as(fx.foreignAdminUserId);
    expect((await send(row.id)).status).toBe(404);
    as(fx.adminUserId);
    expect((await send(row.id, { origin: "https://evil.example", host: "localhost:3000" })).status).toBe(403);
  });

  it("PL-06: an adult student paying for themself gets the link to their own invoices page", async () => {
    const adultUser = await prisma.user.create({ data: { academyId: fx.academyId, username: `demo_test_adult_${fx.suffix}`, displayName: "Demo Test adult", passwordHash: "x", role: "STUDENT", isActive: true, preferredLanguage: "en" } });
    const adult = await prisma.student.create({ data: { userId: adultUser.id, academyId: fx.academyId, isAdult: true } });
    const row = await prisma.invoice.create({ data: { academyId: fx.academyId, studentId: adult.id, amountMinor: BigInt(50000), currency: "EGP", provider: "PAYMOB", packageType: "MONTHLY_PLAN", sessionsPurchased: 4, status: "PENDING" } });
    as(fx.adminUserId);
    expect((await send(row.id)).status).toBe(201);
    const job = await prisma.notificationJob.findFirstOrThrow({ where: { kind: "INVOICE_PAYMENT_LINK", recipientUserId: adultUser.id } });
    const text = composeJobMessage({ ...job, recipientUser: { id: adultUser.id, phone: null, isActive: true, preferredLanguage: "en", timezone: "Africa/Cairo" }, session: null } as never);
    expect(text).toContain("https://app.test/en/student/invoices");
  });
});

describe("S-13 (b) provider void/refund", () => {
  it("PR-01: a signed void/refund of a PAID invoice is recorded as VOIDED / PROVIDER_REFUND_SEEN, flags the Admin, and changes no ledger", async () => {
    for (const outcome of ["VOIDED", "REFUNDED"] as const) {
      const row = await invoice("student6", "PAID");
      const orderId = testPaymobId();
      await prisma.paymentAttempt.create({ data: { invoiceId: row.id, provider: "PAYMOB", idempotencyKey: `demo_test_${fx.suffix}_${orderId}`, providerReference: orderId, providerOrderId: orderId, status: "SUCCEEDED" } });
      const txn = testPaymobId();
      const before = await prisma.subscriptionLedger.count({ where: { academyId: fx.academyId } });
      const result = await settlePaidInvoice({
        provider: "PAYMOB", providerEventId: `${txn}:${outcome}`, providerReference: txn, providerOrderId: orderId,
        amountMinor: BigInt(80000), currency: "EGP", succeeded: false, outcome, eventType: "PAYMENT_FAILED",
        rawEventHash: createHash("sha256").update(`pr-${txn}`).digest("hex"),
      });
      expect(result.status).toBe("ignored");
      const expected = outcome === "VOIDED" ? "VOIDED" : "PROVIDER_REFUND_SEEN";
      expect(await prisma.paymentAudit.count({ where: { invoiceId: row.id, eventType: expected } })).toBe(1);
      const flags = await prisma.notificationJob.findMany({ where: { academyId: fx.academyId, kind: "PAYMENT_ANOMALY", recipientUserId: fx.adminUserId } });
      expect(flags.some((job) => (job.payload as { invoiceId?: string }).invoiceId === row.id)).toBe(true);
      expect(await prisma.subscriptionLedger.count({ where: { academyId: fx.academyId } })).toBe(before);
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("PAID");
    }
  });
});
