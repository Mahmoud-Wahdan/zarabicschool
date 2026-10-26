jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { getServerSession } from "next-auth";

import { POST as fileComplaintRoute } from "../../app/api/complaints/route";
import { PATCH as handleComplaintRoute } from "../../app/api/complaints/[id]/route";
import { GET as complaintPartiesRoute } from "../../app/api/complaints/parties/route";
import { GET as evaluationsGetRoute, POST as evaluationsPostRoute } from "../../app/api/sessions/[id]/evaluations/route";
import { prisma } from "../../lib/prisma";
import { getClickTimelines } from "../../lib/sessions/click-timeline";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * Phase 8 priority visibility rules (owner, 2026-10-26), real dev DB, per-run test
 * academy only:
 *  - complaints: the concerned party never sees, handles or is notified of one;
 *    students/guardians never see other families' names;
 *  - evaluations: the teacher never sees them;
 *  - link click timeline: Admin/Supervisor only.
 */
jest.setTimeout(180_000);

const getServerSessionMock = getServerSession as jest.Mock;
let fx: SessionFixtures;
let otherFamilyStudentId: string;
let otherFamilyUserId: string;

function asActor(userId: string | null) {
  getServerSessionMock.mockResolvedValue(userId ? { user: { id: userId } } : null);
}

