import { getMessagingProvider } from "../lib/messaging/provider";
jest.mock("../lib/messaging/provider", () => ({ getMessagingProvider: jest.fn() }));
import { GET, POST } from "../app/api/admin/users/route";
import { PATCH } from "../app/api/admin/users/[id]/route";
import { POST as POST_PASSWORD } from "../app/api/admin/users/[id]/password/route";
import { POST as POST_REVOKE } from "../app/api/admin/users/[id]/sessions/revoke/route";
import { requireApiRole, requireApiRoles } from "../lib/dal";
import { prisma } from "../lib/prisma";
import { accountPasswordResetSchema, privilegedUserCreateSchema } from "../lib/validation/management";

test.each(["a".repeat(73), "م".repeat(37)])("manager-set passwords fit the credential verifier", (password) => {
  expect(accountPasswordResetSchema.safeParse({ password }).success).toBe(false);
  expect(privilegedUserCreateSchema.safeParse({
    username: "manager", displayName: "Manager", role: "SUPERVISOR", password,
  }).success).toBe(false);
});

jest.mock("../lib/dal", () => ({
  requireApiRole: jest.fn(),
  requireApiRoles: jest.fn(),
}));

jest.mock("../lib/prisma", () => ({
  prisma: {
    user: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    student: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    guardian: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    userSecurityEvent: {
      create: jest.fn(),
    },
    notificationJob: {
      create: jest.fn(), update: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

const mockedRequireApiRole = jest.mocked(requireApiRole);
const mockedRequireApiRoles = jest.mocked(requireApiRoles);
const mockedUserFindMany = jest.mocked(prisma.user.findMany);
const mockedUserFindFirst = jest.mocked(prisma.user.findFirst);
const mockedUserCount = jest.mocked(prisma.user.count);
const mockedTransaction = jest.mocked(prisma.$transaction);

describe("GET /api/admin/users", () => {
  test("Supervisor directory excludes Admin accounts", async () => {
    mockedRequireApiRoles.mockResolvedValue({
      user: { id: "sup-1", academyId: "academy-1", role: "SUPERVISOR" },
      error: null,
    } as never);

    mockedUserFindMany.mockResolvedValue([] as never);

    const response = await GET();
    expect(response.status).toBe(200);

    expect(mockedUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          academyId: "academy-1",
          role: { not: "ADMIN" },
        }),
      }),
    );
  });

  test("Admin directory includes all accounts in academy", async () => {
    mockedRequireApiRoles.mockResolvedValue({
      user: { id: "admin-1", academyId: "academy-1", role: "ADMIN" },
      error: null,
    } as never);

    mockedUserFindMany.mockResolvedValue([] as never);

    const response = await GET();
    expect(response.status).toBe(200);

    expect(mockedUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          academyId: "academy-1",
        }),
      }),
    );
  });
});

test("privileged account creation still requires Admin authorization", async () => {
  mockedRequireApiRole.mockResolvedValue({ user: null, error: Response.json({}, { status: 403 }) } as never);
  const response = await POST(new Request("http://localhost/api/admin/users", {
    method: "POST", headers: { origin: "http://localhost", host: "localhost" },
  }));
  expect(response.status).toBe(403);
  expect(mockedRequireApiRole).toHaveBeenCalledWith("ADMIN");
  expect(prisma.user.create).not.toHaveBeenCalled();
});

