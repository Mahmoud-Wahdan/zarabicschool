jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { getServerSession } from "next-auth";

import { POST as createInvoiceRoute } from "../../app/api/invoices/route";
import { POST as checkoutRoute } from "../../app/api/invoices/[id]/checkout/route";
import { PATCH as sessionPatchRoute } from "../../app/api/sessions/[id]/route";
import { POST as enrollRoute } from "../../app/api/admin/enrollments/route";
import { POST as submitReportRoute } from "../../app/api/sessions/[id]/students/[studentId]/report/route";
import { POST as reviewReportRoute } from "../../app/api/reports/[id]/review/route";
import { ANNOUNCEMENT_MAX_PER_HOUR } from "../../lib/config/announcements";
import { prisma } from "../../lib/prisma";
import { processDueNotificationJobs } from "../../lib/worker/notifications";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * Money/attendance guards from Session 5 phase (b) that had no test (Phase 8 audit):
 * A4 annual plans disabled, B5 pay-per-session bounds, A2 both directions (no cancel
 * after settlement; no settlement of a cancelled/missed session) and the
 * announcement hourly cap. Per-run test academy only.
 */
jest.setTimeout(240_000);

const getServerSessionMock = getServerSession as jest.Mock;
let fx: SessionFixtures;
const MINUTE = 60 * 1000;

function asActor(userId: string) {
  getServerSessionMock.mockResolvedValue({ user: { id: userId } });
}

