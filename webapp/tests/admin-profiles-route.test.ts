import { GET } from "../app/api/admin/profiles/route";
import { PATCH } from "../app/api/admin/profiles/[id]/route";
import { getStudentFinanceStatus } from "../lib/billing/student-finance-status";
import { requireApiRoles } from "../lib/dal";
import { isPhase7FollowupReady } from "../lib/phase7/readiness";
import { isSession1ReportsReady } from "../lib/reports/session1-ready";
import { prisma } from "../lib/prisma";

jest.mock("../lib/billing/student-finance-status", () => ({ getStudentFinanceStatus: jest.fn() }));
jest.mock("../lib/dal", () => ({ requireApiRoles: jest.fn() }));
jest.mock("../lib/phase7/readiness", () => ({ isPhase7FollowupReady: jest.fn() }));
jest.mock("../lib/reports/session1-ready", () => ({ isSession1ReportsReady: jest.fn() }));
jest.mock("../lib/prisma", () => ({ prisma: { user: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() }, student: { findUniqueOrThrow: jest.fn(), update: jest.fn() }, guardian: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() }, $transaction: jest.fn() } }));

const mockedFindMany = jest.mocked(prisma.user.findMany);
const mockedGuardianFindMany = jest.mocked(prisma.guardian.findMany);
const mockedUserFindFirst = jest.mocked(prisma.user.findFirst);
const mockedTransaction = jest.mocked(prisma.$transaction);
const mockedSession1Ready = jest.mocked(isSession1ReportsReady);
const mockedFinanceStatus = jest.mocked(getStudentFinanceStatus);
const mockedRequireApiRoles = jest.mocked(requireApiRoles);
const mockedReadiness = jest.mocked(isPhase7FollowupReady);

test("student response uses DOB-derived adult status and stored fallback without DOB", async () => {
  mockedRequireApiRoles.mockResolvedValue({ user: { academyId: "academy-1" }, error: null } as never);
  mockedReadiness.mockResolvedValue(false);
  mockedFindMany.mockResolvedValue([
    {
      id: "dob-student",
      dateOfBirth: new Date("2000-01-01T00:00:00.000Z"),
      studentProfile: { id: "dob-profile", isAdult: false, guardian: null, assignments: [] },
    },
    {
      id: "fallback-student",
      dateOfBirth: null,
      studentProfile: { id: "fallback-profile", isAdult: true, guardian: null, assignments: [] },
    },
  ] as never);
  mockedFinanceStatus.mockResolvedValue(new Map());

  const response = await GET(new Request("http://localhost/api/admin/profiles?type=student"));
  const { data } = await response.json();

  expect(data[0].studentProfile.isAdult).toBe(true);
  expect(data[1].studentProfile.isAdult).toBe(true);
});


test("student guardian lookup is scoped to the requesting academy", async () => {
  mockedRequireApiRoles.mockResolvedValue({ user: { academyId: "academy-1" }, error: null } as never);
  mockedReadiness.mockResolvedValue(false);
  mockedFindMany.mockResolvedValue([
    {
      id: "student-1",
      dateOfBirth: null,
      studentProfile: { id: "profile-1", guardianId: "guardian-2", isAdult: false, assignments: [] },
    },
  ] as never);
  mockedGuardianFindMany.mockResolvedValue([] as never);
  mockedFinanceStatus.mockResolvedValue(new Map());

  const response = await GET(new Request("http://localhost/api/admin/profiles?type=student"));
  const { data } = await response.json();

  expect(mockedGuardianFindMany).toHaveBeenCalledWith({
    where: { academyId: "academy-1", id: { in: ["guardian-2"] }, user: { academyId: "academy-1" } },
    select: { id: true, relationship: true, user: { select: { displayName: true, phone: true } } },
  });
  expect(data[0].studentProfile.guardian).toBeNull();
});


