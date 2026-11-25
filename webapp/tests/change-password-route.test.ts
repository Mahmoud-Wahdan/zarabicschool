import bcrypt from "bcrypt";
import { POST } from "../app/api/auth/change-password/route";
import { getAuthSession } from "../lib/dal";
import { prisma } from "../lib/prisma";

jest.mock("../lib/dal", () => ({ getAuthSession: jest.fn() }));
jest.mock("../lib/prisma", () => ({ prisma: { user: { findUnique: jest.fn() }, $transaction: jest.fn() } }));

test("changes the password, revokes sessions and enqueues a safe notice in one transaction", async () => {
  jest.mocked(getAuthSession).mockResolvedValue({ id: "user", academyId: "academy", sessionVersion: 3 } as never);
  jest.mocked(prisma.user.findUnique).mockResolvedValue({ passwordHash: await bcrypt.hash("previous123", 4) } as never);
  const tx = {
    user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    userSecurityEvent: { create: jest.fn().mockResolvedValue({ id: "event" }) },
    notificationJob: { create: jest.fn().mockResolvedValue({ id: "job" }) },
  };
  jest.mocked(prisma.$transaction).mockImplementation(async fn => fn(tx as never));
  const response = await POST(new Request("http://localhost/api/auth/change-password", {
    method: "POST", headers: { origin: "http://localhost", host: "localhost" },
    body: JSON.stringify({ currentPassword: "previous123", newPassword: "replacement123", confirmPassword: "replacement123" }),
  }));
  expect(await response.json()).toEqual({ ok: true });
  expect(tx.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ sessionVersion: { increment: 1 }, mustChangePassword: false, passwordChangedAt: expect.any(Date) }),
  }));
  expect(tx.userSecurityEvent.create.mock.calls[0][0].data).toEqual({
    academyId: "academy", targetUserId: "user", actorUserId: "user", action: "PASSWORD_CHANGED",
  });
  expect(tx.notificationJob.create.mock.calls[0][0].data.kind).toBe("ACCOUNT_SECURITY_NOTICE");
});