function req(pathName: string, method: string, body?: unknown) {
  return new Request(`http://localhost:3000${pathName}`, {
    method, headers: sameOriginHeaders({ "content-type": "application/json" }), body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function pastSession(studentKey: string, status: "SCHEDULED" | "COMPLETED" = "SCHEDULED") {
  const end = new Date(Date.now() - 20 * MINUTE);
  return prisma.session.create({
    data: {
      academyId: fx.academyId, teacherId: fx.teacherProfileId, subjectId: fx.subjectId, sessionType: "PRIVATE",
      scheduledStart: new Date(end.getTime() - 60 * MINUTE), scheduledEnd: end, durationMinutes: 60, timezone: "Africa/Cairo",
      zoomJoinUrl: "https://zoom.us/j/345678901234", createdById: fx.adminUserId, status,
      students: { create: [{ studentId: fx.studentProfileIds[studentKey] }] },
    },
    select: { id: true },
  });
}

async function submitReport(sessionId: string, studentKey: string) {
  const studentId = fx.studentProfileIds[studentKey];
  asActor(fx.teacherUserId);
  const response = await submitReportRoute(
    req(`/api/sessions/${sessionId}/students/${studentId}/report`, "POST", { attendanceOutcome: "ATTENDED", classRemark: "good", summary: "x lesson", homework: "y", notes: "" }),
    { params: Promise.resolve({ id: sessionId, studentId }) },
  );
  expect(response.status).toBe(201);
  return (await response.json()).data.id as string;
}

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("A4 — annual plans cannot be sold yet", () => {
  it("MG-01: creating an ANNUAL_PLAN invoice is refused (409) and an existing annual invoice cannot be checked out (409)", async () => {
    asActor(fx.adminUserId);
    const create = await createInvoiceRoute(req("/api/invoices", "POST", { studentId: fx.studentProfileIds.student1, packageType: "ANNUAL_PLAN", sessionsPurchased: 8, amountMinor: 1000000, currency: "EGP", provider: "PAYMOB" }));
    expect(create.status).toBe(409);
    expect((await create.json()).error.code).toBe("ANNUAL_PLAN_DISABLED");
    const legacy = await prisma.invoice.create({
      data: { academyId: fx.academyId, studentId: fx.studentProfileIds.student1, amountMinor: BigInt(1000000), currency: "EGP", provider: "PAYMOB", packageType: "ANNUAL_PLAN", sessionsPurchased: 8, status: "PENDING" },
      select: { id: true },
    });
    asActor(fx.guardianUserId);
    const checkout = await checkoutRoute(req(`/api/invoices/${legacy.id}/checkout`, "POST"), { params: Promise.resolve({ id: legacy.id }) });
    expect(checkout.status).toBe(409);
    expect((await checkout.json()).error.code).toBe("ANNUAL_PLAN_DISABLED");
    expect(await prisma.paymentAttempt.count({ where: { invoiceId: legacy.id } })).toBe(0);
  });
});

describe("B5 — pay-per-session size within the Admin limits (default 1–16)", () => {
  it("MG-02: 17 sessions → 400 PAY_PER_SESSION_OUT_OF_RANGE; 0 → 400; 16 → 201", async () => {
    asActor(fx.adminUserId);
    const body = (sessionsPurchased: number) => ({ studentId: fx.studentProfileIds.student2, packageType: "PAY_PER_SESSION", sessionsPurchased, amountMinor: 10000, currency: "EGP", provider: "PAYMOB" });
    const tooMany = await createInvoiceRoute(req("/api/invoices", "POST", body(17)));
    expect(tooMany.status).toBe(400);
    expect((await tooMany.json()).error.code).toBe("PAY_PER_SESSION_OUT_OF_RANGE");
    expect((await createInvoiceRoute(req("/api/invoices", "POST", body(0)))).status).toBe(400);
    expect((await createInvoiceRoute(req("/api/invoices", "POST", body(16)))).status).toBe(201);
  });
});

describe("A2 — settlement and cancellation never overlap", () => {
  it("MG-03: a session whose report was approved (money moved) cannot be cancelled (409 SESSION_HAS_SETTLED_REPORTS)", async () => {
    const s = await pastSession("student3");
    const reportId = await submitReport(s.id, "student3");
    asActor(fx.adminUserId);
    expect((await reviewReportRoute(req(`/api/reports/${reportId}/review`, "POST", { action: "APPROVE" }), { params: Promise.resolve({ id: reportId }) })).status).toBe(200);
    // The last roster report completed the session; even forced back to SCHEDULED
    // (e.g. a stale screen), a cancel must refuse because money moved.
    await prisma.session.update({ where: { id: s.id }, data: { status: "SCHEDULED" } });
    asActor(fx.adminUserId);
    const cancel = await sessionPatchRoute(req(`/api/sessions/${s.id}`, "PATCH", { status: "CANCELLED", cancellationReason: "demo test" }), { params: Promise.resolve({ id: s.id }) });
    expect(cancel.status).toBe(409);
    expect((await cancel.json()).error.code).toBe("SESSION_HAS_SETTLED_REPORTS");
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).status).not.toBe("CANCELLED");
  });

  it("MG-04: a report of a session cancelled or missed after submission cannot be approved (409 SESSION_NOT_SETTLEABLE) — no money", async () => {
    for (const status of ["CANCELLED", "MISSED"] as const) {
      const s = await pastSession(status === "CANCELLED" ? "student4" : "student5");
      const reportId = await submitReport(s.id, status === "CANCELLED" ? "student4" : "student5");
      await prisma.session.update({ where: { id: s.id }, data: { status } });
      asActor(fx.adminUserId);
      const review = await reviewReportRoute(req(`/api/reports/${reportId}/review`, "POST", { action: "APPROVE" }), { params: Promise.resolve({ id: reportId }) });
      expect(review.status).toBe(409);
      expect((await review.json()).error.code).toBe("SESSION_NOT_SETTLEABLE");
      expect(await prisma.payrollLedger.count({ where: { sessionId: s.id } })).toBe(0);
      expect(await prisma.subscriptionLedger.count({ where: { sessionId: s.id } })).toBe(0);
      expect((await prisma.report.findUniqueOrThrow({ where: { id: reportId } })).status).toBe("SUBMITTED");
    }
  });
});

describe("Announcement hourly cap", () => {
  it("MG-05: with ANNOUNCEMENT_MAX_PER_HOUR announcement messages sent in the last hour, a due announcement job waits (stays PENDING)", async () => {
    const announcement = await prisma.announcement.create({
      data: { academyId: fx.academyId, createdById: fx.adminUserId, title: "Cap test", body: "Cap test body", expiresAt: new Date(Date.now() + 24 * 3600 * 1000), whatsappRecipientCount: 1 },
      select: { id: true },
    });
    await prisma.notificationJob.createMany({
      data: Array.from({ length: ANNOUNCEMENT_MAX_PER_HOUR }, (_, index) => ({
        academyId: fx.academyId, sessionId: null, recipientUserId: fx.teacherUserId, kind: "ANNOUNCEMENT",
        dedupKey: `demo_test_cap_sent_${index}_${announcement.id}`, scheduledFor: new Date(Date.now() - 30 * MINUTE),
        status: "SENT", sentAt: new Date(Date.now() - 10 * MINUTE), payload: { announcementId: announcement.id },
      })),
    });
    const due = await prisma.notificationJob.create({
      data: { academyId: fx.academyId, sessionId: null, recipientUserId: fx.teacher2UserId, kind: "ANNOUNCEMENT", dedupKey: `demo_test_cap_due_${announcement.id}`, scheduledFor: new Date(Date.now() - MINUTE), status: "PENDING", payload: { announcementId: announcement.id } },
      select: { id: true },
    });
    await processDueNotificationJobs(new Date(), fx.academyId);
    expect((await prisma.notificationJob.findUniqueOrThrow({ where: { id: due.id } })).status).toBe("PENDING");
  });
});

describe("Owner Q16 (2026-10-27) — no student is added to a session that already ended", () => {
  it("MG-06: adding a student to an ended (still SCHEDULED, unreported) session → 409 SESSION_ALREADY_ENDED; roster and credit untouched", async () => {
    const s = await pastSession("student6");
    for (const actor of [fx.adminUserId, fx.supervisorUserId]) {
      asActor(actor);
      const response = await enrollRoute(req("/api/admin/enrollments", "POST", { sessionId: s.id, studentId: fx.studentProfileIds.student7 }));
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe("SESSION_ALREADY_ENDED");
    }
    expect(await prisma.sessionStudent.count({ where: { sessionId: s.id } })).toBe(1);
    expect(await prisma.sessionReservation.count({ where: { sessionId: s.id, studentId: fx.studentProfileIds.student7 } })).toBe(0);
  });
});
