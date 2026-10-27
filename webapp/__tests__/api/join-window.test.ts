jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("next-intl/server", () => ({
  getLocale: jest.fn().mockResolvedValue("ar"),
}));

import { getServerSession } from "next-auth";

import { GET as joinRoute } from "../../app/api/sessions/[id]/join/route";
import { GET as getWindowRoute, PUT as putWindowRoute } from "../../app/api/admin/settings/join-window/route";
import { DEFAULT_JOIN_WINDOW_MINUTES } from "../../lib/config/session-join";
import { enqueueSessionJobs } from "../../lib/notifications/session-jobs";
import { JOIN_WINDOW_SETTING_KEY } from "../../lib/sessions/join-window";
import { composeJobMessage } from "../../lib/worker/notifications";
import { prisma } from "../../lib/prisma";
import { resetRateLimits } from "../../lib/rate-limit";
import { sameOriginHeaders } from "../helpers/http";
import {
  cleanupSessionFixtures,
  closePrisma,
  createSessionFixtures,
  type SessionFixtures,
} from "../helpers/session-fixtures";

/**
 * S-04 (D4, OQ-4 answered 2026-10-27): the join window is an Admin setting
 * (`join_window_minutes`, 5–120, default 30) for every role; the WhatsApp reminder is
 * sent when the window opens (it replaces the old T−2h reminder) and carries the
 * PLATFORM join link; changing the setting re-times the pending reminders of future
 * sessions. Per-run test academy only.
 */
jest.setTimeout(180_000);

const MINUTE = 60_000;
const JOIN_URL = "https://zoom.us/j/123456789012";
const getServerSessionMock = getServerSession as jest.Mock;
let fx: SessionFixtures;

function asActor(userId: string | null) {
  getServerSessionMock.mockResolvedValue(userId ? { user: { id: userId } } : null);
}

function routeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function joinRequest(sessionId: string) {
  return new Request(`http://localhost:3000/api/sessions/${sessionId}/join`, { method: "GET" });
}

