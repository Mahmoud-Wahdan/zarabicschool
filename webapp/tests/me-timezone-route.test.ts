import { POST } from "../app/api/me/timezone/route";
import { requireApiRoles } from "../lib/dal";
import { prisma } from "../lib/prisma";

jest.mock("../lib/dal", () => ({ requireApiRoles: jest.fn() }));
jest.mock("../lib/prisma", () => ({ prisma: { $transaction: jest.fn() } }));

test.each([
  ["USER", "Europe/London", true], ["USER", "Africa/Cairo", false], ["DEVICE", "Europe/London", false],
])("zone %s / %s records an event only for an effective change", async (source, timezone, changed) => {
  jest.mocked(requireApiRoles).mockResolvedValue({ user: { id: "user", academyId: "academy" }, error: null } as never);
  const tx = {
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone: "Africa/Cairo", timezoneSource: "USER" }), update: jest.fn() },
    userSecurityEvent: { create: jest.fn().mockResolvedValue({ id: "event" }) },
    notificationJob: { create: jest.fn().mockResolvedValue({ id: "job" }) },
  };
  jest.mocked(prisma.$transaction).mockImplementation(async fn => fn(tx as never));
  const response = await POST(new Request("http://localhost/api/me/timezone", { method: "POST",
    headers: { origin: "http://localhost", host: "localhost" }, body: JSON.stringify({ timezone, source }) }));
  expect((await response.json()).data.changed).toBe(changed);
  expect(tx.userSecurityEvent.create).toHaveBeenCalledTimes(changed ? 1 : 0);
  expect(tx.notificationJob.create).toHaveBeenCalledTimes(changed ? 1 : 0);
});
