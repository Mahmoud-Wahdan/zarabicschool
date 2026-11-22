import { randomUUID } from "node:crypto";

import { fakeMessaging } from "../helpers/fake-messaging";
import { prisma } from "../../lib/prisma";
import { processDueNotificationJobs } from "../../lib/worker/notifications";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

jest.setTimeout(120_000);

let fx: SessionFixtures;
const previousOpenWaEnv = {
  url: process.env.OPENWA_URL,
  apiKey: process.env.OPENWA_API_KEY,
  sessionId: process.env.OPENWA_SESSION_ID,
};

async function createDueJobs(count: number) {
  const recipientUserIds = [fx.studentUserIds.student1, fx.studentUserIds.student2];
  const dedupPrefix = `throughput-${randomUUID()}`;
  await prisma.notificationJob.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      academyId: fx.academyId,
      sessionId: null,
      recipientUserId: recipientUserIds[index % recipientUserIds.length],
      kind: "SESSION_REQUEST",
      dedupKey: `${dedupPrefix}:${index}`,
      scheduledFor: new Date(Date.now() - 1_000),
    })),
  });
  return dedupPrefix;
}

beforeAll(async () => {
  process.env.OPENWA_URL = "http://fake-openwa.test";
  process.env.OPENWA_API_KEY = "test-key";
  process.env.OPENWA_SESSION_ID = "test-session";
  fx = await createSessionFixtures();
});

afterAll(async () => {
  if (previousOpenWaEnv.url === undefined) delete process.env.OPENWA_URL;
  else process.env.OPENWA_URL = previousOpenWaEnv.url;
  if (previousOpenWaEnv.apiKey === undefined) delete process.env.OPENWA_API_KEY;
  else process.env.OPENWA_API_KEY = previousOpenWaEnv.apiKey;
  if (previousOpenWaEnv.sessionId === undefined) delete process.env.OPENWA_SESSION_ID;
  else process.env.OPENWA_SESSION_ID = previousOpenWaEnv.sessionId;
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

beforeEach(() => {
  fakeMessaging.reset();
});

it("spaces consecutive ordinary sends by one second and marks both sent", async () => {
  const dedupPrefix = await createDueJobs(2);
  const setTimeoutSpy = jest.spyOn(global, "setTimeout");

  try {
    await processDueNotificationJobs(new Date(), fx.academyId);

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1_000);
    expect(fakeMessaging.sent).toHaveLength(2);
    const jobs = await prisma.notificationJob.findMany({
      where: { dedupKey: { startsWith: dedupPrefix } },
      select: { status: true },
    });
    expect(jobs).toHaveLength(2);
    expect(jobs.every((job) => job.status === "SENT")).toBe(true);
  } finally {
    setTimeoutSpy.mockRestore();
  }
});

it("does not add an inter-send delay for a single ordinary notification", async () => {
  const dedupPrefix = await createDueJobs(1);
  const setTimeoutSpy = jest.spyOn(global, "setTimeout");

  try {
    await processDueNotificationJobs(new Date(), fx.academyId);

    expect(setTimeoutSpy.mock.calls.some(([, delay]) => delay === 1_000)).toBe(false);
    expect(fakeMessaging.sent).toHaveLength(1);
    const job = await prisma.notificationJob.findFirstOrThrow({
      where: { dedupKey: { startsWith: dedupPrefix } },
      select: { status: true },
    });
    expect(job.status).toBe("SENT");
  } finally {
    setTimeoutSpy.mockRestore();
  }
});
