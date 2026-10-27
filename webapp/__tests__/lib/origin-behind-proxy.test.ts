jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import bcrypt from "bcrypt";
import { getServerSession } from "next-auth";

import { POST as applicationsRoute } from "../../app/api/applications/route";
import { POST as changePasswordRoute } from "../../app/api/auth/change-password/route";
import { prisma } from "../../lib/prisma";
import { resetRateLimits } from "../../lib/rate-limit";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * Review #8 (owner 2026-10-27): behind a proxy/tunnel the app sees an INTERNAL
 * request.url while the browser's Origin and Host are the public ones. The single
 * shared guard (requireSameOrigin: Host in dev, ALLOWED_ORIGINS in production) must
 * decide — the old duplicate "Origin === request.url origin" checks in two routes
 * refused every such request (e.g. a forced password change through ngrok).
 */
jest.setTimeout(120_000);

const getServerSessionMock = getServerSession as jest.Mock;
let fx: SessionFixtures;

function behindProxy(path: string, body: unknown) {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: {
      origin: "https://public.example.test",
      host: "public.example.test",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  fx = await createSessionFixtures();
});

beforeEach(() => resetRateLimits());

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("Same-origin guard behind a proxy (#8)", () => {
  it("ORG-01: the public application form passes the origin check (answer is about the body, not 403)", async () => {
    const response = await applicationsRoute(behindProxy("/api/applications", {}));
    expect(response.status).not.toBe(403);
    expect(response.status).toBe(400);
  });

  it("ORG-02: a forced password change through the tunnel succeeds", async () => {
    const userId = fx.studentUserIds.student10;
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash("OldPass123", 4), mustChangePassword: true },
    });
    getServerSessionMock.mockResolvedValue({ user: { id: userId } });
    const response = await changePasswordRoute(
      behindProxy("/api/auth/change-password", { currentPassword: "OldPass123", newPassword: "NewPass456", confirmPassword: "NewPass456" }),
    );
    expect(response.status).toBe(200);
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { mustChangePassword: true } });
    expect(fresh.mustChangePassword).toBe(false);
  });

  it("ORG-03: a foreign Origin is still refused by the shared guard", async () => {
    const response = await changePasswordRoute(
      new Request("http://localhost:3000/api/auth/change-password", {
        method: "POST",
        headers: { origin: "https://evil.example", host: "public.example.test", "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(403);
  });
});