test("student profile update recalculates and stores DOB-derived adult status", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  mockedRequireApiRoles.mockResolvedValue({ user: { id: "admin-1", academyId: "academy-1", role: "ADMIN" }, error: null } as never);
  mockedUserFindFirst.mockResolvedValue({ id, role: "STUDENT", teacherProfile: null } as never);
  mockedSession1Ready.mockResolvedValue(false);

  const tx = {
    user: { update: jest.fn().mockResolvedValue({ id }) },
    student: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ isAdult: false, user: { dateOfBirth: new Date("2000-01-01T00:00:00.000Z") } }),
      update: jest.fn().mockResolvedValue({ id: "student-profile-1" }),
    },
    guardian: { update: jest.fn() },
  };
  mockedTransaction.mockImplementation(async (operation) => {
    if (typeof operation !== "function") throw new Error("Expected interactive transaction");
    return operation(tx as never);
  });

  const response = await PATCH(
    new Request(`http://localhost/api/admin/profiles/${id}`, {
      method: "PATCH",
      headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
      body: JSON.stringify({ guardianId: null }),
    }),
    { params: Promise.resolve({ id }) },
  );

  expect(response.status).toBe(200);
  expect(tx.student.update).toHaveBeenCalledWith({
    where: { userId: id },
    data: { isAdult: true, guardianId: null },
    select: { id: true },
  });
});


test("supervisor can update time zone on a student profile", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  mockedRequireApiRoles.mockResolvedValue({ user: { id: "sup-1", academyId: "academy-1", role: "SUPERVISOR" }, error: null } as never);
  mockedUserFindFirst.mockResolvedValue({ id, role: "STUDENT", teacherProfile: null } as never);
  mockedSession1Ready.mockResolvedValue(false);

  const tx = {
    user: { update: jest.fn().mockResolvedValue({ id }) },
    student: { update: jest.fn() },
    userSecurityEvent: { create: jest.fn().mockResolvedValue({ id: "event-1" }) },
    notificationJob: { create: jest.fn().mockResolvedValue({ id: "job-1" }) },
  };
  mockedTransaction.mockImplementation(async (operation) => {
    return operation(tx as never);
  });

  const response = await PATCH(
    new Request(`http://localhost/api/admin/profiles/${id}`, {
      method: "PATCH",
      headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
      body: JSON.stringify({ timezone: "Asia/Riyadh" }),
    }),
    { params: Promise.resolve({ id }) },
  );

  expect(response.status).toBe(200);
  expect(tx.user.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id },
      data: expect.objectContaining({ timezone: "Asia/Riyadh", timezoneSource: "ADMIN" }),
    }),
  );
});

test("deactivating a profile increments sessionVersion and writes ACCOUNT_DEACTIVATED event", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  mockedRequireApiRoles.mockResolvedValue({ user: { id: "admin-1", academyId: "academy-1", role: "ADMIN" }, error: null } as never);
  mockedUserFindFirst.mockResolvedValue({ id, role: "STUDENT", isActive: true, teacherProfile: null } as never);
  mockedSession1Ready.mockResolvedValue(false);

  const tx = {
    user: { update: jest.fn().mockResolvedValue({ id }) },
    student: { update: jest.fn() },
    userSecurityEvent: { create: jest.fn().mockResolvedValue({ id: "event-1" }) },
    notificationJob: { create: jest.fn().mockResolvedValue({ id: "job-1" }) },
  };
  mockedTransaction.mockImplementation(async (operation) => {
    return operation(tx as never);
  });

  const response = await PATCH(
    new Request(`http://localhost/api/admin/profiles/${id}`, {
      method: "PATCH",
      headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    }),
    { params: Promise.resolve({ id }) },
  );

  expect(response.status).toBe(200);
  expect(tx.user.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id },
      data: expect.objectContaining({
        isActive: false,
        sessionVersion: { increment: 1 },
      }),
    }),
  );
  expect(tx.userSecurityEvent.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        action: "ACCOUNT_DEACTIVATED",
        targetUserId: id,
        actorUserId: "admin-1",
      }),
    }),
  );
});
