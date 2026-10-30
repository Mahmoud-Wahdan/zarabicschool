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
  default: () => (request: unknown) => ({ type: "i18n", request, headers: new Headers() }),
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

    // D90: 3 failed attempts (the inactive one counts) block this username from this
    // address for 15 minutes — the 4th attempt never reaches the database.
    prismaMock.user.findFirst.mockResolvedValue(null);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(await provider.authorize(credentials, authRequest)).toBeNull();
    }
    expect(await provider.authorize(credentials, authRequest)).toBeNull();
    expect(prismaMock.user.findFirst).toHaveBeenCalledTimes(3);
    // Another address is not locked out by those failures.
    await provider.authorize(credentials, { headers: new Headers({ "x-forwarded-for": "198.51.100.44" }) });
    expect(prismaMock.user.findFirst).toHaveBeenCalledTimes(4);
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

  it("keeps complaints, evaluation summaries and announcements Admin/Supervisor-only at the page gate (Phase 7)", async () => {
    const pages = ["/ar/admin/complaints", "/ar/admin/complaints/some-id", "/ar/admin/evaluations", "/ar/admin/announcements"];
    for (const role of ["TEACHER", "STUDENT", "GUARDIAN"]) {
      getTokenMock.mockResolvedValue({ role, mustChangePassword: false });
      for (const page of pages) {
        const response = await proxy(request(page));
        expect(response.headers.get("location")).toBe(`http://localhost:3000/ar/${role.toLowerCase()}`);
      }
    }
    for (const role of ["SUPERVISOR", "ADMIN"]) {
      getTokenMock.mockResolvedValue({ role, mustChangePassword: false });
      for (const page of pages) {
        const response = (await proxy(request(page))) as unknown as { type?: string };
        expect(response.type).toBe("i18n");
      }
    }
    getTokenMock.mockResolvedValue(null);
    expect((await proxy(request("/ar/admin/complaints"))).headers.get("location")).toBe("http://localhost:3000/ar/login");
  });

  it("sends a nonce CSP on pages and hands the same policy and nonce to the renderer (G-A02-1)", async () => {
    getTokenMock.mockResolvedValue(null);
    type Routed = { request: NextRequest; headers: Headers };
    const first = (await proxy(request("/ar"))) as unknown as Routed;
    const policy = first.headers.get("content-security-policy") ?? "";
    const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    for (const directive of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"]) {
      expect(policy).toContain(directive);
    }
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
    // Next.js reads the nonce from the request's CSP header when it renders the page.
    expect(first.request.headers.get("content-security-policy")).toBe(policy);
    // Nothing in the app reads an x-nonce header; Next.js takes the nonce from the CSP (review 2026-10-29).
    expect(first.request.headers.get("x-nonce")).toBeNull();
    const second = (await proxy(request("/ar"))) as unknown as Routed;
    expect(second.headers.get("content-security-policy")).not.toBe(policy);

    process.env.CSP_REPORT_ONLY = "1";
    try {
      const reportOnly = (await proxy(request("/ar"))) as unknown as Routed;
      expect(reportOnly.headers.get("content-security-policy")).toBeNull();
      expect(reportOnly.headers.get("content-security-policy-report-only")).toContain("'nonce-");
    } finally {
      delete process.env.CSP_REPORT_ONLY;
    }
  });

  it("answers 400 for a path that is not valid percent-encoding, instead of a page whose scripts the CSP would block", async () => {
    getTokenMock.mockResolvedValue(null);
    const response = await proxy(request("/en/%E0%A4%A"));
    expect(response.status).toBe(400);
    expect((response as unknown as { type?: string }).type).not.toBe("i18n");
  });

  it("skips the per-request CSP work for router prefetches (the browser never renders them as a document)", async () => {
    getTokenMock.mockResolvedValue(null);
    const prefetch = new NextRequest("http://localhost:3000/ar", { headers: { "next-router-prefetch": "1" } });
    const routed = (await proxy(prefetch)) as unknown as { type?: string; headers: Headers };
    expect(routed.type).toBe("i18n");
    expect(routed.headers.get("content-security-policy")).toBeNull();
  });
});
