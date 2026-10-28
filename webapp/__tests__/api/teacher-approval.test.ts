jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { getServerSession } from "next-auth";

import { POST as profilesRoute } from "../../app/api/admin/profiles/route";
import { PATCH as patchProfileRoute } from "../../app/api/admin/profiles/[id]/route";
import { POST as approveRoute } from "../../app/api/admin/teachers/[id]/approve/route";
import { POST as assignmentsRoute } from "../../app/api/admin/assignments/route";
import { resolveParticipants } from "../../lib/scheduling/checks";
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
 * S-02 (D9, D10, D38): the Admin adds a teacher WITH a rate (approved, active); a
 * Supervisor adds one WITHOUT a rate → PENDING, inactive (cannot log in), the Admin
 * is told; scheduling and assignments refuse a PENDING teacher; the Admin approves
 * (sets the rate, activates, sends fresh credentials). A minor student needs a
 * guardian (server-enforced). Per-run test academy; fake messaging provider.
 */
jest.setTimeout(240_000);

const getServerSessionMock = getServerSession as jest.Mock;
let fx: SessionFixtures;
let counter = 0;

const as = (userId: string) => getServerSessionMock.mockResolvedValue({ user: { id: userId } });
const json = (body: unknown) => ({ method: "POST", headers: sameOriginHeaders({ "content-type": "application/json" }), body: JSON.stringify(body) });
const createProfile = (type: string, body: unknown) => profilesRoute(new Request(`http://localhost:3000/api/admin/profiles?type=${type}`, json(body)));
const approve = (teacherId: string, body: unknown) =>
  approveRoute(new Request(`http://localhost:3000/api/admin/teachers/${teacherId}/approve`, json(body)), { params: Promise.resolve({ id: teacherId }) });
const account = (role: string) => {
  counter += 1;
  return { username: `demo_test_${role}_${fx.suffix}_${counter}`, displayName: `Demo Test ${role} ${counter}`, password: "Demo-Test-Pass-1!", phone: "+201000000099" };
};
const RATE = { hourlyRateMinor: 15000, currency: "EGP", effectiveFrom: "2026-10-01T00:00:00.000Z" };