describe("PATCH /api/admin/users/[id]", () => {
  const targetId = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    mockedTransaction.mockImplementation(async op => op(prisma as never));
  });

  test.each([
    {
      target: { role: "TEACHER", isActive: false, teacherProfile: { approvalStatus: "PENDING" } },
      edit: { isActive: true },
      code: "TEACHER_PENDING_APPROVAL",
    },
    {
      target: { role: "STUDENT", studentProfile: { isAdult: true, guardianId: null } },
      edit: { dateOfBirth: new Date().toISOString().slice(0, 10) },
      code: "GUARDIAN_REQUIRED",
    },
  ])("rejects an account edit that would violate $code", async ({ target, edit, code }) => {
    mockedRequireApiRoles.mockResolvedValue({
      user: { id: "manager", academyId: "academy", role: "ADMIN" }, error: null,
    } as never);
    mockedUserFindFirst.mockResolvedValue({ id: targetId, ...target } as never);
    const writes = jest.mocked(prisma.user.update);
    writes.mockClear();
    const response = await PATCH(new Request("http://localhost/api/admin/users/" + targetId, {
      method: "PATCH", headers: { origin: "http://localhost", host: "localhost" },
      body: JSON.stringify(edit),
    }), { params: Promise.resolve({ id: targetId }) });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe(code);
    expect(writes).not.toHaveBeenCalled();
  });

  test("Supervisor target lookup returns 404 for Admin targets", async () => {
    mockedRequireApiRoles.mockResolvedValue({
      user: { id: "sup-1", academyId: "academy-1", role: "SUPERVISOR" },
      error: null,
    } as never);

    mockedUserFindFirst.mockResolvedValue(null as never);

    const response = await PATCH(
      new Request(`http://localhost/api/admin/users/${targetId}`, {
        method: "PATCH",
        headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
        body: JSON.stringify({ displayName: "New Name" }),
      }),
      { params: Promise.resolve({ id: targetId }) },
    );

    expect(response.status).toBe(404);
    expect(mockedUserFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: targetId,
          academyId: "academy-1",
          role: { not: "ADMIN" },
        }),
      }),
    );
  });

  test("returns 400 when attempting to update role", async () => {
    mockedRequireApiRoles.mockResolvedValue({
      user: { id: "admin-1", academyId: "academy-1", role: "ADMIN" },
      error: null,
    } as never);

    const response = await PATCH(
      new Request(`http://localhost/api/admin/users/${targetId}`, {
        method: "PATCH",
        headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
        body: JSON.stringify({ role: "ADMIN" }),
      }),
      { params: Promise.resolve({ id: targetId }) },
    );

    expect(response.status).toBe(400);
  });

  test("returns 400 when attempting to include password in profile patch", async () => {
    mockedRequireApiRoles.mockResolvedValue({
      user: { id: "admin-1", academyId: "academy-1", role: "ADMIN" },
      error: null,
    } as never);

    const response = await PATCH(
      new Request(`http://localhost/api/admin/users/${targetId}`, {
        method: "PATCH",
        headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
        body: JSON.stringify({ password: "newpassword123!" }),
      }),
      { params: Promise.resolve({ id: targetId }) },
    );

    expect(response.status).toBe(400);
  });

  test("Supervisor can update time zone for non-Admin user", async () => {
    mockedRequireApiRoles.mockResolvedValue({
      user: { id: "sup-1", academyId: "academy-1", role: "SUPERVISOR" },
      error: null,
    } as never);

    mockedUserFindFirst.mockResolvedValue({
      id: targetId,
      academyId: "academy-1",
      role: "TEACHER",
      isActive: true,
      teacherProfile: null,
      studentProfile: null,
    } as never);

    const tx = {
      user: { findFirst: mockedUserFindFirst, count: mockedUserCount, update: jest.fn().mockResolvedValue({ id: targetId }) },
      userSecurityEvent: { create: jest.fn().mockResolvedValue({ id: "event-1" }) },
      notificationJob: { create: jest.fn().mockResolvedValue({ id: "job-1" }) },
    };
    mockedTransaction.mockImplementation(async (op) => op(tx as never));

    const response = await PATCH(
      new Request(`http://localhost/api/admin/users/${targetId}`, {
        method: "PATCH",
        headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
        body: JSON.stringify({ timezone: "Europe/London" }),
      }),
      { params: Promise.resolve({ id: targetId }) },
    );

    expect(response.status).toBe(200);
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: targetId },
        data: expect.objectContaining({ timezone: "Europe/London", timezoneSource: "ADMIN" }),
      }),
    );
  });

  test("Supervisor announcement-opt-out returns 403", async () => {
    mockedRequireApiRoles.mockResolvedValue({
      user: { id: "sup-1", academyId: "academy-1", role: "SUPERVISOR" },
      error: null,
    } as never);

    mockedUserFindFirst.mockResolvedValue({
      id: targetId,
      academyId: "academy-1",
      role: "TEACHER",
      isActive: true,
      teacherProfile: null,
      studentProfile: null,
    } as never);

    const response = await PATCH(
      new Request(`http://localhost/api/admin/users/${targetId}`, {
        method: "PATCH",
        headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
        body: JSON.stringify({ announcementsOptOut: true }),
      }),
      { params: Promise.resolve({ id: targetId }) },
    );

    expect(response.status).toBe(403);
  });

  test("self-deactivation is rejected with 400", async () => {
    const adminId = "22222222-2222-4222-8222-222222222222";
    mockedRequireApiRoles.mockResolvedValue({
      user: { id: adminId, academyId: "academy-1", role: "ADMIN" },
      error: null,
    } as never);

    mockedUserFindFirst.mockResolvedValue({
      id: adminId,
      academyId: "academy-1",
      role: "ADMIN",
      isActive: true,
      teacherProfile: null,
      studentProfile: null,
    } as never);

    const response = await PATCH(
      new Request(`http://localhost/api/admin/users/${adminId}`, {
        method: "PATCH",
        headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      }),
      { params: Promise.resolve({ id: adminId }) },
    );

    expect(response.status).toBe(400);
  });

  test("deactivating last active Admin is rejected with 400", async () => {
    mockedRequireApiRoles.mockResolvedValue({
      user: { id: "other-admin", academyId: "academy-1", role: "ADMIN" },
      error: null,
    } as never);

    mockedUserFindFirst.mockResolvedValue({
      id: targetId,
      academyId: "academy-1",
      role: "ADMIN",
      isActive: true,
      teacherProfile: null,
      studentProfile: null,
    } as never);

    mockedUserCount.mockResolvedValue(1); // Only 1 active Admin

    const response = await PATCH(
      new Request(`http://localhost/api/admin/users/${targetId}`, {
        method: "PATCH",
        headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      }),
      { params: Promise.resolve({ id: targetId }) },
    );

    expect(response.status).toBe(400);
  });

  test("deactivation increments sessionVersion and writes ACCOUNT_DEACTIVATED event", async () => {
    mockedRequireApiRoles.mockResolvedValue({
      user: { id: "admin-1", academyId: "academy-1", role: "ADMIN" },
      error: null,
    } as never);

    mockedUserFindFirst.mockResolvedValue({
      id: targetId,
      academyId: "academy-1",
      role: "TEACHER",
      isActive: true,
      teacherProfile: null,
      studentProfile: null,
    } as never);

    const tx = {
      user: { findFirst: mockedUserFindFirst, count: mockedUserCount, update: jest.fn().mockResolvedValue({ id: targetId }) },
      userSecurityEvent: { create: jest.fn().mockResolvedValue({ id: "event-1" }) },
      notificationJob: { create: jest.fn().mockResolvedValue({ id: "job-1" }) },
    };
    mockedTransaction.mockImplementation(async (op) => op(tx as never));

    const response = await PATCH(
      new Request(`http://localhost/api/admin/users/${targetId}`, {
        method: "PATCH",
        headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      }),
      { params: Promise.resolve({ id: targetId }) },
    );

    expect(response.status).toBe(200);
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: targetId },
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
          targetUserId: targetId,
          actorUserId: "admin-1",
        }),
      }),
    );
  });
});

