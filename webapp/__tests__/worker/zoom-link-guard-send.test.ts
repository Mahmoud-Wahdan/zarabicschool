jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));
// This suite's provider records the exact text handed to WhatsApp (no network).
const mockSentTexts: string[] = [];
jest.mock("../../lib/messaging/provider", () => ({
  getMessagingProvider: () => ({
    sendText: async (_recipient: unknown, text: string) => {
      mockSentTexts.push(text);
      return { ok: true, providerMessageId: `m-${mockSentTexts.length}` };
    },
    sendCredentials: async () => ({ ok: true }),
  }),
}));

import { prisma } from "../../lib/prisma";
import { processDueNotificationJobs } from "../../lib/worker/notifications";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * Owner (2026-10-31): "the message has the Zoom link directly". Whatever builds the
 * text, what reaches the messaging provider never contains zoom.us — an Admin message
 * with a pasted Zoom link goes out with a pointer to the platform instead. The provider
 * here records the exact text it is given. Per-run test academy only; no network.
 */
jest.setTimeout(120_000);

let fx: SessionFixtures;

beforeAll(async () => {
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

it("ZG-05: an Admin message with a pasted Zoom link reaches OpenWA without it", async () => {
  const message = await prisma.adminMessage.create({
    data: { academyId: fx.academyId, recipientUserId: fx.teacherUserId, createdById: fx.adminUserId, body: "ادخل الحصة: https://us05web.zoom.us/j/123456789?pwd=secret" },
  });
  await prisma.notificationJob.create({
    data: {
      academyId: fx.academyId, recipientUserId: fx.teacherUserId, kind: "ADMIN_MESSAGE",
      dedupKey: `ADMIN_MESSAGE:${message.id}`, scheduledFor: new Date(Date.now() - 1000), payload: { adminMessageId: message.id },
    },
  });
  await processDueNotificationJobs(new Date(), fx.academyId);
  const job = await prisma.notificationJob.findFirstOrThrow({ where: { dedupKey: `ADMIN_MESSAGE:${message.id}` }, select: { status: true, lastError: true } });
  expect(job).toEqual({ status: "SENT", lastError: null });
  expect(mockSentTexts).toHaveLength(1);
  expect(mockSentTexts[0]).not.toMatch(/zoom\.us|pwd=/i);
  expect(mockSentTexts[0]).toContain("رابط الحصة على المنصة");
});
