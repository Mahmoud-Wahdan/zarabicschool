jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { getServerSession } from "next-auth";

import { GET as candidatesRoute } from "../../app/api/admin/enrollments/route";
import { POST as createSessionRoute } from "../../app/api/sessions/route";
import { prisma } from "../../lib/prisma";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * Enrollments page (owner, 2026-10-30): after the Admin picks a session, the page asks
 * for THAT session's students only — who is enrolled (can be removed) and who can be
 * added (an ACTIVE assignment to the session's teacher and subject, active account,
 * not already enrolled). ADMIN and SUPERVISOR; names only. Per-run test academy only.
 */
jest.setTimeout(180_000);

const getServerSessionMock = getServerSession as jest.Mock;
const as = (userId: string) => getServerSessionMock.mockResolvedValue({ user: { id: userId } });
let fx: SessionFixtures;
let groupId: string;

const get = (sessionId: string) => candidatesRoute(new Request(`http://localhost:3000/api/admin/enrollments?sessionId=${sessionId}`));

beforeAll(async () => {
  fx = await createSessionFixtures();
  const subscription = await prisma.subscription.create({
    data: { academyId: fx.academyId, studentId: fx.studentProfileIds.student1, packageType: "PAY_PER_SESSION", sessionsPurchased: 2, totalAmountMinor: BigInt(100000), currency: "EGP", status: "ACTIVE" },
  });
  const invoice = await prisma.invoice.create({
    data: { academyId: fx.academyId, studentId: fx.studentProfileIds.student1, subscriptionId: subscription.id, amountMinor: BigInt(100000), currency: "EGP", provider: "PAYMOB", packageType: "PAY_PER_SESSION", sessionsPurchased: 2, status: "PAID", paidAt: new Date() },
  });
  await prisma.subscriptionLedger.create({ data: { academyId: fx.academyId, subscriptionId: subscription.id, invoiceId: invoice.id, entryType: "INITIAL_PURCHASE", sessionsDelta: 2 } });
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 20);
  start.setUTCHours(9, 0, 0, 0);
  as(fx.adminUserId);
  const created = await createSessionRoute(new Request("http://localhost:3000/api/sessions", {
    method: "POST",
    headers: sameOriginHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      teacherId: fx.teacherProfileId, subjectId: fx.subjectId, sessionType: "GROUP", timezone: "Africa/Cairo", zoomJoinUrl: "https://zoom.us/j/111222333444",
      studentIds: [fx.studentProfileIds.student1], scheduledStart: start.toISOString(), scheduledEnd: new Date(start.getTime() + 3_600_000).toISOString(),
    }),
  }));
  expect(created.status).toBe(201);
  groupId = (await created.json()).data.id;
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("GET /api/admin/enrollments?sessionId= — the chosen session's students only", () => {
  it("EC-01: enrolled = the session's students; available = assigned to its teacher and subject, not enrolled", async () => {
    as(fx.adminUserId);
    const response = await get(groupId);
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.enrolled.map((row: { id: string }) => row.id)).toEqual([fx.studentProfileIds.student1]);
    const available = new Set(data.available.map((row: { id: string }) => row.id));
    for (const key of ["student2", "student3", "student4", "student5", "student6", "student7", "student8"]) {
      expect(available.has(fx.studentProfileIds[key])).toBe(true);
    }
    // Enrolled already, another teacher's student, unassigned students, another academy: never offered.
    for (const id of [fx.studentProfileIds.student1, fx.studentProfileIds.student9, fx.studentProfileIds.student10, fx.studentProfileIds.student11, fx.foreignStudentProfileId]) {
      expect(available.has(id)).toBe(false);
    }
    // Names only: no phone, email or money field.
    expect(Object.keys(data.enrolled[0]).sort()).toEqual(["displayName", "id"]);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("EC-02: an inactive account or an ended assignment is not offered", async () => {
    await prisma.user.update({ where: { id: fx.studentUserIds.student2 }, data: { isActive: false } });
    await prisma.studentTeacherAssignment.updateMany({ where: { studentId: fx.studentProfileIds.student3, teacherId: fx.teacherProfileId }, data: { status: "ENDED", endedAt: new Date() } });
    as(fx.adminUserId);
    const ids = new Set((await (await get(groupId)).json()).data.available.map((row: { id: string }) => row.id));
    expect(ids.has(fx.studentProfileIds.student2)).toBe(false);
    expect(ids.has(fx.studentProfileIds.student3)).toBe(false);
    expect(ids.has(fx.studentProfileIds.student4)).toBe(true);
  });

  it("EC-03: the Supervisor may read it; a teacher gets 403; another academy's session 404; a bad id 400", async () => {
    as(fx.supervisorUserId);
    expect((await get(groupId)).status).toBe(200);
    as(fx.teacherUserId);
    expect((await get(groupId)).status).toBe(403);
    as(fx.foreignAdminUserId);
    expect((await get(groupId)).status).toBe(404);
    as(fx.adminUserId);
    expect((await get("not-a-uuid")).status).toBe(400);
  });
});
