jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { randomInt, randomUUID } from "node:crypto";

import { getServerSession } from "next-auth";

import { POST as refundRoute } from "../../app/api/invoices/[id]/refunds/route";
import { POST as requestRoute } from "../../app/api/invoices/[id]/refund-request/route";
import { GET as listRoute } from "../../app/api/refund-requests/route";
import { POST as rejectRoute } from "../../app/api/refund-requests/[id]/reject/route";
import { PaymobSubscriptionClient } from "../../lib/payments/paymob-subscriptions";
import { prisma } from "../../lib/prisma";
import { composeJobMessage } from "../../lib/worker/notifications";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * S-15 payer refund request (D74; SQL S-8 approved 2026-10-29). The payer (a guardian,
 * or an adult student who pays for themself) only asks; no reason, no session count.
 * One open request per invoice; only PAID Paymob invoices. The Admin rejects with a
 * reason, or approves by sending the existing S-13c refund linked to the request. The
 * payer is told in-app + WhatsApp; the Admin gets an in-app notice; never the
 * Supervisor. Per-run test academy; Paymob is a spy (never reached).
 */
jest.setTimeout(240_000);

const getServerSessionMock = getServerSession as jest.Mock;
let fx: SessionFixtures;

const as = (userId: string) => getServerSessionMock.mockResolvedValue({ user: { id: userId } });
const json = { "content-type": "application/json" };

async function ask(invoiceId: string, headers = sameOriginHeaders(json)) {
  const response = await requestRoute(new Request(`http://localhost:3000/api/invoices/${invoiceId}/refund-request`, { method: "POST", headers, body: "{}" }), { params: Promise.resolve({ id: invoiceId }) });
  return { status: response.status, body: await response.json() };
}
async function reject(id: string, reason: unknown) {
  const response = await rejectRoute(new Request(`http://localhost:3000/api/refund-requests/${id}/reject`, { method: "POST", headers: sameOriginHeaders(json), body: JSON.stringify({ reason }) }), { params: Promise.resolve({ id }) });
  return { status: response.status, body: await response.json() };
}
async function list(query = "") {
  const response = await listRoute(new Request(`http://localhost:3000/api/refund-requests${query}`));
  return { status: response.status, body: await response.json() };
}
async function refund(invoiceId: string, body: unknown) {
  const response = await refundRoute(
    new Request(`http://localhost:3000/api/invoices/${invoiceId}/refunds`, { method: "POST", headers: { ...sameOriginHeaders(json), "idempotency-key": randomUUID() }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: invoiceId }) },
  );
  return { status: response.status, body: await response.json() };
}

/** A PAID Paymob invoice with its package and INITIAL_PURCHASE, as settlement writes them. */
async function paidInvoice(studentKey: string, overrides: { provider?: "PAYMOB" | "USD_GATEWAY"; status?: "PAID" | "PENDING" } = {}) {
  const sub = await prisma.subscription.create({
    data: { academyId: fx.academyId, studentId: fx.studentProfileIds[studentKey], packageType: "MONTHLY_PLAN", sessionsPurchased: 8, totalAmountMinor: BigInt(80000), currency: "EGP", periodStartsAt: new Date(), periodEndsAt: new Date(Date.now() + 20 * 86_400_000), status: "ACTIVE" },
  });
  const status = overrides.status ?? "PAID";
  const invoice = await prisma.invoice.create({
    data: {
      academyId: fx.academyId, studentId: fx.studentProfileIds[studentKey], subscriptionId: sub.id, amountMinor: BigInt(80000), currency: "EGP",
      provider: overrides.provider ?? "PAYMOB", packageType: "MONTHLY_PLAN", sessionsPurchased: 8, status,
      paidAt: status === "PAID" ? new Date() : null, providerReference: status === "PAID" ? String(randomInt(100_000_000, 999_999_999)) : null,
    },
  });
  if (status === "PAID") await prisma.subscriptionLedger.create({ data: { academyId: fx.academyId, subscriptionId: sub.id, invoiceId: invoice.id, entryType: "INITIAL_PURCHASE", sessionsDelta: 8 } });
  return invoice;
}
const jobs = (kind: string) => prisma.notificationJob.findMany({ where: { academyId: fx.academyId, kind } });