describe("POST /api/admin/users/[id]/password", () => {
  const targetId = "11111111-1111-4111-8111-111111111111";

  test("Supervisor cannot reset Admin password (returns 404)", async () => {
    mockedRequireApiRoles.mockResolvedValue({
      user: { id: "sup-1", academyId: "academy-1", role: "SUPERVISOR" },
      error: null,
    } as never);

    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    mockedTransaction.mockImplementation(async (op) => op({ user: { updateMany } } as never));

    const response = await POST_PASSWORD(
      new Request(`http://localhost/api/admin/users/${targetId}/password`, {
        method: "POST",
        headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
        body: JSON.stringify({ password: "newSecurePassword123!" }),
      }),
      { params: Promise.resolve({ id: targetId }) },
    );

    expect(response.status).toBe(404);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: targetId, academyId: "academy-1", role: { not: "ADMIN" } },
    }));
  });

  test("self-reset returns 400", async () => {
    const adminId = "abcdefab-2222-4222-8222-222222222222";
    mockedRequireApiRoles.mockResolvedValue({
      user: { id: adminId, academyId: "academy-1", role: "ADMIN" },
      error: null,
    } as never);

    const response = await POST_PASSWORD(
      new Request(`http://localhost/api/admin/users/${adminId}/password`, {
        method: "POST",
        headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
        body: JSON.stringify({ password: "newSecurePassword123!" }),
      }),
      { params: Promise.resolve({ id: adminId.toUpperCase() }) },
    );

    expect(response.status).toBe(400);
  });

  test("resets password, forces change, increments sessionVersion, creates PASSWORD_RESET event", async () => {
    mockedRequireApiRoles.mockResolvedValue({
      user: { id: "admin-1", academyId: "academy-1", role: "ADMIN" },
      error: null,
    } as never);

    mockedUserFindFirst.mockResolvedValue({
      id: targetId,
      academyId: "academy-1",
      role: "STUDENT",
    } as never);

    const tx = {
      user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      userSecurityEvent: { create: jest.fn().mockResolvedValue({ id: "event-1" }) },
      notificationJob: { create: jest.fn().mockResolvedValue({ id: "job-1" }) },
    };
    mockedTransaction.mockImplementation(async (op) => op(tx as never));

    const response = await POST_PASSWORD(
      new Request(`http://localhost/api/admin/users/${targetId}/password`, {
        method: "POST",
        headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
        body: JSON.stringify({ password: "newSecurePassword123!" }),
      }),
      { params: Promise.resolve({ id: targetId }) },
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data.password).toBeUndefined();
    expect(json.data.passwordHash).toBeUndefined();

    expect(tx.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: targetId, academyId: "academy-1" },
        data: expect.objectContaining({
          mustChangePassword: true,
          passwordSetById: "admin-1",
          sessionVersion: { increment: 1 },
        }),
      }),
    );
    expect(tx.userSecurityEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "PASSWORD_RESET",
          actorUserId: "admin-1",
          targetUserId: targetId,
        }),
      }),
    );
  });
});

