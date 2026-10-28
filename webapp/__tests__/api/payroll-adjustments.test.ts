jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { getServerSession } from "next-auth";

import { GET as listRoute, POST as adjustmentRoute } from "../../app/api/payroll/adjustments/route";
import { POST as reverseRoute } from "../../app/api/payroll/adjustments/[id]/reverse/route";
import { getInbox } from "../../lib/notifications/inbox";
import { processDueNotificationJobs } from "../../lib/worker/notifications";
import { prisma } from "../../lib/prisma";
import { fakeMessaging } from "../helpers/fake-messaging";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * S-12 deductions & bonuses (D14, D40; SQL S-5 approved 2026-10-28). Admin only;
 * category + reason required; FINE < 0, BONUS/OVERTIME > 0, OTHER either sign;
 * reversal only by one opposite entry; the teacher sees their own entries and the
 * reason, and gets an in-app notice (never WhatsApp). Approved-overtime rows
 * (report_id set) count as OVERTIME (D40). Per-run test academy.
 */
jest.setTimeout(240_000);

type Entry = { id: string; amountMinor: number; category: string; reason: string | null; reversible: boolean };
const getServerSessionMock = getServerSession as jest.Mock;
let fx: SessionFixtures;

const as = (userId: string) => getServerSessionMock.mockResolvedValue({ user: { id: userId } });
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000${url}`, { method: "POST", headers: sameOriginHeaders({ "content-type": "application/json", ...headers }), body: JSON.stringify(body) });
async function adjust(body: Record<string, unknown>) {
  const response = await adjustmentRoute(post("/api/payroll/adjustments", { teacherId: fx.teacherProfileId, currency: "EGP", reason: "Demo test entry", ...body }));
  return { status: response.status, body: await response.json() };
}
async function reverse(id: string, reason = "Demo test reversal") {
  const response = await reverseRoute(post(`/api/payroll/adjustments/${id}/reverse`, { reason }), { params: Promise.resolve({ id }) });
  return { status: response.status, body: await response.json() };
}
async function list(query = ""): Promise<{ status: number; entries: Entry[] }> {
  const response = await listRoute(new Request(`http://localhost:3000/api/payroll/adjustments${query}`));
  return { status: response.status, entries: response.ok ? (await response.json()).data : [] };
}

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("S-12 deductions and bonuses", () => {
  it("DB-01: the Admin records a fine with a category and a reason; the teacher gets an in-app notice", async () => {
    as(fx.adminUserId);
    const fine = await adjust({ amountMinor: -5000, category: "FINE", reason: "Late three times" });
    expect(fine.status).toBe(201);
    const row = await prisma.payrollLedger.findUniqueOrThrow({ where: { id: fine.body.data.id } });
    expect(row).toMatchObject({ entryType: "ADMIN_ADJUSTMENT", amountMinor: -5000, adjustmentCategory: "FINE", reason: "Late three times", createdById: fx.adminUserId });
    const notices = await prisma.notificationJob.findMany({ where: { academyId: fx.academyId, kind: "PAYROLL_ADJUSTMENT" } });
    expect(notices.map((job) => job.recipientUserId)).toEqual([fx.teacherUserId]);
    expect(JSON.stringify(notices[0].payload)).not.toMatch(/5000|Late/);
  });

  it("DB-02: sign rules per category; category and reason are required", async () => {
    as(fx.adminUserId);
    expect((await adjust({ amountMinor: 5000, category: "FINE" })).status).toBe(400);
    expect((await adjust({ amountMinor: -5000, category: "BONUS" })).status).toBe(400);
    expect((await adjust({ amountMinor: -100, category: "OVERTIME" })).status).toBe(400);
    expect((await adjust({ amountMinor: -100, category: "OTHER" })).status).toBe(201);
    expect((await adjust({ amountMinor: 100, category: "OTHER" })).status).toBe(201);
    expect((await adjust({ amountMinor: 100 })).status).toBe(400);
    expect((await adjust({ amountMinor: 100, category: "BONUS", reason: "" })).status).toBe(400);
  });

  it("DB-03: reversal writes one opposite entry with the same category; a second reversal is refused; Supervisor and Teacher cannot", async () => {
    as(fx.adminUserId);
    const bonus = await adjust({ amountMinor: 3000, category: "BONUS", reason: "Extra class" });
    const first = await reverse(bonus.body.data.id, "Entered twice by mistake");
    expect(first.status).toBe(201);
    const opposite = await prisma.payrollLedger.findUniqueOrThrow({ where: { id: first.body.data.id } });
    expect(opposite).toMatchObject({ amountMinor: -3000, adjustmentCategory: "BONUS", entryType: "ADMIN_ADJUSTMENT" });
    expect(opposite.reason).toContain("Entered twice by mistake");
    const again = await reverse(bonus.body.data.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ALREADY_REVERSED");
    for (const userId of [fx.supervisorUserId, fx.teacherUserId]) {
      as(userId);
      const other = await adjust({ amountMinor: 100, category: "BONUS" });
      expect(other.status).toBe(403);
      expect((await reverse(bonus.body.data.id)).status).toBe(403);
    }
  });

  it("DB-04: the list filters by category; an approved-overtime row (report_id) counts as OVERTIME; the teacher sees only their own entries with the reason; the Supervisor is refused", async () => {
    const end = new Date(Date.now() - 60 * 60 * 1000);
    const session = await prisma.session.create({
      data: {
        academyId: fx.academyId, teacherId: fx.teacherProfileId, subjectId: fx.subjectId, sessionType: "PRIVATE",
        scheduledStart: new Date(end.getTime() - 60 * 60 * 1000), scheduledEnd: end, durationMinutes: 60, timezone: "Africa/Cairo",
        zoomJoinUrl: "https://zoom.us/j/345678901234", createdById: fx.adminUserId, status: "COMPLETED",
        students: { create: [{ studentId: fx.studentProfileIds.student1 }] },
      },
    });
    const report = await prisma.report.create({
      data: { academyId: fx.academyId, sessionId: session.id, studentId: fx.studentProfileIds.student1, teacherId: fx.teacherProfileId, reportType: "SESSION_COMPLETION_REPORT", status: "APPROVED", attendanceOutcome: "ATTENDED", classRemark: "demo_test", summary: "demo_test", homework: "demo_test" },
    });
    await prisma.payrollLedger.create({ data: { academyId: fx.academyId, teacherId: fx.teacherProfileId, reportId: report.id, entryType: "ADMIN_ADJUSTMENT", amountMinor: 700, currency: "EGP", reason: "Approved overtime", createdById: fx.adminUserId } });
    await prisma.payrollLedger.create({ data: { academyId: fx.academyId, teacherId: fx.teacher2ProfileId, entryType: "ADMIN_ADJUSTMENT", amountMinor: 900, currency: "EGP", reason: "Other teacher", createdById: fx.adminUserId, adjustmentCategory: "BONUS" } });

    as(fx.adminUserId);
    const overtime = await list("?category=OVERTIME");
    expect(overtime.entries.length).toBeGreaterThan(0);
    expect(overtime.entries.every((entry) => entry.category === "OVERTIME")).toBe(true);
    expect(overtime.entries.some((entry) => entry.amountMinor === 700)).toBe(true);

    as(fx.teacherUserId);
    const mine = await list();
    expect(mine.status).toBe(200);
    expect(mine.entries.some((entry) => entry.reason === "Late three times")).toBe(true);
    expect(mine.entries.some((entry) => entry.reason === "Other teacher")).toBe(false);
    expect(mine.entries.every((entry) => entry.reversible === false)).toBe(true);

    as(fx.supervisorUserId);
    expect((await list()).status).toBe(403);
  });

  it("DB-05: the database refuses a category on a non-adjustment row and an unknown category", async () => {
    const base = { academyId: fx.academyId, teacherId: fx.teacherProfileId, currency: "EGP", createdById: fx.adminUserId };
    await expect(prisma.payrollLedger.create({ data: { ...base, entryType: "DISBURSEMENT", amountMinor: -100, adjustmentCategory: "BONUS" } })).rejects.toThrow();
    await expect(prisma.payrollLedger.create({ data: { ...base, entryType: "ADMIN_ADJUSTMENT", amountMinor: 100, adjustmentCategory: "GIFT" } })).rejects.toThrow();
  });

  it("DB-06: the notice is in-app only — the worker never sends it by WhatsApp; it shows in the teacher's inbox, never the Supervisor's", async () => {
    fakeMessaging.reset();
    await processDueNotificationJobs(new Date(), fx.academyId);
    expect(fakeMessaging.sent.filter((record) => record.userId === fx.teacherUserId)).toHaveLength(0);
    const teacher = await prisma.user.findUniqueOrThrow({ where: { id: fx.teacherUserId }, select: { id: true, role: true, academyId: true } });
    expect((await getInbox(teacher as never)).some((item) => item.kind === "PAYROLL_ADJUSTMENT" && item.href === "/teacher/payroll")).toBe(true);
    const supervisor = await prisma.user.findUniqueOrThrow({ where: { id: fx.supervisorUserId }, select: { id: true, role: true, academyId: true } });
    expect((await getInbox(supervisor as never)).some((item) => item.kind === "PAYROLL_ADJUSTMENT")).toBe(false);
  });
});