beforeAll(async () => {
  fx = await createSessionFixtures();
  jest.spyOn(PaymobSubscriptionClient.prototype, "refundTransaction").mockImplementation(async () => ({ providerRefundId: String(randomInt(1_000_000, 9_999_999)), outcome: "SUCCEEDED" }));
});

afterAll(async () => {
  jest.restoreAllMocks();
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("S-15 payer refund request", () => {
  it("RR-01: the guardian asks for a refund of a paid Paymob invoice: one PENDING request, the Admin gets an in-app notice only", async () => {
    const invoice = await paidInvoice("student1");
    as(fx.guardianUserId);
    const result = await ask(invoice.id);
    expect(result.status).toBe(201);
    const row = await prisma.refundRequest.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    expect(row).toMatchObject({ status: "PENDING", requestedById: fx.guardianUserId, academyId: fx.academyId });
    const notices = await jobs("REFUND_REQUEST_RECEIVED");
    expect(notices.map((job) => job.recipientUserId)).toEqual([fx.adminUserId]);
    expect(notices[0].status).toBe("SENT"); // in-app only: the worker never sends it
    expect(notices.some((job) => job.recipientUserId === fx.supervisorUserId)).toBe(false);
  });

  it("RR-02: one open request per invoice; after a rejection the payer may ask again", async () => {
    const invoice = await paidInvoice("student2");
    as(fx.guardianUserId);
    expect((await ask(invoice.id)).status).toBe(201);
    const second = await ask(invoice.id);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("REQUEST_ALREADY_OPEN");
    const open = await prisma.refundRequest.findFirstOrThrow({ where: { invoiceId: invoice.id, status: "PENDING" } });
    as(fx.adminUserId);
    expect((await reject(open.id, "Sessions were already used")).status).toBe(200);
    as(fx.guardianUserId);
    expect((await ask(invoice.id)).status).toBe(201);
    expect(await prisma.refundRequest.count({ where: { invoiceId: invoice.id } })).toBe(2);
  });

  it("RR-03: only a PAID Paymob invoice can be asked about", async () => {
    as(fx.guardianUserId);
    const unpaid = await ask((await paidInvoice("student3", { status: "PENDING" })).id);
    expect(unpaid.status).toBe(409);
    expect(unpaid.body.error.code).toBe("NOT_REFUNDABLE");
    const usd = await ask((await paidInvoice("student3", { provider: "USD_GATEWAY" })).id);
    expect(usd.status).toBe(409);
  });

  it("RR-04: only the payer: a student with a guardian, staff and another family are refused; cross-origin is 403", async () => {
    const invoice = await paidInvoice("student4");
    as(fx.studentUserIds.student4);
    expect((await ask(invoice.id)).status).toBe(403);
    for (const staff of [fx.adminUserId, fx.supervisorUserId, fx.teacherUserId]) {
      as(staff);
      expect((await ask(invoice.id)).status).toBe(403);
    }
    as(fx.foreignStudentUserId);
    expect((await ask(invoice.id)).status).toBe(404);
    as(fx.guardianUserId);
    expect((await ask(invoice.id, { origin: "https://evil.example", host: "localhost:3000", "content-type": "application/json" })).status).toBe(403);
    getServerSessionMock.mockResolvedValue(null);
    expect((await ask(invoice.id)).status).toBe(401);
    expect(await prisma.refundRequest.count({ where: { invoiceId: invoice.id } })).toBe(0);
  });

  it("RR-05: an adult student who pays for themself can ask", async () => {
    const studentId = fx.studentProfileIds.student12;
    await prisma.student.update({ where: { id: studentId }, data: { guardianId: null, isAdult: true } });
    const invoice = await paidInvoice("student12");
    as(fx.studentUserIds.student12);
    expect((await ask(invoice.id)).status).toBe(201);
  });

  it("RR-06: the Admin rejects with a reason: REJECTED, payer told in-app + WhatsApp in their language with the reason", async () => {
    const invoice = await paidInvoice("student5");
    as(fx.guardianUserId);
    await ask(invoice.id);
    const open = await prisma.refundRequest.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    as(fx.adminUserId);
    expect((await reject(open.id, " ")).status).toBe(400);
    expect((await reject(open.id, "The month is almost over")).status).toBe(200);
    const row = await prisma.refundRequest.findUniqueOrThrow({ where: { id: open.id } });
    expect(row).toMatchObject({ status: "REJECTED", decidedById: fx.adminUserId, rejectionReason: "The month is almost over" });
    expect((await reject(open.id, "Again")).status).toBe(409);
    const notice = (await jobs("REFUND_REQUEST_REJECTED")).find((job) => (job.payload as { requestId?: string }).requestId === open.id)!;
    expect(notice).toMatchObject({ recipientUserId: fx.guardianUserId, status: "PENDING" });
    const message = composeJobMessage({ ...notice, recipientUser: { preferredLanguage: "en", timezone: "Africa/Cairo" } } as never);
    expect(message).toContain("The month is almost over");
  });

  it("RR-07: the Admin approves by sending the linked refund: APPROVED with the refund, payer told the amount", async () => {
    const invoice = await paidInvoice("student6");
    as(fx.guardianUserId);
    await ask(invoice.id);
    const open = await prisma.refundRequest.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    as(fx.adminUserId);
    const result = await refund(invoice.id, { sessions: 2, reason: "Student is sick", refundRequestId: open.id });
    expect(result.status).toBe(201);
    const row = await prisma.refundRequest.findUniqueOrThrow({ where: { id: open.id } });
    expect(row.status).toBe("APPROVED");
    expect(row.invoiceRefundId).toBe(result.body.data.id);
    const notice = (await jobs("REFUND_REQUEST_APPROVED")).find((job) => (job.payload as { requestId?: string }).requestId === open.id)!;
    expect(notice.recipientUserId).toBe(fx.guardianUserId);
    const message = composeJobMessage({ ...notice, recipientUser: { preferredLanguage: "en", timezone: "Africa/Cairo" } } as never);
    expect(message).toMatch(/200/);
  });

  it("RR-08: a refund cannot be linked to a request of another invoice, or to one that is not open", async () => {
    const first = await paidInvoice("student7");
    const second = await paidInvoice("student7");
    as(fx.guardianUserId);
    await ask(first.id);
    const open = await prisma.refundRequest.findFirstOrThrow({ where: { invoiceId: first.id } });
    as(fx.adminUserId);
    const wrong = await refund(second.id, { sessions: 1, reason: "Wrong invoice", refundRequestId: open.id });
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.code).toBe("REQUEST_NOT_OPEN");
    expect(await prisma.invoiceRefund.count({ where: { invoiceId: second.id } })).toBe(0);
    await reject(open.id, "Rejected first");
    const late = await refund(first.id, { sessions: 1, reason: "Too late", refundRequestId: open.id });
    expect(late.status).toBe(409);
  });

  it("RR-09: the Admin list shows the academy's requests (filter by status); Supervisor, payer and a foreign Admin cannot list or reject", async () => {
    as(fx.adminUserId);
    const all = await list();
    expect(all.status).toBe(200);
    expect(all.body.data.length).toBeGreaterThan(0);
    expect(all.body.data.every((row: { status: string }) => ["PENDING", "APPROVED", "REJECTED"].includes(row.status))).toBe(true);
    const pending = await list("?status=PENDING");
    expect(pending.body.data.every((row: { status: string }) => row.status === "PENDING")).toBe(true);
    const anyId = all.body.data[0].id;
    for (const user of [fx.supervisorUserId, fx.guardianUserId]) {
      as(user);
      expect((await list()).status).toBe(403);
      expect((await reject(anyId, "Not allowed")).status).toBe(403);
    }
    as(fx.foreignAdminUserId);
    expect((await list()).body.data).toEqual([]);
    expect((await reject(anyId, "Other academy")).status).toBe(404);
  });

  it("RR-10: every composed refund-request message exists in both languages", async () => {
    for (const kind of ["REFUND_REQUEST_RECEIVED", "REFUND_REQUEST_APPROVED", "REFUND_REQUEST_REJECTED"]) {
      for (const language of ["ar", "en"]) {
        const message = composeJobMessage({ kind, payload: { requestId: randomUUID(), amountMinor: "20000", currency: "EGP", reason: "x", path: "/guardian/invoices" }, recipientUser: { preferredLanguage: language, timezone: "Africa/Cairo" } } as never);
        expect(message.length).toBeGreaterThan(10);
      }
    }
  });
});
