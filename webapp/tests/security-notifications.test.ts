import { composeAccountSecurityNotice, sendPhoneChangeNotice } from "../lib/notifications/security-notices";
import { processDueNotificationJobs } from "../lib/worker/notifications";
import { jobHref } from "../lib/notifications/inbox";
import { getMessagingProvider } from "../lib/messaging/provider";
import { prisma } from "../lib/prisma";

jest.mock("../lib/messaging/provider", () => ({ getMessagingProvider: jest.fn() }));
jest.mock("../lib/messaging/readiness", () => ({ isWhatsAppDeliveryReady: async () => true }));
jest.mock("../lib/reports/session1-ready", () => ({ isSession1ReportsReady: async () => true }));
jest.mock("../lib/prisma", () => ({ prisma: { notificationJob: {
  count: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
} } }));

const url = "https://school.example/en/login";
const originalUrl = process.env.APP_PUBLIC_URL;
beforeEach(() => { process.env.APP_PUBLIC_URL = "https://school.example"; });
afterEach(() => {
  if (originalUrl === undefined) delete process.env.APP_PUBLIC_URL;
  else process.env.APP_PUBLIC_URL = originalUrl;
});

test("messages only describe an account change and link to login", () => {
  expect(composeAccountSecurityNotice("en", url)).toBe(`Your account information has changed. ${url}`);
  expect(composeAccountSecurityNotice("ar", url)).toContain(url);
  expect(jobHref("ACCOUNT_SECURITY_NOTICE", "TEACHER", null)).toBe("/login");
});

test("direct failure stores a redacted status even when provider throws sensitive text", async () => {
  const sendText = jest.fn().mockRejectedValue(new Error("private phone +201111111111"));
  jest.mocked(getMessagingProvider).mockReturnValue({ sendText } as never);
  expect(await sendPhoneChangeNotice({ notificationJobId: "job", userId: "user", oldPhone: "+201111111111", language: "en" }))
    .toEqual({ status: "FAILED" });
  expect(sendText).toHaveBeenCalledWith({ userId: "user", phone: "+201111111111" },
    composeAccountSecurityNotice("en", url), { idempotencyKey: "notification-job:job" });
  const write = jest.mocked(prisma.notificationJob.update).mock.calls.at(-1);
  expect(write?.[0].data.status).toBe("FAILED");
  expect(JSON.stringify(write)).not.toContain("+201111111111");
});

test.each([["ACCOUNT_SECURITY_NOTICE", true], ["SESSION_START", false]])("inactive recipient handles %s", async (kind, sends) => {
  const sendText = jest.fn().mockResolvedValue({ ok: true });
  jest.mocked(getMessagingProvider).mockReturnValue({ sendText } as never);
  jest.mocked(prisma.notificationJob.count).mockResolvedValue(0);
  jest.mocked(prisma.notificationJob.updateMany).mockResolvedValue({ count: 1 });
  jest.mocked(prisma.notificationJob.findMany).mockResolvedValueOnce([{
    id: "job", academyId: "academy", kind, attempts: 0, payload: { inAppOnly: false },
    recipientUser: { id: "user", isActive: false, phone: "+201111111111", preferredLanguage: "en" },
  }] as never).mockResolvedValueOnce([]);
  await processDueNotificationJobs();
  expect(sendText).toHaveBeenCalledTimes(sends ? 1 : 0);
  if (sends) expect(sendText.mock.calls[0][1]).toBe(composeAccountSecurityNotice("en", url));
});

test.each([{ inAppOnly: true }, null])("requeued direct or unrecognized jobs never send to the new number", async payload => {
  const sendText = jest.fn();
  jest.mocked(getMessagingProvider).mockReturnValue({ sendText } as never);
  jest.mocked(prisma.notificationJob.count).mockResolvedValue(0);
  jest.mocked(prisma.notificationJob.updateMany).mockResolvedValue({ count: 1 });
  jest.mocked(prisma.notificationJob.findMany).mockResolvedValueOnce([{
    id: "job", academyId: "academy", kind: "ACCOUNT_SECURITY_NOTICE", attempts: 1, payload,
    recipientUser: { id: "user", isActive: true, phone: "+201111111112", preferredLanguage: "en" },
  }] as never).mockResolvedValueOnce([]);
  await processDueNotificationJobs();
  expect(sendText).not.toHaveBeenCalled();
  expect(prisma.notificationJob.update).toHaveBeenLastCalledWith(expect.objectContaining({
    where: { id: "job" }, data: expect.objectContaining({ status: "FAILED" }),
  }));
});

test("delivery logging failure returns a warning after the account change has committed", async () => {
  jest.mocked(getMessagingProvider).mockReturnValue({ sendText: jest.fn().mockResolvedValue({ ok: true }) } as never);
  jest.mocked(prisma.notificationJob.update).mockRejectedValueOnce(new Error("database unavailable"));
  await expect(sendPhoneChangeNotice({ notificationJobId: "job", userId: "user", oldPhone: "+201111111111", language: "en" }))
    .resolves.toEqual({ status: "FAILED" });
});
