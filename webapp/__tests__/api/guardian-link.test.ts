jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { getServerSession } from "next-auth";

import { PATCH as patchProfileRoute } from "../../app/api/admin/profiles/[id]/route";
import { prisma } from "../../lib/prisma";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * B3 / D10 (review 2026-10-29): Admin and Supervisor may move a student to another
 * guardian of the same academy; nobody may leave a MINOR without a guardian (an adult
 * may be unlinked: they pay for themself). Per-run test academy.
 */
jest.setTimeout(120_000);

const getServerSessionMock = getServerSession as jest.Mock;
const as = (userId: string) => getServerSessionMock.mockResolvedValue({ user: { id: userId } });
let fx: SessionFixtures;
let otherGuardianId: string;
let foreignGuardianId: string;

const patch = (userId: string, body: unknown) =>
  patchProfileRoute(
    new Request(`http://localhost:3000/api/admin/profiles/${userId}`, { method: "PATCH", headers: sameOriginHeaders({ "content-type": "application/json" }), body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: userId }) },
  );
const guardianOf = async (studentUserId: string) =>
  (await prisma.student.findUniqueOrThrow({ where: { userId: studentUserId }, select: { guardianId: true } })).guardianId;

beforeAll(async () => {
  fx = await createSessionFixtures();
  const makeGuardian = async (academyId: string, key: string) => {
    const user = await prisma.user.create({ data: { academyId, username: `demo_test_${key}_${fx.suffix}`, displayName: `Demo Test ${key}`, passwordHash: "x", role: "GUARDIAN", isActive: true } });
    return (await prisma.guardian.create({ data: { academyId, userId: user.id, relationship: "FATHER" } })).id;
  };
  otherGuardianId = await makeGuardian(fx.academyId, "guardian_b");
  foreignGuardianId = await makeGuardian(fx.foreignAcademyId, "guardian_foreign");
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("B3 / D10 — a student's guardian", () => {
  it("GD-01: the Admin switches a minor to another guardian of the academy", async () => {
    as(fx.adminUserId);
    expect((await patch(fx.studentUserIds.student1, { guardianId: otherGuardianId })).status).toBe(200);
    expect(await guardianOf(fx.studentUserIds.student1)).toBe(otherGuardianId);
  });

  it("GD-02: the Supervisor switches a minor to another guardian of the academy", async () => {
    as(fx.supervisorUserId);
    expect((await patch(fx.studentUserIds.student2, { guardianId: otherGuardianId })).status).toBe(200);
    expect(await guardianOf(fx.studentUserIds.student2)).toBe(otherGuardianId);
  });

  it("GD-03: neither the Admin nor the Supervisor can remove a minor's guardian (409 GUARDIAN_REQUIRED)", async () => {
    for (const actor of [fx.adminUserId, fx.supervisorUserId]) {
      as(actor);
      const before = await guardianOf(fx.studentUserIds.student3);
      const response = await patch(fx.studentUserIds.student3, { guardianId: null });
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe("GUARDIAN_REQUIRED");
      expect(await guardianOf(fx.studentUserIds.student3)).toBe(before);
    }
  });

  it("GD-04: an adult student may be unlinked; a guardian of another academy is 404", async () => {
    await prisma.student.update({ where: { userId: fx.studentUserIds.student4 }, data: { isAdult: true } });
    as(fx.adminUserId);
    expect((await patch(fx.studentUserIds.student4, { guardianId: null })).status).toBe(200);
    expect(await guardianOf(fx.studentUserIds.student4)).toBeNull();
    expect((await patch(fx.studentUserIds.student5, { guardianId: foreignGuardianId })).status).toBe(404);
  });
});
