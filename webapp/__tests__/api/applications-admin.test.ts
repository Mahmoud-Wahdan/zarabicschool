import { randomUUID } from "node:crypto";

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import bcrypt from "bcrypt";
import { getServerSession } from "next-auth";

import { disconnectPrisma, prisma } from "../../lib/prisma";
import { approveApplication, ProvisioningError } from "../../lib/provisioning";
import { POST as approveRoute } from "../../app/api/applications/[id]/approve/route";
import { POST as rejectRoute } from "../../app/api/applications/[id]/reject/route";
import { POST as reviewRoute } from "../../app/api/applications/[id]/review/route";

const getServerSessionMock = getServerSession as jest.Mock;

const academyName = "Zarabicschool";
const testPhone = "+201099990000";

let academyId = "";
let adminUserId = "";
let teacherUserId = "";
const createdUserIds = new Set<string>();
const createdApplicationIds = new Set<string>();

let digitCounter = 900;
function nextDigit(): number {
  digitCounter += 1;
  return digitCounter;
}

function guardianDetails(children: { name: string; age: number; subjects: string[] }[], fullName = "Demo Test Guardian") {
  return {
    type: "GUARDIAN",
    full_name: fullName,
    phone_whatsapp: testPhone,
    timezone: "Africa/Cairo",
    preferred_language: "ar",
    children,
  };
}

function studentDetails(dateOfBirth: string) {
  return {
    type: "STUDENT",
    full_name: "Demo Test Student",
    phone_whatsapp: testPhone,
    timezone: "Africa/Cairo",
    preferred_language: "ar",
    date_of_birth: dateOfBirth,
    subjects: ["demo-quran"],
    level: "beginner",
  };
}

async function createApplication(applicationType: "GUARDIAN" | "STUDENT", details: object): Promise<string> {
  const application = await prisma.application.create({
    data: {
      academyId,
      applicationType,
      contactPhone: testPhone,
      details: details as never,
    },
    select: { id: true },
  });
  createdApplicationIds.add(application.id);
  return application.id;
}

function approve(appId: string, overrides: object = {}, digit?: number) {
  return approveApplication({
    applicationId: appId,
    adminId: adminUserId,
    academyId,
    relationship: "mother",
    ...overrides,
    ...(digit !== undefined ? { randomDigits: () => digit } : {}),
  });
}

async function trackCreatedUsers(appId: string): Promise<void> {
  const records = await prisma.applicationRecord.findMany({
    where: { applicationId: appId },
    select: { userId: true },
  });
  records.forEach((record) => createdUserIds.add(record.userId));
}

function adminApiRequest(body: object): Request {
  return new Request("http://localhost:3000/api/applications/x", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      host: "localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

function routeParams(appId: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: appId }) };
}

function isMissingSchemaObjectError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === "P2021" || code === "P2022";
}

async function quiet(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (!isMissingSchemaObjectError(error)) {
      throw error;
    }
  }
}