function putWindow(body: unknown) {
  return new Request("http://localhost:3000/api/admin/settings/join-window", {
    method: "PUT",
    headers: sameOriginHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
}

async function createSession(startMinutes: number) {
  const now = Date.now();
  return prisma.session.create({
    data: {
      academyId: fx.academyId,
      teacherId: fx.teacherProfileId,
      subjectId: fx.subjectId,
      sessionType: "PRIVATE",
      scheduledStart: new Date(now + startMinutes * MINUTE),
      scheduledEnd: new Date(now + (startMinutes + 60) * MINUTE),
      durationMinutes: 60,
      timezone: "Africa/Cairo",
      zoomJoinUrl: JOIN_URL,
      status: "SCHEDULED",
      createdById: fx.adminUserId,
      students: { create: [{ studentId: fx.studentProfileIds.student2 }] },
    },
    select: { id: true, scheduledStart: true },
  });
}

async function setWindow(minutes: number | null) {
  const where = { academyId_key: { academyId: fx.academyId, key: JOIN_WINDOW_SETTING_KEY } };
  if (minutes === null) {
    await prisma.academySetting.deleteMany({ where: { academyId: fx.academyId, key: JOIN_WINDOW_SETTING_KEY } });
    return;
  }
  await prisma.academySetting.upsert({
    where,
    create: { academyId: fx.academyId, key: JOIN_WINDOW_SETTING_KEY, value: minutes },
    update: { value: minutes },
  });
}

async function joinStatus(sessionId: string) {
  asActor(fx.studentUserIds.student2);
  const response = await joinRoute(joinRequest(sessionId), routeParams(sessionId));
  if (response.status === 307) return 307;
  return (await response.json()).error.code as string;
}

beforeAll(async () => {
  fx = await createSessionFixtures();
});

beforeEach(() => resetRateLimits());

afterAll(async () => {
  await cleanupSessionFixtures(fx);
  await closePrisma();
});

describe("S-04 join window setting", () => {
  it("JW-01: with no setting the window opens 30 minutes before the start", async () => {
    expect(DEFAULT_JOIN_WINDOW_MINUTES).toBe(30);
    await setWindow(null);
    const inside = await createSession(29);
    const before = await createSession(31);
    expect(await joinStatus(inside.id)).toBe(307);
    expect(await joinStatus(before.id)).toBe("JOIN_NOT_YET_OPEN");
  });

  it("JW-02: the join route follows the Admin setting", async () => {
    const at45 = await createSession(45);
    const at12 = await createSession(12);
    await setWindow(60);
    expect(await joinStatus(at45.id)).toBe(307);
    await setWindow(10);
    expect(await joinStatus(at12.id)).toBe("JOIN_NOT_YET_OPEN");
    await setWindow(null);
  });

  it("JW-03: only the Admin may read/change it; 5–120 whole minutes only", async () => {
    asActor(fx.supervisorUserId);
    expect((await putWindowRoute(putWindow({ minutes: 30 }))).status).toBe(403);
    expect((await getWindowRoute()).status).toBe(403);
    asActor(fx.teacherUserId);
    expect((await putWindowRoute(putWindow({ minutes: 30 }))).status).toBe(403);

    asActor(fx.adminUserId);
    for (const minutes of [4, 121, 30.5, "30", null]) {
      const response = await putWindowRoute(putWindow({ minutes }));
      expect(response.status).toBe(400);
    }
    const ok = await putWindowRoute(putWindow({ minutes: 45 }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.minutes).toBe(45);
    const read = await getWindowRoute();
    expect((await read.json()).data.minutes).toBe(45);

    const crossOrigin = await putWindowRoute(new Request("http://localhost:3000/api/admin/settings/join-window", {
      method: "PUT",
      headers: { origin: "https://evil.example", host: "localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ minutes: 30 }),
    }));
    expect(crossOrigin.status).toBe(403);
    await setWindow(null);
  });

  it("JW-04: the reminder is queued when the window opens (no T−2h reminder)", async () => {
    await setWindow(40);
    const session = await createSession(24 * 60);
    await prisma.$transaction((tx) =>
      enqueueSessionJobs(tx, fx.academyId, session.id, session.scheduledStart, fx.teacherUserId, [fx.studentUserIds.student2], [fx.guardianUserId]),
    );
    const jobs = await prisma.notificationJob.findMany({
      where: { sessionId: session.id },
      select: { kind: true, scheduledFor: true },
    });
    const reminders = jobs.filter((job) => job.kind === "SESSION_REMINDER");
    expect(reminders).toHaveLength(3);
    for (const job of reminders) {
      expect(job.scheduledFor.getTime()).toBe(session.scheduledStart.getTime() - 40 * MINUTE);
    }
    expect(jobs.filter((job) => job.kind === "SESSION_START")).toHaveLength(3);
    // JW-05 counts re-timed reminders in this academy: leave none behind.
    await prisma.notificationJob.deleteMany({ where: { sessionId: session.id } });
    await setWindow(null);
  });

  it("JW-05: saving a new window re-times PENDING reminders of future sessions only", async () => {
    await setWindow(30);
    const future = await createSession(24 * 60);
    const started = await createSession(-5);
    const job = (sessionId: string, start: Date, status: "PENDING" | "SENT", suffix: string) => ({
      academyId: fx.academyId,
      sessionId,
      recipientUserId: fx.studentUserIds.student2,
      kind: "SESSION_REMINDER",
      dedupKey: `SESSION_REMINDER:${sessionId}:${suffix}`,
      scheduledFor: new Date(start.getTime() - 30 * MINUTE),
      status,
    });
    await prisma.notificationJob.createMany({
      data: [
        job(future.id, future.scheduledStart, "PENDING", "pending"),
        job(future.id, future.scheduledStart, "SENT", "sent"),
        job(started.id, started.scheduledStart, "PENDING", "started"),
      ],
    });
    asActor(fx.adminUserId);
    const response = await putWindowRoute(putWindow({ minutes: 90 }));
    expect(response.status).toBe(200);
    expect((await response.json()).data.retimedReminders).toBe(1);

    const rows = await prisma.notificationJob.findMany({
      where: { sessionId: { in: [future.id, started.id] }, kind: "SESSION_REMINDER" },
      select: { dedupKey: true, scheduledFor: true },
    });
    const byKey = Object.fromEntries(rows.map((row) => [row.dedupKey.split(":")[2], row.scheduledFor.getTime()]));
    expect(byKey.pending).toBe(future.scheduledStart.getTime() - 90 * MINUTE);
    expect(byKey.sent).toBe(future.scheduledStart.getTime() - 30 * MINUTE);
    expect(byKey.started).toBe(started.scheduledStart.getTime() - 30 * MINUTE);
    await setWindow(null);
  });
});

describe("S-04 reminder text (JL-01 follow-up)", () => {
  const saved = process.env.APP_PUBLIC_URL;
  afterAll(() => {
    if (saved === undefined) delete process.env.APP_PUBLIC_URL; else process.env.APP_PUBLIC_URL = saved;
  });

  function reminder(startOffsetMinutes: number, language: "en" | "ar") {
    const start = new Date(Date.now() + startOffsetMinutes * MINUTE);
    return {
      id: "job", kind: "SESSION_REMINDER", sessionId: "11111111-1111-4111-8111-111111111111",
      recipientUser: { id: "u", phone: "+201000000003", isActive: true, preferredLanguage: language, timezone: "Africa/Cairo" },
      session: { scheduledStart: start, scheduledEnd: new Date(start.getTime() + 60 * MINUTE), timezone: "Africa/Cairo", status: "SCHEDULED", subject: { nameAr: "قرآن", nameEn: "Quran" }, zoomJoinUrl: JOIN_URL },
    } as unknown as Parameters<typeof composeJobMessage>[0];
  }

  it("JW-06: inside the configured window the reminder carries the platform link, never zoom.us", () => {
    process.env.APP_PUBLIC_URL = "https://academy.example";
    for (const language of ["en", "ar"] as const) {
      const text = composeJobMessage(reminder(40, language), 45);
      expect(text).toContain("https://academy.example/api/sessions/11111111-1111-4111-8111-111111111111/join");
      expect(text).not.toContain("zoom.us");
      const early = composeJobMessage(reminder(40, language), 20);
      expect(early).not.toContain("http");
      expect(early).toContain("20");
    }
  });
});
