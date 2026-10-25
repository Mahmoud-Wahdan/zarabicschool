jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { studentFinanceBlocked } from "../../lib/dal";
import { requireStudentFinanceAccess } from "../../lib/guards/student-finance";
import { prisma } from "../../lib/prisma";
import {
  cleanupSessionFixtures,
  createSessionFixtures,
  closePrisma,
  type SessionFixtures,
} from "../helpers/session-fixtures";

jest.setTimeout(180_000);

let fx: SessionFixtures;

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("Session 1 — student finance wall predicates (CONTEXT §12/§21.6)", () => {
  it("UNIT-FIN-01: a student with a linked guardian is blocked — studentFinanceBlocked true and requireStudentFinanceAccess throws 403 FINANCE_ACCESS_FORBIDDEN", async () => {
    // The shared fixture links every numbered student to one guardian.
    const userId = fx.studentUserIds.student1;
    await expect(studentFinanceBlocked(userId)).resolves.toBe(true);
    let caught: unknown = null;
    try {
      await requireStudentFinanceAccess(userId);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("FINANCE_ACCESS_FORBIDDEN");
    expect((caught as { status?: number }).status).toBe(403);
  });

  it("UNIT-FIN-02: an adult student without a guardian is permitted — not blocked and access resolves cleanly", async () => {
    const suffix = `${fx.suffix}fin02`;
    const adultUser = await prisma.user.create({
      data: {
        academyId: fx.academyId,
        username: `demo_test_adult_${suffix}`,
        displayName: "Demo Test Finance Adult",
        passwordHash: "x".repeat(60),
        role: "STUDENT",
        phone: "+201000000041",
        timezone: "Africa/Cairo",
        isActive: true,
        mustChangePassword: false,
      },
      select: { id: true },
    });
    await prisma.student.create({
      data: { userId: adultUser.id, academyId: fx.academyId, guardianId: null, isAdult: true, enrollmentDate: new Date() },
      select: { id: true },
    });
    await expect(studentFinanceBlocked(adultUser.id)).resolves.toBe(false);
    await expect(requireStudentFinanceAccess(adultUser.id)).resolves.toBeUndefined();
  });
});