beforeAll(async () => {
  const staleUsers = await prisma.user.findMany({
    where: {
      OR: [
        { username: { startsWith: "demo-test-" } },
        { username: { startsWith: "demo_test_" } },
      ],
    },
    select: { id: true },
  });
  const staleUserIds = staleUsers.map((user) => user.id);
  const staleApplications = await prisma.application.findMany({
    where: { contactPhone: testPhone },
    select: { id: true },
  });
  const staleApplicationIds = staleApplications.map((application) => application.id);
  const staleRecords = staleApplicationIds.length > 0
    ? await prisma.applicationRecord.findMany({
      where: { applicationId: { in: staleApplicationIds } },
      select: { userId: true },
    })
    : [];
  const allStaleUserIds = [...new Set([
    ...staleUserIds,
    ...staleRecords.map((record) => record.userId),
  ])];
  if (staleApplicationIds.length > 0) {
    await prisma.applicationRecord.deleteMany({ where: { applicationId: { in: staleApplicationIds } } });
    await prisma.application.deleteMany({ where: { id: { in: staleApplicationIds } } });
  }
  if (allStaleUserIds.length > 0) {
    await prisma.student.updateMany({
      where: { guardian: { user: { id: { in: allStaleUserIds } } } },
      data: { guardianId: null },
    });
    await prisma.student.deleteMany({ where: { user: { id: { in: allStaleUserIds } } } });
    await prisma.guardian.deleteMany({ where: { user: { id: { in: allStaleUserIds } } } });
    await prisma.teacherSubject.deleteMany({ where: { teacher: { user: { id: { in: allStaleUserIds } } } } });
    await prisma.teacher.deleteMany({ where: { user: { id: { in: allStaleUserIds } } } });
    await prisma.user.deleteMany({ where: { id: { in: allStaleUserIds } } });
  }
  const runId = randomUUID().slice(0, 8);
  const academy = await prisma.academy.upsert({
    where: { name: academyName },
    update: {},
    create: { name: academyName },
  });
  academyId = academy.id;

  const passwordHash = await bcrypt.hash(randomUUID(), 12);
  const admin = await prisma.user.create({
    data: {
      academyId,
      username: `demo_test_admin_${runId}`,
      passwordHash,
      displayName: "Demo Test Admin",
      role: "ADMIN",
      isActive: true,
      mustChangePassword: false,
    },
    select: { id: true },
  });
  adminUserId = admin.id;
  createdUserIds.add(admin.id);

  const teacher = await prisma.user.create({
    data: {
      academyId,
      username: `demo_test_teacher_${runId}`,
      passwordHash,
      displayName: "Demo Test Teacher",
      role: "TEACHER",
      isActive: true,
      mustChangePassword: false,
    },
    select: { id: true },
  });
  teacherUserId = teacher.id;
  createdUserIds.add(teacher.id);
}, 30_000);

afterAll(async () => {
  try {
    const appIds = [...createdApplicationIds];
    const userIds = [...createdUserIds];
    const testUsers = await prisma.user.findMany({
      where: {
        academyId,
        OR: [
          { username: { startsWith: "demo_test_" } },
          { username: { startsWith: "demo-test-" } },
        ],
      },
      select: { id: true },
    });
    const allTestUserIds = [...new Set([...userIds, ...testUsers.map((user) => user.id)])];
    const allTestApplicationIds = await prisma.application.findMany({
      where: { academyId, contactPhone: testPhone },
      select: { id: true },
    });
    const allTestAppIds = [...new Set([...appIds, ...allTestApplicationIds.map((app) => app.id)])];
    await quiet(() =>
      allTestAppIds.length > 0
        ? prisma.applicationRecord.deleteMany({ where: { applicationId: { in: allTestAppIds } } })
        : Promise.resolve()
    );
    await quiet(() => prisma.student.deleteMany({ where: { user: { id: { in: allTestUserIds } } } }));
    await quiet(() => prisma.guardian.deleteMany({ where: { user: { id: { in: allTestUserIds } } } }));
    await quiet(() =>
      prisma.teacherSubject.deleteMany({ where: { teacher: { user: { id: { in: allTestUserIds } } } } })
    );
    await quiet(() => prisma.teacher.deleteMany({ where: { user: { id: { in: allTestUserIds } } } }));
    await quiet(() =>
      allTestAppIds.length > 0
        ? prisma.application.deleteMany({ where: { id: { in: allTestAppIds } } })
        : Promise.resolve()
    );
    await quiet(() => prisma.user.deleteMany({ where: { id: { in: allTestUserIds } } }));
  } finally {
    await disconnectPrisma();
  }
});

beforeEach(() => {
  getServerSessionMock.mockReset();
});