async function teacherByUsername(username: string) {
  return prisma.user.findFirstOrThrow({ where: { academyId: fx.academyId, username }, select: { id: true, isActive: true, mustChangePassword: true, teacherProfile: { select: { id: true, approvalStatus: true, approvedById: true, approvedAt: true, rates: true } } } });
}

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("S-02 teacher approval", () => {
  it("TCH-01: the Admin adds a teacher with a rate: APPROVED, active, the rate stored", async () => {
    as(fx.adminUserId);
    const input = { ...account("teacher"), rate: RATE };
    const response = await createProfile("teacher", input);
    expect(response.status).toBe(201);
    const teacher = await teacherByUsername(input.username);
    expect(teacher.isActive).toBe(true);
    expect(teacher.teacherProfile).toMatchObject({ approvalStatus: "APPROVED", approvedById: fx.adminUserId });
    expect(teacher.teacherProfile?.rates).toEqual([expect.objectContaining({ hourlyRateMinor: 15000, currency: "EGP" })]);
  });

  it("TCH-02: the Admin cannot add a teacher without a rate (D9)", async () => {
    as(fx.adminUserId);
    const response = await createProfile("teacher", account("teacher"));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("RATE_REQUIRED");
  });

  it("TCH-03: a Supervisor adds a teacher without a rate: PENDING, inactive, the Admin is told; a Supervisor sending a rate is refused", async () => {
    as(fx.supervisorUserId);
    const refused = await createProfile("teacher", { ...account("teacher"), rate: RATE });
    expect(refused.status).toBe(403);
    const input = account("teacher");
    expect((await createProfile("teacher", input)).status).toBe(201);
    const teacher = await teacherByUsername(input.username);
    expect(teacher.isActive).toBe(false);
    expect(teacher.teacherProfile).toMatchObject({ approvalStatus: "PENDING", approvedById: null, rates: [] });
    const notices = await prisma.notificationJob.findMany({ where: { academyId: fx.academyId, kind: "TEACHER_PENDING_APPROVAL" } });
    expect(notices.map((job) => job.recipientUserId)).toEqual([fx.adminUserId]);
    expect(JSON.stringify(notices[0].payload)).not.toMatch(/password|\+20/i);
  });

  it("TCH-04: scheduling and assignments refuse a PENDING teacher", async () => {
    as(fx.supervisorUserId);
    const input = account("teacher");
    await createProfile("teacher", input);
    const teacher = await teacherByUsername(input.username);
    const teacherId = teacher.teacherProfile!.id;
    await prisma.teacherSubject.create({ data: { academyId: fx.academyId, teacherId, subjectId: fx.subjectId } });
    await expect(
      prisma.$transaction((tx) => resolveParticipants(tx, { academyId: fx.academyId, teacherId, subjectId: fx.subjectId, studentIds: [fx.studentProfileIds.student1] })),
    ).rejects.toMatchObject({ code: "TEACHER_PENDING_APPROVAL" });
    as(fx.adminUserId);
    const assignment = await assignmentsRoute(new Request("http://localhost:3000/api/admin/assignments", json({ studentId: fx.studentProfileIds.student1, teacherId, subjectId: fx.subjectId })));
    expect([404, 409]).toContain(assignment.status);
  });

  it("TCH-05: the Admin approves: rate set, APPROVED by the Admin, user active with a fresh temporary password sent; approving twice is 409", async () => {
    as(fx.supervisorUserId);
    const input = account("teacher");
    await createProfile("teacher", input);
    const before = await prisma.user.findFirstOrThrow({ where: { academyId: fx.academyId, username: input.username }, select: { passwordHash: true } });
    const teacherId = (await teacherByUsername(input.username)).teacherProfile!.id;
    fakeMessaging.reset();
    as(fx.adminUserId);
    const response = await approve(teacherId, { rate: RATE });
    expect(response.status).toBe(200);
    const after = await teacherByUsername(input.username);
    expect(after).toMatchObject({ isActive: true, mustChangePassword: true });
    expect(after.teacherProfile).toMatchObject({ approvalStatus: "APPROVED", approvedById: fx.adminUserId });
    expect(after.teacherProfile?.approvedAt).not.toBeNull();
    expect(after.teacherProfile?.rates).toHaveLength(1);
    const hash = await prisma.user.findUniqueOrThrow({ where: { id: after.id }, select: { passwordHash: true } });
    expect(hash.passwordHash).not.toBe(before.passwordHash);
    expect(fakeMessaging.sent.filter((record) => record.kind === "credentials" && record.userId === after.id)).toHaveLength(1);
    expect(JSON.stringify(await response.json())).not.toMatch(/password|tempPassword/i);
    expect((await approve(teacherId, { rate: RATE })).status).toBe(409);
  });

  it("TCH-06: only the Admin approves, a rate is required, other academies are invisible, cross-origin is 403", async () => {
    as(fx.supervisorUserId);
    const input = account("teacher");
    await createProfile("teacher", input);
    const teacherId = (await teacherByUsername(input.username)).teacherProfile!.id;
    expect((await approve(teacherId, { rate: RATE })).status).toBe(403);
    as(fx.adminUserId);
    expect((await approve(teacherId, {})).status).toBe(400);
    as(fx.foreignAdminUserId);
    expect((await approve(teacherId, { rate: RATE })).status).toBe(404);
    as(fx.adminUserId);
    const crossOrigin = await approveRoute(
      new Request(`http://localhost:3000/api/admin/teachers/${teacherId}/approve`, { method: "POST", headers: { origin: "https://evil.example", host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ rate: RATE }) }),
      { params: Promise.resolve({ id: teacherId }) },
    );
    expect(crossOrigin.status).toBe(403);
    expect((await teacherByUsername(input.username)).teacherProfile?.approvalStatus).toBe("PENDING");
  });

  it("TCH-07: a PENDING teacher cannot be switched on through the profile edit (only approval activates)", async () => {
    as(fx.supervisorUserId);
    const input = account("teacher");
    await createProfile("teacher", input);
    const teacher = await teacherByUsername(input.username);
    for (const userId of [fx.supervisorUserId, fx.adminUserId]) {
      as(userId);
      const response = await patchProfileRoute(
        new Request(`http://localhost:3000/api/admin/profiles/${teacher.id}`, { method: "PATCH", headers: sameOriginHeaders({ "content-type": "application/json" }), body: JSON.stringify({ isActive: true }) }),
        { params: Promise.resolve({ id: teacher.id }) },
      );
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe("TEACHER_PENDING_APPROVAL");
    }
    expect((await teacherByUsername(input.username)).isActive).toBe(false);
  });
});

describe("D10 a minor needs a guardian", () => {
  it("STU-G-01: a minor student without a guardian is refused (Admin and Supervisor); an adult without one is allowed", async () => {
    for (const userId of [fx.adminUserId, fx.supervisorUserId]) {
      as(userId);
      const minor = await createProfile("student", { ...account("student"), isAdult: false });
      expect(minor.status).toBe(400);
      expect((await minor.json()).error.code).toBe("GUARDIAN_REQUIRED");
    }
    as(fx.adminUserId);
    expect((await createProfile("student", { ...account("student"), isAdult: true })).status).toBe(201);
  });

  it("STU-G-02: a minor with a guardian of this academy is created", async () => {
    as(fx.supervisorUserId);
    const response = await createProfile("student", { ...account("student"), isAdult: false, guardianId: fx.guardianProfileId });
    expect(response.status).toBe(201);
  });
});
