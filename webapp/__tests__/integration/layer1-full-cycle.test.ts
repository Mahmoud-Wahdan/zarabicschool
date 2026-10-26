jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));
// Paymob is replaced ONLY where it would leave the machine: creating the hosted
// checkout returns a tracked order id instead of calling Paymob. Signature
// verification and settlement stay the REAL code (no fake-Paymob route exists).
jest.mock("../../lib/payments", () => {
  const actual = jest.requireActual<typeof import("../../lib/payments")>("../../lib/payments");
  const { testPaymobId } = jest.requireActual<typeof import("../helpers/webhook-events")>("../helpers/webhook-events");
  class CheckoutBoundaryPaymob extends actual.PaymobProvider {
    async createCheckout(_input: import("../../lib/payments/types").PaymentCheckoutInput, idempotencyKey: string) {
      const orderId = testPaymobId();
      return { providerReference: orderId, checkoutUrl: `https://paymob.test/checkout/${orderId}`, idempotencyKey };
    }
  }
  return { ...actual, PaymobProvider: CheckoutBoundaryPaymob };
});

import { createHmac } from "node:crypto";

import { getServerSession } from "next-auth";

import { POST as createInvoiceRoute } from "../../app/api/invoices/route";
import { POST as checkoutRoute } from "../../app/api/invoices/[id]/checkout/route";
import { POST as paymobWebhookRoute } from "../../app/api/payments/paymob/webhook/route";
import { POST as createSessionRoute } from "../../app/api/sessions/route";
import { POST as submitReportRoute } from "../../app/api/sessions/[id]/students/[studentId]/report/route";
import { POST as reviewReportRoute } from "../../app/api/reports/[id]/review/route";
import { buildPaymobHmacPayload } from "../../lib/payments";
import { prisma } from "../../lib/prisma";
import { processDueNotificationJobs } from "../../lib/worker/notifications";
import { fakeMessaging } from "../helpers/fake-messaging";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";
import { cleanupTrackedWebhookEvents, testPaymobId } from "../helpers/webhook-events";

/**
 * LAYER 1 — full money/attendance cycle through the real routes (Phase 8, owner
 * 2026-10-26), per-run test academy only:
 *   Admin invoice → guardian checkout → signed Paymob callback (settles) →
 *   Admin schedules a session (credit reserved) → session ends → teacher report
 *   (family notified) → Admin approval (student −1, teacher credited, archived) →
 *   worker delivers the notice (fake provider).
 * Layer 2 (a real Paymob payment) runs only when the owner says so.
 */
jest.setTimeout(240_000);

const getServerSessionMock = getServerSession as jest.Mock;
const TEST_HMAC_SECRET = `demo_test_hmac_${Math.random().toString(36).slice(2)}`;
let fx: SessionFixtures;
let originalHmacSecret: string | undefined;

function asActor(userId: string) {
  getServerSessionMock.mockResolvedValue({ user: { id: userId } });
}