describe("Slice C2 — Admin review, approval, provisioning", () => {
  it("approves twice sequentially — second attempt returns 409 and creates nothing", async () => {
    const digit = nextDigit();
    const appId = await createApplication(
      "GUARDIAN",
      guardianDetails([{ name: "Omar", age: 10, subjects: ["demo-quran"] }])
    );

    const accounts = await approve(appId, {}, digit);
    expect(accounts).toHaveLength(2);
    await trackCreatedUsers(appId);

    const statusAfter = await prisma.application.findUnique({
      where: { id: appId },
      select: { status: true },
    });
    expect(statusAfter?.status).toBe("APPROVED");

    await expect(approve(appId, {}, digit)).rejects.toMatchObject({
      status: 409,
      code: "ALREADY_PROCESSED",
    });

    const records = await prisma.applicationRecord.count({ where: { applicationId: appId } });
    expect(records).toBe(2);
    const usersForDigit = await prisma.user.count({
      where: { academyId, username: { endsWith: String(digit) } },
    });
    expect(usersForDigit).toBe(2);
  });

  it("approves in parallel (Promise.all) 5 times — exactly one set of users each round", async () => {
    for (let round = 0; round < 5; round += 1) {
      const digit = nextDigit();
      const appId = await createApplication(
        "GUARDIAN",
        guardianDetails([{ name: "Omar", age: 10, subjects: ["demo-quran"] }])
      );

      const results = await Promise.allSettled([
        approve(appId, {}, digit),
        approve(appId, {}, digit),
      ]);
      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const reason = (rejected[0] as PromiseRejectedResult).reason as ProvisioningError;
      expect(reason).toBeInstanceOf(ProvisioningError);
      expect(reason.status).toBe(409);
      expect(reason.code).toBe("ALREADY_PROCESSED");

      const records = await prisma.applicationRecord.findMany({
        where: { applicationId: appId },
        select: { userId: true },
      });
      expect(records).toHaveLength(2);
      records.forEach((record) => createdUserIds.add(record.userId));

      const usersForDigit = await prisma.user.count({
        where: { academyId, username: { endsWith: String(digit) } },
      });
      expect(usersForDigit).toBe(2);
    }
  }, 30_000);

  it("failure on child #2 rolls back everything — zero users/profiles, application NOT approved", async () => {
    const digit = nextDigit();
    const occupant = await prisma.user.create({
      data: {
        academyId,
        username: `demo-test-occupied${digit}`,
        passwordHash: await bcrypt.hash(randomUUID(), 12),
        displayName: "Demo Test Occupant",
        role: "STUDENT",
      },
      select: { id: true },
    });
    createdUserIds.add(occupant.id);

    const appId = await createApplication(
      "GUARDIAN",
      guardianDetails([
        { name: "Omar", age: 10, subjects: ["demo-quran"] },
        { name: "Salma", age: 8, subjects: ["demo-arabic"] },
      ])
    );

    await expect(
      approve(appId, { accounts: [{ key: "child-1", username: `demo-test-occupied${digit}` }] }, digit)
    ).rejects.toMatchObject({ status: 400, code: "USERNAME_TAKEN" });

    const records = await prisma.applicationRecord.count({ where: { applicationId: appId } });
    expect(records).toBe(0);
    const appAfter = await prisma.application.findUnique({
      where: { id: appId },
      select: { status: true },
    });
    expect(appAfter?.status).toBe("NEW");
    const usersForDigit = await prisma.user.count({
      where: { academyId, username: { endsWith: String(digit) } },
    });
    expect(usersForDigit).toBe(1);
    const studentsCount = await prisma.student.count({
      where: { academyId, guardian: { user: { username: { endsWith: String(digit) } } } },
    });
    expect(studentsCount).toBe(0);
  });

  it("non-admin gets 403 on the approve route and nothing is created", async () => {
    const digit = nextDigit();
    getServerSessionMock.mockResolvedValue({ user: { id: teacherUserId } });

    const appId = await createApplication(
      "GUARDIAN",
      guardianDetails([{ name: "Omar", age: 10, subjects: ["demo-quran"] }])
    );

    const response = await approveRoute(adminApiRequest({ relationship: "mother" }), routeParams(appId));
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error.code).toBe("FORBIDDEN");

    const appAfter = await prisma.application.findUnique({
      where: { id: appId },
      select: { status: true },
    });
    expect(appAfter?.status).toBe("NEW");
    void digit;
  });

  it("unauthenticated request gets 401 on the approve route", async () => {
    getServerSessionMock.mockResolvedValue(null);

    const response = await approveRoute(
      adminApiRequest({ relationship: "mother" }),
      routeParams(randomUUID())
    );
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error.code).toBe("UNAUTHORIZED");
  });

  it("reject without reason returns 400 and does not change status", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: adminUserId } });

    const appId = await createApplication(
      "GUARDIAN",
      guardianDetails([{ name: "Omar", age: 10, subjects: ["demo-quran"] }])
    );

    const response = await rejectRoute(adminApiRequest({}), routeParams(appId));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.fieldErrors.reason).toBeDefined();

    const appAfter = await prisma.application.findUnique({
      where: { id: appId },
      select: { status: true },
    });
    expect(appAfter?.status).toBe("NEW");
  });

  it("guardian application with 3 children provisions 4 users linked to one guardian", async () => {
    const digit = nextDigit();
    const appId = await createApplication(
      "GUARDIAN",
      guardianDetails([
        { name: "Omar", age: 10, subjects: ["demo-quran"] },
        { name: "Salma", age: 8, subjects: ["demo-arabic"] },
        { name: "Youssef", age: 12, subjects: ["demo-math"] },
      ])
    );

    const accounts = await approve(appId, {}, digit);
    expect(accounts).toHaveLength(4);
    await trackCreatedUsers(appId);

    const usersForDigit = await prisma.user.count({
      where: { academyId, username: { endsWith: String(digit) } },
    });
    expect(usersForDigit).toBe(4);

    const guardianProfile = await prisma.guardian.findFirst({
      where: { user: { username: `demo-test-guardian${digit}` } },
      select: { id: true, relationship: true },
    });
    expect(guardianProfile).not.toBeNull();
    expect(guardianProfile?.relationship).toBe("MOTHER");

    const students = await prisma.student.findMany({
      where: { guardianId: guardianProfile!.id },
      select: { isAdult: true },
    });
    expect(students).toHaveLength(3);
    expect(students.every((student) => student.isAdult === false)).toBe(true);

    accounts.forEach((account) => {
      expect(account.tempPassword.length).toBeGreaterThanOrEqual(12);
      expect(account.username.length).toBeGreaterThan(0);
      expect(account.userId.length).toBeGreaterThan(0);
    });
  });

  it("minor student without guardian is rejected and application stays NEW", async () => {
    const appId = await createApplication("STUDENT", studentDetails("2012-03-20"));

    await expect(approve(appId)).rejects.toMatchObject({ status: 400, code: "GUARDIAN_REQUIRED" });

    const appAfter = await prisma.application.findUnique({
      where: { id: appId },
      select: { status: true },
    });
    expect(appAfter?.status).toBe("NEW");
  });

  it("adult student without guardian is allowed with a nullable guardian FK", async () => {
    const digit = nextDigit();
    const appId = await createApplication("STUDENT", studentDetails("1995-05-15"));

    const accounts = await approve(appId, {}, digit);
    expect(accounts).toHaveLength(1);
    await trackCreatedUsers(appId);

    const studentProfile = await prisma.student.findFirst({
      where: { user: { username: `demo-test-student${digit}` } },
      select: { guardianId: true, isAdult: true },
    });
    expect(studentProfile?.guardianId).toBeNull();
    expect(studentProfile?.isAdult).toBe(true);
  });

  it("username collision triggers a retry inside the transaction (max 5)", async () => {
    const occupant = await prisma.user.create({
      data: {
        academyId,
        username: "demo-test-guardian777",
        passwordHash: await bcrypt.hash(randomUUID(), 12),
        displayName: "Demo Test Occupant",
        role: "STUDENT",
      },
      select: { id: true },
    });
    createdUserIds.add(occupant.id);

    const appId = await createApplication(
      "GUARDIAN",
      guardianDetails([{ name: "Omar", age: 10, subjects: ["demo-quran"] }])
    );

    let calls = 0;
    const rng = () => {
      calls += 1;
      return calls === 1 ? 777 : 555;
    };

    const accounts = await approveApplication({
      applicationId: appId,
      adminId: adminUserId,
      academyId,
      relationship: "mother",
      randomDigits: rng,
    });
    await trackCreatedUsers(appId);

    expect(accounts[0].username).toBe("demo-test-guardian555");
    expect(calls).toBeGreaterThanOrEqual(2);

    const guardianUser = await prisma.user.findUnique({
      where: { academyId_username: { academyId, username: "demo-test-guardian555" } },
      select: { id: true },
    });
    expect(guardianUser).not.toBeNull();
  });

  it("passwords, names, and phones never appear in console output (spy)", async () => {
    const digit = nextDigit();
    const consoleSpies = (["log", "warn", "error", "info"] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => {})
    );

    try {
      const appId = await createApplication(
        "GUARDIAN",
        guardianDetails([{ name: "Omar", age: 10, subjects: ["demo-quran"] }])
      );

      const accounts = await approve(appId, {}, digit);
      await trackCreatedUsers(appId);

      const secrets = accounts.flatMap((account) => [
        account.tempPassword,
        account.username,
        account.displayName,
        testPhone,
      ]);

      for (const spy of consoleSpies) {
        for (const call of spy.mock.calls.flat()) {
          const text = String(call);
          for (const secret of secrets) {
            expect(text.includes(secret)).toBe(false);
          }
        }
      }
    } finally {
      consoleSpies.forEach((spy) => spy.mockRestore());
    }
  });

  it("Arabic-only name without an Admin-supplied username returns 400 and rolls back", async () => {
    const appId = await createApplication(
      "GUARDIAN",
      guardianDetails([{ name: "Omar", age: 10, subjects: ["demo-quran"] }], "فاطمة أحمد")
    );

    await expect(approve(appId)).rejects.toMatchObject({ status: 400, code: "USERNAME_REQUIRED" });

    const appAfter = await prisma.application.findUnique({
      where: { id: appId },
      select: { status: true },
    });
    expect(appAfter?.status).toBe("NEW");
  });

  it("Admin-supplied username override is honored", async () => {
    const appId = await createApplication(
      "GUARDIAN",
      guardianDetails([{ name: "Omar", age: 10, subjects: ["demo-quran"] }])
    );

    const accounts = await approve(
      appId,
      { accounts: [{ key: "guardian", username: "custom-admin-name" }] },
      nextDigit()
    );
    await trackCreatedUsers(appId);

    expect(accounts[0].username).toBe("custom-admin-name");
  });

  it("mark-reviewed transitions NEW to REVIEWED and approve still works after review", async () => {
    const digit = nextDigit();
    getServerSessionMock.mockResolvedValue({ user: { id: adminUserId } });

    const appId = await createApplication(
      "GUARDIAN",
      guardianDetails([{ name: "Omar", age: 10, subjects: ["demo-quran"] }])
    );

    const reviewResponse = await reviewRoute(adminApiRequest({}), routeParams(appId));
    expect(reviewResponse.status).toBe(200);

    const statusAfterReview = await prisma.application.findUnique({
      where: { id: appId },
      select: { status: true, reviewedById: true },
    });
    expect(statusAfterReview?.status).toBe("REVIEWED");
    expect(statusAfterReview?.reviewedById).toBe(adminUserId);

    const accounts = await approve(appId, {}, digit);
    expect(accounts).toHaveLength(2);
    await trackCreatedUsers(appId);
  });

  it("mark-reviewed twice returns 409", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: adminUserId } });

    const appId = await createApplication(
      "GUARDIAN",
      guardianDetails([{ name: "Omar", age: 10, subjects: ["demo-quran"] }])
    );

    const first = await reviewRoute(adminApiRequest({}), routeParams(appId));
    expect(first.status).toBe(200);

    const second = await reviewRoute(adminApiRequest({}), routeParams(appId));
    expect(second.status).toBe(409);
    const data = await second.json();
    expect(data.error.code).toBe("ALREADY_PROCESSED");
  });
});
