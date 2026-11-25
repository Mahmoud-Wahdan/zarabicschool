import { getMessagingProvider } from "../lib/messaging/provider";
jest.mock("../lib/messaging/provider", () => ({ getMessagingProvider: jest.fn() }));
import { PATCH } from "../app/api/me/profile/route";
import { requireApiRoles } from "../lib/dal";
import { prisma } from "../lib/prisma";

jest.mock("../lib/dal", () => ({ requireApiRoles: jest.fn() }));
jest.mock("../lib/prisma", () => ({ prisma: { notificationJob: { update: jest.fn() }, $transaction: jest.fn() } }));

const mockedRequireApiRoles = jest.mocked(requireApiRoles);
const mockedTransaction = jest.mocked(prisma.$transaction);

test("clearing DOB preserves the stored Student.isAdult value", async () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  mockedRequireApiRoles.mockResolvedValue({
    user: { id: userId, academyId: "academy-1", role: "STUDENT" },
    error: null,
  } as never);

  const tx = {
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: userId, dateOfBirth: new Date("1990-01-01") }),
      update: jest.fn().mockResolvedValue({ id: userId }),
    },
    userSecurityEvent: { create: jest.fn().mockResolvedValue({ id: "event" }) },
    notificationJob: { create: jest.fn().mockResolvedValue({ id: "job" }) },
    student: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ isAdult: true }),
      update: jest.fn().mockResolvedValue({ id: "student-1" }),
    },
  };
  mockedTransaction.mockImplementation(async (operation) => {
    if (typeof operation !== "function") throw new Error("Expected interactive transaction");
    return operation(tx as never);
  });

  const response = await PATCH(new Request("http://localhost/api/me/profile", {
    method: "PATCH",
    headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ dateOfBirth: "" }),
  }));

  expect(response.status).toBe(200);
  expect(tx.student.update).toHaveBeenCalledWith({
    where: { userId },
    data: { isAdult: true },
    select: { id: true },
  });
  expect(tx.student.findUniqueOrThrow).toHaveBeenCalledWith({
    where: { userId },
    select: { isAdult: true, guardianId: true },
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
  mockedRequireApiRoles.mockResolvedValue({ user: { id: id, role: "ADMIN", academyId: "academy" }, error: null } as never);
  const sendText = jest.fn().mockResolvedValue({ ok: false, error: original });
  jest.mocked(getMessagingProvider).mockReturnValue({ sendText } as never);
  const previousUrl = process.env.APP_PUBLIC_URL;
  process.env.APP_PUBLIC_URL = "https://school.example";
  try {
    const response = await PATCH(new Request("http://localhost/api/me/profile", {
      method: "PATCH", headers: { origin: "http://localhost", host: "localhost" },
      body: JSON.stringify({ phone: changed ? replacement : original }),
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).whatsappDelivery).toBe(changed ? "FAILED" : undefined);
    expect(sendText).toHaveBeenCalledTimes(changed ? 1 : 0);
    expect(tx.notificationJob.create).toHaveBeenCalledTimes(changed ? 1 : 0);
    expect(tx.userSecurityEvent.create).toHaveBeenCalledTimes(changed ? 1 : 0);
    if (changed) {
      expect(sendText.mock.calls[0][0]).toEqual({ userId: id, phone: original });
      const job = tx.notificationJob.create.mock.calls[0][0].data;
      expect(job.status).toBe("PROCESSING");
      expect(job.payload).toEqual({ action: "ACCOUNT_UPDATED", inAppOnly: true, changedFields: ["phone"] });
      expect(JSON.stringify(job)).not.toContain(original);
    }
  } finally {
    if (previousUrl === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = previousUrl;
  }
});
