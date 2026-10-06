jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("react", () => ({
  ...jest.requireActual("react"),
  cache: (fn: (...args: never[]) => unknown) => fn,
}));

jest.mock("next-auth/jwt", () => ({
  getToken: jest.fn(),
}));

jest.mock("next-intl/middleware", () => ({
  __esModule: true,
  default: () => (request: unknown) => ({ type: "i18n", request }),
}));

jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

jest.mock("next/navigation", () => ({
  redirect: jest.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

jest.mock("../../lib/prisma", () => ({
  prisma: {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("bcrypt", () => ({
  compare: jest.fn(),
}));

import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { redirect } from "next/navigation";

import { authOptions } from "../../lib/auth";
import { getAuthSession, requireApiRoles, requireRole } from "../../lib/dal";
import { resetRateLimits } from "../../lib/rate-limit";
import { proxy } from "../../proxy";
import { prisma } from "../../lib/prisma";
import bcrypt from "bcrypt";

const getServerSessionMock = getServerSession as jest.Mock;
const getTokenMock = getToken as jest.Mock;
const prismaMock = prisma as unknown as {
  user: { findFirst: jest.Mock; findUnique: jest.Mock };
};
const compareMock = bcrypt.compare as jest.Mock;

function authUser(overrides: Partial<{
  id: string;
  academyId: string;
  username: string;
  displayName: string;
  role: "ADMIN" | "SUPERVISOR" | "TEACHER" | "STUDENT" | "GUARDIAN";
  mustChangePassword: boolean;
}> = {}) {
  return {
    id: "user-1",
    academyId: "academy-1",
    username: "demo_user",
    displayName: "Demo User",
    role: "SUPERVISOR" as const,
    mustChangePassword: false,
    isActive: true,
    ...overrides,
  };
}

function request(path = "/ar/admin") {
  return new NextRequest(`http://localhost:3000${path}`);
}

describe("Phase 1 authentication and RBAC gates", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimits();
    compareMock.mockResolvedValue(true);
  });

  it("authenticates active users by username only and normalizes the username", async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: "user-1",
      username: "demo_user",
      displayName: "Demo User",
      email: null,
      passwordHash: "hash",
      role: "SUPERVISOR",
      isActive: true,
      mustChangePassword: false,
    });

    const provider = authOptions.providers[0].options as {
      authorize: (credentials: unknown, request: { headers: Headers }) => Promise<unknown>;
    };
    const result = await provider.authorize(
      { username: "  DEMO_USER ", password: "Valid1234" },
      { headers: new Headers({ "x-forwarded-for": "203.0.113.10" }) },
    );

    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { username: "demo_user" },
    }));
    expect(result).toEqual(expect.objectContaining({ username: "demo_user", role: "SUPERVISOR" }));
  });

  it("rejects inactive users and rate-limits both the username and IP", async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: "user-1",
      username: "demo_user",
      displayName: "Demo User",
      email: null,
      passwordHash: "hash",
      role: "ADMIN",
      isActive: false,
      mustChangePassword: false,
    });
    const provider = authOptions.providers[0].options as {
      authorize: (credentials: unknown, request: { headers: Headers }) => Promise<unknown>;
    };
    const credentials = { username: "demo_user", password: "Valid1234" };
    const authRequest = { headers: new Headers({ "x-forwarded-for": "203.0.113.11" }) };

    expect(await provider.authorize(credentials, authRequest)).toBeNull();
    expect(compareMock).not.toHaveBeenCalled();

    prismaMock.user.findFirst.mockResolvedValue(null);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await provider.authorize(credentials, authRequest)).toBeNull();
    }
    expect(await provider.authorize(credentials, authRequest)).toBeNull();
    expect(prismaMock.user.findFirst).toHaveBeenCalledTimes(5);
  });

  it("rejects inactive database sessions even when the JWT session exists", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expect(getAuthSession()).resolves.toBeNull();
  });

  it("blocks forced-password users in API and page authorization", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    prismaMock.user.findUnique.mockResolvedValue(authUser({ mustChangePassword: true }));

    const apiResult = await requireApiRoles(["SUPERVISOR"]);
    expect(apiResult.error?.status).toBe(403);
    await expect(requireRole("SUPERVISOR")).rejects.toThrow("REDIRECT:/ar/change-password");
    expect(redirect).toHaveBeenCalledWith("/ar/change-password");
  });

  it("keeps Supervisor operational and denies unrelated role pages", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    prismaMock.user.findUnique.mockResolvedValue(authUser());

    const operational = await requireApiRoles(["SUPERVISOR", "ADMIN"]);
    expect(operational.error).toBeNull();
    expect(operational.user?.role).toBe("SUPERVISOR");

    const financialOnly = await requireApiRoles(["ADMIN"]);
    expect(financialOnly.error?.status).toBe(403);
    await expect(requireRole("ADMIN")).rejects.toThrow("REDIRECT:/ar/supervisor");
  });

  it("redirects authenticated users to change password before role routing", async () => {
    getTokenMock.mockResolvedValue({
      role: "SUPERVISOR",
      mustChangePassword: true,
    });

    const response = await proxy(request("/ar/admin"));

    expect(response.headers.get("location")).toBe("http://localhost:3000/ar/change-password");
  });

  it("redirects a Supervisor away from admin routes", async () => {
    getTokenMock.mockResolvedValue({
      role: "SUPERVISOR",
      mustChangePassword: false,
    });

    const response = await proxy(request("/ar/admin"));

    expect(response.headers.get("location")).toBe("http://localhost:3000/ar/supervisor");
  });
});