function json(pathName: string, body?: unknown) {
  return new Request(`http://localhost:3000${pathName}`, {
    method: "POST",
    headers: sameOriginHeaders(body === undefined ? undefined : { "content-type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
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

describe("Layer 1 — full cycle through the real routes", () => {
  it("L1-01: invoice → checkout → signed callback → session → report → approval → ledgers → notice", async () => {
    const studentId = fx.studentProfileIds.student8; // minor with the fixture guardian, assigned to the teacher

    // 1. Admin creates the invoice (Admin → Invoices validation + CREATED audit).
    asActor(fx.adminUserId);
    const invoiceResponse = await createInvoiceRoute(json("/api/invoices", {
      studentId, packageType: "MONTHLY_PLAN", sessionsPurchased: 8, amountMinor: 160000, currency: "EGP", provider: "PAYMOB",
    }));
    expect(invoiceResponse.status).toBe(201);
    const invoiceId = (await invoiceResponse.json()).data.id as string;

    // 2. The guardian (the payer for a minor) opens checkout; the order id is stored.
    asActor(fx.guardianUserId);
    const checkout = await checkoutRoute(json(`/api/invoices/${invoiceId}/checkout`), { params: Promise.resolve({ id: invoiceId }) });
    expect(checkout.status).toBe(200);
    const attempt = await prisma.paymentAttempt.findFirstOrThrow({ where: { invoiceId, status: "REDIRECTED" } });
    expect(attempt.providerOrderId).toMatch(/^9\d{17}$/);

    // 3. Paymob's signed processed callback (real HMAC verification + settlement).
    const txn = {
      id: testPaymobId(), amount_cents: 160000, created_at: new Date().toISOString(), currency: "EGP",
      error_occured: false, has_parent_transaction: false, integration_id: 77, is_3d_secure: true,
      is_auth: false, is_capture: false, is_refunded: false, is_standalone_payment: true, is_voided: false,
      order: { id: attempt.providerOrderId }, owner: 1, pending: false,
      source_data: { pan: "1234", sub_type: "Visa", type: "card" }, success: true,
    };
    const signature = createHmac("sha512", TEST_HMAC_SECRET).update(buildPaymobHmacPayload(txn)).digest("hex");
    const callback = await paymobWebhookRoute(new Request(`http://localhost:3000/api/payments/paymob/webhook?hmac=${signature}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "TRANSACTION", obj: txn }),
    }));
    expect(callback.status).toBe(200);
    expect((await callback.json()).status).toBe("settled");
    const paid = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true, subscriptionId: true } });
    expect(paid.status).toBe("PAID");
    const subscriptionId = paid.subscriptionId!;
    const balance = async () => (await prisma.subscriptionLedger.aggregate({ where: { subscriptionId }, _sum: { sessionsDelta: true } }))._sum.sessionsDelta;
    expect(await balance()).toBe(8);
    expect((await prisma.paymentAudit.findMany({ where: { invoiceId }, orderBy: { createdAt: "asc" } })).map((row) => row.eventType)).toEqual(["CREATED", "PAID"]);

    // 4. The Admin schedules a private session; one credit is reserved.
    const start = new Date(Date.now() + 5 * 24 * 3600 * 1000);
    start.setUTCMinutes(0, 0, 0);
    asActor(fx.adminUserId);
    const sessionResponse = await createSessionRoute(json("/api/sessions", {
      teacherId: fx.teacherProfileId, subjectId: fx.subjectId, sessionType: "PRIVATE",
      scheduledStart: start.toISOString(), scheduledEnd: new Date(start.getTime() + 3600 * 1000).toISOString(),
      timezone: "Africa/Cairo", zoomJoinUrl: "https://zoom.us/j/456789012345", studentIds: [studentId],
    }));
    expect(sessionResponse.status).toBe(201);
    const sessionId = (await sessionResponse.json()).data.id as string;
    const reservation = await prisma.sessionReservation.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId, studentId } } });
    expect(reservation).toMatchObject({ status: "RESERVED", subscriptionId });

    // 5. Time passes: the session ended 10 minutes ago (only the clock is simulated).
    const end = new Date(Date.now() - 10 * 60 * 1000);
    await prisma.session.update({ where: { id: sessionId }, data: { scheduledStart: new Date(end.getTime() - 3600 * 1000), scheduledEnd: end } });

    // 6. The teacher submits the report → the family is notified at submit.
    asActor(fx.teacherUserId);
    const submit = await submitReportRoute(
      json(`/api/sessions/${sessionId}/students/${studentId}/report`, {
        attendanceOutcome: "ATTENDED", classRemark: "good", summary: "Full cycle lesson.", homework: "Revise page 3.", notes: "",
      }),
      { params: Promise.resolve({ id: sessionId, studentId }) },
    );
    expect(submit.status).toBe(201);
    const reportId = (await submit.json()).data.id as string;
    expect(await prisma.notificationJob.count({ where: { kind: "REPORT_SUBMITTED", dedupKey: { startsWith: `REPORT_SUBMITTED:${reportId}:` } } })).toBeGreaterThan(0);

    // 7. The Admin approves → ONE transaction: −1 student credit, teacher credited, archived.
    asActor(fx.adminUserId);
    const review = await reviewReportRoute(json(`/api/reports/${reportId}/review`, { action: "APPROVE" }), { params: Promise.resolve({ id: reportId }) });
    expect(review.status).toBe(200);
    expect(await balance()).toBe(7);
    const deduction = await prisma.subscriptionLedger.findFirstOrThrow({ where: { sessionId, entryType: "SESSION_DEDUCTION" } });
    expect(deduction).toMatchObject({ sessionsDelta: -1, subscriptionId, reportId });
    const credit = await prisma.payrollLedger.findFirstOrThrow({ where: { sessionId, entryType: "SESSION_CREDIT" } });
    expect(credit).toMatchObject({ amountMinor: 6000, currency: "EGP", minutesCredited: 60, hourlyRateSnapshotMinor: 6000 });
    expect((await prisma.sessionReservation.findUniqueOrThrow({ where: { id: reservation.id } })).status).toBe("CONSUMED");
    const report = await prisma.report.findUniqueOrThrow({ where: { id: reportId }, select: { status: true, settledAt: true, archivedAt: true } });
    expect(report.status).toBe("APPROVED");
    expect(report.settledAt).not.toBeNull();
    expect(report.archivedAt).not.toBeNull();
    expect((await prisma.sessionStudent.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId, studentId } } })).attendanceStatus).toBe("ATTENDED");

    // 8. The worker delivers the submit notice through the (fake) provider.
    fakeMessaging.reset();
    await processDueNotificationJobs(new Date(), fx.academyId);
    const notices = await prisma.notificationJob.findMany({ where: { kind: "REPORT_SUBMITTED", dedupKey: { startsWith: `REPORT_SUBMITTED:${reportId}:` } }, select: { status: true } });
    expect(notices.length).toBeGreaterThan(0);
    expect(notices.every((job) => job.status === "SENT")).toBe(true);
    expect(fakeMessaging.sent.length).toBeGreaterThanOrEqual(notices.length);

    // A second approval click changes nothing (idempotent).
    asActor(fx.adminUserId);
    const again = await reviewReportRoute(json(`/api/reports/${reportId}/review`, { action: "APPROVE" }), { params: Promise.resolve({ id: reportId }) });
    expect(again.status).toBe(200);
    expect(await balance()).toBe(7);
    expect(await prisma.payrollLedger.count({ where: { sessionId } })).toBe(1);
  });
});
