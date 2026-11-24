import { getServerSession } from "next-auth";
import { getAuthSession } from "../lib/dal";
import { prisma } from "../lib/prisma";

jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("../lib/auth", () => ({ authOptions: {} }));
jest.mock("../lib/prisma", () => ({
  prisma: { user: { findUnique: jest.fn() } },
}));

const mockedGetServerSession = jest.mocked(getServerSession);
const mockedFindUnique = jest.mocked(prisma.user.findUnique);

const storedUser = {
  id: "user-1",
  academyId: "academy-1",
  username: "learner",
  displayName: "Learner",
  role: "STUDENT" as const,
  isActive: true,
  timezone: "Africa/Cairo",
  mustChangePassword: false,
  sessionVersion: 3,
};

test("getAuthSession rejects a stale token", async () => {
  mockedGetServerSession.mockResolvedValue({ user: { id: "user-1", sessionVersion: 2 } } as never);
  mockedFindUnique.mockResolvedValue(storedUser as never);

  await expect(getAuthSession()).resolves.toBeNull();
});

test("getAuthSession accepts a matching token version", async () => {
  mockedGetServerSession.mockResolvedValue({ user: { id: "user-1", sessionVersion: 3 } } as never);
  mockedFindUnique.mockResolvedValue(storedUser as never);

  await expect(getAuthSession()).resolves.toMatchObject({ id: "user-1", sessionVersion: 3 });
});

test("getAuthSession treats an absent token claim as zero", async () => {
  const versionZeroUser = { ...storedUser, sessionVersion: 0 };
  mockedGetServerSession.mockResolvedValue({ user: { id: "user-1" } } as never);
  mockedFindUnique.mockResolvedValue(versionZeroUser as never);

  await expect(getAuthSession()).resolves.toMatchObject({ id: "user-1", sessionVersion: 0 });
});