describe("POST /api/admin/users/[id]/sessions/revoke", () => {
  const targetId = "11111111-1111-4111-8111-111111111111";

  test("self-revoke returns 400", async () => {
    const adminId = "abcdefab-2222-4222-8222-222222222222";
    mockedRequireApiRoles.mockResolvedValue({
      user: { id: adminId, academyId: "academy-1", role: "ADMIN" },
      error: null,
    } as never);

    const response = await POST_REVOKE(
      new Request(`http://localhost/api/admin/users/${adminId}/sessions/revoke`, {
        method: "POST",
        headers: { origin: "http://localhost", host: "localhost" },
      }),
      { params: Promise.resolve({ id: adminId.toUpperCase() }) },
    );

    expect(response.status).toBe(400);
  });

  test("increments sessionVersion and creates SESSIONS_REVOKED event", async () => {
    mockedRequireApiRoles.mockResolvedValue({
      user: { id: "admin-1", academyId: "academy-1", role: "ADMIN" },
      error: null,
    } as never);

    mockedUserFindFirst.mockResolvedValue({
      id: targetId,
      academyId: "academy-1",
      role: "STUDENT",
    } as never);

    const tx = {
      user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      userSecurityEvent: { create: jest.fn().mockResolvedValue({ id: "event-1" }) },
      notificationJob: { create: jest.fn().mockResolvedValue({ id: "job-1" }) },
    };
    mockedTransaction.mockImplementation(async (op) => op(tx as never));

    const response = await POST_REVOKE(
      new Request(`http://localhost/api/admin/users/${targetId}/sessions/revoke`, {
        method: "POST",
        headers: { origin: "http://localhost", host: "localhost" },
      }),
      { params: Promise.resolve({ id: targetId }) },
    );

    expect(response.status).toBe(200);
    expect(tx.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: targetId, academyId: "academy-1" },
        data: expect.objectContaining({
          sessionVersion: { increment: 1 },
        }),
      }),
    );
    expect(tx.userSecurityEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "SESSIONS_REVOKED",
          actorUserId: "admin-1",
          targetUserId: targetId,
        }),
      }),
    );
  });
});

test.each([true, false])("phone save only notifies the previous number when changed=%s", async changed => {
  const id = "33333333-3333-4333-8333-333333333333";
  const original = "+201000000001";
  const replacement = "+201000000002";
  const target = { id, role: "TEACHER", preferredLanguage: "en", phone: original };
  const tx = {
    user: { findFirst: jest.fn().mockResolvedValue(target), findUniqueOrThrow: jest.fn().mockResolvedValue(target), update: jest.fn() },
    userSecurityEvent: { create: jest.fn().mockResolvedValue({ id: "event" }) },
    notificationJob: { create: jest.fn().mockResolvedValue({ id: "job" }) },
  };
  mockedTransaction.mockImplementation(async operation => operation(tx as never));
  mockedRequireApiRoles.mockResolvedValue({ user: { id: "admin", role: "ADMIN", academyId: "academy" }, error: null } as never);
  const sendText = jest.fn().mockResolvedValue({ ok: false, error: original });
  jest.mocked(getMessagingProvider).mockReturnValue({ sendText } as never);
  const previousUrl = process.env.APP_PUBLIC_URL;
  process.env.APP_PUBLIC_URL = "https://school.example";
  try {
    const response = await PATCH(new Request("http://localhost/api/admin/users", {
      method: "PATCH", headers: { origin: "http://localhost", host: "localhost" },
      body: JSON.stringify({ phone: changed ? replacement : original }),
    }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    expect((await response.json()).whatsappDelivery).toBe(changed ? "FAILED" : undefined);
    expect(sendText).toHaveBeenCalledTimes(changed ? 1 : 0);
    expect(tx.notificationJob.create).toHaveBeenCalledTimes(changed ? 1 : 0);
    expect(tx.userSecurityEvent.create).toHaveBeenCalledTimes(changed ? 1 : 0);
    if (changed) {
      expect(sendText.mock.calls[0][0]).toEqual({ userId: id, phone: original });
      const job = tx.notificationJob.create.mock.calls[0][0].data;
      expect(job.status).toBe("PROCESSING");
      expect(job.payload).toEqual({ action: "ACCOUNT_UPDATED", inAppOnly: true });
      expect(JSON.stringify(job)).not.toContain(original);
    }
  } finally {
    if (previousUrl === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = previousUrl;
  }
});
