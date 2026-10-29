jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { randomUUID } from "node:crypto";

import { getServerSession } from "next-auth";

import { DELETE as removeRoute, POST as addRoute } from "../../app/api/admin/enrollments/route";
import { POST as complaintRoute } from "../../app/api/complaints/route";
import { complaintRoster } from "../../lib/complaints/service";
import { reserveCredit } from "../../lib/credits/reserve-credit";
import { prisma } from "../../lib/prisma";
import { composeJobMessage } from "../../lib/worker/notifications";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  writeInitialPurchase,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * S-07 roster changes (D18, D16; owner approved Q1–Q2 as shown, 2026-10-29). Admin or
 * Supervisor removes a student from a GROUP session under a session lock: the
 * reservation is released (credit back, no ledger row). Refused for a PRIVATE session
 * (cancel it instead), once the student has a SUBMITTED/APPROVED report, once
 * attendance used the credit (CONSUMED), and when the session is not SCHEDULED.
 * Removing the last student is allowed (owner answer B). The removed student — and
 * the guardian when no other child stays — is told in-app + WhatsApp; their pending
 * reminders for that session are cancelled. Adding to a PRIVATE session that already
 * has a student is refused. Per-run test academy only.
 */
jest.setTimeout(240_000);

const getServerSessionMock = getServerSession as jest.Mock;
let fx: SessionFixtures;
const HOUR = 3_600_000;

const as = (userId: string) => getServerSessionMock.mockResolvedValue({ user: { id: userId } });
async function remove(sessionId: string, studentId: string, headers = sameOriginHeaders({ "content-type": "application/json" })) {
  const response = await removeRoute(new Request("http://localhost:3000/api/admin/enrollments", { method: "DELETE", headers, body: JSON.stringify({ sessionId, studentId }) }));
  return { status: response.status, body: await response.json() };
}
async function add(sessionId: string, studentId: string) {
  const response = await addRoute(new Request("http://localhost:3000/api/admin/enrollments", { method: "POST", headers: sameOriginHeaders({ "content-type": "application/json" }), body: JSON.stringify({ sessionId, studentId }) }));
  return { status: response.status, body: await response.json() };
}

async function credit(studentKey: string, sessions = 4) {
  const sub = await prisma.subscription.create({
    data: { academyId: fx.academyId, studentId: fx.studentProfileIds[studentKey], packageType: "PAY_PER_SESSION", sessionsPurchased: sessions, totalAmountMinor: BigInt(40000), currency: "EGP", status: "ACTIVE" },
  });
  await writeInitialPurchase({ academyId: fx.academyId, subscriptionId: sub.id, sessionsDelta: sessions });
  return sub;
}

/** A future session with these students on the roster, each holding one RESERVED credit. */
async function session(type: "GROUP" | "PRIVATE", studentKeys: string[], status: "SCHEDULED" | "COMPLETED" = "SCHEDULED", startInMs = 2 * 24 * HOUR) {
  const start = new Date(Date.now() + startInMs);
  const row = await prisma.session.create({
    data: {
      academyId: fx.academyId, teacherId: fx.teacherProfileId, subjectId: fx.subjectId, sessionType: type,
      scheduledStart: start, scheduledEnd: new Date(start.getTime() + HOUR), durationMinutes: 60, timezone: "Africa/Cairo",
      zoomJoinUrl: "https://zoom.us/j/345678901234", createdById: fx.adminUserId, status,
      students: { create: studentKeys.map((key) => ({ studentId: fx.studentProfileIds[key] })) },
    },
  });
  for (const key of studentKeys) {
    await prisma.$transaction((tx) => reserveCredit(tx, fx.academyId, fx.studentProfileIds[key], row.id, start));
  }
  return row;
}
const reservation = (sessionId: string, studentKey: string) => prisma.sessionReservation.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId, studentId: fx.studentProfileIds[studentKey] } } });