function json(pathName: string, method: string, body?: unknown) {
  return new Request(`http://localhost:3000${pathName}`, {
    method,
    headers: sameOriginHeaders(body === undefined ? undefined : { "content-type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function pastSession(studentProfileIds: string[]) {
  const end = new Date(Date.now() - 30 * 60 * 1000);
  return prisma.session.create({
    data: {
      academyId: fx.academyId,
      teacherId: fx.teacherProfileId,
      subjectId: fx.subjectId,
      sessionType: studentProfileIds.length > 1 ? "GROUP" : "PRIVATE",
      scheduledStart: new Date(end.getTime() - 60 * 60 * 1000),
      scheduledEnd: end,
      durationMinutes: 60,
      timezone: "Africa/Cairo",
      zoomJoinUrl: "https://zoom.us/j/345678901234",
      createdById: fx.adminUserId,
      status: "COMPLETED",
      students: { create: studentProfileIds.map((studentId) => ({ studentId })) },
    },
    select: { id: true },
  });
}

async function fileComplaint(actorId: string, body: Record<string, unknown>) {
  asActor(actorId);
  const response = await fileComplaintRoute(json("/api/complaints", "POST", body));
  return { status: response.status, body: await response.json() };
}

async function parties(actorId: string, sessionId: string) {
  asActor(actorId);
  const response = await complaintPartiesRoute(json(`/api/complaints/parties?sessionId=${sessionId}`, "GET"));
  return { status: response.status, body: await response.json() };
}

async function handle(actorId: string, complaintId: string, body: Record<string, unknown>) {
  asActor(actorId);
  const response = await handleComplaintRoute(json(`/api/complaints/${complaintId}`, "PATCH", body), {
    params: Promise.resolve({ id: complaintId }),
  });
  return { status: response.status, body: await response.json() };
}

const complaintBody = (sessionId: string, concernedUserId: string) => ({
  sessionId,
  concernedUserId,
  category: "BEHAVIOUR",
  title: "Demo test complaint",
  body: "Demo test complaint text.",
});

beforeAll(async () => {
  fx = await createSessionFixtures();
  // A SECOND family: an adult student without a guardian (every fixture student
  // shares the one fixture guardian).
  const suffix = randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: {
      academyId: fx.academyId,
      username: `demo_test_otherfamily_${suffix}`,
      displayName: "Demo Test other family",
      passwordHash: "x",
      role: "STUDENT",
      phone: "+201000000098",
      timezone: "Africa/Cairo",
      isActive: true,
      mustChangePassword: false,
    },
    select: { id: true },
  });
  const student = await prisma.student.create({
    data: { userId: user.id, academyId: fx.academyId, isAdult: true, enrollmentDate: new Date() },
    select: { id: true },
  });
  otherFamilyUserId = user.id;
  otherFamilyStudentId = student.id;
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("Complaints — the concerned party never sees or handles a complaint", () => {
  it("CP-01: a student files about the teacher; the response carries no complaint data and nobody is notified", async () => {
    const session = await pastSession([fx.studentProfileIds.student1]);
    const jobsBefore = await prisma.notificationJob.count({ where: { academyId: fx.academyId } });
    const filed = await fileComplaint(fx.studentUserIds.student1, complaintBody(session.id, fx.teacherUserId));
    expect(filed.status).toBe(201);
    expect(filed.body).toEqual({ data: { received: true } });
    const row = await prisma.complaint.findFirstOrThrow({ where: { sessionId: session.id } });
    expect(row.concernedUserId).toBe(fx.teacherUserId);
    expect(row.status).toBe("NEW");
    expect(await prisma.notificationJob.count({ where: { academyId: fx.academyId } })).toBe(jobsBefore);
  });

  it("CP-03: the concerned teacher, the filer, a student and a guardian can never handle it; Supervisor and Admin can; still no notification", async () => {
    const session = await pastSession([fx.studentProfileIds.student2]);
    await fileComplaint(fx.studentUserIds.student2, complaintBody(session.id, fx.teacherUserId));
    const complaint = await prisma.complaint.findFirstOrThrow({ where: { sessionId: session.id } });
    for (const actor of [fx.teacherUserId, fx.studentUserIds.student2, fx.guardianUserId]) {
      expect((await handle(actor, complaint.id, { action: "START" })).status).toBe(403);
    }
    const jobsBefore = await prisma.notificationJob.count({ where: { academyId: fx.academyId } });
    expect((await handle(fx.supervisorUserId, complaint.id, { action: "START" })).status).toBe(200);
    expect((await handle(fx.adminUserId, complaint.id, { action: "RESOLVE", resolutionNote: "Talked to both sides." })).status).toBe(200);
    expect(await prisma.notificationJob.count({ where: { academyId: fx.academyId } })).toBe(jobsBefore);
    expect((await prisma.complaint.findUniqueOrThrow({ where: { id: complaint.id } })).status).toBe("RESOLVED");
  });

  it("CP-05: an Admin of another academy gets 404 (no existence leak)", async () => {
    const session = await pastSession([fx.studentProfileIds.student3]);
    await fileComplaint(fx.studentUserIds.student3, complaintBody(session.id, fx.teacherUserId));
    const complaint = await prisma.complaint.findFirstOrThrow({ where: { sessionId: session.id } });
    expect((await handle(fx.foreignAdminUserId, complaint.id, { action: "START" })).status).toBe(404);
  });

  it("CP-07: a student never sees another family's names — only the teacher, plus an unnamed 'another participant' flag", async () => {
    const group = await pastSession([fx.studentProfileIds.student4, otherFamilyStudentId]);
    const { status, body } = await parties(fx.studentUserIds.student4, group.id);
    expect(status).toBe(200);
    expect(body.data.parties.map((party: { role: string }) => party.role)).toEqual(["TEACHER"]);
    expect(body.data.otherParticipant).toBe(true);
    expect(JSON.stringify(body)).not.toContain(otherFamilyUserId);
    expect(JSON.stringify(body)).not.toContain("other family");
  });

  it("CP-06: 'another participant' is stored unnamed when offered, refused when the session has only the filer's family, and naming a classmate is refused", async () => {
    const group = await pastSession([fx.studentProfileIds.student5, otherFamilyStudentId]);
    const unnamed = await fileComplaint(fx.studentUserIds.student5, complaintBody(group.id, "OTHER_PARTICIPANT"));
    expect(unnamed.status).toBe(201);
    const row = await prisma.complaint.findFirstOrThrow({ where: { sessionId: group.id } });
    expect(row.concernedUserId).toBeNull();
    expect(row.concernedRole).toBeNull();

    const named = await fileComplaint(fx.studentUserIds.student5, complaintBody(group.id, otherFamilyUserId));
    expect(named.status).toBe(400);

    // Same family only (two siblings with one guardian): no other family → not offered.
    const siblings = await pastSession([fx.studentProfileIds.student6, fx.studentProfileIds.student7]);
    expect((await parties(fx.studentUserIds.student6, siblings.id)).body.data.otherParticipant).toBe(false);
    expect((await fileComplaint(fx.studentUserIds.student6, complaintBody(siblings.id, "OTHER_PARTICIPANT"))).status).toBe(400);
  });

  it("CP-08: a filer who was not on the session gets 404", async () => {
    const session = await pastSession([fx.studentProfileIds.student8]);
    const result = await fileComplaint(otherFamilyUserId, complaintBody(session.id, fx.teacherUserId));
    expect(result.status).toBe(404);
  });
});

describe("Evaluations — the teacher never sees them", () => {
  it("EV-08: the session's teacher gets 403 on the evaluations API (read and write)", async () => {
    const session = await pastSession([fx.studentProfileIds.student9]);
    asActor(fx.teacherUserId);
    const read = await evaluationsGetRoute(json(`/api/sessions/${session.id}/evaluations`, "GET"), { params: Promise.resolve({ id: session.id }) });
    expect(read.status).toBe(403);
    asActor(fx.teacherUserId);
    const write = await evaluationsPostRoute(json(`/api/sessions/${session.id}/evaluations`, "POST", { rating: 5 }), { params: Promise.resolve({ id: session.id }) });
    expect(write.status).toBe(403);
  });

  it("EV-10: no page or API route that admits a TEACHER reads session evaluations (static guard)", () => {
    const appDir = path.join(process.cwd(), "app");
    const files = (function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((entry) => {
        const full = path.join(dir, entry);
        return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(entry) ? [full] : [];
      });
    })(appDir);
    const readers = files.filter((file) => /sessionEvaluation|getEvaluationsForSession/.test(readFileSync(file, "utf8")));
    expect(readers.length).toBeGreaterThan(0);
    for (const file of readers) {
      const source = readFileSync(file, "utf8");
      const relative = path.relative(appDir, file).split(path.sep).join("/");
      expect(relative.includes("/teacher/")).toBe(false);
      expect(/require(Api)?Roles?\(\s*\[?[^)\]]*"TEACHER"/.test(source)).toBe(false);
    }
  });
});

describe("Link click timeline — Admin and Supervisor only", () => {
  it("CT-01: operators get the clicks (no URL field); teacher, student, guardian and a foreign Admin get nothing", async () => {
    const session = await pastSession([fx.studentProfileIds.student10]);
    await prisma.sessionJoinClick.createMany({
      data: [
        { academyId: fx.academyId, sessionId: session.id, userId: fx.teacherUserId },
        { academyId: fx.academyId, sessionId: session.id, userId: fx.studentUserIds.student10 },
      ],
    });
    for (const role of ["ADMIN", "SUPERVISOR"]) {
      const entries = (await getClickTimelines({ role, academyId: fx.academyId }, [session.id])).get(session.id) ?? [];
      expect(entries).toHaveLength(2);
      const teacherEntry = entries.find((entry) => entry.userId === fx.teacherUserId);
      expect(teacherEntry?.isAssignedTeacher).toBe(true);
      expect(Object.keys(teacherEntry ?? {}).sort()).toEqual(["clickedAt", "displayName", "isAssignedTeacher", "minutesFromStart", "role", "userId"]);
      expect(JSON.stringify(entries)).not.toContain("zoom");
    }
    for (const role of ["TEACHER", "STUDENT", "GUARDIAN"]) {
      expect((await getClickTimelines({ role, academyId: fx.academyId }, [session.id])).size).toBe(0);
    }
    expect((await getClickTimelines({ role: "ADMIN", academyId: fx.foreignAcademyId }, [session.id])).size).toBe(0);
  });
});
