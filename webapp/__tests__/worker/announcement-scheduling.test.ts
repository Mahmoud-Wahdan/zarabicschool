jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { getServerSession } from "next-auth";

import { POST as announceRoute } from "../../app/api/announcements/route";
import { computeAnnouncementRecipients } from "../../lib/announcements/service";
import { ANNOUNCEMENT_SEND_SPACING_MS } from "../../lib/config/announcements";
import { prisma } from "../../lib/prisma";
import { resetRateLimits } from "../../lib/rate-limit";
import { runWorkerTick } from "../../lib/worker/notifications";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * Review #3 (owner plan approved 2026-10-27): announcement throttling must never
 * delay time-critical jobs. The tick runs the scans first, then ordinary jobs, then
 * at most ONE announcement — and never sleeps (the REAL spacing constants are used
 * here, not mocked). Spacing between announcement sends comes from a staggered
 * eligible time per job. Per-run test academy only (the tick runner's academy filter).
 */
jest.setTimeout(180_000);

const getServerSessionMock = getServerSession as jest.Mock;
let fx: SessionFixtures;

beforeAll(async () => {
  fx = await createSessionFixtures();
  resetRateLimits();
});

afterAll(async () => {
  if (fx) await cleanupSessionFixtures(fx);
  await closePrisma();
});

it("AN-14: with 50 waiting announcement jobs, one tick sends the T+5 late-start reminder, at most one announcement, and does not sleep", async () => {
  const now = new Date();
  const announcement = await prisma.announcement.create({
    data: {
      academyId: fx.academyId, createdById: fx.adminUserId, title: "Backlog", body: "Backlog body",
      expiresAt: new Date(now.getTime() + 3 * 24 * 3600 * 1000), whatsappRecipientCount: 50,
    },
    select: { id: true },
  });
  const recipients = Object.values(fx.studentUserIds);
  await prisma.notificationJob.createMany({
    data: Array.from({ length: 50 }, (_, index) => ({
      academyId: fx.academyId,
      sessionId: null,
      recipientUserId: recipients[index % recipients.length],
      kind: "ANNOUNCEMENT",
      dedupKey: `ANNOUNCEMENT:${announcement.id}:backlog-${index}`,
      scheduledFor: new Date(now.getTime() - 60_000),
      payload: { announcementId: announcement.id },
    })),
  });
  // A session that started 6 minutes ago; the teacher has not clicked the link.
  const session = await prisma.session.create({
    data: {
      academyId: fx.academyId, teacherId: fx.teacherProfileId, subjectId: fx.subjectId, sessionType: "PRIVATE",
      scheduledStart: new Date(now.getTime() - 6 * 60_000), scheduledEnd: new Date(now.getTime() + 54 * 60_000),
      durationMinutes: 60, timezone: "Africa/Cairo", zoomJoinUrl: "https://zoom.us/j/345678901234", createdById: fx.adminUserId,
      status: "SCHEDULED", students: { create: [{ studentId: fx.studentProfileIds.student1 }] },
    },
    select: { id: true },
  });

  const started = Date.now();
  await runWorkerTick(now, fx.academyId);
  const elapsed = Date.now() - started;

  const lateStart = await prisma.notificationJob.findFirstOrThrow({
    where: { sessionId: session.id, kind: "TEACHER_LATE_START" },
    select: { status: true },
  });
  expect(lateStart.status).toBe("SENT");
  expect(await prisma.notificationJob.count({ where: { academyId: fx.academyId, kind: "ANNOUNCEMENT", status: "SENT" } })).toBe(1);
  expect(await prisma.notificationJob.count({ where: { academyId: fx.academyId, kind: "ANNOUNCEMENT", status: "PENDING" } })).toBe(49);
  // The old tick slept 4 s + jitter before every announcement (8 per tick ≈ 32–56 s);
  // the bound leaves room for the tick's own database round trips.
  expect(elapsed).toBeLessThan(15_000);
});

it("AN-15: a new announcement's jobs get staggered eligible times at least the spacing apart", async () => {
  await prisma.notificationJob.updateMany({ where: { academyId: fx.academyId, kind: "ANNOUNCEMENT", status: "PENDING" }, data: { status: "CANCELLED" } });
  getServerSessionMock.mockResolvedValue({ user: { id: fx.adminUserId } });
  const confirmRecipientCount = (await computeAnnouncementRecipients(fx.academyId)).whatsappRecipients;
  const before = Date.now();
  const response = await announceRoute(new Request("http://localhost:3000/api/announcements", {
    method: "POST",
    headers: sameOriginHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ title: "Staggered", body: "Staggered body", confirmRecipientCount }),
  }));
  expect(response.status).toBe(201);
  const { data } = await response.json();
  const jobs = await prisma.notificationJob.findMany({
    where: { kind: "ANNOUNCEMENT", payload: { path: ["announcementId"], equals: data.id } },
    orderBy: { scheduledFor: "asc" },
    select: { scheduledFor: true },
  });
  expect(jobs.length).toBe(confirmRecipientCount);
  expect(jobs[0].scheduledFor.getTime()).toBeLessThanOrEqual(Date.now());
  expect(jobs[0].scheduledFor.getTime()).toBeGreaterThanOrEqual(before - 1000);
  for (let index = 1; index < jobs.length; index += 1) {
    expect(jobs[index].scheduledFor.getTime() - jobs[index - 1].scheduledFor.getTime()).toBeGreaterThanOrEqual(ANNOUNCEMENT_SEND_SPACING_MS);
  }
});