beforeAll(async () => {
  fx = await createSessionFixtures();
  for (const key of ["student1", "student2", "student3", "student4", "student5", "student6", "student7"]) await credit(key);
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("S-07 roster changes", () => {
  it("RC-01: the Admin removes a student from a GROUP session: off the roster, reservation RELEASED, no ledger row", async () => {
    const group = await session("GROUP", ["student1", "student2"]);
    const ledgerBefore = await prisma.subscriptionLedger.count({ where: { academyId: fx.academyId } });
    as(fx.adminUserId);
    const result = await remove(group.id, fx.studentProfileIds.student1);
    expect(result.status).toBe(200);
    expect(await prisma.sessionStudent.count({ where: { sessionId: group.id } })).toBe(1);
    expect((await reservation(group.id, "student1")).status).toBe("RELEASED");
    expect((await reservation(group.id, "student2")).status).toBe("RESERVED");
    expect(await prisma.subscriptionLedger.count({ where: { academyId: fx.academyId } })).toBe(ledgerBefore);
  });

  it("RC-02: a PRIVATE session is cancelled instead (409); adding a second student to a PRIVATE session is refused", async () => {
    const privateSession = await session("PRIVATE", ["student3"]);
    as(fx.supervisorUserId);
    const removal = await remove(privateSession.id, fx.studentProfileIds.student3);
    expect(removal.status).toBe(409);
    expect(removal.body.error.code).toBe("PRIVATE_SESSION_CANCEL_INSTEAD");
    const full = await add(privateSession.id, fx.studentProfileIds.student4);
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe("PRIVATE_SESSION_FULL");
    expect(await prisma.sessionStudent.count({ where: { sessionId: privateSession.id } })).toBe(1);
  });

  it("RC-03: blocked once the student has a SUBMITTED or APPROVED report", async () => {
    const group = await session("GROUP", ["student4", "student5"]);
    for (const [key, status] of [["student4", "SUBMITTED"], ["student5", "APPROVED"]] as const) {
      await prisma.report.create({
        data: { academyId: fx.academyId, sessionId: group.id, studentId: fx.studentProfileIds[key], teacherId: fx.teacherProfileId, reportType: "SESSION_COMPLETION_REPORT", status, attendanceOutcome: "ATTENDED", classRemark: "demo_test", summary: "demo_test", homework: "demo_test" },
      });
      as(fx.adminUserId);
      const result = await remove(group.id, fx.studentProfileIds[key]);
      expect(result.status).toBe(409);
      expect(result.body.error.code).toBe("REPORT_EXISTS");
    }
  });

  it("RC-04: blocked once attendance used the credit (reservation CONSUMED)", async () => {
    const group = await session("GROUP", ["student6"]);
    await prisma.sessionReservation.update({ where: { id: (await reservation(group.id, "student6")).id }, data: { status: "CONSUMED" } });
    as(fx.adminUserId);
    const result = await remove(group.id, fx.studentProfileIds.student6);
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("ATTENDANCE_SETTLED");
  });

  it("RC-05: removing the last student of a GROUP session is allowed (owner answer B)", async () => {
    const group = await session("GROUP", ["student7"]);
    as(fx.adminUserId);
    expect((await remove(group.id, fx.studentProfileIds.student7)).status).toBe(200);
    expect(await prisma.sessionStudent.count({ where: { sessionId: group.id } })).toBe(0);
  });

  it("RC-06: a session that is not SCHEDULED is refused; another academy, a teacher and cross-origin too", async () => {
    const done = await session("GROUP", ["student2"], "COMPLETED");
    as(fx.adminUserId);
    const finished = await remove(done.id, fx.studentProfileIds.student2);
    expect(finished.status).toBe(409);
    expect(finished.body.error.code).toBe("SESSION_NOT_SCHEDULED");
    const group = await session("GROUP", ["student2", "student3"]);
    as(fx.foreignAdminUserId);
    expect((await remove(group.id, fx.studentProfileIds.student2)).status).toBe(404);
    as(fx.teacherUserId);
    expect((await remove(group.id, fx.studentProfileIds.student2)).status).toBe(403);
    as(fx.adminUserId);
    expect((await remove(group.id, fx.studentProfileIds.student2, { origin: "https://evil.example", host: "localhost:3000", "content-type": "application/json" })).status).toBe(403);
    expect((await remove(group.id, randomUUID())).status).toBe(404);
    expect(await prisma.sessionStudent.count({ where: { sessionId: group.id } })).toBe(2);
  });

  it("RC-07: two removals at the same time: one succeeds, the other finds nothing; the reservation is released once", async () => {
    const group = await session("GROUP", ["student4", "student5"]);
    as(fx.adminUserId);
    const results = await Promise.all([remove(group.id, fx.studentProfileIds.student4), remove(group.id, fx.studentProfileIds.student4)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 404]);
    expect((await reservation(group.id, "student4")).status).toBe("RELEASED");
  });

  it("RC-08: the removed student's guardian is told (in-app + WhatsApp, no link) only when no other child stays; pending reminders for that session are cancelled", async () => {
    const group = await session("GROUP", ["student6", "student7"]);
    const reminder = await prisma.notificationJob.create({
      data: { academyId: fx.academyId, sessionId: group.id, recipientUserId: fx.guardianUserId, kind: "SESSION_REMINDER", dedupKey: `TEST_REMINDER:${group.id}`, scheduledFor: new Date(Date.now() + HOUR) },
    });
    as(fx.adminUserId);
    await remove(group.id, fx.studentProfileIds.student6);
    // student7 (same guardian) is still on the roster: the guardian keeps the reminder, gets the removal notice.
    expect((await prisma.notificationJob.findUniqueOrThrow({ where: { id: reminder.id } })).status).toBe("PENDING");
    const notices = await prisma.notificationJob.findMany({ where: { sessionId: group.id, kind: "ROSTER_REMOVED" } });
    expect(notices.map((job) => job.recipientUserId).sort()).toEqual([fx.guardianUserId, fx.studentUserIds.student6].sort());
    expect(notices.every((job) => job.status === "PENDING")).toBe(true);
    await remove(group.id, fx.studentProfileIds.student7);
    expect((await prisma.notificationJob.findUniqueOrThrow({ where: { id: reminder.id } })).status).toBe("CANCELLED");
    const full = await prisma.notificationJob.findFirstOrThrow({ where: { sessionId: group.id, kind: "ROSTER_REMOVED", recipientUserId: fx.guardianUserId }, include: { session: { include: { subject: true } } } });
    const message = composeJobMessage({ ...full, recipientUser: { id: fx.guardianUserId, phone: null, isActive: true, preferredLanguage: "en", timezone: "Africa/Cairo" } } as never);
    expect(message).toMatch(/removed/i);
    expect(message).not.toMatch(/https?:\/\//);
  });
  it("RC-09 (D41, SQL S-9): a complaint keeps the roster of the moment it was filed, even after a later removal", async () => {
    const group = await session("GROUP", ["student1", "student3"], "SCHEDULED", -30 * 60_000);
    as(fx.teacherUserId);
    const filed = await complaintRoute(new Request("http://localhost:3000/api/complaints", {
      method: "POST", headers: sameOriginHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ sessionId: group.id, concernedUserId: fx.studentUserIds.student3, category: "BEHAVIOUR", title: "demo_test complaint", body: "demo_test body text" }),
    }));
    expect(filed.status).toBe(201);
    const complaint = await prisma.complaint.findFirstOrThrow({ where: { sessionId: group.id } });
    expect([...complaint.rosterStudentIds].sort()).toEqual([fx.studentProfileIds.student1, fx.studentProfileIds.student3].sort());
    as(fx.adminUserId);
    expect((await remove(group.id, fx.studentProfileIds.student3)).status).toBe(200);
    const roster = await complaintRoster(fx.academyId, { sessionId: group.id, rosterStudentIds: complaint.rosterStudentIds });
    expect(roster.map((row) => row.studentId).sort()).toEqual([fx.studentProfileIds.student1, fx.studentProfileIds.student3].sort());
    // An older complaint without a snapshot shows the current roster.
    const current = await complaintRoster(fx.academyId, { sessionId: group.id, rosterStudentIds: [] });
    expect(current.map((row) => row.studentId)).toEqual([fx.studentProfileIds.student1]);
  });
});
